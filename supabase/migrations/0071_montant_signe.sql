-- 0071 : montant auquel l'appel a été closé (en euros), à renseigner quand le résultat est « Signé ».
alter table public.candidatures add column if not exists signed_amount numeric(10, 2) check (signed_amount is null or signed_amount >= 0);
