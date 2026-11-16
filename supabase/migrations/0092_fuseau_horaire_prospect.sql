-- Fuseau horaire du prospect : mes dispos sont à l'heure de Paris, la page les affiche dans SON fuseau.
-- On mémorise son fuseau sur la candidature pour que les emails / WhatsApp de confirmation donnent la bonne heure.
alter table public.candidatures add column if not exists tz text;

create or replace function public.cand_set_tz(p_id bigint, p_tz text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then return; end if;
  update public.candidatures set tz = p_tz where id = p_id and created_at > now() - interval '1 hour';
end $$;
grant execute on function public.cand_set_tz(bigint, text) to anon, authenticated;

create or replace function private.tz_ville(tz text) returns text language sql immutable as $$
  select coalesce((array(select v from (values
    ('Europe/London','Londres'),('Europe/Lisbon','Lisbonne'),('Europe/Moscow','Moscou'),('Europe/Istanbul','Istanbul'),('Africa/Casablanca','Casablanca'),('Africa/Algiers','Alger'),
    ('Africa/Abidjan','Abidjan'),('Africa/Dakar','Dakar'),('Africa/Douala','Douala'),('Africa/Kinshasa','Kinshasa'),('Indian/Mauritius','Maurice'),('Indian/Reunion','La Réunion'),
    ('Indian/Antananarivo','Madagascar'),('America/Toronto','Montréal'),('America/Montreal','Montréal'),('America/Martinique','Martinique'),('America/Guadeloupe','Guadeloupe'),
    ('America/Cayenne','Guyane'),('Pacific/Noumea','Nouméa'),('Pacific/Tahiti','Tahiti'),('Asia/Dubai','Dubaï')) t(k, v) where k = tz))[1],
    replace(regexp_replace(tz, '^.*/', ''), '_', ' '));
$$;

-- Même format que fr_when, mais dans le fuseau du prospect + l'heure française entre parenthèses (si son fuseau diffère de Paris à cette date).
create or replace function private.fr_when(t timestamptz, tz text) returns text language sql stable set search_path = public, private as $$
  select case
    when tz is null or tz = 'Europe/Paris' or not exists (select 1 from pg_timezone_names where name = tz) or (t at time zone tz) = (t at time zone 'Europe/Paris') then private.fr_when(t)
    else (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from (t at time zone tz))::int + 1]
      || ' ' || to_char(t at time zone tz, 'FMDD') || ' '
      || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from (t at time zone tz))::int]
      || ' à ' || to_char(t at time zone tz, 'HH24"h"MI') || ' (heure de ' || private.tz_ville(tz) || ', soit ' || to_char(t at time zone 'Europe/Paris', 'HH24"h"MI') || ' en France)'
  end
$$;

-- Toutes les fonctions qui écrivent l'heure d'une candidature (emails de confirmation, relances, séquence, déplacement) utilisent maintenant son fuseau ;
-- les listes de créneaux envoyées aux leads (fuseau inconnu) précisent « heure de Paris ».
do $$
declare r record; d text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.prokind = 'f' and p.proname <> 'fr_when'
              and (pg_get_functiondef(p.oid) like '%private.fr_when(c.starts_at)%' or pg_get_functiondef(p.oid) like '%new_fr := private.fr_when(t)%' or pg_get_functiondef(p.oid) like '%''• '' || private.fr_when(t)%')
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'private.fr_when(c.starts_at)', 'private.fr_when(c.starts_at, c.tz)');
    d := replace(d, 'new_fr := private.fr_when(t)', 'new_fr := private.fr_when(t, c.tz)');
    d := replace(d, '''• '' || private.fr_when(t)', '''• '' || private.fr_when(t) || '' (heure de Paris)''');
    execute d;
    raise notice 'fonction mise à jour : %', r.proname;
  end loop;
end $$;
