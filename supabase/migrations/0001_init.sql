-- Groupe E-Connect — schéma initial
-- À exécuter dans Supabase → SQL Editor (une seule fois).

create extension if not exists pgcrypto;

-- ---------- Emails autorisés (liste blanche = accès payant) ----------
create table if not exists public.allowed_emails (
  email text primary key,
  tier int not null default 1,                -- 1 = Démarrage (250 €), 2 = Accélération (450 €)
  role text not null default 'member',        -- member | mod | admin
  source text default 'manual',               -- manual | hotmart
  created_at timestamptz default now()
);

-- ---------- Profils ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null default 'Membre',
  role text not null default 'member' check (role in ('member','mod','admin')),
  tier int not null default 1 check (tier in (1,2)),
  status text default 'Module 1',
  avatar_url text,
  active boolean not null default true,
  muted_until timestamptz,
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

-- ---------- Espaces ----------
create table if not exists public.spaces (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('chat','feed')),
  tier_required int not null default 1,
  sort int default 0
);
insert into public.spaces (id,name,kind,tier_required,sort) values
  ('general','Chat général','chat',1,1),
  ('demarrage','Groupe Démarrage','chat',1,2),
  ('acceleration','Groupe Accélération','chat',2,3),
  ('feed','Fil & questions','feed',1,4),
  ('wins','Résultats','feed',1,5)
on conflict (id) do nothing;

-- ---------- Réglages (une seule ligne) ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  school_name text default 'L''Accélérateur',
  slow_mode int default 0,                    -- messages / membre / minute, 0 = off
  chat_open boolean default true,
  live_only boolean default false,            -- coachs seulement pendant les lives
  approve_posts boolean default false,
  banned_words text[] default array['formation gratuite','telegram','mon lien'],
  ban_mode text default 'block' check (ban_mode in ('block','flag')),
  grace_days int default 3,
  welcome_message text default 'Bienvenue dans le groupe. Pose tes questions ici, pas en message privé : tout le monde profite des réponses.'
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- Messages (chat) ----------
create table if not exists public.messages (
  id bigserial primary key,
  space_id text not null references public.spaces(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text default '',
  image_url text,
  deleted boolean default false,
  flagged boolean default false,
  created_at timestamptz default now()
);
create index if not exists messages_space_created on public.messages(space_id, created_at desc);

-- ---------- Fil ----------
create table if not exists public.posts (
  id bigserial primary key,
  space_id text not null default 'feed' references public.spaces(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  image_url text,
  pinned boolean default false,
  approved boolean default true,
  created_at timestamptz default now()
);
create table if not exists public.replies (
  id bigserial primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
create table if not exists public.post_likes (
  post_id bigint references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  primary key (post_id, user_id)
);

-- ---------- Lives ----------
create table if not exists public.lives (
  id bigserial primary key,
  title text not null,
  starts_at timestamptz not null,
  duration_min int default 45,
  host text default 'Clément',
  link text,
  replay_url text,
  tier_required int default 1,
  created_at timestamptz default now()
);

-- ---------- Signalements ----------
create table if not exists public.reports (
  id bigserial primary key,
  reporter_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  message_id bigint references public.messages(id) on delete set null,
  post_id bigint references public.posts(id) on delete set null,
  reason text,
  status text default 'open' check (status in ('open','dismissed','actioned')),
  created_at timestamptz default now()
);

-- ---------- Notifications ----------
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  url text default '/',
  read boolean default false,
  created_at timestamptz default now()
);
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text unique not null,
  keys jsonb not null,
  created_at timestamptz default now()
);

-- ---------- Fonctions utilitaires ----------
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select role from public.profiles where id = auth.uid()), 'member') $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() in ('mod','admin') $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() = 'admin' $$;
create or replace function public.my_tier() returns int language sql stable security definer set search_path = public as
$$ select coalesce((select tier from public.profiles where id = auth.uid()), 1) $$;
create or replace function public.is_active() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select active from public.profiles where id = auth.uid()), false) $$;

-- ---------- Création automatique du profil à l'inscription ----------
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare a public.allowed_emails%rowtype; n int;
begin
  select * into a from public.allowed_emails where lower(email) = lower(new.email);
  select count(*) into n from public.profiles;
  if a.email is null and n > 0 then
    raise exception 'Cet email n''a pas d''accès actif. Vérifie ton abonnement ou écris-nous.';
  end if;
  insert into public.profiles (id, email, name, role, tier)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when n = 0 then 'admin' else coalesce(a.role,'member') end,
    coalesce(a.tier,1)
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- Règles du chat appliquées côté serveur ----------
create or replace function public.check_message() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; p public.profiles%rowtype; w text; recent int;
begin
  select * into s from public.settings where id = 1;
  select * into p from public.profiles where id = new.user_id;
  if not p.active then raise exception 'Accès inactif'; end if;
  if p.role = 'member' then
    if p.muted_until is not null and p.muted_until > now() then raise exception 'Tu es en sourdine jusqu''à %', to_char(p.muted_until,'HH24:MI'); end if;
    if not s.chat_open then raise exception 'Le chat est fermé par un coach'; end if;
    if s.live_only then raise exception 'Pendant le live, seuls les coachs écrivent'; end if;
    if s.slow_mode > 0 then
      select count(*) into recent from public.messages where user_id = new.user_id and created_at > now() - interval '60 seconds';
      if recent >= s.slow_mode then raise exception 'Mode lent : % message(s) par minute', s.slow_mode; end if;
    end if;
    foreach w in array coalesce(s.banned_words, array[]::text[]) loop
      if w <> '' and position(lower(w) in lower(coalesce(new.body,''))) > 0 then
        if s.ban_mode = 'block' then raise exception 'Message bloqué : « % » n''est pas autorisé dans le groupe', w;
        else new.flagged := true;
          insert into public.reports (reporter_id, target_user_id, reason) values (null, new.user_id, 'Mot surveillé « '||w||' » : '||left(new.body,80));
        end if;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists messages_check on public.messages;
create trigger messages_check before insert on public.messages for each row execute function public.check_message();

create or replace function public.check_post() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.settings%rowtype; p public.profiles%rowtype; w text;
begin
  select * into s from public.settings where id = 1;
  select * into p from public.profiles where id = new.user_id;
  if p.role = 'member' then
    if s.approve_posts then new.approved := false; end if;
    foreach w in array coalesce(s.banned_words, array[]::text[]) loop
      if w <> '' and position(lower(w) in lower(new.body)) > 0 and s.ban_mode = 'block' then
        raise exception 'Post bloqué : « % » n''est pas autorisé', w;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists posts_check on public.posts;
create trigger posts_check before insert on public.posts for each row execute function public.check_post();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.spaces enable row level security;
alter table public.settings enable row level security;
alter table public.messages enable row level security;
alter table public.posts enable row level security;
alter table public.replies enable row level security;
alter table public.post_likes enable row level security;
alter table public.lives enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- profils
create policy "profiles: lecture membres actifs" on public.profiles for select to authenticated using (public.is_active() or id = auth.uid());
create policy "profiles: modifier le sien" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()) and tier = (select tier from public.profiles where id = auth.uid()));
create policy "profiles: staff modifie" on public.profiles for update to authenticated using (public.is_staff());

-- liste blanche : admin seulement
create policy "allowed: admin" on public.allowed_emails for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- espaces, réglages
create policy "spaces: lecture" on public.spaces for select to authenticated using (true);
create policy "settings: lecture" on public.settings for select to authenticated using (true);
create policy "settings: staff" on public.settings for update to authenticated using (public.is_staff());

-- messages
create policy "messages: lecture selon palier" on public.messages for select to authenticated
  using (public.is_active() and exists (select 1 from public.spaces s where s.id = space_id and s.tier_required <= public.my_tier() or public.is_staff()));
create policy "messages: écrire" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and (public.is_staff() or exists (select 1 from public.spaces s where s.id = space_id and s.tier_required <= public.my_tier())));
create policy "messages: supprimer (soi ou staff)" on public.messages for update to authenticated using (user_id = auth.uid() or public.is_staff());

-- posts / réponses / likes
create policy "posts: lecture" on public.posts for select to authenticated using (public.is_active() and (approved or user_id = auth.uid() or public.is_staff()));
create policy "posts: écrire" on public.posts for insert to authenticated with check (user_id = auth.uid() and public.is_active());
create policy "posts: modifier" on public.posts for update to authenticated using (user_id = auth.uid() or public.is_staff());
create policy "posts: supprimer" on public.posts for delete to authenticated using (user_id = auth.uid() or public.is_staff());
create policy "replies: lecture" on public.replies for select to authenticated using (public.is_active());
create policy "replies: écrire" on public.replies for insert to authenticated with check (user_id = auth.uid() and public.is_active());
create policy "replies: supprimer" on public.replies for delete to authenticated using (user_id = auth.uid() or public.is_staff());
create policy "likes: lecture" on public.post_likes for select to authenticated using (true);
create policy "likes: toggle" on public.post_likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- lives
create policy "lives: lecture" on public.lives for select to authenticated using (public.is_active());
create policy "lives: staff" on public.lives for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- signalements
create policy "reports: créer" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "reports: staff" on public.reports for all to authenticated using (public.is_staff());

-- notifications
create policy "notifs: les siennes" on public.notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push: les siennes" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Temps réel ----------
do $$ begin
  alter publication supabase_realtime add table public.messages;
  alter publication supabase_realtime add table public.posts;
  alter publication supabase_realtime add table public.replies;
  alter publication supabase_realtime add table public.notifications;
  alter publication supabase_realtime add table public.settings;
exception when others then null; end $$;

-- ---------- Stockage photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos','photos', true, 3000000, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "photos: lecture publique" on storage.objects for select using (bucket_id = 'photos');
create policy "photos: upload membres" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_active());
create policy "photos: supprimer (soi ou staff)" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (owner = auth.uid() or public.is_staff()));

-- ---------- Admin initial ----------
insert into public.allowed_emails (email, tier, role, source) values ('contact@theambitiousman.fr', 2, 'admin', 'manual') on conflict (email) do update set role = 'admin', tier = 2;
