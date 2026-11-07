-- 0017 : notifications push (Web Push) envoyées par la fonction Edge « send-push »
-- Aucune clé à poser à la main : la fonction génère les clés VAPID au premier appel et les range dans private.secrets.

-- jeton partagé base ↔ fonction
insert into private.secrets (key, value) values ('push_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- clé publique VAPID pour l'app (vide tant que la fonction n'a pas tourné une première fois)
create or replace function public.vapid_public_key() returns text
language sql security definer stable set search_path = public, private as $$
  select value from private.secrets where key = 'vapid_public'
$$;
revoke all on function public.vapid_public_key() from public;
grant execute on function public.vapid_public_key() to authenticated;

-- la fonction Edge enregistre ses clés (une seule fois)
create or replace function public.push_set_keys(p_token text, p_public text, p_private text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if p_token is distinct from (select value from private.secrets where key = 'push_token') then raise exception 'unauthorized' using errcode = '42501'; end if;
  insert into private.secrets (key, value) values ('vapid_public', p_public) on conflict (key) do nothing;
  insert into private.secrets (key, value) values ('vapid_private', p_private) on conflict (key) do nothing;
  return true;
end $$;

-- ce qu'il faut pour envoyer à un membre : clés + abonnements
create or replace function public.push_payload(p_token text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_token is distinct from (select value from private.secrets where key = 'push_token') then raise exception 'unauthorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'vapid_public', (select value from private.secrets where key = 'vapid_public'),
    'vapid_private', (select value from private.secrets where key = 'vapid_private'),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', keys)) from public.push_subscriptions where user_id = p_user), '[]'::jsonb)
  );
end $$;

-- abonnement mort (410/404) → on l'oublie
create or replace function public.push_drop(p_token text, p_endpoint text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if p_token is distinct from (select value from private.secrets where key = 'push_token') then raise exception 'unauthorized' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  return true;
end $$;

revoke all on function public.push_set_keys(text, text, text), public.push_payload(text, uuid), public.push_drop(text, text) from public, anon, authenticated;

-- chaque nouvelle notification part en push
create or replace function private.notify_push() returns trigger language plpgsql security definer set search_path = public, private as $$
declare tok text;
begin
  select value into tok from private.secrets where key = 'push_token';
  perform net.http_post(
    url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', tok),
    body := jsonb_build_object('user_id', new.user_id, 'title', new.title, 'body', new.body, 'url', coalesce(new.url, '/'))
  );
  return new;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications for each row execute function private.notify_push();

-- premier appel (génère les clés) — relancé par le robot après déploiement de la fonction
select net.http_post(
  url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/send-push',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', (select value from private.secrets where key = 'push_token')),
  body := '{"setup":true}'::jsonb
);
