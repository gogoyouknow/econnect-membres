-- 0064 : les appels réservés dans Calio sont ajoutés (et déplacés / supprimés) automatiquement dans Google Agenda
-- via l'API Google (scope calendar.events). Le sens inverse (agenda → créneaux bloqués) existait déjà (0021 / 0038).

alter table public.candidatures add column if not exists gcal_event_id text;
alter table public.candidatures add column if not exists gcal_sig text;
create table if not exists private.gcal_del (event_id text primary key, at timestamptz not null default now());

create or replace function private.cand_gcal_sig(c public.candidatures) returns text language sql immutable as
$$ select md5(concat_ws('|', c.starts_at, c.minutes, c.first_name, c.closer, c.status, c.phone)) $$;

-- droit d'écriture accordé ?
create or replace function public.gcal_set_write_for_fn(p boolean) returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  if p then insert into private.secrets (key, value) values ('google_write', '1') on conflict (key) do update set value = '1';
  else delete from private.secrets where key = 'google_write'; end if;
  return p;
end $$;

drop function if exists public.gcal_save_refresh_for_fn(text);
create or replace function public.gcal_save_refresh_for_fn(p_refresh text, p_write boolean default false) returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.secrets (key, value) values ('google_refresh', p_refresh) on conflict (key) do update set value = excluded.value;
  delete from private.secrets where key in ('google_state', 'gcal_ics');
  perform public.gcal_set_write_for_fn(coalesce(p_write, false));
  -- tout ce qui existe déjà et n'est pas encore dans l'agenda sera ajouté à la prochaine synchro
  return true;
end $$;

create or replace function public.gcal_oauth_for_fn() returns jsonb language sql security definer stable set search_path = public, private as
$$ select jsonb_build_object(
     'client_id', (select value from private.secrets where key = 'google_client_id'),
     'client_secret', (select value from private.secrets where key = 'google_client_secret'),
     'state', (select value from private.secrets where key = 'google_state'),
     'refresh', (select value from private.secrets where key = 'google_refresh'),
     'write', exists (select 1 from private.secrets where key = 'google_write')) $$;

create or replace function public.gcal_disconnect() returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  delete from private.secrets where key in ('google_refresh', 'google_state', 'gcal_ics', 'google_write');
  delete from public.busy_times where true;
  update public.candidatures set gcal_event_id = null, gcal_sig = null where gcal_event_id is not null;
  return true;
end $$;

create or replace function public.gcal_status() returns jsonb language sql stable security definer set search_path = public, private as
$$ select jsonb_build_object(
     'set', exists (select 1 from private.secrets where key in ('google_refresh', 'gcal_ics')),
     'mode', case when exists (select 1 from private.secrets where key = 'google_refresh') then 'google' when exists (select 1 from private.secrets where key = 'gcal_ics') then 'ics' else null end,
     'oauth_ready', exists (select 1 from private.secrets where key = 'google_client_id') and exists (select 1 from private.secrets where key = 'google_client_secret'),
     'write', exists (select 1 from private.secrets where key = 'google_write'),
     'in_agenda', (select count(*) from public.candidatures where gcal_event_id is not null and starts_at > now() - interval '1 day'),
     'synced_at', (select max(synced_at) from public.busy_times),
     'busy', (select count(*) from public.busy_times where ends_at > now())) $$;

-- liste de ce qu'il faut créer / modifier / supprimer dans Google Agenda (lue par la fonction Edge gcal-sync)
create or replace function public.gcal_push_queue_for_fn() returns jsonb language plpgsql security definer set search_path = public, private as $$
declare out jsonb := '[]'::jsonb; r record; ttl text;
begin
  if not exists (select 1 from private.secrets where key = 'google_write') then return out; end if;
  for r in
    select c.id, c.gcal_event_id, c.status, c.starts_at, c.minutes, c.first_name, c.phone, c.email, c.closer, coalesce(cl.name, 'Clément') as cname, private.cand_gcal_sig(c) as sig
    from public.candidatures c left join public.cand_closers cl on cl.key = c.closer
    where (c.gcal_event_id is null and c.status in ('reserve', 'confirme') and c.starts_at > now())
       or (c.gcal_event_id is not null and (c.status = 'annule' or c.gcal_sig is distinct from private.cand_gcal_sig(c)))
    order by c.id limit 30
  loop
    ttl := (case r.status when 'reserve' then '⏳ ' when 'confirme' then '✅ ' when 'fait' then '☑️ ' when 'absent' then '❌ ' else '' end)
        || 'Appel · ' || coalesce(nullif(r.first_name, ''), 'candidat')
        || case when r.closer is not null and r.closer <> 'clement' then ' (' || r.cname || ')' else '' end;
    out := out || jsonb_build_object(
      'id', r.id,
      'act', case when r.status = 'annule' then 'delete' when r.gcal_event_id is null then 'create' else 'update' end,
      'event', r.gcal_event_id,
      'start', r.starts_at, 'end', r.starts_at + make_interval(mins => coalesce(r.minutes, 45)),
      'summary', ttl,
      'desc', 'WhatsApp ' || coalesce(r.phone, '—') || E'\n' || coalesce(r.email, '') || E'\n' || case r.status when 'reserve' then 'En attente de son message WhatsApp.' when 'confirme' then 'Confirmé.' else '' end || E'\n' || 'Détails : https://rdv.theambitiousman.fr/admin',
      'sig', r.sig);
  end loop;
  for r in select event_id from private.gcal_del limit 30 loop
    out := out || jsonb_build_object('id', null, 'act', 'delete', 'event', r.event_id);
  end loop;
  return out;
end $$;

create or replace function public.gcal_push_done_for_fn(p_id bigint, p_event text, p_sig text) returns boolean language plpgsql security definer set search_path = public, private as $$
begin
  if p_id is null then delete from private.gcal_del where event_id = p_event; return true; end if;
  update public.candidatures set gcal_event_id = p_event, gcal_sig = case when p_event is null then null else p_sig end where id = p_id;
  return true;
end $$;

revoke all on function public.gcal_set_write_for_fn(boolean), public.gcal_save_refresh_for_fn(text, boolean), public.gcal_oauth_for_fn(), public.gcal_push_queue_for_fn(), public.gcal_push_done_for_fn(bigint, text, text) from public, anon, authenticated;
grant execute on function public.gcal_set_write_for_fn(boolean), public.gcal_save_refresh_for_fn(text, boolean), public.gcal_oauth_for_fn(), public.gcal_push_queue_for_fn(), public.gcal_push_done_for_fn(bigint, text, text) to service_role;
revoke all on function public.gcal_disconnect(), public.gcal_status() from public, anon;
grant execute on function public.gcal_disconnect(), public.gcal_status() to authenticated;

-- changement d'un appel (nouvelle réservation, déplacement, annulation…) → synchro tout de suite
create or replace function private.cand_gcal_trg() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'DELETE' then
    if old.gcal_event_id is not null then insert into private.gcal_del (event_id) values (old.gcal_event_id) on conflict do nothing; end if;
  elsif tg_op = 'UPDATE' and old.gcal_event_id is not null and new.gcal_event_id is distinct from old.gcal_event_id and new.gcal_event_id is not null then
    return new;  -- simple écriture de l'identifiant par la synchro
  end if;
  if exists (select 1 from private.secrets where key = 'google_write') then
    begin perform private.gcal_kick(); exception when others then null; end;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists cand_gcal on public.candidatures;
create trigger cand_gcal after insert or delete or update of starts_at, status, first_name, closer, phone, minutes on public.candidatures
  for each row execute function private.cand_gcal_trg();

-- Les invitations .ics envoyées à Clément font doublon avec l'ajout automatique : on les retire dès que celui-ci est actif.
create or replace function private.send_email_ics(to_email text, subject text, html text, ics text, from_name text default 'L''Accélérateur') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint; rt text; body jsonb;
begin
  select value into k from private.secrets where key = 'resend';
  if k is null then return null; end if;
  rt := coalesce((select booking_email from public.settings limit 1), 'contact@theambitiousman.fr');
  body := jsonb_build_object('from', from_name || ' <laccelerateur@theambitiousman.fr>', 'to', jsonb_build_array(to_email), 'subject', subject, 'html', html, 'reply_to', rt);
  if not (subject like 'Candidature ·%' and exists (select 1 from private.secrets where key = 'google_write')) then
    body := body || jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('filename', 'invitation.ics', 'content', encode(convert_to(ics, 'UTF8'), 'base64'), 'content_type', 'text/calendar; method=REQUEST')));
  end if;
  select net.http_post(url := 'https://api.resend.com/emails', headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'), body := body) into rid;
  return rid;
end $$;
