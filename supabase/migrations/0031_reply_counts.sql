-- 0031 : fils — qui a répondu (avatars façon Slack)
drop function if exists public.co_reply_counts(bigint);
create or replace function public.co_reply_counts(p_thread bigint) returns table (parent bigint, n bigint, last_at timestamptz, repliers uuid[]) language sql stable security definer set search_path = public as $$
  select reply_to, count(*), max(sent_at), (array_agg(distinct sender_id) filter (where sender_id is not null))[1:3]
  from public.co_messages where thread_id = p_thread and reply_to is not null and sent_at is not null and public.co_can_see(p_thread) group by reply_to
$$;
grant execute on function public.co_reply_counts(bigint) to authenticated;
