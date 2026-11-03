-- 0013 : le robot d'import peut créer lui-même la section et la leçon (plus besoin de SQL par module)
create or replace function public.import_lesson(p_module int, p_section_pos int, p_section text, p_lesson_pos int, p_title text, p_url text, p_duration text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; m int; s int; l int;
begin
  select value into k from private.secrets where key = 'import_key';
  if k is null or p_key is distinct from k then raise exception 'unauthorized' using errcode = '42501'; end if;
  select id into m from public.modules where position = p_module order by id limit 1;
  if m is null then raise exception 'module % introuvable', p_module; end if;
  select id into s from public.course_sections where module_id = m and position = p_section_pos limit 1;
  if s is null then
    insert into public.course_sections (module_id, position, title) values (m, p_section_pos, p_section) returning id into s;
  else
    update public.course_sections set title = p_section where id = s and p_section <> '';
  end if;
  select id into l from public.lessons where section_id = s and position = p_lesson_pos limit 1;
  if l is null then
    insert into public.lessons (section_id, position, title, duration, video_url) values (s, p_lesson_pos, p_title, p_duration, p_url) returning id into l;
  else
    update public.lessons set title = p_title, video_url = p_url, duration = coalesce(nullif(p_duration, ''), duration) where id = l;
  end if;
  return jsonb_build_object('ok', true, 'module', m, 'section', s, 'lesson', l);
end $$;
revoke all on function public.import_lesson(int, int, text, int, text, text, text, text) from public;
grant execute on function public.import_lesson(int, int, text, int, text, text, text, text) to anon, service_role;
notify pgrst, 'reload schema';
