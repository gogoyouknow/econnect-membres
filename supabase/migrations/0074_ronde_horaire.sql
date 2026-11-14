-- 0074 : ronde horaire de santé de Calio. Détecte, corrige ce qui est sûr, journalise, et prévient Clément seulement s'il y a une vraie alerte.
create table if not exists private.health_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  kind text not null,
  severity text not null default 'info',   -- info | alerte
  detail text,
  fixed boolean not null default false,    -- corrigé automatiquement par la ronde
  handled boolean not null default false,  -- traité (par la ronde Claude ou par Clément)
  key text
);
create index if not exists health_log_kind_ts on private.health_log (kind, ts desc);
create table if not exists private.health_state (k text primary key, v text, updated_at timestamptz not null default now());

create or replace function private.health_add(p_kind text, p_sev text, p_detail text, p_fixed boolean default false, p_key text default null) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  -- pas deux fois la même alerte en 24 h
  if exists (select 1 from private.health_log where kind = p_kind and coalesce(key, '') = coalesce(p_key, '') and ts > now() - interval '24 hours') then return false; end if;
  insert into private.health_log (kind, severity, detail, fixed, handled, key) values (p_kind, p_sev, left(p_detail, 600), p_fixed, p_fixed or p_sev = 'info', p_key);
  return true;
end $$;

create or replace function private.health_run() returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare r record; n int; ids text; part text; pname text; pid bigint; resp record; mode_v text; hr int; lines text := ''; last_mail timestamptz; k text;
begin
  -- 1) Tâches planifiées désactivées → on les réactive
  for r in update cron.job set active = true where not active returning jobid, command loop
    perform private.health_add('cron_inactive', 'alerte', 'Tâche réactivée : ' || left(r.command, 80), true, r.jobid::text);
  end loop;

  -- 2) Tâches fréquentes qui ne tournent plus
  for r in select j.jobid, j.command from cron.job j where j.active and j.schedule like '*/%'
      and not exists (select 1 from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '45 minutes') loop
    perform private.health_add('cron_stale', 'alerte', 'Ne tourne plus depuis 45 min : ' || left(r.command, 80), false, r.jobid::text);
  end loop;

  -- 3) Tâches planifiées en échec
  for r in select d.jobid, count(*) n, max(left(d.return_message, 160)) msg from cron.job_run_details d
      where d.status = 'failed' and d.start_time > now() - interval '70 minutes' group by d.jobid loop
    perform private.health_add('cron_failed', 'alerte', 'Tâche ' || r.jobid || ' en échec (' || r.n || ' fois) : ' || coalesce(r.msg, ''), false, r.jobid::text);
  end loop;

  -- 4) Appels sortants (Resend, notifications, fonctions) refusés
  select count(*), max(left(coalesce(content, error_msg, ''), 160)), max(status_code) into n, part, hr
    from net._http_response where created > now() - interval '70 minutes' and status_code >= 400;
  if n > 0 then perform private.health_add('http_refuse', 'alerte', n || ' appel(s) sortant(s) refusé(s) (code ' || hr || ') : ' || coalesce(part, ''), false, to_char(now(), 'YYYY-MM-DD-HH24')); end if;

  -- 5) Sondes : le site public et les fonctions répondent-ils ? (réponse lue à la ronde suivante)
  select v into ids from private.health_state where k = 'probes';
  if ids is not null then
    foreach part in array string_to_array(ids, ',') loop
      pname := split_part(part, ':', 1); pid := split_part(part, ':', 2)::bigint;
      select status_code, error_msg into resp from net._http_response where id = pid;
      if found and (resp.status_code is null or resp.status_code >= 500 or (pname = 'site' and resp.status_code <> 200) or (pname = 'admin' and resp.status_code <> 200)) then
        perform private.health_add('sonde_' || pname, 'alerte', 'Sonde « ' || pname || ' » : ' || coalesce(resp.status_code::text, 'pas de réponse') || ' ' || coalesce(resp.error_msg, ''), false, to_char(now(), 'YYYY-MM-DD-HH24'));
      end if;
    end loop;
  end if;
  ids := '';
  pid := net.http_get(url := 'https://rdv.theambitiousman.fr/'); ids := ids || 'site:' || pid;
  pid := net.http_get(url := 'https://rdv.theambitiousman.fr/admin'); ids := ids || ',admin:' || pid;
  pid := net.http_post(url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/calio-login', headers := jsonb_build_object('Content-Type', 'application/json'), body := '{}'::jsonb); ids := ids || ',login:' || pid;
  insert into private.health_state (k, v, updated_at) values ('probes', ids, now()) on conflict (k) do update set v = excluded.v, updated_at = now();

  -- 6) Erreurs vues par les utilisateurs dans leur navigateur
  for r in select left(message, 140) msg, count(*) n, max(url) u from public.client_errors where ts > now() - interval '70 minutes' group by 1 order by 2 desc limit 5 loop
    perform private.health_add('erreur_ecran', case when r.n >= 3 then 'alerte' else 'info' end, r.n || '× ' || r.msg || ' (' || coalesce(left(r.u, 80), '') || ')', false, left(r.msg, 60));
  end loop;

  -- 7) Emails validés mais pas partis (en journée uniquement)
  hr := extract(hour from now() at time zone 'Europe/Paris');
  select mode into mode_v from public.mail_settings limit 1;
  if hr between 10 and 20 then
    select count(*) into n from public.mail_out m
      where m.status = 'attente' and m.due_at < now() - interval '90 minutes'
        and (coalesce(mode_v, '') <> 'validation' or exists (select 1 from public.mail_ok o where o.step_id = m.step_id and o.day = (m.due_at at time zone 'Europe/Paris')::date));
    if n > 0 then perform private.health_add('mail_bloque', 'alerte', n || ' email(s) prêt(s) à partir depuis plus de 90 min', false, to_char(now(), 'YYYY-MM-DD')); end if;
  end if;

  -- 8) Rappels doux (une fois par jour, sans email) : résultats ou montants manquants
  select count(*) into n from public.candidatures where status = 'fait' and (outcome is null or (outcome = 'signe' and signed_amount is null)) and starts_at < now() - interval '48 hours';
  if n > 0 then perform private.health_add('closing_a_renseigner', 'info', n || ' appel(s) fait(s) sans résultat ou sans montant depuis plus de 48 h', false, to_char(now(), 'YYYY-MM-DD')); end if;

  -- 9) Ménage sûr : codes de connexion expirés
  delete from private.pw_reset where expires_at < now() - interval '1 day';

  -- 10) Alerte envoyée à Clément (au plus une fois toutes les 3 h)
  select count(*) into n from private.health_log where severity = 'alerte' and not fixed and not handled and ts > now() - interval '70 minutes';
  select (v)::timestamptz into last_mail from private.health_state where k = 'last_alert_mail';
  if n > 0 and (last_mail is null or last_mail < now() - interval '3 hours') then
    for r in select kind, detail from private.health_log where severity = 'alerte' and not fixed and not handled and ts > now() - interval '70 minutes' order by id loop
      lines := lines || '<li><b>' || r.kind || '</b> : ' || r.detail || '</li>';
    end loop;
    perform private.send_email('contact@theambitiousman.fr', 'Calio : ' || n || ' alerte(s) à regarder',
      '<div style="font-size:15px;line-height:1.55;color:#222"><p>La ronde horaire de Calio a vu :</p><ul>' || lines || '</ul><p>Claude regarde et corrige à la prochaine ronde. Si rien ne bouge, dis-le-lui.</p></div>', 'Calio');
    perform private.notify_calio('Calio : ' || n || ' alerte(s)', 'La ronde horaire a repéré un problème. Détails par email.', '/admin');
    insert into private.health_state (k, v, updated_at) values ('last_alert_mail', now()::text, now()) on conflict (k) do update set v = excluded.v, updated_at = now();
  end if;

  -- 11) On garde 30 jours de journal
  delete from private.health_log where ts < now() - interval '30 days';
end $$;
revoke all on function private.health_run() from public, anon, authenticated;
revoke all on function private.health_add(text, text, text, boolean, text) from public, anon, authenticated;

select cron.schedule('ronde-horaire', '20 * * * *', 'select private.health_run()');
