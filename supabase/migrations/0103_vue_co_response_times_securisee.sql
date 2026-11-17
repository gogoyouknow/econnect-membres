-- 0103 : la vue co_response_times (questions des élèves et temps de réponse) n'est plus lisible directement par l'API.
-- Alerte critique de Supabase : une vue lue avec les droits de son créateur contournait les protections des messages.
-- Seules les fonctions de suivi (co_tracking, co_watch, co_weekly, qui tournent avec leurs propres droits) s'en servent.
alter view public.co_response_times set (security_invoker = true);
revoke all on public.co_response_times from anon, authenticated;
