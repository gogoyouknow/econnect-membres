-- 0041 : messages modèles modifiables depuis l'app (message WhatsApp envoyé avec le lien de la page « Découvre »).

create table if not exists public.cand_templates (
  key text primary key,
  body text not null,
  updated_at timestamptz not null default now()
);
alter table public.cand_templates enable row level security;
drop policy if exists "cand_templates: équipe" on public.cand_templates;
create policy "cand_templates: équipe" on public.cand_templates for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.cand_templates (key, body) values
  ('wa_confirm', E'Salut {prenom}, c''est Clément 👋\nC''est bien noté pour notre appel {jour} à {heure}.\nAvant qu''on se parle, regarde cette page : tu y trouveras comment j''accompagne mes élèves, leurs témoignages et les réponses aux questions qu''on me pose le plus : {lien}\nRéponds-moi juste « OK » pour confirmer que tu seras là.')
on conflict (key) do nothing;
