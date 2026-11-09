-- 0036 : horaires particuliers pour une date précise (en plus des horaires habituels par jour de semaine et des jours fermés).
-- S'il existe au moins une plage pour une date, elle REMPLACE les horaires habituels de ce jour-là.

create table if not exists public.cand_overrides (
  id bigserial primary key,
  day date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time)
);
create index if not exists cand_overrides_day_idx on public.cand_overrides (day);
alter table public.cand_overrides enable row level security;
drop policy if exists "cand_overrides: équipe" on public.cand_overrides;
create policy "cand_overrides: équipe" on public.cand_overrides for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.cand_slots() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.cand_settings; d date; h record; t timestamptz; te timestamptz; out jsonb := '[]'::jsonb; first_ok timestamptz; lim timestamptz; dur interval; today date;
begin
  select * into s from public.cand_settings where id = 1;
  dur := make_interval(mins => s.slot_min);
  first_ok := now() + make_interval(mins => s.notice_min);
  lim := now() + make_interval(days => s.horizon_days);
  today := (now() at time zone 'Europe/Paris')::date;
  for d in select generate_series(today, today + s.horizon_days, '1 day')::date loop
    if exists (select 1 from public.cand_blocked where day = d) then continue; end if;
    for h in
      select x.start_time, x.end_time from (
        select o.start_time, o.end_time from public.cand_overrides o where o.day = d
        union all
        select c.start_time, c.end_time from public.cand_hours c
         where c.weekday = extract(dow from d)::int and not exists (select 1 from public.cand_overrides o2 where o2.day = d)
      ) x order by x.start_time
    loop
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
