-- 0003 : prénom / nom / photo à la première connexion
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists onboarded boolean not null default false;
-- les comptes déjà créés n'ont pas à repasser par l'écran d'accueil
update public.profiles set onboarded = true where onboarded = false;
-- garder "name" synchronisé (c'est ce qui s'affiche partout)
create or replace function public.sync_profile_name() returns trigger language plpgsql as $$
begin
  if new.first_name is not null and new.first_name <> '' then
    new.name := trim(new.first_name || ' ' || coalesce(new.last_name, ''));
  end if;
  return new;
end $$;
drop trigger if exists profiles_sync_name on public.profiles;
create trigger profiles_sync_name before insert or update on public.profiles for each row execute function public.sync_profile_name();
