-- 0002 : seul un admin peut changer rôle / groupe / accès. Un modérateur ne touche qu'à la sourdine et à l'avancement des membres.
create or replace function public.guard_profile_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  -- personne d'autre qu'un admin ne modifie ces champs
  if new.role is distinct from old.role or new.tier is distinct from old.tier or new.active is distinct from old.active or new.email is distinct from old.email then
    raise exception 'Seul un admin peut modifier le rôle, le groupe ou l''accès';
  end if;
  -- un modérateur ne peut pas agir sur un admin ni sur un autre modérateur
  if public.is_staff() and old.id <> auth.uid() and old.role <> 'member' then
    raise exception 'Un modérateur ne peut pas modifier un membre de l''équipe';
  end if;
  -- un membre ne modifie que son propre profil (déjà garanti par RLS), jamais sa sourdine
  if not public.is_staff() and new.muted_until is distinct from old.muted_until then
    raise exception 'Tu ne peux pas lever ta propre sourdine';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_update();

-- la liste blanche et les réglages sensibles restent admin-only (déjà le cas pour allowed_emails) ; les mods gardent les règles du chat.
-- empêcher la suppression d'un compte admin par un mod via auth : rien à faire côté SQL (pas de policy delete sur profiles).
