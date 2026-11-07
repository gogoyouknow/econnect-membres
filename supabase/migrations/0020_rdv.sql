-- 0020 : prise de rendez-vous après le formulaire (prospects accompagnement avec budget), créneaux sur 48 h

-- disponibilités hebdo (heure de Paris) — modifiables dans Admin
create table if not exists public.booking_hours (
  weekday int primary key check (weekday between 0 and 6),   -- 0 = dimanche … 6 = samedi
  start_time time not null default '10:00',
  end_time time not null default '20:00',
  active boolean not null default true
);
insert into public.booking_hours (weekday, start_time, end_time, active)
select d, '10:00', '20:00', d <> 0 from generate_series(0, 6) d on conflict (weekday) do nothing;
alter table public.booking_hours enable row level security;
drop policy if exists "hours: staff" on public.booking_hours;
create policy "hours: staff" on public.booking_hours for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.settings add column if not exists booking_slot_min int default 30;      -- durée d'un créneau
alter table public.settings add column if not exists booking_notice_min int default 120;   -- délai minimum avant le premier créneau
alter table public.settings add column if not exists booking_days int default 2;           -- fenêtre proposée (48 h)
alter table public.settings add column if not exists booking_email text default 'contact@theambitiousman.fr';

create table if not exists public.bookings (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  lead_id bigint references public.leads(id) on delete set null,
  email text not null, name text, phone text,
  starts_at timestamptz not null unique,
  minutes int not null default 30,
  status text not null default 'confirme' check (status in ('confirme','annule','fait','absent')),
  note text default ''
);
alter table public.bookings enable row level security;
drop policy if exists "bookings: staff" on public.bookings;
create policy "bookings: staff" on public.bookings for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- créneaux libres (anonyme) : liste d'horodatages
create or replace function public.booking_slots() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.settings; d date; h public.booking_hours; t timestamptz; out jsonb := '[]'::jsonb; lim timestamptz; first_ok timestamptz;
begin
  select * into s from public.settings where id = 1;
  first_ok := now() + make_interval(mins => coalesce(s.booking_notice_min, 120));
  lim := now() + make_interval(days => coalesce(s.booking_days, 2));
  for d in select generate_series(current_date, current_date + coalesce(s.booking_days, 2), '1 day')::date loop
    select * into h from public.booking_hours where weekday = extract(dow from d)::int and active;
    if not found then continue; end if;
    t := (d::text || ' ' || h.start_time::text)::timestamp at time zone 'Europe/Paris';
    while t + make_interval(mins => coalesce(s.booking_slot_min, 30)) <= ((d::text || ' ' || h.end_time::text)::timestamp at time zone 'Europe/Paris') loop
      if t >= first_ok and t <= lim and not exists (select 1 from public.bookings b where b.starts_at = t and b.status <> 'annule') then
        out := out || to_jsonb(t);
      end if;
      t := t + make_interval(mins => coalesce(s.booking_slot_min, 30));
    end loop;
  end loop;
  return out;
end $$;

-- réserver (anonyme, depuis la page après paiement)
create or replace function public.book_slot(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.settings; t timestamptz := (p ->> 'starts_at')::timestamptz; em text := lower(trim(coalesce(p ->> 'email', ''))); nm text; lid bigint; bid bigint; whenfr text;
begin
  select * into s from public.settings where id = 1;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email invalide'; end if;
  if t is null or not (public.booking_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  nm := trim(coalesce(p ->> 'name', ''));
  select id into lid from public.leads where session_id = nullif(p ->> 'session_id', '') or (email = em and created_at > now() - interval '2 days') order by created_at desc limit 1;
  insert into public.bookings (lead_id, email, name, phone, starts_at, minutes) values (lid, em, left(nm, 120), left(p ->> 'phone', 40), t, coalesce(s.booking_slot_min, 30)) returning id into bid;
  update public.leads set status = 'rdv' where id = lid and status in ('nouveau', 'contacte');
  whenfr := (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from (t at time zone 'Europe/Paris'))::int + 1]
    || ' ' || to_char(t at time zone 'Europe/Paris', 'FMDD') || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from (t at time zone 'Europe/Paris'))::int]
    || ' à ' || to_char(t at time zone 'Europe/Paris', 'HH24"h"MI');
  -- toi + l'équipe
  insert into public.notifications (user_id, title, body, url)
    select pr.id, '📅 Nouveau rendez-vous : ' || coalesce(nullif(nm, ''), em), whenfr || ' · ' || coalesce(p ->> 'phone', ''), '#leads'
    from public.profiles pr where pr.role in ('admin', 'moderator') and pr.active;
  perform private.send_email(coalesce(s.booking_email, 'contact@theambitiousman.fr'), 'Nouveau RDV · ' || whenfr || ' · ' || coalesce(nullif(nm, ''), em),
    '<p><b>' || coalesce(nullif(nm, ''), em) || '</b> a réservé un appel.</p><p>📅 ' || whenfr || ' (heure de Paris)<br>✉️ ' || em || '<br>📱 ' || coalesce(p ->> 'phone', '—') || '</p><p>Détails du formulaire dans l''app → Prospects.</p>');
  -- le prospect
  perform private.send_email(em, 'Ton appel est confirmé · ' || whenfr,
    '<p>Salut ' || coalesce(nullif(split_part(nm, ' ', 1), ''), '') || ',</p><p>C''est noté : on s''appelle <b>' || whenfr || '</b> (heure de Paris), ' || coalesce(s.booking_slot_min, 30) || ' minutes.</p>' ||
    '<p>Je t''appelle sur WhatsApp au numéro que tu as indiqué' || case when nullif(p ->> 'phone', '') is null then '' else ' (' || (p ->> 'phone') || ')' end || '. Prépare tes questions, et aie ton ordinateur à portée de main.</p>' ||
    '<p>Un empêchement ? Réponds simplement à cet email.</p><p>À très vite,<br>Clément</p>');
  return jsonb_build_object('ok', true, 'id', bid, 'when', whenfr);
end $$;
revoke all on function public.booking_slots(), public.book_slot(jsonb) from public;
grant execute on function public.booking_slots(), public.book_slot(jsonb) to anon, authenticated;
