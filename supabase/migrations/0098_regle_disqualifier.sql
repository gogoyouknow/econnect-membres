-- 0098 : une règle peut DISQUALIFIER (au lieu d'attribuer l'appel à un closer) : closer = '__dq', dq_page = 'methode' | 'plus_tard'.
-- L'ordre des règles compte : la 1re règle qui correspond gagne (closer ou disqualification). Une personne disqualifiée ne peut pas réserver.
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
    continue when k <> '__dq' and not exists (select 1 from public.cand_closers where key = k and active);
    if private.rule_hit(r, p_cap, p_sit, p_src, p_inv, p_have) then
      o_closer := k; o_why := case when k = '__dq' then 'Règle ' || n || ' : disqualifié' else 'Règle ' || n end; return;
    end if;
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

create or replace function public.cand_route_test(p_event bigint, p_cap text, p_sit text, p_src text, p_inv text default null, p_have text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare slug text; r record; nm text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin.'; end if;
  select e.slug into slug from public.cand_events e where e.id = p_event;
  select * into r from private.cand_route(slug, p_cap, p_sit, p_src, '', p_inv, p_have);
  select name into nm from public.cand_closers where key = r.o_closer;
  if r.o_closer = '__dq' then nm := 'Disqualifié (pas d''appel)'; end if;
  return jsonb_build_object('closer', r.o_closer, 'name', nm, 'why', r.o_why);
end $$;
grant execute on function public.cand_route_test(bigint, text, text, text, text, text) to authenticated;

-- La 1re règle qui correspond à ce profil est-elle une disqualification ? Si oui, quelle page voit la personne ?
create or replace function private.dq_page(p_slug text, p_cap text, p_have text, p_sit text, p_inv text, p_src text) returns text
language plpgsql stable security definer set search_path = public, private as $$
declare ev public.cand_events; r jsonb; k text;
begin
  select * into ev from public.cand_events
   where active and ((nullif(trim(p_slug), '') is not null and slug = lower(trim(p_slug))) or (nullif(trim(p_slug), '') is null and main)) limit 1;
  if not found then return null; end if;
  for r in select value from jsonb_array_elements(coalesce(ev.rules, '[]'::jsonb)) loop
    k := r ->> 'closer';
    continue when k <> '__dq' and not exists (select 1 from public.cand_closers where key = k and active);
    if private.rule_hit(r, p_cap, p_sit, p_src, p_inv, p_have) then
      if k = '__dq' then return case when r ->> 'dq_page' = 'plus_tard' then 'plus_tard' else 'methode' end; end if;
      return null;
    end if;
  end loop;
  return null;
end $$;

create or replace function private.can_book(p_slug text, p_cap text, p_have text, p_sit text, p_inv text, p_src text) returns boolean
language plpgsql stable security definer set search_path = public, private as $$
declare ev public.cand_events; r jsonb;
begin
  if coalesce(p_cap, '') not in ('lt500', '500-1000', '1000-3000', 'gt3000') then return false; end if;
  -- une règle « disqualifier » qui correspond passe avant tout (si aucune règle de closer ne correspond avant elle)
  if private.dq_page(p_slug, p_cap, p_have, p_sit, p_inv, p_src) is not null then return false; end if;
  if p_cap <> 'lt500' and coalesce(p_have, '') = 'yes' then return true; end if;
  select * into ev from public.cand_events
   where active and ((nullif(trim(p_slug), '') is not null and slug = lower(trim(p_slug))) or (nullif(trim(p_slug), '') is null and main)) limit 1;
  if not found then return false; end if;
  if coalesce((public.cand_event_info(p_slug) ->> 'lt500')::boolean, false) then return true; end if;
  if p_cap = 'lt500' then return false; end if;
  for r in select value from jsonb_array_elements(coalesce(ev.rules, '[]'::jsonb)) loop
    continue when not exists (select 1 from public.cand_closers where key = r ->> 'closer' and active);
    continue when not jsonb_exists(coalesce(r -> 'have', '[]'::jsonb), coalesce(p_have, ''));
    if private.rule_hit(r, p_cap, p_sit, p_src, p_inv, p_have) then return true; end if;
  end loop;
  return false;
end $$;

-- Pour la page de réservation : peut-elle réserver ? sinon quelle page voit-elle (methode | plus_tard | null = comportement habituel).
create or replace function public.cand_can_book2(p jsonb) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'ok', private.can_book(p ->> 'event', p ->> 'capital', p ->> 'have', p ->> 'situation', p ->> 'invest', p ->> 'src'),
    'page', private.dq_page(p ->> 'event', p ->> 'capital', p ->> 'have', p ->> 'situation', p ->> 'invest', p ->> 'src'))
$$;
grant execute on function public.cand_can_book2(jsonb) to anon, authenticated;
