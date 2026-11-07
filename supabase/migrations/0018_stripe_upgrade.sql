-- 0018 : passage Méthode (97 €) → accompagnement 160 €/mois en un clic, débité sur la carte enregistrée (fonction Edge « stripe-upgrade »)

-- clé secrète Stripe (sk_live_…), posée par l'admin dans Admin → Stripe
create or replace function public.set_stripe_key(p_key text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if p_key !~ '^(sk|rk)_(live|test)_[A-Za-z0-9]+$' then raise exception 'La clé doit commencer par sk_live_ (ou rk_live_)'; end if;
  insert into private.secrets (key, value) values ('stripe_sk', p_key) on conflict (key) do update set value = excluded.value;
  delete from private.secrets where key = 'stripe_price_accel';   -- recréé par la fonction avec la nouvelle clé
  return true;
end $$;
create or replace function public.stripe_key_set() returns boolean language sql stable security definer set search_path = public, private as
$$ select public.is_admin() and exists (select 1 from private.secrets where key = 'stripe_sk') $$;
revoke all on function public.set_stripe_key(text), public.stripe_key_set() from public, anon;
grant execute on function public.set_stripe_key(text), public.stripe_key_set() to authenticated;

-- lecture/écriture réservées à la fonction Edge (service_role)
create or replace function public.stripe_secrets_for_fn() returns jsonb language sql security definer stable set search_path = public, private as
$$ select jsonb_build_object('sk', (select value from private.secrets where key = 'stripe_sk'), 'price', (select value from private.secrets where key = 'stripe_price_accel')) $$;
create or replace function public.stripe_set_price_for_fn(p_price text) returns boolean language sql security definer set search_path = public, private as
$$ insert into private.secrets (key, value) values ('stripe_price_accel', p_price) on conflict (key) do update set value = excluded.value returning true $$;
create or replace function public.stripe_grant_accel_for_fn(p_email text, p_customer text) returns text language sql security definer set search_path = public, private as
$$ select private.grant_access(lower(p_email), true, true, 'stripe-upgrade', p_customer) $$;
revoke all on function public.stripe_secrets_for_fn(), public.stripe_set_price_for_fn(text), public.stripe_grant_accel_for_fn(text, text) from public, anon, authenticated;
grant execute on function public.stripe_secrets_for_fn(), public.stripe_set_price_for_fn(text), public.stripe_grant_accel_for_fn(text, text) to service_role;

-- journal des passages
create table if not exists public.stripe_upgrades (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  email text, customer text, subscription text, status text, created_at timestamptz default now()
);
alter table public.stripe_upgrades enable row level security;
drop policy if exists "upgrades: admin" on public.stripe_upgrades;
create policy "upgrades: admin" on public.stripe_upgrades for select to authenticated using (public.is_admin());
