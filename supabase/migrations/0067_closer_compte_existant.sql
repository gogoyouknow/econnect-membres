-- Invitation d'un closer qui a DÉJÀ un compte : on ne lui fait plus « créer un compte » (Supabase n'envoie alors aucun code) ; on lui dit de se connecter.
create or replace function public.closer_invite(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare has_acc boolean := false; subj text; nm text := left(trim(coalesce(p ->> 'name', '')), 60); em text := lower(trim(coalesce(p ->> 'email', '')));
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
  has_acc := pr.id is not null or exists (select 1 from auth.users where lower(email) = em);
  link := case when has_acc then 'https://rdv.theambitiousman.fr/admin' else 'https://rdv.theambitiousman.fr/admin?join=1&email=' || private.urlenc(em) end;
  if has_acc then
    body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Salut ' || replace(replace(nm, '<', ''), '>', '') || ',</p>'
      || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333"><b>Tu as déjà un compte</b> avec cette adresse (<b>' || em || '</b>) : il n''y a rien à créer, pas de code à attendre. Connecte-toi simplement avec ton mot de passe habituel.</p>'
      || private.btn('Ouvrir Calio', link)
      || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Mot de passe oublié ? Sur la page de connexion, clique sur « Mot de passe oublié », <b>tape ton adresse</b> et suis le lien reçu par email.</p>'
      || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Ton lien de réservation personnel :<br><a href="https://rdv.theambitiousman.fr/?closer_id=' || k || '">rdv.theambitiousman.fr/?closer_id=' || k || '</a></p>'
      || '<p style="margin:0;font-size:14px;color:#333">À tout de suite,<br><b>Clément</b></p>';
    subj := 'Ton compte Calio est prêt : connecte-toi';
  else
    body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Salut ' || replace(replace(nm, '<', ''), '>', '') || ',</p>'
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Je t''invite sur <b>Calio</b>, l''app où tu retrouves tes appels de closing, les infos de chaque prospect, tes confirmations WhatsApp et ton taux de closing.</p>'
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Crée ton compte avec cette adresse email (<b>' || em || '</b>) :</p>'
    || private.btn('Créer mon compte Calio', link)
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Ton lien de réservation personnel (à mettre en bio / à envoyer) :<br><a href="https://rdv.theambitiousman.fr/?closer_id=' || k || '">rdv.theambitiousman.fr/?closer_id=' || k || '</a></p>'
    || '<p style="margin:0 0 12px;font-size:12px;color:#777">Sur iPhone : ouvre le lien dans Safari, puis Partager → « Sur l''écran d''accueil » pour avoir l''app.</p>'
    || '<p style="margin:0;font-size:14px;color:#333">À tout de suite,<br><b>Clément</b></p>';
  subj := 'Clément t''invite sur Calio';
  end if;
  perform private.send_email(em, subj, private.email_html(case when has_acc then 'Ton accès Calio' else 'Bienvenue dans l''équipe' end, body), 'Clément · Calio');
  return jsonb_build_object('key', k, 'link', link, 'booking', 'https://rdv.theambitiousman.fr/?closer_id=' || k);
end $$;

-- Envoi immédiat à Amandine : son compte existe depuis le 16/10, le bouton « créer mon compte » ne pouvait donc jamais lui envoyer de code.
do $$
declare c public.cand_closers; body text;
begin
  select * into c from public.cand_closers where key = 'amandine' and user_id is not null and email is not null;
  if not found then return; end if;
  body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Salut ' || coalesce(nullif(c.name, ''), 'Amandine') || ',</p>'
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Pardon pour la confusion : <b>tu as déjà un compte Calio</b> avec cette adresse (<b>' || c.email || '</b>). Il n''y a donc rien à créer et aucun code à attendre. Connecte-toi directement avec ton mot de passe habituel.</p>'
    || private.btn('Ouvrir Calio', 'https://rdv.theambitiousman.fr/admin')
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Si tu as oublié ton mot de passe : sur la page de connexion, clique sur « Mot de passe oublié », <b>tape ton adresse</b> (celle de ce mail) et suis le lien que tu reçois.</p>'
    || '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333">Ton lien de réservation personnel :<br><a href="https://rdv.theambitiousman.fr/?closer_id=' || c.key || '">rdv.theambitiousman.fr/?closer_id=' || c.key || '</a></p>'
    || '<p style="margin:0 0 12px;font-size:12px;color:#777">Sur iPhone : ouvre le lien dans Safari, puis Partager → « Sur l''écran d''accueil » pour avoir l''app.</p>'
    || '<p style="margin:0;font-size:14px;color:#333">À tout de suite,<br><b>Clément</b></p>';
  perform private.send_email(c.email, 'Ton compte Calio est prêt : connecte-toi', private.email_html('Ton accès Calio', body), 'Clément · Calio');
end $$;
