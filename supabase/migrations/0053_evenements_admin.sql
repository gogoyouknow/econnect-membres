-- « Événements » et « Répartition » : réservés à l'admin (pas à l'équipe, ni aux closers).
create or replace function public.calio_is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.is_admin(), false) $$;
grant execute on function public.calio_is_admin() to authenticated;

drop policy if exists "cand_events: équipe" on public.cand_events;
drop policy if exists "cand_events: admin" on public.cand_events;
create policy "cand_events: admin" on public.cand_events for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.cand_route_test(p_event bigint, p_cap text, p_sit text, p_src text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare slug text; r record; nm text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  select e.slug into slug from public.cand_events e where e.id = p_event;
  select * into r from private.cand_route(slug, p_cap, p_sit, p_src, '');
  select name into nm from public.cand_closers where key = r.o_closer;
  return jsonb_build_object('closer', r.o_closer, 'name', nm, 'why', r.o_why);
end $$;
grant execute on function public.cand_route_test(bigint, text, text, text) to authenticated;
