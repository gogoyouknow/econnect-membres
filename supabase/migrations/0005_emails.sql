-- 0005 : emails transactionnels envoyés depuis la base via Resend (bienvenue, rappel de live)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- secrets (schéma privé, jamais exposé par l'API)
create schema if not exists private;
create table if not exists private.secrets (key text primary key, value text not null);
revoke all on schema private from public, anon, authenticated;
revoke all on private.secrets from public, anon, authenticated;
-- clé Resend (remplacer ici si la clé change)
insert into private.secrets (key, value) values ('resend', 'RESEND_API_KEY') on conflict (key) do update set value = excluded.value;

-- gabarit HTML commun (charte : noir, or, logo)
create or replace function private.email_html(title text, body_html text) returns text language sql immutable as $$
  select '<!doctype html><html lang="fr"><body style="margin:0;background:#f3f1ea;padding:24px 12px;font-family:Poppins,Arial,sans-serif;color:#17160f">'
  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:14px;overflow:hidden">'
  || '<tr><td style="background:#0a0a0a;padding:18px 24px;color:#fff;font-weight:800;font-size:13px;letter-spacing:.6px">'
  || '<img src="https://econnect-membres.vercel.app/icon-192.png" width="26" height="26" alt="" style="vertical-align:middle;border-radius:7px;margin-right:10px">L''ACCÉLÉRATEUR</td></tr>'
  || '<tr><td style="padding:26px 24px 22px"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.25;color:#111">' || title || '</h1>' || body_html || '</td></tr>'
  || '<tr><td style="padding:14px 24px;border-top:1px solid #eee;font-size:11px;color:#999;line-height:1.5"><b style="color:#555">L''Accélérateur · Vision Corp Ltd</b><br>Cet email est envoyé automatiquement, les réponses ne sont pas lues. Pour une question, écris directement dans l''app.</td></tr>'
  || '</table></td></tr></table></body></html>'
$$;

create or replace function private.btn(label text, url text) returns text language sql immutable as $$
  select '<p style="margin:16px 0 18px"><a href="' || url || '" style="display:inline-block;background:#E9C53E;color:#1a1400;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:14px">' || label || '</a></p>'
$$;

-- envoi via Resend
create or replace function private.send_email(to_email text, subject text, html text, from_name text default 'L''Accélérateur') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare k text; rid bigint;
begin
  select value into k from private.secrets where key = 'resend';
  if k is null then raise notice 'resend key missing'; return null; end if;
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', from_name || ' <laccelerateur@theambitiousman.fr>', 'to', jsonb_build_array(to_email), 'subject', subject, 'html', html)
  ) into rid;
  return rid;
end $$;

-- 1) Bienvenue : dès qu'un email est autorisé (manuel aujourd'hui, Hotmart demain)
create or replace function public.on_allowed_email() returns trigger language plpgsql security definer set search_path = public as $$
declare first text; body text;
begin
  if exists (select 1 from public.profiles where lower(email) = lower(new.email)) then return new; end if; -- déjà inscrit
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
drop trigger if exists allowed_emails_welcome on public.allowed_emails;
create trigger allowed_emails_welcome after insert on public.allowed_emails for each row execute function public.on_allowed_email();

-- 2) Rappel de live 1 h avant (cron toutes les 10 min)
alter table public.lives add column if not exists reminded boolean not null default false;
create or replace function public.send_live_reminders() returns int language plpgsql security definer set search_path = public as $$
declare l record; m record; n int := 0; body text; when_txt text;
begin
  for l in select * from public.lives where not reminded and starts_at between now() + interval '50 minutes' and now() + interval '70 minutes' loop
    when_txt := to_char(l.starts_at at time zone 'Europe/Paris', 'HH24"h"MI');
    for m in select email, first_name from public.profiles where active and notif_lives and (tier >= l.tier_required or role <> 'member') loop
      body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333"><b>' || l.title || '</b>, avec ' || l.host || '. ' || coalesce('', '') || '</p>'
           || private.btn('Rejoindre le live', coalesce(l.link, 'https://econnect-membres.vercel.app/#lives'))
           || '<p style="margin:0;font-size:12px;color:#777">Le replay sera dans l''app, onglet Lives. Tu peux couper les rappels dans Mon profil → Notifications.</p>';
      perform private.send_email(m.email, 'Live dans 1 h : ' || l.title, private.email_html('On se retrouve à ' || when_txt, body), 'Clément · L''Accélérateur');
      n := n + 1;
    end loop;
    insert into public.notifications (user_id, title, body, url) select id, 'Live dans 1 h : ' || l.title, 'À ' || when_txt || ' avec ' || l.host, '#lives' from public.profiles where active and notif_lives and (tier >= l.tier_required or role <> 'member');
    update public.lives set reminded = true where id = l.id;
  end loop;
  return n;
end $$;
select cron.unschedule('live-reminders') where exists (select 1 from cron.job where jobname = 'live-reminders');
select cron.schedule('live-reminders', '*/10 * * * *', $$select public.send_live_reminders()$$);
