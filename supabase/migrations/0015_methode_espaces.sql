-- 0015 : espace Méthode E-Connect → Résultats et Lives & replays ouverts aux élèves de la Méthode
-- Le chat reste réservé à L'Accélérateur (abonnement).

-- un live peut être ouvert ou non aux élèves de la Méthode (ouvert par défaut)
alter table public.lives add column if not exists methode boolean not null default true;

-- profils : un élève Méthode voit les auteurs des résultats
drop policy if exists "profiles: lecture membres actifs" on public.profiles;
create policy "profiles: lecture membres actifs" on public.profiles for select to authenticated
  using (public.has_accel() or public.has_methode() or id = auth.uid());

-- Résultats (fil « wins ») : lecture et publication pour la Méthode
drop policy if exists "posts: lecture" on public.posts;
create policy "posts: lecture" on public.posts for select to authenticated
  using ((public.has_accel() or (public.has_methode() and space_id = 'wins')) and (approved or user_id = auth.uid() or public.is_staff()));
drop policy if exists "posts: écrire" on public.posts;
create policy "posts: écrire" on public.posts for insert to authenticated
  with check (user_id = auth.uid() and (public.has_accel() or (public.has_methode() and space_id = 'wins')));
drop policy if exists "replies: lecture" on public.replies;
create policy "replies: lecture" on public.replies for select to authenticated
  using (public.has_accel() or (public.has_methode() and exists (select 1 from public.posts p where p.id = post_id and p.space_id = 'wins')));
drop policy if exists "replies: écrire" on public.replies;
create policy "replies: écrire" on public.replies for insert to authenticated
  with check (user_id = auth.uid() and (public.has_accel() or (public.has_methode() and exists (select 1 from public.posts p where p.id = post_id and p.space_id = 'wins'))));

-- Lives & replays : les lives marqués « ouverts à la Méthode »
drop policy if exists "lives: lecture" on public.lives;
create policy "lives: lecture" on public.lives for select to authenticated
  using (public.has_accel() or (public.has_methode() and methode));

-- notifications et rappels de live : seulement à ceux qui peuvent voir le live
create or replace function public.notify_live(live_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare l public.lives%rowtype;
begin
  if not public.is_staff() then raise exception 'Réservé aux coachs'; end if;
  select * into l from public.lives where id = live_id;
  insert into public.notifications (user_id, title, body, url)
  select id, 'Live : ' || l.title, to_char(l.starts_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ' avec ' || l.host, '#lives'
  from public.profiles where active and notif_lives and (role <> 'member' or (tier >= l.tier_required and (accel or (methode and l.methode))));
end $$;

create or replace function public.send_live_reminders() returns int language plpgsql security definer set search_path = public as $$
declare l record; m record; n int := 0; body text; when_txt text;
begin
  for l in select * from public.lives where not reminded and starts_at between now() + interval '50 minutes' and now() + interval '70 minutes' loop
    when_txt := to_char(l.starts_at at time zone 'Europe/Paris', 'HH24"h"MI');
    for m in select email, first_name from public.profiles where active and notif_lives and (role <> 'member' or (tier >= l.tier_required and (accel or (methode and l.methode)))) loop
      body := '<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#333"><b>' || l.title || '</b>, avec ' || l.host || '. ' || coalesce('', '') || '</p>'
           || private.btn('Rejoindre le live', coalesce(l.link, 'https://econnect-membres.vercel.app/#lives'))
           || '<p style="margin:0;font-size:12px;color:#777">Le replay sera dans l''app, onglet Lives. Tu peux couper les rappels dans Mon profil → Notifications.</p>';
      perform private.send_email(m.email, 'Live dans 1 h : ' || l.title, private.email_html('On se retrouve à ' || when_txt, body), 'Clément · L''Accélérateur');
      n := n + 1;
    end loop;
    insert into public.notifications (user_id, title, body, url) select id, 'Live dans 1 h : ' || l.title, 'À ' || when_txt || ' avec ' || l.host, '#lives'
      from public.profiles where active and notif_lives and (role <> 'member' or (tier >= l.tier_required and (accel or (methode and l.methode))));
    update public.lives set reminded = true where id = l.id;
  end loop;
  return n;
end $$;

notify pgrst, 'reload schema';
