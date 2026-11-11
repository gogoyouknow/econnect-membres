-- Relances 100 % automatiques par email : premier email (déjà en place) + emails de suivi J+1 / J+3 / J+7, et la séquence « Plus tard » envoyée par email.
-- Tout est tracé dans cand_leads.mail_log (visible dans Calio → Relances).

alter table public.cand_leads
  add column if not exists mail_log jsonb not null default '[]'::jsonb,
  add column if not exists rseq_sent int[] not null default '{}';
alter table public.cand_seq add column if not exists subject text;
update public.cand_seq set subject = case pos when 1 then '{prenom}, ton budget approche' when 2 then '{prenom}, on réserve ton appel ?' else 'Dernier message, {prenom}' end where subject is null;

-- Emails de suivi (délai en heures après le tout premier email automatique).
create table if not exists public.cand_rseq (
  id serial primary key,
  pos int not null,
  label text not null,
  after_hours int not null default 24,
  subject text not null default '',
  body text not null default '',
  active boolean not null default true
);
alter table public.cand_rseq enable row level security;
drop policy if exists "cand_rseq: équipe" on public.cand_rseq;
create policy "cand_rseq: équipe" on public.cand_rseq for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.cand_rseq to authenticated;
grant usage, select on sequence public.cand_rseq_id_seq to authenticated;
insert into public.cand_rseq (pos, label, after_hours, subject, body, active)
select * from (values
  (1, 'Le lendemain', 24, '{prenom}, tu as eu un souci pour réserver ?',
   E'Salut {prenom},\n\nTu as commencé à réserver ton appel avec moi, sans aller au bout. Si quelque chose t''a bloqué (une question, un doute, un horaire qui ne va pas), dis-le-moi : je te réponds.\n\nVoici mes prochaines disponibilités :\n{creneaux}\n\nTu peux réserver ici : {lien}\n\nClément', true),
  (2, '3 jours après', 72, '{prenom}, je te garde une place ?',
   E'Salut {prenom},\n\nJe reviens vers toi une fois : mon agenda se remplit vite et je préfère garder mes appels pour les personnes qui veulent vraiment avancer.\n\nSi c''est toujours ton cas, voici les créneaux :\n{creneaux}\n\nRéserve ici : {lien}\n\nClément', true),
  (3, '7 jours après', 168, 'Dernier message, {prenom}',
   E'Salut {prenom},\n\nC''est mon dernier message pour ne pas te déranger. Si ce n''est pas le bon moment, aucun souci.\n\nSi tu veux qu''on se parle, tu peux réserver ici : {lien}\n\nClément', true)
) v(pos, label, after_hours, subject, body, active)
where not exists (select 1 from public.cand_rseq);

-- Heure de Paris (les emails de relance ne partent jamais la nuit)
create or replace function private.relance_hour() returns int language sql stable as $$ select extract(hour from now() at time zone 'Europe/Paris')::int $$;

-- Prochaines disponibilités (un créneau par jour, 4 jours max)
create or replace function private.relance_creneaux() returns text
language plpgsql stable security definer set search_path = public, private as $$
declare sl text;
begin
  with s1 as (select e::timestamptz as t from jsonb_array_elements_text(public.cand_slots()) e),
       d as (select distinct on ((t at time zone 'Europe/Paris')::date) t from s1 where t > now() + interval '2 hours'
              order by (t at time zone 'Europe/Paris')::date, t limit 4)
  select string_agg('• ' || private.fr_when(t), E'\n' order by t) into sl from d;
  return coalesce(sl, 'De nouveaux créneaux s''ouvrent chaque semaine.');
end $$;

-- Premier email automatique : maintenant pour tout le monde (30 derniers jours, y compris ceux d'avant), et la personne passe en « Relancé ».
create or replace function public.cand_relance_auto() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; l record; tpl text; sub text; n int := 0; wa text; creneaux text; txt text; h int;
begin
  select * into s from public.cand_settings where id = 1;
  if not s.auto_relance then return 0; end if;
  h := private.relance_hour();
  select body into tpl from public.cand_templates where key = 'mail_relance';
  select body into sub from public.cand_templates where key = 'mail_relance_sujet';
  if tpl is null then return 0; end if;
  creneaux := private.relance_creneaux();
  for l in
    select * from public.cand_leads x
     where not x.booked and x.auto_sent_at is null and x.follow = 'new' and coalesce(x.email, '') <> ''
       and x.sid !~ '^(imp|man|cand)-'
       and x.updated_at <= now() - make_interval(mins => s.auto_relance_min)
       and x.updated_at > now() - interval '30 days'
       and (h >= 8 and h < 21 or x.updated_at > now() - interval '3 hours')
       and not (coalesce(x.capital, '') = 'lt500' or coalesce(x.budget_confirmed, '') in ('soon', 'no'))
       and x.budget_date is null
       and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme', 'fait') and lower(c.email) = lower(x.email))
     order by x.updated_at limit 20
  loop
    wa := 'https://wa.me/' || s.wa_number || '?text=' || private.urlenc('Salut Clément, c''est ' || coalesce(l.first_name, '') || '. J''ai commencé à réserver un appel et j''aimerais en discuter.');
    txt := private.relance_fill(tpl, l.first_name, creneaux, wa);
    sub := replace(coalesce((select body from public.cand_templates where key = 'mail_relance_sujet'), '{prenom}, il reste des créneaux pour ton appel'), '{prenom}', coalesce(nullif(l.first_name, ''), 'Hello'));
    perform private.send_email(l.email, sub, '<div style="font-size:15px;line-height:1.55;color:#222">' || txt || '</div>', 'Clément');
    update public.cand_leads set auto_sent_at = now(), followed_at = now(), follow_count = follow_count + 1, follow = 'done', follow_channel = 'email-auto',
      mail_log = mail_log || jsonb_build_array(jsonb_build_object('k', 'auto', 'label', 'Premier email', 'subject', sub, 'at', now()))
     where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_relance_auto() from public, anon, authenticated;

-- Emails de suivi : J+1, J+3, J+7 après le premier email, tant que la personne n'a pas réservé / répondu / été écartée. Jamais la nuit.
create or replace function public.cand_rseq_run() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; l record; st public.cand_rseq; n int := 0; cr text; wa text; h int; txt text; sub text; last_at timestamptz;
begin
  select * into s from public.cand_settings where id = 1;
  if not s.auto_relance then return 0; end if;
  h := private.relance_hour();
  if h < 8 or h >= 21 then return 0; end if;
  cr := private.relance_creneaux();
  for l in
    select * from public.cand_leads x
     where not x.booked and x.auto_sent_at is not null and x.follow <> 'skip' and coalesce(x.follow_result, '') not in ('repondu', 'pas_interesse', 'reserve')
       and x.budget_date is null and coalesce(x.email, '') <> ''
       and not (coalesce(x.capital, '') = 'lt500' or coalesce(x.budget_confirmed, '') in ('soon', 'no'))
       and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme', 'fait') and lower(c.email) = lower(x.email))
     order by x.auto_sent_at limit 40
  loop
    select * into st from public.cand_rseq r where r.active and not (r.id = any (l.rseq_sent)) order by r.pos limit 1;
    continue when not found;
    continue when l.auto_sent_at + make_interval(hours => st.after_hours) > now();
    last_at := coalesce((l.mail_log -> -1 ->> 'at')::timestamptz, l.auto_sent_at);
    continue when last_at > now() - interval '20 hours';
    wa := 'https://wa.me/' || s.wa_number || '?text=' || private.urlenc('Salut Clément, c''est ' || coalesce(l.first_name, '') || '. J''aimerais en discuter.');
    txt := private.relance_fill(st.body, l.first_name, cr, wa);
    sub := replace(st.subject, '{prenom}', coalesce(nullif(l.first_name, ''), 'Hello'));
    perform private.send_email(l.email, sub, '<div style="font-size:15px;line-height:1.55;color:#222">' || txt || '</div>', 'Clément');
    update public.cand_leads set rseq_sent = array_append(rseq_sent, st.id), followed_at = now(), follow_count = follow_count + 1, follow = 'done', follow_channel = 'email-auto',
      mail_log = mail_log || jsonb_build_array(jsonb_build_object('k', 'rseq', 'label', st.label, 'subject', sub, 'at', now()))
     where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_rseq_run() from public, anon, authenticated;

-- Séquence « Plus tard » (date de budget donnée) : envoyée par email au bon jour, au lieu d'une tâche WhatsApp.
create or replace function public.cand_seq_mail_run() returns int
language plpgsql security definer set search_path = public, private as $$
declare l record; st public.cand_seq; n int := 0; h int; txt text; sub text; d date := (now() at time zone 'Europe/Paris')::date; last_at timestamptz; dt text;
begin
  h := private.relance_hour();
  if h < 8 or h >= 21 then return 0; end if;
  for l in
    select * from public.cand_leads x
     where not x.booked and x.follow <> 'skip' and x.budget_date is not null and coalesce(x.email, '') <> ''
       and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme', 'fait') and lower(c.email) = lower(x.email))
     order by x.budget_date limit 40
  loop
    select * into st from public.cand_seq q
     where not (q.pos = any (l.seq_sent)) and l.budget_date + q.offset_days <= d and l.budget_date + q.offset_days >= d - 5
     order by q.offset_days, q.pos limit 1;
    continue when not found;
    last_at := coalesce((l.mail_log -> -1 ->> 'at')::timestamptz, 'epoch'::timestamptz);
    continue when last_at > now() - interval '20 hours';
    dt := to_char(l.budget_date, 'FMDD') || ' ' || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from l.budget_date)::int];
    txt := replace(private.relance_fill(st.body, l.first_name, '', ''), '{date}', dt);
    sub := replace(replace(coalesce(nullif(st.subject, ''), '{prenom}, un petit message de Clément'), '{prenom}', coalesce(nullif(l.first_name, ''), 'Hello')), '{date}', dt);
    perform private.send_email(l.email, sub, '<div style="font-size:15px;line-height:1.55;color:#222">' || txt || '</div>', 'Clément');
    update public.cand_leads set seq_sent = array_append(seq_sent, st.pos), followed_at = now(), follow_count = follow_count + 1, follow = 'done', follow_channel = 'email-auto',
      mail_log = mail_log || jsonb_build_array(jsonb_build_object('k', 'seq', 'label', st.label, 'subject', sub, 'at', now()))
     where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_seq_mail_run() from public, anon, authenticated;

-- Ceux qui ont déjà reçu le premier email avant cette mise à jour : on les passe en « Relancé » et on remplit leur historique.
update public.cand_leads set follow = 'done', follow_channel = coalesce(follow_channel, 'email-auto'), followed_at = coalesce(followed_at, auto_sent_at),
  mail_log = jsonb_build_array(jsonb_build_object('k', 'auto', 'label', 'Premier email', 'subject', null, 'at', auto_sent_at))
 where auto_sent_at is not null and jsonb_array_length(mail_log) = 0;
update public.cand_leads set follow = 'done' where auto_sent_at is not null and follow = 'new';

do $$ begin perform cron.unschedule('cand-rseq'); exception when others then null; end $$;
select cron.schedule('cand-rseq', '*/10 * * * *', 'select public.cand_rseq_run()');
do $$ begin perform cron.unschedule('cand-seqmail'); exception when others then null; end $$;
select cron.schedule('cand-seqmail', '*/10 * * * *', 'select public.cand_seq_mail_run()');
