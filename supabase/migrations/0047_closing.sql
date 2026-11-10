-- Closing : résultat de chaque appel réalisé (signé / pas signé / il réfléchit) pour calculer le taux de closing.
alter table public.candidatures
  add column if not exists outcome text check (outcome in ('signe', 'perdu', 'reflechit')),
  add column if not exists outcome_at timestamptz;
create index if not exists candidatures_outcome_idx on public.candidatures (status, outcome);
