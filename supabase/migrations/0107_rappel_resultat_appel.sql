-- 0107 : rappel pour renseigner le résultat et les notes de chaque appel (Clément, Amandine et tout closer).
-- 10 minutes après la fin du créneau (durée du créneau + 10 min), une notification part au closer de l'appel,
-- puis une autre toutes les 3 heures jusqu'à ce que ce soit fait. Chaque closer ne reçoit que ses propres appels.
-- « Fait » = statut « Appel fait » ou « Absent » choisi, avec pour un appel fait : le résultat + une note (+ le montant si signé).
-- Pas de notification entre 23 h et 8 h (heure de Paris) : elle part dès 8 h.
-- Seuls les appels à partir du 19/11 (heure de Paris) sont suivis, pour ne pas relancer tout l'historique.

alter table public.candidatures
  add column if not exists result_push_at timestamptz,
  add column if not exists result_push_n int not null default 0;

-- Notification réservée au closer concerné (notify_calio, elle, prévient aussi tous les non-closers).
-- Retourne vrai si au moins un appareil a été prévenu.
create or replace function private.notify_closer_only(p_title text, p_body text, p_url text, p_closer text) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare tok text; cu uuid; u uuid; n int := 0;
begin
  select value into tok from private.secrets where key = 'push_token';
  if tok is null then return false; end if;
  select user_id into cu from public.cand_closers where key = p_closer;
  -- closer sans compte relié : on retombe sur la notification habituelle
  if cu is null then perform private.notify_calio(p_title, p_body, p_url, p_closer); return true; end if;
  for u in select distinct s.user_id from public.push_subscriptions s where s.app = 'calio' and s.user_id = cu loop
    perform net.http_post(
      url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', tok),
      body := jsonb_build_object('user_id', u, 'app', 'calio', 'title', p_title, 'body', p_body, 'url', p_url)
    );
    n := n + 1;
  end loop;
  return n > 0;
exception when others then return false;
end $$;
revoke all on function private.notify_closer_only(text, text, text, text) from public, anon, authenticated;

create or replace function private.calio_rappel_resultat() returns int
language plpgsql security definer set search_path = public, private as $$
declare c record; n int := 0; h int; sm int; msg text; ttl text; ok boolean;
begin
  h := extract(hour from (now() at time zone 'Europe/Paris'))::int;
  if h >= 23 or h < 8 then return 0; end if;
  select coalesce(slot_min, 45) into sm from public.cand_settings limit 1;
  for c in
    select id, first_name, starts_at, closer, status, outcome, signed_amount, note, result_push_n
      from public.candidatures
     where starts_at >= timestamptz '2026-11-18 23:00:00+00'
       and starts_at + make_interval(mins => coalesce(sm, 45) + 10) <= now()
       and (result_push_at is null or result_push_at <= now() - interval '3 hours')
       and (status in ('reserve', 'confirme')
            or (status = 'fait' and (outcome is null or (outcome = 'signe' and signed_amount is null) or btrim(coalesce(note, '')) = '')))
     order by starts_at
     limit 30
  loop
    msg := case
      when c.status in ('reserve', 'confirme') then 'Appel fait ou absent ? Mets le résultat et tes notes.'
      when c.outcome is null then 'Mets le résultat et tes notes.'
      when c.outcome = 'signe' and c.signed_amount is null and btrim(coalesce(c.note, '')) = '' then 'Indique le montant signé et tes notes.'
      when c.outcome = 'signe' and c.signed_amount is null then 'Indique le montant signé.'
      else 'Ajoute tes notes.' end;
    ttl := case when c.result_push_n = 0 then 'Résultat de l''appel à renseigner' else 'Rappel : résultat de l''appel' end;
    ok := private.notify_closer_only(ttl,
      coalesce(nullif(c.first_name, ''), 'Un prospect') || ' · ' || to_char(c.starts_at at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI') || ' · ' || msg,
      '/admin?appel=' || c.id, c.closer);
    if ok then
      update public.candidatures set result_push_at = now(), result_push_n = result_push_n + 1 where id = c.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.calio_rappel_resultat() from public, anon, authenticated;

-- un appel déplacé repart à zéro (premier rappel 10 minutes après la fin du nouveau créneau)
create or replace function private.calio_resultat_reset() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.starts_at is distinct from old.starts_at then new.result_push_at := null; new.result_push_n := 0; end if;
  return new;
end $$;
drop trigger if exists calio_resultat_reset_trg on public.candidatures;
create trigger calio_resultat_reset_trg before update of starts_at on public.candidatures for each row execute function private.calio_resultat_reset();

do $$ begin perform cron.unschedule('calio-rappel-resultat'); exception when others then null; end $$;
select cron.schedule('calio-rappel-resultat', '*/5 * * * *', 'select private.calio_rappel_resultat()');
