-- 0043 : lien personnel pour TOUS les prospects + suivi de la page « Avant notre appel » (ouverte, vidéo lancée, questions écrites).

alter table public.cand_leads add column if not exists qtoken uuid not null default gen_random_uuid();
create unique index if not exists cand_leads_qtoken_idx on public.cand_leads (qtoken);

-- La vue expose le code personnel (ajouté en dernière colonne).
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
       l.qtoken
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

-- Retrouve la personne derrière un code (appel réservé OU fiche prospect) ou, à défaut, derrière l'identifiant du navigateur.
create or replace function public.cand_resolve(t text, s text, out o_cid bigint, out o_lid bigint)
language plpgsql security definer set search_path = public as $$
declare ce text; cp text;
begin
  if coalesce(t, '') <> '' then
    select c.id, c.email, c.phone into o_cid, ce, cp from public.candidatures c where c.qtoken::text = t;
    if o_cid is null then
      select l.id, l.email, l.phone into o_lid, ce, cp from public.cand_leads l where l.qtoken::text = t;
    else
      select l.id into o_lid from public.cand_leads l
       where (ce is not null and lower(l.email) = lower(ce)) or (cp is not null and l.phone = cp) order by l.updated_at desc limit 1;
    end if;
  end if;
  if o_lid is null and coalesce(s, '') <> '' then select l.id into o_lid from public.cand_leads l where l.sid = s; end if;
  if o_cid is null and o_lid is not null then
    select c.id into o_cid from public.candidatures c join public.cand_leads l on l.id = o_lid
     where (l.email is not null and lower(c.email) = lower(l.email)) or (l.phone is not null and c.phone = l.phone) order by c.starts_at desc limit 1;
  end if;
end $$;
revoke all on function public.cand_resolve(text, text) from public, anon, authenticated;

-- Journal de la page de préparation.
create table if not exists public.cand_page_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  candidature_id bigint references public.candidatures (id) on delete cascade,
  lead_id bigint references public.cand_leads (id) on delete cascade,
  kind text not null check (kind in ('open', 'play', 'notes')),
  label text
);
create index if not exists cand_page_events_lead_idx on public.cand_page_events (lead_id, created_at);
create index if not exists cand_page_events_cand_idx on public.cand_page_events (candidature_id, created_at);
alter table public.cand_page_events enable row level security;
drop policy if exists "cand_page_events: équipe" on public.cand_page_events;
create policy "cand_page_events: équipe" on public.cand_page_events for select to authenticated using (public.is_staff());

-- Appelée par la page publique. Sans personne identifiée, rien n'est enregistré. Doublons rapprochés ignorés.
create or replace function public.cand_page_track(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text := left(coalesce(p ->> 't', ''), 64);
  s text := left(coalesce(p ->> 'sid', ''), 64);
  k text := coalesce(p ->> 'kind', '');
  lb text := nullif(left(trim(coalesce(p ->> 'label', '')), 140), '');
  v_cid bigint; v_lid bigint;
begin
  if k not in ('open', 'play', 'notes') then return; end if;
  if length(t) < 8 and length(s) < 8 then return; end if;
  select r.o_cid, r.o_lid into v_cid, v_lid from public.cand_resolve(t, s) r;
  if v_cid is null and v_lid is null then return; end if;
  if exists (
    select 1 from public.cand_page_events e
     where e.kind = k and e.label is not distinct from lb
       and coalesce(e.lead_id, 0) = coalesce(v_lid, 0) and coalesce(e.candidature_id, 0) = coalesce(v_cid, 0)
       and e.created_at > now() - (case k when 'open' then interval '20 minutes' when 'play' then interval '10 minutes' else interval '30 minutes' end)
  ) then return; end if;
  insert into public.cand_page_events (candidature_id, lead_id, kind, label) values (v_cid, v_lid, k, lb);
end $$;
grant execute on function public.cand_page_track(jsonb) to anon, authenticated;

-- Bloc-notes : une seule ligne par personne, quel que soit le lien utilisé (code d'appel, code de fiche ou navigateur).
create or replace function public.cand_questions_get(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t text := left(coalesce(p ->> 't', ''), 64); s text := left(coalesce(p ->> 'sid', ''), 64);
  v_cid bigint; v_lid bigint; r record;
begin
  if length(t) < 8 and length(s) < 8 then return null; end if;
  select x.o_cid, x.o_lid into v_cid, v_lid from public.cand_resolve(t, s) x;
  select body, name into r from public.cand_questions
   where key in (case when v_lid is not null then 'L' || v_lid when v_cid is not null then 'C' || v_cid end, nullif(t, ''), nullif(s, ''))
   order by updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('body', r.body, 'name', r.name);
end $$;
grant execute on function public.cand_questions_get(jsonb) to anon, authenticated;

create or replace function public.cand_questions_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text := left(coalesce(p ->> 't', ''), 64);
  s text := left(coalesce(p ->> 'sid', ''), 64);
  b text := left(coalesce(p ->> 'body', ''), 4000);
  nm text := nullif(left(trim(coalesce(p ->> 'name', '')), 80), '');
  v_cid bigint; v_lid bigint; k text;
begin
  if length(t) < 8 and length(s) < 8 then return; end if;
  select x.o_cid, x.o_lid into v_cid, v_lid from public.cand_resolve(t, s) x;
  k := case when v_lid is not null then 'L' || v_lid when v_cid is not null then 'C' || v_cid else coalesce(nullif(t, ''), s) end;
  insert into public.cand_questions (key, candidature_id, lead_id, name, body)
  values (k, v_cid, v_lid, nm, b)
  on conflict (key) do update set body = excluded.body, name = coalesce(excluded.name, public.cand_questions.name),
    candidature_id = coalesce(excluded.candidature_id, public.cand_questions.candidature_id),
    lead_id = coalesce(excluded.lead_id, public.cand_questions.lead_id), updated_at = now();
end $$;
grant execute on function public.cand_questions_save(jsonb) to anon, authenticated;
