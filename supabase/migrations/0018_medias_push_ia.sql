-- 0018 : photos / vidéos / vocaux dans les messages privés · notifications push sur téléphone · données pour l'IA

-- ---------- 1) Médias dans les messages privés ----------
alter table public.dm_messages
  add column if not exists media_url text,
  add column if not exists media_type text check (media_type in ('image','video','audio')),
  add column if not exists media_duration int;          -- secondes (vocaux, vidéos)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm', 'dm', true, 100000000, array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/quicktime','video/webm','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/aac','audio/x-m4a'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "dm: lecture fichiers" on storage.objects;
create policy "dm: lecture fichiers" on storage.objects for select using (bucket_id = 'dm');
-- l'équipe envoie tout ; un élève (messagerie ouverte) peut envoyer des photos
drop policy if exists "dm: envoi fichiers" on storage.objects;
create policy "dm: envoi fichiers" on storage.objects for insert to authenticated
  with check (bucket_id = 'dm' and (public.is_staff() or (public.my_dm() and (storage.foldername(name))[1] = auth.uid()::text)));

-- ---------- 2) Notifications push (téléphone / ordinateur) ----------
-- secrets internes : jamais lisibles depuis l'app (aucune policy)
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value) values ('push_hook', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;
-- clé publique de l'app (déjà publique, elle est dans le site) pour appeler la fonction depuis la base
insert into private.secrets (key, value) values ('anon_key', 'sb_publishable_uIqvifUhbt8o-rBn13uUmQ_g7U6idOe')
  on conflict (key) do nothing;

-- à chaque notification : on demande à la fonction « push » de l'envoyer sur les appareils de la personne
create or replace function public.push_on_notification() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare k text; s text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  select value into k from private.secrets where key = 'anon_key';
  select value into s from public.app_secrets where key = 'push_hook';
  perform net.http_post(
    url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', k),
    body := jsonb_build_object('action', 'send', 'id', new.id, 'secret', s));
  return new;
exception when others then return new;   -- une notif ne doit jamais bloquer l'app
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications for each row execute function public.push_on_notification();

-- ---------- 3) Données pour l'IA : conversations anonymisées, exportables par l'admin ----------
create or replace view public.ai_corpus with (security_invoker = true) as
  select 'chat:' || m.space_id as source, m.created_at,
         md5(m.user_id::text) as auteur, p.role, (p.role <> 'member') as equipe, m.body as texte, null::bigint as fil
  from public.messages m join public.profiles p on p.id = m.user_id where not m.deleted and coalesce(m.body, '') <> ''
  union all
  select 'fil:' || po.space_id, po.created_at, md5(po.user_id::text), p.role, (p.role <> 'member'), po.body, po.id
  from public.posts po join public.profiles p on p.id = po.user_id
  union all
  select 'reponse', r.created_at, md5(r.user_id::text), p.role, (p.role <> 'member'), r.body, r.post_id
  from public.replies r join public.profiles p on p.id = r.user_id
  union all
  select 'prive', d.created_at, md5(d.sender_id::text), p.role, (p.role <> 'member'), d.body, null
  from public.dm_messages d join public.profiles p on p.id = d.sender_id where coalesce(d.body, '') <> '';
grant select on public.ai_corpus to authenticated;   -- RLS des tables d'origine : seul l'admin voit tout

notify pgrst, 'reload schema';
