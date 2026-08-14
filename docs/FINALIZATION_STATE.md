# État de finalisation

Fichier de reprise. Il doit permettre de continuer sans refaire l'audit.
Aucun secret ici, jamais.

Dernière mise à jour : 14 août 2026.

## Où en est le produit

| | |
|---|---|
| Frontend | déployé sur OVH, 70 fichiers, vérifié en navigateur |
| Base de données | 9 migrations appliquées, schéma aligné sur le dépôt |
| Fonctions edge | 9 déployées, dernière version du dépôt |
| Stripe | **mode production**, compte autorisé à encaisser et à verser |
| Webhooks | test et production : 10 événements chacun, aucun manquant |
| Achats | **ouverts** (`platform_settings.checkout_enabled = 1`) |
| Tâches planifiées | 6 actives, secret lu dans Vault |

## Comment fermer ou rouvrir les achats

```sql
UPDATE public.platform_settings SET value = 0 WHERE key = 'checkout_enabled';
```

Effet immédiat, sans redéploiement. `create-checkout` lit ce réglage avant
toute authentification et refuse s'il ne lit pas 1.

## Gates

| Gate | État | Preuve |
|---|---|---|
| Tests unitaires | PASS | 137/137, `npm run test:unit` |
| Base réelle | PASS | 112/112, `npm run test:db` |
| Stripe environnement de test | PASS | 28/28, `npm run test:stripe` |
| Navigateur | PASS | 17/17, `npm run test:browser`, 11 pages × 8 largeurs |
| Sécurité, base de production | PASS | 46 tentatives, 0 porte ouverte, `tests/helpers/attaque-production.mjs` |
| Fumée production | PASS | 18/18, `tests/helpers/smoke-production.mjs` |
| Machine à états du litige | PASS | 11 transitions, `tests/helpers/parcours-litige.mjs` |
| Un seul calcul de prix | PASS | `tests/helpers/un-seul-calcul.mjs` |

## Backlog

Source de vérité : `docs/backlog-audit.md`, 62 constats confirmés après
réfutation adverse, 24 écartés.

Fermés à ce jour : 29 (28 vérifiés, 1 réfuté avec preuve). Ouverts : 33,
**aucun bloquant**. Les 33 restants sont tous « notable » : accessibilité,
i18n, performance, textes.

Les 22 bloquants sont fermés depuis le commit 765c98e (bannissement,
modération, modale, avatars) ; les statuts A02/A09/A10/A11/A12 du tableau
ont été remis à jour le 14 août, ils étaient restés en retard sur les faits.

## Google Avis clients

| | |
|---|---|
| Compte Merchant Center | créé le 14 août 2026, identifiant 5838825955 |
| Site | validé et revendiqué (via Search Console) |
| Contrat | signé par l'exploitant |
| Fonction d'acceptation | posée sur `/order`, chargée seulement sur paiement confirmé |
| CSP | élargie pour `order.html` uniquement (apis.google.com, gstatic, google.com en iframe) |
| Données | fournies par `checkout-status` : commande, e-mail, pays, date estimée depuis `shipping_rates` |
| Politique de confidentialité | Google ajouté aux destinataires et à la section cookies, fr et en |

Reste : redéployer `checkout-status` (dashboard Supabase), remplir l'adresse
d'immatriculation dans Merchant Center (Paramètres → Infos sur l'entreprise),
puis attendre les premières commandes. Note de boutique à partir d'environ
100 avis sur 12 mois.

### Décision de l'exploitant à respecter

Le formulaire d'avis reste affiché aux personnes qui ne peuvent pas s'en
servir. La correction avait été préparée puis **annulée sur demande explicite**
le 14 août. Ne pas la réappliquer sans accord.

## Ce qui n'est pas vérifiable ici

| Sujet | Pourquoi |
|---|---|
| Réception réelle du courriel de réinitialisation | demande une boîte aux lettres ; le déclenchement et l'écran de saisie sont vérifiés |
| Achat réel avec une carte réelle | interdit par consigne ; le parcours est prouvé en environnement de test Stripe |
| Versement réel vers un vendeur | aucun vendeur n'a terminé son inscription Stripe Connect |
| Endpoint webhook de production sous charge | aucun trafic réel à ce jour |

## Prochaine action

1. Redéployer `checkout-status` via le dashboard Supabase (le dépôt a la
   version avec les champs d'enquête Google, la production ne l'a pas encore).
2. Reprendre les 33 constats « notable » du backlog, accessibilité d'abord
   (A57, A58, A59, A60), puis i18n (A54, A55, A56), puis performance
   (A61, A62).

## Outils de vérification

```bash
npm test                                        # unitaires + base réelle
npm run test:stripe                             # 28 scénarios, vrai Stripe test
npm run test:browser                            # 17 contrôles, vrai navigateur
node tests/helpers/smoke-production.mjs         # production, non destructif
node tests/helpers/attaque-production.mjs       # passe offensive, transactions annulées
node tests/helpers/parcours-litige.mjs          # cycle complet du litige
node tests/helpers/un-seul-calcul.mjs           # invariants de prix
node tests/helpers/declencher-moniteur.mjs      # diagnostic de la surveillance
node tests/helpers/appliquer-migration.mjs <f>  # applique une migration nommée
```

Les outils de base passent par `tests/helpers/connexion.mjs`, qui essaie
l'hôte direct puis le connecteur IPv4 : l'hôte direct de Supabase n'est
joignable qu'en IPv6.
