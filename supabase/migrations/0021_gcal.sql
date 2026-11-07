-- 0021 : Google Agenda ↔ rendez-vous
--  • lecture : l'adresse iCal secrète de son agenda est synchronisée toutes les 10 min (fonction Edge gcal-sync) → table busy_times → créneaux exclus
--  • écriture : chaque rendez-vous envoie une invitation .ics (Gmail l'ajoute à l'agenda) + lien « Ajouter à Google Agenda »

-- occupations venues de l'agenda
create table if not exists public.busy_times (
  id bigserial primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text,
  synced_at timestamptz not null default now()
);
create index if not exists busy_times_range on public.busy_times (starts_at, ends_at);
alter table public.busy_times enable row level security;
drop policy if exists "busy: staff" on public.busy_times;
create policy "busy: staff" on public.busy_times for select to authenticated using (public.is_staff());

-- adresse iCal (admin)
create or replace function public.set_gcal_ics(p_url text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if p_url is null or p_url = '' then delete from private.secrets where key = 'gcal_ics'; delete from public.busy_times; return true; end if;
  if p_url !~ '^https://calendar\.google\.com/calendar/ical/.+\.ics$' then raise exception 'Colle l''« adresse secrète au format iCal » de Google Agenda (…/calendar/ical/…/basic.ics)'; end if;
  insert into private.secrets (key, value) values ('gcal_ics', p_url) on conflict (key) do update set value = excluded.value;
  perform private.gcal_kick();
  return true;
end $$;
create or replace function public.gcal_status() returns jsonb language sql stable security definer set search_path = public, private as
$$ select jsonb_build_object('set', exists (select 1 from private.secrets where key = 'gcal_ics'), 'synced_at', (select max(synced_at) from public.busy_times), 'busy', (select count(*) from public.busy_times where ends_at > now())) $$;
revoke all on function public.set_gcal_ics(text), public.gcal_status() from public, anon;
grant execute on function public.set_gcal_ics(text), public.gcal_status() to authenticated;

-- pour la fonction Edge (service_role) : lire l'adresse, remplacer les occupations
create or replace function public.gcal_ics_for_fn() returns text language sql security definer stable set search_path = public, private as
$$ select value from private.secrets where key = 'gcal_ics' $$;
create or replace function public.gcal_replace_busy_for_fn(p jsonb) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.busy_times;
  insert into public.busy_times (starts_at, ends_at, title)
    select (x ->> 's')::timestamptz, (x ->> 'e')::timestamptz, left(x ->> 't', 120) from jsonb_array_elements(p) x
    where (x ->> 'e')::timestamptz > now() - interval '1 day' and (x ->> 's')::timestamptz < now() + interval '14 days';
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.gcal_ics_for_fn(), public.gcal_replace_busy_for_fn(jsonb) from public, anon, authenticated;
grant execute on function public.gcal_ics_for_fn(), public.gcal_replace_busy_for_fn(jsonb) to service_role;

-- déclenche une synchro (toutes les 10 min + à la demande)
create or replace function private.gcal_kick() returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.secrets where key = 'gcal_ics') then return; end if;
  perform net.http_post(url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/gcal-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', (select value from private.secrets where key = 'push_token')),
    body := '{}'::jsonb);
end $$;
select cron.schedule('gcal-sync', '*/10 * * * *', $$select private.gcal_kick()$$)
where not exists (select 1 from cron.job where jobname = 'gcal-sync');

-- créneaux : on exclut aussi les occupations de l'agenda
create or replace function public.booking_slots() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.settings; d date; h public.booking_hours; t timestamptz; out jsonb := '[]'::jsonb; lim timestamptz; first_ok timestamptz; dur interval;
begin
  select * into s from public.settings where id = 1;
  dur := make_interval(mins => coalesce(s.booking_slot_min, 30));
  first_ok := now() + make_interval(mins => coalesce(s.booking_notice_min, 120));
  lim := now() + make_interval(days => coalesce(s.booking_days, 2));
  for d in select generate_series(current_date, current_date + coalesce(s.booking_days, 2), '1 day')::date loop
    select * into h from public.booking_hours where weekday = extract(dow from d)::int and active;
    if not found then continue; end if;
    t := (d::text || ' ' || h.start_time::text)::timestamp at time zone 'Europe/Paris';
    while t + dur <= ((d::text || ' ' || h.end_time::text)::timestamp at time zone 'Europe/Paris') loop
      if t >= first_ok and t <= lim
         and not exists (select 1 from public.bookings b where b.starts_at = t and b.status <> 'annule')
         and not exists (select 1 from public.busy_times bt where bt.starts_at < t + dur and bt.ends_at > t) then
        out := out || to_jsonb(t);
      end if;
      t := t + dur;
    end loop;
  end loop;
  return out;
end $$;

-- email avec invitation .ics (Gmail propose « Ajouter à l'agenda »)
create or replace function private.send_email_ics(to_email text, subject text, html text, ics text, from_name text default 'L''Accélérateur') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint;
begin
  select value into k from private.secrets where key = 'resend';
  if k is null then return null; end if;
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', from_name || ' <laccelerateur@theambitiousman.fr>', 'to', jsonb_build_array(to_email), 'subject', subject, 'html', html,
      'attachments', jsonb_build_array(jsonb_build_object('filename', 'invitation.ics', 'content', encode(convert_to(ics, 'UTF8'), 'base64'), 'content_type', 'text/calendar; method=REQUEST')))
  ) into rid;
  return rid;
end $$;

-- réservation : invitation agenda pour toi + lien Google Agenda pour les deux
create or replace function public.book_slot(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.settings; t timestamptz := (p ->> 'starts_at')::timestamptz; em text := lower(trim(coalesce(p ->> 'email', ''))); nm text; lid bigint; bid bigint; whenfr text; mins int; ics text; glink text; t2 timestamptz;
begin
  select * into s from public.settings where id = 1;
  mins := coalesce(s.booking_slot_min, 30);
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email invalide'; end if;
  if t is null or not (public.booking_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  nm := trim(coalesce(p ->> 'name', ''));
  t2 := t + make_interval(mins => mins);
  select id into lid from public.leads where session_id = nullif(p ->> 'session_id', '') or (email = em and created_at > now() - interval '2 days') order by created_at desc limit 1;
  insert into public.bookings (lead_id, email, name, phone, starts_at, minutes) values (lid, em, left(nm, 120), left(p ->> 'phone', 40), t, mins) returning id into bid;
  update public.leads set status = 'rdv' where id = lid and status in ('nouveau', 'contacte');
  whenfr := (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from (t at time zone 'Europe/Paris'))::int + 1]
    || ' ' || to_char(t at time zone 'Europe/Paris', 'FMDD') || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from (t at time zone 'Europe/Paris'))::int]
    || ' à ' || to_char(t at time zone 'Europe/Paris', 'HH24"h"MI');
  glink := 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || replace(replace('Appel E-Connect · ' || coalesce(nullif(nm, ''), em), ' ', '%20'), '&', '%26')
        || '&dates=' || to_char(t at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '/' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
        || '&details=' || replace('WhatsApp ' || coalesce(p ->> 'phone', '') || ' - ' || em, ' ', '%20') || '&ctz=Europe/Paris';
  ics := 'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' || 'PRODID:-//L Accelerateur//RDV//FR' || E'\r\n' || 'METHOD:REQUEST' || E'\r\n' || 'BEGIN:VEVENT' || E'\r\n'
    || 'UID:rdv-' || bid || '@theambitiousman.fr' || E'\r\n' || 'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'DTSTART:' || to_char(t at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n' || 'DTEND:' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'SUMMARY:Appel E-Connect · ' || coalesce(nullif(nm, ''), em) || E'\r\n' || 'DESCRIPTION:WhatsApp ' || coalesce(p ->> 'phone', '-') || ' · ' || em || ' · détails dans l''app (Prospects)' || E'\r\n'
    || 'ORGANIZER;CN=L Accelerateur:mailto:laccelerateur@theambitiousman.fr' || E'\r\n' || 'ATTENDEE;CN=Clement;RSVP=FALSE:mailto:' || coalesce(s.booking_email, 'contact@theambitiousman.fr') || E'\r\n'
    || 'STATUS:CONFIRMED' || E'\r\n' || 'END:VEVENT' || E'\r\n' || 'END:VCALENDAR' || E'\r\n';
  -- toi + l'équipe
  insert into public.notifications (user_id, title, body, url)
    select pr.id, '📅 Nouveau rendez-vous : ' || coalesce(nullif(nm, ''), em), whenfr || ' · ' || coalesce(p ->> 'phone', ''), '#leads'
    from public.profiles pr where pr.role in ('admin', 'moderator') and pr.active;
  perform private.send_email_ics(coalesce(s.booking_email, 'contact@theambitiousman.fr'), 'Nouveau RDV · ' || whenfr || ' · ' || coalesce(nullif(nm, ''), em),
    '<p><b>' || coalesce(nullif(nm, ''), em) || '</b> a réservé un appel.</p><p>📅 ' || whenfr || ' (heure de Paris), ' || mins || ' min<br>✉️ ' || em || '<br>📱 ' || coalesce(p ->> 'phone', '—') || '</p>'
    || '<p><a href="' || glink || '">Ajouter à Google Agenda</a> · détails du formulaire dans l''app → Prospects.</p>', ics);
  -- le prospect
  perform private.send_email(em, 'Ton appel est confirmé · ' || whenfr,
    '<p>Salut ' || coalesce(nullif(split_part(nm, ' ', 1), ''), '') || ',</p><p>C''est noté : on s''appelle <b>' || whenfr || '</b> (heure de Paris), ' || mins || ' minutes.</p>'
    || '<p>Je t''appelle sur WhatsApp au numéro que tu as indiqué' || case when nullif(p ->> 'phone', '') is null then '' else ' (' || (p ->> 'phone') || ')' end || '. Prépare tes questions, et aie ton ordinateur à portée de main.</p>'
    || '<p><a href="' || glink || '">Ajouter à mon agenda</a></p><p>Un empêchement ? Réponds simplement à cet email.</p><p>À très vite,<br>Clément</p>');
  -- l'agenda se met à jour tout de suite
  perform private.gcal_kick();
  return jsonb_build_object('ok', true, 'id', bid, 'when', whenfr);
end $$;
