-- 0081 : toucher la notification « Appel réservé » ouvre directement la fiche de la personne
-- (/admin?appel=<id de l'appel>&fiche=<id du prospect>) : l'admin tombe sur sa fiche prospect, un closer sur son appel.
create or replace function private.calio_cand_notif() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare lid bigint; url text := '/admin?appel=' || new.id::text;
begin
  select l.id into lid from public.cand_leads l
   where (new.email is not null and lower(l.email) = lower(new.email)) or (new.phone is not null and l.phone = new.phone)
   order by l.created_at desc limit 1;
  if lid is not null then url := url || '&fiche=' || lid::text; end if;
  perform private.notify_calio('Appel réservé', coalesce(nullif(new.first_name, ''), 'Quelqu''un') || ' · ' ||
    to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI'), url, new.closer);
  return new;
end $$;

-- Photo « où écrire ses questions » dans les emails de rappel.
update public.cand_settings set questions_photo = 'https://rdv.theambitiousman.fr/questions-photo.jpg' where id = 1;
