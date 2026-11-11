-- 0063 : emails automatiques par profil (no-show, a commencé à répondre, email/numéro laissé) puis séquence « histoire » de 30 jours.
-- Règle : pendant la période de validation (30 jours), RIEN ne part sans l'accord de Clément, jour par jour (table mail_ok).
-- Pas d'accord = pas d'envoi. Rappels : 3 notifications + emails la veille (10 h, 15 h, 19 h) et 3 le jour même (9 h, 13 h, 16 h).

alter table public.cand_leads
  add column if not exists consent_at timestamptz,
  add column if not exists unsub_at timestamptz,
  add column if not exists unsub_token uuid not null default gen_random_uuid();
create unique index if not exists cand_leads_unsub_token on public.cand_leads (unsub_token);

create table if not exists public.mail_settings (
  id int primary key default 1 check (id = 1),
  mode text not null default 'validation' check (mode in ('validation', 'auto', 'pause')),
  launch_at timestamptz not null default now(),
  control_until timestamptz not null default now() + interval '30 days'
);
insert into public.mail_settings (id) values (1) on conflict do nothing;

create table if not exists public.mail_steps (
  id serial primary key,
  seq text not null check (seq in ('contact', 'partial', 'noshow', 'nurture')),
  pos int not null,
  label text not null,
  delay_h numeric not null default 24,   -- après l'email précédent (ou l'entrée dans la séquence)
  at_hour int,                           -- heure de Paris (null = dès que possible, entre 9 h et 21 h)
  subject_a text not null,
  subject_b text not null default '',
  body text not null,
  video_id text,
  video_title text,
  active boolean not null default true,
  winner text check (winner in ('A', 'B')),
  unique (seq, pos)
);

create table if not exists public.mail_enroll (
  id bigserial primary key,
  lead_id bigint not null references public.cand_leads (id) on delete cascade,
  seq text not null,
  started_at timestamptz not null default now(),
  next_pos int not null default 1,
  last_sent_at timestamptz,
  status text not null default 'actif' check (status in ('actif', 'fini', 'stop')),
  stop_reason text,
  unique (lead_id, seq)
);

create table if not exists public.mail_out (
  id bigserial primary key,
  lead_id bigint not null references public.cand_leads (id) on delete cascade,
  step_id int not null references public.mail_steps (id) on delete cascade,
  variant text not null default 'A',
  due_at timestamptz not null,
  status text not null default 'attente' check (status in ('attente', 'envoye', 'annule')),
  sent_at timestamptz,
  clicked_at timestamptz,
  token uuid not null default gen_random_uuid(),
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (lead_id, step_id)
);
create index if not exists mail_out_due on public.mail_out (status, due_at);
create unique index if not exists mail_out_token on public.mail_out (token);

create table if not exists public.mail_ok (
  step_id int not null references public.mail_steps (id) on delete cascade,
  day date not null,
  ok_at timestamptz not null default now(),
  primary key (step_id, day)
);
create table if not exists public.mail_remind_sent (day date not null, slot text not null, primary key (day, slot));

alter table public.mail_settings enable row level security;
alter table public.mail_steps enable row level security;
alter table public.mail_enroll enable row level security;
alter table public.mail_out enable row level security;
alter table public.mail_ok enable row level security;
alter table public.mail_remind_sent enable row level security;
do $$ declare t text; begin
  foreach t in array array['mail_settings', 'mail_steps', 'mail_enroll', 'mail_out', 'mail_ok'] loop
    execute format('drop policy if exists "%1$s: équipe" on public.%1$s', t);
    execute format('create policy "%1$s: équipe" on public.%1$s for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.mail_steps_id_seq to authenticated;

-- Statistiques A/B : envois et clics sur la vidéo, par email et par objet.
create or replace view public.mail_stats_v with (security_invoker = true) as
select o.step_id, o.variant, count(*) filter (where o.status = 'envoye') as sent, count(*) filter (where o.clicked_at is not null) as clicked
  from public.mail_out o group by o.step_id, o.variant;
grant select on public.mail_stats_v to authenticated;

-- ───────── Aides ─────────
create or replace function private.mail_window(t timestamptz) returns timestamptz
language plpgsql immutable set search_path = public as $$
declare p timestamp := t at time zone 'Europe/Paris'; h int := extract(hour from t at time zone 'Europe/Paris')::int;
begin
  if h >= 21 then return (date_trunc('day', p) + interval '1 day 9 hours') at time zone 'Europe/Paris'; end if;
  if h < 9 then return (date_trunc('day', p) + interval '9 hours') at time zone 'Europe/Paris'; end if;
  return t;
end $$;

-- Heure d'envoi prévue : « delay_h » après la base ; si une heure fixe est demandée, on tombe sur cette heure (jamais la nuit).
create or replace function private.mail_due(base timestamptz, delay_h numeric, at_hour int) returns timestamptz
language plpgsql stable set search_path = public as $$
declare d timestamptz;
begin
  if at_hour is not null then
    d := ((((base at time zone 'Europe/Paris')::date + round(delay_h / 24.0)::int)::timestamp + make_interval(hours => at_hour)) at time zone 'Europe/Paris');
    if d < base then d := d + interval '1 day'; end if;
    if d < now() then d := private.mail_window(now()); end if;
    return d;
  end if;
  return private.mail_window(greatest(base + make_interval(secs => (delay_h * 3600)::int), now()));
end $$;

create or replace function private.mail_lead_ok(l public.cand_leads) returns boolean
language sql stable set search_path = public as $$
  select coalesce(l.email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and l.consent_at is not null and l.unsub_at is null
     and not private.geo_blocked(coalesce(l.phone, l.phone_raw)) and l.sid !~ '^(imp|man|cand)-' and coalesce(l.follow, 'new') <> 'skip'
$$;

create or replace function private.mail_has_cand(em text, sts text[]) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.candidatures c where lower(c.email) = lower(em) and c.status = any (sts))
$$;

create or replace function private.mail_build(st public.mail_steps, l public.cand_leads, o public.mail_out) returns jsonb
language plpgsql stable set search_path = public, private as $$
declare nm text := coalesce(nullif(trim(l.first_name), ''), 'Hello'); esc text; sub text; vid text; rdv text; r text; html text;
begin
  sub := replace(case when o.variant = 'B' and coalesce(st.subject_b, '') <> '' then st.subject_b else st.subject_a end, '{prenom}', nm);
  esc := replace(replace(replace(st.body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  vid := '<a href="https://rdv.theambitiousman.fr/v/' || o.token || '" style="display:inline-block;background:#e0211f;color:#ffffff;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">▶ Regarder la vidéo</a>';
  rdv := '<a href="https://rdv.theambitiousman.fr/?utm_source=email&utm_campaign=' || st.seq || '">rdv.theambitiousman.fr</a>';
  r := replace(replace(replace(esc, '{prenom}', replace(replace(replace(nm, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')), '{video}', vid), '{rdv}', rdv);
  r := replace(r, E'\n', '<br>');
  html := '<div style="font-size:15px;line-height:1.55;color:#222">' || r
    || '<div style="margin-top:26px;font-size:12px;color:#888">Tu reçois cet email parce que tu as commencé une candidature chez L''Accélérateur. <a href="https://rdv.theambitiousman.fr/stop/' || l.unsub_token || '" style="color:#888">Me désinscrire</a></div></div>';
  return jsonb_build_object('subject', sub, 'html', html);
end $$;

-- Notification pour Clément : push + email.
create or replace function private.mail_tell_me(title text, body_html text, push_body text) returns void
language plpgsql security definer set search_path = public, private as $$
declare em text := coalesce((select booking_email from public.settings limit 1), 'contact@theambitiousman.fr');
begin
  perform private.notify_calio(title, push_body, '/admin');
  perform private.send_email(em, title, '<div style="font-size:15px;line-height:1.55;color:#222">' || body_html || '<p><a href="https://rdv.theambitiousman.fr/admin" style="display:inline-block;background:#e9c53e;color:#0b0b0c;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">Ouvrir Calio</a></p></div>', 'Calio');
exception when others then null;
end $$;

-- ───────── Moteur : toutes les 5 minutes ─────────
create or replace function public.mail_tick() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.mail_settings; l public.cand_leads; e public.mail_enroll; st public.mail_steps; o public.mail_out; n int := 0; h int;
  nxt int; v text; due timestamptz; lastsent timestamptz; b jsonb; na int; nb int;
begin
  select * into s from public.mail_settings where id = 1;
  if s.mode = 'pause' then return 0; end if;
  h := extract(hour from now() at time zone 'Europe/Paris')::int;

  -- 0. Arrêts : désinscrit ou appel déjà fait = fin ; rendez-vous en cours = on attend.
  update public.mail_enroll x set status = 'stop', stop_reason = 'désinscrit' where x.status = 'actif' and exists (select 1 from public.cand_leads c where c.id = x.lead_id and c.unsub_at is not null);
  update public.mail_enroll x set status = 'stop', stop_reason = 'appel fait' where x.status = 'actif' and exists (select 1 from public.cand_leads c where c.id = x.lead_id and private.mail_has_cand(c.email, array['fait']));
  update public.mail_out x set status = 'annule' where x.status = 'attente' and exists (
    select 1 from public.cand_leads c where c.id = x.lead_id and (c.unsub_at is not null or not private.mail_lead_ok(c) or private.mail_has_cand(c.email, array['reserve', 'confirme', 'fait'])));

  -- 1. Inscriptions
  insert into public.mail_enroll (lead_id, seq)
  select c.id, 'noshow' from public.cand_leads c
   where private.mail_lead_ok(c) and private.mail_has_cand(c.email, array['absent']) and not private.mail_has_cand(c.email, array['reserve', 'confirme', 'fait'])
     and exists (select 1 from public.candidatures k where lower(k.email) = lower(c.email) and k.status = 'absent' and k.starts_at > now() - interval '10 days')
  on conflict do nothing;
  insert into public.mail_enroll (lead_id, seq)
  select c.id, case when c.step = 'who' then 'contact' else 'partial' end from public.cand_leads c
   where private.mail_lead_ok(c) and not c.booked and c.step in ('who', 'situ') and c.updated_at <= now() - interval '30 minutes'
     and not private.mail_has_cand(c.email, array['reserve', 'confirme', 'fait', 'absent'])
     and not exists (select 1 from public.mail_enroll x where x.lead_id = c.id)
  on conflict do nothing;
  -- Sans petite séquence adaptée (budget trop bas, date de budget donnée, relances terminées) ou petite séquence épuisée : séquence 30 jours.
  insert into public.mail_enroll (lead_id, seq)
  select c.id, 'nurture' from public.cand_leads c
   where private.mail_lead_ok(c) and not private.mail_has_cand(c.email, array['reserve', 'confirme', 'fait', 'absent'])
     and not exists (select 1 from public.mail_enroll x where x.lead_id = c.id and x.seq = 'nurture')
     and not exists (select 1 from public.mail_enroll x where x.lead_id = c.id and x.status = 'actif')
     and (
       exists (select 1 from public.mail_enroll x where x.lead_id = c.id and x.status = 'fini')
       or (not c.booked and c.updated_at <= now() - interval '24 hours' and c.step in ('budget', 'slot') and (
             c.budget_date is not null or coalesce(c.capital, '') = 'lt500' or coalesce(c.budget_confirmed, '') in ('soon', 'no')))
       or (not c.booked and c.auto_sent_at is not null and c.budget_date is null
           and coalesce(array_length(c.rseq_sent, 1), 0) >= (select count(*) from public.cand_rseq r where r.active)
           and coalesce((c.mail_log -> -1 ->> 'at')::timestamptz, c.auto_sent_at) <= now() - interval '24 hours')
     )
  on conflict do nothing;

  -- 2. Planification du prochain email de chaque personne
  for e in select * from public.mail_enroll x where x.status = 'actif' order by x.started_at loop
    select * into l from public.cand_leads where id = e.lead_id;
    continue when not private.mail_lead_ok(l);
    continue when private.mail_has_cand(l.email, array['reserve', 'confirme']);
    continue when e.seq = 'nurture' and exists (select 1 from public.mail_enroll x where x.lead_id = e.lead_id and x.seq <> 'nurture' and x.status = 'actif');
    continue when exists (select 1 from public.mail_out q where q.lead_id = e.lead_id and q.status = 'attente');
    select * into st from public.mail_steps t where t.seq = e.seq and t.active and t.pos >= e.next_pos order by t.pos limit 1;
    if not found then update public.mail_enroll set status = 'fini' where id = e.id; continue; end if;
    due := private.mail_due(coalesce(e.last_sent_at, e.started_at), st.delay_h, st.at_hour);
    lastsent := coalesce(greatest(e.last_sent_at, (select max(q.sent_at) from public.mail_out q where q.lead_id = e.lead_id),
                 (select max((m ->> 'at')::timestamptz) from jsonb_array_elements(l.mail_log) m)), 'epoch'::timestamptz);
    if due < lastsent + interval '20 hours' then due := private.mail_due(lastsent + interval '20 hours', 0, st.at_hour); end if;
    select count(*) filter (where variant = 'A'), count(*) filter (where variant = 'B') into na, nb from public.mail_out q where q.step_id = st.id;
    v := case when coalesce(st.subject_b, '') = '' then 'A' when st.winner is not null then st.winner when na <= nb then 'A' else 'B' end;
    insert into public.mail_out (lead_id, step_id, variant, due_at) values (l.id, st.id, v, due)
    on conflict (lead_id, step_id) do update set status = 'attente', due_at = excluded.due_at, notified = false where public.mail_out.status = 'annule';
  end loop;

  -- 3. Envoi : seulement entre 9 h et 21 h, et seulement ce qui est validé pendant la période de validation
  if h >= 9 and h < 21 then
    for o in select * from public.mail_out q where q.status = 'attente' and q.due_at <= now() order by q.due_at limit 30 loop
      select * into st from public.mail_steps where id = o.step_id;
      select * into l from public.cand_leads where id = o.lead_id;
      continue when not st.active or not private.mail_lead_ok(l);
      if s.mode = 'validation' and not exists (select 1 from public.mail_ok k where k.step_id = o.step_id and k.day = (o.due_at at time zone 'Europe/Paris')::date) then
        if not o.notified then
          perform private.mail_tell_me('Un email attend ton accord', 'L''email « <b>' || replace(st.label, '<', '&lt;') || '</b> » devait partir maintenant. Il ne partira pas tant que tu ne l''as pas validé dans Calio.', 'À valider : ' || st.label);
          update public.mail_out set notified = true where id = o.id;
        end if;
        if o.due_at < now() - interval '4 hours' then update public.mail_out set due_at = private.mail_due(o.due_at + interval '1 day', 0, st.at_hour), notified = false where id = o.id; end if;
        continue;
      end if;
      b := private.mail_build(st, l, o);
      perform private.send_email(l.email, b ->> 'subject', b ->> 'html', 'Clément');
      update public.mail_out set status = 'envoye', sent_at = now() where id = o.id;
      update public.mail_enroll set next_pos = st.pos + 1, last_sent_at = now() where lead_id = o.lead_id and seq = st.seq;
      update public.cand_leads set mail_log = mail_log || jsonb_build_array(jsonb_build_object('k', 'mseq', 'label', st.label, 'subject', b ->> 'subject', 'at', now())) where id = o.lead_id;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.mail_tick() from public, anon, authenticated;

-- ───────── Rappels de validation ─────────
create or replace function public.mail_remind() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.mail_settings; h int := extract(hour from now() at time zone 'Europe/Paris')::int; today date := (now() at time zone 'Europe/Paris')::date;
  tgt date; sl text; r record; html text := ''; cnt int := 0; hrs int[]; i int; lab text; tot int := 0;
begin
  select * into s from public.mail_settings where id = 1;
  if s.mode <> 'validation' then return 0; end if;
  -- La veille : 10 h, 15 h, 19 h. Le jour même : 9 h, 13 h, 16 h.
  for i in 1..6 loop
    tgt := case when i <= 3 then today + 1 else today end;
    hrs := case when i <= 3 then array[10, 15, 19] else array[9, 13, 16] end;
    sl := case when i <= 3 then 'veille-' || hrs[i] else 'jour-' || hrs[i - 3] end;
    continue when h <> case when i <= 3 then hrs[i] else hrs[i - 3] end;
    continue when exists (select 1 from public.mail_remind_sent where day = tgt and slot = sl);
    html := ''; cnt := 0;
    for r in select t.id, t.label, t.subject_a, count(*) as n from public.mail_out q join public.mail_steps t on t.id = q.step_id
              where q.status = 'attente' and (q.due_at at time zone 'Europe/Paris')::date = tgt
                and not exists (select 1 from public.mail_ok k where k.step_id = t.id and k.day = tgt)
              group by t.id, t.label, t.subject_a order by t.id loop
      html := html || '<p><b>' || replace(r.label, '<', '&lt;') || '</b> · ' || r.n || ' personne(s)<br><i>' || replace(r.subject_a, '<', '&lt;') || '</i></p>';
      cnt := cnt + 1;
    end loop;
    continue when cnt = 0;
    insert into public.mail_remind_sent (day, slot) values (tgt, sl) on conflict do nothing;
    lab := case when tgt = today then 'aujourd''hui' else 'demain' end;
    perform private.mail_tell_me('À valider : ' || cnt || ' email(s) pour ' || lab,
      '<p>Rien ne part sans ton accord. Voici ce qui est prévu ' || lab || ' :</p>' || html || '<p>Ouvre Calio, onglet Relances, puis « Emails automatiques ». Lis, corrige si besoin, puis touche « Valider ».</p>',
      cnt || ' email(s) prévu(s) ' || lab || ' : ouvre Calio pour les valider');
    tot := tot + 1;
  end loop;
  -- Fin de la période de validation
  if now() >= s.control_until and h = 10 and not exists (select 1 from public.mail_remind_sent where day = today and slot = 'fin') then
    insert into public.mail_remind_sent (day, slot) values (today, 'fin') on conflict do nothing;
    perform private.mail_tell_me('30 jours de validation terminés', '<p>La période de validation est finie. Si tout te convient, passe les emails en automatique dans Calio (Relances, « Emails automatiques »). Sinon, on continue à valider.</p>', 'Période de validation terminée : passer en automatique ?');
  end if;
  return coalesce(tot, 0);
end $$;
revoke all on function public.mail_remind() from public, anon, authenticated;

-- ───────── Gagnant des tests A/B : le meilleur taux de clic, au moins 30 envois par objet ─────────
create or replace function public.mail_ab() returns int
language plpgsql security definer set search_path = public, private as $$
declare r record; n int := 0;
begin
  for r in select a.step_id, case when (a.clicked::numeric / a.sent) >= (b.clicked::numeric / b.sent) then 'A' else 'B' end as w,
                  abs(a.clicked::numeric / a.sent - b.clicked::numeric / b.sent) as diff
             from public.mail_stats_v a join public.mail_stats_v b on a.step_id = b.step_id and a.variant = 'A' and b.variant = 'B'
             join public.mail_steps t on t.id = a.step_id and t.winner is null
            where a.sent >= 30 and b.sent >= 30 loop
    if r.diff >= 0.03 then update public.mail_steps set winner = r.w where id = r.step_id; n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.mail_ab() from public, anon, authenticated;

-- ───────── Public : désinscription et clic sur la vidéo ─────────
create or replace function public.mail_unsub(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare lid bigint;
begin
  update public.cand_leads set unsub_at = coalesce(unsub_at, now()) where unsub_token = p_token returning id into lid;
  if lid is null then return false; end if;
  update public.mail_enroll set status = 'stop', stop_reason = 'désinscrit' where lead_id = lid and status = 'actif';
  update public.mail_out set status = 'annule' where lead_id = lid and status = 'attente';
  return true;
end $$;
grant execute on function public.mail_unsub(uuid) to anon, authenticated;

create or replace function public.mail_click(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare vid text;
begin
  update public.mail_out o set clicked_at = coalesce(o.clicked_at, now()) where o.token = p_token;
  select t.video_id into vid from public.mail_out o join public.mail_steps t on t.id = o.step_id where o.token = p_token;
  return case when vid is null then 'https://www.youtube.com/@theambitiousman' else 'https://www.youtube.com/watch?v=' || vid end;
end $$;
grant execute on function public.mail_click(uuid) to anon, authenticated;

do $$ begin perform cron.unschedule('mail-tick'); exception when others then null; end $$;
select cron.schedule('mail-tick', '*/5 * * * *', 'select public.mail_tick()');
do $$ begin perform cron.unschedule('mail-remind'); exception when others then null; end $$;
select cron.schedule('mail-remind', '5,35 * * * *', 'select public.mail_remind()');
do $$ begin perform cron.unschedule('mail-ab'); exception when others then null; end $$;
select cron.schedule('mail-ab', '10 4 * * *', 'select public.mail_ab()');

-- L'autorisation de recevoir des emails (phrase sous « Continuer ») est enregistrée avec la fiche.
create or replace function public.cand_lead(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sid text := left(coalesce(p ->> 'sid', ''), 64);
  em_raw text := left(trim(coalesce(p ->> 'email', '')), 120);
  ph_raw text := left(trim(coalesce(p ->> 'phone_raw', p ->> 'phone', '')), 40);
  em text := lower(em_raw);
  ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  nm text := left(trim(coalesce(p ->> 'first_name', '')), 80);
  st text := coalesce(p ->> 'step', 'who');
  src text := left(trim(coalesce(p ->> 'source', '')), 60);
  ref text := left(trim(coalesce(p ->> 'referrer', '')), 200);
  lnd text := left(trim(coalesce(p ->> 'landing', '')), 200);
  ut jsonb := case when jsonb_typeof(p -> 'utm') = 'object' then p -> 'utm' else null end;
  lid bigint;
  ranks text[] := array['who', 'situ', 'budget', 'slot'];
begin
  if length(v_sid) < 8 then return; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then em := ''; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then ph := ''; end if;
  if nm = '' and em_raw = '' and length(regexp_replace(ph_raw, '\D', '', 'g')) = 0 then return; end if;
  if not (st = any (ranks)) then st := 'who'; end if;

  select id into lid from public.cand_leads
   where sid = v_sid or (em <> '' and lower(email) = em) or (ph <> '' and phone = ph)
   order by (sid = v_sid) desc, updated_at desc limit 1;

  if lid is null then
    insert into public.cand_leads (sid, first_name, phone, email, phone_raw, email_raw, situation, capital, budget_confirmed, step, source, referrer, landing, utm, experience, blocage, invest, consent_at)
    values (v_sid, nullif(nm, ''), nullif(ph, ''), nullif(em, ''), nullif(ph_raw, ''), nullif(em_raw, ''),
            nullif(left(p ->> 'situation', 40), ''), nullif(left(p ->> 'capital', 20), ''), nullif(left(p ->> 'budget_confirmed', 10), ''), st,
            nullif(src, ''), nullif(ref, ''), nullif(lnd, ''), ut,
            nullif(left(p ->> 'experience', 40), ''), nullif(left(p ->> 'blocage', 2000), ''), nullif(left(p ->> 'invest', 40), ''), case when p ->> 'consent' = '1' then now() end);
  else
    update public.cand_leads l set
      updated_at = now(),
      first_name = coalesce(nullif(nm, ''), l.first_name),
      phone = coalesce(nullif(ph, ''), l.phone),
      email = coalesce(nullif(em, ''), l.email),
      phone_raw = coalesce(nullif(ph_raw, ''), l.phone_raw),
      email_raw = coalesce(nullif(em_raw, ''), l.email_raw),
      situation = coalesce(nullif(left(p ->> 'situation', 40), ''), l.situation),
      capital = coalesce(nullif(left(p ->> 'capital', 20), ''), l.capital),
      budget_confirmed = coalesce(nullif(left(p ->> 'budget_confirmed', 10), ''), l.budget_confirmed),
      experience = coalesce(nullif(left(p ->> 'experience', 40), ''), l.experience),
      blocage = coalesce(nullif(left(p ->> 'blocage', 2000), ''), l.blocage),
      invest = coalesce(nullif(left(p ->> 'invest', 40), ''), l.invest),
      consent_at = coalesce(l.consent_at, case when p ->> 'consent' = '1' then now() end),
      source = coalesce(l.source, nullif(src, '')),
      referrer = coalesce(l.referrer, nullif(ref, '')),
      landing = coalesce(l.landing, nullif(lnd, '')),
      utm = coalesce(l.utm, ut),
      step = case when array_position(ranks, st) > array_position(ranks, l.step) then st else l.step end
    where l.id = lid;
  end if;
end $$;
grant execute on function public.cand_lead(jsonb) to anon, authenticated;

-- ───────── Emails de départ (tous modifiables dans Calio) ─────────
insert into public.mail_steps (seq, pos, label, delay_h, at_hour, subject_a, subject_b, body, video_id, video_title) values
  ($b$contact$b$, 1, $b$Bienvenue · qui je suis$b$, 1, null, $b${prenom}, tu as commencé, voici qui je suis$b$, $b$Avant de continuer, regarde ça (11 min)$b$, $b$Salut {prenom},

C'est Clément. Tu as commencé à remplir ma candidature, et je ne sais pas encore si E-Connect est fait pour toi. C'est normal : peu de gens connaissent ce modèle.

J'ai tout expliqué dans cette vidéo de 11 minutes : comment ça marche, pourquoi la livraison se fait en 24-48 h, et pourquoi il y a peu de concurrence.

{video}

Quand tu l'auras vue, tu pourras finir ta candidature ici : {rdv}

Clément$b$, $b$F5u08WW4I5A$b$, $b$E-Connect : Le Business en Ligne Que Personne Ne Connaît$b$),
  ($b$contact$b$, 2, $b$La peur du stock$b$, 24, 18, $b$La question qu'on me pose tout le temps$b$, $b$Et si je dois commander du stock ?$b$, $b$Salut {prenom},

Hier, je t'ai montré ce qu'est E-Connect. Aujourd'hui, je réponds à la question qu'on me pose le plus : « Et si j'achète du stock et que ça ne se vend pas ? »

Je ne commande jamais de stock avant d'avoir validé les chiffres avec des tests. Le stock vient après, pas avant. Rien n'est garanti en e-commerce, mais tu ne prends pas de décision à l'aveugle.

{video}

Dans deux jours, je te montre quelqu'un qui l'a fait.

Clément

P.-S. Si tu veux finir ta candidature : {rdv}$b$, $b$HYw80zutipU$b$, $b$Pourquoi Commander du Stock n'est pas Risqué en E-Connect$b$),
  ($b$contact$b$, 3, $b$Un exemple concret$b$, 48, 18, $b$Ce qu'Issa a fait pendant 40 jours$b$, $b$40 jours dans l'accélérateur : ce qui s'est passé$b$, $b$Salut {prenom},

Tu as vu ce qu'est E-Connect et comment je gère le risque du stock. Maintenant, un exemple concret : Issa, 40 jours après son entrée dans l'accélérateur.

Je ne te montre pas des chiffres magiques. Je te montre ce qu'il a fait, semaine après semaine.

{video}

Si tu te reconnais dans son histoire, ta candidature t'attend ici : {rdv}

Clément$b$, $b$VWBhzjocYds$b$, $b$Résultats de Issa après 40 jours dans l'accélérateur$b$),
  ($b$partial$b$, 1, $b$Candidature restée en route$b$, 2, null, $b${prenom}, ta candidature est restée en route$b$, $b$Il te reste une minute pour finir$b$, $b$Salut {prenom},

Tu as commencé ta candidature et elle est restée en route. Si quelque chose t'a bloqué (une question, un doute), réponds simplement à cet email : je te lis.

Sinon, tu peux la terminer ici en une minute : {rdv}

Clément$b$, null, null),
  ($b$partial$b$, 2, $b$Une question avant de finir$b$, 24, 18, $b$Une question avant de finir ?$b$, $b$Qu'est-ce qui t'a freiné ?$b$, $b$Salut {prenom},

Beaucoup de gens s'arrêtent avant la fin, et c'est presque toujours pour la même raison : un doute. Le temps ? Le risque ? Ne pas savoir par où commencer ?

Réponds-moi en une ligne, je te dis honnêtement ce que j'en pense.

Et si tu veux d'abord comprendre le modèle, voici ma vidéo de présentation :

{video}

Clément$b$, $b$F5u08WW4I5A$b$, $b$E-Connect : Le Business en Ligne Que Personne Ne Connaît$b$),
  ($b$partial$b$, 3, $b$Dernier rappel$b$, 72, 18, $b$Dernier rappel pour ta candidature$b$, $b${prenom}, je range ta candidature ?$b$, $b$Salut {prenom},

C'est mon dernier message sur ta candidature. Si tu veux la terminer, c'est ici : {rdv}

Sinon, je t'enverrai de temps en temps des vidéos de ma chaîne YouTube. Tu peux te désinscrire quand tu veux, en bas de chaque email.

Clément$b$, null, null),
  ($b$noshow$b$, 1, $b$On s'est ratés$b$, 1, null, $b${prenom}, on s'est ratés$b$, $b$Tout va bien ? On devait s'appeler$b$, $b$Salut {prenom},

On devait s'appeler et je ne t'ai pas eu au téléphone. Ce n'est pas grave, ça arrive.

Si tu veux toujours en parler, tu peux reprendre un créneau ici : {rdv}

Et si quelque chose a changé de ton côté, dis-le-moi simplement en répondant à cet email.

Clément$b$, null, null),
  ($b$noshow$b$, 2, $b$On reprogramme$b$, 24, 18, $b$Je te garde un créneau cette semaine ?$b$, $b${prenom}, on reprogramme l'appel ?$b$, $b$Salut {prenom},

Je reviens vers toi pour notre appel manqué. Je préfère être clair : cet appel sert à voir si E-Connect est adapté à ta situation, rien de plus. Pas de pression.

Voici le lien pour reprendre un créneau : {rdv}

Clément$b$, null, null),
  ($b$noshow$b$, 3, $b$Porte ouverte$b$, 72, 18, $b$Dernier message pour cet appel$b$, $b${prenom}, je laisse la porte ouverte$b$, $b$Salut {prenom},

Dernier message pour notre appel. Si ce n'est pas le bon moment, aucun souci : tu peux revenir quand tu veux.

En attendant, je vais t'envoyer quelques vidéos pour que tu voies comment je travaille. Tu peux te désinscrire à tout moment, en bas de chaque email.

Pour reprendre un créneau : {rdv}

Clément$b$, null, null),
  ($b$nurture$b$, 1, $b$J1 · Chapitre 1 · Ma première perte$b$, 24, 18, $b$Ma première perte, en 2023$b$, $b$J'ai essayé le dropshipping en 2023$b$, $b$Salut {prenom},

Je commence par une histoire : la mienne.

En 2023, j'ai lancé du dropshipping en pensant que ça allait marcher vite. Ça n'a pas marché. Dans cette vidéo, je te montre les résultats, sans filtre. Elle est courte.

{video}

Dans deux jours, je te raconte ce que j'ai compris en perdant.

Clément$b$, $b$etrYv1xTe9c$b$, $b$J'ai essayé le dropshipping en 2023, voici les résultats$b$),
  ($b$nurture$b$, 2, $b$J3 · Chapitre 1 · Ce que j'ai compris$b$, 48, 18, $b$Ce que j'ai compris en perdant$b$, $b$La phrase qui m'a fait avancer$b$, $b$Salut {prenom},

Perdre de l'argent au début, personne n'aime ça. Pourtant, c'est ce qui m'a le plus appris.

Cette vidéo ne dure qu'une minute. Elle explique pourquoi j'ai arrêté de chercher la méthode parfaite et pourquoi j'ai commencé à accepter de perdre un peu pour avancer.

{video}

Dans deux jours : le jour où j'ai tout arrêté.

Clément$b$, $b$kINnJ322lAE$b$, $b$accepte de perdre pour réussir$b$),
  ($b$nurture$b$, 3, $b$J5 · Chapitre 1 · Le jour où j'ai arrêté$b$, 48, 18, $b$Le jour où j'ai arrêté le dropshipping classique$b$, $b$Pourquoi j'ai changé de direction$b$, $b$Salut {prenom},

À un moment, j'ai compris que je faisais comme tout le monde, et que ça ne menait nulle part. J'ai arrêté le dropshipping classique.

Je t'explique pourquoi, et ce que j'ai fait à la place :

{video}

Dans deux jours, je te montre ce que ce nouveau choix a changé.

Clément$b$, $b$_QOn8Yae0cc$b$, $b$Pourquoi j'ai décidé d'arrêter le dropshipping classique$b$),
  ($b$nurture$b$, 4, $b$J7 · Chapitre 1 · Ce que je fais à la place$b$, 48, 18, $b$Le dropshipping classique, c'est fini$b$, $b$Voici ce que je fais à la place en 2026$b$, $b$Salut {prenom},

Tu te souviens de mon histoire ? Voici la suite : ce que je fais aujourd'hui à la place du dropshipping classique.

Pas de promesse magique. Un modèle différent, avec une livraison rapide et moins de concurrence.

{video}

Dans deux jours : si je devais tout recommencer de zéro.

Clément$b$, $b$bnZzWnZIsPs$b$, $b$Le Dropshipping Est MORT. Voici Ce Que Je Fais à la Place en 2026$b$),
  ($b$nurture$b$, 5, $b$J9 · Chapitre 2 · Si je recommençais$b$, 48, 18, $b$Si je recommençais de zéro en 2026$b$, $b$Ce que je ferais à ta place$b$, $b$Salut {prenom},

Imagine que je n'aie plus rien : pas de boutique, pas d'audience, pas d'expérience. Qu'est-ce que je ferais en premier ?

C'est exactement le sujet de cette vidéo. Je te dis ce que je ferais, dans l'ordre.

{video}

Clément

P.-S. Si tu veux qu'on regarde ta situation ensemble : {rdv}$b$, $b$qAq43rMH3uo$b$, $b$Si je devais recommencer l'e-commerce de zéro en 2026$b$),
  ($b$nurture$b$, 6, $b$J11 · Chapitre 2 · Le plan dans l'ordre$b$, 48, 18, $b$Par quoi commencer, dans l'ordre$b$, $b$Tu tournes en rond ? Voici l'ordre à suivre$b$, $b$Salut {prenom},

La plupart des gens ne manquent pas d'idées. Ils manquent d'un ordre. Ils font la publicité avant le produit, le produit avant le test, et ils perdent du temps.

Dans cette vidéo, je te montre le plan à suivre, étape par étape.

{video}

Dans deux jours : ce qui fait qu'une publicité fonctionne.

Clément$b$, $b$l5HbS9e0yFg$b$, $b$Le Plan à SUIVRE pour Réussir en E-commerce$b$),
  ($b$nurture$b$, 7, $b$J13 · Chapitre 2 · La publicité$b$, 48, 18, $b$Une bonne publicité, ça ressemble à quoi ?$b$, $b$Les créatives : ce qui change tout$b$, $b$Salut {prenom},

Une bonne publicité ne se voit pas à sa qualité d'image. Elle se voit au fait qu'on a envie d'en savoir plus.

Je te montre comment je construis mes créatives, pas à pas :

{video}

Clément

P.-S. Quand tu te sens prêt à en parler : {rdv}$b$, $b$sWGoiRoiuqc$b$, $b$Comment faire de bonnes créatives en 2024$b$),
  ($b$nurture$b$, 8, $b$J15 · Chapitre 3 · Les élèves : Meryeme$b$, 48, 18, $b$Elle avait les mêmes doutes que toi$b$, $b$Les doutes de Meryeme avant de se lancer$b$, $b$Salut {prenom},

Jusqu'ici, je t'ai parlé de moi. Maintenant, place aux élèves.

Meryeme avait les mêmes doutes que toi : est-ce que c'est pour moi, est-ce que je vais y arriver ? Elle raconte ce qu'elle a fait.

{video}

Dans deux jours : quelqu'un qui n'a que deux heures par jour.

Clément$b$, $b$iu0DjBCAyxs$b$, $b$Retours témoignage Meryeme$b$),
  ($b$nurture$b$, 9, $b$J17 · Chapitre 3 · Les élèves : le temps$b$, 48, 18, $b$Combien de temps ça prend vraiment ?$b$, $b$2 heures par jour, ça suffit ?$b$, $b$Salut {prenom},

« Je n'ai pas le temps. » C'est la phrase que j'entends le plus.

Koudjedji a avancé en y consacrant environ 2 heures par jour. Dans la vidéo, il explique comment il s'organise.

{video}

Clément$b$, $b$FOttgqg1scQ$b$, $b$Comment Koudjedji à générer +2300€ net avec 2h par jours$b$),
  ($b$nurture$b$, 10, $b$J19 · Chapitre 3 · Les élèves : à côté du CDI$b$, 48, 18, $b$Le faire à côté de ton travail$b$, $b$Il a un CDI et il s'est lancé quand même$b$, $b$Salut {prenom},

Tu as un travail, et tu te demandes si tu peux te lancer sans tout quitter ? Beaucoup d'élèves sont dans ton cas.

Celui de cette vidéo s'est lancé à côté de son CDI. Je te laisse regarder comment il a fait.

{video}

Clément

P.-S. Pour qu'on en parle : {rdv}$b$, $b$_ms0EjrimCs$b$, $b$Il est passé de 0 à 2784€ de bénéfice avec le E-connect à côté de son CDI$b$),
  ($b$nurture$b$, 11, $b$J21 · Chapitre 3 · Les élèves : 23 ans$b$, 48, 18, $b$Il avait 23 ans et pas d'expérience$b$, $b$À 23 ans, 45 jours pour se lancer$b$, $b$Salut {prenom},

Dernier témoignage de cette série. Celui-ci a 23 ans, aucune expérience, et un doute énorme au départ.

Regarde ce qu'il a mis en place en 45 jours :

{video}

Dans deux jours, on passe à la pratique.

Clément$b$, $b$9Q69OkBQlyY$b$, $b$De 0 à 1800€ net en 45 jours d'E-commerce à 23 ans$b$),
  ($b$nurture$b$, 12, $b$J23 · Chapitre 4 · Ta première campagne$b$, 48, 18, $b$Lancer une campagne en 5 minutes$b$, $b$Ta première campagne Facebook, pas à pas$b$, $b$Salut {prenom},

On passe à la pratique. Lancer une campagne publicitaire fait peur, alors qu'on peut la mettre en place en quelques minutes.

Je te montre comment je m'y prends :

{video}

Dans deux jours : le fournisseur.

Clément$b$, $b$R5km-g7z4nc$b$, $b$Comment lancer une Campagne Facebook Ads 2025 en 5 Minutes$b$),
  ($b$nurture$b$, 13, $b$J25 · Chapitre 4 · Ton fournisseur$b$, 48, 18, $b$Trouver un fournisseur sans te faire avoir$b$, $b$Ton fournisseur : les questions à poser$b$, $b$Salut {prenom},

Un mauvais fournisseur, et c'est tout le projet qui se complique. Voici comment je cherche, et les questions que je pose avant de m'engager.

{video}

Clément

P.-S. Si tu veux que je regarde ta situation avec toi : {rdv}$b$, $b$BMBgi-aS_eM$b$, $b$Comment trouver un fournisseur en dropshipping en 2025$b$),
  ($b$nurture$b$, 14, $b$J27 · Chapitre 4 · L'accompagnement$b$, 48, 18, $b$Comment se passe l'accompagnement 1-1$b$, $b$Ce que je fais avec toi, semaine après semaine$b$, $b$Salut {prenom},

Tu as vu comment je pense, comment je travaille et ce que font les élèves. Reste une question : comment se passe concrètement l'accompagnement ?

Cette vidéo le montre, avec l'exemple d'un élève :

{video}

Dans deux jours : la question des objectifs.

Clément$b$, $b$OsUzPk84x5s$b$, $b$7000€ de bénéfice le 2ème mois avec mon accompagnement 1-1 en E-connect$b$),
  ($b$nurture$b$, 15, $b$J29 · Chapitre 4 · Les objectifs$b$, 48, 18, $b$Comment je vois les 2 000 à 5 000 € par mois$b$, $b$Un objectif réaliste en E-Connect ?$b$, $b$Salut {prenom},

Je te dois de la clarté sur les objectifs. Je ne te promets aucun résultat : ça dépend de ton travail, de ton produit, de ton marché.

Dans cette vidéo, je t'explique comment je raisonne quand on parle de 2 000 à 5 000 € par mois.

{video}

Demain, c'est mon dernier email de cette série.

Clément$b$, $b$_owYS81Ohj0$b$, $b$Comment générer 2k€-5k€/mois avec le Econnect (copie-moi)$b$),
  ($b$nurture$b$, 16, $b$J30 · Chapitre 5 · La suite$b$, 24, 18, $b$Je termine cette série d'emails$b$, $b${prenom}, ta place est toujours là$b$, $b$Salut {prenom},

C'est le dernier email de cette série. En 30 jours, je t'ai raconté mon histoire, celle de mes élèves, et ma façon de travailler.

Si tu veux savoir si E-Connect est fait pour toi, le plus simple est d'en parler ensemble : {rdv}

C'est un appel pour voir ta situation, rien de plus. Et si ce n'est pas le bon moment, tu peux continuer à regarder mes vidéos sur YouTube.

Merci d'avoir pris le temps de me lire.

Clément$b$, null, null)
on conflict (seq, pos) do nothing;
