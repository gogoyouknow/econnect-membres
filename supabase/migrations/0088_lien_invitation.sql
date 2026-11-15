-- 0088 : lien d'invitation personnel (?inv=<jeton de la fiche>) : la personne arrive directement sur le choix du créneau, ses réponses déjà connues,
-- et la réservation est acceptée même si elle avait répondu « pas encore » au budget. Le jeton (uuid de sa fiche) est impossible à deviner.
create or replace function public.cand_invite(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('first_name', l.first_name, 'email', coalesce(l.email, l.email_raw), 'phone', coalesce(l.phone, l.phone_raw),
    'situation', l.situation, 'capital', l.capital, 'booked', l.booked)
    from public.cand_leads l where p_token ~ '^[0-9a-fA-F-]{36}$' and l.qtoken::text = lower(p_token) limit 1
$$;
grant execute on function public.cand_invite(text) to anon, authenticated;

do $do$ declare d text;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  if position($q$and not (cap = 'lt500' and coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false)) then$q$ in d) = 0 then raise exception 'motif introuvable'; end if;
  d := replace(d, $q$and not (cap = 'lt500' and coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false)) then$q$,
    $q$and not (cap = 'lt500' and coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false))
     and not exists (select 1 from public.cand_leads il where il.qtoken::text = lower(coalesce(p ->> 'invite', '')) and lower(coalesce(il.email, il.email_raw)) = em) then$q$);
  execute d;
end $do$;
