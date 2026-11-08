-- 0033 : conversations épinglées (personnelles, comme sur WhatsApp)
create table if not exists public.co_pins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id bigint not null references public.co_threads(id) on delete cascade,
  pinned_at timestamptz default now(),
  primary key (user_id, thread_id)
);
alter table public.co_pins enable row level security;
drop policy if exists "pins: own" on public.co_pins;
create policy "pins: own" on public.co_pins for all to authenticated using (user_id = auth.uid() and public.is_staff()) with check (user_id = auth.uid() and public.is_staff());
