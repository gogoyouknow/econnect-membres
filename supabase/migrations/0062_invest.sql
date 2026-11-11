-- 0062 : nouveau parcours TikTok : on enregistre aussi « as-tu déjà investi dans une formation ou un coaching ? » (invest). Le texte libre (blocage) devient « Quel est ton problème principal ? ».
alter table public.cand_leads add column if not exists invest text;

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
  src text := left(trim(coalesce(p ->> 'source', '')), 60);
  ref text := left(trim(coalesce(p ->> 'referrer', '')), 200);
  lnd text := left(trim(coalesce(p ->> 'landing', '')), 200);
  ut jsonb := case when jsonb_typeof(p -> 'utm') = 'object' then p -> 'utm' else null end;
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
    insert into public.cand_leads (sid, first_name, phone, email, phone_raw, email_raw, situation, capital, budget_confirmed, step, source, referrer, landing, utm, experience, blocage, invest)
    values (v_sid, nullif(nm, ''), nullif(ph, ''), nullif(em, ''), nullif(ph_raw, ''), nullif(em_raw, ''),
            nullif(left(p ->> 'situation', 40), ''), nullif(left(p ->> 'capital', 20), ''), nullif(left(p ->> 'budget_confirmed', 10), ''), st,
            nullif(src, ''), nullif(ref, ''), nullif(lnd, ''), ut,
            nullif(left(p ->> 'experience', 40), ''), nullif(left(p ->> 'blocage', 2000), ''), nullif(left(p ->> 'invest', 40), ''));
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
      experience = coalesce(nullif(left(p ->> 'experience', 40), ''), l.experience),
      blocage = coalesce(nullif(left(p ->> 'blocage', 2000), ''), l.blocage),
      invest = coalesce(nullif(left(p ->> 'invest', 40), ''), l.invest),
      source = coalesce(l.source, nullif(src, '')),
      referrer = coalesce(l.referrer, nullif(ref, '')),
      landing = coalesce(l.landing, nullif(lnd, '')),
      utm = coalesce(l.utm, ut),
      step = case when array_position(ranks, st) > array_position(ranks, l.step) then st else l.step end
    where l.id = lid;
  end if;
end $$;
grant execute on function public.cand_lead(jsonb) to anon, authenticated;

create or replace view public.prospects_v with (security_invoker = true) as
select l.id, l.created_at, l.updated_at, l.first_name, l.last_name, l.phone, l.email, l.phone_raw, l.email_raw,
       l.situation, l.capital, l.budget_confirmed, l.step, l.follow, l.note, l.booked,
       l.source, l.referrer, l.landing, l.utm, l.closer, l.tags,
       c.id as call_id, c.starts_at as call_at, c.status as call_status, c.created_at as call_created,
       coalesce(n.n, 0) as calls,
       case
         when c.id is not null and c.status = 'annule' then 'annule'
         when c.id is not null and c.status = 'fait' then 'fait'
         when c.id is not null and c.status = 'absent' then 'absent'
         when c.id is not null then 'rdv'
         when l.capital = 'lt500' or l.budget_confirmed in ('soon', 'no') then 'disqualifie'
         when l.step = 'slot' or l.budget_confirmed = 'yes' then 'qualifie'
         when coalesce(l.phone, '') = '' and coalesce(l.email, '') = '' then 'incomplet'
         else 'potentiel'
       end as stage,
       l.qtoken,
       l.experience, l.blocage, l.invest
  from public.cand_leads l
  left join lateral (
    select c1.* from public.candidatures c1
     where (l.email is not null and lower(c1.email) = lower(l.email)) or (l.phone is not null and c1.phone = l.phone)
     order by (c1.status in ('reserve', 'confirme')) desc, c1.starts_at desc limit 1
  ) c on true
  left join lateral (
    select count(*)::int as n from public.candidatures c2
     where (l.email is not null and lower(c2.email) = lower(l.email)) or (l.phone is not null and c2.phone = l.phone)
  ) n on true;
grant select on public.prospects_v to authenticated;
