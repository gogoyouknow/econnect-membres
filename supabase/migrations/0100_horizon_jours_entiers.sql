-- 0100 : « réservable jusqu'à N jours à l'avance » compte des JOURS ENTIERS.
-- Avant : la limite était « maintenant + N jours » (glissante) : le dernier jour était coupé en plein milieu (ex. avec 2 jours, jeudi s'arrêtait à l'heure
-- actuelle de mardi, soit 14 h 30, au lieu d'aller jusqu'à la fin de la plage 13 h - 17 h). Maintenant la limite est la fin du jour « aujourd'hui + N ».
do $do$ declare fn regprocedure; d text; a text := $q$lim := now() + make_interval(days => s.horizon_days);$q$; b text := $q$lim := ((today + s.horizon_days + 1)::text || ' 00:00')::timestamp at time zone 'Europe/Paris';$q$;
begin
  foreach fn in array array['public.cand_slots_global(text)'::regprocedure, 'private.closer_slots(text)'::regprocedure] loop
    select pg_get_functiondef(fn) into d;
    if position(a in d) = 0 then raise notice '% : motif introuvable', fn; continue; end if;
    execute replace(d, a, b);
  end loop;
end $do$;
