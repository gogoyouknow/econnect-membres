-- 0093 : chaque appel pris avec un closer (Amandine…) lui arrive dans SON Google Agenda, automatiquement.
-- Principe : une invitation d'agenda (.ics) est envoyée par email au closer à chaque réservation, déplacement ou annulation ;
-- Google Agenda / Gmail l'ajoute (ou la met à jour / la retire) sans rien faire. Les rendez-vous déjà pris sont renvoyés une fois (rattrapage).

create table if not exists private.cand_closer_ics_sent (
  cand_id bigint primary key,
  sig text not null,
  sent_at timestamptz not null default now()
);

create or replace function private.send_email_cal(to_email text, subject text, html text, ics text, meth text) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint; rt text; body jsonb;
begin
  select value into k from private.secrets where key = 'resend';
  if k is null then return null; end if;
  rt := coalesce((select booking_email from public.settings limit 1), 'contact@theambitiousman.fr');
  body := jsonb_build_object('from', 'Calio <laccelerateur@theambitiousman.fr>', 'to', jsonb_build_array(to_email), 'subject', subject, 'html', html, 'reply_to', rt,
    'attachments', jsonb_build_array(jsonb_build_object('filename', 'invitation.ics', 'content', encode(convert_to(ics, 'UTF8'), 'base64'), 'content_type', 'text/calendar; method=' || meth)));
  select net.http_post(url := 'https://api.resend.com/emails', headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'), body := body) into rid;
  return rid;
end $$;

-- Envoie (ou met à jour / annule) l'invitation d'agenda d'un appel au closer concerné. Retourne true si un email est parti.
create or replace function private.cand_closer_invite(c public.candidatures) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare cl public.cand_closers; sig text; meth text; seq bigint; t2 timestamptz; nm text; whenfr text; ics text; glink text; sj text; ph text; em text;
begin
  if c.closer is null or c.closer = 'clement' then return false; end if;
  select * into cl from public.cand_closers where key = c.closer;
  if not found or coalesce(trim(cl.email), '') = '' then return false; end if;
  if c.status in ('reserve', 'confirme') and c.starts_at > now() then meth := 'REQUEST';
  elsif c.status = 'annule' and exists (select 1 from private.cand_closer_ics_sent s where s.cand_id = c.id and s.sig <> 'cancel') then meth := 'CANCEL';
  else return false; end if;
  sig := case when meth = 'CANCEL' then 'cancel' else md5(concat_ws('|', c.starts_at, c.minutes, c.first_name, c.phone, c.status, c.closer)) end;
  if exists (select 1 from private.cand_closer_ics_sent s where s.cand_id = c.id and s.sig = sig) then return false; end if;
  seq := extract(epoch from now())::bigint;
  t2 := c.starts_at + make_interval(mins => coalesce(c.minutes, 45));
  nm := coalesce(nullif(trim(c.first_name), ''), 'Candidat'); ph := coalesce(c.phone, '—'); em := coalesce(c.email, '');
  whenfr := private.fr_when(c.starts_at);
  ics := 'BEGIN:VCALENDAR' || E'\r\n' || 'VERSION:2.0' || E'\r\n' || 'PRODID:-//L Accelerateur//Calio//FR' || E'\r\n' || 'METHOD:' || meth || E'\r\n' || 'BEGIN:VEVENT' || E'\r\n'
    || 'UID:cand-' || c.id || '@theambitiousman.fr' || E'\r\n' || 'SEQUENCE:' || seq || E'\r\n' || 'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'DTSTART:' || to_char(c.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n' || 'DTEND:' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || E'\r\n'
    || 'SUMMARY:Appel · ' || nm || E'\r\n' || 'DESCRIPTION:WhatsApp ' || ph || '\n' || em || '\n' || 'Détails dans Calio (Appels)' || E'\r\n'
    || 'ORGANIZER;CN=Calio:mailto:laccelerateur@theambitiousman.fr' || E'\r\n' || 'ATTENDEE;CN=' || cl.name || ';PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:' || cl.email || E'\r\n'
    || 'BEGIN:VALARM' || E'\r\n' || 'ACTION:DISPLAY' || E'\r\n' || 'DESCRIPTION:Appel dans 15 min' || E'\r\n' || 'TRIGGER:-PT15M' || E'\r\n' || 'END:VALARM' || E'\r\n'
    || 'STATUS:' || case when meth = 'CANCEL' then 'CANCELLED' else 'CONFIRMED' end || E'\r\n' || 'END:VEVENT' || E'\r\n' || 'END:VCALENDAR' || E'\r\n';
  glink := 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || replace(replace('Appel · ' || nm, ' ', '%20'), '&', '%26')
    || '&dates=' || to_char(c.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '/' || to_char(t2 at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
    || '&details=' || replace('WhatsApp ' || ph, ' ', '%20') || '&ctz=Europe/Paris';
  sj := case when meth = 'CANCEL' then 'Appel annulé · ' else 'Appel · ' end || whenfr || ' · ' || nm;
  perform private.send_email_cal(cl.email, sj,
    '<p>Salut ' || cl.name || ',</p><p>' || case when meth = 'CANCEL' then 'Cet appel est <b>annulé</b>.' else 'Nouvel appel pour toi : <b>' || nm || '</b>.' end || '</p>'
    || '<p>📅 ' || whenfr || ' (heure de Paris)<br>📱 WhatsApp ' || ph || '</p>'
    || case when meth = 'CANCEL' then '' else '<p>Il s''ajoute tout seul à ton Google Agenda (si ce n''est pas le cas, clique sur « Oui » dans l''invitation, ou <a href="' || glink || '">ajoute-le ici</a>). Tous tes appels sont aussi dans Calio.</p>' end,
    ics, meth);
  insert into private.cand_closer_ics_sent (cand_id, sig) values (c.id, sig) on conflict (cand_id) do update set sig = excluded.sig, sent_at = now();
  return true;
end $$;

create or replace function private.cand_closer_ics_trg() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  begin perform private.cand_closer_invite(new); exception when others then null; end;   -- ne bloque jamais une réservation
  return new;
end $$;
drop trigger if exists cand_closer_ics on public.candidatures;
create trigger cand_closer_ics after insert or update of starts_at, status, first_name, phone, minutes, closer on public.candidatures
  for each row execute function private.cand_closer_ics_trg();

-- Rendez-vous supprimé (ex. libéré faute de message WhatsApp) : il disparaît aussi de l'agenda du closer.
create or replace function private.cand_closer_ics_del() returns trigger language plpgsql security definer set search_path = public, private as $$
declare o public.candidatures := old;
begin
  o.status := 'annule';
  begin perform private.cand_closer_invite(o); exception when others then null; end;
  return old;
end $$;
drop trigger if exists cand_closer_ics_del on public.candidatures;
create trigger cand_closer_ics_del after delete on public.candidatures for each row execute function private.cand_closer_ics_del();

-- Rattrapage : tous les rendez-vous à venir déjà pris avec un closer lui sont envoyés (une seule fois).
create or replace function public.closer_agenda_rattrapage() returns jsonb language plpgsql security definer set search_path = public, private as $$
declare r public.candidatures; n int := 0; manque int := 0;
begin
  if not public.is_staff() then raise exception 'Accès refusé.'; end if;
  for r in select * from public.candidatures where closer is not null and closer <> 'clement' and status in ('reserve', 'confirme') and starts_at > now() order by starts_at loop
    if private.cand_closer_invite(r) then n := n + 1; end if;
  end loop;
  select count(*) into manque from public.cand_closers where key <> 'clement' and active and coalesce(trim(email), '') = '';
  return jsonb_build_object('envoyes', n, 'closers_sans_email', manque);
end $$;
grant execute on function public.closer_agenda_rattrapage() to authenticated;
