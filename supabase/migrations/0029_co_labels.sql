-- 0029 : étiquettes personnalisées sur les élèves (équipe), fils de réponses, recherche
create table if not exists public.co_labels (
  id serial primary key,
  name text not null unique,
  color text not null default '#F9DC5C',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create table if not exists public.co_student_labels (
  student_id uuid references public.profiles(id) on delete cascade,
  label_id int references public.co_labels(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz default now(),
  primary key (student_id, label_id)
);
alter table public.co_labels enable row level security;
alter table public.co_student_labels enable row level security;
drop policy if exists "labels: staff" on public.co_labels;
create policy "labels: staff" on public.co_labels for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "slabels: staff" on public.co_student_labels;
create policy "slabels: staff" on public.co_student_labels for all to authenticated using (public.is_staff()) with check (public.is_staff());
insert into public.co_labels (name, color) values ('🔥 Chaud', '#ff8a65'), ('💰 1re vente', '#34d399'), ('⚠️ À surveiller', '#F9DC5C'), ('💤 Silencieux', '#b7a3ff'), ('🤝 Association possible', '#FFF1B8') on conflict (name) do nothing;

-- nombre de réponses par message (fils)
create or replace function public.co_reply_counts(p_thread bigint) returns table (parent bigint, n bigint, last_at timestamptz) language sql stable security definer set search_path = public as $$
  select reply_to, count(*), max(sent_at) from public.co_messages where thread_id = p_thread and reply_to is not null and sent_at is not null and public.co_can_see(p_thread) group by reply_to
$$;
grant execute on function public.co_reply_counts(bigint) to authenticated;

-- recherche dans toutes les conversations visibles (équipe) ou les siennes (élève)
create or replace function public.co_search(p_q text, p_thread bigint default null) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'thread_id', m.thread_id, 'kind', m.kind, 'body', m.body, 'transcript', m.transcript, 'sent_at', m.sent_at, 'sender_id', m.sender_id, 'student_id', t.student_id, 'student_name', p.name) order by m.sent_at desc), '[]'::jsonb)
  from (select * from public.co_messages where sent_at is not null and kind <> 'system' and (p_thread is null or thread_id = p_thread) and (body ilike '%' || p_q || '%' or transcript ilike '%' || p_q || '%') order by sent_at desc limit 60) m
  join public.co_threads t on t.id = m.thread_id join public.profiles p on p.id = t.student_id
  where public.co_can_see(t.id) and length(p_q) >= 2
$$;
grant execute on function public.co_search(text, bigint) to authenticated;
