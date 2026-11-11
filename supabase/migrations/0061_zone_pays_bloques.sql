-- Pays dont on ne peut pas encaisser le paiement : seulement la Côte d'Ivoire (+225), le Burkina Faso (+226), le Mali (+223) et le Sénégal (+221).
-- Les autres numéros d'Afrique (Bénin, Cameroun, Togo…) ne sont plus écartés.
create or replace function private.geo_blocked(p text) returns boolean
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '[^+0-9]', '', 'g'), '^00', '+') ~ '^\+(221|223|225|226)'
$$;

-- Les fiches mises de côté uniquement à cause de l'ancienne règle (et pas encore réservées) reviennent à « à relancer ».
update public.cand_leads set follow = 'new'
 where follow = 'skip' and not booked and sid not like 'imp-%'
   and (regexp_replace(regexp_replace(coalesce(phone, ''), '[^+0-9]', '', 'g'), '^00', '+') ~ '^\+(22[1-9]|23[1-9]|24[0-9]|25[0-9]|26[013-9]|211)'
        or regexp_replace(regexp_replace(coalesce(phone_raw, ''), '[^+0-9]', '', 'g'), '^00', '+') ~ '^\+(22[1-9]|23[1-9]|24[0-9]|25[0-9]|26[013-9]|211)')
   and not (private.geo_blocked(phone) or private.geo_blocked(phone_raw));
