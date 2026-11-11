-- 0060 : assistant IA de Calio. La clé Claude est rangée dans private.secrets (jamais lisible depuis le navigateur).
-- L'admin la colle une fois dans l'assistant ; la fonction serveur « calio-assistant » la lit avec la clé de service.

create or replace function public.calio_ai_ready() returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.is_admin() and exists (select 1 from private.secrets where key = 'anthropic_key' and coalesce(value, '') <> '')
$$;
grant execute on function public.calio_ai_ready() to authenticated;

create or replace function public.calio_ai_set_key(k text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin' using errcode = '42501'; end if;
  k := trim(coalesce(k, ''));
  if k !~ '^sk-ant-[A-Za-z0-9_\-]{20,}$' then raise exception 'Cette clé ne ressemble pas à une clé Claude (elle commence par sk-ant-).'; end if;
  insert into private.secrets (key, value) values ('anthropic_key', k)
  on conflict (key) do update set value = excluded.value;
end $$;
grant execute on function public.calio_ai_set_key(text) to authenticated;

create or replace function public.calio_ai_key() returns text
language sql stable security definer set search_path = public, private as $$
  select value from private.secrets where key = 'anthropic_key'
$$;
revoke all on function public.calio_ai_key() from public, anon, authenticated;
grant execute on function public.calio_ai_key() to service_role;
