-- 0008 : upgrade vers l'accompagnement personnalisé + infos de résiliation (réglables dans Admin)
alter table public.settings
  add column if not exists upgrade_url text default '',
  add column if not exists upgrade_offer_code text default '',
  add column if not exists cancel_email text default 'resiliation@theambitiousman.fr',
  add column if not exists cancel_text text default 'Pour ne pas être prélevé le mois suivant, ta demande doit nous parvenir avant la fin du mois en cours (au plus tard le dernier jour du mois, 23 h 59). Passé ce délai, la résiliation prend effet le mois d''après.';

-- Le webhook reconnaît l'offre d'upgrade par son code (prioritaire sur le prix)
create or replace function public.hotmart_webhook(jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  payload jsonb := $1;
  tok text; expected text; ev text; em text; prod text; off text; plan text; price numeric; t int; st text; hdr jsonb; upcode text;
begin
  select value into expected from private.secrets where key = 'hotmart_hottok';
  hdr := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  tok := coalesce(hdr ->> 'x-hotmart-hottok', payload ->> 'hottok');

  ev    := coalesce(payload ->> 'event', payload ->> 'status');
  em    := lower(trim(coalesce(payload #>> '{data,buyer,email}', payload ->> 'email')));
  prod  := coalesce(payload #>> '{data,product,name}', payload ->> 'prod_name');
  off   := coalesce(payload #>> '{data,purchase,offer,code}', payload ->> 'off');
  plan  := payload #>> '{data,subscription,plan,name}';
  price := nullif(coalesce(payload #>> '{data,purchase,price,value}', payload ->> 'price'), '')::numeric;

  if expected is null or tok is distinct from expected then
    insert into public.hotmart_events(event, email, product, status, payload)
      values (ev, em, prod, 'REFUSED: hottok ' || case when tok is null then 'absent' else 'différent (' || left(tok, 6) || '…)' end, payload);
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select nullif(trim(upgrade_offer_code), '') into upcode from public.settings where id = 1;
  t := case when (upcode is not null and off = upcode)
              or coalesce(prod,'') || ' ' || coalesce(plan,'') || ' ' || coalesce(off,'') ilike '%acc_l_ration%'
              or coalesce(prod,'') || ' ' || coalesce(plan,'') ilike '%personnalis%'
              or coalesce(price,0) >= 400 then 2 else 1 end;

  if em is null or em = '' then
    insert into public.hotmart_events(event, payload, status) values (ev, payload, 'ignored: no email');
    return jsonb_build_object('ok', true, 'ignored', 'no email');
  end if;

  if ev in ('PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_REACTIVATED','approved','completed') then
    insert into public.allowed_emails(email, tier, role, source) values (em, t, 'member', 'hotmart')
      on conflict (email) do update set tier = greatest(public.allowed_emails.tier, excluded.tier), source = 'hotmart';
    update public.profiles set active = true, tier = greatest(tier, t) where lower(email) = em;
    if t = 2 then
      insert into public.notifications (user_id, title, body, url)
        select id, 'Bienvenue dans l''accompagnement personnalisé 🚀', 'Ton accès au groupe Accélération est ouvert.', '#acceleration' from public.profiles where lower(email) = em;
    end if;
    st := 'access granted (tier ' || t || ')';
  elsif ev in ('PURCHASE_CANCELED','PURCHASE_REFUNDED','PURCHASE_CHARGEBACK','SUBSCRIPTION_CANCELLATION','PURCHASE_EXPIRED','canceled','refunded','chargeback') then
    -- annulation de l'ancien abonnement 250 € après un upgrade : on ne coupe pas un membre Accélération
    if upcode is not null and off is distinct from upcode and exists (select 1 from public.profiles where lower(email) = em and tier = 2) then
      st := 'ignored: ancien abonnement remplacé par l''upgrade';
    else
      update public.profiles set active = false where lower(email) = em and role = 'member';
      delete from public.allowed_emails where email = em and source = 'hotmart' and not exists (select 1 from public.profiles where lower(email) = em);
      st := 'access revoked';
    end if;
  else
    st := 'ignored: ' || coalesce(ev, '?');
  end if;

  insert into public.hotmart_events(event, email, product, offer, price, status, payload) values (ev, em, prod, off, price, st, payload);
  return jsonb_build_object('ok', true, 'status', st);
end $$;
grant execute on function public.hotmart_webhook(jsonb) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
