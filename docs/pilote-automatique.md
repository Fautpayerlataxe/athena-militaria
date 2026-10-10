# Pilote automatique d'Athena Militaria

Ce fichier est le cahier de la routine hebdomadaire (tâche planifiée
« pilote-automatique-athena » de Claude Code). Le but d'Augustin : maintenir
en permanence le meilleur site du monde sur son sujet, sans avoir à s'en
occuper. La routine le surveille, le corrige et l'améliore chaque semaine.
Elle dépense ce qu'il faut pour bien faire, jamais pour rien : pas de
travail en double, pas de chantier sans bénéfice clair pour les visiteurs
ou pour Google.

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
3. **Améliorer**, en prenant les tâches non bloquées de la liste plus bas,
   dans l'ordre, chacune faite jusqu'au bout et au niveau des guides
   existants (faits vérifiés sur des sources sérieuses ouvertes le jour même,
   publiées par le catalogue SOURCES ; vérification du rendu FR/EN, téléphone
   et grand écran ; tests). Jusqu'à trois par séance, mais une tâche bien
   finie vaut mieux que trois à moitié : on s'arrête dès que la qualité
   baisserait. Une tâche finie est cochée, et une nouvelle tâche utile
   repérée en chemin est ajoutée à la liste, à sa place.
3 bis. **Le premier lundi du mois, révision approfondie** (avant les
   améliorations) : audit complet du site réel (parcours FR/EN sur téléphone
   et grand écran, cohérence des textes, SEO technique de toutes les adresses
   du plan du site, relecture du code), chaque constat contre-vérifié avant
   d'être corrigé (des sous-agents peuvent aider, outil Agent) ; rapport
   Signaux Web essentiels de la Search Console ; diagnostics du flux dans le
   Merchant Center (5838825955) ; pour les dix requêtes les plus importantes,
   comparer honnêtement la page d'Athena à celles qui la devancent sur
   Google et inscrire dans la liste ce qui manque. Les défauts confirmés sont
   corrigés dans la séance s'ils sont hors des interdits.
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

- Paiements et Stripe (fonctions de paiement, clés, webhooks, CGV) : rien
  sans Augustin, c'est l'argent des clients ; noter dans « À décider ».
  Ailleurs dans Supabase (veille, courriels, modération), un déploiement
  par le tableau de bord est permis s'il est testé, puis vérifié par
  empreinte et par un appel réel (méthode : mémoire « Supabase sans CLI »).
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
- Pas de dépense sans bénéfice : on ne refait pas ce qui est déjà contrôlé
  par les tests, on ne relance pas un chantier fini.

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
- [x] Nouveau guide « Casque de cuirassier ou de dragon : modèles 1845 à
      1874 » : en ligne le 10 oct. 2026. Reste à faire relire la partie
      « Troupe, sous-officier, officier » par Augustin ou un spécialiste, et
      à compléter la ligne des cuirassiers de la Garde (décision du 19 juin
      1854, sur Gallica) si une source s'ouvre.
- [ ] Rang 15 du plan : tableau des modèles du guide baïonnette (après le
      20 oct.).
- [ ] Textes propres des catégories « Objets divers 14-18 » et « Objets
      divers guerre froide » (categories-contenu.cjs), au niveau des
      autres : elles reprennent pour l'instant le résumé de leur période.
      Pas de texte nouveau pour les deux catégories 39-45 (règle 1933-1945).
- [ ] Base de données, en filet derrière le site (SQL par le tableau de
      bord, hors paiements) : CHECK sur un titre fait d'espaces et sur les
      réactions hors liste, recherche sans accents (unaccent), puis REVOKE
      des colonnes internes de products pour anon une fois vérifié que ni
      le PHP ni le JS ne lisent plus select=*.
- [ ] Indexation à redemander (quota du 10 oct. épuisé) :
      heritage-militaria-que-faire.
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
- SIRET, adresse et médiateur de la consommation pour les mentions légales
  (le médiateur est annoncé en CGV 3.9 sans être nommé).
- Passer dans l'éditeur SQL de Supabase deux migrations que le mode
  automatique refuse à Claude (droits et garde en base) :
  - supabase/migrations/20261010000300_statut_annonce_garde.sql : seul un
    paiement passe une annonce en « vendu », et seule la modération sort
    une annonce de « retirée ». Le site n'offre déjà plus « Vendu » dans la
    fenêtre de modification ; la base fermera aussi l'API. Contrôle :
    SELECT tgname FROM pg_trigger WHERE tgname = 'products_garde_statut';
  - supabase/migrations/20261010000200_moderation_photos.sql : droit pour
    les deux administrateurs d'effacer les photos d'une annonce supprimée
    par la modération. Sans elle, les originaux restent dans le stockage.
- Audit du 10 oct. 2026, points qui changent le contrat ou le paiement :
  - Munitions inertes : CGU 2.4, page Vendre et guides donnent trois règles
    différentes. Choisir la règle (et le sort des éclats, ailettes, douilles
    vides), puis aligner CGU FR/EN et guides.
  - Paiement Stripe (create-checkout, à tester sur les 28 scénarios avant
    tout déploiement) : la page de paiement promet une livraison en 2 à 3
    jours sans le délai d'expédition de 5 jours ouvrés (omettre
    delivery_estimate) ; la Belgique, la Suisse et le Luxembourg sont
    ouverts au tarif français (restreindre à FR et MC). Un seul
    déploiement pour les deux.
  - Statut du vendeur (particulier ou professionnel) jamais affiché alors
    que les droits de l'acheteur en dépendent (D111-8) : colonne de profil,
    affichage sur la fiche, phrase des CGV.
  - Merchant Center : la politique de retour France annonce « 14 jours »,
    les CGV refusent la rétractation entre particuliers. Mettre « Retours
    non acceptés » avec le lien /legal#cgv, ou supprimer la politique.
  - CGV 3.4 : y ajouter l'examen à 14 jours d'un colis non reçu (déjà dit
    dans la FAQ).
  - Durées de conservation des messages promises sans purge (rien ne
    presse avant mi-2028) : purge avec rapport préalable, ou politique
    réécrite selon ce qui est fait.
  - Fiche 31 : son titre sort « Dague d'officier allemand de la seconde
    guerre à vendre » ; le garder ou tolérer un titre plus long.
