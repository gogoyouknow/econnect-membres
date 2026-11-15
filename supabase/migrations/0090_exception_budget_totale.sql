-- 0090 : quand l'événement a la règle d'exception « Moins de 500 € », plus personne n'est refusé pour son budget
-- (ni le montant, ni la réponse « pas encore » / « non » à la confirmation) : tout le monde peut réserver, l'appel est attribué selon les règles.
-- Sans la règle, rien ne change.
do $do$ declare d text;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  if position($q$and not (cap = 'lt500' and coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false))$q$ in d) = 0 then raise exception 'motif introuvable'; end if;
  d := replace(d, $q$and not (cap = 'lt500' and coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false))$q$,
    $q$and not coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false)$q$);
  execute d;
end $do$;
