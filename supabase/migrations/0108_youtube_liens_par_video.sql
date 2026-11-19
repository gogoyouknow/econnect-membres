-- 0108 : section YouTube (un lien de réservation par vidéo) + événement « YouTube ».
-- · l'événement /e/youtube est une copie du lien en bio TikTok : mêmes closers, mêmes règles, mêmes questions (qual) ;
-- · yt_videos : la liste des vidéos (identifiant YouTube) dont l'admin génère les liens ;
-- · yt_stats() : prospects, rendez-vous, appels faits et signatures par vidéo (lues dans le suivi de provenance utm_campaign = identifiant de la vidéo).

insert into public.cand_events (name, slug, source, notes, pool, rules, qual, active)
select 'YouTube', 'youtube', 'YouTube', 'Un lien par vidéo (onglet YouTube) · mêmes questions et même répartition que le lien en bio TikTok', m.pool, m.rules, m.qual, true
  from public.cand_events m
 where m.main and not exists (select 1 from public.cand_events x where x.slug = 'youtube');

create table if not exists public.yt_videos (
  id bigserial primary key,
  video_id text not null unique check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null default '',
  note text,
  created_at timestamptz not null default now()
);
alter table public.yt_videos enable row level security;
drop policy if exists "yt_videos: admin" on public.yt_videos;
create policy "yt_videos: admin" on public.yt_videos for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.yt_videos from anon;
grant select, insert, update, delete on public.yt_videos to authenticated;
grant usage, select on sequence public.yt_videos_id_seq to authenticated;

create or replace function public.yt_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select coalesce(l.utm ->> 'campaign', '') as campaign,
             count(*)::int as leads,
             (count(*) filter (where c.id is not null and c.status <> 'annule'))::int as rdv,
             (count(*) filter (where c.status = 'fait'))::int as faits,
             (count(*) filter (where c.status = 'fait' and c.outcome = 'signe'))::int as signes,
             coalesce(sum(c.signed_amount) filter (where c.status = 'fait' and c.outcome = 'signe'), 0) as montant,
             max(l.created_at) as dernier
        from public.cand_leads l
        left join lateral (
          select c1.* from public.candidatures c1
           where (l.email is not null and lower(c1.email) = lower(l.email)) or (l.phone is not null and c1.phone = l.phone)
           order by (c1.status in ('reserve', 'confirme')) desc, c1.starts_at desc limit 1
        ) c on true
       where lower(coalesce(l.utm ->> 'source', l.utm ->> 'src', '')) like '%youtu%'
          or lower(coalesce(l.source, '')) = 'youtube'
          or coalesce(l.landing, '') like '%/e/youtube%'
       group by 1
    ) x), '[]'::jsonb);
end $$;
revoke execute on function public.yt_stats() from public, anon;
grant execute on function public.yt_stats() to authenticated, service_role;
