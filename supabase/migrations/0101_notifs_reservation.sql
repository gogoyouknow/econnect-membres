-- 0101 : notifications d'une réservation d'appel.
--  · plus de notification « 🎯 Nouvelle candidature » (celle de l'app, envoyée aux admins et employés) : l'« Appel réservé » suffit ;
--  · « Appel réservé » indique avec QUI l'appel est pris (Clément, Amandine…) dans le titre ;
--  · l'email de réservation commence par le closer dans son objet.
do $do$ declare r record; d text; n int := 0; d2 text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname in ('public', 'private') and p.prosrc like '%Nouvelle candidature%' loop
    d := pg_get_functiondef(r.oid);
    d2 := regexp_replace(d, $re$insert into public\.notifications \(user_id, title, body, url\)\s+select pr\.id, '🎯 Nouvelle candidature[^;]*;$re$, '', 'g');
    if d2 <> d then execute d2; n := n + 1; else raise notice 'motif non trouvé : %', r.oid::regprocedure; end if;
  end loop;
  raise notice '% fonction(s) sans notification Nouvelle candidature', n;
end $do$;

do $do$ declare d text; a text := $q$'Candidature · ' || whenfr || ' · ' || nm$q$;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  if position(a in d) = 0 then raise notice 'objet de l''email : motif introuvable'; return; end if;
  execute replace(d, a, $q$'Candidature · ' || cl.name || ' · ' || whenfr || ' · ' || nm$q$);
end $do$;

create or replace function private.calio_cand_notif() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare lid bigint; url text := '/admin?appel=' || new.id::text; cn text;
begin
  select l.id into lid from public.cand_leads l
   where (new.email is not null and lower(l.email) = lower(new.email)) or (new.phone is not null and l.phone = new.phone)
   order by l.created_at desc limit 1;
  if lid is not null then url := url || '&fiche=' || lid::text; end if;
  select name into cn from public.cand_closers where key = new.closer;
  perform private.notify_calio('Appel réservé' || case when cn is not null then ' · ' || cn else '' end,
    coalesce(nullif(new.first_name, ''), 'Quelqu''un') || ' · ' || to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI'), url, new.closer);
  return new;
end $$;
