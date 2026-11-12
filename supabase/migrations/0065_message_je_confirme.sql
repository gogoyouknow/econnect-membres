-- 0065 : le message WhatsApp prérempli du premier email de réservation dit « Je confirme mon appel du … » (comme sur la page « Attention »),
-- et l'email rappelle d'appuyer sur la flèche d'envoi. On réécrit la fonction cand_book à partir de sa définition en base.
do $$
declare src text; nsrc text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cand_book' limit 1;
  if src is null then raise notice 'cand_book introuvable'; return; end if;
  nsrc := replace(src, 'Je viens de réserver mon appel pour ', 'Je confirme mon appel du ');
  nsrc := replace(nsrc, 'envoie-moi un message sur WhatsApp pour confirmer ta place.', 'envoie-moi un message sur WhatsApp pour confirmer ta place (n’oublie pas d’appuyer sur la flèche d’envoi ➤).');
  if nsrc = src then raise notice 'cand_book : rien à remplacer'; return; end if;
  execute nsrc;
end $$;
