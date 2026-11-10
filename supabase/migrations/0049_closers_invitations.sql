-- Closers : Clément invite un closer par email, il crée son compte et utilise Calio (ses appels + son closing seulement).

-- 1) Nouveau rôle « closer » (n'est PAS l'équipe : il ne voit que ses propres appels).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'mod', 'admin', 'coach', 'closer'));
alter table public.cand_closers add column if not exists user_id uuid references public.profiles (id) on delete set null;
alter table public.cand_closers add column if not exists email text;
alter table public.cand_closers add column if not exists invited_at timestamptz;

create or replace function public.is_closer() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() = 'closer' $$;
create or replace function private.my_closer() returns text language sql stable security definer set search_path = public as
$$ select key from public.cand_closers where user_id = auth.uid() and active limit 1 $$;
grant execute on function private.my_closer() to authenticated;
-- 'staff' (équipe), 'closer' ou null : décide ce que Calio affiche.
create or replace function public.calio_role() returns text language sql stable security definer set search_path = public as
$$ select case when public.is_staff() then 'staff' when public.is_closer() and private.my_closer() is not null then 'closer' end $$;
grant execute on function public.calio_role() to authenticated;

-- 2) Ce qu'un closer peut lire / modifier : uniquement ses rendez-vous.
drop policy if exists "candidatures: closer lit" on public.candidatures;
create policy "candidatures: closer lit" on public.candidatures for select to authenticated using (public.is_closer() and closer = private.my_closer());
drop policy if exists "candidatures: closer modifie" on public.candidatures;
create policy "candidatures: closer modifie" on public.candidatures for update to authenticated
  using (public.is_closer() and closer = private.my_closer()) with check (public.is_closer() and closer = private.my_closer());
drop policy if exists "cand_closers: closer lit" on public.cand_closers;
create policy "cand_closers: closer lit" on public.cand_closers for select to authenticated using (public.is_closer());
drop policy if exists "cand_settings: closer lit" on public.cand_settings;
create policy "cand_settings: closer lit" on public.cand_settings for select to authenticated using (public.is_closer());
drop policy if exists "cand_templates: closer lit" on public.cand_templates;
create policy "cand_templates: closer lit" on public.cand_templates for select to authenticated using (public.is_closer());
drop policy if exists "cand_cseq: closer lit" on public.cand_cseq;
create policy "cand_cseq: closer lit" on public.cand_cseq for select to authenticated using (public.is_closer());
drop policy if exists "cand_questions: closer lit" on public.cand_questions;
create policy "cand_questions: closer lit" on public.cand_questions for select to authenticated
  using (public.is_closer() and exists (select 1 from public.candidatures c where c.id = candidature_id));
drop policy if exists "cand_page_events: closer lit" on public.cand_page_events;
create policy "cand_page_events: closer lit" on public.cand_page_events for select to authenticated
  using (public.is_closer() and exists (select 1 from public.candidatures c where c.id = candidature_id));

-- 3) À l'inscription : pas d'accès au groupe E-Connect pour un closer, et on relie son compte à sa fiche closer.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare a public.allowed_emails%rowtype; n int;
begin
  select * into a from public.allowed_emails where lower(email) = lower(new.email);
  select count(*) into n from public.profiles;
  if a.email is null and n > 0 then
    raise exception 'Cet email n''a pas d''accès actif. Demande à Clément de t''inviter.';
  end if;
  insert into public.profiles (id, email, name, role, tier, methode, accel, stripe_customer)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when n = 0 then 'admin' else coalesce(a.role,'member') end,
    coalesce(a.tier,1),
    coalesce(a.methode, false),
    case when a.role = 'closer' then false else coalesce(a.accel, true) end,
    a.stripe_customer
  );
  update public.cand_closers set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

-- Pas de mail « bienvenue dans le groupe » pour un closer.
create or replace function public.on_allowed_email() returns trigger language plpgsql security definer set search_path = public as $$
declare first text; body text;
begin
  if new.role = 'closer' then return new; end if;
  if exists (select 1 from public.profiles where lower(email) = lower(new.email)) then return new; end if;
  first := coalesce(nullif(split_part(new.email,'@',1),''), 'toi');
  body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Ton accès au groupe est ouvert avec cette adresse email : <b>' || new.email || '</b>.</p>'
       || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Clique sur le bouton, crée ton mot de passe, mets ton prénom et une photo, et tu es avec nous.</p>'
       || private.btn('Créer mon accès', 'https://econnect-membres.vercel.app/#signup')
       || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Une fois dedans, présente-toi dans le chat général.</p>'
       || '<p style="margin:0 0 12px;font-size:12px;color:#777">Sur iPhone : ouvre le lien dans Safari, puis Partager → « Sur l''écran d''accueil » pour avoir l''app et les notifications.</p>'
       || '<p style="margin:0;font-size:14px;color:#333">À tout de suite,<br><b>Clément</b></p>';
  perform private.send_email(new.email, 'Ton accès à L''Accélérateur est prêt', private.email_html('Bienvenue, tu es dedans.', body), 'Clément · L''Accélérateur');
  return new;
end $$;

-- 4) Notifications : un closer ne reçoit que celles de ses propres rendez-vous.
drop function if exists private.notify_calio(text, text, text);
create or replace function private.notify_calio(p_title text, p_body text, p_url text default '/admin', p_closer text default null) returns void
language plpgsql security definer set search_path = public, private as $$
declare tok text; u uuid; cu uuid;
begin
  select value into tok from private.secrets where key = 'push_token';
  if tok is null then return; end if;
  select user_id into cu from public.cand_closers where key = p_closer;
  for u in select distinct s.user_id from public.push_subscriptions s join public.profiles p on p.id = s.user_id
            where s.app = 'calio' and (p.role <> 'closer' or p.id = cu) loop
    perform net.http_post(
      url := 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', tok),
      body := jsonb_build_object('user_id', u, 'app', 'calio', 'title', p_title, 'body', p_body, 'url', p_url)
    );
  end loop;
exception when others then null;
end $$;
create or replace function private.calio_cand_notif() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.notify_calio('Appel réservé', coalesce(nullif(new.first_name, ''), 'Quelqu''un') || ' · ' ||
    to_char(new.starts_at at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI'), '/admin', new.closer);
  return new;
end $$;

-- 5) Inviter / relancer / retirer un closer (réservé à l'admin).
create or replace function public.closer_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare nm text := left(trim(coalesce(p ->> 'name', '')), 60); em text := lower(trim(coalesce(p ->> 'email', '')));
  wa text := regexp_replace(coalesce(p ->> 'wa', ''), '\D', '', 'g'); k text; n int := 0; ex public.cand_closers; link text; pr public.profiles; body text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  if nm = '' then raise exception 'Indique son prénom.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'Vérifie l''adresse email.'; end if;
  if wa like '00%' then wa := substr(wa, 3); elsif wa like '0%' then wa := '33' || substr(wa, 2); end if;
  if length(wa) < 9 then raise exception 'Indique son numéro WhatsApp Business (avec l''indicatif si pas français).'; end if;
  select * into pr from public.profiles where lower(email) = em;
  if found and pr.role in ('admin', 'mod', 'coach') then raise exception 'Cette personne fait déjà partie de l''équipe.'; end if;
  select * into ex from public.cand_closers where lower(email) = em;
  if not found then  -- un closer déjà créé sans email (ex. Amandine) : on le rattache au lieu d'en créer un deuxième
    select * into ex from public.cand_closers
     where email is null and key = coalesce(nullif(regexp_replace(lower(translate(nm, 'éèêëàâäîïôöùûüç ', 'eeeeaaaiioouuuc-')), '[^a-z0-9-]', '', 'g'), ''), 'closer');
  end if;
  if ex.key is not null then
    k := ex.key;
    update public.cand_closers set name = nm, wa_number = wa, active = true, invited_at = now(), email = em where key = k;
  else
    k := coalesce(nullif(regexp_replace(lower(translate(nm, 'éèêëàâäîïôöùûüç ', 'eeeeaaaiioouuuc-')), '[^a-z0-9-]', '', 'g'), ''), 'closer');
    while exists (select 1 from public.cand_closers where key = k) loop n := n + 1; k := regexp_replace(k, '[0-9]+$', '') || (n + 1)::text; end loop;
    insert into public.cand_closers (key, name, wa_number, active, email, invited_at) values (k, nm, wa, true, em, now());
  end if;
  insert into public.allowed_emails (email, tier, role, source) values (em, 1, 'closer', 'closer')
    on conflict (email) do update set role = 'closer', source = 'closer';
  if pr.id is not null then
    update public.profiles set role = 'closer', accel = false where id = pr.id;
    update public.cand_closers set user_id = pr.id where key = k;
  end if;
  link := 'https://rdv.theambitiousman.fr/admin?join=1&email=' || private.urlenc(em);
  body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Salut ' || replace(replace(nm, '<', ''), '>', '') || ',</p>'
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Je t''invite sur <b>Calio</b>, l''app où tu retrouves tes appels de closing, les infos de chaque prospect, tes confirmations WhatsApp et ton taux de closing.</p>'
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Crée ton compte avec cette adresse email (<b>' || em || '</b>) :</p>'
    || private.btn('Créer mon compte Calio', link)
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Ton lien de réservation personnel (à mettre en bio / à envoyer) :<br><a href="https://rdv.theambitiousman.fr/?closer_id=' || k || '">rdv.theambitiousman.fr/?closer_id=' || k || '</a></p>'
    || '<p style="margin:0 0 12px;font-size:12px;color:#777">Sur iPhone : ouvre le lien dans Safari, puis Partager → « Sur l''écran d''accueil » pour avoir l''app.</p>'
    || '<p style="margin:0;font-size:14px;color:#333">À tout de suite,<br><b>Clément</b></p>';
  perform private.send_email(em, 'Clément t''invite sur Calio', private.email_html('Bienvenue dans l''équipe', body), 'Clément · Calio');
  return jsonb_build_object('key', k, 'link', link, 'booking', 'https://rdv.theambitiousman.fr/?closer_id=' || k);
end $$;
grant execute on function public.closer_invite(jsonb) to authenticated;

create or replace function public.closer_remove(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cand_closers;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  if p_key = 'clement' then raise exception 'Tu ne peux pas retirer ton propre profil.'; end if;
  select * into c from public.cand_closers where key = p_key;
  if not found then return; end if;
  update public.cand_closers set active = false where key = p_key;
  if c.user_id is not null then update public.profiles set role = 'member' where id = c.user_id and role = 'closer'; end if;
  delete from public.allowed_emails where lower(email) = lower(coalesce(c.email, '')) and source = 'closer'
    and not exists (select 1 from public.profiles where lower(email) = lower(coalesce(c.email, '')));
end $$;
grant execute on function public.closer_remove(text) to authenticated;
