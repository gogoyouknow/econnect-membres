-- Disponibilités : l'équipe voit les créneaux libres de chaque closer (pour les distinguer par couleur dans le calendrier).
create or replace function public.cand_slots_closers(p_delai text default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'Accès refusé.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('c', o_closer, 't', o_t) order by o_t, o_closer) from private.closer_slots(p_delai)), '[]'::jsonb);
end $$;
revoke all on function public.cand_slots_closers(text) from public, anon;
grant execute on function public.cand_slots_closers(text) to authenticated;
