-- 0080 : chaque closer peut relier SON Google Agenda (adresse secrète iCal) : ses rendez-vous / événements perso bloquent ses créneaux.
-- Synchro toutes les 10 min par la fonction « gcal-sync » (qui s'occupait déjà de l'agenda de Clément) et à chaque enregistrement.

create table if not exists public.cand_closer_cal (
  closer text primary key references public.cand_closers (key) on delete cascade,
  ics text not null,
  synced_at timestamptz,
  err text
);
create table if not exists public.cand_closer_busy (
  id bigserial primary key,
  closer text not null references public.cand_closers (key) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text
);
create index if not exists cand_closer_busy_k on public.cand_closer_busy (closer, starts_at);
alter table public.cand_closer_cal enable row level security;
alter table public.cand_closer_busy enable row level security;
drop policy if exists "cand_closer_cal: lecture" on public.cand_closer_cal;
create policy "cand_closer_cal: lecture" on public.cand_closer_cal for select to authenticated using (public.is_staff() or (public.is_closer() and closer = private.my_closer()));
drop policy if exists "cand_closer_busy: lecture" on public.cand_closer_busy;
create policy "cand_closer_busy: lecture" on public.cand_closer_busy for select to authenticated using (public.is_staff() or (public.is_closer() and closer = private.my_closer()));

-- Enregistrer / retirer l'adresse de son agenda.
create or replace function public.closer_cal_set(p_closer text, p_url text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not (public.is_staff() or (public.is_closer() and p_closer = private.my_closer())) then raise exception 'Accès refusé.'; end if;
  if not exists (select 1 from public.cand_closers where key = p_closer) then raise exception 'Closer inconnu.'; end if;
  p_url := trim(coalesce(p_url, ''));
  if p_url = '' then delete from public.cand_closer_cal where closer = p_closer; delete from public.cand_closer_busy where closer = p_closer; return true; end if;
  if p_url !~ '^https://calendar\.google\.com/calendar/ical/.+\.ics$' then raise exception 'Colle l''« adresse secrète au format iCal » de Google Agenda (elle ressemble à https://calendar.google.com/calendar/ical/…/basic.ics).'; end if;
  insert into public.cand_closer_cal (closer, ics, synced_at, err) values (p_closer, p_url, null, null)
    on conflict (closer) do update set ics = excluded.ics, synced_at = null, err = null;
  perform private.gcal_kick();
  return true;
end $$;
grant execute on function public.closer_cal_set(text, text) to authenticated;

create or replace function public.closer_cal_status(p_closer text) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when not (public.is_staff() or (public.is_closer() and p_closer = private.my_closer())) then null
    else jsonb_build_object('set', exists (select 1 from public.cand_closer_cal where closer = p_closer),
      'synced_at', (select synced_at from public.cand_closer_cal where closer = p_closer),
      'err', (select err from public.cand_closer_cal where closer = p_closer),
      'busy', (select count(*) from public.cand_closer_busy where closer = p_closer and ends_at > now())) end
$$;
grant execute on function public.closer_cal_status(text) to authenticated;

-- Pour la fonction Edge (service_role).
create or replace function public.closer_cals_for_fn() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('closer', closer, 'ics', ics)), '[]'::jsonb) from public.cand_closer_cal
$$;
create or replace function public.closer_replace_busy_for_fn(p_closer text, p jsonb, p_err text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if p_err is null then
    delete from public.cand_closer_busy where closer = p_closer;
    insert into public.cand_closer_busy (closer, starts_at, ends_at, title)
      select p_closer, (x ->> 's')::timestamptz, (x ->> 'e')::timestamptz, left(x ->> 't', 120) from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
      where (x ->> 'e')::timestamptz > now() - interval '1 day' and (x ->> 's')::timestamptz < now() + interval '60 days';
    get diagnostics n = row_count;
  end if;
  update public.cand_closer_cal set synced_at = case when p_err is null then now() else synced_at end, err = p_err where closer = p_closer;
  return n;
end $$;
revoke all on function public.closer_cals_for_fn(), public.closer_replace_busy_for_fn(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.closer_cals_for_fn(), public.closer_replace_busy_for_fn(text, jsonb, text) to service_role;

-- Le déclencheur de synchro tient aussi compte des agendas des closers.
create or replace function private.gcal_kick() returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.secrets where key in ('gcal_ics', 'google_refresh')) and not exists (select 1 from public.cand_closer_cal) then return; end if;
  perform net.http_post(url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/gcal-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', (select value from private.secrets where key = 'push_token')),
    body := '{}'::jsonb);
end $$;

-- Les créneaux ouverts par un closer évitent ses événements Google Agenda.
create or replace function private.closer_slots(p_delai text default null) returns table (o_closer text, o_t timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
declare s public.cand_settings; d date; k text; h record; tt timestamptz; te timestamptz; dur interval; today date; tomorrow boolean; mins int; first_ok timestamptz; lim timestamptz;
begin
  select * into s from public.cand_settings where id = 1;
  dur := make_interval(mins => s.slot_min);
  tomorrow := s.from_tomorrow; mins := s.notice_min;
  if p_delai is not null and p_delai <> '' then
    if lower(p_delai) in ('demain', 'tomorrow') then tomorrow := true;
    elsif p_delai ~ '^\d{1,3}$' then tomorrow := false; mins := least(p_delai::int, 336) * 60;
    end if;
  end if;
  today := (now() at time zone 'Europe/Paris')::date;
  first_ok := now() + make_interval(mins => mins);
  if tomorrow then first_ok := greatest(first_ok, ((today + 1)::text || ' 00:00')::timestamp at time zone 'Europe/Paris'); end if;
  lim := now() + make_interval(days => s.horizon_days);
  for k in select c.key from public.cand_closers c where c.active
            and (exists (select 1 from public.cand_closer_hours x where x.closer = c.key) or exists (select 1 from public.cand_closer_overrides y where y.closer = c.key)) order by c.key loop
    for d in select generate_series(today, today + s.horizon_days, '1 day')::date loop
      for h in select r.start_time, r.end_time from private.closer_ranges(k, d) r order by r.start_time loop
        tt := (d::text || ' ' || h.start_time::text)::timestamp at time zone 'Europe/Paris';
        te := (d::text || ' ' || h.end_time::text)::timestamp at time zone 'Europe/Paris';
        while tt + dur <= te loop
          if tt >= first_ok and tt <= lim
             and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme') and c.starts_at < tt + dur and c.starts_at + make_interval(mins => c.minutes) > tt)
             and not exists (select 1 from public.cand_closer_busy b where b.closer = k and b.starts_at < tt + dur and b.ends_at > tt) then
            o_closer := k; o_t := tt; return next;
          end if;
          tt := tt + make_interval(mins => s.step_min);
        end loop;
      end loop;
    end loop;
  end loop;
end $$;
