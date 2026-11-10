-- Le numéro WhatsApp affiché aux prospects après leur réservation était faux (07 56 84 29 21).
-- Numéro de Clément : 07 56 84 94 21. Il se change aussi depuis Calio (Disponibilités > Réglages des appels).
update public.cand_settings set wa_number = '33756849421' where id = 1;
