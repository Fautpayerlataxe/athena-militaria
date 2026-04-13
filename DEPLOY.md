# Guide de déploiement - Athena Militaria

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
