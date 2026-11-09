-- 0035 : candidatures abandonnées — on garde prénom / WhatsApp / email dès que la personne les saisit,
-- même si elle ne réserve pas de créneau, pour pouvoir la relancer depuis « Mes appels ».

create table if not exists public.cand_leads (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sid text not null unique,
  first_name text, phone text, email text,
  situation text, capital text, budget_confirmed text,
  step text not null default 'who' check (step in ('who', 'situ', 'budget', 'slot')),
  booked boolean not null default false,
  follow text not null default 'new' check (follow in ('new', 'done', 'skip')),
  note text not null default ''
);
create index if not exists cand_leads_upd_idx on public.cand_leads (updated_at desc);
create index if not exists cand_leads_email_idx on public.cand_leads (lower(email));
create index if not exists cand_leads_phone_idx on public.cand_leads (phone);

alter table public.cand_leads enable row level security;
drop policy if exists "cand_leads: équipe" on public.cand_leads;
create policy "cand_leads: équipe" on public.cand_leads for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Appelée par la page publique à chaque étape (et dès que l'email / le numéro est valide). Ne renvoie rien.
create or replace function public.cand_lead(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sid text := left(coalesce(p ->> 'sid', ''), 64);
  em text := lower(trim(coalesce(p ->> 'email', '')));
  ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  nm text := left(trim(coalesce(p ->> 'first_name', '')), 80);
  st text := coalesce(p ->> 'step', 'who');
  lid bigint;
  ranks text[] := array['who', 'situ', 'budget', 'slot'];
begin
  if length(v_sid) < 8 then return; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then em := ''; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then ph := ''; end if;
  if em = '' and ph = '' then return; end if;
  if not (st = any (ranks)) then st := 'who'; end if;

  select id into lid from public.cand_leads
   where sid = v_sid or (em <> '' and lower(email) = em) or (ph <> '' and phone = ph)
   order by (sid = v_sid) desc, updated_at desc limit 1;

  if lid is null then
    insert into public.cand_leads (sid, first_name, phone, email, situation, capital, budget_confirmed, step)
    values (v_sid, nullif(nm, ''), nullif(ph, ''), nullif(em, ''), nullif(left(p ->> 'situation', 40), ''), nullif(left(p ->> 'capital', 20), ''), nullif(left(p ->> 'budget_confirmed', 10), ''), st);
  else
    update public.cand_leads l set
      updated_at = now(),
      first_name = coalesce(nullif(nm, ''), l.first_name),
      phone = coalesce(nullif(ph, ''), l.phone),
      email = coalesce(nullif(em, ''), l.email),
      situation = coalesce(nullif(left(p ->> 'situation', 40), ''), l.situation),
      capital = coalesce(nullif(left(p ->> 'capital', 20), ''), l.capital),
      budget_confirmed = coalesce(nullif(left(p ->> 'budget_confirmed', 10), ''), l.budget_confirmed),
      step = case when array_position(ranks, st) > array_position(ranks, l.step) then st else l.step end
    where l.id = lid;
  end if;
end $$;
grant execute on function public.cand_lead(jsonb) to anon, authenticated;

-- Dès qu'une réservation est créée, la fiche « abandon » correspondante est marquée réservée (plus à relancer).
create or replace function public.cand_lead_booked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.cand_leads set booked = true, updated_at = now()
   where (new.email is not null and lower(email) = lower(new.email)) or (new.phone is not null and phone = new.phone);
  return new;
end $$;
drop trigger if exists cand_lead_booked_trg on public.candidatures;
create trigger cand_lead_booked_trg after insert on public.candidatures for each row execute function public.cand_lead_booked();
