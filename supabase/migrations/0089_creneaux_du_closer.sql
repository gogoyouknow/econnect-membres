-- 0089 : créneaux libres d'un seul closer (lien d'invitation personnel : on ne propose que SES horaires).
create or replace function public.cand_slots_for(p_closer text, p_delai text default null) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(to_jsonb(o_t) order by o_t), '[]'::jsonb) from private.closer_slots(p_delai) where o_closer = lower(trim(p_closer))
$$;
grant execute on function public.cand_slots_for(text, text) to anon, authenticated;
