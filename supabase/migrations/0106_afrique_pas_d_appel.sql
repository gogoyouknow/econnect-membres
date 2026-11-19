-- 0106 : plus aucun appel possible avec un numéro d'Afrique (Maghreb, Égypte et Afrique du Sud compris).
-- La personne voit la page Méthode à 97 € (côté formulaire) ; côté base, la réservation est refusée et la fiche est mise de côté (plus de relance).
-- +262 (La Réunion, Mayotte) n'est PAS concerné : ce sont des départements français.
-- Même liste que le formulaire (rdv/src/App.jsx, AF_BLOCK).
create or replace function private.geo_blocked(p text) returns boolean
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '[^+0-9]', '', 'g'), '^00', '+') ~ '^\+(20|21[1-3]|216|218|22[0-9]|23[0-9]|24[0-57-9]|25[0-8]|26[013-9]|27|29[01])'
$$;

-- Les fiches africaines pas encore réservées sont mises de côté (les rendez-vous déjà pris ne bougent pas).
update public.cand_leads set follow = 'skip'
 where follow <> 'skip' and not booked and (private.geo_blocked(phone) or private.geo_blocked(phone_raw));
