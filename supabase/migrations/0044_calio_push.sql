-- 0044 : notifications push de Calio (application des appels) : nouveau formulaire (même incomplet) + appel réservé.
-- Les abonnements de Calio sont séparés de ceux de l'app membres (colonne app) pour ne pas recevoir deux fois la même notification.

alter table public.push_subscriptions add column if not exists app text not null default 'membres';

drop function if exists public.push_payload(text, uuid);
create or replace function public.push_payload(p_token text, p_user uuid, p_app text default 'membres') returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_token is distinct from (select value from private.secrets where key = 'push_token') then raise exception 'unauthorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'vapid_public', (select value from private.secrets where key = 'vapid_public'),
    'vapid_private', (select value from private.secrets where key = 'vapid_private'),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', keys)) from public.push_subscriptions where user_id = p_user and app = coalesce(p_app, 'membres')), '[]'::jsonb)
  );
end $$;
revoke all on function public.push_payload(text, uuid, text) from public, anon, authenticated;

-- Envoie une notification à tous les appareils abonnés à Calio.
create or replace function private.notify_calio(p_title text, p_body text, p_url text default '/admin') returns void
language plpgsql security definer set search_path = public, private as $$
declare tok text; u uuid;
begin
  select value into tok from private.secrets where key = 'push_token';
  if tok is null then return; end if;
  for u in select distinct user_id from public.push_subscriptions where app = 'calio' loop
    perform net.http_post(
      url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', tok),
      body := jsonb_build_object('user_id', u, 'app', 'calio', 'title', p_title, 'body', p_body, 'url', p_url)
    );
  end loop;
exception when others then null;  -- une notification ratée ne doit jamais bloquer un formulaire
end $$;

-- Nouveau formulaire enregistré, même incomplet (sauf fiches créées à la main, importées ou issues d'une réservation).
create or replace function private.calio_lead_notif() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare who text;
begin
  if coalesce(new.sid, '') ~ '^(cand-|imp-|man-)' then return new; end if;
  who := coalesce(nullif(trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), ''), nullif(new.phone, ''), nullif(new.phone_raw, ''), nullif(new.email, ''), nullif(new.email_raw, ''), 'Quelqu''un');
  perform private.notify_calio('Nouveau prospect', who || case when coalesce(new.source, '') <> '' then ' · ' || new.source else '' end || ' · formulaire commencé');
  return new;
end $$;
drop trigger if exists calio_lead_notif_trg on public.cand_leads;
create trigger calio_lead_notif_trg after insert on public.cand_leads for each row execute function private.calio_lead_notif();

-- Appel réservé.
create or replace function private.calio_cand_notif() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.notify_calio('Appel réservé', coalesce(nullif(new.first_name, ''), 'Quelqu''un') || ' · ' ||
    to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI'));
  return new;
end $$;
drop trigger if exists calio_cand_notif_trg on public.candidatures;
create trigger calio_cand_notif_trg after insert on public.candidatures for each row execute function private.calio_cand_notif();
