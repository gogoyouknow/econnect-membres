-- 0006 : accès automatique Hotmart → app (webhook reçu directement par la base, sans serveur)
-- Hotmart POST sur https://<projet>.supabase.co/rest/v1/rpc/hotmart_webhook?apikey=<anon>
-- La fonction vérifie le jeton (hottok) envoyé par Hotmart dans l'en-tête X-HOTMART-HOTTOK.

create table if not exists public.hotmart_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  event text, email text, product text, offer text, price numeric, status text, payload jsonb
);
alter table public.hotmart_events enable row level security;
drop policy if exists "hotmart: admin lit" on public.hotmart_events;
create policy "hotmart: admin lit" on public.hotmart_events for select using (public.is_admin());

create or replace function public.hotmart_webhook(jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  payload jsonb := $1;
  tok text; expected text; ev text; em text; nm text; prod text; off text; plan text; price numeric; t int; st text;
begin
  -- 1) sécurité : jeton Hotmart
  select value into expected from private.secrets where key = 'hotmart_hottok';
  tok := coalesce(current_setting('request.headers', true)::jsonb ->> 'x-hotmart-hottok', payload ->> 'hottok');
  if expected is null or tok is distinct from expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- 2) lecture du message (webhook v2, compatible v1)
  ev    := coalesce(payload ->> 'event', payload ->> 'status');
  em    := lower(trim(coalesce(payload #>> '{data,buyer,email}', payload ->> 'email')));
  nm    := coalesce(payload #>> '{data,buyer,name}', payload ->> 'name');
  prod  := coalesce(payload #>> '{data,product,name}', payload ->> 'prod_name');
  off   := coalesce(payload #>> '{data,purchase,offer,code}', payload ->> 'off');
  plan  := payload #>> '{data,subscription,plan,name}';
  price := nullif(coalesce(payload #>> '{data,purchase,price,value}', payload ->> 'price'), '')::numeric;

  -- 3) palier : Accélération si le produit/plan/offre le dit, ou si le prix est >= 400
  t := case when coalesce(prod,'') || ' ' || coalesce(plan,'') || ' ' || coalesce(off,'') ilike '%acc_l_ration%'
              or coalesce(price,0) >= 400 then 2 else 1 end;

  if em is null or em = '' then
    insert into public.hotmart_events(event, payload, status) values (ev, payload, 'ignored: no email');
    return jsonb_build_object('ok', true, 'ignored', 'no email');
  end if;

  if ev in ('PURCHASE_APPROVED','PURCHASE_COMPLETE','SUBSCRIPTION_REACTIVATED','approved','completed') then
    insert into public.allowed_emails(email, tier, role, source)
      values (em, t, 'member', 'hotmart')
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

revoke all on function public.hotmart_webhook(jsonb) from public;
grant execute on function public.hotmart_webhook(jsonb) to anon, service_role;

-- Jeton Hotmart (copié depuis la page Webhook de Hotmart, champ "hottok")
insert into private.secrets(key, value) values ('hotmart_hottok', 'HOTTOK_ICI')
  on conflict (key) do update set value = excluded.value;
