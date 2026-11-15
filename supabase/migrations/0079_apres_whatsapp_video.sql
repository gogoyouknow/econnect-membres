-- 0079 : après le message WhatsApp → page « Avant notre appel » (vidéo + bloc-notes) + email de confirmation avec la vidéo
--        + rappel 2 h avant qui dépend du suivi : vidéo lancée ou non.
-- • Le suivi existe déjà (0043) : la page /decouvrir enregistre « open » (page ouverte), « play » (vidéo lancée), « notes » (questions écrites).
--   « Vidéo regardée » = au moins un « play » pour cette personne (la page s'ouvre toute seule après WhatsApp, donc « open » ne prouve rien).
-- • La séquence de confirmation (0048, modifiable dans Calio) gagne : un départ « après le clic sur WhatsApp » et une condition « vidéo lancée / pas lancée ».
-- • Variables en plus dans les emails : {video} (bouton), {lien_video} (lien), {photo} (photo « où écrire ses questions »).

alter table public.cand_cseq add column if not exists cond text not null default 'always';
alter table public.cand_cseq drop constraint if exists cand_cseq_cond_check;
alter table public.cand_cseq add constraint cand_cseq_cond_check check (cond in ('always', 'not_played', 'played'));
alter table public.cand_cseq drop constraint if exists cand_cseq_anchor_check;
alter table public.cand_cseq add constraint cand_cseq_anchor_check check (anchor in ('after', 'before', 'release', 'click'));
alter table public.cand_settings add column if not exists questions_photo text;

-- A-t-elle lancé la vidéo ?
create or replace function private.cand_played(c public.candidatures) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cand_page_events e
     where e.kind = 'play'
       and (e.candidature_id = c.id
         or e.lead_id in (select l.id from public.cand_leads l
                           where (c.email is not null and lower(l.email) = lower(c.email)) or (c.phone is not null and l.phone = c.phone))))
$$;
revoke all on function private.cand_played(public.candidatures) from public, anon, authenticated;

-- Remplissage des messages (ajout de {video}, {lien_video}, {photo}).
create or replace function private.cseq_fill(tpl text, c public.candidatures, html boolean) returns text
language plpgsql stable set search_path = public, private as $$
declare nm text := private.closer_name(c.closer); w text := private.fr_when(c.starts_at); wa text; r text := coalesce(tpl, '');
  vurl text := 'https://rdv.theambitiousman.fr/decouvrir?t=' || c.qtoken::text; photo text;
begin
  wa := 'https://wa.me/' || private.closer_wa(c.closer) || '?text=' || private.urlenc('Salut ' || nm || ', c''est ' || coalesce(c.first_name, '') || '. Je confirme mon appel pour ' || w || '.');
  select nullif(trim(questions_photo), '') into photo from public.cand_settings where id = 1;
  if html then
    r := replace(replace(replace(r, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    r := replace(r, '{bouton}', '<a href="' || wa || '" style="display:inline-block;background:#25D366;color:#0b0b0c;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:10px">JE CONFIRME SUR WHATSAPP</a>');
    r := replace(r, '{video}', '<a href="' || vurl || '" style="display:inline-block;background:#e0211f;color:#ffffff;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:10px">▶ Regarder la vidéo</a>');
    r := replace(r, '{lien_video}', '<a href="' || vurl || '">ouvre la page ici</a>');
    r := replace(r, '{photo}', case when photo is null then '' else '<img src="' || photo || '" alt="Où écrire tes questions, juste sous la vidéo" width="420" style="display:block;max-width:100%;height:auto;border-radius:10px;border:1px solid #e3e3e3;margin:6px 0">' end);
    r := replace(r, '{lien_wa}', '<a href="' || wa || '">mon WhatsApp</a>');
    r := replace(replace(replace(replace(r, '{prenom}', replace(replace(replace(coalesce(c.first_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')), '{date}', w), '{heure}', to_char(c.starts_at at time zone 'Europe/Paris', 'HH24"h"MI')), '{closer}', nm);
    return replace(r, E'\n', '<br>');
  end if;
  r := replace(replace(replace(replace(replace(r, '{bouton}', wa), '{lien_wa}', wa), '{video}', vurl), '{lien_video}', vurl), '{photo}', '');
  r := replace(replace(replace(r, '{prenom}', coalesce(c.first_name, '')), '{date}', w), '{heure}', to_char(c.starts_at at time zone 'Europe/Paris', 'HH24"h"MI'));
  return replace(r, '{closer}', nm);
end $$;

-- Envoi des emails de la séquence (toutes les 5 min, et tout de suite après un clic sur WhatsApp).
create or replace function private.cseq_run(p_id bigint default null) returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; st record; c public.candidatures%rowtype; due timestamptz; n int := 0;
begin
  select * into s from public.cand_settings where id = 1;
  for st in select * from public.cand_cseq where active and channel = 'email' order by pos loop
    for c in
      select * from public.candidatures x
       where x.status in ('reserve', 'confirme') and x.starts_at > now() and coalesce(x.email, '') <> ''
         and not (st.id = any (x.cseq_sent))
         and (p_id is null or x.id = p_id)
         and (not st.only_unconfirmed or (x.status = 'reserve' and x.wa_clicked_at is null))
         and (st.anchor <> 'click' or x.wa_clicked_at is not null)
       limit 60
    loop
      due := case st.anchor when 'after' then c.created_at + make_interval(mins => st.minutes)
                            when 'before' then c.starts_at - make_interval(mins => st.minutes)
                            when 'click' then c.wa_clicked_at + make_interval(mins => st.minutes)
                            else c.created_at + make_interval(hours => s.release_hours) - make_interval(mins => st.minutes) end;
      continue when due > now() or due < now() - interval '3 hours';
      continue when st.anchor not in ('after', 'click') and due < c.created_at;
      -- Message conditionnel : on regarde le suivi au moment de l'envoi. Si la condition n'est pas remplie, l'étape est « consommée » sans rien envoyer.
      if st.cond <> 'always' and (st.cond = 'played') is distinct from private.cand_played(c) then
        update public.candidatures set cseq_sent = array_append(cseq_sent, st.id) where id = c.id;
        continue;
      end if;
      perform private.send_email(c.email, private.cseq_fill(st.subject, c, false), private.cseq_fill(st.body, c, true), private.closer_name(c.closer));
      update public.candidatures set cseq_sent = array_append(cseq_sent, st.id) where id = c.id;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function private.cseq_run(bigint) from public, anon, authenticated;

create or replace function public.cand_cseq_run() returns int
language sql security definer set search_path = public, private as $$ select private.cseq_run(null) $$;
revoke all on function public.cand_cseq_run() from public, anon, authenticated;

-- Clic sur « Je confirme sur WhatsApp » : on le note, on envoie l'email de confirmation, et on renvoie le code personnel (pour ouvrir la page vidéo).
drop function if exists public.cand_wa_click(jsonb);
create or replace function public.cand_wa_click(p jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
declare em text := lower(trim(coalesce(p ->> 'email', ''))); ph text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  r record; tk text;
begin
  for r in
    select id, qtoken::text as tk, wa_clicked_at is null as is_first from public.candidatures
     where status in ('reserve', 'confirme') and starts_at > now()
       and ((em <> '' and lower(email) = em) or (length(ph) >= 8 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(ph, 9)))
     order by created_at
  loop
    tk := r.tk;
    if r.is_first then
      update public.candidatures set wa_clicked_at = now() where id = r.id;
      perform private.cseq_run(r.id);
    end if;
  end loop;
  return tk;
end $$;
grant execute on function public.cand_wa_click(jsonb) to anon, authenticated;

-- Celle ou celui qui a confirmé sur WhatsApp garde son créneau (plus de « libération » 4 h après la réservation).
create or replace function public.cand_release() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.candidatures c set status = 'annule', note = trim(c.note || ' [libéré auto : pas de message WhatsApp]')
  where c.status = 'reserve' and c.wa_clicked_at is null and c.created_at < now() - make_interval(hours => (select release_hours from public.cand_settings where id = 1));
  get diagnostics n = row_count;
  return n;
end $$;

-- Les trois messages : confirmation (au clic), 2 h avant « pas encore regardé », 2 h avant « déjà regardé ».
insert into public.cand_cseq (pos, label, anchor, minutes, channel, subject, body, only_unconfirmed, active, cond)
select 0, 'Appel confirmé + vidéo', 'click', 0, 'email',
  'Ton appel est bien confirmé ✓ Regarde cette vidéo : elle t''explique comment fonctionne E-Connect',
  E'Salut {prenom},\n\nC''est bien noté, ton appel est confirmé : on se parle {date}.\n\nAvant ça, prends 13 minutes pour regarder cette vidéo. Elle t''explique exactement comment fonctionne le business E-Connect, étape par étape. Tu arriveras à l''appel en sachant de quoi on parle, et on ira droit au but.\n\n{video}\n\nPendant que tu la regardes, note tes questions dans la case juste en dessous de la vidéo : je les lis avant l''appel.\n\nÀ très vite,\n{closer}',
  false, true, 'always'
where not exists (select 1 from public.cand_cseq where anchor = 'click');

update public.cand_cseq set label = '2 h avant · vidéo pas encore lancée', cond = 'not_played',
  subject = '{prenom}, ton appel est dans 2 h : as-tu regardé la vidéo ?',
  body = E'Salut {prenom},\n\nOn s''appelle aujourd''hui à {heure}.\n\nTu n''as pas encore regardé la vidéo ? Elle t''explique exactement comment fonctionne le business E-Connect. Il te reste le temps : 13 minutes suffisent, et tu arriveras à l''appel en sachant de quoi on parle.\n\n{video}\n\nEt pour ne pas oublier tes questions, écris-les directement sous la vidéo, dans la petite case prévue pour ça (regarde la photo ci-dessous). Je les lis avant l''appel.\n\n{photo}\n\nUn empêchement ? Préviens-moi vite sur {lien_wa}.\n\n{closer}'
 where pos = 4 and label = '2 h avant' and subject = 'Ton appel avec {closer} est dans 2 h' and cond = 'always';

insert into public.cand_cseq (pos, label, anchor, minutes, channel, subject, body, only_unconfirmed, active, cond)
select 6, '2 h avant · vidéo déjà lancée', 'before', 120, 'email',
  '{prenom}, ton appel est dans 2 h : prépare bien tes questions',
  E'Salut {prenom},\n\nOn s''appelle aujourd''hui à {heure}. Tu as déjà lancé la vidéo, bien joué.\n\nUne dernière chose pour que l''appel te serve vraiment : prépare tes questions. Pour ne pas les oublier, écris-les directement sous la vidéo de présentation, dans la petite case prévue pour ça (regarde la photo ci-dessous). Je les lis avant qu''on se parle.\n\nTu peux le faire ici : {lien_video}\n\n{photo}\n\nUn empêchement ? Préviens-moi vite sur {lien_wa}.\n\n{closer}',
  false, true, 'played'
where exists (select 1 from public.cand_cseq where cond = 'not_played') and not exists (select 1 from public.cand_cseq where cond = 'played');
