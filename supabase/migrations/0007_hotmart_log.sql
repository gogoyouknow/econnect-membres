-- Diagnostic : on journalise aussi les appels refusés, et on force PostgREST à recharger ses fonctions
create or replace function public.hotmart_webhook(jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  payload jsonb := $1;
  tok text; expected text; ev text; em text; prod text; off text; plan text; price numeric; t int; st text; hdr jsonb;
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

  t := case when coalesce(prod,'') || ' ' || coalesce(plan,'') || ' ' || coalesce(off,'') ilike '%acc_l_ration%'
              or coalesce(price,0) >= 400 then 2 else 1 end;

  if em is null or em = '' then
    insert into public.hotmart_events(event, payload, status) values (ev, payload, 'ignored: no email');
    return jsonb_build_object('ok', true, 'ignored', 'no email');
  end if;

  if ev in ('PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_REACTIVATED','approved','completed') then
    insert into public.allowed_emails(email, tier, role, source) values (em, t, 'member', 'hotmart')
      on conflict (email) do update set tier = greatest(public.allowed_emails.tier, excluded.tier), source = 'hotmart';
    update public.profiles set active = true, tier = greatest(tier, t) where lower(email) = em;
    st := 'access granted (tier ' || t || ')';
  elsif ev in ('PURCHASE_CANCELED','PURCHASE_REFUNDED','PURCHASE_CHARGEBACK','SUBSCRIPTION_CANCELLATION','PURCHASE_EXPIRED','canceled','refunded','chargeback') then
    update public.profiles set active = false where lower(email) = em and role = 'member';
    delete from public.allowed_emails where email = em and source = 'hotmart' and not exists (select 1 from public.profiles where lower(email) = em);
    st := 'access revoked';
  else
    st := 'ignored: ' || coalesce(ev, '?');
  end if;

  insert into public.hotmart_events(event, email, product, offer, price, status, payload) values (ev, em, prod, off, price, st, payload);
  return jsonb_build_object('ok', true, 'status', st);
end $$;

grant execute on function public.hotmart_webhook(jsonb) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

-- vérification : la fonction existe et le jeton est bien enregistré (on n'affiche que le début)
