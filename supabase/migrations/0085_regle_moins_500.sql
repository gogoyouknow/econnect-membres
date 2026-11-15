-- 0085 : exception « moins de 500 € ». Une règle de l'événement qui cible explicitement « Moins de 500 € » ouvre le calendrier à ces personnes
-- (au lieu de la page Méthode à 97 €) et leur appel est attribué selon la règle (ex. Amandine). Sans la règle, rien ne change.
-- Une règle sans budget coché (= tous les budgets) n'ouvre PAS cette exception : il faut cocher « Moins de 500 € ».
create or replace function public.cand_event_info(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', e.name, 'source', e.source,
    'lt500', exists (select 1 from jsonb_array_elements(coalesce(e.rules, '[]'::jsonb)) r
                       join public.cand_closers c on c.key = r ->> 'closer' and c.active
                      where jsonb_exists(coalesce(r -> 'capital', '[]'::jsonb), 'lt500')))
    from public.cand_events e
   where e.active and ((nullif(trim(p_slug), '') is not null and e.slug = lower(trim(p_slug))) or (nullif(trim(p_slug), '') is null and e.main))
   limit 1
$$;
grant execute on function public.cand_event_info(text) to anon, authenticated;
