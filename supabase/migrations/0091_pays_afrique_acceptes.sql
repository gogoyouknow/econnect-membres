-- 0091 : les numéros d'Afrique (Sénégal, Mali, Côte d'Ivoire, Burkina Faso) sont de nouveau acceptés : plus aucun pays n'est écarté.
create or replace function private.geo_blocked(p text) returns boolean
language sql immutable as $$ select false $$;

-- Les fiches mises de côté uniquement pour cette raison (et pas encore réservées) reviennent à « à relancer ».
update public.cand_leads set follow = 'new'
 where follow = 'skip' and not booked and sid not like 'imp-%' and unsub_at is null
   and regexp_replace(coalesce(phone, phone_raw, ''), '[^+0-9]', '', 'g') ~ '^\+(221|223|225|226)';
