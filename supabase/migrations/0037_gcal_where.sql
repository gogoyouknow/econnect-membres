-- 0037 : Supabase refuse les DELETE sans WHERE (« DELETE requires a WHERE clause »).
-- On ajoute « where true » dans les fonctions Google Agenda (déconnexion + synchro), sans changer leur comportement.

create or replace function public.set_gcal_ics(p_url text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if p_url is null or p_url = '' then delete from private.secrets where key = 'gcal_ics'; delete from public.busy_times where true; return true; end if;
  if p_url !~ '^https://calendar\.google\.com/calendar/ical/.+\.ics$' then raise exception 'Colle l''« adresse secrète au format iCal » de Google Agenda (…/calendar/ical/…/basic.ics)'; end if;
  insert into private.secrets (key, value) values ('gcal_ics', p_url) on conflict (key) do update set value = excluded.value;
  perform private.gcal_kick();
  return true;
end $$;

create or replace function public.gcal_replace_busy_for_fn(p jsonb) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.busy_times where true;
  insert into public.busy_times (starts_at, ends_at, title)
    select (x ->> 's')::timestamptz, (x ->> 'e')::timestamptz, left(x ->> 't', 120) from jsonb_array_elements(p) x
    where (x ->> 'e')::timestamptz > now() - interval '1 day' and (x ->> 's')::timestamptz < now() + interval '14 days';
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.set_gcal_ics(text), public.gcal_replace_busy_for_fn(jsonb) from public, anon;
grant execute on function public.set_gcal_ics(text) to authenticated;
grant execute on function public.gcal_replace_busy_for_fn(jsonb) to service_role;
