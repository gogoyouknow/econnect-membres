-- Séquence de confirmation : messages programmés autour de chaque rendez-vous (modifiables dans Calio).
--   anchor 'after'   = X minutes après la réservation
--   anchor 'before'  = X minutes avant l'appel
--   anchor 'release' = X minutes avant que le créneau soit libéré automatiquement (si pas confirmé)
-- Les messages email partent tout seuls ; les messages WhatsApp apparaissent dans Calio « À envoyer » (un tap).
create table if not exists public.cand_cseq (
  id serial primary key,
  pos int not null default 0,
  label text not null,
  anchor text not null default 'before' check (anchor in ('after', 'before', 'release')),
  minutes int not null default 60 check (minutes >= 0),
  channel text not null default 'email' check (channel in ('email', 'whatsapp')),
  subject text not null default '',
  body text not null default '',
  only_unconfirmed boolean not null default false,
  active boolean not null default true
);
alter table public.cand_cseq enable row level security;
drop policy if exists "cand_cseq: équipe" on public.cand_cseq;
create policy "cand_cseq: équipe" on public.cand_cseq for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.cand_cseq to authenticated;
grant usage, select on sequence public.cand_cseq_id_seq to authenticated;
alter table public.candidatures add column if not exists cseq_sent int[] not null default '{}';

-- Étapes de départ (les deux rappels déjà en place + deux nouveaux).
insert into public.cand_cseq (pos, label, anchor, minutes, channel, subject, body, only_unconfirmed, active)
select * from (values
  (1, 'Rappel de confirmation', 'after', 20, 'email', 'Ton appel n''est pas encore confirmé · {date}',
   E'Salut {prenom},\n\nTon créneau du {date} est réservé, mais il n''est pas encore confirmé. Il te reste une seule chose à faire : m''envoyer un message sur WhatsApp.\n\n{bouton}\n\nSans message de ta part, je libère ton créneau dans quelques heures pour quelqu''un d''autre.\n\n{closer}', true, true),
  (2, 'Dernière chance', 'release', 60, 'email', 'Dernière chance de confirmer ton appel · {date}',
   E'Salut {prenom},\n\nJe libère ton créneau du {date} dans environ une heure si je n''ai pas de message de ta part.\n\n{bouton}\n\n{closer}', true, true),
  (3, 'La veille (WhatsApp)', 'before', 1440, 'whatsapp', '',
   E'Salut {prenom}, c''est {closer}. Petit rappel : on s''appelle demain à {heure}. Tu me confirmes que tu es bien dispo ? 🙏', false, true),
  (4, '2 h avant', 'before', 120, 'email', 'Ton appel avec {closer} est dans 2 h',
   E'Salut {prenom},\n\nOn s''appelle aujourd''hui à {heure}. Installe-toi au calme, avec de quoi noter.\n\nSi tu as un empêchement, préviens-moi vite sur {lien_wa}.\n\n{closer}', false, true),
  (5, '15 min avant (WhatsApp)', 'before', 15, 'whatsapp', '',
   E'{prenom}, je t''appelle dans 15 minutes. Tiens-toi prêt(e) 👍', false, false)
) v(pos, label, anchor, minutes, channel, subject, body, only_unconfirmed, active)
where not exists (select 1 from public.cand_cseq);

-- Les rendez-vous qui ont déjà reçu les anciens rappels ne les reçoivent pas une deuxième fois.
update public.candidatures c set cseq_sent = array(select distinct unnest(cseq_sent || array_remove(array[
    case when c.remind1_at is not null then (select id from public.cand_cseq where pos = 1) end,
    case when c.remind2_at is not null then (select id from public.cand_cseq where pos = 2) end], null)))
 where c.remind1_at is not null or c.remind2_at is not null;

create or replace function private.cseq_fill(tpl text, c public.candidatures, html boolean) returns text
language plpgsql stable set search_path = public, private as $$
declare nm text := private.closer_name(c.closer); w text := private.fr_when(c.starts_at); wa text; r text := coalesce(tpl, '');
begin
  wa := 'https://wa.me/' || private.closer_wa(c.closer) || '?text=' || private.urlenc('Salut ' || nm || ', c''est ' || coalesce(c.first_name, '') || '. Je confirme mon appel pour ' || w || '.');
  if html then
    r := replace(replace(replace(r, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    r := replace(r, '{bouton}', '<a href="' || wa || '" style="display:inline-block;background:#25D366;color:#0b0b0c;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:10px">JE CONFIRME SUR WHATSAPP</a>');
    r := replace(r, '{lien_wa}', '<a href="' || wa || '">mon WhatsApp</a>');
    r := replace(replace(replace(replace(r, '{prenom}', replace(replace(replace(coalesce(c.first_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')), '{date}', w), '{heure}', to_char(c.starts_at at time zone 'Europe/Paris', 'HH24"h"MI')), '{closer}', nm);
    return replace(r, E'\n', '<br>');
  end if;
  r := replace(replace(replace(replace(replace(r, '{bouton}', wa), '{lien_wa}', wa), '{prenom}', coalesce(c.first_name, '')), '{date}', w), '{heure}', to_char(c.starts_at at time zone 'Europe/Paris', 'HH24"h"MI'));
  return replace(r, '{closer}', nm);
end $$;

create or replace function public.cand_cseq_run() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; st record; c public.candidatures%rowtype; due timestamptz; n int := 0;
begin
  select * into s from public.cand_settings where id = 1;
  for st in select * from public.cand_cseq where active and channel = 'email' order by pos loop
    for c in
      select * from public.candidatures x
       where x.status in ('reserve', 'confirme') and x.starts_at > now() and coalesce(x.email, '') <> ''
         and not (st.id = any (x.cseq_sent)) and (not st.only_unconfirmed or x.status = 'reserve')
       limit 60
    loop
      due := case st.anchor when 'after' then c.created_at + make_interval(mins => st.minutes)
                            when 'before' then c.starts_at - make_interval(mins => st.minutes)
                            else c.created_at + make_interval(hours => s.release_hours) - make_interval(mins => st.minutes) end;
      continue when due > now() or due < now() - interval '3 hours';
      continue when st.anchor <> 'after' and due < c.created_at;
      perform private.send_email(c.email, private.cseq_fill(st.subject, c, false), private.cseq_fill(st.body, c, true), private.closer_name(c.closer));
      update public.candidatures set cseq_sent = array_append(cseq_sent, st.id) where id = c.id;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.cand_cseq_run() from public, anon, authenticated;

-- L'ancien envoi codé en dur est remplacé par la séquence.
do $$ begin perform cron.unschedule('cand-confirm-remind'); exception when others then null; end $$;
drop function if exists public.cand_confirm_remind();
do $$ begin perform cron.unschedule('cand-cseq'); exception when others then null; end $$;
select cron.schedule('cand-cseq', '*/5 * * * *', 'select public.cand_cseq_run()');
