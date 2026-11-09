-- 0038 : connexion directe à Google Agenda (bouton « Se connecter avec Google », lecture des créneaux occupés uniquement : scope calendar.freebusy).
-- Les identifiants Google et le jeton restent dans private.secrets (jamais dans git).

create or replace function public.set_google_oauth(p_client_id text, p_client_secret text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if coalesce(trim(p_client_id), '') !~ '\.apps\.googleusercontent\.com$' then raise exception 'L''ID client doit se terminer par .apps.googleusercontent.com'; end if;
  if length(coalesce(trim(p_client_secret), '')) < 10 then raise exception 'Colle aussi le code secret du client Google'; end if;
  insert into private.secrets (key, value) values ('google_client_id', trim(p_client_id)) on conflict (key) do update set value = excluded.value;
  insert into private.secrets (key, value) values ('google_client_secret', trim(p_client_secret)) on conflict (key) do update set value = excluded.value;
  return true;
end $$;

create or replace function public.gcal_oauth_start() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare cid text; st text := gen_random_uuid()::text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  select value into cid from private.secrets where key = 'google_client_id';
  if cid is null then raise exception 'Enregistre d''abord l''ID client Google'; end if;
  insert into private.secrets (key, value) values ('google_state', st) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('client_id', cid, 'state', st);
end $$;

create or replace function public.gcal_oauth_for_fn() returns jsonb language sql security definer stable set search_path = public, private as
$$ select jsonb_build_object(
     'client_id', (select value from private.secrets where key = 'google_client_id'),
     'client_secret', (select value from private.secrets where key = 'google_client_secret'),
     'state', (select value from private.secrets where key = 'google_state'),
     'refresh', (select value from private.secrets where key = 'google_refresh')) $$;

create or replace function public.gcal_save_refresh_for_fn(p_refresh text) returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.secrets (key, value) values ('google_refresh', p_refresh) on conflict (key) do update set value = excluded.value;
  delete from private.secrets where key in ('google_state', 'gcal_ics');
  return true;
end $$;

create or replace function public.gcal_disconnect() returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  delete from private.secrets where key in ('google_refresh', 'google_state', 'gcal_ics');
  delete from public.busy_times where true;
  return true;
end $$;

create or replace function public.gcal_sync_now() returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  perform private.gcal_kick();
  return true;
end $$;

create or replace function public.gcal_status() returns jsonb language sql stable security definer set search_path = public, private as
$$ select jsonb_build_object(
     'set', exists (select 1 from private.secrets where key in ('google_refresh', 'gcal_ics')),
     'mode', case when exists (select 1 from private.secrets where key = 'google_refresh') then 'google' when exists (select 1 from private.secrets where key = 'gcal_ics') then 'ics' else null end,
     'oauth_ready', exists (select 1 from private.secrets where key = 'google_client_id') and exists (select 1 from private.secrets where key = 'google_client_secret'),
     'synced_at', (select max(synced_at) from public.busy_times),
     'busy', (select count(*) from public.busy_times where ends_at > now())) $$;

create or replace function private.gcal_kick() returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.secrets where key in ('gcal_ics', 'google_refresh')) then return; end if;
  perform net.http_post(url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/gcal-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', (select value from private.secrets where key = 'push_token')),
    body := '{}'::jsonb);
end $$;

revoke all on function public.set_google_oauth(text, text), public.gcal_oauth_start(), public.gcal_disconnect(), public.gcal_sync_now(), public.gcal_status() from public, anon;
grant execute on function public.set_google_oauth(text, text), public.gcal_oauth_start(), public.gcal_disconnect(), public.gcal_sync_now(), public.gcal_status() to authenticated;
revoke all on function public.gcal_oauth_for_fn(), public.gcal_save_refresh_for_fn(text) from public, anon, authenticated;
grant execute on function public.gcal_oauth_for_fn(), public.gcal_save_refresh_for_fn(text) to service_role;
