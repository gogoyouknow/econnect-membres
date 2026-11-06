-- 0017 : prise de rendez-vous maison (remplace iClosed) — Google Agenda, appels répartis entre l'équipe

-- Réglages (une ligne). Horaires : { "1": [["10:00","12:30"],["14:00","19:00"]], ... } 1 = lundi … 7 = dimanche, heure de Paris
create table if not exists public.agenda_settings (
  id int primary key default 1 check (id = 1),
  duration_min int not null default 30,
  buffer_min int not null default 15,
  min_notice_h int not null default 4,
  horizon_days int not null default 14,
  max_per_day int not null default 6,
  tz text not null default 'Europe/Paris',
  hours jsonb not null default '{"1":[["10:00","12:30"],["14:00","19:00"]],"2":[["10:00","12:30"],["14:00","19:00"]],"3":[["10:00","12:30"],["14:00","19:00"]],"4":[["10:00","12:30"],["14:00","19:00"]],"5":[["10:00","12:30"],["14:00","19:00"]]}',
  title text not null default 'Appel E-Connect',
  google_client_id text default ''
);
insert into public.agenda_settings (id) values (1) on conflict do nothing;
alter table public.agenda_settings enable row level security;
drop policy if exists "agenda_settings: équipe" on public.agenda_settings;
create policy "agenda_settings: équipe" on public.agenda_settings for select to authenticated using (public.is_staff());
drop policy if exists "agenda_settings: admin" on public.agenda_settings;
create policy "agenda_settings: admin" on public.agenda_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Les personnes qui prennent les appels (toi, Amandine…). Horaires propres optionnels (sinon ceux des réglages)
create table if not exists public.agenda_hosts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  google_email text,
  active boolean not null default true,
  hours jsonb,
  connected_at timestamptz
);
alter table public.agenda_hosts enable row level security;
drop policy if exists "agenda_hosts: équipe" on public.agenda_hosts;
create policy "agenda_hosts: équipe" on public.agenda_hosts for select to authenticated using (public.is_staff());
drop policy if exists "agenda_hosts: modifier" on public.agenda_hosts;
create policy "agenda_hosts: modifier" on public.agenda_hosts for update to authenticated using (public.is_admin() or profile_id = auth.uid()) with check (public.is_admin() or profile_id = auth.uid());
drop policy if exists "agenda_hosts: retirer" on public.agenda_hosts;
create policy "agenda_hosts: retirer" on public.agenda_hosts for delete to authenticated using (public.is_admin() or profile_id = auth.uid());

-- Secrets Google (jetons de connexion, clé secrète) : aucune policy = illisible depuis l'app, seule la fonction serveur y accède
create table if not exists public.agenda_tokens (profile_id uuid primary key references public.profiles(id) on delete cascade, refresh_token text not null, updated_at timestamptz default now());
alter table public.agenda_tokens enable row level security;
create table if not exists public.agenda_secrets (key text primary key, value text not null);
alter table public.agenda_secrets enable row level security;

create or replace function public.set_google_client(p_id text, p_secret text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  update public.agenda_settings set google_client_id = trim(p_id) where id = 1;
  if coalesce(trim(p_secret), '') <> '' then
    insert into public.agenda_secrets (key, value) values ('google_client_secret', trim(p_secret)) on conflict (key) do update set value = excluded.value;
  end if;
  return true;
end $$;
create or replace function public.google_client_ready() returns boolean language sql stable security definer set search_path = public as
$$ select public.is_staff() and exists (select 1 from public.agenda_secrets where key = 'google_client_secret') and (select google_client_id <> '' from public.agenda_settings where id = 1) $$;
revoke all on function public.set_google_client(text, text) from public, anon;
grant execute on function public.set_google_client(text, text) to authenticated;
grant execute on function public.google_client_ready() to authenticated;

-- Les rendez-vous
create table if not exists public.bookings (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  lead_id bigint references public.leads(id) on delete set null,
  host_id uuid references public.profiles(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  name text, email text not null, phone text,
  status text not null default 'confirme' check (status in ('confirme','annule','fait','absent')),
  google_event_id text, meet_url text,
  manage_token uuid not null default gen_random_uuid() unique,
  reminded_24 boolean not null default false,
  reminded_1 boolean not null default false,
  note text default ''
);
create index if not exists bookings_starts on public.bookings(starts_at);
alter table public.bookings enable row level security;
drop policy if exists "bookings: équipe" on public.bookings;
create policy "bookings: équipe" on public.bookings for select to authenticated using (public.is_staff());
drop policy if exists "bookings: suivi" on public.bookings;
create policy "bookings: suivi" on public.bookings for update to authenticated using (public.is_staff()) with check (public.is_staff());
do $$ begin alter publication supabase_realtime add table public.bookings; exception when others then null; end $$;

alter table public.leads add column if not exists booking_at timestamptz;


-- date lisible en français : « samedi 07/11 à 14h30 »
create or replace function private.fr_when(t timestamptz) returns text language sql immutable as $$
  select (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])[extract(isodow from t at time zone 'Europe/Paris')::int]
         || ' ' || to_char(t at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI')
$$;

-- Rappels par email 24 h et 1 h avant (cron toutes les 10 min)
create or replace function public.send_booking_reminders() returns int language plpgsql security definer set search_path = public as $$
declare b record; n int := 0; when_txt text; body text; host text;
begin
  for b in select * from public.bookings where status = 'confirme' and (
      (not reminded_24 and starts_at between now() + interval '23 hours' and now() + interval '25 hours') or
      (not reminded_1 and starts_at between now() + interval '50 minutes' and now() + interval '70 minutes')) loop
    when_txt := private.fr_when(b.starts_at);
    select coalesce(nullif(first_name, ''), name) into host from public.profiles where id = b.host_id;
    body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Petit rappel : on a rendez-vous <b>' || when_txt || '</b> (heure de Paris)' || coalesce(' avec ' || host, '') || '.</p>'
         || case when b.meet_url is not null then private.btn('Rejoindre l''appel', b.meet_url) else '' end
         || '<p style="margin:0;font-size:12px;color:#777">Un empêchement ? <a href="https://econnect-membres.vercel.app/rdv?t=' || b.manage_token || '">Déplace ou annule ton rendez-vous ici</a>.</p>';
    perform private.send_email(b.email, case when b.starts_at < now() + interval '2 hours' then 'Ton appel commence dans 1 h' else 'Rappel : ton appel demain' end,
      replace(private.email_html('À tout à l''heure' || coalesce(' ' || split_part(b.name, ' ', 1), ''), body), 'L''ACCÉLÉRATEUR</td>', 'E-CONNECT</td>'), 'Clément · E-Connect');
    if b.starts_at < now() + interval '2 hours' then update public.bookings set reminded_1 = true, reminded_24 = true where id = b.id;
    else update public.bookings set reminded_24 = true where id = b.id; end if;
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.unschedule('booking-reminders') where exists (select 1 from cron.job where jobname = 'booking-reminders');
select cron.schedule('booking-reminders', '*/10 * * * *', $$select public.send_booking_reminders()$$);

-- Confirmation / annulation : email au prospect + notification au coach
create or replace function public.booking_confirmed(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype; host text; when_txt text; body text;
begin
  select * into b from public.bookings where id = p_id;
  select coalesce(nullif(first_name, ''), name) into host from public.profiles where id = b.host_id;
  when_txt := private.fr_when(b.starts_at);
  body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">C''est calé : <b>' || when_txt || '</b> (heure de Paris), en visio' || coalesce(' avec ' || host, '') || '. Tu as aussi reçu l''invitation dans ton agenda.</p>'
       || case when b.meet_url is not null then private.btn('Lien de l''appel', b.meet_url) else '' end
       || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Prévois 30 minutes au calme. On fait le point sur ton projet et on te dit honnêtement si l''accompagnement est fait pour toi.</p>'
       || '<p style="margin:0;font-size:12px;color:#777">Un empêchement ? <a href="https://econnect-membres.vercel.app/rdv?t=' || b.manage_token || '">Déplace ou annule ton rendez-vous ici</a>.</p>';
  perform private.send_email(b.email, 'Ton appel est confirmé · ' || when_txt,
    replace(private.email_html('Rendez-vous confirmé', body), 'L''ACCÉLÉRATEUR</td>', 'E-CONNECT</td>'), 'Clément · E-Connect');
  insert into public.notifications (user_id, title, body, url) values (b.host_id, '📅 Nouvel appel : ' || coalesce(b.name, b.email), when_txt, '#agenda');
end $$;
create or replace function public.booking_cancelled(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_id;
  insert into public.notifications (user_id, title, body, url) values (b.host_id, 'Appel annulé : ' || coalesce(b.name, b.email), to_char(b.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI'), '#agenda');
  if b.lead_id is not null then update public.leads set status = 'nouveau', booking_at = null where id = b.lead_id and status = 'rdv'; end if;
end $$;
revoke all on function public.booking_confirmed(bigint) from public, anon, authenticated;
revoke all on function public.booking_cancelled(bigint) from public, anon, authenticated;
grant execute on function public.booking_confirmed(bigint) to service_role;
grant execute on function public.booking_cancelled(bigint) to service_role;

notify pgrst, 'reload schema';
