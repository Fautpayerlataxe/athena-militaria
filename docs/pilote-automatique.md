# Pilote automatique d'Athena Militaria

Ce fichier est le cahier de la routine hebdomadaire (tâche planifiée
« pilote-automatique-athena » de Claude Code). Augustin ne veut plus avoir à
s'occuper du site : la routine le surveille, le corrige et l'améliore, une
petite chose à la fois, sans brûler de jetons pour rien.

## Ce qui tourne déjà sans personne (Supabase, aucun jeton)

| Tâche | Quand | Rôle |
|---|---|---|
| veille-site | toutes les 10 min | Courriel à contact@ si le site ne répond plus deux fois de suite, puis au retour |
| payout-release | chaque heure, à :07 | Versements aux vendeurs ; ventes chez un vendeur pas inscrit : relances, annulation et remboursement à 7 jours |
| payments-monitor | toutes les 6 h | Contrôle des paiements, alerte à contact@ |
| weekly-newsletter | chaque semaine | Lettre aux abonnés |
| sitemap.php, flux-produits.php | à chaque lecture | Plan du site et flux Shopping toujours à jour |
| deploy-ovh.sh | à chaque mise en ligne | Signale à IndexNow (Bing…) les seules pages modifiées |

## Une séance de la routine, dans l'ordre

1. **Santé.** `npm run test:unit`, `npm run test:seo`, `npm run test:browser`
   (site réel). Un échec : chercher la cause. La corriger si elle est sûre et
   hors des interdits ci-dessous, sinon la noter dans « À décider ».
2. **Google.** Si Claude in Chrome est connecté : Search Console
   (propriété https://www.athenamilitaria.fr/) ; performances des 7 derniers
   jours comparées aux 7 précédents (clics, impressions, position, requêtes
   en position 5 à 20) ; rapport Pages (nouvelles erreurs) ; demande
   d'indexation, au plus 8, des pages nouvelles ou modifiées depuis la séance
   précédente (`git log`). Méthode : page Vue d'ensemble, clic dans la boîte
   d'inspection vers (733, 31), taper l'adresse, Entrée, attendre 10 s ;
   « Demander une indexation » vers (1243, 382), attendre 38 s, « Masquer ».
   Un « Quota dépassé » arrête les demandes pour la séance.
3. **Une amélioration**, la première tâche non bloquée de la liste plus bas,
   faite jusqu'au bout et au niveau des guides existants (faits vérifiés sur
   des sources sérieuses ouvertes le jour même, publiées par le catalogue
   SOURCES ; vérification du rendu ; tests). Une seule par séance.
4. **Mise en ligne** (procédure ci-dessous), commit, push.
5. **Journal.** Ajouter en tête de `docs/journal-pilote.md` : date, santé,
   chiffres Google, ce qui a été fait, ce qui attend Augustin. Puis une
   notification courte (PushNotification) à Augustin.

## Mise en ligne (la seule procédure)

```bash
node build-css.cjs && node build-i18n-dict.cjs
python3 monter-versions.py --appliquer      # monte les ?v= des fichiers changés
node build-guides.cjs && node build-categories.cjs && node generate-sitemap.cjs
npm run test:unit
set -a && . ./.env.deploy && set +a
./essai-php.sh deposer   # seulement si un .php ou inc/ a changé ; contrôler puis :
./essai-php.sh nettoyer
./deploy-ovh.sh
npm run test:seo && npm run test:browser
```

Commit en français (le pourquoi), terminé par la ligne Co-Authored-By
habituelle, puis `git push origin main` (jamais de force).

## Interdits (ne jamais faire seul)

- Paiements, Stripe, Supabase (fonctions, migrations, réglages) : les
  déploiements y demandent des clics d'Augustin ; noter dans « À décider ».
- Textes contractuels (CGV, CGU, mentions légales), prix, commission.
- Le bouton « Acheter » et le flux Shopping ne dépendent pas de l'inscription
  Stripe du vendeur (décision du 10 oct. 2026).
- Aucun contenu sur 1933-1945, aucun prix ni cote dans les guides, rien
  d'inventé, aucune expérience personnelle prêtée à Augustin.
- Guides gelés jusqu'au 20 oct. 2026 inclus : heritage-militaria-que-faire,
  estimer-valeur-casque-adrian, croix-de-guerre-1914-1918,
  identifier-casque-allemand-ww2, identifier-baionnette-francaise.
- Aucun élément collé à l'écran ; pied de page mobile intouchable.
- Ne jamais saisir de mot de passe, de clé ni de secret ; ne jamais écrire
  aux clients ; ne jamais authentifier une annonce.
- Pas d'atelier multi-agents : une séance tient dans une seule conversation.

## Règles d'écriture

Vouvoiement ; jamais de tiret cadratin « — » ; espace insécable avant
: ; ? ! et dans « » ; guides signés d'Augustin, à la première personne sobre
du collectionneur ; style de la maison (filets, rayons 4/6 px, gris #5f6878,
or de texte #75602c, « › »).

## Liste des tâches (dans l'ordre ; cocher quand c'est en ligne)

- [ ] Après le 20 oct. 2026 : les retouches des guides gelés listées dans la
      mémoire « project_apres_20_octobre » (R645-1, tanin, liens vers la
      fourragère et le sabre, sources des cinq guides, lien automatique du
      lexique vers sa propre page).
- [ ] Nouveau guide « Casque de cuirassier ou de dragon : modèles 1845 à
      1874 » (plan SEO, id C12, slug casque-cuirassier-dragon ; le plan est
      dans la mémoire « reference_plan_seo »). Commencé le 10 oct. puis
      arrêté pour économiser : à reprendre de zéro.
- [ ] Rang 15 du plan : tableau des modèles du guide baïonnette (après le
      20 oct.).
- [ ] Questions réellement posées par Google (« Autres questions »,
      requêtes en position 5 à 20 de la Search Console) : ajouter la
      réponse sourcée au guide concerné, une à trois par séance.
- [ ] Bloqué, attend Augustin : guide « Artisanat de tranchée » (règle du
      site sur les douilles) ; ligne « armes d'avant 1900 » du tableau du
      guide vendre (article 2.4 des CGU).

## À décider (pour Augustin)

La routine ajoute ici ce qu'elle ne peut pas trancher seule.

- Changer la clé secrète Stripe (sk_live), passée en clair dans une
  conversation le 6 oct. 2026.
- SIRET, adresse et médiateur de la consommation pour les mentions légales.
