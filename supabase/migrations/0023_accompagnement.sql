-- 0023 : espace Accompagnement — conversations privées élève ↔ coach / Clément / équipe / Coach IA
-- texte, photos, vocaux (transcription plus tard), accusés de lecture, disponibilité du coach, messages programmés, notifications

-- ---------- rôles : coach ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member','mod','admin','coach'));
alter table public.profiles add column if not exists coach_id uuid references public.profiles(id) on delete set null;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() in ('mod','admin','coach') $$;
create or replace function public.is_coach() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() = 'coach' $$;

-- ---------- disponibilité / réglages du coach ----------
create table if not exists public.coach_status (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  available boolean not null default true,
  away_until timestamptz,
  away_note text default '',
  hours jsonb not null default '{"start":"09:00","end":"20:00","days":[1,2,3,4,5,6]}'::jsonb,
  sla_min int not null default 120,
  ai_relay boolean not null default true,       -- l'IA répond quand je suis indisponible (étape 3)
  updated_at timestamptz not null default now()
);
alter table public.coach_status enable row level security;
drop policy if exists "cs: lecture" on public.coach_status;
create policy "cs: lecture" on public.coach_status for select to authenticated using (true);
drop policy if exists "cs: soi" on public.coach_status;
create policy "cs: soi" on public.coach_status for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

-- un coach est « absent » si indisponible, ou hors de ses heures
create or replace function public.coach_is_away(p_coach uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare s public.coach_status; nowp timestamp := (now() at time zone 'Europe/Paris'); d int := extract(dow from (now() at time zone 'Europe/Paris'))::int;
begin
  select * into s from public.coach_status where user_id = p_coach;
  if not found then return false; end if;
  if not s.available and (s.away_until is null or s.away_until > now()) then return true; end if;
  if not (s.hours -> 'days') @> to_jsonb(d) then return true; end if;
  if nowp::time < (s.hours ->> 'start')::time or nowp::time >= (s.hours ->> 'end')::time then return true; end if;
  return false;
end $$;

-- ---------- conversations ----------
create table if not exists public.co_threads (
  id bigserial primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('coach','clement','team','ai')),
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (student_id, kind)
);
create index if not exists co_threads_last on public.co_threads (last_at desc);

create table if not exists public.co_messages (
  id bigserial primary key,
  thread_id bigint not null references public.co_threads(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,     -- null = Coach IA / système
  kind text not null default 'text' check (kind in ('text','voice','image','video','file','system')),
  body text not null default '',
  media_url text, media_type text, media_size int, duration_s int,
  transcript text,
  ai boolean not null default false,
  ai_status text check (ai_status in ('pending','validated','edited','removed')),
  reply_to bigint references public.co_messages(id) on delete set null,
  scheduled_at timestamptz,          -- message programmé : visible seulement une fois envoyé
  sent_at timestamptz default now(), -- null tant que programmé
  created_at timestamptz not null default now()
);
create index if not exists co_messages_thread on public.co_messages (thread_id, sent_at desc);
create index if not exists co_messages_sched on public.co_messages (scheduled_at) where sent_at is null;

create table if not exists public.co_reads (
  thread_id bigint references public.co_threads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- qui voit quoi
create or replace function public.co_can_see(p_thread bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.co_threads t join public.profiles s on s.id = t.student_id
    where t.id = p_thread and (
      public.is_admin()
      or (t.student_id = auth.uid() and public.is_active())
      or (public.is_coach() and s.coach_id = auth.uid() and t.kind in ('coach','team'))
      or (public.my_role() = 'mod' and t.kind in ('team'))
    ))
$$;
alter table public.co_threads enable row level security;
alter table public.co_messages enable row level security;
alter table public.co_reads enable row level security;
drop policy if exists "cot: voir" on public.co_threads;
create policy "cot: voir" on public.co_threads for select to authenticated using (public.co_can_see(id));
drop policy if exists "com: voir" on public.co_messages;
create policy "com: voir" on public.co_messages for select to authenticated
  using (public.co_can_see(thread_id) and (sent_at is not null or sender_id = auth.uid() or public.is_staff()));
drop policy if exists "com: écrire" on public.co_messages;
create policy "com: écrire" on public.co_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.co_can_see(thread_id) and kind <> 'system');
drop policy if exists "com: modifier" on public.co_messages;
create policy "com: modifier" on public.co_messages for update to authenticated
  using (public.co_can_see(thread_id) and (sender_id = auth.uid() or public.is_staff()));
drop policy if exists "com: supprimer" on public.co_messages;
create policy "com: supprimer" on public.co_messages for delete to authenticated
  using (sender_id = auth.uid() and sent_at is null);   -- on ne supprime qu'un message programmé pas encore parti
drop policy if exists "cor: tous" on public.co_reads;
create policy "cor: tous" on public.co_reads for all to authenticated using (public.co_can_see(thread_id)) with check (user_id = auth.uid());

-- les fils d'un élève (créés à la demande) : coach, clement, team, ai
create or replace function public.co_my_threads(p_student uuid default null) returns setof public.co_threads
language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(p_student, auth.uid()); k text;
begin
  if sid <> auth.uid() and not public.is_staff() then raise exception 'unauthorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = sid and role = 'member') then return; end if;
  foreach k in array array['coach','clement','team','ai'] loop
    insert into public.co_threads (student_id, kind) values (sid, k) on conflict do nothing;
  end loop;
  return query select * from public.co_threads t where t.student_id = sid and public.co_can_see(t.id) order by last_at desc;
end $$;
grant execute on function public.co_my_threads(uuid) to authenticated;

-- envoi : met à jour le fil, prévient les destinataires, message système si le coach est absent
create or replace function private.co_after_message() returns trigger language plpgsql security definer set search_path = public, private as $$
declare t public.co_threads; s public.profiles; sender public.profiles; title text; dest uuid; away boolean; lastsys timestamptz; cs public.coach_status; untl text;
begin
  if new.sent_at is null then return new; end if;           -- programmé : rien pour l'instant
  select * into t from public.co_threads where id = new.thread_id;
  update public.co_threads set last_at = new.sent_at where id = t.id;
  select * into s from public.profiles where id = t.student_id;
  if new.sender_id is not null then select * into sender from public.profiles where id = new.sender_id; end if;
  if new.kind = 'system' then return new; end if;
  title := coalesce(sender.name, case when new.ai then 'Coach IA' else 'L''Accélérateur' end);
  -- destinataires : tous les participants sauf l'expéditeur
  for dest in
    select id from public.profiles p where p.active and p.id is distinct from new.sender_id and (
      p.id = t.student_id
      or (t.kind in ('coach','team') and p.id = s.coach_id)
      or (t.kind in ('clement','team') and p.role = 'admin')
      or (t.kind = 'coach' and p.role = 'admin' and false))   -- les admins lisent le fil coach sans être notifiés
  loop
    insert into public.notifications (user_id, title, body, url)
    values (dest, case when dest = t.student_id then title else title || case when dest <> t.student_id and new.sender_id = t.student_id then '' else ' → ' || coalesce(s.name, 'élève') end end,
      case new.kind when 'voice' then '🎤 Message vocal' || coalesce(' · ' || new.duration_s || ' s', '') when 'image' then '📷 Photo' when 'video' then '🎬 Vidéo' else left(new.body, 120) end,
      '#co/' || t.id);
  end loop;
  -- élève écrit à un coach absent → message système (au plus une fois par 6 h)
  if new.sender_id = t.student_id and t.kind = 'coach' and s.coach_id is not null and public.coach_is_away(s.coach_id) then
    select max(sent_at) into lastsys from public.co_messages where thread_id = t.id and kind = 'system' and sent_at > now() - interval '6 hours';
    if lastsys is null then
      select * into cs from public.coach_status where user_id = s.coach_id;
      untl := case when cs.away_until is not null and cs.away_until > now() then 'à partir de ' || to_char(cs.away_until at time zone 'Europe/Paris', 'HH24"h"MI')
                   when not coalesce(cs.available, true) then 'dès son retour'
                   else 'à partir de ' || replace(coalesce(cs.hours ->> 'start', '09:00'), ':', 'h') end;
      insert into public.co_messages (thread_id, sender_id, kind, body)
      values (t.id, null, 'system', '🌙 ' || coalesce((select name from public.profiles where id = s.coach_id), 'Ton coach') || ' est indisponible pour le moment et te répond ' || untl || '. Ton message est bien transmis.'
        || case when coalesce(cs.away_note, '') <> '' then ' « ' || cs.away_note || ' »' else '' end);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists co_messages_after on public.co_messages;
create trigger co_messages_after after insert on public.co_messages for each row execute function private.co_after_message();

-- messages programmés : envoi à l'heure dite (toutes les minutes)
create or replace function private.co_send_scheduled() returns int language plpgsql security definer set search_path = public, private as $$
declare r record; n int := 0;
begin
  for r in select id from public.co_messages where sent_at is null and scheduled_at <= now() order by scheduled_at loop
    update public.co_messages set sent_at = now(), created_at = now() where id = r.id;
    -- le trigger after insert ne se déclenche pas sur update : on notifie à la main
    perform private.co_notify_scheduled(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function private.co_notify_scheduled(p_id bigint) returns void language plpgsql security definer set search_path = public, private as $$
declare m public.co_messages; t public.co_threads; sender text;
begin
  select * into m from public.co_messages where id = p_id; select * into t from public.co_threads where id = m.thread_id;
  update public.co_threads set last_at = now() where id = t.id;
  select name into sender from public.profiles where id = m.sender_id;
  insert into public.notifications (user_id, title, body, url)
  values (t.student_id, coalesce(sender, 'Ton coach'), case m.kind when 'voice' then '🎤 Message vocal' when 'image' then '📷 Photo' else left(m.body, 120) end, '#co/' || t.id);
end $$;
select cron.schedule('co-scheduled', '* * * * *', $$select private.co_send_scheduled()$$)
where not exists (select 1 from cron.job where jobname = 'co-scheduled');

-- ---------- stockage : vocaux, photos, vidéos (privé, liens signés) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coaching', 'coaching', false, 104857600, array['image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-m4a','video/mp4','video/quicktime','video/webm','application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "coaching: lire" on storage.objects;
create policy "coaching: lire" on storage.objects for select to authenticated using (bucket_id = 'coaching' and public.is_active());
drop policy if exists "coaching: déposer" on storage.objects;
create policy "coaching: déposer" on storage.objects for insert to authenticated with check (bucket_id = 'coaching' and public.is_active());
drop policy if exists "coaching: supprimer" on storage.objects;
create policy "coaching: supprimer" on storage.objects for delete to authenticated using (bucket_id = 'coaching' and (owner = auth.uid() or public.is_admin()));

-- temps réel
do $$ begin
  alter publication supabase_realtime add table public.co_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.co_reads;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.coach_status;
exception when duplicate_object then null; end $$;

-- ---------- vue d'ensemble pour la réception (coach / admin) ----------
create or replace function public.co_inbox() returns jsonb language sql stable security definer set search_path = public as $$
  with th as (
    select t.*, s.name student_name, s.avatar_url student_avatar, s.coach_id, s.last_seen, s.created_at joined_at
    from public.co_threads t join public.profiles s on s.id = t.student_id
    where public.co_can_see(t.id) and t.kind in ('coach','clement','team')
  ),
  lastm as (
    select distinct on (thread_id) thread_id, id, sender_id, kind, body, sent_at, ai
    from public.co_messages where sent_at is not null and kind <> 'system' order by thread_id, sent_at desc
  ),
  waiting as (   -- dernier message de l'élève sans réponse de l'équipe depuis
    select m.thread_id, min(m.sent_at) since from public.co_messages m join public.co_threads t on t.id = m.thread_id
    where m.sent_at is not null and m.kind <> 'system' and m.sender_id = t.student_id
      and m.sent_at > coalesce((select max(x.sent_at) from public.co_messages x where x.thread_id = m.thread_id and x.sent_at is not null and x.sender_id is distinct from t.student_id and x.kind <> 'system'), '-infinity')
    group by m.thread_id
  ),
  act as (
    select t.id thread_id, count(*) filter (where m.sender_id = t.student_id and m.sent_at > now() - interval '7 days') msgs7,
           max(m.sent_at) filter (where m.sender_id = t.student_id) last_student_at
    from th t left join public.co_messages m on m.thread_id = t.id and m.sent_at is not null group by t.id
  ),
  unread as (
    select m.thread_id, count(*) n from public.co_messages m
    left join public.co_reads r on r.thread_id = m.thread_id and r.user_id = auth.uid()
    where m.sent_at is not null and m.kind <> 'system' and m.sender_id is distinct from auth.uid() and m.sent_at > coalesce(r.last_read_at, '-infinity') group by m.thread_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', th.id, 'kind', th.kind, 'student_id', th.student_id, 'student_name', th.student_name, 'student_avatar', th.student_avatar, 'coach_id', th.coach_id,
    'last_at', th.last_at, 'last', to_jsonb(lastm) - 'thread_id', 'waiting_since', w.since, 'msgs7', coalesce(a.msgs7, 0), 'last_student_at', a.last_student_at, 'unread', coalesce(u.n, 0)
  ) order by th.last_at desc), '[]'::jsonb)
  from th left join lastm on lastm.thread_id = th.id left join waiting w on w.thread_id = th.id left join act a on a.thread_id = th.id left join unread u on u.thread_id = th.id
$$;
grant execute on function public.co_inbox() to authenticated;

-- nombre de non-lus pour la pastille
create or replace function public.co_unread() returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.co_messages m
  join public.co_threads t on t.id = m.thread_id
  left join public.co_reads r on r.thread_id = m.thread_id and r.user_id = auth.uid()
  where public.co_can_see(t.id) and m.sent_at is not null and m.kind <> 'system' and m.sender_id is distinct from auth.uid() and m.sent_at > coalesce(r.last_read_at, '-infinity')
    and (t.student_id = auth.uid() or t.kind in ('coach','team','clement'))
$$;
grant execute on function public.co_unread() to authenticated;
