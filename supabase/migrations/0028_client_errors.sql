-- 0028 : journal des plantages de l'app (écran noir) pour diagnostiquer
create table if not exists public.client_errors (
  id bigserial primary key,
  ts timestamptz not null default now(),
  user_id uuid,
  message text, stack text, url text, ua text, extra jsonb
);
alter table public.client_errors enable row level security;
drop policy if exists "errors: écrire" on public.client_errors;
create policy "errors: écrire" on public.client_errors for insert to anon, authenticated with check (length(coalesce(message, '')) < 2000 and length(coalesce(stack, '')) < 8000);
drop policy if exists "errors: admin" on public.client_errors;
create policy "errors: admin" on public.client_errors for select to authenticated using (public.is_admin());
select cron.schedule('purge-client-errors', '31 4 * * *', $$delete from public.client_errors where ts < now() - interval '30 days'$$)
where not exists (select 1 from cron.job where jobname = 'purge-client-errors');
