# Règles du dépôt econnect-membres (Calio + app L'Accélérateur)

## Clés secrètes : jamais dans le dépôt (règle absolue)
Ce dépôt est lisible par des tiers. Aucune de ces valeurs ne doit être écrite dans un fichier suivi par git, ni dans un message de commit :
clé API Bunny, clé d'import, clé secrète Stripe (sk_live_…), jeton Hotmart, clé service_role Supabase, jeton d'accès Supabase (SUPABASE_PAT), identifiants Google/Resend, mots de passe.
- Les valeurs vont dans les secrets (Supabase `private.secrets`, variables Vercel, GitHub Secrets). Le fichier local `videos/keys.json` est ignoré par git : on ne le force jamais (`git add -f`).
- Avant CHAQUE commit : `git diff --cached --stat` puis `bash scripts/check-secrets.sh` (le hook `.githooks/pre-commit` le fait aussi : `git config core.hooksPath .githooks`). Pas de `git add -A` sans relire la liste des fichiers.
- Si une vraie clé a quand même été publiée : la changer immédiatement chez le fournisseur, puis prévenir Clément. La retirer du code ne suffit pas, l'historique reste lisible.
- GitHub envoie à chaque push `secrets-check.yml` : s'il échoue, on corrige avant toute autre chose.
- Les clés publiques par conception (clé « anon » / publishable de Supabase) ne sont pas des secrets, mais on évite de les disperser.
