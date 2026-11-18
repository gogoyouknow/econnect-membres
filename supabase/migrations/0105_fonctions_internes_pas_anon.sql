-- 0105 : des fonctions internes (messagerie des élèves, administration de Calio, clés, relances) pouvaient être appelées par un visiteur non connecté.
-- Constaté lors du contrôle de sécurité du 18/11 : un appel anonyme à co_search, co_inbox ou co_next_action répondait au lieu d'être refusé.
-- Maintenant : seules les personnes connectées (et les fonctions serveur) peuvent les appeler. Les fonctions de la page publique de réservation ne changent pas.
do $do$ declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as f
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and p.proname = any(array[
         'co_search', 'co_reply_counts', 'co_next_action', 'co_inbox', 'co_my_threads', 'co_ensure_threads', 'co_unread', 'co_can_see', 'co_tracking',
         'my_dm', 'send_live_reminders', 'notify_live', 'book_slot', 'booking_slots',
         'cand_release', 'cand_route_test', 'cand_lead_booked',
         'call_review_poll', 'call_review_run', 'calio_ai_set_key', 'calio_ai_ready', 'stripe_secret_set',
         'closer_agenda_rattrapage', 'closer_cal_set', 'closer_cal_status', 'closer_invite', 'closer_remove', 'closer_set_day', 'closer_set_week',
         'block_add', 'block_remove'])
  loop
    execute format('revoke execute on function %s from public, anon', r.f);
    execute format('grant execute on function %s to authenticated, service_role', r.f);
    n := n + 1;
  end loop;
  raise notice '% fonction(s) fermée(s) aux visiteurs anonymes', n;
end $do$;
