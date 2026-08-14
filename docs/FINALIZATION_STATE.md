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

Fermés à ce jour : 20. Ouverts : 42, dont 6 bloquants.

### Bloquants encore ouverts

| ID | Fichier | Constat |
|---|---|---|
| A02 / A09 | `account.js:504` | Taxonomie de la modale d'édition. **Corrigé mais à revérifier** : `taxonomie.js` est la source unique depuis le commit 1687b4e. |
| A13 | `account.js:1632` | « Supprimer » un compte suspendu le débloque au lieu de le bannir : seule la ligne `profiles` est effacée, le compte `auth` survit. |
| A14 | `admin.js:246` | Un article signalé sur lequel une réservation a existé ne peut plus être retiré : la suppression est la seule action et la clé étrangère la refuse. |
| A15 | `admin.js:253` | Supprimer l'article efface le signalement par cascade, et l'écriture de traçabilité qui suit ne touche aucune ligne. |
| A21 | `script.js:376` | La modale d'authentification se déclare `aria-modal` sans gérer le focus, Échap, ni le piégeage du focus. |
| A22 | `messages.js:212` | L'avatar de la liste des conversations charge la photo d'annonce en pleine taille dans une pastille de 46 px. |

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

Reprendre les bloquants ouverts dans l'ordre du tableau ci-dessus, en
commençant par A13 (sécurité des comptes bannis), puis A14 et A15
(modération), puis A21 (accessibilité) et A22 (performance).

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
