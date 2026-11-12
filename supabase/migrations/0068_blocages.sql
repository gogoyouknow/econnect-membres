-- Blocage volontaire de prospects (no-show, silence radio…) par email, téléphone ou adresse IP.
-- On capte maintenant l'IP à chaque fiche et à chaque réservation ; un prospect bloqué ne peut plus réserver et reçoit un message clair.

alter table public.candidatures add column if not exists ip text;
alter table public.cand_leads add column if not exists ip text;

create or replace function private.client_ip() returns text language plpgsql stable as $$
declare h jsonb; v text;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  if h is null then return null; end if;
  v := coalesce(nullif(h ->> 'cf-connecting-ip', ''), nullif(h ->> 'x-real-ip', ''), nullif(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1), ''));
  return nullif(left(trim(v), 64), '');
end $$;

-- Formes normalisées : un blocage vaut pour toutes les écritures d'une même adresse (points Gmail, +alias) ou d'un même numéro (06… / +33 6…).
create or replace function private.norm_email(e text) returns text language sql immutable as $$
  select case
    when position('@' in coalesce(e, '')) = 0 then lower(trim(coalesce(e, '')))
    when lower(split_part(trim(e), '@', 2)) in ('gmail.com', 'googlemail.com') then replace(split_part(split_part(lower(trim(e)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(trim(e)), '@', 1), '+', 1) || '@' || lower(split_part(trim(e), '@', 2)) end
$$;
create or replace function private.norm_phone(p text) returns text language sql immutable as $$
  select case when length(d) >= 9 then right(d, 9) else '' end from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create table if not exists public.cand_blocks (
  id bigserial primary key,
  kind text not null check (kind in ('email', 'phone', 'ip')),
  value text not null,            -- forme normalisée (sert à comparer)
  shown text,                     -- valeur lisible
  reason text not null default 'no_show' check (reason in ('no_show', 'silence', 'autre')),
  note text,
  cand_id bigint,
  lead_id bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index if not exists cand_blocks_uniq on public.cand_blocks (kind, value) where active;
create table if not exists public.cand_block_hits (
  id bigserial primary key,
  block_id bigint not null references public.cand_blocks (id) on delete cascade,
  at timestamptz not null default now(),
  via text,
  first_name text,
  ip text
);
create index if not exists cand_block_hits_b on public.cand_block_hits (block_id, at desc);
alter table public.cand_blocks enable row level security;
alter table public.cand_block_hits enable row level security;
drop policy if exists "cand_blocks: admin lit" on public.cand_blocks;
create policy "cand_blocks: admin lit" on public.cand_blocks for select to authenticated using (public.is_admin());
drop policy if exists "cand_block_hits: admin lit" on public.cand_block_hits;
create policy "cand_block_hits: admin lit" on public.cand_block_hits for select to authenticated using (public.is_admin());

create or replace function private.block_match(em text, ph text, ip text) returns bigint
language sql stable security definer set search_path = public, private as $$
  select b.id from public.cand_blocks b
   where b.active and (
     (b.kind = 'email' and coalesce(em, '') <> '' and b.value = private.norm_email(em))
  or (b.kind = 'phone' and private.norm_phone(ph) <> '' and b.value = private.norm_phone(ph))
  or (b.kind = 'ip' and coalesce(ip, '') <> '' and b.value = ip))
   order by b.id limit 1
$$;

-- Appelée par la page de candidature dès que le prospect donne son email / numéro : l'écran de blocage s'affiche tout de suite.
create or replace function public.cand_blocked(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare bm bigint; ip_ text := private.client_ip();
begin
  bm := private.block_match(p ->> 'email', p ->> 'phone', ip_);
  if bm is null then return jsonb_build_object('blocked', false); end if;
  insert into public.cand_block_hits (block_id, via, first_name, ip) values (bm, 'formulaire', left(coalesce(p ->> 'first_name', ''), 80), ip_);
  return jsonb_build_object('blocked', true, 'reason', (select reason from public.cand_blocks where id = bm));
end $$;
grant execute on function public.cand_blocked(jsonb) to anon, authenticated;

-- Bloquer (admin) : depuis une candidature ou une fiche prospect, ou à la main (email / téléphone / IP).
create or replace function public.block_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c public.candidatures; l public.cand_leads; em text; ph text; ips text[] := '{}'; ip_ text; k text; n int := 0; nc int := 0; nm int := 0;
  rs text := coalesce(nullif(p ->> 'reason', ''), 'no_show'); nt text := left(trim(coalesce(p ->> 'note', '')), 300);
  kinds text[] := case when jsonb_typeof(p -> 'kinds') = 'array' then array(select jsonb_array_elements_text(p -> 'kinds')) else array['email', 'phone'] end;
  cid bigint := nullif(p ->> 'cand_id', '')::bigint; lid bigint := nullif(p ->> 'lead_id', '')::bigint; cancel boolean := coalesce((p ->> 'cancel')::boolean, true);
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  if rs not in ('no_show', 'silence', 'autre') then rs := 'autre'; end if;
  if cid is not null then select * into c from public.candidatures where id = cid; em := c.email; ph := c.phone; if c.ip is not null then ips := ips || c.ip; end if; end if;
  if lid is not null then select * into l from public.cand_leads where id = lid; em := coalesce(em, l.email, l.email_raw); ph := coalesce(ph, l.phone, l.phone_raw); if l.ip is not null then ips := ips || l.ip; end if; end if;
  em := coalesce(nullif(lower(trim(p ->> 'email')), ''), em); ph := coalesce(nullif(trim(p ->> 'phone'), ''), ph);
  if nullif(trim(p ->> 'ip'), '') is not null then ips := ips || trim(p ->> 'ip'); end if;
  if coalesce(em, '') = '' and private.norm_phone(ph) = '' and cardinality(ips) = 0 then raise exception 'Rien à bloquer : indique un email, un téléphone ou une IP.'; end if;
  if em is not null and exists (select 1 from public.profiles pr where lower(pr.email) = lower(em)) then raise exception 'Cet email appartient à un compte de l''équipe : on ne le bloque pas.'; end if;
  -- toutes les IP déjà vues pour cette même personne
  select coalesce(array_agg(distinct x), '{}') into ips from (
    select unnest(ips) x
    union select x.ip from public.cand_leads x where x.ip is not null and ((em is not null and private.norm_email(x.email) = private.norm_email(em)) or (private.norm_phone(ph) <> '' and private.norm_phone(coalesce(x.phone, x.phone_raw)) = private.norm_phone(ph)))
    union select x.ip from public.candidatures x where x.ip is not null and ((em is not null and private.norm_email(x.email) = private.norm_email(em)) or (private.norm_phone(ph) <> '' and private.norm_phone(x.phone) = private.norm_phone(ph)))
  ) q where x is not null;
  if 'email' = any (kinds) and coalesce(em, '') <> '' then
    insert into public.cand_blocks (kind, value, shown, reason, note, cand_id, lead_id) values ('email', private.norm_email(em), em, rs, nullif(nt, ''), cid, lid) on conflict (kind, value) where active do nothing; n := n + 1; end if;
  if 'phone' = any (kinds) and private.norm_phone(ph) <> '' then
    insert into public.cand_blocks (kind, value, shown, reason, note, cand_id, lead_id) values ('phone', private.norm_phone(ph), ph, rs, nullif(nt, ''), cid, lid) on conflict (kind, value) where active do nothing; n := n + 1; end if;
  if 'ip' = any (kinds) then
    foreach ip_ in array ips loop
      insert into public.cand_blocks (kind, value, shown, reason, note, cand_id, lead_id) values ('ip', ip_, ip_, rs, nullif(nt, ''), cid, lid) on conflict (kind, value) where active do nothing; n := n + 1;
    end loop; end if;
  -- on ferme aussi ce qui est en cours pour cette personne
  update public.cand_leads x set follow = 'skip' where (em is not null and private.norm_email(x.email) = private.norm_email(em)) or (private.norm_phone(ph) <> '' and private.norm_phone(coalesce(x.phone, x.phone_raw)) = private.norm_phone(ph));
  update public.mail_enroll e set status = 'stop', stop_reason = 'bloque' from public.cand_leads x
   where x.id = e.lead_id and e.status = 'actif' and ((em is not null and private.norm_email(x.email) = private.norm_email(em)) or (private.norm_phone(ph) <> '' and private.norm_phone(coalesce(x.phone, x.phone_raw)) = private.norm_phone(ph)));
  update public.mail_out o set status = 'annule' from public.cand_leads x
   where x.id = o.lead_id and o.status = 'attente' and ((em is not null and private.norm_email(x.email) = private.norm_email(em)) or (private.norm_phone(ph) <> '' and private.norm_phone(coalesce(x.phone, x.phone_raw)) = private.norm_phone(ph)));
  if cancel then
    update public.candidatures x set status = 'annule', note = trim(coalesce(x.note, '') || ' [bloqué]')
     where x.status in ('reserve', 'confirme') and x.starts_at > now() and ((em is not null and private.norm_email(x.email) = private.norm_email(em)) or (private.norm_phone(ph) <> '' and private.norm_phone(x.phone) = private.norm_phone(ph)));
    get diagnostics nc = row_count;
  end if;
  return jsonb_build_object('ok', true, 'blocks', n, 'ips', cardinality(ips), 'cancelled', nc);
end $$;
grant execute on function public.block_add(jsonb) to authenticated;

create or replace function public.block_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  update public.cand_blocks set active = false where id = p_id;
end $$;
grant execute on function public.block_remove(bigint) to authenticated;

-- Plus aucun email de séquence pour un prospect bloqué.
create or replace function private.mail_lead_ok(l public.cand_leads) returns boolean
language sql stable set search_path = public as $$
  select coalesce(l.email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and l.consent_at is not null and l.unsub_at is null
     and not private.geo_blocked(coalesce(l.phone, l.phone_raw)) and l.sid !~ '^(imp|man|cand)-' and coalesce(l.follow, 'new') <> 'skip'
     and private.block_match(l.email, coalesce(l.phone, l.phone_raw), l.ip) is null
$$;

create or replace function public.cand_lead(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sid text := left(coalesce(p ->> 'sid', ''), 64);
  em_raw text := left(trim(coalesce(p ->> 'email', '')), 120);
  ph_raw text := left(trim(coalesce(p ->> 'phone_raw', p ->> 'phone', '')), 40);
  em text := lower(em_raw);
  ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  nm text := left(trim(coalesce(p ->> 'first_name', '')), 80);
  st text := coalesce(p ->> 'step', 'who');
  src text := left(trim(coalesce(p ->> 'source', '')), 60);
  ref text := left(trim(coalesce(p ->> 'referrer', '')), 200);
  lnd text := left(trim(coalesce(p ->> 'landing', '')), 200);
  ut jsonb := case when jsonb_typeof(p -> 'utm') = 'object' then p -> 'utm' else null end;
  lid bigint; ip_ text := private.client_ip();
  ranks text[] := array['who', 'situ', 'budget', 'slot'];
begin
  if length(v_sid) < 8 then return; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then em := ''; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then ph := ''; end if;
  if nm = '' and em_raw = '' and length(regexp_replace(ph_raw, '\D', '', 'g')) = 0 then return; end if;
  if not (st = any (ranks)) then st := 'who'; end if;

  select id into lid from public.cand_leads
   where sid = v_sid or (em <> '' and lower(email) = em) or (ph <> '' and phone = ph)
   order by (sid = v_sid) desc, updated_at desc limit 1;

  if lid is null then
    insert into public.cand_leads (sid, first_name, phone, email, phone_raw, email_raw, situation, capital, budget_confirmed, step, source, referrer, landing, utm, experience, blocage, invest, consent_at, ip)
    values (v_sid, nullif(nm, ''), nullif(ph, ''), nullif(em, ''), nullif(ph_raw, ''), nullif(em_raw, ''),
            nullif(left(p ->> 'situation', 40), ''), nullif(left(p ->> 'capital', 20), ''), nullif(left(p ->> 'budget_confirmed', 10), ''), st,
            nullif(src, ''), nullif(ref, ''), nullif(lnd, ''), ut,
            nullif(left(p ->> 'experience', 40), ''), nullif(left(p ->> 'blocage', 2000), ''), nullif(left(p ->> 'invest', 40), ''), case when p ->> 'consent' = '1' then now() end, nullif(ip_, ''));
  else
    update public.cand_leads l set
      updated_at = now(),
      ip = coalesce(nullif(ip_, ''), l.ip),
      first_name = coalesce(nullif(nm, ''), l.first_name),
      phone = coalesce(nullif(ph, ''), l.phone),
      email = coalesce(nullif(em, ''), l.email),
      phone_raw = coalesce(nullif(ph_raw, ''), l.phone_raw),
      email_raw = coalesce(nullif(em_raw, ''), l.email_raw),
      situation = coalesce(nullif(left(p ->> 'situation', 40), ''), l.situation),
      capital = coalesce(nullif(left(p ->> 'capital', 20), ''), l.capital),
      budget_confirmed = coalesce(nullif(left(p ->> 'budget_confirmed', 10), ''), l.budget_confirmed),
      experience = coalesce(nullif(left(p ->> 'experience', 40), ''), l.experience),
      blocage = coalesce(nullif(left(p ->> 'blocage', 2000), ''), l.blocage),
      invest = coalesce(nullif(left(p ->> 'invest', 40), ''), l.invest),
      consent_at = coalesce(l.consent_at, case when p ->> 'consent' = '1' then now() end),
      source = coalesce(l.source, nullif(src, '')),
      referrer = coalesce(l.referrer, nullif(ref, '')),
      landing = coalesce(l.landing, nullif(lnd, '')),
      utm = coalesce(l.utm, ut),
      step = case when array_position(ranks, st) > array_position(ranks, l.step) then st else l.step end
    where l.id = lid;
  end if;
  -- Prospect bloqué : on garde la fiche mais plus aucune relance.
  if private.block_match(em, ph, ip_) is not null then
    update public.cand_leads set follow = 'skip' where id = coalesce(lid, (select id from public.cand_leads where sid = v_sid limit 1));
  end if;
end $$;
grant execute on function public.cand_lead(jsonb) to anon, authenticated;

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
  if t is null or not (public.cand_slots() @> to_jsonb(t)) then raise exception 'Ce créneau vient d''être pris, choisis-en un autre.'; end if;
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
