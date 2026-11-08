-- 0027 : relances automatiques désactivées par défaut (Clément les active dans Suivi → Règles & dispo) ; pas de relance 72 h pour un élève qui n'a jamais écrit dans l'espace
update public.settings set co_relance_on = false where id = 1;
alter table public.settings alter column co_relance_on set default false;

create or replace function private.co_watch() returns jsonb language plpgsql security definer set search_path = public, private as $$
declare s public.settings; r record; hp int := extract(hour from (now() at time zone 'Europe/Paris'))::int; n_sla int := 0; n_admin int := 0; n_r24 int := 0; n_r72 int := 0; n_7j int := 0;
        prenom text; action text; body text; sender uuid; cs public.coach_status;
begin
  select * into s from public.settings where id = 1;
  -- 1) coach : question sans réponse au-delà de l'objectif
  for r in
    select q.*, p.coach_id, p.name student_name from public.co_response_times q join public.profiles p on p.id = q.student_id
    where q.answered_at is null and q.asked_at < now() - make_interval(mins => coalesce(s.co_sla_min, 120)) and q.asked_at > now() - interval '7 days'
      and not exists (select 1 from public.co_alerts a where a.kind = 'coach_sla' and a.thread_id = q.thread_id and a.ref_at = q.asked_at)
  loop
    insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.student_id, 'coach_sla', r.asked_at);
    if r.coach_id is not null then
      insert into public.notifications (user_id, title, body, url) values (r.coach_id, '⏱ ' || coalesce(r.student_name, 'Un élève') || ' attend ta réponse', 'depuis ' || round(extract(epoch from (now() - r.asked_at)) / 60) || ' min · objectif ' || coalesce(s.co_sla_min, 120) || ' min', '#co/' || r.thread_id);
    else
      insert into public.notifications (user_id, title, body, url) select id, '⏱ ' || coalesce(r.student_name, 'Un élève') || ' attend une réponse (pas de coach attribué)', 'depuis ' || round(extract(epoch from (now() - r.asked_at)) / 60) || ' min', '#co/' || r.thread_id from public.profiles where role = 'admin' and active;
    end if;
    n_sla := n_sla + 1;
  end loop;
  -- 2) admins : question sans réponse depuis 24 h
  for r in
    select q.*, p.name student_name, c.name coach_name from public.co_response_times q join public.profiles p on p.id = q.student_id left join public.profiles c on c.id = p.coach_id
    where q.answered_at is null and q.asked_at < now() - make_interval(hours => coalesce(s.co_alert_admin_h, 24)) and q.asked_at > now() - interval '14 days'
      and not exists (select 1 from public.co_alerts a where a.kind = 'admin_24h' and a.thread_id = q.thread_id and a.ref_at = q.asked_at)
  loop
    insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.student_id, 'admin_24h', r.asked_at);
    insert into public.notifications (user_id, title, body, url) select id, '🚨 ' || coalesce(r.student_name, 'Un élève') || ' sans réponse depuis ' || coalesce(s.co_alert_admin_h, 24) || ' h', 'Coach : ' || coalesce(r.coach_name, 'aucun'), '#co/' || r.thread_id from public.profiles where role = 'admin' and active;
    n_admin := n_admin + 1;
  end loop;
  -- 3) relances élève (heures ouvrées 9 h–20 h Paris, pas le dimanche)
  if coalesce(s.co_relance_on, true) and hp between 9 and 19 and extract(dow from (now() at time zone 'Europe/Paris')) <> 0 then
    for r in
      select p.id, p.name, p.coach_id, t.id thread_id,
        coalesce((select max(m.sent_at) from public.co_messages m join public.co_threads x on x.id = m.thread_id where x.student_id = p.id and m.sender_id = p.id), p.created_at) last_at,
        (select max(m.sent_at) from public.co_messages m where m.thread_id = t.id and m.sender_id is distinct from p.id and m.kind <> 'system') last_team
      from public.profiles p join public.co_threads t on t.student_id = p.id and t.kind = 'coach'
      where p.role = 'member' and p.active and p.accel and p.created_at < now() - interval '24 hours'
        and exists (select 1 from public.co_messages m join public.co_threads x on x.id = m.thread_id where x.student_id = p.id and m.sender_id = p.id)   -- a déjà écrit au moins une fois
    loop
      -- l'équipe a déjà écrit en dernier et attend ? on ne relance que si l'élève n'a rien dit depuis 24 h / 72 h
      prenom := split_part(coalesce(r.name, ''), ' ', 1);
      action := coalesce(public.co_next_action(r.id) ->> 'step', 'ta prochaine étape');
      sender := coalesce(r.coach_id, (select id from public.profiles where role = 'admin' and active order by created_at limit 1));
      if r.last_at < now() - interval '72 hours' and not exists (select 1 from public.co_alerts a where a.student_id = r.id and a.kind = 'relance_72h' and a.ref_at = r.last_at) then
        body := replace(replace(coalesce(s.co_relance_72h, ''), '{prenom}', prenom), '{action}', action);
        insert into public.co_messages (thread_id, sender_id, kind, body) values (r.thread_id, sender, 'text', body);
        insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.id, 'relance_72h', r.last_at);
        n_r72 := n_r72 + 1;
      elsif r.last_at < now() - interval '24 hours' and r.last_at >= now() - interval '72 hours' and not exists (select 1 from public.co_alerts a where a.student_id = r.id and a.kind = 'relance_24h' and a.ref_at = r.last_at) then
        body := replace(replace(coalesce(s.co_relance_24h, ''), '{prenom}', prenom), '{action}', action);
        insert into public.co_messages (thread_id, sender_id, kind, body) values (r.thread_id, sender, 'text', body);
        insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.id, 'relance_24h', r.last_at);
        n_r24 := n_r24 + 1;
      end if;
      -- 7 jours : alerte admins (une fois par épisode)
      if r.last_at < now() - interval '7 days' and not exists (select 1 from public.co_alerts a where a.student_id = r.id and a.kind = 'inactif_7j' and a.ref_at = r.last_at) then
        insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.id, 'inactif_7j', r.last_at);
        insert into public.notifications (user_id, title, body, url) select id, '😴 ' || coalesce(r.name, 'Un élève') || ' inactif depuis 7 jours', 'Relancé automatiquement à 24 h et 72 h, sans réponse. À appeler ?', '#co/' || r.thread_id from public.profiles where role = 'admin' and active;
        n_7j := n_7j + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('coach_sla', n_sla, 'admin_24h', n_admin, 'relance_24h', n_r24, 'relance_72h', n_r72, 'inactif_7j', n_7j);
end $$;
