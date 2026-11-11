-- 0057 : relances automatiques uniquement pour les prospects qualifiés (budget renseigné : 500 € ou plus, pas « bientôt / non »).
create or replace function public.cand_relance_auto() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; l record; tpl text; sub text; n int := 0; wa text; creneaux text; txt text; h int;
begin
  select * into s from public.cand_settings where id = 1;
  if not s.auto_relance then return 0; end if;
  h := private.relance_hour();
  select body into tpl from public.cand_templates where key = 'mail_relance';
  select body into sub from public.cand_templates where key = 'mail_relance_sujet';
  if tpl is null then return 0; end if;
  creneaux := private.relance_creneaux();
  for l in
    select * from public.cand_leads x
     where not x.booked and x.auto_sent_at is null and x.follow = 'new' and coalesce(x.email, '') <> ''
       and x.sid !~ '^(imp|man|cand)-'
       and x.updated_at <= now() - make_interval(mins => s.auto_relance_min)
       and x.updated_at > now() - interval '30 days'
       and (h >= 8 and h < 21 or x.updated_at > now() - interval '3 hours')
       and coalesce(x.capital, '') in ('500-1000', '1000-3000', 'gt3000') and coalesce(x.budget_confirmed, '') not in ('soon', 'no')
       and x.budget_date is null
       and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme', 'fait') and lower(c.email) = lower(x.email))
     order by x.updated_at limit 20
  loop
    wa := 'https://wa.me/' || s.wa_number || '?text=' || private.urlenc('Salut Clément, c''est ' || coalesce(l.first_name, '') || '. J''ai commencé à réserver un appel et j''aimerais en discuter.');
    txt := private.relance_fill(tpl, l.first_name, creneaux, wa);
    sub := replace(coalesce((select body from public.cand_templates where key = 'mail_relance_sujet'), '{prenom}, il reste des créneaux pour ton appel'), '{prenom}', coalesce(nullif(l.first_name, ''), 'Hello'));
    perform private.send_email(l.email, sub, '<div style="font-size:15px;line-height:1.55;color:#222">' || txt || '</div>', 'Clément');
    update public.cand_leads set auto_sent_at = now(), followed_at = now(), follow_count = follow_count + 1, follow = 'done', follow_channel = 'email-auto',
      mail_log = mail_log || jsonb_build_array(jsonb_build_object('k', 'auto', 'label', 'Premier email', 'subject', sub, 'at', now()))
     where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_relance_auto() from public, anon, authenticated;

create or replace function public.cand_rseq_run() returns int
language plpgsql security definer set search_path = public, private as $$
declare s public.cand_settings; l record; st public.cand_rseq; n int := 0; cr text; wa text; h int; txt text; sub text; last_at timestamptz;
begin
  select * into s from public.cand_settings where id = 1;
  if not s.auto_relance then return 0; end if;
  h := private.relance_hour();
  if h < 8 or h >= 21 then return 0; end if;
  cr := private.relance_creneaux();
  for l in
    select * from public.cand_leads x
     where not x.booked and x.auto_sent_at is not null and x.follow <> 'skip' and coalesce(x.follow_result, '') not in ('repondu', 'pas_interesse', 'reserve')
       and x.budget_date is null and coalesce(x.email, '') <> ''
       and coalesce(x.capital, '') in ('500-1000', '1000-3000', 'gt3000') and coalesce(x.budget_confirmed, '') not in ('soon', 'no')
       and not exists (select 1 from public.candidatures c where c.status in ('reserve', 'confirme', 'fait') and lower(c.email) = lower(x.email))
     order by x.auto_sent_at limit 40
  loop
    select * into st from public.cand_rseq r where r.active and not (r.id = any (l.rseq_sent)) order by r.pos limit 1;
    continue when not found;
    continue when l.auto_sent_at + make_interval(hours => st.after_hours) > now();
    last_at := coalesce((l.mail_log -> -1 ->> 'at')::timestamptz, l.auto_sent_at);
    continue when last_at > now() - interval '20 hours';
    wa := 'https://wa.me/' || s.wa_number || '?text=' || private.urlenc('Salut Clément, c''est ' || coalesce(l.first_name, '') || '. J''aimerais en discuter.');
    txt := private.relance_fill(st.body, l.first_name, cr, wa);
    sub := replace(st.subject, '{prenom}', coalesce(nullif(l.first_name, ''), 'Hello'));
    perform private.send_email(l.email, sub, '<div style="font-size:15px;line-height:1.55;color:#222">' || txt || '</div>', 'Clément');
    update public.cand_leads set rseq_sent = array_append(rseq_sent, st.id), followed_at = now(), follow_count = follow_count + 1, follow = 'done', follow_channel = 'email-auto',
      mail_log = mail_log || jsonb_build_array(jsonb_build_object('k', 'rseq', 'label', st.label, 'subject', sub, 'at', now()))
     where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cand_rseq_run() from public, anon, authenticated;

