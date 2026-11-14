-- 0077 : créneaux propres à chaque closer + sections Formulaires / Horaires pour les closers.
-- • Chaque closer (ex. Amandine) a SES horaires de la semaine, ses dates exceptionnelles et ses jours off. Ils s'ajoutent aux horaires généraux : rien ne change pour les créneaux existants.
-- • Un créneau ouvert seulement par un closer lui est attribué quand quelqu'un le réserve.
-- • Un closer voit les formulaires des personnes qui ont pris rendez-vous avec LUI, pas les autres.

create table if not exists public.cand_closer_hours (
  id bigserial primary key,
  closer text not null references public.cand_closers (key) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null, end_time time not null check (end_time > start_time)
);
create index if not exists cand_closer_hours_k on public.cand_closer_hours (closer, weekday);
create table if not exists public.cand_closer_overrides (
  id bigserial primary key,
  closer text not null references public.cand_closers (key) on delete cascade,
  day date not null,
  start_time time not null, end_time time not null check (end_time > start_time)
);
create index if not exists cand_closer_overrides_k on public.cand_closer_overrides (closer, day);
create table if not exists public.cand_closer_blocked (
  closer text not null references public.cand_closers (key) on delete cascade,
  day date not null,
  primary key (closer, day)
);
do $$
declare t text;
begin
  foreach t in array array['cand_closer_hours', 'cand_closer_overrides', 'cand_closer_blocked'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: équipe et closer" on public.%I', t, t);
    execute format('create policy "%s: équipe et closer" on public.%I for all to authenticated using (public.is_staff() or (public.is_closer() and closer = private.my_closer())) with check (public.is_staff() or (public.is_closer() and closer = private.my_closer()))', t, t);
  end loop;
end $$;

-- Un closer lit les formulaires des personnes qui ont pris rendez-vous avec lui (la vue « prospects_v » s'applique avec ses droits).
drop policy if exists "cand_leads: closer lit" on public.cand_leads;
create policy "cand_leads: closer lit" on public.cand_leads for select to authenticated using (
  public.is_closer() and exists (
    select 1 from public.candidatures c
     where c.closer = private.my_closer()
       and ((cand_leads.email is not null and lower(c.email) = lower(cand_leads.email)) or (cand_leads.phone is not null and c.phone = cand_leads.phone))));

-- Plages d'un closer pour un jour donné (date exceptionnelle > semaine type ; jour off = rien).
create or replace function private.closer_ranges(k text, d date) returns table (start_time time, end_time time)
language sql stable security definer set search_path = public as $$
  select x.start_time, x.end_time from (
    select o.start_time, o.end_time from public.cand_closer_overrides o where o.closer = k and o.day = d
    union all
    select h.start_time, h.end_time from public.cand_closer_hours h
     where h.closer = k and h.weekday = extract(dow from d)::int
       and not exists (select 1 from public.cand_closer_overrides o2 where o2.closer = k and o2.day = d)
  ) x where not exists (select 1 from public.cand_closer_blocked b where b.closer = k and b.day = d)
$$;

-- Créneaux ouverts par les closers eux-mêmes (même délai, même durée, même horizon que les créneaux généraux ; jamais par-dessus un autre appel).
create or replace function private.closer_slots(p_delai text default null) returns table (o_closer text, o_t timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
declare s public.cand_settings; d date; k text; h record; tt timestamptz; te timestamptz; dur interval; today date; tomorrow boolean; mins int; first_ok timestamptz; lim timestamptz;
begin
  select * into s from public.cand_settings where id = 1;
  dur := make_interval(mins => s.slot_min);
  tomorrow := s.from_tomorrow; mins := s.notice_min;
  if p_delai is not null and p_delai <> '' then
    if lower(p_delai) in ('demain', 'tomorrow') then tomorrow := true;
    elsif p_delai ~ '^\d{1,3}$' then tomorrow := false; mins := least(p_delai::int, 336) * 60;
    end if;
  end if;
  today := (now() at time zone 'Europe/Paris')::date;
  first_ok := now() + make_interval(mins => mins);
  if tomorrow then first_ok := greatest(first_ok, ((today + 1)::text || ' 00:00')::timestamp at time zone 'Europe/Paris'); end if;
  lim := now() + make_interval(days => s.horizon_days);
  for k in select c.key from public.cand_closers c where c.active
            and (exists (select 1 from public.cand_closer_hours x where x.closer = c.key) or exists (select 1 from public.cand_closer_overrides y where y.closer = c.key)) order by c.key loop
    for d in select generate_series(today, today + s.horizon_days, '1 day')::date loop
      for h in select r.start_time, r.end_time from private.closer_ranges(k, d) r order by r.start_time loop
        tt := (d::text || ' ' || h.start_time::text)::timestamp at time zone 'Europe/Paris';
        te := (d::text || ' ' || h.end_time::text)::timestamp at time zone 'Europe/Paris';
        while tt + dur <= te loop
          if tt >= first_ok and tt <= lim
             and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme') and c.starts_at < tt + dur and c.starts_at + make_interval(mins => c.minutes) > tt) then
            o_closer := k; o_t := tt; return next;
          end if;
          tt := tt + make_interval(mins => s.step_min);
        end loop;
      end loop;
    end loop;
  end loop;
end $$;
revoke all on function private.closer_slots(text) from public, anon, authenticated;
revoke all on function private.closer_ranges(text, date) from public, anon, authenticated;

create or replace function private.closer_owner(p_t timestamptz, p_delai text default null) returns text
language sql stable security definer set search_path = public, private as $$
  select o_closer from private.closer_slots(p_delai) where o_t = p_t order by o_closer limit 1
$$;
revoke all on function private.closer_owner(timestamptz, text) from public, anon, authenticated;

-- Les créneaux généraux gardent leur calcul d'origine ; « cand_slots » y ajoute ceux des closers.
alter function public.cand_slots(text) rename to cand_slots_global;
create or replace function public.cand_slots(p_delai text default null) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(to_jsonb(u.x) order by u.x), '[]'::jsonb) from (
    select distinct x from (
      select (e)::timestamptz as x from jsonb_array_elements_text(public.cand_slots_global(p_delai)) e
      union all
      select o_t from private.closer_slots(p_delai)
    ) a
  ) u
$$;
grant execute on function public.cand_slots(text) to anon, authenticated;

-- Réservation : même fonction qu'avant, avec le créneau propre à un closer attribué à ce closer, et le délai du lien bien pris en compte.
create or replace function public.cand_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; st public.settings; t timestamptz := (p ->> 'starts_at')::timestamptz; t2 timestamptz;
  em text := lower(trim(coalesce(p ->> 'email', ''))); nm text := left(trim(coalesce(p ->> 'first_name', '')), 80); ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  ip_ text := private.client_ip(); bm bigint;
  cap text := p ->> 'capital'; bid bigint; whenfr text; ics text; glink text;
  cl public.cand_closers; ck text := lower(trim(coalesce(p ->> 'closer', ''))); wan text; rt record; ev_slug text := lower(trim(coalesce(p ->> 'event', '')));
begin
  select * into s from public.cand_settings where id = 1;
  select * into st from public.settings where id = 1;
  if ck = '9512' then ck := 'amandine'; end if;
  -- Créneau ouvert seulement par un closer (hors horaires généraux) : l'appel lui revient.
  if t is not null and not (public.cand_slots_global(nullif(p ->> 'delai', '')) @> to_jsonb(t)) then
    ck := coalesce(private.closer_owner(t, nullif(p ->> 'delai', '')), ck);
  end if;
  -- Qui prend l'appel : lien personnel du closer > règles par profil de l'événement > priorité des closers.
  select * into rt from private.cand_route(ev_slug, cap, p ->> 'situation', p ->> 'src', ck);
  select * into cl from public.cand_closers where key = rt.o_closer;
  if not found then select * into cl from public.cand_closers where key = 'clement'; end if;
  wan := case when cl.key = 'clement' then s.wa_number else cl.wa_number end;
  if nm = '' then raise exception 'Indique ton prénom.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Vérifie ton adresse email.'; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then raise exception 'Vérifie ton numéro WhatsApp.'; end if;
  -- Personne bloquée volontairement (email, téléphone ou IP) : pas de réservation, et on garde la trace de la tentative.
  bm := private.block_match(em, ph, ip_);
  if bm is not null then
    insert into public.cand_block_hits (block_id, via, first_name, ip) values (bm, 'reservation', nm, ip_);
    return jsonb_build_object('blocked', true, 'reason', (select reason from public.cand_blocks where id = bm));
  end if;
  if cap not in ('500-1000', '1000-3000', 'gt3000') or coalesce(p ->> 'budget_confirmed', '') <> 'yes' then raise exception 'Cet appel est réservé aux personnes qui ont le budget disponible maintenant.'; end if;
  if t is null or not (public.cand_slots(nullif(p ->> 'delai', '')) @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  t2 := t + make_interval(mins => s.slot_min);
  begin
    insert into public.candidatures (first_name, phone, email, situation, capital, budget_confirmed, starts_at, minutes, closer, event_id, route_note, ip)
    values (nm, ph, em, left(p ->> 'situation', 40), cap, 'yes', t, s.slot_min, cl.key, rt.o_event, rt.o_why, nullif(ip_, '')) returning id into bid;
  exception when unique_violation then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.';
  end;
  whenfr := (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from (t at time zone 'Europe/Paris'))::int + 1]
    || ' ' || to_char(t at time zone 'Europe/Paris', 'FMDD') || ' '
    || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from (t at time zone 'Europe/Paris'))::int]
    || ' à ' || to_char(t at time zone 'Europe/Paris', 'HH24"h"MI');
  glink := 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || replace(replace('Appel candidature · ' || nm, ' ', '%20'), '&', '%26')
    || '&dates=' || to_char(t at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '/' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
    || '&details=' || replace('WhatsApp ' || ph || ' - ' || em, ' ', '%20') || '&ctz=Europe/Paris';
  ics := 'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' || 'PRODID:-//L Accelerateur//Candidatures//FR' || E'\r\n' || 'METHOD:REQUEST' || E'\r\n' || 'BEGIN:VEVENT' || E'\r\n'
    || 'UID:cand-' || bid || '@theambitiousman.fr' || E'\r\n' || 'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'DTSTART:' || to_char(t at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n' || 'DTEND:' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'SUMMARY:Appel candidature · ' || nm || E'\r\n' || 'DESCRIPTION:WhatsApp ' || ph || ' · ' || em || ' · détails dans l''app (Candidatures)' || E'\r\n'
    || 'ORGANIZER;CN=L Accelerateur:mailto:laccelerateur@theambitiousman.fr' || E'\r\n' || 'ATTENDEE;CN=Clement;RSVP=FALSE:mailto:' || coalesce(st.booking_email, 'contact@theambitiousman.fr') || E'\r\n'
    || 'STATUS:CONFIRMED' || E'\r\n' || 'END:VEVENT' || E'\r\n' || 'END:VCALENDAR' || E'\r\n';
  insert into public.notifications (user_id, title, body, url)
    select pr.id, '🎯 Nouvelle candidature : ' || nm, whenfr || ' · ' || ph, '#candidatures' from public.profiles pr where pr.role in ('admin', 'moderator') and pr.active;
  perform private.send_email_ics(coalesce(st.booking_email, 'contact@theambitiousman.fr'), 'Candidature · ' || whenfr || ' · ' || nm,
    '<p><b>' || nm || '</b> a réservé un appel avec <b>' || cl.name || '</b> (' || rt.o_why || ') · en attente de son message WhatsApp.</p><p>📅 ' || whenfr || ' (heure de Paris), ' || s.slot_min || ' min<br>✉️ ' || em || '<br>📱 ' || ph
    || '<br>Situation : ' || coalesce(p ->> 'situation', '—') || '<br>Budget : ' || cap || '</p><p><a href="' || glink || '">Ajouter à Google Agenda</a> · gestion dans l''app → Candidatures.</p>', ics);
  perform private.send_email(em, 'Dernière étape pour confirmer ton appel · ' || whenfr,
    '<p>Salut ' || nm || ',</p><p>Ton créneau est réservé : <b>' || whenfr || '</b> (heure de Paris), ' || s.slot_min || ' minutes.</p>'
    || '<p><b>Il reste une étape :</b> envoie-moi un message sur WhatsApp pour confirmer ta place. Sans message dans les ' || s.release_hours || ' heures, je libère le créneau.</p>'
    || '<p><a href="https://wa.me/' || wan || '?text=' || private.urlenc('Salut ' || cl.name || ', c''est ' || nm || '. Je viens de réserver mon appel pour ' || whenfr || '.') || '">Envoyer le message sur WhatsApp</a></p>'
    || '<p><a href="' || glink || '">Ajouter à mon agenda</a></p><p>À très vite,<br>' || cl.name || '</p>');
  perform private.gcal_kick();
  return jsonb_build_object('ok', true, 'id', bid, 'when', whenfr, 'starts_at', t, 'wa', wan, 'closer', cl.key, 'closer_name', cl.name, 'release_hours', s.release_hours);
end $$;
grant execute on function public.cand_book(jsonb) to anon, authenticated;

-- Outils pour l'écran « Horaires » d'un closer (et pour Clément quand il règle les horaires d'un closer).
create or replace function public.calio_my_closer() returns text
language sql stable security definer set search_path = public, private as $$ select case when public.is_closer() then private.my_closer() end $$;
grant execute on function public.calio_my_closer() to authenticated;

create or replace function public.closer_set_week(p_closer text, p jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not (public.is_staff() or (public.is_closer() and p_closer = private.my_closer())) then raise exception 'Accès refusé.'; end if;
  if not exists (select 1 from public.cand_closers where key = p_closer) then raise exception 'Closer inconnu.'; end if;
  delete from public.cand_closer_hours where closer = p_closer;
  insert into public.cand_closer_hours (closer, weekday, start_time, end_time)
  select p_closer, (x ->> 'weekday')::int, (x ->> 'start')::time, (x ->> 'end')::time from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x;
end $$;
grant execute on function public.closer_set_week(text, jsonb) to authenticated;

create or replace function public.closer_set_day(p_closer text, p_day date, p jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not (public.is_staff() or (public.is_closer() and p_closer = private.my_closer())) then raise exception 'Accès refusé.'; end if;
  if not exists (select 1 from public.cand_closers where key = p_closer) then raise exception 'Closer inconnu.'; end if;
  delete from public.cand_closer_overrides where closer = p_closer and day = p_day;
  insert into public.cand_closer_overrides (closer, day, start_time, end_time)
  select p_closer, p_day, (x ->> 'start')::time, (x ->> 'end')::time from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x;
end $$;
grant execute on function public.closer_set_day(text, date, jsonb) to authenticated;
