-- 0034 : Candidatures TikTok (lien en bio → postuler à l'accompagnement)
-- Section SÉPARÉE du flux Méthode 97 € (leads / bookings) : tables, créneaux et réglages à part.
-- Les événements Google Agenda (busy_times) et les RDV Méthode (bookings) bloquent quand même les créneaux.

create table if not exists public.cand_settings (
  id int primary key default 1 check (id = 1),
  slot_min int not null default 45,
  step_min int not null default 30,
  notice_min int not null default 240,
  horizon_days int not null default 14,
  release_hours int not null default 4,
  wa_number text not null default '33756842921'
);
insert into public.cand_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.cand_hours (
  id bigserial primary key,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time)
);
insert into public.cand_hours (weekday, start_time, end_time)
  select d, t.s::time, t.e::time from generate_series(1, 5) d, (values ('10:00','11:00'), ('13:00','14:45'), ('18:00','19:00')) as t(s, e)
  where not exists (select 1 from public.cand_hours);

create table if not exists public.cand_blocked (day date primary key);

create table if not exists public.candidatures (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  first_name text, phone text, email text,
  situation text,
  capital text,
  budget_confirmed text,
  starts_at timestamptz not null,
  minutes int not null default 45,
  status text not null default 'reserve' check (status in ('reserve', 'confirme', 'annule', 'fait', 'absent')),
  note text not null default ''
);
create unique index if not exists candidatures_slot_uniq on public.candidatures (starts_at) where status in ('reserve', 'confirme');
create index if not exists candidatures_start_idx on public.candidatures (starts_at);

alter table public.cand_settings enable row level security;
alter table public.cand_hours enable row level security;
alter table public.cand_blocked enable row level security;
alter table public.candidatures enable row level security;
drop policy if exists "cand_settings: équipe" on public.cand_settings;
create policy "cand_settings: équipe" on public.cand_settings for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "cand_hours: équipe" on public.cand_hours;
create policy "cand_hours: équipe" on public.cand_hours for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "cand_blocked: équipe" on public.cand_blocked;
create policy "cand_blocked: équipe" on public.cand_blocked for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "candidatures: équipe" on public.candidatures;
create policy "candidatures: équipe" on public.candidatures for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.cand_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slot_min', slot_min, 'wa', wa_number, 'release_hours', release_hours) from public.cand_settings where id = 1;
$$;

create or replace function public.cand_slots() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.cand_settings; d date; h public.cand_hours; t timestamptz; te timestamptz; out jsonb := '[]'::jsonb; first_ok timestamptz; lim timestamptz; dur interval; today date;
begin
  select * into s from public.cand_settings where id = 1;
  dur := make_interval(mins => s.slot_min);
  first_ok := now() + make_interval(mins => s.notice_min);
  lim := now() + make_interval(days => s.horizon_days);
  today := (now() at time zone 'Europe/Paris')::date;
  for d in select generate_series(today, today + s.horizon_days, '1 day')::date loop
    if exists (select 1 from public.cand_blocked where day = d) then continue; end if;
    for h in select * from public.cand_hours where weekday = extract(dow from d)::int order by start_time loop
      t := (d::text || ' ' || h.start_time::text)::timestamp at time zone 'Europe/Paris';
      te := (d::text || ' ' || h.end_time::text)::timestamp at time zone 'Europe/Paris';
      while t + dur <= te loop
        if t >= first_ok and t <= lim
           and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme') and c.starts_at < t + dur and c.starts_at + make_interval(mins => c.minutes) > t)
           and not exists (select 1 from public.bookings b where b.status <> 'annule' and b.starts_at < t + dur and b.starts_at + make_interval(mins => b.minutes) > t)
           and not exists (select 1 from public.busy_times bt where bt.starts_at < t + dur and bt.ends_at > t) then
          out := out || to_jsonb(t);
        end if;
        t := t + make_interval(mins => s.step_min);
      end loop;
    end loop;
  end loop;
  return out;
end $$;

create or replace function public.cand_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; st public.settings; t timestamptz := (p ->> 'starts_at')::timestamptz; t2 timestamptz;
  em text := lower(trim(coalesce(p ->> 'email', ''))); nm text := left(trim(coalesce(p ->> 'first_name', '')), 80); ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  cap text := p ->> 'capital'; bid bigint; whenfr text; ics text; glink text;
begin
  select * into s from public.cand_settings where id = 1;
  select * into st from public.settings where id = 1;
  if nm = '' then raise exception 'Indique ton prénom.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Vérifie ton adresse email.'; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then raise exception 'Vérifie ton numéro WhatsApp.'; end if;
  if cap not in ('500-1000', '1000-3000', 'gt3000') or coalesce(p ->> 'budget_confirmed', '') <> 'yes' then raise exception 'Cet appel est réservé aux personnes qui ont le budget disponible maintenant.'; end if;
  if t is null or not (public.cand_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  t2 := t + make_interval(mins => s.slot_min);
  begin
    insert into public.candidatures (first_name, phone, email, situation, capital, budget_confirmed, starts_at, minutes)
    values (nm, ph, em, left(p ->> 'situation', 40), cap, 'yes', t, s.slot_min) returning id into bid;
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
    '<p><b>' || nm || '</b> a réservé un appel (en attente de son message WhatsApp).</p><p>📅 ' || whenfr || ' (heure de Paris), ' || s.slot_min || ' min<br>✉️ ' || em || '<br>📱 ' || ph
    || '<br>Situation : ' || coalesce(p ->> 'situation', '—') || '<br>Budget : ' || cap || '</p><p><a href="' || glink || '">Ajouter à Google Agenda</a> · gestion dans l''app → Candidatures.</p>', ics);
  perform private.send_email(em, 'Dernière étape pour confirmer ton appel · ' || whenfr,
    '<p>Salut ' || nm || ',</p><p>Ton créneau est réservé : <b>' || whenfr || '</b> (heure de Paris), ' || s.slot_min || ' minutes.</p>'
    || '<p><b>Il reste une étape :</b> envoie-moi un message sur WhatsApp pour confirmer ta place. Sans message dans les ' || s.release_hours || ' heures, je libère le créneau.</p>'
    || '<p><a href="https://wa.me/' || s.wa_number || '?text=' || replace('Salut Clément, c''est ' || nm || '. Je viens de réserver mon appel pour ' || whenfr || '.', ' ', '%20') || '">Envoyer le message sur WhatsApp</a></p>'
    || '<p><a href="' || glink || '">Ajouter à mon agenda</a></p><p>À très vite,<br>Clément</p>');
  perform private.gcal_kick();
  return jsonb_build_object('ok', true, 'id', bid, 'when', whenfr, 'starts_at', t, 'wa', s.wa_number, 'release_hours', s.release_hours);
end $$;

grant execute on function public.cand_config() to anon, authenticated;
grant execute on function public.cand_slots() to anon, authenticated;
grant execute on function public.cand_book(jsonb) to anon, authenticated;

create or replace function public.cand_release() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.candidatures c set status = 'annule', note = trim(c.note || ' [libéré auto : pas de message WhatsApp]')
  where c.status = 'reserve' and c.created_at < now() - make_interval(hours => (select release_hours from public.cand_settings where id = 1));
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  perform cron.unschedule('cand-release');
exception when others then null;
end $$;
select cron.schedule('cand-release', '*/15 * * * *', 'select public.cand_release()');
