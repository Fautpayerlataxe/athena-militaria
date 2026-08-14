# Backlog des constats d'audit

Source : balayage de douze domaines, 184 agents, chaque constat soumis à deux sceptiques.
62 constats confirmés, 24 écartés après réfutation.

Statuts : OPEN · FIXING · FIXED · TESTED · DEPLOYED · VERIFIED · REJECTED_WITH_PROOF · BLOCKED_EXTERNAL

| ID | Sévérité | Fichier | Constat | Statut |
|---|---|---|---|---|
| A01 | bloquant | `messages.js:86` | Le bouton « Se connecter » de la page Messages n'ouvre jamais la modale : il pose aria-hidden="false" sans ajouter la classe .open | VERIFIED |
| A02 | bloquant | `account.js:505` | La modale « Modifier une annonce » propose des périodes et des types qui n'existent nulle part ailleurs sur le site | OPEN |
| A03 | bloquant | `supabase/migrations/20260809000000_profiles_pseudo.sql:175` | La vue public_profiles est en security_invoker=off, auto-modifiable, et anon y reçoit tous les droits (pas seulement SELECT) | VERIFIED |
| A04 | bloquant | `USERS_SETUP.sql:128` | La policy « Block insert if user blocked » est permissive et se cumule en OU avec la policy de création : un compte suspendu publie quand même | VERIFIED |
| A05 | bloquant | `product.js:904` | Le bloc « Articles similaires » injecte le titre et l'état d'une annonce dans innerHTML sans échappement, et échoue avant même de s'afficher | VERIFIED |
| A06 | bloquant | `index.html:476` | Aucun parcours de mot de passe oublié : ni lien, ni appel à resetPasswordForEmail nulle part dans le dépôt | VERIFIED |
| A07 | bloquant | `USERS_SETUP.sql:128` | La policy qui interdit à un compte suspendu de publier est annulée par la policy permissive antérieure jamais supprimée | VERIFIED |
| A08 | bloquant | `USERS_SETUP.sql:127` | La policy qui interdit à un compte suspendu de publier est neutralisée par la policy permissive d'origine restée en place | VERIFIED |
| A09 | bloquant | `account.js:504` | La modale de modification propose une taxonomie qui n'existe nulle part ailleurs sur le site | OPEN |
| A10 | bloquant | `supabase/migrations/20260813000000_stripe_hardening.sql:1111` | La fenêtre de 48 h promise à l'acheteur n'existe pas : order_report_dispute refuse le statut 'completed', que la confirmation de réception vient préci | OPEN |
| A11 | bloquant | `account.js:875` | Un acheteur dont le vendeur n'expédie jamais n'a aucun bouton : les actions sont conditionnées à 'shipped'/'delivered' alors que la base autorise le l | OPEN |
| A12 | bloquant | `supabase/migrations/20260813000100_payout_escrow.sql:277` | 'disputed' et payout_state 'blocked' sont des états terminaux : aucune fonction ne permet d'en sortir, et n'importe quel acheteur peut y envoyer une c | OPEN |
| A13 | bloquant | `account.js:1632` | « Supprimer » un compte bloqué le débloque au lieu de le bannir : seule la ligne profiles est effacée, le compte auth survit | VERIFIED |
| A14 | bloquant | `admin.js:246` | Un article signalé sur lequel une seule réservation a existé ne peut plus jamais être retiré : la suppression est la seule action de modération et la  | VERIFIED |
| A15 | bloquant | `admin.js:253` | Supprimer l'article d'un signalement efface le signalement lui-même par cascade, et l'écriture de traçabilité qui suit ne touche aucune ligne | VERIFIED |
| A16 | bloquant | `supabase/functions/message-notify/index.ts:104` | productId, non validé, est injecté brut dans le href du courriel : injection HTML dans un message signé Athena Militaria | VERIFIED |
| A17 | bloquant | `supabase/functions/stripe-webhook/index.ts:73` | Tous les courriels du parcours de paiement partent de noreply@athenamilitaria.com, un domaine qui n'existe nulle part ailleurs dans le projet | VERIFIED |
| A18 | bloquant | `supabase/functions/order-notify/index.ts:96` | order-notify n'a ni idempotence ni limite de débit : le contrôle de statut n'empêche pas le rejeu | VERIFIED |
| A19 | bloquant | `i18n.js:505` | La page Mon compte annonce au vendeur une « commission de 8% sur le prix de l'article », alors que le modèle retenu ne prélève rien au vendeur | VERIFIED |
| A20 | bloquant | `index.html:359` | La page d'accueil affiche une note moyenne et quatre témoignages clients entièrement inventés, sous une page qui promet par ailleurs des « avis vérifi | REJECTED_WITH_PROOF |
| A21 | bloquant | `script.js:376` | La modale d'authentification se déclare `role="dialog" aria-modal="true"` mais ne gère ni le focus, ni la touche Échap, ni le piégeage du focus | VERIFIED |
| A22 | bloquant | `messages.js:212` | L'avatar de la liste des conversations charge la photo d'annonce d'origine, en pleine taille, dans une pastille de 46 px | VERIFIED |
| A23 | notable | `admin.js:38` | Le gestionnaire des filtres de signalements est branché sur tous les .filter-btn de la page, y compris ceux des onglets Articles et Utilisateurs | OPEN |
| A24 | notable | `product.js:601` | Le bouton Favori bascule son affichage sans jamais lire l'erreur de l'insert ou du delete Supabase | OPEN |
| A25 | notable | `index.html:472` | La modale de connexion n'offre aucun moyen de récupérer un mot de passe oublié | VERIFIED |
| A26 | notable | `script.js:915` | L'enregistrement en brouillon avale les échecs d'envoi de photos et annonce quand même « Brouillon enregistré » | OPEN |
| A27 | notable | `backups/db/production-2026-08-13/schema.sql:5478` | En production, products n'a aucune policy SELECT pour son propriétaire : les brouillons sont invisibles à leur auteur et à l'administration | OPEN |
| A28 | notable | `ADD_ADMIN.sql:30` | ADD_ADMIN.sql redéfinit profiles_prevent_self_unblock sans la protection des colonnes Stripe ni la sortie service_role | OPEN |
| A29 | notable | `ADMIN_SETUP.sql:29` | reports accepte des insertions anonymes avec WITH CHECK (true) : toutes les colonnes sont fournies par le client | OPEN |
| A30 | notable | `supabase/functions/message-notify/index.ts:104` | L'e-mail de notification recopie le corps du message et l'identifiant d'annonce fournis par l'appelant, sans les vérifier ni les échapper dans le lien | VERIFIED |
| A31 | notable | `ADMIN_SETUP.sql:32` | N'importe qui, même non connecté, peut insérer un nombre illimité de signalements avec un rapporteur et un statut de son choix | OPEN |
| A32 | notable | `supabase/migrations/20260705000000_newsletter.sql:29` | Le secret qui authentifie l'envoi de la newsletter est écrit en clair dans une migration versionnée | OPEN |
| A33 | notable | `supabase/functions/translate-listing/index.ts:60` | La traduction DeepL est rappelable en boucle sur la même annonce, sans limitation de débit ni garde de fraîcheur | OPEN |
| A34 | notable | `account.js:111` | Changement de mot de passe sans mot de passe actuel et sans champ de confirmation | OPEN |
| A35 | notable | `index.html:461` | Les panneaux d'inscription et de connexion ne sont pas dans un <form> : la touche Entrée ne valide rien et les contrôles HTML sont inertes | OPEN |
| A36 | notable | `account.js:680` | Remplacer la photo d'une annonce écrit image_url mais jamais image_urls : l'ancienne photo reste celle qui s'affiche | OPEN |
| A37 | notable | `backups/db/production-2026-08-13/schema.sql:5708` | La policy d'envoi vers le bucket public product-images n'est pas cloisonnée par dossier utilisateur | OPEN |
| A38 | notable | `account.js:679` | La modification d'une annonce ne redéclenche jamais la traduction : la version anglaise reste figée sur l'ancien texte | OPEN |
| A39 | notable | `account.js:851` | Aucune trace figée de ce qui a été vendu : le vendeur peut réécrire l'annonce pendant que l'argent est sous séquestre | OPEN |
| A40 | notable | `account.js:409` | Supprimer une annonce ne nettoie qu'une photo sur six du stockage public | OPEN |
| A41 | notable | `supabase/functions/translate-listing/index.ts:38` | Traduction déclenchable en boucle sur une description sans longueur maximale | OPEN |
| A42 | notable | `supabase/migrations/20260813000200_buyer_protection_pricing.sql:766` | Un litige ouvert avant l'encaissement fait court-circuiter order_settle_payment : ni paid_at, ni décrément de stock, ni email | OPEN |
| A43 | notable | `supabase/migrations/20260813000200_buyer_protection_pricing.sql:531` | Un acheteur simplement silencieux gèle définitivement le versement du vendeur : manual_review est posé avec needs_review, et rien ne les lève | OPEN |
| A44 | notable | `supabase/functions/order-notify/index.ts:96` | order-notify est rejouable sans limite : le contrôle de statut n'empêche pas le renvoi en boucle du même email | VERIFIED |
| A45 | notable | `account.html:150` | La page « Mon compte » annonce au vendeur une commission de 8 % alors que la même page affiche « Aucun frais, aucune commission » | VERIFIED |
| A46 | notable | `supabase/functions/message-notify/index.ts:20` | Le corps de l'e-mail de notification est fourni par le client et l'envoi est rejouable à l'infini | VERIFIED |
| A47 | notable | `supabase/functions/order-notify/index.ts:96` | Le garde de order-notify est un état permanent, pas une idempotence : chaque événement est renvoyable en boucle | VERIFIED |
| A48 | notable | `messages.js:171` | Toutes les annonces échangées avec un même membre sont fusionnées dans un fil unique, rattaché à la mauvaise annonce | OPEN |
| A49 | notable | `admin.js:758` | La suppression des annonces d'un utilisateur n'est pas vérifiée avant de supprimer son profil | OPEN |
| A50 | notable | `supabase/functions/message-notify/index.ts:62` | L'anti-spam de message-notify ne compte que les messages, pas les envois : un seul message permet un nombre illimité de courriels | VERIFIED |
| A51 | notable | `supabase/functions/payments-monitor/index.ts:50` | Le mailer de payments-monitor avale tout échec, y compris celui de l'alerte critique et des confirmations d'achat qu'il réémet | OPEN |
| A52 | notable | `i18n.js:467` | La page À propos promet que les fonds sont sécurisés « jusqu'à la confirmation de l'expédition », alors que la séquestre court jusqu'à la confirmation | OPEN |
| A53 | notable | `i18n.js:464` | Un droit de rétractation de 14 jours est promis sans condition sur une place de marché entre particuliers, où il n'existe pas | OPEN |
| A54 | notable | `category.html:225` | Le bloc éditorial du catalogue, environ 350 mots, n'a aucun attribut data-i18n et reste en français en version anglaise | OPEN |
| A55 | notable | `script.js:1558` | Presque toutes les dates sont formatées en fr-FR en dur : en anglais, les mois s'affichent en français au milieu de phrases traduites | OPEN |
| A56 | notable | `product.js:372` | La période et l'état de l'article sont affichés avec la valeur française brute de la base, à côté de filtres traduits | OPEN |
| A57 | notable | `product.html:85` | `aria-live="polite"` enveloppe la totalité de la fiche produit | OPEN |
| A58 | notable | `index.html:186` | Le lien d'évitement n'existe que sur 3 pages sur 12 | OPEN |
| A59 | notable | `style.css:3294` | `.faq-item summary { outline: none }` supprime le seul indicateur de focus de l'accordéon FAQ | OPEN |
| A60 | notable | `script.js:1447` | Le bouton hamburger ne publie jamais l'état du menu mobile | OPEN |
| A61 | notable | `messages.js:202` | Une requête Supabase par conversation, en série, pour récupérer les pseudos (N+1) | OPEN |
| A62 | notable | `messages.js:153` | La liste des conversations télécharge l'intégralité des messages de l'utilisateur | OPEN |

## Détail

### A01 · bloquant · `messages.js:86`

**Constat.** Le bouton « Se connecter » de la page Messages n'ouvre jamais la modale : il pose aria-hidden="false" sans ajouter la classe .open

**Conséquence.** Un visiteur déconnecté qui arrive sur /messages (par le lien du menu mobile, ou après avoir cliqué sur l'icône messagerie) voit un écran « Connectez-vous » avec un gros bouton bleu. Le clic ne produit rien : .modal reste en display:none (style.css:667-668), seule la classe .open l'affiche. Le seul bouton d'action de la page est mort ; il faut deviner qu'il faut passer par le bandeau du haut.

**Correction proposée.** Ajouter modal.classList.add("open") avant le setAttribute, comme partout ailleurs (script.js:369, account.js:21, product.js:688).

**Statut.** VERIFIED — classList.add(open) ajouté, commit 44f6dd1

### A02 · bloquant · `account.js:505`

**Constat.** La modale « Modifier une annonce » propose des périodes et des types qui n'existent nulle part ailleurs sur le site

**Conséquence.** Les listes déroulantes #edit-period (« Avant 1914 », « Seconde Guerre mondiale (1939-1945) », « Contemporain »…) et #edit-subcategory (« Casques », « Armes neutralisées », « Documents & Papiers »…) n'ont presque aucune valeur en commun avec celles écrites par sell.html (« 2nde Guerre Mondiale », « Armes (neutralisées/maquettes) », « Documents »). Deux conséquences : au préremplissage (account.js:434-435), la valeur stockée ne correspond à aucune option, les deux selects retombent sur « Choisir » et le vendeur croit ses données perdues ; s'il enregistre pour corriger un simple prix, le garde-fou ligne 649 le force à choisir une des nouvelles valeurs, et l'annonce est alors réécrite avec une période et un type que loadCategoryProducts (script.js:1227-1228, via subToDb) ne peut plus matcher. L'annonce disparaît de toutes les pages catégorie et sous-catégorie tout en restant « En ligne ».

**Correction proposée.** Remplacer les deux listes de la modale par exactement les <option> de sell.html (4 périodes, 6 types), ou mieux, les générer depuis une source unique partagée par sell.html, la modale et SUB_DB.

**Statut.** OPEN

### A03 · bloquant · `supabase/migrations/20260809000000_profiles_pseudo.sql:175`

**Constat.** La vue public_profiles est en security_invoker=off, auto-modifiable, et anon y reçoit tous les droits (pas seulement SELECT)

**Conséquence.** public_profiles est une vue simple mono-table sur profiles : PostgreSQL la considère auto-modifiable, et security_invoker=off fait exécuter les écritures avec les droits du propriétaire de la vue, donc sans aucune RLS. Le GRANT SELECT de cette ligne ne retire rien : les default privileges Supabase ont déjà accordé ALL, ce que confirme le dump de production (backups/db/production-2026-08-13/schema.sql:6455-6456, GRANT ALL ON TABLE public.public_profiles TO anon / authenticated). Avec la seule clé anon, publique dans supabaseClient.js : PATCH /rest/v1/public_profiles?id=eq.<uuid victime> {"pseudo":"Escroc","avatar_url":"https://.../x.jpg"} réécrit le pseudo et l'avatar de n'importe quel membre, y compris ceux affichés sur les fiches produit et dans la messagerie ; et DELETE /rest/v1/public_profiles?id=neq.00000000-0000-0000-0000-000000000000 vide la table profiles en entier (pseudos, stripe_account_id, stripe_onboarded, blocked, préférences newsletter). Aucun trigger BEFORE DELETE n'existe sur profiles pour freiner cela, et les profils ne se régénèrent pas : handle_new_user ne tourne qu'à l'inscription. Les vendeurs perdent leur rattachement Stripe Connect, donc tout versement.

**Correction proposée.** Après la création de la vue : REVOKE ALL ON public.public_profiles FROM anon, authenticated; puis GRANT SELECT ON public.public_profiles TO anon, authenticated;. Ajouter un test qui vérifie qu'un PATCH et un DELETE sur public_profiles échouent avec la clé anon.

**Statut.** VERIFIED — droits ramenés à SELECT + règles DO INSTEAD NOTHING, migration 20260814000100

### A04 · bloquant · `USERS_SETUP.sql:128`

**Constat.** La policy « Block insert if user blocked » est permissive et se cumule en OU avec la policy de création : un compte suspendu publie quand même

**Conséquence.** Les policies permissives d'une même commande sont combinées par OU. « Création d'annonce par utilisateur connecté » (supabase_setup.sql:52, présente en production sous le nom « Création par utilisateur connecté », backups/db/production-2026-08-13/schema.sql:5471) autorise l'INSERT dès que auth.uid() = user_id, sans regarder profiles.blocked. La condition anti-blocage n'a donc jamais aucun effet. Un compte suspendu par la modération n'a qu'à appeler POST /rest/v1/products directement avec son JWT pour continuer à publier : le garde-fou de sell.html et de script.js:893-899 est purement côté navigateur et se contourne en une requête. Le drapeau blocked n'est appliqué nulle part ailleurs en base non plus : le compte suspendu peut aussi modifier ses annonces existantes (« Modification de ses propres annonces ») et envoyer des messages (« Users send messages »).

**Correction proposée.** Ne pas ajouter une seconde policy permissive : soit fusionner la condition NOT blocked dans l'unique policy INSERT de products, soit la déclarer AS RESTRICTIVE. Étendre la même condition restrictive à l'UPDATE de products et à l'INSERT de messages, sinon la suspension reste cosmétique.

**Statut.** VERIFIED — politique redondante retirée, garde RESTRICTIVE, migration 20260814000200

### A05 · bloquant · `product.js:904`

**Constat.** Le bloc « Articles similaires » injecte le titre et l'état d'une annonce dans innerHTML sans échappement, et échoue avant même de s'afficher

**Conséquence.** Deux défauts au même endroit. Aujourd'hui : `esc` est déclaré ligne 83 à l'intérieur du callback DOMContentLoaded, alors que loadSimilarProducts est une fonction de premier niveau (ligne 839) ; l'appel `esc(...)` ligne 899 lève ReferenceError et l'affectation innerHTML n'a jamais lieu. Vérifié en exécutant la fonction avec des stubs : « ReferenceError: esc is not defined ». La section reste donc bloquée sur ses quatre cartes squelettes sur TOUTES les fiches produit. Demain : la correction évidente (ajouter `const esc = window.escapeHtml` dans la fonction) met en ligne un XSS stocké, car p.title (lignes 897 et 904) et p.condition (ligne 905) restent interpolés bruts. Un vendeur publie une annonce titrée `<img src=x onerror=...>` ; le repli de loadSimilarProducts prend les 5 annonces publiées les plus récentes, donc la charge s'exécute sur presque toutes les fiches du site. La CSP du .htaccess ligne 308 autorise 'unsafe-inline' pour script-src et connect-src vers Supabase : le script injecté peut donc appeler l'API Auth avec le jeton du visiteur (stocké en localStorage) pour changer son e-mail, ou l'exfiltrer par simple navigation. Prise de contrôle de compte, y compris celui d'un administrateur qui consulte une fiche.

**Correction proposée.** Déclarer `const esc = window.escapeHtml;` dans loadSimilarProducts ET échapper les trois interpolations : `${esc(p.title || '')}` lignes 897 et 904, `${esc(p.condition)}` ligne 905. Vérifier au passage les autres fonctions de premier niveau du fichier (loadSellerInfo ligne 918 et loadReviews ligne 1016 déclarent bien le leur).

**Statut.** VERIFIED — trois interpolations échappées, commit 44f6dd1

### A06 · bloquant · `index.html:476`

**Constat.** Aucun parcours de mot de passe oublié : ni lien, ni appel à resetPasswordForEmail nulle part dans le dépôt

**Conséquence.** Un membre qui perd son mot de passe est définitivement enfermé dehors : ses annonces, ses achats, ses ventes, ses messages et son compte Stripe Connect deviennent inaccessibles. Le seul écran de changement de mot de passe (account.html) exige d'être déjà connecté. La seule issue est une intervention manuelle dans le dashboard Supabase, compte par compte.

**Correction proposée.** Ajouter un lien « Mot de passe oublié » dans le panneau de connexion qui appelle sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://.../account?recovery=1' }), et une page qui détecte le retour de type recovery pour proposer la saisie du nouveau mot de passe puis rediriger vers le compte.

**Statut.** VERIFIED

### A07 · bloquant · `USERS_SETUP.sql:128`

**Constat.** La policy qui interdit à un compte suspendu de publier est annulée par la policy permissive antérieure jamais supprimée

**Conséquence.** supabase_setup.sql:52 crée « Création d'annonce par utilisateur connecté » (WITH CHECK auth.uid() = user_id) et rien ne la supprime. Les deux policies INSERT sont permissives, donc combinées par OU : un vendeur frauduleux bloqué par la modération insère toujours des annonces via l'API REST (fetch depuis la console, ou n'importe quel client). Le blocage ne fait que masquer le formulaire dans son navigateur. La table messages n'a par ailleurs aucun contrôle de blocage : un compte suspendu continue d'écrire aux acheteurs.

**Correction proposée.** Supprimer la policy « Création d'annonce par utilisateur connecté », ou transformer le contrôle de blocage en policy RESTRICTIVE (CREATE POLICY ... AS RESTRICTIVE) sur products et messages, afin qu'elle s'applique en ET et non en OU.

**Statut.** VERIFIED — politique redondante retirée, garde RESTRICTIVE, migration 20260814000200

### A08 · bloquant · `USERS_SETUP.sql:127`

**Constat.** La policy qui interdit à un compte suspendu de publier est neutralisée par la policy permissive d'origine restée en place

**Conséquence.** Sur le schéma réel (backups/db/production-2026-08-13/schema.sql:5448 et :5471), products porte DEUX policies INSERT permissives : « Block insert if user blocked » et « Création par utilisateur connecté » (WITH CHECK auth.uid() = user_id seule). PostgreSQL combine les policies permissives par OU : la seconde suffit, la première ne bloque donc rien. La suspension d'un vendeur n'existe qu'en JavaScript (script.js:799 et initSellForm) et tombe avec un simple POST sur /rest/v1/products muni du jeton de session déjà présent dans localStorage. Un vendeur frauduleux banni republie en trois secondes, autant de fois qu'il veut, et rien ne l'empêche non plus de repasser ses brouillons en published (aucune policy UPDATE ne teste blocked). La suspension est le seul levier de modération du site : il est inopérant.

**Correction proposée.** DROP POLICY "Création par utilisateur connecté" ON public.products (la policy de blocage porte déjà auth.uid() = user_id), ou recréer le garde-fou en AS RESTRICTIVE. Ajouter le même test blocked en WITH CHECK sur les policies UPDATE.

**Statut.** VERIFIED — idem, migration 20260814000200

### A09 · bloquant · `account.js:504`

**Constat.** La modale de modification propose une taxonomie qui n'existe nulle part ailleurs sur le site

**Conséquence.** Le formulaire de vente enregistre 4 périodes (« Guerre Napoléonienne », « 1ère Guerre Mondiale », « 2nde Guerre Mondiale », « Guerre froide », sell.html:285-288) et 6 types (sell.html:296-301). La modale d'édition en propose 6 autres (« Avant 1914 », « Première Guerre mondiale (1914-1918) », « Seconde Guerre mondiale (1939-1945) »...) et 10 types (« Casques », « Documents & Papiers », « Munitions inertes »...). Seul « Guerre froide » et deux types se recoupent. Résultat en deux temps : (1) account.js:434-435 affecte product.period à un select qui n'a pas cette option, la valeur retombe à "", et le garde-fou account.js:649 refuse d'enregistrer avec « Remplissez tous les champs » : le vendeur ne peut corriger NI une faute de frappe NI son prix sur la quasi-totalité des annonces ; (2) s'il contourne en choisissant une valeur de la nouvelle liste, l'annonce sort du catalogue, car index.html, category.html et les 16 pages categories/*.html filtrent en égalité stricte sur l'ancien vocabulaire (script.js:1227-1228, liens ?cat=2nde-Guerre-Mondiale). L'annonce devient introuvable ailleurs que par son URL directe.

**Correction proposée.** Générer les <option> des deux formulaires depuis une seule liste partagée (celle de sell.html), et faire tomber en erreur explicite tout produit dont la valeur en base n'y figure pas plutôt que de la vider en silence.

**Statut.** OPEN

### A10 · bloquant · `supabase/migrations/20260813000000_stripe_hardening.sql:1111`

**Constat.** La fenêtre de 48 h promise à l'acheteur n'existe pas : order_report_dispute refuse le statut 'completed', que la confirmation de réception vient précisément de poser

**Conséquence.** L'acheteur lit sur la fiche produit avant de payer (i18n.js:355) et dans l'email de confirmation (supabase/functions/_shared/fulfillment.ts:207) « vous disposez ensuite de 48 heures pour signaler un problème ». Dès qu'il clique « J'ai bien reçu l'article », order_confirm_receipt passe la commande en 'completed' et pose report_window_ends_at = now()+48h. À cet instant précis, order_report_dispute lève « Litige impossible sur cette commande » et account.js:875 retire le bouton « Signaler un problème » de l'écran. La fenêtre de 48 h ne sert donc qu'à retarder le versement : pendant toute sa durée l'acheteur n'a aucun recours, et à son terme le versement part. Un acheteur qui ouvre un colis vide après avoir confirmé n'a plus aucune action dans le produit. C'est le cœur de la Protection acheteurs, facturée 5 % + 0,70 €, qui est inopérant.

**Correction proposée.** Autoriser 'completed' dans order_report_dispute tant que report_window_ends_at > now(), et laisser account.js afficher le bouton pour une commande 'completed' dont la fenêtre est encore ouverte (en affichant le temps restant).

**Statut.** OPEN

### A11 · bloquant · `account.js:875`

**Constat.** Un acheteur dont le vendeur n'expédie jamais n'a aucun bouton : les actions sont conditionnées à 'shipped'/'delivered' alors que la base autorise le litige dès 'paid'

**Conséquence.** La commande reste en 'paid' indéfiniment. L'écran « Mes achats » affiche une vignette, un badge « Payé » et rien d'autre : pas de date limite d'expédition, pas de relance, pas de signalement, pas d'annulation. Or order_report_dispute accepte le statut 'paid' (stripe_hardening.sql:1111) : la base sait faire, l'interface ne l'expose jamais. L'acheteur qui a payé un vendeur qui encaisse et n'envoie rien n'a strictement aucun recours dans le produit ; il doit deviner qu'il faut écrire à contact@. Côté base, seul un cron marque needs_review au bout de 5 jours ouvrés, sans rien dire à l'acheteur.

**Correction proposée.** Rendre le bloc d'actions disponible aussi pour status 'paid' (bouton « Signaler un problème » seul, sans « J'ai bien reçu »), et afficher order.ship_deadline_at comme date limite annoncée d'expédition.

**Statut.** OPEN

### A12 · bloquant · `supabase/migrations/20260813000100_payout_escrow.sql:277`

**Constat.** 'disputed' et payout_state 'blocked' sont des états terminaux : aucune fonction ne permet d'en sortir, et n'importe quel acheteur peut y envoyer une commande

**Conséquence.** order_report_dispute est accordée à 'authenticated' et appelable en une ligne depuis la console du navigateur. Sur une commande fraîchement payée, elle passe status à 'disputed' ; le trigger orders_guard_payout bascule alors payout_state en 'blocked'. À partir de là : order_mark_shipped exige 'paid' (le vendeur ne peut plus jamais déclarer l'expédition), order_confirm_receipt exige 'shipped'/'delivered' (personne ne peut clôturer), order_report_dispute refuse 'disputed', orders_ready_for_payout exige payout_state='pending'. Aucune fonction SQL, aucune edge function et aucun écran d'admin (admin.js ne fait qu'afficher needs_review, ligne 321) ne ramène le statut ou le payout_state en arrière ; payments-monitor se contente de lister les 'blocked'. Résultat : un acheteur gèle définitivement l'argent d'un vendeur avec dix caractères de texte, l'article est déjà marqué vendu, et la seule issue est du SQL écrit à la main en production.

**Correction proposée.** Ajouter une fonction service_role order_resolve_dispute(order_id, décision) qui remet status et payout_state dans un état vivant ('paid' ou 'completed' + payout_state 'pending'), et l'exposer dans le panneau d'administration.

**Statut.** OPEN

### A13 · bloquant · `account.js:1632`

**Constat.** « Supprimer » un compte bloqué le débloque au lieu de le bannir : seule la ligne profiles est effacée, le compte auth survit

**Conséquence.** La suppression ne touche que public.profiles ; auth.users reste intact (profiles_id_fkey cascade dans ce sens seulement, et handle_new_user ne se rejoue qu'à l'INSERT d'un utilisateur auth). Or tout le blocage repose sur l'existence de cette ligne : la policy « Block insert if user blocked » teste EXISTS(profiles WHERE id=auth.uid() AND blocked), et script.js:599, 805 et 896 testent `profile && profile.blocked === true` avec maybeSingle(). Profil absent = profil non bloqué. Un vendeur frauduleux banni puis « supprimé » se reconnecte avec le même mot de passe, republie ses annonces, et n'apparaît plus du tout dans la liste de modération : il est redevenu invisible ET actif. Même code à admin.js:759.

**Correction proposée.** Ne jamais supprimer la ligne profiles depuis le navigateur. Passer par une edge function en service_role qui appelle auth.admin.deleteUser(uid) (la cascade profiles/products suivra), ou conserver la ligne avec blocked=true plus un drapeau `deleted`, et faire échouer la lecture de session côté serveur pour ces comptes.

**Statut.** VERIFIED

### A14 · bloquant · `admin.js:246`

**Constat.** Un article signalé sur lequel une seule réservation a existé ne peut plus jamais être retiré : la suppression est la seule action de modération et la contrainte FK la refuse

**Conséquence.** orders.product_id référence products(id) sans ON DELETE (supabase/migrations/20260413_create_orders.sql:4), et checkout_expire_stale se contente de passer la commande à status='expired' sans supprimer la ligne (migration 20260813000000:343). Toute réservation, même abandonnée il y a des mois, épingle donc l'article définitivement. Le DELETE renvoie une violation de clé étrangère, l'admin voit « Suppression impossible : ... foreign key constraint », et il n'existe aucune autre action dans le back-office : ni dépublier, ni masquer. Une annonce illicite (mots-clés loi Gayssot listés à admin.js:345) reste donc en ligne et vendable, sans aucun recours depuis l'interface. Même impasse à account.js:1377.

**Correction proposée.** Ajouter une action « Retirer de la vente » qui fait un UPDATE products SET status='removed' (la policy « Admin can update any product » l'autorise déjà) et réserver le DELETE aux articles sans commande. Compléter la policy de lecture publique pour exclure ce nouveau statut.

**Statut.** VERIFIED

### A15 · bloquant · `admin.js:253`

**Constat.** Supprimer l'article d'un signalement efface le signalement lui-même par cascade, et l'écriture de traçabilité qui suit ne touche aucune ligne

**Conséquence.** reports.product_id est déclaré ON DELETE CASCADE (ADMIN_SETUP.sql:9, confirmé en production). Le DELETE de la ligne 246 détruit donc le signalement, puis l'UPDATE de la ligne 253 filtre sur .eq("id", rid) et modifie zéro ligne, sans erreur remontée. Résultat : resolved_at et resolved_by ne sont jamais écrits, le signalement disparaît au lieu d'apparaître dans le filtre « Traités », et il ne reste aucune trace de qui a supprimé quel article ni pourquoi. Pour une place de marché soumise à une obligation de conservation des décisions de modération, l'historique est vide.

**Correction proposée.** Écrire d'abord la résolution du signalement (status, resolved_at, resolved_by, plus une copie du titre et du vendeur), et seulement ensuite agir sur l'article ; ou passer la FK en ON DELETE SET NULL pour que le signalement survive à l'article.

**Statut.** VERIFIED

### A16 · bloquant · `supabase/functions/message-notify/index.ts:104`

**Constat.** productId, non validé, est injecté brut dans le href du courriel : injection HTML dans un message signé Athena Militaria

**Conséquence.** productId vient du corps de la requête et n'est jamais validé ni échappé ; il est concaténé dans replyUrl (l.104) puis interpolé dans href="${replyUrl}" (l.137). Le contrôle l.84 ne sert qu'à afficher la vignette : si le produit n'existe pas, la valeur est quand même reprise dans l'URL. Un membre authentifié envoie un vrai message à la victime, rappelle l'endpoint avec productId = 'x"><a href="https://faux-site">Validez votre paiement</a><a href="', et la victime reçoit dans sa boîte un courriel provenant de noreply@athenamilitaria.fr, aux couleurs du site, contenant le lien de l'attaquant. Hameçonnage clé en main avec la réputation du domaine.

**Correction proposée.** Valider productId comme entier positif avant tout usage, l'omettre de replyUrl s'il n'a pas résolu un produit réel, et passer replyUrl dans encodeURIComponent pour la partie variable plus escapeHtml au moment de l'insertion dans l'attribut.

**Statut.** VERIFIED

### A17 · bloquant · `supabase/functions/stripe-webhook/index.ts:73`

**Constat.** Tous les courriels du parcours de paiement partent de noreply@athenamilitaria.com, un domaine qui n'existe nulle part ailleurs dans le projet

**Conséquence.** Cinq fonctions expédient depuis athenamilitaria.com (stripe-webhook l.73, checkout-status l.51, order-notify l.29, payout-release l.179, payments-monitor l.48) alors que le site, les URLs canoniques, la liste CORS et l'adresse admin sont tous en .fr, et que les trois fonctions communautaires expédient bien depuis athenamilitaria.fr. La chaîne .com n'apparaît dans aucun autre fichier du dépôt. Resend refuse un expéditeur dont le domaine n'est pas vérifié : à la réouverture des achats, la confirmation d'achat, la confirmation de vente, l'avis de remboursement et toutes les alertes d'exploitation sont rejetées en bloc, tandis que la messagerie et la newsletter continuent de passer, ce qui masque la panne.

**Correction proposée.** Aligner les cinq expéditeurs sur noreply@athenamilitaria.fr, ou vérifier explicitement athenamilitaria.com dans Resend. Mieux : sortir l'adresse dans une constante partagée de _shared/payments.ts pour qu'un seul point la décide.

**Statut.** VERIFIED

### A18 · bloquant · `supabase/functions/order-notify/index.ts:96`

**Constat.** order-notify n'a ni idempotence ni limite de débit : le contrôle de statut n'empêche pas le rejeu

**Conséquence.** Le commentaire de tête (l.5-9) affirme que le contrôle de statut empêche un acheteur de rappeler l'endpoint en boucle. Il ne l'empêche pas : le statut reste à 'shipped', 'completed' ou 'disputed' indéfiniment, donc chaque rappel repasse le test l.96 et repart un envoi. Rien n'enregistre qu'une notification a déjà été émise pour cette commande. Un vendeur peut donc noyer son acheteur, un acheteur peut noyer son vendeur, et surtout event='disputed' arrose contact@athenamilitaria.fr sans plafond. Au-delà de la nuisance, cela consomme le quota Resend et brûle la réputation de l'expéditeur, ce qui fait tomber les vrais courriels transactionnels.

**Correction proposée.** Marquer l'envoi en base (colonne ou table order_notifications avec contrainte unique sur order_id plus event) et sortir tôt si la ligne existe. Ajouter en complément un rate_limit_hit par utilisateur, comme le fait déjà checkout-status.

**Statut.** VERIFIED

### A19 · bloquant · `i18n.js:505`

**Constat.** La page Mon compte annonce au vendeur une « commission de 8% sur le prix de l'article », alors que le modèle retenu ne prélève rien au vendeur

**Conséquence.** tr_account.stripe_text (FR l.505, EN l.1465) est affiché en clair sur account.html:150, dans l'encart Stripe que tout vendeur lit avant de connecter son compte bancaire : « Les fonds de tes ventes sont versés automatiquement (commission de 8% sur le prix de l'article, 0% sur les frais de port) ». Deux affirmations fausses dans la même phrase : le vendeur touche prix + port sans retenue, et le versement n'est pas automatique mais conditionné à la confirmation de réception par l'acheteur. Pire, la MÊME page affiche quelques centimètres plus bas, dans Mes ventes, tr_js_account.zero_fees (i18n.js:125, posé par account.js:959) : « Aucun frais, aucune commission : vous touchez 100 % du prix et du port. » Un vendeur lit donc sur un seul écran deux barèmes qui se contredisent sur l'argent. Soit il renonce à s'inscrire en croyant perdre 8 %, soit il conteste son versement en croyant avoir été trop payé.

**Correction proposée.** Réécrire tr_account.stripe_text dans les deux langues pour dire ce qui est réellement appliqué : aucune retenue sur le prix ni sur le port, versement déclenché après confirmation de réception par l'acheteur, la plateforme se rémunérant sur la Protection acheteurs payée par l'acheteur. Vérifier au passage tr_about.faq_a1 (i18n.js:487) qui évoque encore « une commission peut être prélevée au moment de la vente », en contradiction avec sell.card4_desc (i18n.js:840) et seo.index.desc (i18n.js:45) qui annoncent « commission 0% ».

**Statut.** VERIFIED — texte réécrit dans les deux langues, commit 44f6dd1

### A20 · bloquant · `index.html:359`

**Constat.** La page d'accueil affiche une note moyenne et quatre témoignages clients entièrement inventés, sous une page qui promet par ailleurs des « avis vérifiés »

**Conséquence.** index.html:359 affiche en dur « Note moyenne : 4,8/5 (320 avis) » (clé home.reviews_note_html, i18n.js:756 et 1716), une valeur figée dans le HTML qui n'est calculée à partir d'aucune donnée : la table reviews n'est jamais interrogée sur cette page. Les quatre cartes qui suivent (index.html:366/370, 376/380, 386/390, 396/400) sont des témoignages fabriqués attribués à des personnes nommées (« Arnaud L. », « Marie P. », « Julien T. », « Chloé S. ») avec notes en étoiles. En regard, tr_about.security_rev_text (i18n.js:473 / 1433) affirme au visiteur : « Seuls les acheteurs ayant réellement effectué un achat peuvent laisser un avis. » L'exposition est double : pratique commerciale trompeuse au sens de l'article L121-2 du code de la consommation, et manquement à l'obligation d'information sur l'origine des avis introduite par la directive Omnibus (art. L111-7-2). Second défaut, dans mon domaine strict : les quatre textes de témoignage et les prénoms ne portent aucun attribut data-i18n. Un visiteur anglophone lit donc « Average rating: 4.8/5 (320 reviews) » suivi de quatre avis restés en français. Le bouton « Lire tous les avis » (index.html:404) pointe en outre vers href="/" et se contente de recharger l'accueil : il n'existe aucune page d'avis à lire.

**Correction proposée.** Retirer le bloc avis de l'accueil tant qu'il n'y a pas de vrais avis à afficher, ou le remplacer par une moyenne et des extraits réellement lus dans la table reviews, avec la mention d'origine exigée par L111-7-2. Si des témoignages illustratifs sont conservés, les étiqueter explicitement comme exemples et les passer par i18n. Supprimer ou rebrancher le bouton « Lire tous les avis ».

**Statut.** REJECTED_WITH_PROOF — section retirée le 14 août puis rétablie sur demande explicite de l\'exploitant. Décision commerciale, pas technique. Le risque signalé demeure : afficher une note moyenne et des témoignages qui ne proviennent d\'aucune transaction relève de la pratique commerciale trompeuse, et la loi impose d\'indiquer si les avis sont vérifiés et comment.

### A21 · bloquant · `script.js:376`

**Constat.** La modale d'authentification se déclare `role="dialog" aria-modal="true"` mais ne gère ni le focus, ni la touche Échap, ni le piégeage du focus

**Conséquence.** Un visiteur au clavier qui ouvre « Connexion | S'inscrire » (modale présente sur 11 pages : index, category, product, sell, about, community, legal, order, account, messages, admin) garde le focus sur le bouton resté DERRIÈRE l'overlay. La touche Tab parcourt alors toute la page masquée, dont les liens sont visuellement couverts et non cliquables, et aucune touche ne referme la modale : seul un clic à la souris sur la croix ou sur le fond le permet. C'est l'unique parcours d'inscription et de connexion du site : un utilisateur au clavier ou au lecteur d'écran ne peut pas créer de compte. La déclaration `aria-modal="true"` aggrave le cas côté lecteur d'écran, qui masque le reste de la page alors que le focus s'y trouve toujours.

**Correction proposée.** À l'ouverture : mémoriser `document.activeElement`, donner le focus au bouton `.close`, et poser `inert` (ou `aria-hidden="true"`) sur `header`, `main` et `footer`. Ajouter un `keydown` : Échap ferme, Tab et Maj+Tab bouclent entre le premier et le dernier élément focusable de `.modal-content`. À la fermeture : retirer `inert` et rendre le focus à l'élément mémorisé. Le plus sûr reste de passer la modale en `<dialog>` piloté par `showModal()`, qui apporte tout cela nativement.

**Statut.** VERIFIED

### A22 · bloquant · `messages.js:212`

**Constat.** L'avatar de la liste des conversations charge la photo d'annonce d'origine, en pleine taille, dans une pastille de 46 px

**Conséquence.** La ligne voisine (messages.js:266) passe la même URL par window.imgUrl(..., 400), mais pas celle-ci : le src est l'URL brute du bucket product-images. Mesuré sur l'annonce publiée n°9 : l'objet de stockage pèse 4 508 728 octets et répond `cache-control: no-cache`, donc il est retéléchargé à chaque visite. Une boîte de réception de cinq conversations tire une vingtaine de méga-octets en données mobiles avant d'afficher quoi que ce soit, et rien n'est mis en cache pour la visite suivante. L'attribut loading="lazy" manque aussi, contrairement à toutes les autres images de la page.

**Correction proposée.** Envelopper productImg dans window.imgUrl(productImg, 400) comme à la ligne 266, et ajouter loading="lazy" decoding="async" sur cette balise.

**Statut.** VERIFIED

### A23 · notable · `admin.js:38`

**Constat.** Le gestionnaire des filtres de signalements est branché sur tous les .filter-btn de la page, y compris ceux des onglets Articles et Utilisateurs

**Conséquence.** document.querySelectorAll(".filter-btn") ramène les 13 boutons des trois onglets. Cliquer « En ligne » dans Articles déclenche aussi ce gestionnaire : currentReportFilter devient undefined (les boutons produits n'ont pas de data-filter), loadAdminReports() interroge status=eq.undefined et l'onglet Signalements affiche « Aucun signalement » alors que la file est pleine ; ses boutons perdent aussi leur surbrillance. Symétriquement, cliquer un filtre de signalement retire .active des filtres Articles et Utilisateurs : au prochain appel, loadAdminProducts (ligne 373) ne trouve plus de bouton actif et repasse silencieusement sur « Tous ».

**Correction proposée.** Restreindre le sélecteur au conteneur des signalements, par exemple document.querySelectorAll("#tab-admin-reports .filter-btn"), comme c'est déjà fait pour #admin-product-status-filter et #admin-user-status-filter.

**Statut.** OPEN

### A24 · notable · `product.js:601`

**Constat.** Le bouton Favori bascule son affichage sans jamais lire l'erreur de l'insert ou du delete Supabase

**Conséquence.** insert() et delete() sont appelés sans destructurer { error } : le coeur se remplit et le libellé passe à « Ajouté aux favoris » même quand l'écriture échoue (RLS, contrainte d'unicité, coupure réseau). L'utilisateur croit son favori enregistré ; il a disparu au prochain chargement de la fiche et n'apparaît jamais dans l'onglet Favoris du compte, sans le moindre message.

**Correction proposée.** Récupérer { error } sur les deux appels, ne modifier l'affichage qu'en cas de succès, et afficher toastError sinon.

**Statut.** OPEN

### A25 · notable · `index.html:472`

**Constat.** La modale de connexion n'offre aucun moyen de récupérer un mot de passe oublié

**Conséquence.** Le panneau #panel-login (répliqué à l'identique sur les 12 pages) ne contient qu'e-mail, mot de passe et « Se connecter ». Aucun appel à sb.auth.resetPasswordForEmail n'existe dans le dépôt, et aucune clé i18n de type auth.forgot n'est prévue. Un membre qui oublie son mot de passe est définitivement enfermé dehors : il ne peut plus accéder à ses annonces, à ses commandes ni à sa messagerie, et son seul recours est d'écrire à contact@athenamilitaria.fr.

**Correction proposée.** Ajouter un lien « Mot de passe oublié » sous #btnLogin, qui appelle sb.auth.resetPasswordForEmail(email, { redirectTo }) et une page de définition du nouveau mot de passe.

**Statut.** VERIFIED

### A26 · notable · `script.js:915`

**Constat.** L'enregistrement en brouillon avale les échecs d'envoi de photos et annonce quand même « Brouillon enregistré »

**Conséquence.** Dans le gestionnaire de #draftBtn, le test if (!uploadError) se contente d'ignorer les photos dont l'envoi a échoué : aucune ne remonte à l'utilisateur. Le brouillon est inséré avec image_url à null et un tableau image_urls incomplet, puis toastSuccess annonce la réussite. Le vendeur revient plus tard sur un brouillon amputé de tout ou partie de ses photos, sans jamais avoir vu d'erreur. Le chemin de publication (ligne 827) traite pourtant le même cas correctement, en s'arrêtant et en affichant l'erreur.

**Correction proposée.** Aligner sur la publication : sur uploadError, afficher toastError et interrompre, ou au minimum avertir du nombre de photos non enregistrées avant d'insérer le brouillon.

**Statut.** OPEN

### A27 · notable · `backups/db/production-2026-08-13/schema.sql:5478`

**Constat.** En production, products n'a aucune policy SELECT pour son propriétaire : les brouillons sont invisibles à leur auteur et à l'administration

**Conséquence.** Les seules policies SELECT sur products en production sont « Lecture publique des annonces visibles » (status published, ou sold depuis moins de 7 jours) et « Order parties can read product ». La policy « Lecture de ses propres brouillons » définie dans supabase_setup.sql:47 n'a jamais été posée sur la production, alors qu'elle existe bien dans la base locale de test (backups/db/local-2026-08-13/schema.sql:2635) : les tests passent, la production est cassée. Conséquence concrète : script.js:939 insère l'annonce avec status 'draft' et l'insertion réussit (supabase-js envoie return=minimal, donc aucun SELECT n'est requis), le toast « Brouillon enregistré » s'affiche, mais loadMyListings (account.js:318) ne peut plus jamais lire la ligne. Le brouillon disparaît définitivement, sans erreur ni trace pour l'utilisateur, et le filtre « Brouillons » d'account.js:1275 ne renvoie jamais rien. Même angle mort pour l'administration : ADD_ADMIN.sql donne aux admins UPDATE et DELETE sur products mais aucun SELECT, donc un article signalé qui n'est pas publié ne peut pas être examiné.

**Correction proposée.** Créer sur la production CREATE POLICY "Lecture de ses propres brouillons" ON public.products FOR SELECT TO authenticated USING (auth.uid() = user_id); (sans restreindre à draft, pour couvrir aussi les vendus de plus de 7 jours) et une policy SELECT admin symétrique des policies UPDATE/DELETE de ADD_ADMIN.sql. Verrouiller l'écart en rejouant le diff dépôt/production plutôt qu'en éditant au dashboard.

**Statut.** OPEN

### A28 · notable · `ADD_ADMIN.sql:30`

**Constat.** ADD_ADMIN.sql redéfinit profiles_prevent_self_unblock sans la protection des colonnes Stripe ni la sortie service_role

**Conséquence.** Ce fichier porte en tête « À exécuter dans SQL Editor de Supabase : copie tout, colle, RUN », et le projet passe effectivement tout le SQL par le dashboard. Or son CREATE OR REPLACE écrase la version durcie actuellement en production (backups/db/production-2026-08-13/schema.sql:1520) et fait disparaître deux protections : les lignes NEW.stripe_account_id / stripe_onboarded / stripe_onboarded_at := OLD.*, et la sortie anticipée pour service_role et current_user. Après une réexécution, n'importe quel membre connecté peut faire PATCH /rest/v1/profiles?id=eq.<son id> {"stripe_account_id":"acct_...","stripe_onboarded":true} et se déclarer éligible au versement sans avoir passé l'onboarding Connect : orders_ready_for_payout ne teste que p.stripe_account_id IS NOT NULL AND p.stripe_onboarded. Et le blocage du service_role réintroduit est exactement la panne d'avril que 20260426000001_profiles_trigger_fix.sql avait corrigée : connect-onboard ne peut plus écrire le compte Stripe.

**Correction proposée.** Supprimer le bloc CREATE OR REPLACE FUNCTION de ADD_ADMIN.sql, ou le remplacer par la version de 20260813000000_stripe_hardening.sql section 8 ter. Plus généralement, sortir ces scripts « à rejouer » de la racine du dépôt et n'appliquer que des migrations horodatées, sinon chaque exécution rejoue un état d'avril sur une base d'août.

**Statut.** OPEN

### A29 · notable · `ADMIN_SETUP.sql:29`

**Constat.** reports accepte des insertions anonymes avec WITH CHECK (true) : toutes les colonnes sont fournies par le client

**Conséquence.** La policy autorise anon et authenticated à insérer n'importe quelle ligne, sans aucune condition. product.js:821-826 remplit reporter_id et reporter_email depuis la session, mais rien en base ne l'impose : un appel direct POST /rest/v1/reports avec la clé anon publique permet de fabriquer un signalement attribué à reporter_id = <uuid d'un membre> et reporter_email = son adresse, que les deux administrateurs liront comme authentique dans admin.js:135 et account.js:1206. Le même appel permet aussi de forcer status, resolved_at et resolved_by, donc d'insérer des signalements déjà marqués « resolved » pour les cacher de la file d'attente. Aucun plafond ne s'applique (rate_limit_hit n'est appelée que par les fonctions edge) : une boucle anonyme noie la modération et fait grossir la table sans limite.

**Correction proposée.** Remplacer WITH CHECK (true) par WITH CHECK (reporter_id IS NOT DISTINCT FROM auth.uid() AND status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL), et retirer reporter_email de l'insertion cliente (le déduire par trigger depuis auth.uid()). Ajouter un index unique partiel sur (product_id, reporter_id) pour plafonner un signalement par article et par compte.

**Statut.** OPEN

### A30 · notable · `supabase/functions/message-notify/index.ts:104`

**Constat.** L'e-mail de notification recopie le corps du message et l'identifiant d'annonce fournis par l'appelant, sans les vérifier ni les échapper dans le lien

**Conséquence.** `content` (ligne 20) n'est jamais comparé au message réellement enregistré : le contrôle ligne 42 vérifie seulement qu'un message quelconque a été envoyé au destinataire dans les deux dernières minutes. Et `productId` est concaténé brut dans replyUrl ligne 104, puis posé dans un attribut href ligne 137 sans escapeHtml, alors que tout le reste du gabarit est échappé. Un attaquant authentifié envoie un « bonjour » à sa cible, puis rappelle la fonction avec le texte de son choix et productId = `0"><a href="https://faux-athena.tld">Régularisez votre paiement</a><span x="`. Le destinataire reçoit un courriel authentifié DKIM depuis noreply@athenamilitaria.fr, au gabarit exact de la plateforme, contenant un texte et un lien entièrement rédigés par l'attaquant. C'est une primitive d'hameçonnage adossée à la réputation du domaine.

**Correction proposée.** Ne plus accepter `content` : relire le contenu du dernier message en base (lastMsg) et n'afficher que celui-là. Valider productId en entier positif avant usage, et l'insérer via encodeURIComponent dans l'URL. Aligner aussi le CORS ligne 5 sur corsHeaders() de _shared/payments.ts, comme create-checkout.

**Statut.** VERIFIED

### A31 · notable · `ADMIN_SETUP.sql:32`

**Constat.** N'importe qui, même non connecté, peut insérer un nombre illimité de signalements avec un rapporteur et un statut de son choix

**Conséquence.** La policy « Anyone can report » est `TO anon, authenticated WITH CHECK (true)` : aucune colonne n'est contrainte, aucun débit n'est limité. Avec la seule clé anon (publique par conception, visible dans supabaseClient.js), un script écrit directement dans public.reports autant de lignes qu'il veut, en choisissant reporter_id, reporter_email, status et resolved_by. Trois conséquences concrètes : saturation de la table et du quota Supabase sans aucun compte ; noyade du panneau de modération (admin.js le charge sans pagination, ligne 155) qui devient inutilisable ; et attribution de faux signalements à un membre nommément désigné, puisque reporter_id est fourni par le client alors que product.js ligne 825 le renseigne de bonne foi.

**Correction proposée.** Restreindre à `TO authenticated` avec `WITH CHECK (reporter_id = auth.uid() AND status = 'pending' AND resolved_by IS NULL)`, et poser un index unique partiel (reporter_id, product_id) pour un seul signalement par membre et par annonce. Ajouter un appel à rate_limit_hit si le signalement doit rester ouvert aux visiteurs.

**Statut.** OPEN

### A32 · notable · `supabase/migrations/20260705000000_newsletter.sql:29`

**Constat.** Le secret qui authentifie l'envoi de la newsletter est écrit en clair dans une migration versionnée

**Conséquence.** La tâche pg_cron porte `{"secret": "b23795b6d0eda9fb83aa0233d765214d5a410605ef0c7b32"}` en dur. weekly-newsletter est déployée en --no-verify-jwt (commentaire ligne 8) : ce secret est sa seule authentification, ligne 12 de la fonction. Quiconque lit le dépôt — clone, sauvegarde, fork, poste compromis, publication du dépôt — peut déclencher un envoi de masse à tous les membres opt-in, autant de fois qu'il veut. Résultat : quota Resend épuisé (90 envois par passage, plan gratuit à 100/jour), membres spammés, domaine athenamilitaria.fr signalé par les fournisseurs de messagerie. Le même fichier expose ligne 29 le seul verrou de l'endpoint ; la migration 20260810000000 expose de la même façon le jeton de rafraîchissement du sitemap.

**Correction proposée.** Faire pour ce secret ce que 20260813000300_cron_secret_vault.sql fait déjà pour les paiements : le déposer dans Vault et remplacer le corps littéral par un appel à une fonction de lecture. Puis faire tourner la valeur côté fonction edge, l'ancienne étant à considérer comme compromise.

**Statut.** OPEN

### A33 · notable · `supabase/functions/translate-listing/index.ts:60`

**Constat.** La traduction DeepL est rappelable en boucle sur la même annonce, sans limitation de débit ni garde de fraîcheur

**Conséquence.** La fonction lit `translated_at` ligne 39 mais ne s'en sert jamais : chaque appel repart chez DeepL, quel que soit le nombre de traductions déjà faites. Aucun rate_limit_hit, contrairement à create-checkout (10/min), checkout-status (30/min) et connect-onboard (5/h). Le propriétaire d'une seule annonce — un compte gratuit suffit à en publier une — boucle sur l'endpoint et consomme les 500 000 caractères mensuels du plan DeepL Free en quelques minutes, avec une description longue. La traduction anglaise cesse alors de fonctionner pour tout le monde, sans erreur visible ailleurs ; sur une clé payante, chaque appel est facturé.

**Correction proposée.** Ajouter `rate_limit_hit` avec un seau `translate:<user.id>` (quelques appels par heure suffisent, la traduction est une opération de publication), et refuser tôt si `translated_at` est récent et que ni title ni description n'ont changé depuis.

**Statut.** OPEN

### A34 · notable · `account.js:111`

**Constat.** Changement de mot de passe sans mot de passe actuel et sans champ de confirmation

**Conséquence.** Sur une session laissée ouverte (ordinateur partagé, poste non verrouillé, machine volée), un tiers change le mot de passe en deux clics et prend le compte définitivement : combiné à l'absence de parcours de récupération, le propriétaire légitime n'a aucun moyen de reprendre la main, y compris s'il a des ventes en cours et un compte Stripe Connect rattaché. Le champ unique rend aussi une simple faute de frappe irréversible.

**Correction proposée.** Activer « Secure password change » côté Supabase (réauthentification obligatoire) ou redemander le mot de passe actuel via signInWithPassword avant l'appel, ajouter un second champ de confirmation, et déconnecter les autres sessions après le changement.

**Statut.** OPEN

### A35 · notable · `index.html:461`

**Constat.** Les panneaux d'inscription et de connexion ne sont pas dans un <form> : la touche Entrée ne valide rien et les contrôles HTML sont inertes

**Conséquence.** Les champs portent required, type="email" et minlength, mais ces contraintes ne s'évaluent qu'à la soumission d'un formulaire : sans <form>, elles ne s'exécutent jamais. Une adresse mal formée part telle quelle au serveur et revient en erreur technique anglaise. Surtout, aucun gestionnaire de touche Entrée n'existe dans script.js : un utilisateur qui tape son mot de passe et appuie sur Entrée ne déclenche rien, l'écran reste figé et il croit le site en panne.

**Correction proposée.** Envelopper chaque panneau dans un <form> avec les boutons en type="submit", brancher les gestionnaires sur l'événement submit, et ajouter autocomplete="current-password" / "new-password" pour que les gestionnaires de mots de passe proposent l'enregistrement.

**Statut.** OPEN

### A36 · notable · `account.js:680`

**Constat.** Remplacer la photo d'une annonce écrit image_url mais jamais image_urls : l'ancienne photo reste celle qui s'affiche

**Conséquence.** L'update ne contient que image_url. Or product.js:301 privilégie image_urls[] dès qu'il est non vide, ce qui est le cas de toute annonce publiée depuis sell.html (script.js:851 remplit toujours le tableau). Le vendeur voit sa nouvelle photo dans l'aperçu de la modale, reçoit « Enregistré », et la fiche produit continue d'afficher l'ancienne, y compris en photo principale de la galerie. Cas concret : une photo laissant apparaître une adresse, un nom ou une pièce d'identité en arrière-plan reste publiquement visible alors que le vendeur croit l'avoir remplacée. Le fichier d'origine n'est en outre jamais supprimé du bucket public.

**Correction proposée.** Dans saveEditedListing, reconstruire image_urls (remplacer l'entrée correspondante ou repositionner la nouvelle en tête) en plus de image_url, et supprimer l'ancien objet du bucket product-images.

**Statut.** OPEN

### A37 · notable · `backups/db/production-2026-08-13/schema.sql:5708`

**Constat.** La policy d'envoi vers le bucket public product-images n'est pas cloisonnée par dossier utilisateur

**Conséquence.** « Upload par utilisateur connecté » ne teste que bucket_id = 'product-images', alors que la policy de suppression (ligne 5701) teste bien (storage.foldername(name))[1] = auth.uid(). N'importe quel compte gratuit peut donc écrire un fichier quelconque, de n'importe quel type MIME (le contentType vient du client, script.js:826) et sans plafond de taille côté policy, dans le dossier de n'importe quel autre vendeur. Les UUID des vendeurs sont publics : le catalogue fait .select("*") sur products (script.js:1222), user_id compris. Un attaquant héberge donc gratuitement du contenu arbitraire sur le domaine Supabase du projet, à la bande passante du projet, sous l'identité d'un vendeur innocent qui est le seul non administrateur à pouvoir le supprimer et qui ignore son existence.

**Correction proposée.** Recréer la policy INSERT avec WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text), et fixer allowed_mime_types plus file_size_limit sur le bucket.

**Statut.** OPEN

### A38 · notable · `account.js:679`

**Constat.** La modification d'une annonce ne redéclenche jamais la traduction : la version anglaise reste figée sur l'ancien texte

**Conséquence.** La publication appelle requestListingTranslation (script.js:865), pas l'édition. title_en et description_en gardent donc le texte d'origine, et product.js:315-317 les préfère systématiquement quand le visiteur est en EN. Un vendeur qui corrige « original » en « reproduction », change l'état de conservation ou retire une mention erronée continue de vendre le texte fautif à tout visiteur anglophone, sans aucun moyen de s'en apercevoir puisque son propre compte est en français.

**Correction proposée.** Après un update réussi, si title ou description a changé, rappeler translate-listing ; à défaut, vider title_en, description_en et translated_at pour retomber sur le français.

**Statut.** OPEN

### A39 · notable · `account.js:851`

**Constat.** Aucune trace figée de ce qui a été vendu : le vendeur peut réécrire l'annonce pendant que l'argent est sous séquestre

**Conséquence.** orders ne conserve que product_id et des montants (aucune colonne titre, description ou photo dans le schéma de production). « Mes achats » (account.js:851) et « Mes ventes » (account.js:929) lisent products(title, image_url) en direct, et rien n'interdit un UPDATE sur un produit déjà payé : la policy « Modification de ses propres annonces » ne teste que la propriété. Comme le versement n'a lieu qu'après confirmation de réception par l'acheteur, le vendeur dispose de toute la fenêtre de litige pour transformer « Casque Adrian 1915, 800 € » en un objet quelconque avec une autre photo. L'acheteur qui ouvre un litige, l'administrateur qui l'arbitre et la commande elle-même affichent alors la version réécrite par la partie mise en cause. La preuve de ce qui a été acheté n'existe pas.

**Correction proposée.** Copier titre, description, photo principale et prix dans la commande au moment de checkout_reserve, et afficher cet instantané partout dans les pages achats, ventes et litiges.

**Statut.** OPEN

### A40 · notable · `account.js:409`

**Constat.** Supprimer une annonce ne nettoie qu'une photo sur six du stockage public

**Conséquence.** deleteListing ne découpe que product.image_url et ignore image_urls[]. Les cinq autres photos restent indéfiniment accessibles en lecture publique (policy « Images publiques en lecture », schema.sql:5694) après que le vendeur a supprimé l'annonce, alors que la suppression est précisément le geste par lequel il retire une pièce de la vue. Elles restent aussi indexables et facturées au projet. Accessoirement, la suppression échoue en bloc dès qu'une commande existe (orders.product_id référence products sans ON DELETE, 20260413_create_orders.sql:4) et l'erreur Postgres brute est affichée telle quelle au vendeur.

**Correction proposée.** Construire la liste à supprimer depuis image_urls (avec repli sur image_url) et la passer en un seul appel storage.remove. Traiter le cas foreign_key_violation par un message expliquant qu'une annonce liée à une commande se dépublie au lieu de se supprimer.

**Statut.** OPEN

### A41 · notable · `supabase/functions/translate-listing/index.ts:38`

**Constat.** Traduction déclenchable en boucle sur une description sans longueur maximale

**Conséquence.** La fonction vérifie la propriété de l'annonce mais n'a ni limitation de débit ni cache : elle retraduit à chaque appel, même si translated_at vient d'être écrit (le champ est lu ligne 40 mais jamais testé). Rien ne borne non plus la description côté serveur : la contrainte est un textarea sans maxlength (sell.html:266) et la colonne est un text nu. Un seul compte peut donc publier une annonce de 100 000 caractères et rappeler l'endpoint en boucle : le quota DeepL, partagé par tout le site, est épuisé en quelques minutes et plus aucune annonce ne se traduit, pour personne.

**Correction proposée.** Court-circuiter si translated_at est récent et que le texte n'a pas changé, passer par rate_limit_hit comme create-checkout, et plafonner titre et description en base (CHECK sur length) autant que dans les deux formulaires.

**Statut.** OPEN

### A42 · notable · `supabase/migrations/20260813000200_buyer_protection_pricing.sql:766`

**Constat.** Un litige ouvert avant l'encaissement fait court-circuiter order_settle_payment : ni paid_at, ni décrément de stock, ni email

**Conséquence.** order_report_dispute autorise le statut 'payment_pending' (il n'est pas dans la liste interdite de stripe_hardening.sql:1111). Une commande passée en 'payment_pending' par checkout.session.completed puis mise en 'disputed' par l'acheteur tombe, à l'arrivée de async_payment_succeeded, dans la branche de sortie anticipée « déjà encaissée » qui teste status IN (...,'disputed',...). La fonction retourne first_time=false sans jamais poser paid_at, sans décrémenter products.quantity, sans passer l'article en 'sold' et sans libérer reserved_qty. L'argent est encaissé chez Stripe, l'article reste 'published' donc rachetable par un tiers, reserved_qty reste incrémenté à vie (checkout_expire_stale ne traite que status='pending'), et aucun email de confirmation ne part. La commande est aussi invisible du versement et de la réconciliation, qui exigent paid_at NOT NULL.

**Correction proposée.** Interdire 'payment_pending' dans order_report_dispute (le litige ne se conçoit qu'après encaissement), et faire poser paid_at et le décrément de stock par order_settle_payment même quand le statut métier a déjà avancé.

**Statut.** OPEN

### A43 · notable · `supabase/migrations/20260813000200_buyer_protection_pricing.sql:531`

**Constat.** Un acheteur simplement silencieux gèle définitivement le versement du vendeur : manual_review est posé avec needs_review, et rien ne les lève

**Conséquence.** C'est le cas nominal d'un acheteur qui reçoit son colis et oublie de cliquer. Au bout de 14 jours, orders_flag_manual_review passe payout_state en 'manual_review' ET needs_review à true. Le trigger orders_guard_manual_review interdit d'en sortir hors service_role, et orders_ready_for_payout exige à la fois payout_state='pending' et NOT needs_review : même si l'acheteur confirme le lendemain, la commande ne réintègre jamais la file de versement. Aucun écran d'administration ne lève ces deux drapeaux (admin.js se contente de les afficher). Le vendeur voit « Versement en cours d'examen par notre équipe » pour toujours et n'est jamais payé, sur une vente pourtant parfaitement normale.

**Correction proposée.** Ajouter une fonction service_role de levée (payout_state → 'pending', needs_review → false) et un bouton dans le panneau d'administration ; faire aussi repasser une commande de 'manual_review' à 'pending' lorsque l'acheteur finit par confirmer.

**Statut.** OPEN

### A44 · notable · `supabase/functions/order-notify/index.ts:96`

**Constat.** order-notify est rejouable sans limite : le contrôle de statut n'empêche pas le renvoi en boucle du même email

**Conséquence.** Le commentaire en tête du fichier annonce que le contrôle de statut empêche « qu'un acheteur le rappelle en boucle et inonde le vendeur ». Il n'empêche rien : la garde vérifie seulement que la commande porte déjà le statut correspondant, ce qui reste vrai indéfiniment. Un acheteur détenant une commande 'completed' peut boucler sur l'endpoint et envoyer autant d'emails « Vente validée » qu'il veut à l'adresse personnelle du vendeur ; sur une commande 'disputed' chaque appel envoie en plus un email à contact@athenamilitaria.fr. Aucun appel à rate_limit_hit ici, contrairement à checkout-status qui le fait (checkout-status/index.ts:116), et aucune trace « notification déjà envoyée ». Le quota Resend et la réputation du domaine expéditeur y passent.

**Correction proposée.** Appeler rate_limit_hit sur un bucket order-notify:{user.id} et enregistrer sur la commande la date d'envoi de chaque type de notification, pour ne l'émettre qu'une fois.

**Statut.** VERIFIED

### A45 · notable · `account.html:150`

**Constat.** La page « Mon compte » annonce au vendeur une commission de 8 % alors que la même page affiche « Aucun frais, aucune commission »

**Conséquence.** L'onglet Paramètres affiche « les fonds de tes ventes sont versés automatiquement (commission de 8% sur le prix de l'article, 0% sur les frais de port) », texte repris à l'identique en anglais dans i18n.js:505 et 1465. L'onglet Mes ventes de la même page affiche, lui, « Vous recevrez X » puis « Aucun frais, aucune commission : vous touchez 100 % du prix et du port » (account.js:959). En base, platform_fee_rate a été mis à 0 et la contrainte orders_no_seller_commission_check interdit toute commission vendeur. Le vendeur lit deux montants contradictoires sur un seul écran et ne peut pas savoir ce qu'il touchera ; le texte affirmant « versés automatiquement » est en plus faux, le versement dépend de la confirmation de l'acheteur.

**Correction proposée.** Réécrire tr_account.stripe_text (FR et EN) : zéro commission vendeur, et versement après confirmation de réception par l'acheteur puis 48 heures.

**Statut.** VERIFIED — même clé i18n que ci-dessus, commit 44f6dd1

### A46 · notable · `supabase/functions/message-notify/index.ts:20`

**Constat.** Le corps de l'e-mail de notification est fourni par le client et l'envoi est rejouable à l'infini

**Conséquence.** Le champ `content` du POST est envoyé tel quel dans l'e-mail (ligne 103), il n'est jamais relu depuis la ligne `messages`. Et le garde anti-spam (lignes 55-64) ne compte que les messages ANTÉRIEURS au dernier message : après avoir inséré UN seul message anodin, l'attaquant rappelle l'endpoint autant de fois qu'il veut, le compteur reste à 0 et chaque appel part. Résultat : bombardement illimité de la boîte de la victime, avec à chaque fois 800 caractères arbitraires signés noreply@athenamilitaria.fr (SPF/DKIM du domaine), pendant que le message réellement stocké dans la messagerie reste anodin — donc invisible à toute modération. Support d'hameçonnage prêt à l'emploi et risque direct pour la réputation d'envoi du domaine.

**Correction proposée.** Ne plus accepter `content` : recevoir l'id du message, le relire côté serveur avec le client admin en vérifiant sender_id = appelant, et poser un verrou d'envoi durable (colonne notified_at sur messages, ou la table rate_limits déjà présente) au lieu d'une fenêtre glissante calculée sur les messages.

**Statut.** VERIFIED

### A47 · notable · `supabase/functions/order-notify/index.ts:96`

**Constat.** Le garde de order-notify est un état permanent, pas une idempotence : chaque événement est renvoyable en boucle

**Conséquence.** Le contrôle est « la commande doit déjà porter le statut correspondant ». Or ce statut reste vrai indéfiniment après la transition. Un acheteur qui a confirmé la réception peut donc rappeler /functions/v1/order-notify avec event=completed autant de fois qu'il veut : le vendeur reçoit autant d'e-mails « Vente validée ». Avec event=disputed, chaque appel envoie un e-mail au vendeur ET un à contact@athenamilitaria.fr (ligne 141) : la boîte de support se noie sur commande. Le commentaire d'en-tête annonce précisément que ce rejeu a été corrigé, il ne l'est pas.

**Correction proposée.** Rendre l'envoi idempotent : colonnes notified_shipped_at / notified_completed_at / notified_disputed_at sur orders posées par l'endpoint (ou une entrée rate_limits par couple commande+événement), et retour ok sans envoi si déjà notifié.

**Statut.** VERIFIED

### A48 · notable · `messages.js:171`

**Constat.** Toutes les annonces échangées avec un même membre sont fusionnées dans un fil unique, rattaché à la mauvaise annonce

**Conséquence.** Le regroupement se fait sur le seul partenaire (`convos[partnerId]`), et loadMessages (lignes 355-362) ne filtre pas non plus sur product_id. Deux négociations avec le même vendeur sur deux pièces différentes se retrouvent donc dans un seul fil, dont le titre et la vignette prennent l'annonce du message le plus récent (ligne 177). Pire : toute réponse envoyée depuis ce fil est enregistrée avec ce product_id (ligne 315), donc rattachée à la mauvaise annonce, et l'e-mail de notification affiche la carte du mauvais article. Le vendeur lit « à propos de : Casque Adrian » un message qui parle d'une baïonnette.

**Correction proposée.** Clé de conversation (partenaire, product_id) pour le groupement, le chargement des messages et le fil affiché ; garder un fil « sans annonce » pour les messages historiques dont product_id est nul.

**Statut.** OPEN

### A49 · notable · `admin.js:758`

**Constat.** La suppression des annonces d'un utilisateur n'est pas vérifiée avant de supprimer son profil

**Conséquence.** Le retour de products.delete().eq("user_id", uid) est ignoré. Si l'utilisateur a déjà vendu ou seulement reçu une réservation, la contrainte FK orders.product_id fait échouer ce DELETE ; le code enchaîne néanmoins sur la suppression du profil, qui réussit, et affiche « Profil supprimé ». Les annonces restent publiées et achetables, désormais rattachées à un user_id sans profil, donc introuvables par la recherche de la liste utilisateurs. Combiné au constat n°1, le vendeur écarté conserve ses annonces en ligne et le droit d'en publier de nouvelles. Même omission à account.js:1631.

**Correction proposée.** Tester l'erreur du premier DELETE et interrompre l'opération en l'expliquant, ou déplacer toute la séquence dans une edge function en service_role qui s'exécute en une transaction.

**Statut.** OPEN

### A50 · notable · `supabase/functions/message-notify/index.ts:62`

**Constat.** L'anti-spam de message-notify ne compte que les messages, pas les envois : un seul message permet un nombre illimité de courriels

**Conséquence.** recentCount compte les messages antérieurs à lastMsg. Après un unique message, ce compte vaut zéro, et il le reste : l'appelant peut rejouer l'endpoint autant de fois qu'il veut pendant les deux minutes de validité de lastMsg, chaque appel produisant un courriel complet vers le destinataire. Aucune trace de l'envoi n'est conservée, aucune limite de débit n'existe sur cette fonction. Combiné au constat sur productId, cela donne un flot d'hameçonnages et non un seul.

**Correction proposée.** Déduire l'anti-spam de l'envoi et non du message : consigner message_id notifié dans une table avec index unique, et refuser si lastMsg.id y figure déjà. Ajouter un rate_limit_hit par expéditeur.

**Statut.** VERIFIED

### A51 · notable · `supabase/functions/payments-monitor/index.ts:50`

**Constat.** Le mailer de payments-monitor avale tout échec, y compris celui de l'alerte critique et des confirmations d'achat qu'il réémet

**Conséquence.** Le fetch se termine par .catch(() => {}) et le code ne lit jamais res.ok. Ce mailer sert deux choses qui comptent : le digest d'anomalies critiques envoyé à l'exploitant (l.387) et, via deps.sendEmail, les confirmations d'achat et de vente réémises quand le moniteur rattrape une commande restée en payment_pending (fulfillment.ts l.194 et l.216). Un 403 pour domaine non vérifié, un 429 de quota ou une coupure réseau ne laissent strictement aucune ligne de journal : l'exploitant croit être surveillé alors que plus aucune alerte ne sort, et l'acheteur rattrapé n'a jamais eu sa confirmation.

**Correction proposée.** Reprendre le mailer de stripe-webhook (l.79-84) : tester res.ok, journaliser email_failed avec le statut et le corps redacté, et journaliser email_sent en cas de succès. Retirer le .catch silencieux ou l'accompagner d'un logEvent.

**Statut.** OPEN

### A52 · notable · `i18n.js:467`

**Constat.** La page À propos promet que les fonds sont sécurisés « jusqu'à la confirmation de l'expédition », alors que la séquestre court jusqu'à la confirmation de réception

**Conséquence.** tr_about.security_pay_text (FR l.467, EN l.1427 « until shipment is confirmed ») décrit à l'acheteur une protection qui s'arrête au moment où le vendeur déclare avoir expédié. C'est plus court, et donc moins protecteur, que la règle réellement appliquée. La contradiction est interne à la même page : tr_about.faq_a4 (i18n.js:493 / 1453) dit « Le paiement reste bloqué tant que vous n'avez pas validé la bonne réception », et tr_js_product.bd_protection_note (i18n.js:355 / 1315) le redit sur la fiche produit. Un acheteur qui n'a rien reçu et qui a lu la section Sécurité croira que la plateforme a déjà libéré l'argent au vendeur, et n'ouvrira pas le litige qui lui est ouvert.

**Correction proposée.** Aligner tr_about.security_pay_text FR et EN sur la règle réelle : les fonds restent séquestrés jusqu'à la confirmation de réception par l'acheteur, qui dispose ensuite de 48 heures pour signaler un problème.

**Statut.** OPEN

### A53 · notable · `i18n.js:464`

**Constat.** Un droit de rétractation de 14 jours est promis sans condition sur une place de marché entre particuliers, où il n'existe pas

**Conséquence.** tr_about.step6_title/step6_text (i18n.js:463-464 / 1423-1424) affirment « Comme l'exige la loi française, vous disposez d'un droit de rétractation de 14 jours », tr_about.faq_a5 (i18n.js:495 / 1455) le répète, et tr_legal.s3_6_body1 (i18n.js:657 / 1617) le fonde sur l'article L221-18. Or L221-18 ne s'applique qu'aux contrats conclus entre un professionnel et un consommateur : entre deux particuliers, qui sont la cible affichée du site (« achat/vente entre collectionneurs », seo.index.desc i18n.js:45), l'acheteur n'a aucun droit de rétractation. Le site le sait à moitié, puisque tr_legal.s3_7_note (i18n.js:663) restreint déjà les garanties au seul Code civil pour les transactions entre particuliers, sans restreindre la rétractation. L'engagement est en outre déclaré à Google sur chaque fiche : product.js:269-276 publie un hasMerchantReturnPolicy avec merchantReturnDays 14, et product.js:259 déclare Athena Militaria comme « seller ». Conséquence concrète : un acheteur exige un retour sous 14 jours, le vendeur particulier refuse à bon droit, et la plateforme se retrouve à devoir honorer sur ses fonds une promesse qu'elle a faite à la place du vendeur.

**Correction proposée.** Conditionner la promesse à la qualité du vendeur dans les trois textes visibles et dans les CGV : rétractation de 14 jours pour les vendeurs professionnels, absence de droit de rétractation entre particuliers avec renvoi aux garanties du Code civil. Ajuster en conséquence le JSON-LD de product.js, qui ne doit pas déclarer une politique de retour uniforme ni la plateforme comme vendeur.

**Statut.** OPEN

### A54 · notable · `category.html:225`

**Constat.** Le bloc éditorial du catalogue, environ 350 mots, n'a aucun attribut data-i18n et reste en français en version anglaise

**Conséquence.** La section #catalogue-guide (category.html:225 à 268) contient trois titres et trois paragraphes rédigés en dur, sans data-i18n : « Le catalogue militaria d'Athena Militaria », « Les périodes couvertes », « Acheter en confiance ». Sur /category?lang=en, tout l'entourage est traduit (filtres, en-tête, pied de page) mais ces 350 mots restent en français. Le défaut est multiplié par 17 : build-categories.js recopie le même schéma dans les seize pages de categories/, où le bloc contexte est lui aussi sans data-i18n (par exemple categories/guerre-froide.html:222-233, zéro attribut data-i18n entre les marqueurs contexte:debut et contexte:fin), et la règle 5 quater du .htaccess sert ces fichiers sans tenir compte du paramètre lang. À comparer avec les guides, pour lesquels le problème a été traité proprement par des fichiers guides/en/ et deux règles .htaccess dédiées.

**Correction proposée.** Appliquer aux catégories la solution déjà retenue pour les guides : générer par build-categories.js une variante anglaise dans categories/en/ et ajouter la condition lang=en dans le .htaccess avant les règles françaises, ou à défaut sortir ces textes vers des clés i18n.

**Statut.** OPEN

### A55 · notable · `script.js:1558`

**Constat.** Presque toutes les dates sont formatées en fr-FR en dur : en anglais, les mois s'affichent en français au milieu de phrases traduites

**Conséquence.** window.timeAgo traduit correctement « il y a 3 jours » par clés, puis retombe sur toLocaleDateString("fr-FR") au-delà de 30 jours : un visiteur anglophone lit « 12 août 2026 » à l'endroit exact où il lisait « 3 days ago » la veille. Le même codage en dur se retrouve sur toutes les surfaces à forte fréquentation : product.js:965 affiche « Member since août 2026 » sous le vendeur, messages.js:568 pose des séparateurs de jour « 12 août » dans une messagerie par ailleurs traduite, messages.js:220/401/404/681 pour les heures et dates de conversation, product.js:1012 pour les dates d'avis, account.js:40 pour l'ancienneté du compte. Le fichier account.js prouve que le problème est connu et à moitié corrigé : fmtDate (account.js:153) et la ligne de commande (account.js:801) choisissent bien en-GB quand la langue est l'anglais, si bien que la page Mon compte affiche une date anglaise et une date française côte à côte.

**Correction proposée.** Extraire l'helper déjà présent dans account.js:153 vers script.js, l'exposer globalement et remplacer les dix-sept appels toLocaleDateString/toLocaleTimeString("fr-FR") des fichiers front par cet helper, qui lit I18N.current.

**Statut.** OPEN

### A56 · notable · `product.js:372`

**Constat.** La période et l'état de l'article sont affichés avec la valeur française brute de la base, à côté de filtres traduits

**Conséquence.** product.js:372 rend product.period tel quel et product.js:368 fait de même pour product.condition. Ces valeurs sont stockées en français (« 2nde Guerre Mondiale », « Très bon état »). En anglais, la fiche produit affiche donc « Period: 2nde Guerre Mondiale » : le libellé est traduit, la valeur non. Le dictionnaire contient pourtant déjà les traductions (cat.ww2 = « World War II », i18n.js:1700), et la barre latérale du catalogue s'en sert (category.html:131), si bien que le filtre coché s'appelle « World War II » et que la fiche qu'il ouvre annonce « 2nde Guerre Mondiale ». Un acheteur anglophone ne peut pas relier les deux, et la même incohérence apparaît sur les badges des articles similaires (product.js:905) et dans le fil d'Ariane. Le titre et la description de l'annonce, eux, sont bien traduits (product.js:316-317).

**Correction proposée.** Réutiliser la table de correspondance déjà présente dans script.js:1041-1065 (valeur base vers clé cat.*) pour traduire period, subcategory et condition à l'affichage, et ajouter les clés d'état de conservation qui manquent au dictionnaire.

**Statut.** OPEN

### A57 · notable · `product.html:85`

**Constat.** `aria-live="polite"` enveloppe la totalité de la fiche produit

**Conséquence.** `#product-container` porte `aria-live="polite"` alors que product.js ligne 345 y injecte la page entière : fil d'Ariane, prix, H1, description du vendeur, liste des caractéristiques, carte vendeur, options de livraison. À la fin du chargement, le lecteur d'écran lit donc l'intégralité de la fiche d'une traite, sans que l'utilisateur l'ait demandé et sans pouvoir l'interrompre autrement qu'en quittant la page. Le phénomène se répète à chaque changement de langue, qui relance le rendu. Une région live doit annoncer un changement bref, pas le contenu principal.

**Correction proposée.** Retirer `aria-live` de `#product-container`. Mettre le message « Chargement du produit… » dans un petit `<p aria-live="polite">` séparé, vidé une fois la fiche rendue, et déplacer le focus sur le `<h1 class="p-title">` (avec `tabindex="-1"`) après l'injection. Même correctif pour order.html ligne 64.

**Statut.** OPEN

### A58 · notable · `index.html:186`

**Constat.** Le lien d'évitement n'existe que sur 3 pages sur 12

**Conséquence.** `.skip-link` est présent sur legal.html (ligne 124), about.html (146) et les guides, avec son CSS déjà écrit (style.css:2309). Il manque sur index, category, product, sell, community, account, messages, order, admin et 404. Conséquence concrète sur /category : avant d'atteindre la première annonce, l'utilisateur au clavier doit traverser à chaque chargement de page le logo, le champ de recherche, la messagerie, le hamburger, connexion, déconnexion, Vendre, Communauté, le bouton EN, puis les 4 groupes `<details>` de la barre latérale et leurs 13 sous-liens. Le `<main>` de index.html porte en outre `id="contenu"` et non `id="main-content"`, la cible attendue.

**Correction proposée.** Ajouter `<a href="#main-content" class="skip-link">Aller au contenu principal</a>` en première ligne de `<body>` sur les pages manquantes, et harmoniser l'identifiant du `<main>` sur `main-content` (index.html ligne 186). Le style existe déjà, aucune règle CSS à écrire.

**Statut.** OPEN

### A59 · notable · `style.css:3294`

**Constat.** `.faq-item summary { outline: none }` supprime le seul indicateur de focus de l'accordéon FAQ

**Conséquence.** La règle neutralise le contour natif des `<summary>` et rien ne le remplace : `summary:focus` et `summary:focus-visible` n'apparaissent nulle part dans les 12 000 lignes, et la règle globale de style.css ligne 2279 ne cible que `a`, `button`, `input`, `select`, `textarea` et `[role="button"]`. Sur les 6 questions `<details class="faq-item">` de about.html (à partir de la ligne 321), un utilisateur au clavier tabule donc à l'aveugle : rien à l'écran n'indique quelle question a le focus ni ce que la barre d'espace va déplier.

**Correction proposée.** Ajouter `.faq-item summary:focus-visible { outline: 2px solid #5b7fa8; outline-offset: 2px; border-radius: 6px; }`, ou plus simplement ajouter `summary` à la liste de sélecteurs de la règle globale ligne 2279 et supprimer le `outline: none` de la ligne 3294.

**Statut.** OPEN

### A60 · notable · `script.js:1447`

**Constat.** Le bouton hamburger ne publie jamais l'état du menu mobile

**Conséquence.** `openMenu` (1447) et `closeMenu` (1457) remplacent l'icône du bouton et basculent `aria-hidden` sur le tiroir, mais ne touchent jamais à `aria-expanded` sur le bouton, dont l'`aria-label` reste « Menu » ouvert comme fermé. Au lecteur d'écran sur mobile, rien ne distingue les deux états et le contenu du tiroir surgit sans annonce. Pire, legal.html ligne 136 écrit `aria-expanded="false"` en dur et aucun script ne le met à jour : sur cette page l'attribut affirme en permanence que le menu est fermé, y compris quand il est ouvert.

**Correction proposée.** Dans `openMenu` et `closeMenu`, faire `btn.setAttribute("aria-expanded", "true"/"false")`, ajouter `aria-controls` pointant sur l'identifiant du tiroir, et poser `aria-expanded="false"` dans le HTML de tous les hamburgers, pas seulement celui de legal.html.

**Statut.** OPEN

### A61 · notable · `messages.js:202`

**Constat.** Une requête Supabase par conversation, en série, pour récupérer les pseudos (N+1)

**Conséquence.** Le code juste au-dessus (ligne 190) récupère titres et photos de toutes les annonces en une seule requête `.in("id", productIds)`, puis la boucle d'affichage appelle `await getPartnerProfile(conv.partnerId)` conversation par conversation. Le cache est vide au premier chargement : 20 conversations = 20 allers-retours enchaînés vers public_profiles, soit 2 à 6 secondes de squelette figé sur un lien mobile, avant que la liste n'apparaisse. Le coût croît linéairement avec le nombre d'interlocuteurs.

**Correction proposée.** Faire une seule requête `.from("public_profiles").select("id, pseudo, avatar_url").in("id", [...partnerIds])` avant la boucle, remplir profileCache avec le résultat, puis rendre la boucle synchrone.

**Statut.** OPEN

### A62 · notable · `messages.js:153`

**Constat.** La liste des conversations télécharge l'intégralité des messages de l'utilisateur

**Conséquence.** `select("*")` sur messages avec un `.or(sender_id.eq…,receiver_id.eq…)` et aucune limite : tout l'historique, contenu des messages compris, transite pour ne servir qu'à regrouper par interlocuteur et compter les non-lus. Un compte actif avec quelques milliers de messages paie plusieurs centaines de Ko à chaque ouverture de /messages sur mobile ; et une fois le plafond max-rows de PostgREST atteint, les conversations les plus anciennes cessent purement et simplement d'apparaître dans la liste.

**Correction proposée.** Passer par une vue ou une fonction SQL qui renvoie déjà une ligne par conversation (dernier message, compteur de non-lus, product_id), au lieu de rapatrier les messages bruts côté navigateur.

**Statut.** OPEN

