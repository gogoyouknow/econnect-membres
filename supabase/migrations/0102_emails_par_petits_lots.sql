-- 0102 : les emails de séquence partent par petits lots.
-- Constaté : à 9 h, mail_tick envoyait jusqu'à 30 emails dans la même seconde ; le service d'envoi limite à 10 requêtes par seconde,
-- 6 emails ont reçu une erreur 429 (perdus) alors qu'ils étaient marqués « envoyé ».
-- Maintenant : 5 emails maximum par passage (toutes les 5 minutes), le reste part aux passages suivants.
do $do$ declare d text;
begin
  select pg_get_functiondef('public.mail_tick()'::regprocedure) into d;
  if position('order by q.due_at limit 30 loop' in d) = 0 then raise exception 'motif introuvable (mail_tick)'; end if;
  execute replace(d, 'order by q.due_at limit 30 loop', 'order by q.due_at limit 5 loop');
end $do$;
