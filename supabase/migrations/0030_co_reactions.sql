-- 0030 : réactions emoji sur les messages de l'accompagnement
create table if not exists public.co_reactions (
  message_id bigint references public.co_messages(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.co_reactions enable row level security;
drop policy if exists "coreact: voir" on public.co_reactions;
create policy "coreact: voir" on public.co_reactions for select to authenticated using (exists (select 1 from public.co_messages m where m.id = message_id and public.co_can_see(m.thread_id)));
drop policy if exists "coreact: moi" on public.co_reactions;
create policy "coreact: moi" on public.co_reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.co_messages m where m.id = message_id and public.co_can_see(m.thread_id)));
do $$ begin alter publication supabase_realtime add table public.co_reactions; exception when duplicate_object then null; end $$;
