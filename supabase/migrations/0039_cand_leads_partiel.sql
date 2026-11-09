-- 0039 : on garde aussi les saisies PARTIELLES (prénom seul, numéro ou email pas terminé).
-- phone / email = valeurs valides (servent à relancer et à repérer une réservation) ; phone_raw / email_raw = ce qui a été tapé.

alter table public.cand_leads add column if not exists phone_raw text;
alter table public.cand_leads add column if not exists email_raw text;

create or replace function public.cand_lead(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sid text := left(coalesce(p ->> 'sid', ''), 64);
  em_raw text := left(trim(coalesce(p ->> 'email', '')), 120);
  ph_raw text := left(trim(coalesce(p ->> 'phone_raw', p ->> 'phone', '')), 40);
  em text := lower(em_raw);
  ph text := left(trim(coalesce(p ->> 'phone', '')), 40);
  nm text := left(trim(coalesce(p ->> 'first_name', '')), 80);
  st text := coalesce(p ->> 'step', 'who');
  lid bigint;
  ranks text[] := array['who', 'situ', 'budget', 'slot'];
begin
  if length(v_sid) < 8 then return; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then em := ''; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) < 8 then ph := ''; end if;
  if nm = '' and em_raw = '' and length(regexp_replace(ph_raw, '\D', '', 'g')) = 0 then return; end if;
  if not (st = any (ranks)) then st := 'who'; end if;

  select id into lid from public.cand_leads
   where sid = v_sid or (em <> '' and lower(email) = em) or (ph <> '' and phone = ph)
   order by (sid = v_sid) desc, updated_at desc limit 1;

  if lid is null then
    insert into public.cand_leads (sid, first_name, phone, email, phone_raw, email_raw, situation, capital, budget_confirmed, step)
    values (v_sid, nullif(nm, ''), nullif(ph, ''), nullif(em, ''), nullif(ph_raw, ''), nullif(em_raw, ''),
            nullif(left(p ->> 'situation', 40), ''), nullif(left(p ->> 'capital', 20), ''), nullif(left(p ->> 'budget_confirmed', 10), ''), st);
  else
    update public.cand_leads l set
      updated_at = now(),
      first_name = coalesce(nullif(nm, ''), l.first_name),
      phone = coalesce(nullif(ph, ''), l.phone),
      email = coalesce(nullif(em, ''), l.email),
      phone_raw = coalesce(nullif(ph_raw, ''), l.phone_raw),
      email_raw = coalesce(nullif(em_raw, ''), l.email_raw),
      situation = coalesce(nullif(left(p ->> 'situation', 40), ''), l.situation),
      capital = coalesce(nullif(left(p ->> 'capital', 20), ''), l.capital),
      budget_confirmed = coalesce(nullif(left(p ->> 'budget_confirmed', 10), ''), l.budget_confirmed),
      step = case when array_position(ranks, st) > array_position(ranks, l.step) then st else l.step end
    where l.id = lid;
  end if;
end $$;
grant execute on function public.cand_lead(jsonb) to anon, authenticated;
