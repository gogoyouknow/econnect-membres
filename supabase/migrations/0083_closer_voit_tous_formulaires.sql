-- 0083 : un closer voit TOUS les formulaires (qualifiés, disqualifiés, incomplets), pas seulement ceux de ses rendez-vous.
-- Lecture seule : il ne peut ni modifier ni supprimer une fiche.
drop policy if exists "cand_leads: closer lit" on public.cand_leads;
create policy "cand_leads: closer lit" on public.cand_leads for select to authenticated using (public.is_closer());
