-- 0058 : les déclencheurs du filtre « numéros africains » tournaient avec les droits de la personne connectée (admin) et n'avaient pas accès au schéma private
-- → « permission denied for schema private » à chaque modification d'une fiche. Ils tournent maintenant avec les droits du propriétaire.
create or replace function private.cand_lead_geo() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if (tg_op = 'INSERT' or new.phone is distinct from old.phone or new.phone_raw is distinct from old.phone_raw)
     and (private.geo_blocked(new.phone) or private.geo_blocked(new.phone_raw)) then
    new.follow := 'skip';
  end if;
  return new;
end $$;

create or replace function private.cand_geo_guard() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if auth.uid() is null and private.geo_blocked(new.phone) then
    raise exception 'Je ne peux pas encore t''accompagner depuis ton pays.';
  end if;
  return new;
end $$;
