-- ───────── Répartition des appels (arbre de décision) + événements personnalisés ─────────
-- Un « événement » = un lien de réservation (rdv.theambitiousman.fr/e/mon-lien) avec ses propres closers, priorités et règles par profil.
-- L'événement « principal » (main) est le lien habituel rdv.theambitiousman.fr.
create table if not exists public.cand_events (
  id bigserial primary key,
  slug text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null,
  main boolean not null default false,
  active boolean not null default true,
  source text,
  pool jsonb not null default '[]'::jsonb,   -- [{closer:'clement', prio:'haute'|'moyenne'|'basse'|'off'}]
  rules jsonb not null default '[]'::jsonb,  -- [{closer:'clement', capital:['gt3000'], situation:['Entrepreneur'], source:'instagram'}] : la 1re règle qui correspond gagne
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cand_events_one_main on public.cand_events (main) where main;
alter table public.cand_events enable row level security;
drop policy if exists "cand_events: équipe" on public.cand_events;
create policy "cand_events: équipe" on public.cand_events for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- Départ : même comportement qu'avant (tout va à Clément), à toi de régler ensuite.
insert into public.cand_events (name, main, pool) select 'Lien principal', true, '[{"closer":"clement","prio":"haute"}]'::jsonb
 where not exists (select 1 from public.cand_events where main);

alter table public.candidatures
  add column if not exists event_id bigint references public.cand_events (id) on delete set null,
  add column if not exists route_note text;

-- Qui prend l'appel ? (forced = closer imposé par un lien personnel)
create or replace function private.cand_route(p_slug text, p_cap text, p_sit text, p_src text, p_forced text, out o_closer text, out o_event bigint, out o_why text)
language plpgsql stable security definer set search_path = public, private as $$
declare ev public.cand_events; r jsonb; n int := 0; k text;
begin
  select * into ev from public.cand_events where slug = nullif(p_slug, '') and active;
  if not found then select * into ev from public.cand_events where main; end if;
  o_event := ev.id;
  if coalesce(p_forced, '') <> '' and exists (select 1 from public.cand_closers where key = p_forced and active) then
    o_closer := p_forced; o_why := 'Lien personnel du closer'; return;
  end if;
  for r in select value from jsonb_array_elements(coalesce(ev.rules, '[]'::jsonb)) loop
    n := n + 1; k := r ->> 'closer';
    continue when not exists (select 1 from public.cand_closers where key = k and active);
    if (jsonb_array_length(coalesce(r -> 'capital', '[]'::jsonb)) = 0 or jsonb_exists(r -> 'capital', coalesce(p_cap, '')))
       and (jsonb_array_length(coalesce(r -> 'situation', '[]'::jsonb)) = 0 or jsonb_exists(r -> 'situation', coalesce(p_sit, '')))
       and (coalesce(r ->> 'source', '') = '' or position(lower(r ->> 'source') in lower(coalesce(p_src, ''))) > 0) then
      o_closer := k; o_why := 'Règle ' || n; return;
    end if;
  end loop;
  select x.key, x.lbl into o_closer, o_why from (
    select c.key, 'Priorité ' || (case pj ->> 'prio' when 'haute' then 'haute' when 'moyenne' then 'moyenne' else 'basse' end) as lbl,
           case pj ->> 'prio' when 'haute' then 1 when 'moyenne' then 2 else 3 end as rk,
           (select count(*) from public.candidatures q where q.closer = c.key and q.status in ('reserve', 'confirme') and q.starts_at > now()) as up,
           (select coalesce(max(q.created_at), 'epoch'::timestamptz) from public.candidatures q where q.closer = c.key) as last
      from jsonb_array_elements(coalesce(ev.pool, '[]'::jsonb)) pj
      join public.cand_closers c on c.key = pj ->> 'closer' and c.active
     where coalesce(pj ->> 'prio', '') in ('haute', 'moyenne', 'basse')
  ) x order by x.rk, x.up, x.last limit 1;
  if o_closer is null then o_closer := 'clement'; o_why := 'Par défaut (aucun closer dans la priorité)'; end if;
end $$;
revoke all on function private.cand_route(text, text, text, text, text) from public, anon, authenticated;

-- Simulateur pour l'équipe : « si quelqu'un avec ce profil réserve, à qui ça tombe ? »
create or replace function public.cand_route_test(p_event bigint, p_cap text, p_sit text, p_src text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare slug text; r record; nm text;
begin
  if not public.is_staff() then raise exception 'Accès refusé'; end if;
  select e.slug into slug from public.cand_events e where e.id = p_event;
  select * into r from private.cand_route(slug, p_cap, p_sit, p_src, '');
  select name into nm from public.cand_closers where key = r.o_closer;
  return jsonb_build_object('closer', r.o_closer, 'name', nm, 'why', r.o_why);
end $$;
grant execute on function public.cand_route_test(bigint, text, text, text) to authenticated;

-- Page de réservation : nom/origine de l'événement (public, rien de sensible)
create or replace function public.cand_event_info(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'source', source) from public.cand_events where slug = lower(nullif(trim(p_slug), '')) and active
$$;
grant execute on function public.cand_event_info(text) to anon, authenticated;

-- Réservation : même fonction qu'avant, mais le closer vient de la répartition ci-dessus
create or replace function public.cand_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; st public.settings; t timestamptz := (p ->> 'starts_at')::timestamptz; t2 timestamptz;
  em text := lower(trim(coalesce(p ->> 'email', ''))); nm text := left(trim(coalesce(p ->> 'first_name', '')), 80); ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  cap text := p ->> 'capital'; bid bigint; whenfr text; ics text; glink text;
  cl public.cand_closers; ck text := lower(trim(coalesce(p ->> 'closer', ''))); wan text; rt record; ev_slug text := lower(trim(coalesce(p ->> 'event', '')));
begin
  select * into s from public.cand_settings where id = 1;
  select * into st from public.settings where id = 1;
  if ck = '9512' then ck := 'amandine'; end if;
  -- Qui prend l'appel : lien personnel du closer > règles par profil de l'événement > priorité des closers.
  select * into rt from private.cand_route(ev_slug, cap, p ->> 'situation', p ->> 'src', ck);
  select * into cl from public.cand_closers where key = rt.o_closer;
  if not found then select * into cl from public.cand_closers where key = 'clement'; end if;
  wan := case when cl.key = 'clement' then s.wa_number else cl.wa_number end;
  if nm = '' then raise exception 'Indique ton prénom.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Vérifie ton adresse email.'; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then raise exception 'Vérifie ton numéro WhatsApp.'; end if;
  if cap not in ('500-1000', '1000-3000', 'gt3000') or coalesce(p ->> 'budget_confirmed', '') <> 'yes' then raise exception 'Cet appel est réservé aux personnes qui ont le budget disponible maintenant.'; end if;
  if t is null or not (public.cand_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
  t2 := t + make_interval(mins => s.slot_min);
  begin
    insert into public.candidatures (first_name, phone, email, situation, capital, budget_confirmed, starts_at, minutes, closer, event_id, route_note)
    values (nm, ph, em, left(p ->> 'situation', 40), cap, 'yes', t, s.slot_min, cl.key, rt.o_event, rt.o_why) returning id into bid;
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
