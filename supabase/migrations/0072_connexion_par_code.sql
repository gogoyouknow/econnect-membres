-- 0072 : connexion à Calio par un code à 6 chiffres reçu par email (sans mot de passe). Réservé aux comptes admin et closer.
-- Même règles que le code « mot de passe oublié » : 15 minutes, 5 essais, un seul envoi par minute.

create or replace function public.calio_login_request(p_email text) returns jsonb
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
  perform private.send_email(em, 'Ton code de connexion Calio : ' || code,
    '<div style="font-size:15px;line-height:1.55;color:#222"><p>Voici ton code pour te connecter à Calio :</p>'
    || '<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:14px 0">' || code || '</p>'
    || '<p>Ouvre <a href="https://rdv.theambitiousman.fr/admin#code">rdv.theambitiousman.fr/admin</a>, touche « J''ai déjà un code », entre ton email et ce code. Il est valable 15 minutes.</p>'
    || '<p>Si ce n''est pas toi, ignore simplement cet email.</p></div>', 'Calio');
  return jsonb_build_object('ok', true);
exception when others then return jsonb_build_object('ok', true);
end $$;
grant execute on function public.calio_login_request(text) to anon, authenticated;

-- Vérifie et consomme le code. Appelée uniquement par la fonction Edge calio-login (clé de service), jamais depuis le navigateur.
create or replace function public.calio_login_check(p_email text, p_code text) returns boolean
language plpgsql security definer set search_path = public, private, extensions, auth as $$
declare em text := lower(trim(coalesce(p_email, ''))); r private.pw_reset; cd text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
begin
  select * into r from private.pw_reset where email = em;
  if not found or r.expires_at < now() or r.attempts >= 5 then return false; end if;
  if r.code_hash <> encode(digest(cd || ':' || em, 'sha256'), 'hex') then
    update private.pw_reset set attempts = attempts + 1 where email = em;
    return false;
  end if;
  delete from private.pw_reset where email = em;
  return true;
end $$;
revoke all on function public.calio_login_check(text, text) from public, anon, authenticated;
grant execute on function public.calio_login_check(text, text) to service_role;
