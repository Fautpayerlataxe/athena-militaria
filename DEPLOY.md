# Guide de déploiement - Athena Militaria

---

## 0. Déploiement du durcissement Stripe (août 2026)

**L'ordre compte.** La migration doit passer avant les fonctions edge, sinon
`create-checkout` appelle des fonctions SQL qui n'existent pas encore.

> ### Avant tout : ce qui tourne aujourd'hui n'est pas ce dépôt
>
> Le code déployé en production a été comparé au dépôt le 13 août 2026. Les
> fonctions `create-checkout` et `stripe-webhook` en production sont d'une
> génération antérieure et **différente** :
>
> | | Production actuelle | Ce dépôt |
> |---|---|---|
> | Stripe Connect | absent : tout arrive sur le compte plateforme | compte connecté par vendeur |
> | Frais | « Protection Acheteur » payée par l'acheteur (5 %, minimum 0,99 €) | commission de 8 % prélevée sur le vendeur |
> | Versement au vendeur | manuel, hors Stripe | automatique après réception |
> | Adresse de livraison | jamais collectée | collectée par Stripe Checkout |
> | Réservation de stock | aucune | verrou transactionnel |
>
> Déployer ce dépôt **change donc le modèle de frais**. Ce n'est pas une
> décision technique : voir la section « Recommandation » du rapport d'audit.

### 0.1 Migration SQL

Dashboard Supabase → SQL Editor → coller l'intégralité de
`supabase/migrations/20260813000000_stripe_hardening.sql` → **Run**.

Elle est rejouable : chaque objet est créé avec `IF NOT EXISTS` ou
`CREATE OR REPLACE`. Elle répare aussi les données existantes (articles payés
restés `published` faute d'avoir pu écrire `quantity = 0`).

Vérifications après exécution :

```sql
-- Doit renvoyer 0 : plus aucun article payé encore en vente
SELECT count(*) FROM orders o JOIN products p ON p.id = o.product_id
 WHERE o.status IN ('paid','shipped','delivered','completed') AND p.status = 'published';

-- Doit renvoyer les trois tarifs
SELECT * FROM shipping_rates;

-- Doit lister la tâche de libération des réservations
SELECT jobname, schedule FROM cron.job WHERE jobname = 'checkout-expire-stale';
```

### 0.2 Fonctions edge

Dashboard Supabase → Edge Functions. Trois fonctions à publier, plus une
nouvelle. Chacune importe `supabase/functions/_shared/payments.ts` et
`fulfillment.ts` : ces deux fichiers doivent accompagner le déploiement.

| Fonction | JWT | Rôle |
|---|---|---|
| `create-checkout` | vérifié | réserve le stock puis ouvre la session Stripe |
| `stripe-webhook` | **non vérifié** | authentifié par la signature Stripe |
| `checkout-status` | vérifié | vérifie une commande depuis la page de confirmation |
| `connect-onboard` | vérifié | inchangé sauf clé d'idempotence et CORS |
| `order-notify` | vérifié | inchangé sauf contrôle d'état et CORS |

### 0.3 Événements webhook à écouter

Dashboard Stripe → Webhooks → l'endpoint
`https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/stripe-webhook` →
**Select events**. L'endpoint n'écoutait que `checkout.session.completed` :
remboursements, litiges et sessions expirées passaient inaperçus.

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
payment_intent.payment_failed
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
account.updated
```

### 0.4 Site statique

```bash
./deploy-ovh.sh
```

### 0.5 Tests

Tout, y compris un vrai PostgreSQL 17 téléchargé et démarré automatiquement :

```bash
npm test
```

Les parcours Stripe réels, dès qu'une clé de test est disponible :

```bash
STRIPE_TEST_SECRET_KEY=sk_test_votre_cle npm run test:stripe
```

Sans clé, cette suite s'ignore au lieu de réussir : elle ne peut donc jamais
donner une fausse impression de couverture.

### 0.6 Fonctions planifiées supplémentaires

| Fonction | JWT | Déclenchement | Rôle |
|---|---|---|---|
| `payout-release` | non | cron horaire | verse les vendeurs après réception |
| `payments-monitor` | non | cron toutes les 6 h | réconcilie Stripe et la base, alerte |

Ces deux fonctions sont protégées par l'en-tête `x-cron-secret`, comparé au
secret `CRON_SECRET` déjà présent. La tâche planifiée le lit via
`current_setting('app.cron_secret')` : il faut donc l'enregistrer une fois dans
la base, en SQL Editor :

```sql
ALTER DATABASE postgres SET app.cron_secret = 'valeur_de_CRON_SECRET';
```

Sans cela, les deux fonctions répondront 401 et ne feront rien : aucun
versement automatique, aucune alerte.

---

## 1. Pré-requis

- [Supabase CLI](https://supabase.com/docs/guides/cli) installé
- Compte [Stripe](https://stripe.com) avec clé secrète
- Projet Supabase lié (`supabase link --project-ref uctaxgfqdoxtcidllyjv`)

## 2. Base de données

Exécuter la migration pour créer la table `orders` :

```bash
supabase db push
```

Ou manuellement dans le SQL Editor de Supabase Dashboard, copier le contenu de `supabase/migrations/20260413_create_orders.sql`.

## 3. Secrets Supabase

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

## 4. Déployer les Edge Functions

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

## 5. Configurer le webhook Stripe

Dans le [Dashboard Stripe](https://dashboard.stripe.com/webhooks) :

1. Cliquer **Ajouter un endpoint**
2. URL : `https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/stripe-webhook`
3. Événements à écouter : `checkout.session.completed`
4. Copier le **Signing secret** (`whsec_...`) et le mettre dans les secrets Supabase (étape 3)

## 6. Configurer OAuth (Google, Apple, Facebook)

Dans le [Dashboard Supabase](https://supabase.com/dashboard) > Authentication > Providers :

### Google
1. Créer un projet sur [Google Cloud Console](https://console.cloud.google.com)
2. Activer l'API Google Identity
3. Créer des identifiants OAuth 2.0 (URI de redirection : `https://uctaxgfqdoxtcidllyjv.supabase.co/auth/v1/callback`)
4. Copier Client ID et Client Secret dans Supabase

### Facebook
1. Créer une app sur [Meta for Developers](https://developers.facebook.com)
2. Ajouter le produit "Facebook Login"
3. URI de redirection : `https://uctaxgfqdoxtcidllyjv.supabase.co/auth/v1/callback`
4. Copier App ID et App Secret dans Supabase

### Apple
1. Configurer Sign in with Apple dans [Apple Developer](https://developer.apple.com)
2. Créer un Service ID avec le redirect URI : `https://uctaxgfqdoxtcidllyjv.supabase.co/auth/v1/callback`
3. Copier les identifiants dans Supabase

## 7. Storage (images produits)

Vérifier que le bucket `product-images` existe dans Supabase Storage avec accès public activé.

## 8. Hébergement du frontend

Le frontend est statique (HTML/CSS/JS). Options :
- **Netlify** : glisser-déposer le dossier
- **Vercel** : `vercel deploy`
- **GitHub Pages** : push sur une branche `gh-pages`
