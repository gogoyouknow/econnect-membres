-- 0096 : Coach d'appels (ordinateur). On dépose / colle un appel (transcription, audio facultatif), l'IA donne un retour de coach.
-- Chaque closer voit ses appels, l'équipe (Clément) voit tout. L'analyse part vers l'IA depuis la base (pg_net), sans fonction à déployer.
create table if not exists public.call_reviews (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  closer text references public.cand_closers (key) on delete set null,
  candidature_id bigint references public.candidatures (id) on delete set null,
  title text not null default '',
  call_date date,
  outcome text check (outcome in ('signe', 'perdu', 'reflechit', 'absent')),
  transcript text not null default '',
  audio_path text,
  status text not null default 'nouveau' check (status in ('nouveau', 'analyse', 'ok', 'erreur')),
  req_id bigint,
  started_at timestamptz,
  analysis jsonb,
  score numeric,
  err text
);
create index if not exists call_reviews_closer on public.call_reviews (closer, created_at desc);
alter table public.call_reviews enable row level security;
drop policy if exists "call_reviews: accès" on public.call_reviews;
create policy "call_reviews: accès" on public.call_reviews for all to authenticated
  using (public.is_staff() or (public.is_closer() and closer = private.my_closer()))
  with check (public.is_staff() or (public.is_closer() and closer = private.my_closer()));

-- Stockage des audios (privé, 50 Mo max par fichier).
insert into storage.buckets (id, name, public, file_size_limit) values ('call-audio', 'call-audio', false, 52428800)
  on conflict (id) do update set public = false, file_size_limit = 52428800;
drop policy if exists "call-audio: lecture" on storage.objects;
create policy "call-audio: lecture" on storage.objects for select to authenticated
  using (bucket_id = 'call-audio' and (public.is_staff() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "call-audio: dépôt" on storage.objects;
create policy "call-audio: dépôt" on storage.objects for insert to authenticated
  with check (bucket_id = 'call-audio' and (public.is_staff() or public.is_closer()) and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "call-audio: suppression" on storage.objects;
create policy "call-audio: suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'call-audio' and (public.is_staff() or (storage.foldername(name))[1] = auth.uid()::text));

-- Lance l'analyse (la réponse arrive quelques dizaines de secondes plus tard : voir call_review_poll).
create or replace function public.call_review_run(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare r public.call_reviews; k text; sys text; usr text; rid bigint; c public.candidatures; cn text; ctx text := '';
begin
  select * into r from public.call_reviews where id = p_id;
  if not found then raise exception 'Appel introuvable.'; end if;
  if not (public.is_staff() or (public.is_closer() and r.closer = private.my_closer())) then raise exception 'Accès refusé.'; end if;
  if length(trim(coalesce(r.transcript, ''))) < 300 then raise exception 'La transcription est trop courte pour être analysée (colle l''appel en entier).'; end if;
  select value into k from private.secrets where key = 'anthropic_key';
  if coalesce(k, '') = '' then raise exception 'La clé de l''IA n''est pas configurée dans Calio.'; end if;
  select name into cn from public.cand_closers where key = r.closer;
  if r.candidature_id is not null then
    select * into c from public.candidatures where id = r.candidature_id;
    if found then ctx := 'Prospect : ' || coalesce(c.first_name, '?') || ' · situation : ' || coalesce(c.situation, 'non précisée') || ' · budget annoncé : ' ||
      case c.capital when 'lt500' then 'moins de 500 €' when '500-1000' then '500 à 1 000 €' when '1000-3000' then '1 000 à 3 000 €' when 'gt3000' then 'plus de 3 000 €' else 'non précisé' end || E'\n'; end if;
  end if;
  sys := 'Tu es un coach de vente expérimenté, exigeant mais bienveillant, qui débriefe des appels de closing en visio/téléphone pour un accompagnement e-commerce (E-Connect / L''Accélérateur, de Clément). '
    || 'Le closer mène un appel de découverte puis de proposition : comprendre la situation et le blocage du prospect, qualifier le budget, présenter l''accompagnement, traiter les objections, conclure. '
    || 'Tu analyses la transcription et tu réponds UNIQUEMENT par un objet JSON valide (aucun texte autour), en français, avec le tutoiement envers le closer. '
    || 'Sois concret : cite de courts extraits de la transcription (moins de 20 mots) comme preuves, ne remplis pas de généralités. Ne promets jamais de revenus. '
    || 'Format exact : {"note": nombre de 0 à 10 (une décimale max), "resume": "3 phrases max sur le déroulé et l''issue", '
    || '"notes_detail": {"decouverte": 0-10, "objections": 0-10, "closing": 0-10, "ecoute": 0-10}, '
    || '"points_forts": ["2 à 4 points, avec la preuve"], "a_ameliorer": ["2 à 4 points précis, avec la preuve et quoi faire à la place"], '
    || '"objections": [{"objection": "ce que dit le prospect", "traitement": "bien|partiel|mal", "commentaire": "pourquoi", "meilleure_reponse": "ce que tu aurais pu dire, en une ou deux phrases"}], '
    || '"moments_cles": [{"extrait": "citation courte", "commentaire": "pourquoi c''est important"}], '
    || '"a_dire_la_prochaine_fois": ["2 à 3 phrases prêtes à dire"], "prochaine_action": "une seule chose à travailler en priorité"}';
  usr := 'Closer : ' || coalesce(cn, 'non précisé') || E'\n' || ctx
    || 'Résultat de l''appel : ' || case r.outcome when 'signe' then 'signé' when 'perdu' then 'pas signé' when 'reflechit' then 'le prospect réfléchit' when 'absent' then 'prospect absent' else 'non renseigné' end || E'\n\n'
    || 'TRANSCRIPTION :' || E'\n' || left(r.transcript, 60000);
  select net.http_post(
    url := 'https://api.anthropic.com/v1/messages',
    headers := jsonb_build_object('x-api-key', k, 'anthropic-version', '2023-06-01', 'content-type', 'application/json'),
    body := jsonb_build_object('model', 'claude-sonnet-5-5', 'max_tokens', 3000, 'system', sys, 'messages', jsonb_build_array(jsonb_build_object('role', 'user', 'content', usr))),
    timeout_milliseconds := 170000) into rid;
  update public.call_reviews set status = 'analyse', req_id = rid, started_at = now(), err = null where id = p_id;
end $$;
grant execute on function public.call_review_run(bigint) to authenticated;

-- Regarde si la réponse de l'IA est arrivée et range l'analyse. À appeler toutes les quelques secondes tant que le statut est « analyse ».
create or replace function public.call_review_poll(p_id bigint) returns public.call_reviews
language plpgsql security definer set search_path = public, private as $$
declare r public.call_reviews; resp record; txt text; js text; a jsonb; sc numeric;
begin
  select * into r from public.call_reviews where id = p_id;
  if not found then raise exception 'Appel introuvable.'; end if;
  if not (public.is_staff() or (public.is_closer() and r.closer = private.my_closer())) then raise exception 'Accès refusé.'; end if;
  if r.status = 'analyse' then
    select * into resp from net._http_response where id = r.req_id;
    if found then
      if resp.status_code = 200 then
        begin
          txt := (resp.content::jsonb -> 'content' -> 0 ->> 'text');
          js := substring(txt from '\{.*\}');
          a := js::jsonb;
          sc := nullif(a ->> 'note', '')::numeric;
          update public.call_reviews set status = 'ok', analysis = a, score = sc, err = null where id = p_id;
        exception when others then
          update public.call_reviews set status = 'erreur', err = 'La réponse de l''IA était illisible. Relance l''analyse.' where id = p_id;
        end;
      else
        update public.call_reviews set status = 'erreur', err = case when resp.status_code = 401 then 'La clé de l''IA est refusée.' when resp.timed_out then 'L''IA a mis trop de temps à répondre.' else 'L''IA n''a pas répondu (code ' || coalesce(resp.status_code::text, '?') || ').' end where id = p_id;
      end if;
    elsif r.started_at < now() - interval '5 minutes' then
      update public.call_reviews set status = 'erreur', err = 'Pas de réponse de l''IA. Relance l''analyse.' where id = p_id;
    end if;
  end if;
  return (select x from public.call_reviews x where x.id = p_id);
end $$;
grant execute on function public.call_review_poll(bigint) to authenticated;
