-- 0110 : un paiement qui n'est PAS une des offres (lien de paiement classique, 500 € par exemple) ne donne plus aucun accès.
-- Avant : un lien inconnu était « deviné » comme la Méthode (ou l'accompagnement si abonnement) et ouvrait l'accès + envoyait l'e-mail de bienvenue.
-- Maintenant : seuls les liens listés dans public.stripe_offers ouvrent un accès. Tout autre paiement est noté « ignored » dans stripe_events
-- et Clément reçoit une notif « Paiement hors offres … aucun accès donné ».
-- Pour ajouter une offre : insert into public.stripe_offers (payment_link, label, methode, accel) values ('plink_…', 'Libellé', true, false);

create or replace function public.stripe_webhook(payload text, sig text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  secret text; ts text; expected text; ok boolean;
  ev jsonb; typ text; eid text; o jsonb; em text; cust text; amt numeric; st text; m boolean; a boolean;
begin
  select value into secret from private.secrets where key = 'stripe_whsec';
  ts := substring(sig from 't=([0-9]+)');
  if secret is null or secret = 'WHSEC_ICI' or ts is null then
    insert into public.stripe_events (type, status) values ('?', 'REFUSED: secret absent ou signature illisible');
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  expected := encode(extensions.hmac(ts || '.' || payload, secret, 'sha256'), 'hex');
  select exists (select 1 from regexp_matches(sig, 'v1=([0-9a-f]+)', 'g') x where x[1] = expected) into ok;
  if not ok or abs(extract(epoch from now()) - ts::bigint) > 600 then
    insert into public.stripe_events (type, status) values ('?', 'REFUSED: signature invalide');
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  ev := payload::jsonb; typ := ev ->> 'type'; eid := ev ->> 'id'; o := ev #> '{data,object}';
  if exists (select 1 from public.stripe_events where event_id = eid) then
    return jsonb_build_object('ok', true, 'status', 'duplicate');
  end if;
  cust := o ->> 'customer';

  if typ in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    em := lower(trim(coalesce(o #>> '{customer_details,email}', o ->> 'customer_email')));
    amt := (o ->> 'amount_total')::numeric / 100;
    if o ->> 'payment_status' not in ('paid', 'no_payment_required') then
      st := 'ignored: paiement en attente';
    elsif em is null or em = '' then
      st := 'ignored: no email';
    else
      select so.methode, so.accel into m, a from public.stripe_offers so where so.payment_link = o ->> 'payment_link';
      if m is null then
        -- lien de paiement qui n'est pas une offre (paiement ponctuel, facture, autre) : AUCUN accès
        st := 'ignored: lien de paiement hors offres (aucun accès donné)';
      else
        st := private.grant_access(em, m, a, 'stripe', cust);
      end if;
    end if;

  elsif typ = 'customer.subscription.deleted' then
    select email into em from public.allowed_emails where stripe_customer = cust limit 1;
    if em is null then select lower(email) into em from public.profiles where stripe_customer = cust limit 1; end if;
    st := case when em is null then 'ignored: client inconnu' else private.revoke_access(em, false, true) end;

  elsif typ in ('charge.refunded', 'charge.dispute.created') then
    em := lower(trim(o #>> '{billing_details,email}'));
    if (em is null or em = '') and cust is not null then select email into em from public.allowed_emails where stripe_customer = cust limit 1; end if;
    amt := (o ->> 'amount')::numeric / 100;
    if em is null then st := 'ignored: client inconnu';
    elsif typ = 'charge.refunded' and not coalesce((o ->> 'refunded')::boolean, false) then st := 'ignored: remboursement partiel';
    elsif amt = 160 then st := private.revoke_access(em, false, true);          -- un mois d'accompagnement remboursé
    else st := private.revoke_access(em, true, true);                           -- Méthode (garantie) remboursée
    end if;

  else
    st := 'ignored: ' || coalesce(typ, '?');
  end if;

  insert into public.stripe_events (event_id, type, email, amount, status, payload) values (eid, typ, em, amt, st, ev);
  return jsonb_build_object('ok', true, 'status', st);
end $$;
revoke all on function public.stripe_webhook(text, text) from public, anon, authenticated;
grant execute on function public.stripe_webhook(text, text) to service_role;

create or replace function private.on_stripe_event() returns trigger language plpgsql security definer set search_path = public as $$
declare amt text := case when new.amount is not null then replace(to_char(new.amount, 'FM9999990.00'), '.00', '') || ' €' else '' end;
        who text := coalesce(new.email, new.payload #>> '{data,object,customer_details,email}', '?');
        offer text := coalesce((select label from public.stripe_offers where payment_link = new.payload #>> '{data,object,payment_link}'), '');
begin
  if new.type = 'checkout.session.completed' and new.status like 'ignored: lien de paiement hors offres%' then
    perform private.notify_admins('💶 Paiement hors offres ' || amt, who || ' · aucun accès donné', '#leads');
  elsif new.type = 'checkout.session.completed' then
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

notify pgrst, 'reload schema';
