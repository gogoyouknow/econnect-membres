-- 0012 : point d'entrée pour que le robot d'import dépose les liens vidéo dans les leçons
insert into private.secrets(key, value) values ('import_key', '8JHAlqDlx1gP-KcQd4azv-31MaYhswmW') on conflict (key) do update set value = excluded.value;
create or replace function public.import_lesson_video(p_lesson int, p_url text, p_duration text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select value into k from private.secrets where key = 'import_key';
  if k is null or p_key is distinct from k then raise exception 'unauthorized' using errcode = '42501'; end if;
  update public.lessons set video_url = p_url, duration = coalesce(nullif(p_duration, ''), duration) where id = p_lesson;
  return jsonb_build_object('ok', found, 'lesson', p_lesson);
end $$;
revoke all on function public.import_lesson_video(int, text, text, text) from public;
grant execute on function public.import_lesson_video(int, text, text, text) to anon, service_role;
notify pgrst, 'reload schema';
