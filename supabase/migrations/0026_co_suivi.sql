-- 0026 : Accompagnement, étape 2 — suivi (temps de réponse, inactivité, activité), relances automatiques, rappels coach, alertes, bilan hebdo

-- réglages
alter table public.settings add column if not exists co_relance_24h text default 'Salut {prenom}, tu as avancé sur « {action} » ? Dis-moi où tu en es, même en deux mots 👊';
alter table public.settings add column if not exists co_relance_72h text default '{prenom}, ça fait 3 jours sans nouvelles. Pas de jugement : dis-moi juste ce qui bloque et on le règle ensemble aujourd''hui.';
alter table public.settings add column if not exists co_relance_on boolean default true;
alter table public.settings add column if not exists co_sla_min int default 120;
alter table public.settings add column if not exists co_alert_admin_h int default 24;

-- journal des alertes / relances (évite les doublons)
create table if not exists public.co_alerts (
  id bigserial primary key,
  thread_id bigint references public.co_threads(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  kind text not null,          -- coach_sla · admin_24h · relance_24h · relance_72h · inactif_7j
  ref_at timestamptz,          -- l'épisode concerné (dernier message élève / date d'inactivité)
  created_at timestamptz not null default now()
);
create index if not exists co_alerts_k on public.co_alerts (student_id, kind, ref_at);
alter table public.co_alerts enable row level security;
drop policy if exists "coalerts: staff" on public.co_alerts;
create policy "coalerts: staff" on public.co_alerts for select to authenticated using (public.is_staff());

-- étape courante + prochaine action d'un élève
create or replace function public.co_next_action(p_student uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('step', s.title, 'position', s.position)
    from public.steps s left join public.member_steps ms on ms.step_id = s.id and ms.user_id = p_student
    where coalesce(ms.status, 'todo') <> 'done' order by s.position limit 1), '{}'::jsonb)
$$;

-- « questions » de l'élève et temps de réponse de l'équipe
create or replace view public.co_response_times as
with m as (
  select x.*, t.student_id, lag(x.sender_id) over (partition by x.thread_id order by x.sent_at) prev_sender
  from public.co_messages x join public.co_threads t on t.id = x.thread_id
  where x.sent_at is not null and x.kind <> 'system' and t.kind in ('coach','clement','team')
),
q as (select * from m where sender_id = student_id and (prev_sender is null or prev_sender <> student_id))
select q.thread_id, q.student_id, q.id question_id, q.sent_at asked_at,
  (select min(r.sent_at) from public.co_messages r where r.thread_id = q.thread_id and r.sent_at > q.sent_at and r.kind <> 'system' and r.sender_id is distinct from q.student_id) answered_at,
  (select r.sender_id from public.co_messages r where r.thread_id = q.thread_id and r.sent_at > q.sent_at and r.kind <> 'system' and r.sender_id is distinct from q.student_id order by r.sent_at limit 1) answered_by,
  (select bool_or(r.ai) from public.co_messages r where r.thread_id = q.thread_id and r.sent_at > q.sent_at and r.kind <> 'system' and r.sender_id is distinct from q.student_id) answered_by_ai
from q;

-- tableau de suivi (coach : ses élèves · admin : tous)
create or replace function public.co_tracking(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 90))); r jsonb; sla int;
begin
  if not public.is_staff() then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(co_sla_min, 120) into sla from public.settings where id = 1;
  with st as (
    select p.id, p.name, p.avatar_url, p.email, p.coach_id, p.created_at, p.last_seen, c.name coach_name
    from public.profiles p left join public.profiles c on c.id = p.coach_id
    where p.role = 'member' and p.active and p.accel and (public.is_admin() or public.my_role() = 'mod' or p.coach_id = auth.uid())
  ),
  rt as (select * from public.co_response_times where asked_at >= since),
  per as (
    select s.id,
      (select count(*) from public.co_messages m join public.co_threads t on t.id = m.thread_id where t.student_id = s.id and m.sender_id = s.id and m.sent_at >= since) msgs,
      (select max(m.sent_at) from public.co_messages m join public.co_threads t on t.id = m.thread_id where t.student_id = s.id and m.sender_id = s.id) last_student_at,
      (select max(m.sent_at) from public.co_messages m join public.co_threads t on t.id = m.thread_id where t.student_id = s.id and m.sender_id is distinct from s.id and m.kind <> 'system') last_team_at,
      (select avg(extract(epoch from (answered_at - asked_at)) / 60) from rt where rt.student_id = s.id and answered_at is not null) avg_resp,
      (select min(asked_at) from rt where rt.student_id = s.id and answered_at is null) waiting_since,
      (select t.id from public.co_threads t where t.student_id = s.id and t.kind = 'coach') coach_thread,
      (select count(*) from public.co_alerts a where a.student_id = s.id and a.kind like 'relance%' and a.created_at >= since) relances,
      (select jsonb_agg(d order by d) from (select to_char(g::date, 'DD') d from generate_series(current_date - 6, current_date, '1 day') g) z) days7,
      (select jsonb_agg(c order by d) from (select g::date d, (select count(*) from public.co_messages m join public.co_threads t on t.id = m.thread_id where t.student_id = s.id and m.sender_id = s.id and (m.sent_at at time zone 'Europe/Paris')::date = g::date) c from generate_series(current_date - 6, current_date, '1 day') g) z) spark
    from st s
  )
  select jsonb_build_object(
    'days', p_days, 'sla_min', sla,
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'avatar', s.avatar_url, 'coach_id', s.coach_id, 'coach', s.coach_name, 'joined', s.created_at, 'last_seen', s.last_seen,
        'msgs', p.msgs, 'last_student_at', p.last_student_at, 'last_team_at', p.last_team_at, 'avg_resp', round(p.avg_resp), 'waiting_since', p.waiting_since,
        'thread', p.coach_thread, 'relances', p.relances, 'spark', p.spark, 'next', public.co_next_action(s.id),
        'inactive_h', case when p.last_student_at is null then extract(epoch from (now() - s.created_at)) / 3600 else extract(epoch from (now() - p.last_student_at)) / 3600 end
      ) order by (p.waiting_since is null), p.waiting_since, p.last_student_at desc nulls last), '[]'::jsonb) from st s join per p on p.id = s.id),
    'median_resp', (select percentile_cont(0.5) within group (order by extract(epoch from (answered_at - asked_at)) / 60) from rt where answered_at is not null and not coalesce(answered_by_ai, false)),
    'avg_resp', (select round(avg(extract(epoch from (answered_at - asked_at)) / 60)) from rt where answered_at is not null and not coalesce(answered_by_ai, false)),
    'questions', (select count(*) from rt), 'answered', (select count(*) from rt where answered_at is not null),
    'within_sla', (select count(*) from rt where answered_at is not null and answered_at - asked_at <= make_interval(mins => sla)),
    'waiting_over', (select count(*) from per where waiting_since is not null and waiting_since < now() - make_interval(mins => sla)),
    'inactive_24', (select count(*) from per where coalesce(last_student_at, '-infinity') < now() - interval '24 hours'),
    'inactive_72', (select count(*) from per where coalesce(last_student_at, '-infinity') < now() - interval '72 hours'),
    'msgs_total', (select sum(msgs) from per),
    'voices', (select count(*) from public.co_messages where kind = 'voice' and sent_at >= since), 'photos', (select count(*) from public.co_messages where kind in ('image','video') and sent_at >= since),
    'by_coach', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'median', x.med, 'n', x.n, 'students', (select count(*) from st where coach_id = c.id)) order by x.med), '[]'::jsonb)
                 from (select answered_by, percentile_cont(0.5) within group (order by extract(epoch from (answered_at - asked_at)) / 60) med, count(*) n from rt where answered_at is not null and answered_by is not null group by answered_by) x join public.profiles c on c.id = x.answered_by),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'msgs', c) order by d), '[]') from (select to_char((m.sent_at at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') d, count(*) c from public.co_messages m join public.co_threads t on t.id = m.thread_id join st on st.id = t.student_id where m.sent_at >= since and m.kind <> 'system' group by 1) z)
  ) into r;
  return r;
end $$;
grant execute on function public.co_tracking(int) to authenticated;

-- ---------- veille automatique (toutes les 10 min) ----------
create or replace function private.co_watch() returns jsonb language plpgsql security definer set search_path = public, private as $$
declare s public.settings; r record; hp int := extract(hour from (now() at time zone 'Europe/Paris'))::int; n_sla int := 0; n_admin int := 0; n_r24 int := 0; n_r72 int := 0; n_7j int := 0;
        prenom text; action text; body text; sender uuid; cs public.coach_status;
begin
  select * into s from public.settings where id = 1;
  -- 1) coach : question sans réponse au-delà de l'objectif
  for r in
    select q.*, p.coach_id, p.name student_name from public.co_response_times q join public.profiles p on p.id = q.student_id
    where q.answered_at is null and q.asked_at < now() - make_interval(mins => coalesce(s.co_sla_min, 120)) and q.asked_at > now() - interval '7 days'
      and not exists (select 1 from public.co_alerts a where a.kind = 'coach_sla' and a.thread_id = q.thread_id and a.ref_at = q.asked_at)
  loop
    insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.student_id, 'coach_sla', r.asked_at);
    if r.coach_id is not null then
      insert into public.notifications (user_id, title, body, url) values (r.coach_id, '⏱ ' || coalesce(r.student_name, 'Un élève') || ' attend ta réponse', 'depuis ' || round(extract(epoch from (now() - r.asked_at)) / 60) || ' min · objectif ' || coalesce(s.co_sla_min, 120) || ' min', '#co/' || r.thread_id);
    else
      insert into public.notifications (user_id, title, body, url) select id, '⏱ ' || coalesce(r.student_name, 'Un élève') || ' attend une réponse (pas de coach attribué)', 'depuis ' || round(extract(epoch from (now() - r.asked_at)) / 60) || ' min', '#co/' || r.thread_id from public.profiles where role = 'admin' and active;
    end if;
    n_sla := n_sla + 1;
  end loop;
  -- 2) admins : question sans réponse depuis 24 h
  for r in
    select q.*, p.name student_name, c.name coach_name from public.co_response_times q join public.profiles p on p.id = q.student_id left join public.profiles c on c.id = p.coach_id
    where q.answered_at is null and q.asked_at < now() - make_interval(hours => coalesce(s.co_alert_admin_h, 24)) and q.asked_at > now() - interval '14 days'
      and not exists (select 1 from public.co_alerts a where a.kind = 'admin_24h' and a.thread_id = q.thread_id and a.ref_at = q.asked_at)
  loop
    insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.student_id, 'admin_24h', r.asked_at);
    insert into public.notifications (user_id, title, body, url) select id, '🚨 ' || coalesce(r.student_name, 'Un élève') || ' sans réponse depuis ' || coalesce(s.co_alert_admin_h, 24) || ' h', 'Coach : ' || coalesce(r.coach_name, 'aucun'), '#co/' || r.thread_id from public.profiles where role = 'admin' and active;
    n_admin := n_admin + 1;
  end loop;
  -- 3) relances élève (heures ouvrées 9 h–20 h Paris, pas le dimanche)
  if coalesce(s.co_relance_on, true) and hp between 9 and 19 and extract(dow from (now() at time zone 'Europe/Paris')) <> 0 then
    for r in
      select p.id, p.name, p.coach_id, t.id thread_id,
        coalesce((select max(m.sent_at) from public.co_messages m join public.co_threads x on x.id = m.thread_id where x.student_id = p.id and m.sender_id = p.id), p.created_at) last_at,
        (select max(m.sent_at) from public.co_messages m where m.thread_id = t.id and m.sender_id is distinct from p.id and m.kind <> 'system') last_team
      from public.profiles p join public.co_threads t on t.student_id = p.id and t.kind = 'coach'
      where p.role = 'member' and p.active and p.accel and p.created_at < now() - interval '24 hours'
    loop
      -- l'équipe a déjà écrit en dernier et attend ? on ne relance que si l'élève n'a rien dit depuis 24 h / 72 h
      prenom := split_part(coalesce(r.name, ''), ' ', 1);
      action := coalesce(public.co_next_action(r.id) ->> 'step', 'ta prochaine étape');
      sender := coalesce(r.coach_id, (select id from public.profiles where role = 'admin' and active order by created_at limit 1));
      if r.last_at < now() - interval '72 hours' and not exists (select 1 from public.co_alerts a where a.student_id = r.id and a.kind = 'relance_72h' and a.ref_at = r.last_at) then
        body := replace(replace(coalesce(s.co_relance_72h, ''), '{prenom}', prenom), '{action}', action);
        insert into public.co_messages (thread_id, sender_id, kind, body) values (r.thread_id, sender, 'text', body);
        insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.id, 'relance_72h', r.last_at);
        n_r72 := n_r72 + 1;
      elsif r.last_at < now() - interval '24 hours' and r.last_at >= now() - interval '72 hours' and not exists (select 1 from public.co_alerts a where a.student_id = r.id and a.kind = 'relance_24h' and a.ref_at = r.last_at) then
        body := replace(replace(coalesce(s.co_relance_24h, ''), '{prenom}', prenom), '{action}', action);
        insert into public.co_messages (thread_id, sender_id, kind, body) values (r.thread_id, sender, 'text', body);
        insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.id, 'relance_24h', r.last_at);
        n_r24 := n_r24 + 1;
      end if;
      -- 7 jours : alerte admins (une fois par épisode)
      if r.last_at < now() - interval '7 days' and not exists (select 1 from public.co_alerts a where a.student_id = r.id and a.kind = 'inactif_7j' and a.ref_at = r.last_at) then
        insert into public.co_alerts (thread_id, student_id, kind, ref_at) values (r.thread_id, r.id, 'inactif_7j', r.last_at);
        insert into public.notifications (user_id, title, body, url) select id, '😴 ' || coalesce(r.name, 'Un élève') || ' inactif depuis 7 jours', 'Relancé automatiquement à 24 h et 72 h, sans réponse. À appeler ?', '#co/' || r.thread_id from public.profiles where role = 'admin' and active;
        n_7j := n_7j + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('coach_sla', n_sla, 'admin_24h', n_admin, 'relance_24h', n_r24, 'relance_72h', n_r72, 'inactif_7j', n_7j);
end $$;
select cron.schedule('co-watch', '*/10 * * * *', $$select private.co_watch()$$)
where not exists (select 1 from cron.job where jobname = 'co-watch');

-- ---------- bilan du lundi 9 h (Paris) ----------
-- version autonome (sans session) : on reconstruit le minimum utile
create or replace function private.co_weekly() returns void language plpgsql security definer set search_path = public, private as $$
declare since timestamptz := now() - interval '7 days'; med numeric; q int; ans int; inact int; msgs int; sales int; html text; txt text; r record; tops text := ''; risks text := '';
begin
  select percentile_cont(0.5) within group (order by extract(epoch from (answered_at - asked_at)) / 60), count(*), count(*) filter (where answered_at is not null)
    into med, q, ans from public.co_response_times where asked_at >= since;
  select count(*) into inact from public.profiles p where p.role = 'member' and p.active and p.accel
    and coalesce((select max(m.sent_at) from public.co_messages m join public.co_threads t on t.id = m.thread_id where t.student_id = p.id and m.sender_id = p.id), p.created_at) < now() - interval '72 hours';
  select count(*) into msgs from public.co_messages where sent_at >= since and kind <> 'system';
  for r in select p.name, count(*) c from public.co_messages m join public.co_threads t on t.id = m.thread_id join public.profiles p on p.id = t.student_id where m.sender_id = t.student_id and m.sent_at >= since group by p.name order by c desc limit 3 loop tops := tops || '<li>' || r.name || ' · ' || r.c || ' messages</li>'; end loop;
  for r in select p.name from public.profiles p where p.role = 'member' and p.active and p.accel and coalesce((select max(m.sent_at) from public.co_messages m join public.co_threads t on t.id = m.thread_id where t.student_id = p.id and m.sender_id = p.id), p.created_at) < now() - interval '72 hours' order by p.created_at limit 6 loop risks := risks || '<li>' || r.name || '</li>'; end loop;
  txt := 'Réponse médiane ' || coalesce(round(med)::text, '–') || ' min · ' || ans || '/' || q || ' questions répondues · ' || inact || ' élève(s) silencieux > 72 h · ' || msgs || ' messages';
  html := '<h2>Bilan accompagnement · semaine</h2><p>' || txt || '</p><p><b>Les plus actifs</b></p><ul>' || coalesce(nullif(tops, ''), '<li>—</li>') || '</ul><p><b>À risque (silence > 72 h)</b></p><ul>' || coalesce(nullif(risks, ''), '<li>personne 🎉</li>') || '</ul><p>Détails dans l''app → Accompagnement → Suivi.</p>';
  for r in select id, email from public.profiles where role = 'admin' and active loop
    insert into public.notifications (user_id, title, body, url) values (r.id, '📊 Bilan de la semaine', txt, '#cosuivi');
    perform private.send_email(r.email, 'Bilan accompagnement · ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM'), html);
  end loop;
end $$;
select cron.schedule('co-weekly', '0 8 * * 1', $$select private.co_weekly()$$)   -- 8 h UTC = 9 h Paris (hiver)
where not exists (select 1 from cron.job where jobname = 'co-weekly');
