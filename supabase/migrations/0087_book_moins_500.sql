-- 0087 : la réservation côté serveur accepte « Moins de 500 € » quand l'événement a une règle qui le cible explicitement (cf. 0085).
-- Sans règle, le refus reste identique.
do $do$ declare d text;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  if position($q$if cap not in ('500-1000', '1000-3000', 'gt3000') or coalesce(p ->> 'budget_confirmed', '') <> 'yes' then$q$ in d) = 0 then raise exception 'motif introuvable'; end if;
  d := replace(d, $q$if cap not in ('500-1000', '1000-3000', 'gt3000') or coalesce(p ->> 'budget_confirmed', '') <> 'yes' then$q$,
    $q$if not (cap in ('500-1000', '1000-3000', 'gt3000') and coalesce(p ->> 'budget_confirmed', '') = 'yes') and not (cap = 'lt500' and coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false)) then$q$);
  execute d;
end $do$;
