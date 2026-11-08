-- 0024 : la réception liste tous les élèves de l'accompagnement, même s'ils n'ont pas encore écrit
create or replace function public.co_ensure_threads() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'unauthorized' using errcode = '42501'; end if;
  insert into public.co_threads (student_id, kind)
    select p.id, k from public.profiles p cross join unnest(array['coach','clement','team','ai']) k
    where p.role = 'member' and p.active and p.accel
  on conflict do nothing;
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.co_ensure_threads() to authenticated;
