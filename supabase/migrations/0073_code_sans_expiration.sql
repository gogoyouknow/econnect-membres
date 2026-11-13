-- 0073 : code de connexion Calio sans date d'expiration, à usage unique.
-- Il est consommé dès la première connexion réussie (ou remplacé si on en renvoie un autre). 20 essais maximum.
create table if not exists private.login_fixed (
  email text primary key,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create or replace function private.calio_send_fixed_code(p_email text) returns void
language plpgsql security definer set search_path = public, private, extensions, auth as $$
declare em text := lower(trim(p_email)); code text;
begin
  code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into private.login_fixed (email, code_hash, attempts, created_at)
  values (em, encode(digest(code || ':' || em, 'sha256'), 'hex'), 0, now())
  on conflict (email) do update set code_hash = excluded.code_hash, attempts = 0, created_at = now();
  perform private.send_email(em, 'Ton code de connexion Calio : ' || code,
    '<div style="font-size:15px;line-height:1.55;color:#222"><p>Voici ton code pour te connecter à Calio :</p>'
    || '<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:14px 0">' || code || '</p>'
    || '<p>Ouvre <a href="https://rdv.theambitiousman.fr/admin">rdv.theambitiousman.fr/admin</a>, touche « Me connecter avec un code reçu par email », entre ton email et ce code. Il n''expire pas : il tombe dès que tu es connectée.</p>'
    || '<p>Si ce n''est pas toi, ignore simplement cet email.</p></div>', 'Calio');
end $$;
revoke all on function private.calio_send_fixed_code(text) from public, anon, authenticated;

create or replace function public.calio_login_check(p_email text, p_code text) returns boolean
language plpgsql security definer set search_path = public, private, extensions, auth as $$
declare em text := lower(trim(coalesce(p_email, ''))); r private.pw_reset; f private.login_fixed;
        cd text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g'); h text;
begin
  h := encode(digest(cd || ':' || em, 'sha256'), 'hex');
  select * into r from private.pw_reset where email = em;
  if found and r.expires_at >= now() and r.attempts < 5 then
    if r.code_hash = h then delete from private.pw_reset where email = em; delete from private.login_fixed where email = em; return true; end if;
    update private.pw_reset set attempts = attempts + 1 where email = em;
  end if;
  select * into f from private.login_fixed where email = em;
  if found and f.attempts < 20 then
    if f.code_hash = h then delete from private.login_fixed where email = em; delete from private.pw_reset where email = em; return true; end if;
    update private.login_fixed set attempts = attempts + 1 where email = em;
  end if;
  return false;
end $$;
revoke all on function public.calio_login_check(text, text) from public, anon, authenticated;
grant execute on function public.calio_login_check(text, text) to service_role;
