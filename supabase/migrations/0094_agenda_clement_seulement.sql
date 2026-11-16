-- 0094 : l'ajout automatique dans l'agenda Google de Clément ne concerne que SES appels.
-- Les appels des closers (Amandine…) vont dans leur propre agenda (0093) : ils ne doivent pas apparaître chez Clément ni bloquer ses créneaux.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.gcal_push_queue_for_fn()'::regprocedure);
  n := replace(d, E'where (c.gcal_event_id is null and c.status in (''reserve'', ''confirme'') and c.starts_at > now())\n       or (c.gcal_event_id is not null and (c.status = ''annule'' or c.gcal_sig is distinct from private.cand_gcal_sig(c)))',
                  E'where coalesce(c.closer, ''clement'') = ''clement'' and ((c.gcal_event_id is null and c.status in (''reserve'', ''confirme'') and c.starts_at > now())\n       or (c.gcal_event_id is not null and (c.status = ''annule'' or c.gcal_sig is distinct from private.cand_gcal_sig(c))))');
  if n = d then raise exception 'Motif introuvable : fonction gcal_push_queue_for_fn inchangée'; end if;
  execute n;
end $$;
