-- 0104 : la synchro des agendas passe de toutes les 10 minutes à toutes les 3 minutes.
-- Constaté : un créneau bloqué dans Google Agenda restait affiché libre jusqu'à 10 minutes (la page de réservation et les Dispos lisaient l'ancienne copie).
select cron.alter_job((select jobid from cron.job where jobname = 'gcal-sync'), schedule := '*/3 * * * *');
