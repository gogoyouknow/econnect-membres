-- 0099 : un rendez-vous ne tombe plus sur un closer qui n'est pas libre à ce moment-là.
-- Problème constaté : un créneau ouvert par les horaires généraux (ceux de Clément) pouvait être réservé, puis attribué par les règles de répartition à Amandine,
-- même hors de ses horaires (ex. mardi alors qu'elle n'a rien, ou 12 h alors qu'elle commence à 13 h).
-- Maintenant :
--   · la page de réservation ne propose que les créneaux du closer à qui la personne sera confiée (cand_slots_routed) ;
--   · au moment de réserver (et de déplacer un rendez-vous), si ce closer n'est pas libre, l'appel va à un closer qui l'est (Clément en premier).

-- Ce closer est-il libre à ce créneau ? Clément (et un closer sans horaires à lui) suit les horaires généraux ; les autres suivent leurs propres horaires et leur agenda.
create or replace function private.closer_free(k text, t timestamptz, p_delai text default null) returns boolean
language plpgsql stable security definer set search_path = public, private as $$
begin
  if k is null or t is null then return false; end if;
  if k = 'clement' or not (exists (select 1 from public.cand_closer_hours x where x.closer = k) or exists (select 1 from public.cand_closer_overrides y where y.closer = k)) then
    return public.cand_slots_global(p_delai) @> to_jsonb(t);
  end if;
  return exists (select 1 from private.closer_slots(p_delai) c where c.o_closer = k and c.o_t = t);
end $$;
revoke all on function private.closer_free(text, timestamptz, text) from public, anon, authenticated;

-- Le closer voulu s'il est libre, sinon un closer actif libre (Clément d'abord), sinon le closer voulu.
create or replace function private.free_closer(p_pref text, t timestamptz, p_delai text default null) returns text
language plpgsql stable security definer set search_path = public, private as $$
declare k text;
begin
  if private.closer_free(p_pref, t, p_delai) then return p_pref; end if;
  for k in select c.key from public.cand_closers c where c.active order by (c.key <> 'clement'), c.key loop
    if private.closer_free(k, t, p_delai) then return k; end if;
  end loop;
  return p_pref;
end $$;
revoke all on function private.free_closer(text, timestamptz, text) from public, anon, authenticated;

-- Créneaux à proposer : ceux du closer à qui cette personne sera confiée (mêmes paramètres que la réservation). Sans résultat, tous les créneaux (comme avant).
create or replace function public.cand_slots_routed(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare rt record; k text; d text := nullif(p ->> 'delai', ''); out jsonb; ck text := lower(trim(coalesce(p ->> 'closer', '')));
begin
  if ck = '9512' then ck := 'amandine'; end if;
  select * into rt from private.cand_route(lower(trim(coalesce(p ->> 'event', ''))), p ->> 'capital', p ->> 'situation', p ->> 'src', ck, p ->> 'invest', p ->> 'have');
  k := rt.o_closer;
  if k is null or k = '__dq' then return public.cand_slots(d); end if;
  if k = 'clement' or not (exists (select 1 from public.cand_closer_hours x where x.closer = k) or exists (select 1 from public.cand_closer_overrides y where y.closer = k)) then
    out := public.cand_slots_global(d);
  else
    out := public.cand_slots_for(k, d);
  end if;
  if jsonb_array_length(coalesce(out, '[]'::jsonb)) = 0 then return public.cand_slots(d); end if;
  return out;
end $$;
grant execute on function public.cand_slots_routed(jsonb) to anon, authenticated;

-- Réservation : le closer choisi par les règles doit être libre à ce créneau.
do $do$ declare d text; a text; b text;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  a := $q$wan := case when cl.key = 'clement' then s.wa_number else cl.wa_number end;$q$;
  if position(a in d) = 0 then raise exception 'motif introuvable (cand_book)'; end if;
  b := $q$if t is not null and cl.key <> private.free_closer(cl.key, t, nullif(p ->> 'delai', '')) then
    rt.o_why := coalesce(rt.o_why, '') || ' · réattribué (' || cl.name || ' pas libre à ce créneau)';
    select * into cl from public.cand_closers where key = private.free_closer(cl.key, t, nullif(p ->> 'delai', ''));
  end if;
  $q$;
  d := replace(d, a, b || a);
  execute d;
end $do$;

-- Déplacement d'un rendez-vous : même garantie.
do $do$ declare d text; a text; b text;
begin
  select pg_get_functiondef('public.cand_resched(jsonb)'::regprocedure) into d;
  a := $q$old_fr := private.fr_when(c.starts_at);$q$;
  if position(a in d) = 0 then raise exception 'motif introuvable (cand_resched)'; end if;
  b := $q$c.closer := private.free_closer(c.closer, t, nullif(p ->> 'delai', ''));
  update public.candidatures set closer = c.closer where id = c.id;
  $q$;
  d := replace(d, a, b || a);
  execute d;
end $do$;
