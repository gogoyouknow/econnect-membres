-- 0109 : e-mail « nouvelle vidéo » envoyé à toute la liste, avec suivi des ouvertures et des clics + bilan automatique à J+4.
-- · mail_campaigns : une ligne par envoi groupé (nom, objet, date du bilan) ;
-- · mail_bc : un destinataire par ligne (groupe, état d'envoi, ouverture, clic) ;
-- · mail_bc_tick() : envoie 8 e-mails par minute, entre 9 h et 21 h (Paris), en revérifiant à chaque fois que la personne peut encore en recevoir ;
-- · mail_bc_open / mail_bc_click : appelées par les adresses /api/o et /api/c du site de réservation (pixel d'ouverture, liens suivis) ;
-- · mail_bc_report() : le bilan arrive à Clément (notification + e-mail) à la date prévue.
-- Qui reçoit : mêmes règles que les e-mails automatiques (mail_lead_ok : adresse valide, autorisation donnée, pas désinscrit, pas de numéro bloqué),
-- sans les appels déjà faits et sans les élèves de l'application (adresse présente dans profiles), une seule fois par adresse.

create table if not exists public.mail_campaigns (
  key text primary key,
  name text not null,
  subject text not null,
  video_id text,
  created_at timestamptz not null default now(),
  report_at timestamptz,
  report_sent boolean not null default false
);

create table if not exists public.mail_bc (
  id bigserial primary key,
  campaign text not null references public.mail_campaigns (key) on delete cascade,
  lead_id bigint not null references public.cand_leads (id) on delete cascade,
  segment text not null check (segment in ('rdv', 'methode', 'absent', 'nonreserve')),
  token uuid not null default gen_random_uuid(),
  status text not null default 'attente' check (status in ('attente', 'envoye', 'annule')),
  sent_at timestamptz,
  opened_at timestamptz,
  open_n int not null default 0,
  clicked_at timestamptz,
  click_n int not null default 0,
  click_to text,
  unique (campaign, lead_id)
);
create unique index if not exists mail_bc_token on public.mail_bc (token);
create index if not exists mail_bc_wait on public.mail_bc (status, id);

alter table public.mail_campaigns enable row level security;
alter table public.mail_bc enable row level security;
do $$ declare t text; begin
  foreach t in array array['mail_campaigns', 'mail_bc'] loop
    execute format('drop policy if exists "%1$s: équipe" on public.%1$s', t);
    execute format('create policy "%1$s: équipe" on public.%1$s for select to authenticated using (public.is_staff())', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select on public.%1$s to authenticated', t);
  end loop;
end $$;

-- ───────── Le contenu de l'e-mail (un seul texte, quatre variantes d'introduction et de bouton) ─────────
create or replace function private.bc_yt_build(seg text, nm text, tok uuid, unsub uuid, when_fr text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  site text := 'https://rdv.theambitiousman.fr';
  nom text := replace(replace(replace(coalesce(nm, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  lnk text := site || '/api/c?t=' || tok || '&to=';
  btn text := 'display:block;text-align:center;background:#E9C53E;color:#1a1400;font-weight:700;text-decoration:none;padding:15px;border-radius:12px;margin:6px 0 16px';
  btn2 text := 'display:block;text-align:center;border:2px solid #1a1400;color:#1a1400;font-weight:700;text-decoration:none;padding:13px;border-radius:12px;margin:0 0 18px';
  p text := 'margin:0 0 14px';
  fig text := 'display:block;width:100%;max-width:520px;height:auto;border:1px solid #e6e2d6;border-radius:10px';
  intro text; cta text;
begin
  intro := case seg
    when 'rdv' then '<p style="' || p || '">Tu as ton appel prévu ' || coalesce(when_fr, 'prochainement') || '. Avant, regarde cette vidéo : elle te montre exactement ce que je fais.</p>'
    when 'absent' then '<p style="' || p || '">On s''est loupés pour notre appel. Pas de souci : voilà ma nouvelle vidéo, et en bas le lien pour reprendre un créneau.</p>'
    else '' end;
  cta := case seg
    when 'rdv' then '<a href="' || lnk || 'video" style="' || btn || '">Regarder la vidéo →</a>'
    when 'methode' then '<a href="' || lnk || 'video" style="' || btn || '">Regarder la vidéo →</a>'
      || '<p style="' || p || '">Si tu veux te lancer par toi-même, étape par étape, la Méthode E-Connect est là :</p>'
      || '<a href="' || lnk || 'methode" style="' || btn2 || '">Découvrir la Méthode →</a>'
    when 'absent' then '<a href="' || lnk || 'video" style="' || btn || '">Regarder la vidéo →</a>'
      || '<a href="' || lnk || 'rdv" style="' || btn2 || '">Reprendre un créneau</a>'
    else '<a href="' || lnk || 'video" style="' || btn || '">Regarder la vidéo →</a>'
      || '<p style="' || p || '">Si, après la vidéo, tu veux qu''on regarde ensemble comment le lancer pour toi :</p>'
      || '<a href="' || lnk || 'rdv" style="' || btn2 || '">Réserver mon appel gratuit</a>' end;
  return jsonb_build_object('subject', 'Ma nouvelle vidéo vient de sortir', 'html',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">51 commandes en 48 h, sans dropshipping. Je te montre tout.</div>'
    || '<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1d1b16">'
    || '<p style="' || p || '">Salut' || case when nom <> '' then ' ' || nom else '' end || ',</p>'
    || intro
    || '<h1 style="font-size:21px;line-height:1.3;margin:0 0 14px">« J''ai essayé l''e-commerce SANS dropshipping pendant 48 h » est en ligne</h1>'
    || '<p style="' || p || '">J''ai lancé un produit de zéro, sans dropshipping. Résultat : <b>51 commandes et 1 560 € de chiffre d''affaires en 48 heures.</b></p>'
    || '<p style="margin:0 0 4px"><img src="' || site || '/mail/yt-boutique.jpg" width="520" alt="Mon tableau de bord boutique" style="' || fig || '"></p>'
    || '<p style="margin:0 0 16px;font-size:12px;color:#6b675c">Mon tableau de bord boutique</p>'
    || '<p style="margin:0 0 4px"><img src="' || site || '/mail/yt-pubs.jpg" width="520" alt="Mes publicités" style="' || fig || '"></p>'
    || '<p style="margin:0 0 16px;font-size:12px;color:#6b675c">Mes publicités</p>'
    || '<p style="' || p || '">Pas de produit livré en 3 semaines depuis la Chine. Pas de pub à 50 € par jour en priant pour la première vente. J''ai mis environ 200 € de pub, et je te montre exactement ce que j''ai fait, étape par étape.</p>'
    || '<p style="margin:0 0 6px">Dans la vidéo :</p>'
    || '<ul style="margin:0 0 16px;padding-left:20px"><li>c''est quoi faire de l''e-commerce sans dropshipping</li><li>ce qui s''est passé pendant ces 48 heures, en direct</li><li>comment toi, tu peux le lancer en partant de zéro</li></ul>'
    || cta
    || '<p style="margin:0 0 14px;font-size:13px;color:#6b675c">Les chiffres sont du chiffre d''affaires, pas du bénéfice. Ça demande du travail.</p>'
    || '<p style="' || p || '">Clément</p>'
    || '<p style="' || p || '">P.-S. Dis-moi en commentaire si tu as déjà testé le dropshipping ou si tu pars de zéro. Je réponds à tout le monde.</p>'
    || '<div style="border-top:1px solid #e6e2d6;margin-top:22px;padding-top:12px;font-size:12px;color:#8a8575">Tu reçois cet e-mail parce que tu as commencé une candidature chez L''Accélérateur. <a href="' || site || '/stop/' || unsub || '" style="color:#8a8575">Me désinscrire</a></div>'
    || '<img src="' || site || '/api/o?t=' || tok || '" width="1" height="1" alt="" style="display:block;border:0">'
    || '</div>');
end $$;

-- ───────── Envoi : 8 par minute, de 9 h à 21 h (Paris) ─────────
create or replace function public.mail_bc_tick() returns int
language plpgsql security definer set search_path = public, private as $$
declare h int := extract(hour from now() at time zone 'Europe/Paris')::int; b public.mail_bc; l public.cand_leads; r jsonb; w text; n int := 0;
begin
  if h < 9 or h >= 21 then return 0; end if;
  for b in select * from public.mail_bc q where q.status = 'attente' order by q.id limit 8 loop
    select * into l from public.cand_leads where id = b.lead_id;
    if not found or not private.mail_lead_ok(l) or private.mail_has_cand(l.email, array['fait']) then
      update public.mail_bc set status = 'annule' where id = b.id; continue;
    end if;
    w := (select to_char(c.starts_at at time zone 'Europe/Paris', 'DD/MM "à" HH24"h"MI') from public.candidatures c
           where lower(c.email) = lower(l.email) and c.status in ('reserve', 'confirme') and c.starts_at > now() order by c.starts_at limit 1);
    r := private.bc_yt_build(b.segment, l.first_name, b.token, l.unsub_token, case when w is null then null else 'le ' || w end);
    perform private.send_email(l.email, r ->> 'subject', r ->> 'html', 'Clément');
    update public.mail_bc set status = 'envoye', sent_at = now() where id = b.id;
    update public.cand_leads set mail_log = coalesce(mail_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('k', 'mseq', 'label', 'Nouvelle vidéo YouTube', 'subject', r ->> 'subject', 'at', now())) where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.mail_bc_tick() from public, anon, authenticated;

-- ───────── Suivi (appelé par le site de réservation) ─────────
create or replace function public.mail_bc_open(p_token uuid) returns void
language sql security definer set search_path = public as $$
  update public.mail_bc set opened_at = coalesce(opened_at, now()), open_n = open_n + 1 where token = p_token and status = 'envoye'
$$;
grant execute on function public.mail_bc_open(uuid) to anon, authenticated;

create or replace function public.mail_bc_click(p_token uuid, p_to text) returns text
language plpgsql security definer set search_path = public as $$
declare dest text := case p_to
    when 'rdv' then 'https://rdv.theambitiousman.fr/y/BKjD49O6lJE?utm_content=email'
    when 'methode' then 'https://econnect-membres.vercel.app/methode/?utm_source=email&utm_medium=newsletter&utm_campaign=yt_20_nov'
    else 'https://youtu.be/BKjD49O6lJE' end;
begin
  update public.mail_bc set clicked_at = coalesce(clicked_at, now()), click_n = click_n + 1, click_to = case when p_to in ('rdv', 'methode') then p_to else 'video' end,
         opened_at = coalesce(opened_at, now()) where token = p_token and status = 'envoye';
  return dest;
end $$;
grant execute on function public.mail_bc_click(uuid, text) to anon, authenticated;

-- ───────── Bilan automatique ─────────
create or replace function public.mail_bc_report() returns int
language plpgsql security definer set search_path = public, private as $$
declare c public.mail_campaigns; s int; o int; k int; rdv int; html text; t int := 0; seg record;
begin
  for c in select * from public.mail_campaigns x where not x.report_sent and x.report_at is not null and x.report_at <= now() loop
    select count(*) filter (where status = 'envoye'), count(*) filter (where opened_at is not null), count(*) filter (where clicked_at is not null)
      into s, o, k from public.mail_bc where campaign = c.key;
    select count(distinct b.lead_id) into rdv from public.mail_bc b join public.cand_leads l on l.id = b.lead_id
     where b.campaign = c.key and b.status = 'envoye'
       and exists (select 1 from public.candidatures x where lower(x.email) = lower(l.email) and x.created_at > b.sent_at and x.status <> 'annule');
    html := '<p><b>' || replace(c.name, '<', '&lt;') || '</b> : bilan à 4 jours.</p>'
      || '<p>' || s || ' envoyés · ' || o || ' ouvertures (' || case when s > 0 then round(100.0 * o / s) else 0 end || ' %) · ' || k || ' clics (' || case when s > 0 then round(100.0 * k / s) else 0 end || ' %) · ' || rdv || ' rendez-vous pris depuis l''envoi.</p><ul>';
    for seg in select segment, count(*) filter (where status = 'envoye') as s, count(*) filter (where opened_at is not null) as o, count(*) filter (where clicked_at is not null) as k
                 from public.mail_bc where campaign = c.key group by segment order by segment loop
      html := html || '<li>' || seg.segment || ' : ' || seg.s || ' envoyés, ' || seg.o || ' ouverts, ' || seg.k || ' clics</li>';
    end loop;
    html := html || '</ul><p>Les ouvertures sont approximatives (certaines messageries les comptent d''office, d''autres bloquent les images). Le détail est dans Calio, onglet Newsletter.</p>';
    perform private.mail_tell_me('Bilan de ta newsletter : ' || s || ' envoyés, ' || o || ' ouverts, ' || k || ' clics', html,
      s || ' envoyés · ' || o || ' ouverts · ' || k || ' clics · ' || rdv || ' RDV');
    update public.mail_campaigns set report_sent = true where key = c.key;
    t := t + 1;
  end loop;
  return t;
end $$;
revoke all on function public.mail_bc_report() from public, anon, authenticated;

do $$ begin perform cron.unschedule('mail-bc-tick'); exception when others then null; end $$;
select cron.schedule('mail-bc-tick', '* * * * *', 'select public.mail_bc_tick()');
do $$ begin perform cron.unschedule('mail-bc-report'); exception when others then null; end $$;
select cron.schedule('mail-bc-report', '7 * * * *', 'select public.mail_bc_report()');

-- ───────── La campagne « nouvelle vidéo » du 20/11/2026 ─────────
insert into public.mail_campaigns (key, name, subject, video_id, report_at)
values ('yt-2026-11-20', 'Nouvelle vidéo : e-commerce sans dropshipping (20/11)', 'Ma nouvelle vidéo vient de sortir', 'BKjD49O6lJE', timestamptz '2026-11-24 17:00:00+00')
on conflict (key) do nothing;
