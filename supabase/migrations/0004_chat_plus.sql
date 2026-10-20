-- 0004 : réactions, réponses, vu par, épinglage, mentions, préférences de notification

-- réactions
create table if not exists public.message_reactions (
  message_id bigint references public.messages(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.message_reactions enable row level security;
create policy "reactions: lecture" on public.message_reactions for select to authenticated using (public.is_active());
create policy "reactions: les miennes" on public.message_reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active());

-- réponses + épinglage
alter table public.messages add column if not exists reply_to bigint references public.messages(id) on delete set null;
alter table public.messages add column if not exists pinned boolean not null default false;

-- "vu par" : dernière lecture par membre et par espace (on n'expose que le nombre côté app)
create table if not exists public.space_reads (
  user_id uuid references public.profiles(id) on delete cascade,
  space_id text references public.spaces(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, space_id)
);
alter table public.space_reads enable row level security;
create policy "reads: lecture" on public.space_reads for select to authenticated using (public.is_active());
create policy "reads: la mienne" on public.space_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- préférences de notification
alter table public.profiles add column if not exists notif_mentions boolean not null default true;
alter table public.profiles add column if not exists notif_replies boolean not null default true;
alter table public.profiles add column if not exists notif_lives boolean not null default true;

-- seul le staff peut épingler ; un membre ne modifie que son propre texte/suppression
create or replace function public.guard_message_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pinned is distinct from old.pinned and not public.is_staff() then raise exception 'Seul un coach peut épingler'; end if;
  if new.user_id is distinct from old.user_id or new.space_id is distinct from old.space_id or new.created_at is distinct from old.created_at then raise exception 'Modification interdite'; end if;
  return new;
end $$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before update on public.messages for each row execute function public.guard_message_update();

-- mentions @Prénom et réponses → notifications (respecte les préférences)
create or replace function public.notify_message() returns trigger language plpgsql security definer set search_path = public as $$
declare author text; sp text; p record; parent public.messages%rowtype;
begin
  select name into author from public.profiles where id = new.user_id;
  select name into sp from public.spaces where id = new.space_id;
  -- mentions : on cherche "@Nom complet" ou "@Prénom" (insensible à la casse)
  for p in select id, name, first_name, notif_mentions from public.profiles where active and id <> new.user_id loop
    if p.notif_mentions and (
         position(lower('@' || p.name) in lower(coalesce(new.body,''))) > 0
      or (p.first_name is not null and p.first_name <> '' and lower(coalesce(new.body,'')) ~ ('@' || lower(regexp_replace(p.first_name,'([.*+?^${}()|\[\]\\])','\\\1','g')) || '(\M|$)'))
    ) then
      insert into public.notifications (user_id, title, body, url) values (p.id, author || ' t''a mentionné dans ' || sp, left(new.body, 120), '#' || new.space_id);
    end if;
  end loop;
  -- réponse à un message : on prévient l'auteur d'origine
  if new.reply_to is not null then
    select * into parent from public.messages where id = new.reply_to;
    if parent.user_id is not null and parent.user_id <> new.user_id then
      if (select notif_replies from public.profiles where id = parent.user_id) then
        insert into public.notifications (user_id, title, body, url) values (parent.user_id, author || ' a répondu à ton message', left(new.body, 120), '#' || new.space_id);
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages for each row execute function public.notify_message();

-- live : notification à tous 10 min avant (appelée par le client staff au moment de programmer ; simple et suffisant pour l'instant)
create or replace function public.notify_live(live_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare l public.lives%rowtype;
begin
  if not public.is_staff() then raise exception 'Réservé aux coachs'; end if;
  select * into l from public.lives where id = live_id;
  insert into public.notifications (user_id, title, body, url)
  select id, 'Live : ' || l.title, to_char(l.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ' avec ' || l.host, '#lives'
  from public.profiles where active and notif_lives and (tier >= l.tier_required or role <> 'member');
end $$;

do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
  alter publication supabase_realtime add table public.space_reads;
exception when others then null; end $$;
