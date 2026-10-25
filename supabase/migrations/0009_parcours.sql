-- 0009 : parcours en étapes + suivi des élèves
create table if not exists public.steps (
  id serial primary key,
  position int not null default 0,
  title text not null,
  description text default '',
  lessons text default '',                    -- ex. « Module 2, leçons 4 à 9 »
  validated_by text not null default 'member' check (validated_by in ('member','coach')),
  tier_unlock int                             -- si renseigné : étape « palier » (ex. 2 = Accélération)
);
create table if not exists public.member_steps (
  user_id uuid references public.profiles(id) on delete cascade,
  step_id int references public.steps(id) on delete cascade,
  status text not null default 'todo' check (status in ('todo','pending','done')),
  done_at timestamptz,
  validated_by uuid references public.profiles(id),
  note text default '',
  updated_at timestamptz default now(),
  primary key (user_id, step_id)
);
create table if not exists public.coach_notes (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  author uuid references public.profiles(id),
  body text not null,
  created_at timestamptz default now()
);
alter table public.profiles add column if not exists shop_url text default '';

insert into public.steps (position, title, description, lessons, validated_by) select * from (values
  (1, 'Boutique en ligne', 'Ta boutique Shopify est créée, le thème installé et l''application COD vérifiée. Envoie le lien de ta boutique pour validation.', 'Module 1 (7 leçons)', 'coach'),
  (2, 'Compte Facebook prêt', 'Sécurité 2 facteurs, page, Business Manager, compte publicitaire, carte, pixel installé.', 'Module 2, leçons 1 à 9', 'member'),
  (3, 'Produit validé', 'Propose 3 produits avec la méthode. Le coach en valide un.', 'Module 3', 'coach'),
  (4, 'Premier testing lancé', 'Créatives, page produit, funnel testé, campagne 20/80 lancée. Envoie tes stats chaque soir.', 'Module 4', 'member'),
  (5, 'Optimisation', 'Métriques maîtrisées, upsell en place, retargeting lancé.', 'Modules 5 et 6', 'coach'),
  (6, 'Accélération', 'Produit rentable : passage à l''accompagnement personnalisé pour scaler.', '', 'coach')
) as v(position, title, description, lessons, validated_by)
where not exists (select 1 from public.steps);
update public.steps set tier_unlock = 2 where position = 6 and tier_unlock is null;

-- RLS
alter table public.steps enable row level security;
alter table public.member_steps enable row level security;
alter table public.coach_notes enable row level security;
drop policy if exists "steps: lecture" on public.steps;
create policy "steps: lecture" on public.steps for select to authenticated using (true);
drop policy if exists "steps: staff" on public.steps;
create policy "steps: staff" on public.steps for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "msteps: lecture" on public.member_steps;
create policy "msteps: lecture" on public.member_steps for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists "msteps: membre" on public.member_steps;
create policy "msteps: membre" on public.member_steps for insert to authenticated with check (user_id = auth.uid() or public.is_staff());
drop policy if exists "msteps: maj" on public.member_steps;
create policy "msteps: maj" on public.member_steps for update to authenticated using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());
drop policy if exists "notes: staff" on public.coach_notes;
create policy "notes: staff" on public.coach_notes for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Garde-fou : un membre ne peut pas se valider une étape « coach » (il la passe en attente), ni modifier celle d'un autre
create or replace function public.guard_member_step() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.steps%rowtype; staff boolean := public.is_staff();
begin
  select * into s from public.steps where id = new.step_id;
  if not staff then
    if new.user_id <> auth.uid() then raise exception 'Interdit'; end if;
    if s.validated_by = 'coach' and new.status = 'done' then new.status := 'pending'; end if;
    new.validated_by := null;
  else
    if new.status = 'done' then new.validated_by := auth.uid(); end if;
  end if;
  new.updated_at := now();
  if new.status = 'done' and new.done_at is null then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists member_steps_guard on public.member_steps;
create trigger member_steps_guard before insert or update on public.member_steps for each row execute function public.guard_member_step();

-- Notifications : étape validée par le coach → le membre ; étape en attente → le staff
create or replace function public.notify_member_step() returns trigger language plpgsql security definer set search_path = public as $$
declare s public.steps%rowtype; nm text;
begin
  select * into s from public.steps where id = new.step_id;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') and new.validated_by is not null and new.validated_by <> new.user_id then
    insert into public.notifications (user_id, title, body, url) values (new.user_id, 'Étape validée : ' || s.title || ' ✅', 'Bravo ! Passe à la suite dans Mon parcours.', '#journey');
  elsif new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    select name into nm from public.profiles where id = new.user_id;
    insert into public.notifications (user_id, title, body, url) select id, nm || ' attend ta validation', 'Étape : ' || s.title, '#tracking' from public.profiles where role <> 'member';
  end if;
  return new;
end $$;
drop trigger if exists member_steps_notify on public.member_steps;
create trigger member_steps_notify after insert or update on public.member_steps for each row execute function public.notify_member_step();

do $$ begin
  alter publication supabase_realtime add table public.member_steps;
  alter publication supabase_realtime add table public.steps;
exception when others then null; end $$;
