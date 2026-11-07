-- 0022 : notification (push + cloche) aux admins à chaque vente / abonnement / résiliation — comme l'appli Stripe

create or replace function private.notify_admins(p_title text, p_body text, p_url text default '#admin') returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, url)
  select id, p_title, p_body, p_url from public.profiles where role = 'admin' and active
$$;

-- Stripe : Méthode 97 €, abonnement 160 €, échecs, remboursements
create or replace function private.on_stripe_event() returns trigger language plpgsql security definer set search_path = public as $$
declare amt text := case when new.amount is not null then replace(to_char(new.amount, 'FM9999990.00'), '.00', '') || ' €' else '' end;
        who text := coalesce(new.email, new.payload #>> '{data,object,customer_details,email}', '?');
        offer text := coalesce((select label from public.stripe_offers where payment_link = new.payload #>> '{data,object,payment_link}'), '');
begin
  if new.type = 'checkout.session.completed' then
    perform private.notify_admins('💰 Nouvelle vente ' || amt, coalesce(nullif(offer, ''), 'Méthode E-Connect') || ' · ' || who, '#leads');
  elsif new.type = 'invoice.paid' and (new.payload #>> '{data,object,billing_reason}') = 'subscription_create' then
    perform private.notify_admins('🚀 Nouvel abonné accompagnement ' || amt, who, '#leads');
  elsif new.type = 'invoice.paid' then
    perform private.notify_admins('🔁 Renouvellement ' || amt, who, '#admin');
  elsif new.type = 'invoice.payment_failed' then
    perform private.notify_admins('⚠️ Paiement refusé ' || amt, who, '#admin');
  elsif new.type = 'customer.subscription.deleted' then
    perform private.notify_admins('❌ Abonnement résilié', who, '#admin');
  elsif new.type = 'charge.refunded' then
    perform private.notify_admins('↩️ Remboursement ' || amt, who, '#admin');
  end if;
  return new;
end $$;
drop trigger if exists stripe_events_notify on public.stripe_events;
create trigger stripe_events_notify after insert on public.stripe_events for each row execute function private.on_stripe_event();

-- passage en un clic depuis l'app (abonnement créé par la fonction stripe-upgrade)
create or replace function private.on_stripe_upgrade() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('active', 'trialing') then
    perform private.notify_admins('🚀 Passage à l''accompagnement · 160 €/mois', coalesce(new.email, '?') || ' vient de passer à l''action depuis l''app', '#leads');
  else
    perform private.notify_admins('⚠️ Passage à l''accompagnement refusé', coalesce(new.email, '?') || ' · carte refusée (' || coalesce(new.status, '?') || ')', '#leads');
  end if;
  return new;
end $$;
drop trigger if exists stripe_upgrades_notify on public.stripe_upgrades;
create trigger stripe_upgrades_notify after insert on public.stripe_upgrades for each row execute function private.on_stripe_upgrade();

-- Hotmart : 250 € / 450 €
create or replace function private.on_hotmart_event() returns trigger language plpgsql security definer set search_path = public as $$
declare amt text := case when new.price is not null then replace(to_char(new.price, 'FM9999990.00'), '.00', '') || ' €' else '' end;
begin
  if new.status is null or new.status like 'ignored%' then return new; end if;
  if new.event in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETE') then
    perform private.notify_admins('💰 Nouvel abonné ' || amt, coalesce(new.product, 'Hotmart') || coalesce(' · ' || nullif(new.offer, ''), '') || ' · ' || coalesce(new.email, '?'), '#members');
  elsif new.event in ('SUBSCRIPTION_CANCELLATION', 'PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_PROTEST') then
    perform private.notify_admins('❌ ' || case when new.event like '%REFUND%' then 'Remboursement' when new.event like '%CHARGEBACK%' or new.event like '%PROTEST%' then 'Litige' else 'Résiliation' end || coalesce(' ' || nullif(amt, ''), ''), coalesce(new.product, 'Hotmart') || ' · ' || coalesce(new.email, '?'), '#members');
  elsif new.event in ('PURCHASE_DELAYED', 'PURCHASE_BILLET_PRINTED') then
    perform private.notify_admins('⏳ Paiement en attente ' || amt, coalesce(new.email, '?'), '#members');
  end if;
  return new;
end $$;
drop trigger if exists hotmart_events_notify on public.hotmart_events;
create trigger hotmart_events_notify after insert on public.hotmart_events for each row execute function private.on_hotmart_event();
