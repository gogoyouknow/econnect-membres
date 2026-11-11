-- Le lien de la bio TikTok, c'est rdv.theambitiousman.fr = l'événement principal : on le nomme ainsi, et on retire l'événement « APPEL Diagnostic (BIO) » ajouté par erreur.
delete from public.cand_events where main = false and slug = 'appel-tiktok-bio';
update public.cand_events set name = 'Lien en bio TikTok', source = coalesce(source, 'TikTok'), notes = coalesce(notes, 'rdv.theambitiousman.fr : le lien de la bio du compte TikTok'), updated_at = now() where main;
