-- 0011 : verrouillage « 98 % visionné » pour passer à la leçon suivante
alter table public.settings
  add column if not exists require_watch boolean not null default true,
  add column if not exists watch_threshold int not null default 98;
alter table public.modules add column if not exists gate boolean not null default true;
alter table public.lesson_progress
  add column if not exists watched_pct int not null default 0,
  add column if not exists last_position int not null default 0,
  add column if not exists updated_at timestamptz default now();
alter table public.lesson_progress alter column done set default false;
