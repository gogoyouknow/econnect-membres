-- 0069 : moins de 500 € → séquence de 7 emails pour proposer la Méthode E-Connect à 97 €.
-- Entrée : la personne a choisi « moins de 500 € » ET répondu à la question sur le budget (donc vu l'écran avec la Méthode), après la mise en ligne de cette migration.
-- Sortie : achat de la Méthode (Stripe / accès créé), désinscription, rendez-vous pris. Ensuite la séquence 30 jours prend le relais (comme les autres petites séquences).
-- Comme tout le reste, rien ne part sans ta validation jour par jour (période de validation).

alter table public.mail_steps drop constraint if exists mail_steps_seq_check;
alter table public.mail_steps add constraint mail_steps_seq_check check (seq in ('contact', 'partial', 'noshow', 'nurture', 'methode'));

-- {methode:Texte du bouton} = bouton jaune vers la page de vente (le clic est compté via /v/<jeton>)
create or replace function private.mail_build(st public.mail_steps, l public.cand_leads, o public.mail_out) returns jsonb
language plpgsql stable set search_path = public, private as $$
declare nm text := coalesce(nullif(trim(l.first_name), ''), 'Hello'); esc text; sub text; vid text; rdv text; r text; html text;
begin
  sub := replace(case when o.variant = 'B' and coalesce(st.subject_b, '') <> '' then st.subject_b else st.subject_a end, '{prenom}', nm);
  esc := replace(replace(replace(st.body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  vid := '<a href="https://rdv.theambitiousman.fr/v/' || o.token || '" style="display:inline-block;background:#e0211f;color:#ffffff;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">▶ Regarder la vidéo</a>';
  rdv := '<a href="https://rdv.theambitiousman.fr/?utm_source=email&utm_campaign=' || st.seq || '">rdv.theambitiousman.fr</a>';
  r := replace(replace(replace(esc, '{prenom}', replace(replace(replace(nm, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')), '{video}', vid), '{rdv}', rdv);
  r := regexp_replace(r, '\{methode:([^}]*)\}', '<a href="https://rdv.theambitiousman.fr/v/' || o.token || '" style="display:inline-block;background:#e9c53e;color:#16120a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px">\1</a>', 'g');
  r := replace(r, E'\n', '<br>');
  html := '<div style="font-size:15px;line-height:1.55;color:#222">' || r
    || '<div style="margin-top:26px;font-size:12px;color:#888">Tu reçois cet email parce que tu as commencé une candidature chez L''Accélérateur. <a href="https://rdv.theambitiousman.fr/stop/' || l.unsub_token || '" style="color:#888">Me désinscrire</a></div></div>';
  return jsonb_build_object('subject', sub, 'html', html);
end $$;

-- Le clic ouvre la page de vente (séquence « methode ») ou la vidéo YouTube (les autres).
create or replace function public.mail_click(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare vid text; sq text; pos_ int;
begin
  update public.mail_out o set clicked_at = coalesce(o.clicked_at, now()) where o.token = p_token;
  select t.video_id, t.seq, t.pos into vid, sq, pos_ from public.mail_out o join public.mail_steps t on t.id = o.step_id where o.token = p_token;
  if sq = 'methode' then return 'https://econnect-membres.vercel.app/methode/?utm_source=email&utm_medium=sequence&utm_campaign=methode97&utm_content=email' || pos_; end if;
  return case when vid is null then 'https://www.youtube.com/@theambitiousman' else 'https://www.youtube.com/watch?v=' || vid end;
end $$;
grant execute on function public.mail_click(uuid) to anon, authenticated;

-- Entrées et sorties de la séquence « methode » (toutes les 5 minutes)
create or replace function public.mail_tick_methode() returns int
language plpgsql security definer set search_path = public, private as $$
declare n int := 0;
begin
  -- Sortie : a acheté la Méthode
  update public.mail_enroll x set status = 'stop', stop_reason = 'a acheté la Méthode' where x.seq = 'methode' and x.status = 'actif' and exists (
    select 1 from public.cand_leads c where c.id = x.lead_id and c.email is not null and (
      exists (select 1 from public.stripe_events s where lower(s.email) = lower(c.email) and s.type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') and s.status not like 'ignored%' and s.status not like 'REFUSED%')
      or exists (select 1 from public.profiles p where lower(p.email) = lower(c.email) and p.methode)));
  update public.mail_out q set status = 'annule' where q.status = 'attente' and exists (
    select 1 from public.mail_enroll x join public.mail_steps t on t.seq = x.seq where x.lead_id = q.lead_id and x.seq = 'methode' and x.status = 'stop' and t.id = q.step_id);
  -- Entrée : moins de 500 €, a répondu à la question sur le budget (donc vu l'écran avec la Méthode)
  with new_e as (
    insert into public.mail_enroll (lead_id, seq)
    select c.id, 'methode' from public.cand_leads c
     where private.mail_lead_ok(c) and not c.booked and coalesce(c.capital, '') = 'lt500' and c.budget_confirmed in ('yes', 'soon', 'no')
       and c.updated_at >= timestamptz '2026-11-13 11:10:00+01'
       and not private.mail_has_cand(c.email, array['reserve', 'confirme', 'fait'])
       and not exists (select 1 from public.mail_enroll x where x.lead_id = c.id and x.seq = 'methode')
       and not exists (select 1 from public.stripe_events s where lower(s.email) = lower(c.email) and s.type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') and s.status not like 'ignored%')
    on conflict do nothing returning lead_id)
  update public.mail_enroll x set status = 'stop', stop_reason = 'passé à la Méthode' from new_e
   where x.lead_id = new_e.lead_id and x.seq <> 'methode' and x.status = 'actif';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mail_tick_methode() from public, anon, authenticated;
do $$ begin perform cron.unschedule('mail-methode'); exception when others then null; end $$;
select cron.schedule('mail-methode', '*/5 * * * *', 'select public.mail_tick_methode()');

insert into public.mail_steps (seq, pos, label, delay_h, at_hour, subject_a, subject_b, body) values
  ('methode', 1, $b$Méthode 97 € · 1 · Ce que je peux faire pour toi$b$, 0, 18, $b${prenom}, ce que je peux faire pour toi$b$, $b$On ne va pas se parler, mais…$b$, $b$Salut {prenom},

Tu viens de voir que je ne peux pas te proposer d'appel pour l'instant. Ce n'est pas un refus sur toi : je ne veux pas te faire perdre du temps avec un accompagnement que tu ne pourrais pas encore suivre.

Par contre, ça ne veut pas dire que tu dois attendre. J'ai créé la Méthode E-Connect pour les personnes qui partent avec un petit budget : 4 étapes, pas de formation de 50 heures, tu avances à ton rythme.

Je te raconte comment elle marche dans les prochains jours. Si tu veux déjà la voir :

{methode:Découvrir la Méthode, 97 €}

Clément$b$),
  ('methode', 2, $b$Méthode 97 € · 2 · Mon histoire$b$, 24, 18, $b$Livreur, endetté, et ce qui a tout changé$b$, $b$Il y a 5 ans, j'étais à -8 000 €$b$, $b$Salut {prenom},

Il y a 5 ans, j'étais livreur Uber Eats, de 9 h à plus de 23 h, 7 jours sur 7. J'étais endetté à -8 000 € et j'avais déjà payé des formations qui n'avaient rien donné.

Ce qui m'a débloqué, ce n'est pas une formation de plus. C'est d'arrêter d'apprendre et de passer à l'action, avec une méthode simple. Après 9 mois d'essais et d'erreurs, j'ai trouvé ce qui marchait.

C'est exactement ce que j'ai mis dans la Méthode E-Connect, pour que tu n'aies pas à refaire ces 9 mois.

{methode:Voir la Méthode, 97 €}

Clément$b$),
  ('methode', 3, $b$Méthode 97 € · 3 · La boutique$b$, 24, 18, $b$Ta boutique en moins de 30 minutes$b$, $b$Tu n'as pas besoin d'être développeur$b$, $b$Salut {prenom},

La question que j'entends le plus : « Je ne sais pas créer une boutique. »

Le module 1 est fait pour ça. Tu apprends à créer une boutique simple, rassurante, bien présentée, en moins de 30 minutes, sans coder et sans être designer. Et avec le template Shopify qui est offert, tu importes le modèle d'une boutique qui vend déjà, tu l'adaptes à ton produit, et c'est prêt.

Une excuse en moins.

{methode:Voir le module 1 et la Méthode}

Clément$b$),
  ('methode', 4, $b$Méthode 97 € · 4 · Produit et testing$b$, 24, 18, $b$Comment choisir un produit sans te tromper$b$, $b$Tu ne commandes rien avant d'avoir validé$b$, $b$Salut {prenom},

Beaucoup de débutants perdent leur budget parce qu'ils achètent du stock avant de savoir si le produit se vend.

Dans la méthode, on fait l'inverse. Le module 2 t'apprend à repérer des produits qui se vendent facilement. Le module 4, le testing, t'apprend à lire tes chiffres et à valider ton produit. Tu commandes ton stock seulement quand il est prêt à se vendre.

Et pour tester, tu peux démarrer avec 10 € par jour.

{methode:Voir les modules 2 et 4}

Clément$b$),
  ('methode', 5, $b$Méthode 97 € · 5 · J'ai déjà été déçu$b$, 24, 18, $b$Si tu as déjà été déçu par une formation$b$, $b$Pourquoi celle-ci n'est pas une formation de plus$b$, $b$Salut {prenom},

Si tu as déjà payé une formation sans résultat, je comprends que tu te méfies. Moi aussi, j'étais passé par là.

Je ne vais pas te dire que ça se fait tout seul : ça va demander du travail. Mais la méthode tient en 4 étapes simples (boutique, produit, publicité, testing), sans 50 heures de vidéos à regarder avant de commencer. Tu passes à l'action dès le premier jour, et plus de 100 personnes l'ont déjà appliquée.

Si tu hésites, réponds-moi à cet email avec ta question, je te lis.

{methode:Voir la Méthode, 97 €}

Clément$b$),
  ('methode', 6, $b$Méthode 97 € · 6 · Tout ce qui est inclus$b$, 24, 18, $b$Les 3 bonus qui sont inclus$b$, $b$Ce que tu reçois pour 97 €$b$, $b$Salut {prenom},

Voici tout ce que tu reçois avec la Méthode E-Connect :
- Module 1 : ta boutique en moins de 30 minutes
- Module 2 : trouver des produits gagnants
- Module 3 : des publicités rentables, en démarrant avec 10 € par jour
- Module 4 : le testing
- Bonus : les créatives impactantes, le calculateur de rentabilité, le template Shopify d'une boutique gagnante

Une valeur de 729 €, pour 97 €, avec un accès à vie.

{methode:Accéder à la Méthode, 97 €}

Clément$b$),
  ('methode', 7, $b$Méthode 97 € · 7 · Le dernier message$b$, 24, 18, $b${prenom}, c'est mon dernier message$b$, $b$Je te laisse décider$b$, $b$Salut {prenom},

C'est mon dernier email sur le sujet.

Si tu veux te lancer maintenant, la Méthode E-Connect est là : 97 €, accès à vie, tu avances à ton rythme.

Si ce n'est pas le moment, aucun souci. Quand tu auras de quoi investir et que tu voudras en parler avec moi, tu pourras réserver un appel : {rdv}

Dans tous les cas, merci d'avoir pris le temps de me lire.

{methode:Accéder à la Méthode, 97 €}

Clément$b$)
on conflict (seq, pos) do nothing;
