-- 0097 : les règles par profil (Répartition) peuvent aussi cibler :
--   · « As-tu déjà investi dans une formation ou un coaching ? » (invest)
--   · « Tu peux vraiment mobiliser ce budget maintenant ? » : Oui / Pas encore / Non (have)
-- Une règle qui cible explicitement « Pas encore » ou « Non » ouvre le calendrier aux personnes concernées (comme la règle « Moins de 500 € »), et l'appel va au closer de la règle.
-- Sans règle de ce type, rien ne change. Remplace le réglage « Questions du formulaire » de la 0095 (qui n'est plus utilisé).

-- Une règle correspond-elle à ce profil ?
create or replace function private.rule_hit(r jsonb, p_cap text, p_sit text, p_src text, p_inv text, p_have text) returns boolean
language sql immutable as $$
  select (jsonb_array_length(coalesce(r -> 'capital', '[]'::jsonb)) = 0 or jsonb_exists(r -> 'capital', coalesce(p_cap, '')))
     and (jsonb_array_length(coalesce(r -> 'situation', '[]'::jsonb)) = 0 or jsonb_exists(r -> 'situation', coalesce(p_sit, '')))
     and (jsonb_array_length(coalesce(r -> 'invest', '[]'::jsonb)) = 0 or jsonb_exists(r -> 'invest', coalesce(p_inv, '')))
     and (jsonb_array_length(coalesce(r -> 'have', '[]'::jsonb)) = 0 or jsonb_exists(r -> 'have', coalesce(p_have, '')))
     and (coalesce(r ->> 'source', '') = '' or position(lower(r ->> 'source') in lower(coalesce(p_src, ''))) > 0)
$$;

-- Répartition : mêmes règles qu'avant + les deux nouvelles conditions.
drop function if exists private.cand_route(text, text, text, text, text);
create or replace function private.cand_route(p_slug text, p_cap text, p_sit text, p_src text, p_forced text, p_inv text default null, p_have text default null, out o_closer text, out o_event bigint, out o_why text)
language plpgsql stable security definer set search_path = public, private as $$
declare ev public.cand_events; r jsonb; n int := 0; k text;
begin
  select * into ev from public.cand_events where slug = nullif(p_slug, '') and active;
  if not found then select * into ev from public.cand_events where main; end if;
  o_event := ev.id;
  if coalesce(p_forced, '') <> '' and exists (select 1 from public.cand_closers where key = p_forced and active) then
    o_closer := p_forced; o_why := 'Lien personnel du closer'; return;
  end if;
  for r in select value from jsonb_array_elements(coalesce(ev.rules, '[]'::jsonb)) loop
    n := n + 1; k := r ->> 'closer';
    continue when not exists (select 1 from public.cand_closers where key = k and active);
    if private.rule_hit(r, p_cap, p_sit, p_src, p_inv, p_have) then o_closer := k; o_why := 'Règle ' || n; return; end if;
  end loop;
  select x.key, x.lbl into o_closer, o_why from (
    select c.key, 'Priorité ' || (case pj ->> 'prio' when 'haute' then 'haute' when 'moyenne' then 'moyenne' else 'basse' end) as lbl,
           case pj ->> 'prio' when 'haute' then 1 when 'moyenne' then 2 else 3 end as rk,
           (select count(*) from public.candidatures q where q.closer = c.key and q.status in ('reserve', 'confirme') and q.starts_at > now()) as up,
           (select coalesce(max(q.created_at), 'epoch'::timestamptz) from public.candidatures q where q.closer = c.key) as last
      from jsonb_array_elements(coalesce(ev.pool, '[]'::jsonb)) pj
      join public.cand_closers c on c.key = pj ->> 'closer' and c.active
     where coalesce(pj ->> 'prio', '') in ('haute', 'moyenne', 'basse')
  ) x order by x.rk, x.up, x.last limit 1;
  if o_closer is null then o_closer := 'clement'; o_why := 'Par défaut (aucun closer dans la priorité)'; end if;
end $$;
revoke all on function private.cand_route(text, text, text, text, text, text, text) from public, anon, authenticated;

-- Simulateur (Tester) avec les nouvelles questions.
drop function if exists public.cand_route_test(bigint, text, text, text);
create or replace function public.cand_route_test(p_event bigint, p_cap text, p_sit text, p_src text, p_inv text default null, p_have text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare slug text; r record; nm text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  select e.slug into slug from public.cand_events e where e.id = p_event;
  select * into r from private.cand_route(slug, p_cap, p_sit, p_src, '', p_inv, p_have);
  select name into nm from public.cand_closers where key = r.o_closer;
  return jsonb_build_object('closer', r.o_closer, 'name', nm, 'why', r.o_why);
end $$;
grant execute on function public.cand_route_test(bigint, text, text, text, text, text) to authenticated;

-- Cette personne peut-elle réserver ? (budget disponible maintenant, ancienne exception « moins de 500 € », ou règle ciblant sa réponse « Pas encore » / « Non »)
create or replace function private.can_book(p_slug text, p_cap text, p_have text, p_sit text, p_inv text, p_src text) returns boolean
language plpgsql stable security definer set search_path = public, private as $$
declare ev public.cand_events; r jsonb;
begin
  if coalesce(p_cap, '') not in ('lt500', '500-1000', '1000-3000', 'gt3000') then return false; end if;
  if p_cap <> 'lt500' and coalesce(p_have, '') = 'yes' then return true; end if;
  select * into ev from public.cand_events
   where active and ((nullif(trim(p_slug), '') is not null and slug = lower(trim(p_slug))) or (nullif(trim(p_slug), '') is null and main)) limit 1;
  if not found then return false; end if;
  -- réglage d'avant : une règle qui cible « Moins de 500 € » ouvre le calendrier à tout le monde sur cet événement
  if coalesce((public.cand_event_info(p_slug) ->> 'lt500')::boolean, false) then return true; end if;
  if p_cap = 'lt500' then return false; end if;
  -- règle qui cible explicitement la réponse « Pas encore » / « Non » de cette personne
  for r in select value from jsonb_array_elements(coalesce(ev.rules, '[]'::jsonb)) loop
    continue when not exists (select 1 from public.cand_closers where key = r ->> 'closer' and active);
    continue when not jsonb_exists(coalesce(r -> 'have', '[]'::jsonb), coalesce(p_have, ''));
    if private.rule_hit(r, p_cap, p_sit, p_src, p_inv, p_have) then return true; end if;
  end loop;
  return false;
end $$;

-- Pour la page de réservation : même réponse que le serveur, une seule logique.
create or replace function public.cand_can_book(p jsonb) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.can_book(p ->> 'event', p ->> 'capital', p ->> 'have', p ->> 'situation', p ->> 'invest', p ->> 'src')
$$;
grant execute on function public.cand_can_book(jsonb) to anon, authenticated;

-- La réservation côté serveur utilise la même logique et transmet les réponses à la répartition.
do $do$ declare d text; m1 text; m2 text;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  m1 := $q$if not private.qual_ok(ev_slug, cap, p ->> 'budget_confirmed')$q$;
  m2 := $q$private.cand_route(ev_slug, cap, p ->> 'situation', p ->> 'src', ck)$q$;
  if position(m1 in d) = 0 or position(m2 in d) = 0 then raise exception 'motif introuvable'; end if;
  d := replace(replace(d, m1, $q$if not private.can_book(ev_slug, cap, p ->> 'budget_confirmed', p ->> 'situation', p ->> 'invest', p ->> 'src')$q$),
    m2, $q$private.cand_route(ev_slug, cap, p ->> 'situation', p ->> 'src', ck, p ->> 'invest', p ->> 'budget_confirmed')$q$);
  execute d;
end $do$;
