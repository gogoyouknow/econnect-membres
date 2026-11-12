-- 0066 : délai minimum de réservation réglable : en heures, ou « dès demain » (aucun appel le jour même),
-- et par lien : ?delai=demain, ?delai=24 (heures), ?delai=0 (tout de suite) pour un lien précis.

alter table public.cand_settings add column if not exists from_tomorrow boolean not null default false;

drop function if exists public.cand_slots();
create or replace function public.cand_slots(p_delai text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.cand_settings; d date; h record; t timestamptz; te timestamptz; out jsonb := '[]'::jsonb; first_ok timestamptz; lim timestamptz; dur interval; today date; tomorrow boolean; mins int;
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
grant execute on function public.cand_slots(text) to anon, authenticated;

-- cand_book et cand_resched vérifient le créneau avec le même délai (celui du lien, sinon celui des réglages)
do $$
declare fn text; src text; nsrc text;
begin
  foreach fn in array array['cand_book', 'cand_resched'] loop
    select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn limit 1;
    if src is null then raise notice '% introuvable', fn; continue; end if;
    nsrc := replace(src, 'public.cand_slots() @>', 'public.cand_slots(nullif(p ->> ''delai'', '''')) @>');
    if nsrc = src then raise notice '% : rien à remplacer', fn; continue; end if;
    execute nsrc;
  end loop;
end $$;

-- Réglage voulu par Clément : pas d'appel le jour même (les gens ont besoin de voir les vidéos avant), dès demain.
update public.cand_settings set from_tomorrow = true where id = 1;
