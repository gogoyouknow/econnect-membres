-- 1) Les réponses des prospects à nos emails arrivent dans la boîte de Clément (adresse de réception des RDV, réglée dans Calio).
create or replace function private.send_email(to_email text, subject text, html text, from_name text default 'L''Accélérateur') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint; rt text;
begin
  select value into k from private.secrets where key = 'resend';
  if k is null then raise notice 'resend key missing'; return null; end if;
  rt := coalesce((select booking_email from public.settings limit 1), 'contact@theambitiousman.fr');
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', from_name || ' <laccelerateur@theambitiousman.fr>', 'to', jsonb_build_array(to_email), 'subject', subject, 'html', html, 'reply_to', rt)
  ) into rid;
  return rid;
end $$;

create or replace function private.send_email_ics(to_email text, subject text, html text, ics text, from_name text default 'L''Accélérateur') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint; rt text;
begin
  select value into k from private.secrets where key = 'resend';
  if k is null then return null; end if;
  rt := coalesce((select booking_email from public.settings limit 1), 'contact@theambitiousman.fr');
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', from_name || ' <laccelerateur@theambitiousman.fr>', 'to', jsonb_build_array(to_email), 'subject', subject, 'html', html, 'reply_to', rt,
      'attachments', jsonb_build_array(jsonb_build_object('filename', 'invitation.ics', 'content', encode(convert_to(ics, 'UTF8'), 'base64'), 'content_type', 'text/calendar; method=REQUEST')))
  ) into rid;
  return rid;
end $$;

-- Les emails de relance invitent à répondre directement.
update public.cand_templates set body = replace(body, 'Tu préfères en discuter d''abord ? Écris-moi directement sur WhatsApp : {lien_wa}', 'Tu préfères en discuter d''abord ? Réponds simplement à cet email, ou écris-moi directement sur WhatsApp : {lien_wa}') where key = 'mail_relance';
update public.cand_rseq set body = replace(body, 'dis-le-moi : je te réponds.', 'dis-le-moi : réponds simplement à cet email, je te lis.') where pos = 1;

-- 2) Numéros d'Afrique subsaharienne (hors Maghreb, Égypte, Afrique du Sud, La Réunion/Mayotte) : pas d'appel possible, pas de relance.
create or replace function private.geo_blocked(p text) returns boolean
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '[^+0-9]', '', 'g'), '^00', '+') ~ '^\+(22[1-9]|23[1-9]|24[0-9]|25[0-9]|26[013-9]|211)'
$$;

create or replace function private.cand_lead_geo() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT' or new.phone is distinct from old.phone or new.phone_raw is distinct from old.phone_raw)
     and (private.geo_blocked(new.phone) or private.geo_blocked(new.phone_raw)) then
    new.follow := 'skip';
  end if;
  return new;
end $$;
drop trigger if exists cand_lead_geo on public.cand_leads;
create trigger cand_lead_geo before insert or update on public.cand_leads for each row execute function private.cand_lead_geo();

create or replace function private.cand_geo_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null and private.geo_blocked(new.phone) then
    raise exception 'Je ne peux pas encore t''accompagner depuis ton pays.';
  end if;
  return new;
end $$;
drop trigger if exists cand_geo_guard on public.candidatures;
create trigger cand_geo_guard before insert on public.candidatures for each row execute function private.cand_geo_guard();

update public.cand_leads set follow = 'skip' where follow <> 'skip' and not booked and (private.geo_blocked(phone) or private.geo_blocked(phone_raw));
