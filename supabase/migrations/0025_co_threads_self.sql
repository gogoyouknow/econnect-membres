-- 0025 : un membre de l'équipe peut tester l'espace Accompagnement en « Vue élève » (fils créés pour lui-même)
create or replace function public.co_my_threads(p_student uuid default null) returns setof public.co_threads
language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(p_student, auth.uid()); k text;
begin
  if sid <> auth.uid() and not public.is_staff() then raise exception 'unauthorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = sid and active) then return; end if;
  foreach k in array array['coach','clement','team','ai'] loop
    insert into public.co_threads (student_id, kind) values (sid, k) on conflict do nothing;
  end loop;
  return query select * from public.co_threads t where t.student_id = sid and public.co_can_see(t.id) order by last_at desc;
end $$;
