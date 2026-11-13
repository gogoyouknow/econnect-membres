-- 0070 : « Mot de passe oublié » de Calio, sans lien ni redirection : un code à 6 chiffres envoyé par email, puis le nouveau mot de passe.
-- Réservé aux comptes de l'équipe (admin, closer). Le code vaut 15 minutes, 5 essais maximum, un seul envoi par minute.

create table if not exists private.pw_reset (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.calio_reset_request(p_email text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions, auth as $$
declare em text := lower(trim(coalesce(p_email, ''))); uid uuid; code text; r private.pw_reset;
begin
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then return jsonb_build_object('ok', true); end if;
  select u.id into uid from auth.users u where lower(u.email) = em limit 1;
  if uid is null then return jsonb_build_object('ok', true); end if;
  if not (exists (select 1 from public.profiles p where p.id = uid and p.role in ('admin', 'closer'))
          or exists (select 1 from public.cand_closers c where c.user_id = uid)) then return jsonb_build_object('ok', true); end if;
  select * into r from private.pw_reset where email = em;
  if found and r.created_at > now() - interval '60 seconds' then return jsonb_build_object('ok', true); end if;
  code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.pw_reset (email, code_hash, expires_at, attempts, created_at)
  values (em, encode(digest(code || ':' || em, 'sha256'), 'hex'), now() + interval '15 minutes', 0, now())
  on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now();
  perform private.send_email(em, 'Ton code Calio : ' || code,
    '<div style="font-size:15px;line-height:1.55;color:#222"><p>Voici ton code pour choisir un nouveau mot de passe Calio :</p>'
    || '<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:14px 0">' || code || '</p>'
    || '<p>Il est valable 15 minutes. Si ce n''est pas toi, ignore simplement cet email.</p></div>', 'Calio');
  return jsonb_build_object('ok', true);
exception when others then return jsonb_build_object('ok', true);
end $$;
grant execute on function public.calio_reset_request(text) to anon, authenticated;

create or replace function public.calio_reset_confirm(p_email text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions, auth as $$
declare em text := lower(trim(coalesce(p_email, ''))); r private.pw_reset; uid uuid; cd text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
begin
  if length(coalesce(p_password, '')) < 8 then return jsonb_build_object('ok', false, 'error', '8 caractères minimum pour le mot de passe.'); end if;
  select * into r from private.pw_reset where email = em;
  if not found or r.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'Ce code a expiré. Demande-en un nouveau.'); end if;
  if r.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'Trop d''essais. Demande un nouveau code.'); end if;
  if r.code_hash <> encode(digest(cd || ':' || em, 'sha256'), 'hex') then
    update private.pw_reset set attempts = attempts + 1 where email = em;
    return jsonb_build_object('ok', false, 'error', 'Code incorrect.');
  end if;
  select u.id into uid from auth.users u where lower(u.email) = em limit 1;
  if uid is null then return jsonb_build_object('ok', false, 'error', 'Code incorrect.'); end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
  delete from private.pw_reset where email = em;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.calio_reset_confirm(text, text, text) to anon, authenticated;
