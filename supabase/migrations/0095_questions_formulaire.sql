-- 0095 : « Questions du formulaire » par événement.
-- Pour chaque événement on règle :
--   · après le choix du montant (« Combien peux-tu investir ? ») : selon la réponse à la question suivante ('ask'), calendrier quelle que soit la réponse ('slot'),
--     ou page Méthode quelle que soit la réponse ('block') ;
--   · après la réponse à « Tu peux vraiment mobiliser ce budget maintenant ? » (oui / pas encore / non) : calendrier ('slot'), date de rappel ('when'),
--     message « reviens plus tard » ('block2') ou page Méthode ('block') ;
--   · les textes des deux questions et de leurs réponses.
-- Sans réglage enregistré (qual null), le comportement est EXACTEMENT celui d'avant (y compris l'exception « moins de 500 € »).
alter table public.cand_events add column if not exists qual jsonb;

-- Réglage effectif d'un événement : le réglage par défaut (celui d'avant) complété par ce qui est enregistré.
create or replace function private.qual_of(e public.cand_events) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lt boolean; base_cap jsonb; base_have jsonb; s jsonb := coalesce(e.qual, '{}'::jsonb);
begin
  lt := exists (select 1 from jsonb_array_elements(coalesce(e.rules, '[]'::jsonb)) r
                  join public.cand_closers c on c.key = r ->> 'closer' and c.active
                 where jsonb_exists(coalesce(r -> 'capital', '[]'::jsonb), 'lt500'));
  base_cap := jsonb_build_object('lt500', case when lt then 'slot' else 'block' end,
                                 '500-1000', case when lt then 'slot' else 'ask' end,
                                 '1000-3000', case when lt then 'slot' else 'ask' end,
                                 'gt3000', case when lt then 'slot' else 'ask' end);
  base_have := jsonb_build_object('yes', 'slot', 'soon', 'when', 'no', 'block2');
  return jsonb_build_object('cap', base_cap || coalesce(s -> 'cap', '{}'::jsonb),
                            'have', base_have || coalesce(s -> 'have', '{}'::jsonb),
                            'q', coalesce(s -> 'q', '{}'::jsonb),
                            'custom', e.qual is not null);
end $$;

-- Cette personne (montant + réponse) a-t-elle le droit de réserver sur cet événement ?
create or replace function private.qual_ok(p_slug text, p_cap text, p_have text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e public.cand_events; q jsonb; a text;
begin
  if coalesce(p_cap, '') not in ('lt500', '500-1000', '1000-3000', 'gt3000') then return false; end if;
  select * into e from public.cand_events
   where active and ((nullif(trim(p_slug), '') is not null and slug = lower(trim(p_slug))) or (nullif(trim(p_slug), '') is null and main)) limit 1;
  if not found then return p_cap <> 'lt500' and coalesce(p_have, '') = 'yes'; end if;
  q := private.qual_of(e);
  a := coalesce(q -> 'cap' ->> p_cap, 'ask');
  if a = 'slot' then return true; end if;
  if a = 'block' then return false; end if;
  return coalesce(q -> 'have' ->> coalesce(p_have, ''), 'block2') = 'slot';
end $$;

-- Ce que la page de réservation reçoit : l'ancien indicateur lt500 (pour les pages déjà ouvertes) + le réglage des questions.
create or replace function public.cand_event_info(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', e.name, 'source', e.source,
    'lt500', exists (select 1 from jsonb_array_elements(coalesce(e.rules, '[]'::jsonb)) r
                       join public.cand_closers c on c.key = r ->> 'closer' and c.active
                      where jsonb_exists(coalesce(r -> 'capital', '[]'::jsonb), 'lt500')),
    'qual', private.qual_of(e))
    from public.cand_events e
   where e.active and ((nullif(trim(p_slug), '') is not null and e.slug = lower(trim(p_slug))) or (nullif(trim(p_slug), '') is null and e.main))
   limit 1
$$;
grant execute on function public.cand_event_info(text) to anon, authenticated;

-- La réservation côté serveur suit le même réglage que la page (le lien d'invitation personnel reste accepté, cf. 0088).
do $do$ declare d text; m1 text; m2 text;
begin
  select pg_get_functiondef('public.cand_book(jsonb)'::regprocedure) into d;
  m1 := $q$if not (cap in ('500-1000', '1000-3000', 'gt3000') and coalesce(p ->> 'budget_confirmed', '') = 'yes')$q$;
  m2 := $q$and not coalesce((public.cand_event_info(ev_slug) ->> 'lt500')::boolean, false)$q$;
  if position(m1 in d) = 0 or position(m2 in d) = 0 then raise exception 'motif introuvable'; end if;
  d := replace(replace(d, m1, $q$if not private.qual_ok(ev_slug, cap, p ->> 'budget_confirmed')$q$), m2, '');
  execute d;
end $do$;
