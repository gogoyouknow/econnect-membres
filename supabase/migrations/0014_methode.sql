-- 0014 : espace « Méthode E-Connect » avec ses propres accès + accès automatique après paiement Stripe
-- Tout est additif : les membres actuels gardent exactement le même accès (accel = true par défaut).

-- ---------- 1) Les accès par espace ----------
alter table public.allowed_emails
  add column if not exists methode boolean not null default false,   -- formation Méthode E-Connect (97 €)
  add column if not exists accel boolean not null default true,      -- L'Accélérateur : groupe, lives, chat (abonnement)
  add column if not exists stripe_customer text;
alter table public.profiles
  add column if not exists methode boolean not null default false,
  add column if not exists accel boolean not null default true,
  add column if not exists stripe_customer text;
create index if not exists allowed_emails_stripe on public.allowed_emails(stripe_customer);
create index if not exists profiles_stripe on public.profiles(stripe_customer);

-- modules inclus dans la Méthode (par défaut : modules 1 à 4, modifiable dans Cours → Modifier)
alter table public.modules add column if not exists methode boolean not null default false;
update public.modules set methode = true where position between 1 and 4 and not methode;

-- lien Stripe de l'accompagnement seul (pour les élèves de la Méthode qui veulent passer à L'Accélérateur)
alter table public.settings add column if not exists accel_url text default '';

create or replace function public.has_accel() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select active and (accel or role <> 'member') from public.profiles where id = auth.uid()), false) $$;
create or replace function public.has_methode() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select active and (methode or role <> 'member') from public.profiles where id = auth.uid()), false) $$;

-- ---------- 2) Inscription : on recopie les accès de la liste blanche ----------
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare a public.allowed_emails%rowtype; n int;
begin
  select * into a from public.allowed_emails where lower(email) = lower(new.email);
  select count(*) into n from public.profiles;
  if a.email is null and n > 0 then
    raise exception 'Cet email n''a pas d''accès actif. Vérifie ton abonnement ou écris-nous.';
  end if;
  insert into public.profiles (id, email, name, role, tier, methode, accel, stripe_customer)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when n = 0 then 'admin' else coalesce(a.role,'member') end,
    coalesce(a.tier,1),
    coalesce(a.methode, false),
    coalesce(a.accel, true),
    a.stripe_customer
  );
  return new;
end $$;

-- ---------- 3) Protection : un membre ne peut pas s'ouvrir un espace lui-même ----------
create or replace function public.guard_profile_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- appels serveur (webhooks Hotmart / Stripe) : pas d'utilisateur connecté
  if auth.uid() is null then return new; end if;
  if public.is_admin() then return new; end if;
  if new.role is distinct from old.role or new.tier is distinct from old.tier or new.active is distinct from old.active or new.email is distinct from old.email
     or new.methode is distinct from old.methode or new.accel is distinct from old.accel or new.stripe_customer is distinct from old.stripe_customer then
    raise exception 'Seul un admin peut modifier le rôle, le groupe ou l''accès';
  end if;
  if public.is_staff() and old.id <> auth.uid() and old.role <> 'member' then
    raise exception 'Un modérateur ne peut pas modifier un membre de l''équipe';
  end if;
  if not public.is_staff() and new.muted_until is distinct from old.muted_until then
    raise exception 'Tu ne peux pas lever ta propre sourdine';
  end if;
  return new;
end $$;

-- ---------- 4) Ce que voit un élève « Méthode seule » ----------
-- Le groupe (chat, fil, lives, membres) reste réservé à L'Accélérateur.
drop policy if exists "profiles: lecture membres actifs" on public.profiles;
create policy "profiles: lecture membres actifs" on public.profiles for select to authenticated using (public.has_accel() or id = auth.uid());

drop policy if exists "messages: lecture selon palier" on public.messages;
create policy "messages: lecture selon palier" on public.messages for select to authenticated
  using (public.has_accel() and (public.is_staff() or exists (select 1 from public.spaces s where s.id = space_id and s.tier_required <= public.my_tier())));
drop policy if exists "messages: écrire" on public.messages;
create policy "messages: écrire" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.has_accel() and (public.is_staff() or exists (select 1 from public.spaces s where s.id = space_id and s.tier_required <= public.my_tier())));

drop policy if exists "posts: lecture" on public.posts;
create policy "posts: lecture" on public.posts for select to authenticated using (public.has_accel() and (approved or user_id = auth.uid() or public.is_staff()));
drop policy if exists "posts: écrire" on public.posts;
create policy "posts: écrire" on public.posts for insert to authenticated with check (user_id = auth.uid() and public.has_accel());
drop policy if exists "replies: lecture" on public.replies;
create policy "replies: lecture" on public.replies for select to authenticated using (public.has_accel());
drop policy if exists "replies: écrire" on public.replies;
create policy "replies: écrire" on public.replies for insert to authenticated with check (user_id = auth.uid() and public.has_accel());
drop policy if exists "lives: lecture" on public.lives;
create policy "lives: lecture" on public.lives for select to authenticated using (public.has_accel());
drop policy if exists "reactions: lecture" on public.message_reactions;
create policy "reactions: lecture" on public.message_reactions for select to authenticated using (public.has_accel());

-- leçons : un élève Méthode ne lit que les leçons des modules de la Méthode
drop policy if exists "lessons: lecture" on public.lessons;
create policy "lessons: lecture" on public.lessons for select to authenticated using (
  public.is_staff() or (published and (public.has_accel() or (public.has_methode() and exists (
    select 1 from public.course_sections s join public.modules m on m.id = s.module_id where s.id = section_id and m.methode)))));

-- ---------- 5) Ouvrir / fermer un accès (utilisé par le webhook Stripe) ----------
create or replace function private.grant_access(em text, p_methode boolean, p_accel boolean, p_source text, p_customer text) returns text
language plpgsql security definer set search_path = public as $$
declare was_member boolean;
begin
  select exists (select 1 from public.profiles where lower(email) = em) into was_member;
  insert into public.allowed_emails (email, tier, role, source, methode, accel, stripe_customer)
    values (em, 1, 'member', p_source, p_methode, p_accel, p_customer)
    on conflict (email) do update set
      methode = public.allowed_emails.methode or excluded.methode,
      accel = public.allowed_emails.accel or excluded.accel,
      stripe_customer = coalesce(excluded.stripe_customer, public.allowed_emails.stripe_customer);
  update public.profiles set active = true, methode = methode or p_methode, accel = accel or p_accel,
    stripe_customer = coalesce(p_customer, stripe_customer)
    where lower(email) = em;
  if was_member then
    insert into public.notifications (user_id, title, body, url)
      select id, case when p_accel then 'Bienvenue dans L''Accélérateur 🚀' else 'La Méthode E-Connect est ouverte 🎓' end,
             case when p_accel then 'Le groupe, les lives et le chat sont ouverts.' else 'Ta formation t''attend dans l''espace Méthode E-Connect.' end,
             case when p_accel then '#general' else '#mcours' end
      from public.profiles where lower(email) = em;
  end if;
  return 'access granted (' || concat_ws(' + ', case when p_methode then 'methode' end, case when p_accel then 'accel' end) || ')';
end $$;

-- coupe un espace ; si plus aucun espace, le compte passe en pause
create or replace function private.revoke_access(em text, p_methode boolean, p_accel boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  update public.allowed_emails set methode = methode and not p_methode, accel = accel and not p_accel where email = em and role = 'member';
  update public.profiles set methode = methode and not p_methode, accel = accel and not p_accel where lower(email) = em and role = 'member';
  update public.profiles set active = false where lower(email) = em and role = 'member' and not methode and not accel;
  return 'access revoked (' || concat_ws(' + ', case when p_methode then 'methode' end, case when p_accel then 'accel' end) || ')';
end $$;

-- ---------- 6) Webhook Stripe ----------
-- Quel lien de paiement ouvre quoi
create table if not exists public.stripe_offers (
  payment_link text primary key,
  label text not null,
  methode boolean not null default true,
  accel boolean not null default false
);
alter table public.stripe_offers enable row level security;
drop policy if exists "stripe_offers: admin" on public.stripe_offers;
create policy "stripe_offers: admin" on public.stripe_offers for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.stripe_offers (payment_link, label, methode, accel) values
  ('plink_1UYYgCGODTnZ0udu3k6GkS4u', 'Méthode E-Connect · 97 €', true, false),
  ('plink_1UYYi0GODTnZ0uduy9UnlaZi', 'Méthode + accompagnement · 257 € puis 160 €/mois', true, true)
on conflict (payment_link) do nothing;

create table if not exists public.stripe_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  event_id text unique,
  type text, email text, amount numeric, status text, payload jsonb
);
alter table public.stripe_events enable row level security;
drop policy if exists "stripe: admin lit" on public.stripe_events;
create policy "stripe: admin lit" on public.stripe_events for select to authenticated using (public.is_admin());

-- secret de signature Stripe (whsec_…) : à renseigner une fois, voir README
insert into private.secrets (key, value) values ('stripe_whsec', 'WHSEC_ICI') on conflict (key) do nothing;

-- Reçoit le corps brut + l'en-tête Stripe-Signature (relayés par la fonction Edge stripe-webhook)
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
      if m is null then m := true; a := (o ->> 'mode') = 'subscription'; end if;  -- lien inconnu : on déduit
      st := private.grant_access(em, m, a, 'stripe', cust);
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

-- l'admin colle le secret whsec_… depuis l'app (Administration → Paiements Stripe)
create or replace function public.set_stripe_secret(p_secret text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if p_secret !~ '^whsec_[A-Za-z0-9]+$' then raise exception 'Le secret doit commencer par whsec_'; end if;
  insert into private.secrets (key, value) values ('stripe_whsec', p_secret) on conflict (key) do update set value = excluded.value;
  return true;
end $$;
create or replace function public.stripe_secret_set() returns boolean language sql stable security definer set search_path = public as
$$ select public.is_admin() and exists (select 1 from private.secrets where key = 'stripe_whsec' and value like 'whsec_%') $$;
revoke all on function public.set_stripe_secret(text) from public, anon;
grant execute on function public.set_stripe_secret(text) to authenticated;
grant execute on function public.stripe_secret_set() to authenticated;

-- ---------- 7) Email de bienvenue selon l'espace acheté ----------
create or replace function public.on_allowed_email() returns trigger language plpgsql security definer set search_path = public as $$
declare body text; p text := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">';
begin
  if exists (select 1 from public.profiles where lower(email) = lower(new.email)) then return new; end if; -- déjà inscrit
  if new.accel then
    body := p || 'Ton accès au groupe est ouvert avec cette adresse email : <b>' || new.email || '</b>.</p>'
         || p || 'Clique sur le bouton, crée ton mot de passe, mets ton prénom et une photo, et tu es avec nous.</p>'
         || private.btn('Créer mon accès', 'https://econnect-membres.vercel.app/#signup')
         || p || 'Une fois dedans, présente-toi dans le chat général.</p>';
  else
    body := p || 'Merci pour ta confiance. Ta formation est prête, avec cette adresse email : <b>' || new.email || '</b>.</p>'
         || p || 'Clique sur le bouton, crée ton mot de passe, et commence par le module 1. Regarde les vidéos dans l''ordre, c''est fait pour.</p>'
         || private.btn('Accéder à ma formation', 'https://econnect-membres.vercel.app/#signup')
         || p || 'Petit rappel sur la garantie : pour en profiter, il faut avoir regardé tous les modules et lancé au moins 3 campagnes dans les 30 jours.</p>';
  end if;
  body := body
       || '<p style="margin:0 0 12px;font-size:12px;color:#777">Sur iPhone : ouvre le lien dans Safari, puis Partager → « Sur l''écran d''accueil » pour avoir l''app et les notifications.</p>'
       || '<p style="margin:0;font-size:14px;color:#333">À tout de suite,<br><b>Clément</b></p>';
  if new.accel then
    perform private.send_email(new.email, 'Ton accès à L''Accélérateur est prêt', private.email_html('Bienvenue, tu es dedans.', body), 'Clément · L''Accélérateur');
  else
    perform private.send_email(new.email, 'Ton accès à la Méthode E-Connect est prêt',
      replace(private.email_html('Bienvenue dans la Méthode.', body), 'L''ACCÉLÉRATEUR</td>', 'MÉTHODE E-CONNECT</td>'), 'Clément · E-Connect');
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
