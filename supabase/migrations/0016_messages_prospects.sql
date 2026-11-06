-- 0016 : Résultats Méthode (seule l'équipe publie) + messagerie individuelle activable + formulaire après paiement (prospects)

-- ---------- 1) Résultats de la Méthode : un fil à part, l'équipe publie, les élèves lisent ----------
insert into public.spaces (id, name, kind, tier_required, sort) values ('mwins', 'Résultats (Méthode)', 'feed', 1, 6)
  on conflict (id) do nothing;

drop policy if exists "posts: lecture" on public.posts;
create policy "posts: lecture" on public.posts for select to authenticated
  using ((public.has_accel() or (public.has_methode() and space_id = 'mwins')) and (approved or user_id = auth.uid() or public.is_staff()));
drop policy if exists "posts: écrire" on public.posts;
create policy "posts: écrire" on public.posts for insert to authenticated
  with check (user_id = auth.uid() and (public.is_staff() or (public.has_accel() and space_id <> 'mwins')));
drop policy if exists "replies: lecture" on public.replies;
create policy "replies: lecture" on public.replies for select to authenticated
  using (public.has_accel() or (public.has_methode() and exists (select 1 from public.posts p where p.id = post_id and p.space_id = 'mwins')));
drop policy if exists "replies: écrire" on public.replies;
create policy "replies: écrire" on public.replies for insert to authenticated
  with check (user_id = auth.uid() and (public.is_staff() or (public.has_accel() and exists (select 1 from public.posts p where p.id = post_id and p.space_id <> 'mwins'))));

-- ---------- 2) Messagerie individuelle (élève ↔ équipe), fermée par défaut ----------
alter table public.profiles add column if not exists dm_enabled boolean not null default false;

create table if not exists public.dm_messages (
  id bigserial primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,  -- la conversation = l'élève
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  image_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dm_student_created on public.dm_messages(student_id, created_at desc);
alter table public.dm_messages enable row level security;

create or replace function public.my_dm() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select active and dm_enabled from public.profiles where id = auth.uid()), false) $$;

drop policy if exists "dm: lecture" on public.dm_messages;
create policy "dm: lecture" on public.dm_messages for select to authenticated
  using (public.is_staff() or (student_id = auth.uid() and public.my_dm()));
drop policy if exists "dm: écrire" on public.dm_messages;
create policy "dm: écrire" on public.dm_messages for insert to authenticated
  with check (sender_id = auth.uid() and (public.is_staff() or (student_id = auth.uid() and public.my_dm())));
drop policy if exists "dm: lu" on public.dm_messages;
create policy "dm: lu" on public.dm_messages for update to authenticated
  using (public.is_staff() or (student_id = auth.uid() and public.my_dm()));

-- un élève ne peut pas s'ouvrir la messagerie lui-même
create or replace function public.guard_profile_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.is_admin() then return new; end if;
  if new.role is distinct from old.role or new.tier is distinct from old.tier or new.active is distinct from old.active or new.email is distinct from old.email
     or new.methode is distinct from old.methode or new.accel is distinct from old.accel or new.stripe_customer is distinct from old.stripe_customer then
    raise exception 'Seul un admin peut modifier le rôle, le groupe ou l''accès';
  end if;
  if public.is_staff() and old.id <> auth.uid() and old.role <> 'member' then
    raise exception 'Un modérateur ne peut pas modifier un membre de l''équipe';
  end if;
  if not public.is_staff() and (new.muted_until is distinct from old.muted_until or new.dm_enabled is distinct from old.dm_enabled) then
    raise exception 'Réservé à l''équipe';
  end if;
  return new;
end $$;

-- notification à chaque message : à l'élève si l'équipe écrit, aux admins si l'élève écrit
create or replace function public.on_dm() returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(nullif(first_name, ''), name) into who from public.profiles where id = new.sender_id;
  if new.sender_id = new.student_id then
    insert into public.notifications (user_id, title, body, url)
      select id, 'Message de ' || who, left(new.body, 120), '#messages' from public.profiles where role = 'admin' and active;
  else
    insert into public.notifications (user_id, title, body, url) values (new.student_id, 'Message de ' || who, left(new.body, 120), '#messages');
  end if;
  return new;
end $$;
drop trigger if exists dm_notify on public.dm_messages;
create trigger dm_notify after insert on public.dm_messages for each row execute function public.on_dm();

do $$ begin alter publication supabase_realtime add table public.dm_messages; exception when others then null; end $$;

-- ---------- 3) Formulaire après paiement → prospects ----------
create table if not exists public.leads (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  session_id text unique,                 -- session Stripe (relie le formulaire au paiement)
  email text, first_name text, last_name text, phone text,
  situation text,                         -- etudiant | salarie | chomage | entrepreneur
  wants_coaching text,                    -- oui | non
  budget text,                            -- budget disponible aujourd'hui
  has_capital text,                       -- oui | non
  offer text, amount numeric,
  status text not null default 'nouveau' check (status in ('nouveau','contacte','rdv','close','perdu')),
  note text default ''
);
alter table public.leads enable row level security;
drop policy if exists "leads: équipe" on public.leads;
create policy "leads: équipe" on public.leads for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- pré-remplissage depuis le paiement Stripe (email, nom, offre)
create or replace function public.lead_prefill(p_session text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', e.payload #>> '{data,object,customer_details,email}',
    'name', e.payload #>> '{data,object,customer_details,name}',
    'amount', e.amount,
    'offer', coalesce((select label from public.stripe_offers where payment_link = e.payload #>> '{data,object,payment_link}'), ''),
    'done', exists (select 1 from public.leads l where l.session_id = p_session))
  from public.stripe_events e
  where p_session ~ '^cs_[A-Za-z0-9_]+$' and e.payload #>> '{data,object,id}' = p_session
  order by e.id desc limit 1
$$;

create or replace function public.submit_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid text := nullif(p ->> 'session_id', ''); em text := lower(trim(coalesce(p ->> 'email', ''))); pre jsonb; hot boolean; id bigint;
begin
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email invalide'; end if;
  if sid is not null then pre := public.lead_prefill(sid); end if;
  insert into public.leads (session_id, email, first_name, last_name, phone, situation, wants_coaching, budget, has_capital, offer, amount)
  values (sid, em, left(p ->> 'first_name', 80), left(p ->> 'last_name', 80), left(p ->> 'phone', 40),
          left(p ->> 'situation', 30), left(p ->> 'wants_coaching', 20), left(p ->> 'budget', 40), left(p ->> 'has_capital', 10),
          coalesce(pre ->> 'offer', ''), nullif(pre ->> 'amount', '')::numeric)
  on conflict (session_id) do update set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, phone = excluded.phone,
    situation = excluded.situation, wants_coaching = excluded.wants_coaching, budget = excluded.budget, has_capital = excluded.has_capital
  returning leads.id into id;
  hot := (p ->> 'wants_coaching') = 'oui' and (p ->> 'has_capital') = 'oui';
  insert into public.notifications (user_id, title, body, url)
    select pr.id, case when hot then '🔥 Prospect chaud : ' else 'Nouveau formulaire : ' end || coalesce(nullif(p ->> 'first_name', ''), em),
           'Accompagnement : ' || coalesce(p ->> 'wants_coaching', '?') || ' · budget ' || coalesce(p ->> 'budget', '?') || ' · capital : ' || coalesce(p ->> 'has_capital', '?'), '#leads'
    from public.profiles pr where pr.role = 'admin' and pr.active;
  return jsonb_build_object('ok', true, 'id', id);
end $$;
revoke all on function public.lead_prefill(text) from public;
revoke all on function public.submit_lead(jsonb) from public;
grant execute on function public.lead_prefill(text) to anon, authenticated;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
