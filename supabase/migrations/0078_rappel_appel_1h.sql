-- 0078 : notification sur le téléphone 1 heure avant chaque appel (Clément, ou le closer concerné).
-- Passe toutes les 5 minutes ; un appel n'est notifié qu'une fois. Un appel réservé moins d'1 h à l'avance n'est pas notifié (inutile).
-- La synchro avec Google Agenda existe déjà (0064) : chaque réservation / déplacement / annulation est répercutée dans l'agenda.

alter table public.candidatures add column if not exists push_1h_at timestamptz;

create or replace function private.calio_rappel_1h() returns int
language plpgsql security definer set search_path = public, private as $$
declare c record; n int := 0;
begin
  for c in
    select id, first_name, starts_at, closer, status, created_at from public.candidatures
     where push_1h_at is null and status in ('reserve', 'confirme')
       and starts_at > now() and starts_at <= now() + interval '60 minutes'
     limit 30
  loop
    update public.candidatures set push_1h_at = now() where id = c.id;
    if c.created_at < c.starts_at - interval '55 minutes' then
      perform private.notify_calio('Appel dans 1 h',
        coalesce(nullif(c.first_name, ''), 'Un prospect') || ' · ' || to_char(c.starts_at at time zone 'Europe/Paris', 'HH24"h"MI')
        || case when c.status = 'reserve' then ' · pas encore confirmé' else '' end,
        '/admin', c.closer);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.calio_rappel_1h() from public, anon, authenticated;

-- un appel déplacé doit pouvoir être rappelé de nouveau
create or replace function private.calio_rappel_reset() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.starts_at is distinct from old.starts_at then new.push_1h_at := null; end if;
  return new;
end $$;
drop trigger if exists calio_rappel_reset_trg on public.candidatures;
create trigger calio_rappel_reset_trg before update of starts_at on public.candidatures for each row execute function private.calio_rappel_reset();

do $$ begin perform cron.unschedule('calio-rappel-1h'); exception when others then null; end $$;
select cron.schedule('calio-rappel-1h', '*/5 * * * *', 'select private.calio_rappel_1h()');
