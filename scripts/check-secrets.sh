#!/usr/bin/env bash
# Bloque tout ce qui ressemble à une clé secrète ou à un fichier de clés.
# Usage : scripts/check-secrets.sh            → vérifie ce qui est prêt à être commité (git add)
#         scripts/check-secrets.sh --all      → vérifie tous les fichiers suivis par git (utilisé par GitHub à chaque envoi)
set -u
cd "$(git rev-parse --show-toplevel)"
bad=0

if [ "${1:-}" = "--all" ]; then
  files=$(git ls-files)
  added() { git ls-files -z | xargs -0 grep -InE "$1" 2>/dev/null; }
else
  files=$(git diff --cached --name-only --diff-filter=ACMR)
  added() { git diff --cached -U0 | grep -E '^\+[^+]' | grep -nE "$1"; }
fi

# 1. Noms de fichiers interdits (clés, certificats, variables d'environnement réelles)
for f in $files; do
  case "$f" in
    *.env.example|*.env.sample) ;;
    *.env|*/.env|.env.*|*/.env.*|*.pem|*.p12|*.key|*keys.json|*credentials*.json|*service-account*.json|*secrets*.json)
      echo "BLOQUÉ : le fichier « $f » ressemble à un fichier de clés. Il ne doit jamais être dans le dépôt (ajoute-le à .gitignore)."; bad=1 ;;
  esac
done

# 2. Contenus qui ressemblent à des clés secrètes
PATTERN='(sk_live_|rk_live_|whsec_|sbp_|ghp_|github_pat_|xox[bp]-)[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|re_[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9._-]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"?[A-Za-z_]*(api_?key|secret|password|passwd|token|hottok|import_key|service_role)"?[ ]*[:=][ ]*["'"'"'][A-Za-z0-9._/+=-]{20,}["'"'"']'
hits=$(added "$PATTERN" | grep -vE 'placeholder|exemple|example|HOTTOK_ICI|process\.env|Deno\.env|import\.meta\.env|your_|xxxx|\.\.\.' || true)
if [ -n "$hits" ]; then
  echo "BLOQUÉ : une clé secrète semble écrite dans le code :"
  echo "$hits" | sed -E 's/(["'"'"'])([A-Za-z0-9._\/+=-]{6})[A-Za-z0-9._\/+=-]{8,}/\1\2…(masqué)/g' | head -10
  bad=1
fi

if [ "$bad" = 1 ]; then
  echo "→ Mets la valeur dans un secret (Supabase, Vercel ou GitHub Secrets), jamais dans le code. Si une vraie clé a fuité, change-la tout de suite chez le fournisseur."
  exit 1
fi
echo "Aucune clé secrète détectée."
