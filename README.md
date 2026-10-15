# Groupe E-Connect — app communauté

PWA (React + Vite) + Supabase. Déployée sur Vercel.

## Mise en place
1. Supabase → SQL Editor → coller `supabase/migrations/0001_init.sql` → Run.
2. Supabase → Authentication → Providers → Email : laisser activé. (Désactiver "Confirm email" pour simplifier la première connexion, ou configurer un SMTP custom.)
3. Vercel → Settings → Environment Variables :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Redéployer. Premier compte créé = admin (contact@theambitiousman.fr est pré-autorisé).

## Dev local
```
cp .env.example .env   # remplir
npm install && npm run dev
```
