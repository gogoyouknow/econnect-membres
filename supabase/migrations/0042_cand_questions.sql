-- 0042 : bloc-notes « mes questions pour l'appel » (page /decouvrir). La personne écrit ses questions, Clément les lit avant l'appel.
-- Un lien personnel (?t=jeton) est ajouté au message WhatsApp d'un appel réservé : les questions sont alors rattachées à la bonne personne.

alter table public.candidatures add column if not exists qtoken uuid not null default gen_random_uuid();
create unique index if not exists candidatures_qtoken_idx on public.candidatures (qtoken);

create table if not exists public.cand_questions (
  id bigserial primary key,
  key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  candidature_id bigint references public.candidatures (id) on delete set null,
  lead_id bigint references public.cand_leads (id) on delete set null,
  name text,
  body text not null default ''
);
create index if not exists cand_questions_cand_idx on public.cand_questions (candidature_id);
create index if not exists cand_questions_lead_idx on public.cand_questions (lead_id);
alter table public.cand_questions enable row level security;
drop policy if exists "cand_questions: équipe" on public.cand_questions;
create policy "cand_questions: équipe" on public.cand_questions for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Relit ce que la personne a déjà écrit (pour qu'elle retrouve son bloc-notes).
create or replace function public.cand_questions_get(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text := left(coalesce(nullif(p ->> 't', ''), p ->> 'sid', ''), 64); r record;
begin
  if length(k) < 8 then return null; end if;
  select body, name into r from public.cand_questions where key = k;
  if not found then return null; end if;
  return jsonb_build_object('body', r.body, 'name', r.name);
end $$;
grant execute on function public.cand_questions_get(jsonb) to anon, authenticated;

-- Enregistre (ou met à jour) le bloc-notes. Jeton = appel réservé ; sinon identifiant de navigateur (sid) = fiche prospect.
create or replace function public.cand_questions_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t text := left(coalesce(p ->> 't', ''), 64);
  s text := left(coalesce(p ->> 'sid', ''), 64);
  k text := coalesce(nullif(t, ''), s);
  b text := left(coalesce(p ->> 'body', ''), 4000);
  nm text := nullif(left(trim(coalesce(p ->> 'name', '')), 80), '');
  cid bigint; lid bigint; ce text; cp text;
begin
  if length(k) < 8 then return; end if;
  if t <> '' then
    select id, email, phone into cid, ce, cp from public.candidatures where qtoken::text = t;
    if cid is not null then
      select id into lid from public.cand_leads where (ce is not null and lower(email) = lower(ce)) or (cp is not null and phone = cp) order by updated_at desc limit 1;
    end if;
  end if;
  if lid is null and s <> '' then select id into lid from public.cand_leads where sid = s; end if;
  if cid is null and lid is not null then
    select c.id into cid from public.candidatures c join public.cand_leads l on l.id = lid
     where (l.email is not null and lower(c.email) = lower(l.email)) or (l.phone is not null and c.phone = l.phone) order by c.starts_at desc limit 1;
  end if;
  insert into public.cand_questions (key, candidature_id, lead_id, name, body)
  values (k, cid, lid, nm, b)
  on conflict (key) do update set body = excluded.body, name = coalesce(excluded.name, public.cand_questions.name),
    candidature_id = coalesce(excluded.candidature_id, public.cand_questions.candidature_id),
    lead_id = coalesce(excluded.lead_id, public.cand_questions.lead_id), updated_at = now();
end $$;
grant execute on function public.cand_questions_save(jsonb) to anon, authenticated;
