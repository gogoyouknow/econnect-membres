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

## Espaces et accès (Méthode E-Connect / L'Accélérateur)

L'app a deux espaces, choisis en haut à gauche. Chaque membre ne voit que ce qu'il a payé :

- `profiles.methode` : la formation Méthode E-Connect (modules marqués « Inclus dans la Méthode »).
- `profiles.accel` : L'Accélérateur (chat, fil, lives, membres, tous les modules). Vrai par défaut, comme avant.

### Paiement Stripe → accès automatique

1. Stripe → Développeurs → Webhooks → Ajouter un endpoint :
   `https://<projet>.supabase.co/functions/v1/stripe-webhook`.
   Événements : `checkout.session.completed`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`.
2. Copier le secret de signature (`whsec_…`) dans l'app : Administration → Paiements Stripe.
3. Les liens de paiement reconnus sont dans la table `stripe_offers` (97 € → Méthode, 257 € → Méthode + Accélérateur).
   Journal : table `stripe_events` (visible dans Administration).

Fin d'abonnement → l'espace Accélérateur se ferme, la formation reste ouverte. Remboursement de la Méthode → accès en pause.
