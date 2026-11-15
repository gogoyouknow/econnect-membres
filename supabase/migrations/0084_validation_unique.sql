-- 0084 : validation des emails automatiques UNE SEULE FOIS par email (plus jour par jour) + notification UNE SEULE FOIS (push, sans email).
-- • Valider un email = valable pour toutes les personnes et pour toujours (marqueur day = 2999-12-31 dans mail_ok), tant que son texte ne change pas.
-- • Si l'objet ou le texte change, la validation tombe : il faut le valider de nouveau (et tu es prévenu une fois).
-- • Plus d'email envoyé à Clément pour ça : une notification push, une par email (pas une par personne).

create table if not exists public.mail_step_notif (
  step_id int primary key references public.mail_steps (id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.mail_step_notif enable row level security;
drop policy if exists "mail_step_notif: équipe" on public.mail_step_notif;
create policy "mail_step_notif: équipe" on public.mail_step_notif for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function private.mail_step_ok(sid int, d date) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.mail_ok k where k.step_id = sid and (k.day = d or k.day = date '2999-12-31'))
$$;

-- Modifier le texte d'un email retire sa validation et relance une notification.
create or replace function private.mail_step_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.subject_a is distinct from old.subject_a or new.subject_b is distinct from old.subject_b or new.body is distinct from old.body then
    delete from public.mail_ok where step_id = new.id;
    delete from public.mail_step_notif where step_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists mail_step_edit_trg on public.mail_steps;
create trigger mail_step_edit_trg after update on public.mail_steps for each row execute function private.mail_step_edit();

-- Notification : push seulement (plus d'email).
create or replace function private.mail_tell_me(title text, body_html text, push_body text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.notify_calio(title, push_body, '/admin');
exception when others then null;
end $$;

-- Rappel de validation : une seule notification par email non validé (prévu dans les 3 prochains jours).
create or replace function public.mail_remind() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.mail_settings; r record; tot int := 0; today date := (now() at time zone 'Europe/Paris')::date;
begin
  select * into s from public.mail_settings where id = 1;
  if s.mode = 'validation' then
    for r in select t.id, t.label from public.mail_steps t
              where t.active and exists (select 1 from public.mail_out q where q.step_id = t.id and q.status = 'attente' and q.due_at < now() + interval '3 days')
                and not private.mail_step_ok(t.id, today) and not private.mail_step_ok(t.id, today + 1)
                and not exists (select 1 from public.mail_step_notif n where n.step_id = t.id)
              order by t.id loop
      insert into public.mail_step_notif (step_id) values (r.id) on conflict do nothing;
      perform private.mail_tell_me('À valider : ' || r.label, '', 'À valider (une seule fois) : ' || r.label);
      tot := tot + 1;
    end loop;
  end if;
  if now() >= s.control_until and s.mode = 'validation' and extract(hour from now() at time zone 'Europe/Paris')::int = 10 and not exists (select 1 from public.mail_remind_sent where day = today and slot = 'fin') then
    insert into public.mail_remind_sent (day, slot) values (today, 'fin') on conflict do nothing;
    perform private.mail_tell_me('30 jours de validation terminés', '', 'Période de validation terminée : passer en automatique ?');
  end if;
  return tot;
end $$;
revoke all on function public.mail_remind() from public, anon, authenticated;

-- Moteur d'envoi et ronde horaire : on adapte les fonctions existantes (la règle « validé » devient « validé une fois pour toutes »,
-- et une seule notification par email au lieu d'une par personne).
do $$
declare d text;
begin
  select pg_get_functiondef('public.mail_tick()'::regprocedure) into d;
  d := replace(d, 'not exists (select 1 from public.mail_ok k where k.step_id = o.step_id and k.day = (o.due_at at time zone ''Europe/Paris'')::date)', 'not private.mail_step_ok(o.step_id, (o.due_at at time zone ''Europe/Paris'')::date)');
  d := replace(d, 'if not o.notified then', 'insert into public.mail_step_notif (step_id) values (o.step_id) on conflict do nothing;' || chr(10) || '        if found then');
  execute d;
  select pg_get_functiondef('private.health_run()'::regprocedure) into d;
  d := replace(d, 'exists (select 1 from public.mail_ok o where o.step_id = m.step_id and o.day = (m.due_at at time zone ''Europe/Paris'')::date)', 'private.mail_step_ok(m.step_id, (m.due_at at time zone ''Europe/Paris'')::date)');
  execute d;
end $$;
