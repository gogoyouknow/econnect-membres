-- 0046 : (1) pas de double rendez-vous + « modifier mon rendez-vous » côté client,
--        (2) suivi des relances (qui, quand, par quel canal, résultat),
--        (3) messages modèles de relance (WhatsApp + email) modifiables,
--        (4) relance AUTOMATIQUE par email quelques minutes après un formulaire abandonné.

-- ───────── Format de date « mardi 11 novembre à 18h00 » (heure de Paris) ─────────
create or replace function private.fr_when(t timestamptz) returns text language sql immutable set search_path = public as $$
  select (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from (t at time zone 'Europe/Paris'))::int + 1]
    || ' ' || to_char(t at time zone 'Europe/Paris', 'FMDD') || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from (t at time zone 'Europe/Paris'))::int]
    || ' à ' || to_char(t at time zone 'Europe/Paris', 'HH24"h"MI');
$$;


-- ───────── (0) Conseillers : chaque rendez-vous sait avec QUI il a lieu, donc sur quel WhatsApp Business confirmer ─────────
create table if not exists public.cand_closers (
  key text primary key,
  name text not null,
  wa_number text not null,
  active boolean not null default true
);
alter table public.cand_closers enable row level security;
drop policy if exists "cand_closers: équipe" on public.cand_closers;
create policy "cand_closers: équipe" on public.cand_closers for all to authenticated using (public.is_staff()) with check (public.is_staff());
insert into public.cand_closers (key, name, wa_number) values ('clement', 'Clément', '33756849421'), ('amandine', 'Amandine', '33763850319')
on conflict (key) do nothing;

alter table public.candidatures
  add column if not exists closer text not null default 'clement',
  add column if not exists wa_clicked_at timestamptz,
  add column if not exists remind1_at timestamptz,
  add column if not exists remind2_at timestamptz;

create or replace function private.closer_wa(k text) returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(k, 'clement') = 'clement' then (select wa_number from public.cand_settings where id = 1)
              else coalesce((select wa_number from public.cand_closers where key = k), (select wa_number from public.cand_settings where id = 1)) end;
$$;
create or replace function private.closer_name(k text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.cand_closers where key = coalesce(k, 'clement')), 'Clément');
$$;

-- ───────── (1) Pas de double rendez-vous ─────────
-- Les réservations faites depuis la page publique (sans compte connecté) sont refusées si la personne
-- (même email OU même numéro) a déjà un rendez-vous à venir. L'équipe, elle, peut toujours créer à la main.
create or replace function private.cand_no_double() returns trigger
language plpgsql security definer set search_path = public as $$
declare dg text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
begin
  if auth.uid() is not null then return new; end if;
  if new.status in ('reserve', 'confirme') and exists (
    select 1 from public.candidatures c
     where c.id is distinct from new.id and c.status in ('reserve', 'confirme') and c.starts_at > now()
       and ((coalesce(new.email, '') <> '' and lower(c.email) = lower(new.email))
         or (length(dg) >= 8 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = right(dg, 9)))
  ) then
    raise exception 'Tu as déjà un rendez-vous de réservé. Modifie-le plutôt que d''en prendre un deuxième.';
  end if;
  return new;
end $$;
drop trigger if exists cand_no_double_trg on public.candidatures;
create trigger cand_no_double_trg before insert on public.candidatures for each row execute function private.cand_no_double();

-- Est-ce que cette personne a déjà un rendez-vous à venir ? (email OU numéro)
create or replace function public.cand_mine(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare em text := lower(trim(coalesce(p ->> 'email', ''))); ph text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'); c public.candidatures;
begin
  if em = '' and length(ph) < 8 then return jsonb_build_object('found', false); end if;
  select * into c from public.candidatures
   where status in ('reserve', 'confirme') and starts_at > now()
     and ((em <> '' and lower(email) = em) or (length(ph) >= 8 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(ph, 9)))
   order by starts_at limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'starts_at', c.starts_at, 'when', private.fr_when(c.starts_at), 'status', c.status,
    'first_name', c.first_name, 'wa', private.closer_wa(c.closer), 'closer_name', private.closer_name(c.closer), 'release_hours', (select release_hours from public.cand_settings where id = 1));
end $$;

-- Déplacer SON rendez-vous (email ET numéro doivent correspondre à la réservation).
create or replace function public.cand_resched(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare em text := lower(trim(coalesce(p ->> 'email', ''))); ph text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  t timestamptz := (p ->> 'starts_at')::timestamptz; c public.candidatures; s public.cand_settings; st public.settings; old_fr text; new_fr text;
begin
  select * into s from public.cand_settings where id = 1;
  select * into st from public.settings where id = 1;
  if em = '' or length(ph) < 8 then raise exception 'Indique ton email et ton numéro WhatsApp.'; end if;
  select * into c from public.candidatures
   where status in ('reserve', 'confirme') and starts_at > now() and lower(email) = em
     and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(ph, 9)
   order by starts_at limit 1 for update;
  if not found then raise exception 'Je ne retrouve pas ton rendez-vous avec ces coordonnées. Écris-moi sur WhatsApp et je le déplace pour toi.'; end if;
  if t is null or not (public.cand_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  old_fr := private.fr_when(c.starts_at); new_fr := private.fr_when(t);
  begin
    update public.candidatures set starts_at = t,
      created_at = case when status = 'reserve' then now() else created_at end,
      note = trim(note || ' [déplacé par ' || coalesce(first_name, 'le prospect') || ' : ' || old_fr || ' → ' || new_fr || ']')
     where id = c.id;
  exception when unique_violation then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.';
  end;
  insert into public.notifications (user_id, title, body, url)
    select pr.id, '🔁 RDV déplacé : ' || coalesce(c.first_name, ''), old_fr || ' → ' || new_fr, '#candidatures' from public.profiles pr where pr.role in ('admin', 'moderator') and pr.active;
  perform private.notify_calio('🔁 Rendez-vous déplacé : ' || coalesce(c.first_name, ''), old_fr || ' → ' || new_fr, '/admin');
  perform private.send_email(coalesce(st.booking_email, 'contact@theambitiousman.fr'), 'Rendez-vous déplacé · ' || new_fr || ' · ' || coalesce(c.first_name, ''),
    '<p><b>' || coalesce(c.first_name, '') || '</b> a déplacé son appel.</p><p>Avant : ' || old_fr || '<br>Maintenant : <b>' || new_fr || '</b></p><p>📱 ' || coalesce(c.phone, '') || '</p>');
  perform private.send_email(c.email, 'Ton rendez-vous est déplacé · ' || new_fr,
    '<p>Salut ' || coalesce(c.first_name, '') || ',</p><p>C''est noté, ton appel est déplacé au <b>' || new_fr || '</b> (heure de Paris).</p>'
    || case when c.status = 'reserve' then '<p>Pour garder ta place, envoie-moi un message sur WhatsApp : <a href="https://wa.me/' || private.closer_wa(c.closer) || '?text=' || private.urlenc('Salut ' || private.closer_name(c.closer) || ', c''est ' || coalesce(c.first_name, '') || '. J''ai déplacé mon appel au ' || new_fr || '.') || '">je t''écris sur WhatsApp</a>.</p>' else '' end
    || '<p>À très vite,<br>' || private.closer_name(c.closer) || '</p>');
  perform private.gcal_kick();
  return jsonb_build_object('ok', true, 'id', c.id, 'when', new_fr, 'starts_at', t, 'wa', private.closer_wa(c.closer), 'closer_name', private.closer_name(c.closer), 'release_hours', s.release_hours, 'status', c.status, 'first_name', c.first_name);
end $$;

grant execute on function public.cand_mine(jsonb) to anon, authenticated;
grant execute on function public.cand_resched(jsonb) to anon, authenticated;

-- ───────── (2) Suivi des relances ─────────
alter table public.cand_leads
  add column if not exists followed_at timestamptz,
  add column if not exists follow_count int not null default 0,
  add column if not exists follow_channel text,
  add column if not exists follow_result text,
  add column if not exists auto_sent_at timestamptz;

-- ───────── (3) Modèles + réglages de la relance automatique ─────────
alter table public.cand_settings
  add column if not exists auto_relance boolean not null default true,
  add column if not exists auto_relance_min int not null default 5,
  add column if not exists auto_relance_from timestamptz not null default now();

insert into public.cand_templates (key, body) values
  ('wa_relance', E'Salut {prenom}, c''est Clément 👋\nJe vois que tu as commencé à réserver ton appel mais que tu n''es pas allé au bout. Tu as eu un souci ?\nTu peux reprendre ici quand tu veux : {lien}\nOu réponds-moi directement ici, je suis là pour en parler.'),
  ('mail_relance_sujet', E'{prenom}, il reste des créneaux pour ton appel'),
  ('mail_relance', E'Salut {prenom},\n\nJ''ai vu que tu avais commencé à réserver ton appel avec moi, mais que tu n''étais pas allé au bout. Aucun souci, ça arrive.\n\nVoici mes prochaines disponibilités :\n{creneaux}\n\nTu peux réserver ici : {lien}\n\nTu préfères en discuter d''abord ? Écris-moi directement sur WhatsApp : {lien_wa}\n\nÀ très vite,\nClément')
on conflict (key) do nothing;

-- ───────── (4) Relance automatique par email ─────────
create or replace function private.urlenc(t text) returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(coalesce(t, ''), '%', '%25'), ' ', '%20'), '&', '%26'), '#', '%23'), '?', '%3F'), '+', '%2B'), '"', '%22'), '<', '%3C');
$$;

create or replace function private.relance_fill(tpl text, prenom text, creneaux text, wa text) returns text
language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(
    replace(replace(replace(tpl, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    '{prenom}', replace(replace(replace(coalesce(nullif(prenom, ''), ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')),
    '{creneaux}', creneaux),
    '{lien}', '<a href="https://rdv.theambitiousman.fr">rdv.theambitiousman.fr</a>'),
    '{lien_wa}', '<a href="' || wa || '">mon WhatsApp</a>'),
    E'\n', '<br>');
$$;

create or replace function public.cand_relance_auto() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; l record; sl text; tpl text; sub text; n int := 0; wa text; creneaux text; txt text;
begin
  select * into s from public.cand_settings where id = 1;
  if not s.auto_relance then return 0; end if;
  select body into tpl from public.cand_templates where key = 'mail_relance';
  select body into sub from public.cand_templates where key = 'mail_relance_sujet';
  if tpl is null then return 0; end if;
  -- les prochaines disponibilités : un créneau par jour, 4 jours maximum
  with s1 as (select e::timestamptz as t from jsonb_array_elements_text(public.cand_slots()) e),
       d as (select distinct on ((t at time zone 'Europe/Paris')::date) t from s1 where t > now() + interval '2 hours'
              order by (t at time zone 'Europe/Paris')::date, t limit 4)
  select string_agg('• ' || private.fr_when(t), E'\n' order by t) into sl from d;
  creneaux := coalesce(sl, 'De nouveaux créneaux s''ouvrent chaque semaine.');
  for l in
    select * from public.cand_leads x
     where not x.booked and x.auto_sent_at is null and x.follow = 'new' and coalesce(x.email, '') <> ''
       and x.sid !~ '^(imp|man|cand)-'
       and x.updated_at <= now() - make_interval(mins => s.auto_relance_min)
       and x.updated_at >= s.auto_relance_from and x.updated_at > now() - interval '12 hours'
       and not (coalesce(x.capital, '') = 'lt500' or coalesce(x.budget_confirmed, '') in ('soon', 'no'))
       and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme') and c.starts_at > now() and lower(c.email) = lower(x.email))
     order by x.updated_at limit 20
  loop
    wa := 'https://wa.me/' || s.wa_number || '?text=' || private.urlenc('Salut Clément, c''est ' || coalesce(l.first_name, '') || '. J''ai commencé à réserver un appel et j''aimerais en discuter.');
    txt := private.relance_fill(tpl, l.first_name, creneaux, wa);
    perform private.send_email(l.email, replace(coalesce(sub, '{prenom}, il reste des créneaux pour ton appel'), '{prenom}', coalesce(nullif(l.first_name, ''), 'Hello')),
      '<div style="font-size:15px;line-height:1.55;color:#222">' || txt || '</div>', 'Clément');
    update public.cand_leads set auto_sent_at = now(), followed_at = coalesce(followed_at, now()), follow_count = follow_count + 1,
      follow_channel = coalesce(follow_channel, 'email-auto') where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_relance_auto() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('cand-relance-auto');
exception when others then null;
end $$;
select cron.schedule('cand-relance-auto', '*/2 * * * *', 'select public.cand_relance_auto()');

-- ───────── (5) « Pas prêts » : date précise de disponibilité du budget + séquence de messages WhatsApp ─────────
alter table public.cand_leads
  add column if not exists budget_date date,
  add column if not exists seq_sent int[] not null default '{}';

-- La page publique envoie la date à laquelle la personne pourra investir (le prospect est retrouvé par son sid).
create or replace function public.cand_lead_date(p jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
declare v_sid text := left(coalesce(p ->> 'sid', ''), 64); d date; lid bigint; nm text;
begin
  if length(v_sid) < 8 then return; end if;
  begin d := (p ->> 'date')::date; exception when others then return; end;
  if d is null or d < current_date or d > current_date + 400 then return; end if;
  update public.cand_leads set budget_date = d, updated_at = now() where sid = v_sid returning id, first_name into lid, nm;
  if lid is not null then
    perform private.notify_calio('📅 ' || coalesce(nm, 'Un prospect') || ' aura son budget le ' || to_char(d, 'DD/MM'), 'À recontacter sur WhatsApp à cette date.', '/admin');
  end if;
end $$;
grant execute on function public.cand_lead_date(jsonb) to anon, authenticated;

-- Séquence de messages (modifiable depuis Calio) : décalage en jours par rapport à la date de budget.
create table if not exists public.cand_seq (
  pos int primary key,
  label text not null,
  offset_days int not null default 0,
  body text not null
);
alter table public.cand_seq enable row level security;
drop policy if exists "cand_seq: équipe" on public.cand_seq;
create policy "cand_seq: équipe" on public.cand_seq for all to authenticated using (public.is_staff()) with check (public.is_staff());
insert into public.cand_seq (pos, label, offset_days, body) values
  (1, 'Une semaine avant', -7, E'Salut {prenom}, c''est Clément 👋\nTu m''avais dit que tu pourrais investir autour du {date}. Ça se rapproche !\nEst-ce que c''est toujours bon pour toi ? Si tu veux, on peut déjà se parler pour préparer la suite.'),
  (2, 'Le jour J', 0, E'Salut {prenom}, c''est Clément.\nC''est la date que tu m''avais donnée pour ton budget. Tu es prêt(e) à avancer ?\nTu peux réserver ton appel ici : {lien}'),
  (3, '3 jours après', 3, E'Salut {prenom}, je reviens vers toi une dernière fois.\nSi le moment n''est toujours pas le bon, dis-le-moi, je reviendrai plus tard. Sinon, tu peux réserver ici : {lien}')
on conflict (pos) do nothing;

-- ───────── (6) Réservation : le conseiller choisi (lien ?closer_id=…) décide du WhatsApp de confirmation ─────────
create or replace function public.cand_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; st public.settings; t timestamptz := (p ->> 'starts_at')::timestamptz; t2 timestamptz;
  em text := lower(trim(coalesce(p ->> 'email', ''))); nm text := left(trim(coalesce(p ->> 'first_name', '')), 80); ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  cap text := p ->> 'capital'; bid bigint; whenfr text; ics text; glink text;
  cl public.cand_closers; ck text := lower(trim(coalesce(p ->> 'closer', ''))); wan text;
begin
  select * into s from public.cand_settings where id = 1;
  select * into st from public.settings where id = 1;
  if ck = '9512' then ck := 'amandine'; end if;
  select * into cl from public.cand_closers where key = ck and active;
  if not found then select * into cl from public.cand_closers where key = 'clement'; end if;
  wan := case when cl.key = 'clement' then s.wa_number else cl.wa_number end;
  if nm = '' then raise exception 'Indique ton prénom.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Vérifie ton adresse email.'; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then raise exception 'Vérifie ton numéro WhatsApp.'; end if;
  if cap not in ('500-1000', '1000-3000', 'gt3000') or coalesce(p ->> 'budget_confirmed', '') <> 'yes' then raise exception 'Cet appel est réservé aux personnes qui ont le budget disponible maintenant.'; end if;
  if t is null or not (public.cand_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  t2 := t + make_interval(mins => s.slot_min);
  begin
    insert into public.candidatures (first_name, phone, email, situation, capital, budget_confirmed, starts_at, minutes, closer)
    values (nm, ph, em, left(p ->> 'situation', 40), cap, 'yes', t, s.slot_min, cl.key) returning id into bid;
  exception when unique_violation then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.';
  end;
  whenfr := (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from (t at time zone 'Europe/Paris'))::int + 1]
    || ' ' || to_char(t at time zone 'Europe/Paris', 'FMDD') || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from (t at time zone 'Europe/Paris'))::int]
    || ' à ' || to_char(t at time zone 'Europe/Paris', 'HH24"h"MI');
  glink := 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || replace(replace('Appel candidature · ' || nm, ' ', '%20'), '&', '%26')
    || '&dates=' || to_char(t at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '/' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
    || '&details=' || replace('WhatsApp ' || ph || ' - ' || em, ' ', '%20') || '&ctz=Europe/Paris';
  ics := 'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' || 'PRODID:-//L Accelerateur//Candidatures//FR' || E'\r\n' || 'METHOD:REQUEST' || E'\r\n' || 'BEGIN:VEVENT' || E'\r\n'
    || 'UID:cand-' || bid || '@theambitiousman.fr' || E'\r\n' || 'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'DTSTART:' || to_char(t at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n' || 'DTEND:' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'SUMMARY:Appel candidature · ' || nm || E'\r\n' || 'DESCRIPTION:WhatsApp ' || ph || ' · ' || em || ' · détails dans l''app (Candidatures)' || E'\r\n'
    || 'ORGANIZER;CN=L Accelerateur:mailto:laccelerateur@theambitiousman.fr' || E'\r\n' || 'ATTENDEE;CN=Clement;RSVP=FALSE:mailto:' || coalesce(st.booking_email, 'contact@theambitiousman.fr') || E'\r\n'
    || 'STATUS:CONFIRMED' || E'\r\n' || 'END:VEVENT' || E'\r\n' || 'END:VCALENDAR' || E'\r\n';
  insert into public.notifications (user_id, title, body, url)
    select pr.id, '🎯 Nouvelle candidature : ' || nm, whenfr || ' · ' || ph, '#candidatures' from public.profiles pr where pr.role in ('admin', 'moderator') and pr.active;
  perform private.send_email_ics(coalesce(st.booking_email, 'contact@theambitiousman.fr'), 'Candidature · ' || whenfr || ' · ' || nm,
    '<p><b>' || nm || '</b> a réservé un appel avec <b>' || cl.name || '</b> (en attente de son message WhatsApp).</p><p>📅 ' || whenfr || ' (heure de Paris), ' || s.slot_min || ' min<br>✉️ ' || em || '<br>📱 ' || ph
    || '<br>Situation : ' || coalesce(p ->> 'situation', '—') || '<br>Budget : ' || cap || '</p><p><a href="' || glink || '">Ajouter à Google Agenda</a> · gestion dans l''app → Candidatures.</p>', ics);
  perform private.send_email(em, 'Dernière étape pour confirmer ton appel · ' || whenfr,
    '<p>Salut ' || nm || ',</p><p>Ton créneau est réservé : <b>' || whenfr || '</b> (heure de Paris), ' || s.slot_min || ' minutes.</p>'
    || '<p><b>Il reste une étape :</b> envoie-moi un message sur WhatsApp pour confirmer ta place. Sans message dans les ' || s.release_hours || ' heures, je libère le créneau.</p>'
    || '<p><a href="https://wa.me/' || wan || '?text=' || private.urlenc('Salut ' || cl.name || ', c''est ' || nm || '. Je viens de réserver mon appel pour ' || whenfr || '.') || '">Envoyer le message sur WhatsApp</a></p>'
    || '<p><a href="' || glink || '">Ajouter à mon agenda</a></p><p>À très vite,<br>' || cl.name || '</p>');
  perform private.gcal_kick();
  return jsonb_build_object('ok', true, 'id', bid, 'when', whenfr, 'starts_at', t, 'wa', wan, 'closer', cl.key, 'closer_name', cl.name, 'release_hours', s.release_hours);
end $$;



-- ───────── (7) Confirmation WhatsApp : suivi du clic + rappels automatiques ─────────
-- Quand la personne appuie sur « Je confirme sur WhatsApp », on le note (Calio affiche « a ouvert WhatsApp »).
create or replace function public.cand_wa_click(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(coalesce(p ->> 'email', ''))); ph text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
begin
  update public.candidatures set wa_clicked_at = coalesce(wa_clicked_at, now())
   where status in ('reserve', 'confirme') and starts_at > now()
     and ((em <> '' and lower(email) = em) or (length(ph) >= 8 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(ph, 9)));
end $$;
grant execute on function public.cand_wa_click(jsonb) to anon, authenticated;

-- Rappels par email tant que la personne n'a pas confirmé : après 20 min, puis 1 h avant la libération du créneau.
create or replace function public.cand_confirm_remind() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; c record; n int := 0; wa text; w text; nm text;
begin
  select * into s from public.cand_settings where id = 1;
  for c in
    select * from public.candidatures x
     where x.status = 'reserve' and x.starts_at > now() and coalesce(x.email, '') <> ''
       and ((x.remind1_at is null and x.created_at <= now() - interval '20 minutes')
         or (x.remind2_at is null and x.remind1_at is not null and x.created_at <= now() - make_interval(hours => greatest(s.release_hours - 1, 1))))
     limit 30
  loop
    w := private.fr_when(c.starts_at); nm := private.closer_name(c.closer);
    wa := 'https://wa.me/' || private.closer_wa(c.closer) || '?text=' || private.urlenc('Salut ' || nm || ', c''est ' || coalesce(c.first_name, '') || '. Je confirme mon appel pour ' || w || '.');
    if c.remind1_at is null then
      perform private.send_email(c.email, 'Ton appel n''est pas encore confirmé · ' || w,
        '<p>Salut ' || coalesce(c.first_name, '') || ',</p><p>Ton créneau du <b>' || w || '</b> est réservé, mais il n''est <b>pas encore confirmé</b>. Il te reste une seule chose à faire : m''envoyer un message sur WhatsApp.</p>'
        || '<p><a href="' || wa || '" style="display:inline-block;background:#25D366;color:#0b0b0c;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:10px">JE CONFIRME SUR WHATSAPP</a></p>'
        || '<p>Sans message de ta part, je libère ton créneau dans quelques heures pour quelqu''un d''autre.</p><p>' || nm || '</p>', nm);
      update public.candidatures set remind1_at = now() where id = c.id;
    else
      perform private.send_email(c.email, 'Dernière chance de confirmer ton appel · ' || w,
        '<p>Salut ' || coalesce(c.first_name, '') || ',</p><p>Je libère ton créneau du <b>' || w || '</b> dans environ une heure si je n''ai pas de message de ta part.</p>'
        || '<p><a href="' || wa || '" style="display:inline-block;background:#25D366;color:#0b0b0c;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:10px">JE CONFIRME SUR WHATSAPP</a></p><p>' || nm || '</p>', nm);
      update public.candidatures set remind2_at = now() where id = c.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_confirm_remind() from public, anon, authenticated;
do $$ begin perform cron.unschedule('cand-confirm-remind'); exception when others then null; end $$;
select cron.schedule('cand-confirm-remind', '*/5 * * * *', 'select public.cand_confirm_remind()');
