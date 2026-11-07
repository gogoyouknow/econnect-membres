-- 0019 : analytics de la page de vente Méthode (/methode) — événements anonymes, lecture admin

create table if not exists public.page_events (
  id bigserial primary key,
  ts timestamptz not null default now(),
  page text not null,
  vid text not null,          -- visiteur (identifiant aléatoire, navigateur)
  sid text not null,          -- session (identifiant aléatoire, onglet)
  event text not null,        -- view · scroll · sec · click · hb · leave
  data jsonb not null default '{}'::jsonb
);
create index if not exists page_events_ts on public.page_events (ts desc);
create index if not exists page_events_sid on public.page_events (sid);
alter table public.page_events enable row level security;
drop policy if exists "events: admin" on public.page_events;
create policy "events: admin" on public.page_events for select to authenticated using (public.is_admin());

-- enregistrement depuis la page (anonyme) : un lot d'événements par appel
create or replace function public.track_events(p_page text, p_vid text, p_sid text, p_events jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if p_page is null or length(p_page) > 80 or length(p_vid) <> 16 or length(p_sid) <> 16 then return; end if;
  if jsonb_typeof(p_events) <> 'array' then return; end if;
  for e in select * from jsonb_array_elements(p_events) loop
    n := n + 1; if n > 40 then exit; end if;
    if length(coalesce(e->>'e', '')) between 1 and 20 and length(coalesce(e->'d', '{}')::text) <= 1500 then
      insert into public.page_events (page, vid, sid, event, data) values (p_page, p_vid, p_sid, e->>'e', coalesce(e->'d', '{}'::jsonb));
    end if;
  end loop;
end $$;
revoke all on function public.track_events(text, text, text, jsonb) from public;
grant execute on function public.track_events(text, text, text, jsonb) to anon, authenticated;

-- résumé pour la page Analytics (admin)
create or replace function public.analytics_summary(p_page text, p_days int default 7) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365))); r jsonb;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  with ev as (select * from public.page_events where page = p_page and ts >= since),
  sess as (
    select sid, min(vid) vid, min(ts) started,
      max(case when event = 'leave' then (data->>'t')::int end) t_leave,
      max(case when event = 'hb' then (data->>'t')::int end) t_hb,
      max(case when event = 'scroll' then (data->>'depth')::int end) depth,
      max(case when event = 'leave' then (data->>'last_sec')::int end) last_sec,
      bool_or(event = 'click' and data->>'t' like 'cta%') clicked_cta,
      bool_or(event = 'click' and data->>'t' = 'buy') clicked_buy,
      bool_or(event = 'click' and data->>'t' = 'bump_on') bump,
      min(case when event = 'view' then data->>'device' end) device,
      min(case when event = 'view' then coalesce(nullif(data->>'utm_source', ''), nullif(data->>'ref_host', ''), 'direct') end) src,
      min(case when event = 'view' then nullif(data->>'utm_campaign', '') end) camp
    from ev group by sid),
  s2 as (select *, coalesce(t_leave, t_hb, 0) t from sess),
  secs as (
    select (data->>'n')::int n, max(data->>'name') name, count(distinct sid) seen, round(avg((data->>'dwell')::numeric) / 1000, 1) dwell
    from ev where event = 'sec' group by 1)
  select jsonb_build_object(
    'days', p_days,
    'visitors', (select count(distinct vid) from s2),
    'sessions', (select count(*) from s2),
    'avg_time', (select round(avg(t)) from s2 where t > 0),
    'median_time', (select percentile_cont(0.5) within group (order by t) from s2 where t > 0),
    'bounce', (select count(*) filter (where t < 10 and coalesce(depth, 0) < 25) from s2),
    'scroll', (select jsonb_build_object('25', count(*) filter (where depth >= 25), '50', count(*) filter (where depth >= 50), '75', count(*) filter (where depth >= 75), '90', count(*) filter (where depth >= 90), '100', count(*) filter (where depth >= 100)) from s2),
    'cta_sessions', (select count(*) filter (where clicked_cta) from s2),
    'buy_sessions', (select count(*) filter (where clicked_buy) from s2),
    'bump_sessions', (select count(*) filter (where bump) from s2),
    'clicks', (select coalesce(jsonb_object_agg(t, c), '{}') from (select data->>'t' t, count(*) c from ev where event = 'click' group by 1 order by 2 desc limit 40) x),
    'sections', (select coalesce(jsonb_agg(jsonb_build_object('n', n, 'name', name, 'seen', seen, 'dwell', dwell) order by n), '[]') from secs),
    'stops', (select coalesce(jsonb_object_agg(last_sec, c), '{}') from (select last_sec, count(*) c from s2 where last_sec is not null group by 1) x),
    'devices', (select coalesce(jsonb_object_agg(coalesce(device, '?'), c), '{}') from (select device, count(*) c from s2 group by 1) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('src', src, 'camp', camp, 'sessions', c, 'buy', b) order by c desc), '[]') from (select src, camp, count(*) c, count(*) filter (where clicked_buy) b from s2 group by 1, 2 order by 3 desc limit 12) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'sessions', c, 'buy', b) order by d), '[]') from (select to_char(started at time zone 'Europe/Paris', 'YYYY-MM-DD') d, count(*) c, count(*) filter (where clicked_buy) b from s2 group by 1) x),
    'purchases', (select count(*) from public.stripe_events where received_at >= since and type = 'checkout.session.completed'),
    'last_events', (select coalesce(jsonb_agg(jsonb_build_object('ts', ts, 'sid', left(sid, 4), 'e', event, 'd', data) order by ts desc), '[]') from (select * from ev where event in ('view', 'click', 'leave') order by ts desc limit 30) x)
  ) into r;
  return r;
end $$;
revoke all on function public.analytics_summary(text, int) from public, anon;
grant execute on function public.analytics_summary(text, int) to authenticated;

-- ménage : on garde 180 jours
select cron.schedule('purge-page-events', '17 4 * * *', $$delete from public.page_events where ts < now() - interval '180 days'$$)
where not exists (select 1 from cron.job where jobname = 'purge-page-events');
