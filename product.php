<?php
/* =====================================================================
   Fiche article, rendue côté serveur.

   product.html est un gabarit vide que product.js remplissait après coup.
   Google finissait par lire la fiche, plus tard et moins souvent ; Bing, les
   aperçus de partage et les robots d'IA ne voyaient qu'un titre générique,
   « Chargement du produit… » et l'image de couverture du site. Le contenu
   injecté tardivement repoussait aussi le pied de page : CLS de 0,881 mesuré
   sur mobile, soit trois fois le seuil « mauvais » de Google.

   Ce relais écrit donc la fiche entière dans le HTML servi : titre,
   description, balises de partage avec la vraie photo, données structurées,
   fil d'Ariane, photos, caractéristiques et pièces similaires. Le balisage
   est celui que product.js produit pour un visiteur non connecté ; le script
   le reconnaît (data-ssr) et se contente d'y brancher ses boutons.

   Codes HTTP :
     - sans identifiant         : 301 vers le catalogue ;
     - identifiant mal formé    : 404 ;
     - annonce introuvable      : 404 (auparavant 200 + noindex posé en JS) ;
     - annonce vendue           : 200, marquée vendue et SoldOut ;
     - base injoignable         : 200 avec l'ancien gabarit, que le
       navigateur remplit. Annoncer une 404 pour une annonce existante, le
       temps d'une panne, la ferait sortir de l'index.
   ===================================================================== */

define('ATHENA', 1);
require __DIR__ . '/inc/athena.php';

/* Interrupteur d'affichage des achats. Allumé le 6 oct. 2026 vers 1 h 45,
   tant que le site tournait sur une clé Stripe de test (« Acheter » menait à
   une erreur), puis éteint vers 8 h 30 : clé de production posée et
   checkout_enabled = 1. Le remettre à true avec product.js pour suspendre
   les achats sans toucher à la base. */
const PAIEMENTS_EN_MAINTENANCE = false;   // doit suivre product.js

$lang = am_langue();
$en = $lang === 'en';

/* ---------------------------------------------------------------------
   Adresse demandée

   /annonce/<titre>-<identifiant>. Le titre n'est là que pour le lecteur et
   pour le texte des liens partagés ; l'identifiant, à la fin, est ce qui
   désigne l'annonce. Un titre modifié change donc l'adresse, et l'ancienne
   redirige (plus bas, une fois le titre connu), comme /product?id=…, en
   service jusqu'au 20 septembre 2026 et encore dans l'index de Google.
   --------------------------------------------------------------------- */

$chemin = trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH), '/');
if (basename(__FILE__) !== 'product.php' && isset($_GET['essai'])) {
    $chemin = trim((string) $_GET['essai'], '/');
}
$chemin = rawurldecode($chemin);

$slugDemande = '';
if (strpos($chemin . '/', 'annonce/') === 0) {
    $reste = (string) substr($chemin, strlen('annonce'));
    $reste = trim($reste, '/');
    if ($reste === '') {
        header('Location: ' . AM_SITE . am_url_categorie(null, null, $lang), true, 301);
        exit;
    }
    /* Gourmand : le dernier groupe de chiffres est l'identifiant, ce qui
       laisse un titre se terminer par une année (« …-adrian-1915-22 »).
       Le titre est facultatif : /annonce/22, que product.js acceptait déjà,
       répondait 404 ; il redirige désormais vers l'adresse complète, comme
       un titre recopié de travers. */
    if (!preg_match('~^(?:(.*)-)?([0-9]{1,12})$~', $reste, $m)) {
        am_introuvable($lang);
    }
    $slugDemande = (string) $m[1];
    $id = $m[2];
} else {
    $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
    if ($id === '') {
        header('Location: ' . AM_SITE . am_url_categorie(null, null, $lang), true, 301);
        exit;
    }
    if (!preg_match('/^[0-9]{1,12}$/', $id)) {
        am_introuvable($lang);
    }
}

/* Identifiant sous sa forme canonique : « -022 » désignait la même annonce
   que « -22 » et répondait 200 avec sa propre canonique, un doublon
   indexable à l'infini (-0022…). La forme demandée est gardée pour la
   redirection plus bas. */
$idDemande = $id;
$id = ltrim($id, '0');
if ($id === '') {
    $id = '0';
}

$gabarit = (string) file_get_contents(__DIR__ . '/product.html');

$colonnes = 'id,user_id,title,title_en,description,description_en,period,subcategory,condition,price,quantity,'
    . 'location,ship_pickup,ship_post,ship_relay,status,created_at,sold_at,image_url,image_urls,historically_sensitive,authenticated_at,weight_grams';
$res = am_api('products?select=' . $colonnes . '&id=eq.' . $id . '&limit=1', 300);

/* Base injoignable et aucun cache : comportement antérieur. */
if ($res === null) {
    $fr = AM_SITE . am_url_fiche($id, 'fr', $slugDemande);
    $anglais = AM_SITE . am_url_fiche($id, 'en', $slugDemande);
    am_envoyer(am_entete($gabarit, [
        'canonical'  => $en ? $anglais : $fr,
        'alternates' => ['fr' => $fr, 'en' => $anglais, 'x-default' => $fr],
        'og'         => ['og:url' => $en ? $anglais : $fr],
    ]));
}

$p = $res[0] ?? null;
/* Le cache peut avoir un passage de retard (am_api sert une réponse périmée
   jusqu'à 24 h) : une annonce vue en brouillon puis publiée, ou republiée,
   y restait « introuvable » et répondait 404 au premier visiteur. Avant
   d'annoncer une 404, on relit donc la base. Le cas est rare et la lecture
   ne coûte qu'à lui. */
if (!$p || !in_array($p['status'] ?? '', ['published', 'sold'], true)) {
    $frais = am_api_frais('products?select=' . $colonnes . '&id=eq.' . $id . '&limit=1', 300);
    $p = is_array($frais) ? ($frais[0] ?? null) : $p;
}
if (!$p || !in_array($p['status'] ?? '', ['published', 'sold'], true)) {
    am_introuvable($lang);
}

/* ---------------------------------------------------------------------
   Données
   --------------------------------------------------------------------- */

$T = static function (string $cle) use ($lang): string {
    return am_t($cle, $lang);
};

$vendeur = null;
if (!empty($p['user_id']) && preg_match('~^[0-9a-f-]{36}$~', $p['user_id'])) {
    $v = am_api('public_profiles?select=id,pseudo,avatar_url,created_at,location&id=eq.' . $p['user_id'] . '&limit=1', 3600);
    $vendeur = $v[0] ?? null;
}

$tarifs = [];
foreach (am_api('shipping_rates?select=method,amount_cents,min_days,max_days,product_flag,label_fr', 86400) ?: [] as $r) {
    $tarifs[$r['method']] = $r;
}

/* Pièces similaires : même logique que loadSimilarProducts (product.js),
   ordonnée par date pour que le serveur et le navigateur affichent la même
   liste dans le même ordre. */
$sel = 'id,title,title_en,price,image_url,condition,subcategory,period,historically_sensitive,authenticated_at';
$base = 'products?select=' . $sel . '&status=eq.published&id=neq.' . $id . '&order=created_at.desc&limit=4';
$similaires = [];
if (!empty($p['subcategory'])) {
    $similaires = am_api($base . '&subcategory=eq.' . rawurlencode($p['subcategory']), 300) ?: [];
} elseif (!empty($p['period'])) {
    $similaires = am_api($base . '&period=eq.' . rawurlencode($p['period']), 300) ?: [];
}
if (count($similaires) < 4 && !empty($p['period'])) {
    $vus = array_column($similaires, 'id');
    foreach (am_api($base . '&period=eq.' . rawurlencode($p['period']), 300) ?: [] as $x) {
        if (!in_array($x['id'], $vus, true)) {
            $similaires[] = $x;
        }
    }
    $similaires = array_slice($similaires, 0, 4);
}
if (!$similaires) {
    $similaires = am_api($base, 300) ?: [];
}

$titre = am_titre_annonce($p, $lang);
$description = trim((string) (($en && !empty($p['description_en'])) ? $p['description_en'] : ($p['description'] ?? '')));
$traductionAuto = $en && (!empty($p['title_en']) || !empty($p['description_en']));
$vendu = $p['status'] === 'sold';
$sensible = !empty($p['historically_sensitive']);
$authentifiee = !empty($p['authenticated_at']);
$photos = (is_array($p['image_urls'] ?? null) && $p['image_urls']) ? $p['image_urls']
    : (!empty($p['image_url']) ? [$p['image_url']] : ['/hero.png']);
$prix = am_prix($p['price'], $lang);
$periode = (string) ($p['period'] ?? '');
$sous = (string) ($p['subcategory'] ?? '');
$libPeriode = $periode !== '' ? am_libelle_periode($periode, $lang) : '';
$libSous = $sous !== '' ? am_libelle_sous($sous, $lang) : '';
$etat = am_etat((string) ($p['condition'] ?? ''), $lang);

$modes = [
    'pickup' => ['flag' => 'ship_pickup', 'label' => 'tr_js_product.ship_pickup', 'prix' => 'tr_js_product.ship_free', 'court' => ['fr' => 'remise en main propre', 'en' => 'hand delivery']],
    'post'   => ['flag' => 'ship_post', 'label' => 'tr_js_product.ship_post', 'prix' => 'tr_js_product.ship_price_post', 'court' => ['fr' => 'envoi suivi', 'en' => 'tracked shipping']],
    'relay'  => ['flag' => 'ship_relay', 'label' => 'tr_js_product.ship_relay', 'prix' => 'tr_js_product.ship_price_relay', 'court' => ['fr' => 'point relais', 'en' => 'pickup point']],
];
$modesActifs = array_filter($modes, static function ($m) use ($p) {
    return !empty($p[$m['flag']]);
});

/* Protection acheteurs de cette annonce, en centimes (am_protection_cents) :
   payée en plus du prix et de la livraison, quel que soit le mode. */
$protection = am_protection_cents(am_centimes($p['price'] ?? 0));

/* Pièces d'armement : Google exclut les armes de ses fiches marchandes et
   de Shopping (dagues, baïonnettes, armes neutralisées comprises). Leur
   fiche ne déclare donc pas de Product, que Google lirait comme une offre
   marchande ; elle garde ItemPage et son fil d'Ariane. Règle propre aux
   fiches, sur le titre seul : une description qui cite une baïonnette ne
   fait pas d'un livre une arme. C'est le titre écrit par le vendeur qui
   décide (les mots anglais servent au vendeur qui titre en anglais), la
   traduction automatique seulement s'il manque : traduite, une giberne ou
   une cartouchière devient une « cartridge box », et la pièce perdrait son
   Product sans être une arme. La décision ne dépend pas de la langue de la
   page. La catégorie « Armes (neutralisées/maquettes) » suffit à
   elle seule. Même liste et même règle dans product.js (MOTS_ARMES) ; le
   flux Shopping a sa propre liste, plus large (flux-produits.php). */
const FICHE_MOTS_ARMES = 'dagues?|poignards?|ba[iï]onnettes?|couteaux?|sabres?|[ée]p[ée]es?|glaives?|fusils?|carabines?'
    . '|pistolets?|revolvers?|mousquetons?|grenades?|obus|cartouches?|munitions?'
    . '|daggers?|bayonets?|knife|knives|swords?|sabers?|rifles?|carbines?|pistols?|musketoons?|cartridges?|ammunition';
$titreArme = trim((string) ($p['title'] ?? '')) !== '' ? (string) $p['title'] : (string) ($p['title_en'] ?? '');
$arme = strpos($sous, 'Armes') === 0
    || preg_match('~(*UCP)\b(?:' . FICHE_MOTS_ARMES . ')\b~iu', $titreArme) === 1;

/* ---------------------------------------------------------------------
   Adresses
   --------------------------------------------------------------------- */

$slugReel = am_slug_titre($p['title'] ?? '');
/* Le titre français fait l'adresse dans les deux langues : une annonce, une
   page, que ?lang=en se contente de traduire.

   Ce test couvre les trois cas d'un seul geste : l'ancienne adresse
   (/product?id=…, slug vide), un titre corrigé depuis la publication, et un
   lien recopié de travers. Les autres paramètres suivent, parce qu'ils
   veulent dire quelque chose à l'arrivée : ?checkout=canceled affiche son
   message, et une campagne garde ses étiquettes. */
if ($slugDemande !== $slugReel || $idDemande !== $id) {
    $cible = am_url_fiche($id, $lang, $p['title'] ?? '');
    $reste = $_GET;
    unset($reste['id'], $reste['lang'], $reste['essai']);
    if ($reste) {
        $cible .= (strpos($cible, '?') === false ? '?' : '&') . http_build_query($reste);
    }
    header('Location: ' . AM_SITE . $cible, true, 301);
    exit;
}

$urlFr = AM_SITE . am_url_fiche($id, 'fr', $p['title'] ?? '');
$urlEn = AM_SITE . am_url_fiche($id, 'en', $p['title'] ?? '');
/* Une version anglaise sans traduction du titre n'est qu'un doublon de la
   française : elle renvoie vers elle et ne se déclare pas en hreflang. */
$anglaisReel = !empty($p['title_en']);
$canonique = ($en && $anglaisReel) ? $urlEn : $urlFr;
$alternates = $anglaisReel ? ['fr' => $urlFr, 'en' => $urlEn, 'x-default' => $urlFr] : null;

/* ---------------------------------------------------------------------
   Titre et description
   --------------------------------------------------------------------- */

/* Titre : le nom de la pièce, sa période telle qu'on la tape, et « à vendre ».
   L'ancien titre ajoutait « · 1ère Guerre Mondiale, Uniformes », le libellé
   interne du catalogue : personne ne cherche ainsi. On cherche « casque à
   pointe 14-18 », et une requête d'achat veut voir que la pièce est en
   vente. Si tout ne tient pas, la période saute d'abord ; la mention « à
   vendre » reste, et c'est le nom qui est raccourci (règle du 1er oct.
   2026). Le nom seul ne sert qu'à une pièce vendue, qui n'a pas de
   mention. Un nom de 51 à 60 caractères sortait auparavant seul, sans « à
   vendre » (« Dague d'officier allemand de la seconde guerre mondiale »).
   Le suffixe de marque est ajouté par am_titre_page s'il rentre. */
$nom = $titre !== '' ? $titre : $T('tr_js_product.item_default');
$ere = am_periode_courte($periode, $lang);
if ($ere !== '' && mb_stripos($nom, $ere) !== false) {
    $ere = ''; // déjà dans le titre du vendeur
}
$aVendre = $vendu ? '' : ($en ? 'for sale' : 'à vendre');
$titrePage = null;
$essais = [[$nom, $ere, $aVendre], [$nom, $aVendre]];
if ($aVendre === '') {
    $essais[] = [$nom];
}
foreach ($essais as $essai) {
    $x = trim(preg_replace('~\s+~u', ' ', implode(' ', $essai)));
    if (mb_strlen($x) <= 60) {
        $titrePage = $x;
        break;
    }
}
/* Nom trop long : on garde « à vendre » et on raccourcit le nom. */
$titrePage = am_titre_page($titrePage ?? trim(am_couper_titre($nom, 60 - mb_strlen($aVendre) - 1) . ' ' . $aVendre));
if ($vendu) {
    $titrePage = ($en ? 'Sold: ' : 'Vendu : ') . $titrePage;
}

/* Description : construite depuis les champs (objet, période, état, prix,
   livraison), complétée par le début du texte du vendeur. La première phrase
   du vendeur (« Je vends… ») n'apprend rien au lecteur d'un résultat. */
/* « À vendre : Casque à pointe (14-18, uniformes, bon état). 400 €, remise
   en main propre. » puis le début du texte du vendeur. */
$faits = implode(', ', array_filter([
    am_periode_courte($periode, $lang) ?: $libPeriode,
    $libSous !== '' ? mb_strtolower($libSous) : '',
    $etat !== '' ? mb_strtolower($etat) : '',
]));
$livraison = implode($en ? ' or ' : ' ou ', array_map(static function ($m) use ($lang) {
    return $m['court'][$lang];
}, $modesActifs));
$morceaux = array_filter([
    ($vendu ? ($en ? 'Sold: ' : 'Vendu : ') : ($en ? 'For sale: ' : 'À vendre : '))
        . rtrim($titre, '. ') . ($faits !== '' ? ' (' . $faits . ')' : '') . '.',
    $vendu ? '' : trim($prix . ($livraison !== '' ? ', ' . $livraison : '') . '.'),
]);
$metaDesc = implode(' ', $morceaux);
$extrait = trim(preg_replace('~\s+~u', ' ', preg_replace('~^(bonjour|hello)\s*,?\s*~iu', '', $description)));
if ($extrait !== '' && mb_strlen($metaDesc) < 120) {
    $metaDesc .= ' ' . $extrait;
}
$metaDesc = am_couper($metaDesc, 158);

/* ---------------------------------------------------------------------
   Données structurées
   --------------------------------------------------------------------- */

$images = array_map(static function ($u) {
    return am_absolu(am_img($u, 1200));
}, array_slice($photos, 0, 8));

$proprietes = [];
foreach ([['Période', 'Period', $libPeriode], ['Catégorie', 'Category', $libSous], ['État', 'Condition', $etat], ['Localisation', 'Location', (string) ($p['location'] ?? '')]] as [$nomFr, $nomEn, $valeur]) {
    if ($valeur !== '') {
        $proprietes[] = ['@type' => 'PropertyValue', 'name' => $en ? $nomEn : $nomFr, 'value' => $valeur];
    }
}

/* Frais d'envoi déclarés : le tarif du mode plus la Protection acheteurs.
   Stripe débite les deux en plus du prix ; Google compare le prix et la
   livraison annoncés au total payé, et la Protection n'a pas d'autre
   attribut où se déclarer. Le libellé le dit. La remise en main propre
   seule (doesNotShip, plus bas) reste déclarée telle quelle. */
$livraisons = [];
foreach ($modesActifs as $cle => $m) {
    if ($cle === 'pickup' || !isset($tarifs[$cle])) {
        continue;
    }
    $r = $tarifs[$cle];
    $livraisons[] = [
        '@type'               => 'OfferShippingDetails',
        'shippingLabel'       => strip_tags($T($m['label'])) . ', ' . $T('tr_js_product.protection_included'),
        'shippingRate'        => ['@type' => 'MonetaryAmount', 'value' => am_nombre(((int) $r['amount_cents'] + $protection) / 100), 'currency' => 'EUR'],
        'shippingDestination' => ['@type' => 'DefinedRegion', 'addressCountry' => 'FR'],
        'deliveryTime'        => [
            '@type'        => 'ShippingDeliveryTime',
            // Conditions de vente, article 3.2 : cinq jours ouvrés pour expédier.
            'handlingTime' => ['@type' => 'QuantitativeValue', 'minValue' => 0, 'maxValue' => 5, 'unitCode' => 'DAY'],
            'transitTime'  => ['@type' => 'QuantitativeValue', 'minValue' => (int) $r['min_days'], 'maxValue' => (int) $r['max_days'], 'unitCode' => 'DAY'],
        ],
    ];
}
if (!$livraisons) {
    // Remise en main propre uniquement : rien n'est expédié.
    $livraisons[] = [
        '@type'               => 'OfferShippingDetails',
        'doesNotShip'         => true,
        'shippingDestination' => ['@type' => 'DefinedRegion', 'addressCountry' => 'FR'],
    ];
}
$methodes = [];
if (isset($modesActifs['pickup'])) {
    $methodes[] = 'https://schema.org/OnSitePickup';
}
if (isset($modesActifs['post']) || isset($modesActifs['relay'])) {
    $methodes[] = 'https://schema.org/ParcelService';
}

$offre = array_filter([
    '@type'                   => 'Offer',
    'url'                     => $canonique,
    'priceCurrency'           => 'EUR',
    'price'                   => am_nombre($p['price']),
    /* Une annonce n'a pas de date de péremption : le prix vaut tant que le
       vendeur ne le change pas. Mais sans cette date, Google cesse au bout
       d'un moment d'afficher le prix dans l'extrait, en considérant qu'il
       n'est plus garanti. On redéclare donc un an d'avance à chaque rendu,
       ce qui est exact puisque la page est reconstruite à chaque visite. */
    'priceValidUntil'         => gmdate('Y-m-d', time() + 365 * 86400),
    'availability'            => $vendu ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    'itemCondition'           => ($p['condition'] ?? '') === 'Neuf' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition',
    // Le vendeur réel, et non la plateforme : la place de marché ne vend rien elle-même.
    'seller'                  => $vendeur && !empty($vendeur['pseudo']) ? ['@type' => 'Person', 'name' => $vendeur['pseudo']] : null,
    'availableDeliveryMethod' => $methodes ?: null,
    'shippingDetails'         => $livraisons,
    /* Aucune politique de retour déclarée (hasMerchantReturnPolicy), depuis
       le 10 oct. 2026. La fiche annonçait un retour sous 14 jours pour toute
       annonce, en reprenant l'ancien article 3.6 des conditions de vente.
       Or le droit de rétractation du Code de la consommation (L221-18) ne
       vaut que face à un vendeur professionnel ; entre particuliers, il
       n'existe pas, sauf accord du vendeur, et l'article 3.6 le dit
       désormais. Le site ne sait pas encore si un vendeur est professionnel :
       toute valeur commune à toutes les fiches serait fausse pour une partie
       d'entre elles. Search Console signale le champ comme manquant, ce qui
       n'empêche pas l'affichage de la fiche ; une déclaration fausse, elle,
       engage le site. Même choix dans product.js. */
], static function ($v) {
    return $v !== null;
});

$produit = array_filter([
    '@type'              => 'Product',
    // Une pièce de collection est un exemplaire unique, pas une référence de catalogue.
    'additionalType'     => ((int) ($p['quantity'] ?? 1)) <= 1 ? 'https://schema.org/IndividualProduct' : null,
    '@id'                => $canonique . '#produit',
    'name'               => $titre,
    'description'        => mb_substr($description !== '' ? $description : $metaDesc, 0, 5000),
    // Pièce sensible : aucune photo déclarée (voir « Assemblage »).
    'image'              => $sensible ? null : $images,
    'sku'                => (string) $p['id'],
    'url'                => $canonique,
    'category'           => implode(' > ', array_filter([$libPeriode, $libSous])) ?: null,
    'additionalProperty' => $proprietes ?: null,
    'weight'             => !empty($p['weight_grams']) ? ['@type' => 'QuantitativeValue', 'value' => (int) $p['weight_grams'], 'unitCode' => 'GRM'] : null,
    'offers'             => $offre,
], static function ($v) {
    return $v !== null;
});

$miettes = [['@type' => 'ListItem', 'position' => 1, 'name' => $T('tr_js_product.home'), 'item' => AM_SITE . '/' . ($en ? '?lang=en' : '')]];
if ($periode !== '') {
    $miettes[] = ['@type' => 'ListItem', 'position' => count($miettes) + 1, 'name' => $libPeriode, 'item' => AM_SITE . am_url_categorie($periode, null, $lang)];
}
if ($sous !== '') {
    $miettes[] = ['@type' => 'ListItem', 'position' => count($miettes) + 1, 'name' => $libSous, 'item' => AM_SITE . am_url_categorie($periode ?: null, $sous, $lang)];
}
$miettes[] = ['@type' => 'ListItem', 'position' => count($miettes) + 1, 'name' => $titre];

/* Fiche d'arme ($arme) : ni Product ni mainEntity qui y renverrait. */
$graphe = array_values(array_filter([
    array_filter([
        '@type'      => 'ItemPage',
        '@id'        => $canonique,
        'url'        => $canonique,
        'name'       => $titre,
        'inLanguage' => $en ? 'en' : 'fr-FR',
        'isPartOf'   => ['@id' => AM_SITE . '/#website'],
        'mainEntity' => $arme ? null : ['@id' => $canonique . '#produit'],
        'breadcrumb' => ['@id' => $canonique . '#fil'],
    ], static function ($v) {
        return $v !== null;
    }),
    $arme ? null : $produit,
    ['@type' => 'BreadcrumbList', '@id' => $canonique . '#fil', 'itemListElement' => $miettes],
]));

/* ---------------------------------------------------------------------
   Balisage de la fiche : celui de product.js, visiteur non connecté
   --------------------------------------------------------------------- */

$e = 'am_e';
$urlPeriode = $periode !== '' ? am_url_categorie($periode, null, $lang) : '';
$urlSous = am_url_categorie($periode ?: null, $sous ?: null, $lang);

$fil = '<nav class="breadcrumb" aria-label="' . $T('tr_js_product.breadcrumb_aria') . '">'
    . '<a href="' . ($en ? '/?lang=en' : '/') . '">' . $T('tr_js_product.home') . '</a>';
if ($periode !== '') {
    $fil .= '<span class="crumb"><span class="crumb-sep" aria-hidden="true">›</span><a href="' . $e($urlPeriode) . '">' . $e($libPeriode) . '</a></span>';
}
if ($sous !== '') {
    $fil .= '<span class="crumb"><span class="crumb-sep" aria-hidden="true">›</span><a href="' . $e($urlSous) . '">' . $e($libSous) . '</a></span>';
}
$fil .= '<span class="crumb"><span class="crumb-sep" aria-hidden="true">›</span><span class="crumb-current">' . $e($titre) . '</span></span></nav>';

$badgeSensible = $sensible ? '
    <div class="sensitive-badge-bar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>' . $T('tr_js_product.sensitive_notice') . '</span>
    </div>' : '';

/* Le voile est une étiquette posée sur la photo, pas une bande sombre sur
   toute la colonne : un cartel blanc, et la phrase « Connectez-vous » est un
   vrai bouton qui ouvre la connexion (product.js). */
$voile = $sensible ? '
    <div class="sensitive-overlay sensitive-overlay-large">
      <div class="sensitive-label">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <strong>' . $T('tr_js_product.sensitive_title') . '</strong>
        <button type="button" class="sensitive-login">' . $T('tr_js_product.sensitive_login') . '</button>
      </div>
    </div>' : '';

/* Avis de la modération : l'équipe juge la pièce authentique sur photos et
   description (espace modération, 20261005000000_authenticite.sql). Posé
   sous le prix, dans le flux d'achat, avec ce qu'il vaut : un avis sur
   photos, pas une expertise. */
$avisAuthentique = $authentifiee ? '
        <div class="p-authentique">' . AM_SVG_SCEAU . '
          <div>
            <p class="p-authentique-titre">' . $T('tr_js_product.auth_title') . '</p>
            <p class="p-authentique-texte">' . $T('tr_js_product.auth_text') . '</p>
          </div>
        </div>' : '';

/* Agrandir la photo d'un toucher (5 octobre 2026). La fiche sert la photo
   en 800 px, alors qu'un iPhone de 390 px de large l'affiche sur environ
   1 170 pixels physiques : les poinçons et les marquages, qui décident un
   collectionneur, restaient flous. La photo devient un lien vers sa version
   1 200 px, que le navigateur ouvre seule et où le pincement fonctionne ;
   les miniatures portent la leur (data-zoom), que product.js recopie dans
   le lien. Un original de moins de 1 200 px donne la même photo, seule.
   Rien pour une pièce voilée : le lien dévoilerait ce que le voile cache
   (le serveur ne sait pas qui est connecté, product.js rend le lien au
   membre), ni pour l'image de remplacement d'une annonce sans photo.
   L'aria-label du lien remplace le alt de la photo pour un lecteur
   d'écran : il reprend le titre de la pièce, comme product.js. */
$zoom = !$sensible && $photos[0] !== '/hero.png';
$libelleZoom = str_replace('{titre}', trim($titre), $T('tr_js_product.photo_zoom'));

$miniatures = '';
if (count($photos) > 1) {
    $miniatures = '<div class="product-thumbs" role="group" aria-label="' . $T('tr_js_product.photos_aria') . '"' . ($sensible ? ' aria-hidden="true"' : '') . '>';
    foreach ($photos as $i => $u) {
        $miniatures .= '<button type="button" class="product-thumb' . ($i === 0 ? ' is-active' : '') . ($sensible ? ' is-blurred' : '')
            . '" data-img="' . $e(am_img($u, 800)) . '"' . ($zoom ? ' data-zoom="' . $e(am_img($u, 1200)) . '"' : '') . ' aria-pressed="' . ($i === 0 ? 'true' : 'false') . '" aria-label="Photo ' . ($i + 1) . ' / ' . count($photos) . '"' . ($sensible ? ' tabindex="-1"' : '') . '>'
            . '<img src="' . $e(am_img($u, 400)) . '" alt="' . $e($titre . ', photo ' . ($i + 1)) . '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'/hero.png\'"></button>';
    }
    $miniatures .= '</div>';
}

$livraisonHtml = '';
if ($modesActifs && !$vendu && !PAIEMENTS_EN_MAINTENANCE) {
    $livraisonHtml = '<div class="pay-ship" id="payShip" role="radiogroup" aria-labelledby="payShipTitle"><div class="pay-ship-title" id="payShipTitle">' . $T('tr_js_product.ship_title') . '</div>';
    $premier = true;
    foreach ($modesActifs as $cle => $m) {
        /* Aucune option cochée d'avance : l'acheteur choisit lui-même, et le
           bouton « Acheter » le lui demande s'il a oublié (product.js). Une
           remise en main propre cochée par défaut passait inaperçue. */
        $livraisonHtml .= '<label class="pay-ship-opt"><input type="radio" name="payship" value="' . $cle . '">'
            . '<span class="pay-ship-name">' . $e($T($m['label'])) . '</span><span class="pay-ship-price">' . $e($T($m['prix'])) . '</span></label>';
        $premier = false;
    }
    $livraisonHtml .= '<div class="pay-ship-relay" id="payShipRelay" style="display:none"><input type="text" id="payShipPostal" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="'
        . $T('tr_js_product.ship_relay_postal_ph') . '" aria-label="' . $T('tr_js_product.ship_relay_postal_ph') . '"></div>'
        . '<p class="pay-ship-error" id="payShipErr" hidden>' . $T('tr_js_product.choose_shipping') . '</p></div>';
    /* La Protection acheteurs, sous le choix de livraison et avant le bouton
       d'achat : l'acheteur doit connaître ce qu'il paiera en plus du prix
       avant de s'engager, pas le découvrir sur la page de Stripe. Le montant
       et sa formule, rien de plus : aucune promesse sur ce qu'elle couvre.
       Même ligne dans product.js. Style en ligne, aux jetons de la maison
       (gris --muted, 13 px), en attendant une règle .pay-protection dans
       style.css.
       La ligne se termine par le renvoi aux conditions de vente : des
       conditions générales n'engagent l'acheteur que s'il a pu les connaître
       et les a acceptées (article 1119 du Code civil), et le seul lien vers
       elles était dans le pied de page. Placé dans ce paragraphe, il est lu
       avec le bouton d'achat (aria-describedby). Le texte vient du
       dictionnaire, HTML compris, comme les autres libellés de la fiche.
       Son lien reprend en ligne le dessin de .product-vendre a (or de
       texte, soulignement fin) : sans règle .pay-protection dans
       style.css, il sortait en bleu par défaut. Même style dans product.js
       (STYLE_LIEN_PROTECTION). */
    $styleLien = 'color:var(--gold-text);text-decoration:underline;text-decoration-thickness:1px;text-decoration-color:rgba(201,168,76,0.7);text-underline-offset:3px';
    $livraisonHtml .= '<p class="pay-protection" id="payProtection" style="margin:8px 0 0;font-size:13px;line-height:1.5;color:var(--muted)">'
        . $e(str_replace('{montant}', am_montant_cents($protection, $lang), $T('tr_js_product.protection_line')))
        . ' ' . str_replace('<a ', '<a style="' . $styleLien . '" ', $T('tr_js_product.protection_cgv')) . '</p>';
}

/* Pas de style en ligne sur les boutons désactivés : la feuille fixe leur
   état (opacité, curseur, aucun effet au survol). Sans aucun mode de remise
   proposé par le vendeur, l'achat en ligne ne peut pas aboutir : on le dit
   au lieu d'afficher un bouton qui échouerait.
   Le bouton d'achat renvoie à la ligne de la Protection (aria-describedby) :
   au clavier ou au lecteur d'écran, on passe des modes de livraison au
   bouton sans lire le paragraphe qui les sépare, et ce montant doit être
   connu avant d'acheter. Les deux naissent de la même condition (un mode
   proposé, ni vendu ni maintenance) : l'un n'existe jamais sans l'autre. */
$bouton = $vendu
    ? '<button class="cta-btn" disabled>' . $T('tr_js_product.sold_button') . '</button>'
    : (PAIEMENTS_EN_MAINTENANCE
        ? '<button class="cta-btn" disabled>' . $T('tr_js_product.maintenance_button') . '</button>'
        : (!$modesActifs
            ? '<button class="cta-btn" disabled>' . $T('tr_js_product.no_shipping_button') . '</button>'
            : '<button class="cta-btn" id="buyBtn" aria-describedby="payProtection">' . $T('tr_js_product.buy') . ' ' . $prix . '</button>'));

$caracteristiques = '';
foreach ([['tr_js_product.period', $libPeriode], ['tr_js_product.subcategory', $libSous], ['tr_js_product.location', (string) ($p['location'] ?? '')], ['tr_js_product.stock', (string) ($p['quantity'] ?? '')]] as [$cle, $valeur]) {
    if ($valeur !== '' && $valeur !== '0') {
        $caracteristiques .= '<li><strong>' . $T($cle) . '</strong> <span>' . $e($valeur) . '</span></li>';
    }
}
$caracteristiques .= '<li><strong>' . $T('tr_js_product.published') . '</strong> <span data-date="' . $e($p['created_at'] ?? '') . '">' . $e(am_depuis($p['created_at'] ?? null, $lang)) . '</span></li>';

/* Les pièces voisines prennent la carte du catalogue et de l'accueil
   (am_carte) : une annonce garde le même dessin d'une page à l'autre, et
   renderProductCard (script.js) écrit exactement la même côté navigateur. */
$carteVendeur = '';
if ($vendeur && !empty($vendeur['pseudo'])) {
    $pseudo = (string) $vendeur['pseudo'];
    $lettre = mb_strtoupper(mb_substr($pseudo, 0, 1));
    $avatar = !empty($vendeur['avatar_url'])
        ? '<img src="' . $e($vendeur['avatar_url']) . '" alt="' . $e($pseudo) . '" class="seller-avatar-img">'
        : '<div class="seller-avatar">' . $e($lettre) . '</div>';
    $depuis = am_mois_annee($vendeur['created_at'] ?? null, $lang);
    /* Ce que le vendeur a fait, en une ligne discrète sous son nom, et
       seulement ce qui n'est pas nul. Trois gros compteurs (« 0 vente
       réalisée », « 0 avis ») mesuraient la jeunesse du site plus qu'ils ne
       rassuraient (avis de l'exploitant, 5 oct. 2026). Les avis s'ajoutent
       côté navigateur (product.js), qui récrit la même ligne. */
    $faits = [];
    $nbEnLigne = count(am_api('products?select=id&status=eq.published&user_id=eq.' . $vendeur['id'], 300) ?: []);
    $nbVendues = count(am_api('products?select=id&status=eq.sold&user_id=eq.' . $vendeur['id'], 300) ?: []);
    if ($nbEnLigne > 0) {
        $faits[] = str_replace('{n}', (string) $nbEnLigne, am_t($nbEnLigne > 1 ? 'tr_js_product.seller_listings_many' : 'tr_js_product.seller_listings_one', $lang));
    }
    if ($nbVendues > 0) {
        $faits[] = str_replace('{n}', (string) $nbVendues, am_t($nbVendues > 1 ? 'tr_js_product.seller_sales_many' : 'tr_js_product.seller_sales_one', $lang));
    }
    $carteVendeur = '
      <h2 id="seller-title" class="sr-only">' . $T('tr_js_product.seller_title') . '</h2>
      <div class="seller-left">' . $avatar . '
        <div class="seller-meta">
          <div class="seller-name">' . $e($pseudo) . '</div>'
        . ($depuis !== '' ? '<div class="seller-since">' . $T('tr_js_product.member_since') . ' ' . $e($depuis) . '</div>' : '')
        . (!empty($vendeur['location']) ? '<div class="seller-loc">' . $e($vendeur['location']) . '</div>' : '')
        . ($faits ? '<div class="seller-faits">' . $e(implode(' · ', $faits)) . '</div>' : '') . '
        </div>
      </div>';
} else {
    $carteVendeur = '<h2 id="seller-title" class="sr-only">' . $T('tr_js_product.seller_title') . '</h2><div class="seller-loading">' . $T('tr_js_product.seller_loading') . '</div>';
}

$cartesSimilaires = '';
foreach ($similaires as $s) {
    $cartesSimilaires .= am_carte($s, $lang);
}
if ($cartesSimilaires === '') {
    $cartesSimilaires = '<p class="similar-empty">' . $T('tr_js_product.similar_empty') . '</p>';
}

$etoiles = '';
for ($i = 1; $i <= 5; $i++) {
    $etoiles .= '<button type="button" role="radio" aria-checked="false" tabindex="' . ($i === 1 ? '0' : '-1') . '" data-star="' . $i . '" aria-label="' . $i . ' / 5">☆</button>';
}

$fiche = $fil . $badgeSensible . '
    <div class="product-grid">
      <div class="product-image' . ($vendu ? ' is-sold' : '') . ($sensible ? ' has-sensitive' : '') . '">
        <div class="product-main">
          ' . ($vendu ? '<div class="sold-overlay">' . $T('tr_js_product.sold_overlay') . '</div>' : '') . '
          ' . ($zoom ? '<a class="product-zoom" id="productZoom" href="' . $e(am_img($photos[0], 1200)) . '" target="_blank" rel="noopener" aria-label="' . $e($libelleZoom) . '">' : '') . '<img id="product-main-img" src="' . $e(am_img($photos[0], 800)) . '" alt="' . $e($titre) . '" class="product-img' . ($sensible ? ' is-blurred' : '') . '" fetchpriority="high" decoding="async" onerror="this.onerror=null;this.src=\'/hero.png\'">' . ($zoom ? '</a>' : '') . '
          ' . $voile . '
        </div>
        ' . $miniatures . '
      </div>
      <div class="info">
          <h1 class="p-title">' . $e($titre) . '</h1>
          <div class="p-price-row">
            <div class="p-price">' . $prix . '</div>
            ' . ($etat !== '' ? '<span class="p-badge">' . $e($etat) . '</span>' : '') . '
            ' . ($vendu ? '<span class="p-sold-badge">' . $T('tr_js_product.sold_badge') . '</span>' : '') . '
          </div>' . $avisAuthentique . '
        <div class="p-description" id="productDescription">
          <h2 class="p-description-title">' . $T('tr_js_product.description_title') . '</h2>
          <p class="p-short' . ($description !== '' ? '' : ' p-desc-empty') . '" id="descText">' . ($description !== '' ? $e($description) : $T('tr_js_product.desc_empty')) . '</p>
          <button type="button" class="p-desc-toggle" id="descToggle" aria-expanded="false" aria-controls="descText" hidden>' . $T('tr_js_product.desc_more') . '</button>
          ' . ($traductionAuto ? '<p class="p-auto-translate">' . $T('tr_js_product.auto_translated') . '</p>' : '') . '
        </div>
        <ul class="p-vendor">' . $caracteristiques . '</ul>
        ' . $livraisonHtml . '
        ' . (!$vendu && PAIEMENTS_EN_MAINTENANCE ? '<p class="pay-maintenance">' . $T('tr_js_product.maintenance_notice') . '</p>' : '') . '
        ' . (!$vendu && !PAIEMENTS_EN_MAINTENANCE && !$modesActifs ? '<p class="pay-maintenance">' . $T('tr_js_product.no_shipping_notice') . '</p>' : '') . '
        <div class="product-actions">
          ' . $bouton . '
          <button class="btn outline fav-btn" id="favBtn" data-id="' . $e($p['id']) . '" aria-pressed="false">' . AM_SVG_COEUR . '<span>' . $T('tr_js_product.fav_add') . '</span></button>
          <button class="btn outline" id="contactSellerBtn">' . AM_SVG_ENVELOPPE . '<span>' . $T('tr_js_product.contact_seller') . '</span></button>
        </div>
        <button type="button" class="report-link" id="reportBtn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ' . $T('tr_js_product.report') . '
        </button>
      </div>
        <div class="share-row" role="group" aria-label="' . $T('tr_js_product.share_aria') . '">
          <span class="share-label">' . $T('tr_js_product.share') . '</span>
          <div class="share-buttons">
            <button class="share-btn share-btn--copy" data-share="copy" title="' . $T('tr_js_product.share_copy') . '" aria-label="' . $T('tr_js_product.share_copy') . '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
            <a class="share-btn share-btn--facebook" data-share="facebook" title="' . $T('tr_js_product.share_facebook') . '" aria-label="' . $T('tr_js_product.share_facebook') . '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/></svg></a>
            <a class="share-btn share-btn--twitter" data-share="twitter" title="' . $T('tr_js_product.share_twitter') . '" aria-label="' . $T('tr_js_product.share_twitter') . '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
            <a class="share-btn share-btn--whatsapp" data-share="whatsapp" title="' . $T('tr_js_product.share_whatsapp') . '" aria-label="' . $T('tr_js_product.share_whatsapp') . '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg></a>
            <a class="share-btn share-btn--email" data-share="email" title="' . $T('tr_js_product.share_email') . '" aria-label="' . $T('tr_js_product.share_email') . '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg></a>
          </div>
        </div>
    </div>

    <section class="seller-card" id="seller-card" aria-labelledby="seller-title">' . $carteVendeur . '
    </section>

    <section class="similar-products" id="similar-products" aria-labelledby="similar-title">
      <div class="similar-header">
        <h2 id="similar-title">' . $T('tr_js_product.similar_title') . '</h2>
        <a href="' . $e($urlSous) . '" class="similar-link">' . $T('tr_js_product.see_more') . ' <span aria-hidden="true">›</span></a>
      </div>
      <div class="similar-grid" id="similar-grid">' . $cartesSimilaires . '
      </div>
    </section>

    <section class="user-reviews" id="reviews-section" aria-labelledby="reviews-title">
      <h2 id="reviews-title">' . $T('tr_js_product.reviews_title') . '</h2>
      <div id="reviews-list"><p class="empty-muted">' . $T('tr_js_product.loading') . '</p></div>
      <div class="review-form" id="review-form" style="display:none">
        <h3>' . $T('tr_js_product.leave_review') . '</h3>
        <div class="star-input" id="star-input" role="radiogroup" aria-label="' . $T('tr_js_product.rating_label') . '">' . $etoiles . '</div>
        <textarea id="review-comment" placeholder="' . $T('tr_js_product.review_comment_ph') . '" aria-label="' . $T('tr_js_product.review_comment_ph') . '"></textarea>
        <button class="cta-btn" id="submitReview" type="button">' . $T('tr_js_product.publish_review') . '</button>
      </div>
    </section>
  ';

/* Contexte de la catégorie : le premier paragraphe du texte de la page
   catalogue correspondante (inc/categories.json, écrit par
   build-categories.cjs), avec un lien vers cette page. Une annonce tient
   souvent en trois phrases ; ce paragraphe dit à quoi elle se rattache et
   donne à la fiche un texte que le vendeur n'a pas à écrire. */
$blocContexte = '';
$categories = json_decode((string) @file_get_contents(AM_RACINE . '/inc/categories.json'), true) ?: [];
$contexte = null;
foreach ($categories as $c) {
    if (($c['periode'] ?? '') !== ($p['period'] ?? '')) {
        continue;
    }
    if (($c['type'] ?? '') === ($p['subcategory'] ?? '')) {
        $contexte = $c;
        break;
    }
    if (($c['type'] ?? '') === '' && $contexte === null) {
        $contexte = $c;
    }
}
if ($contexte) {
    $texte = ($en && !empty($contexte['resume_en'])) ? $contexte['resume_en'] : ($contexte['resume'] ?? '');
    if ($texte !== '') {
        $libelle = ($contexte['type'] ?? '') !== ''
            ? am_libelle_sous($contexte['type'], $lang) . ($en ? ', ' : ' · ') . am_libelle_periode($contexte['periode'], $lang)
            : am_libelle_periode($contexte['periode'], $lang);
        $urlContexte = am_url_categorie($contexte['periode'], ($contexte['type'] ?? '') !== '' ? $contexte['type'] : null, $lang);
        $blocContexte = "\n  <section class=\"product-guides product-contexte\" aria-labelledby=\"product-contexte-titre\">\n"
            . '    <h2 id="product-contexte-titre">' . ($en ? 'About this category' : 'Sur cette catégorie') . "</h2>\n"
            . '    <p>' . $e($texte) . "</p>\n"
            . '    <p class="product-vendre"><a href="' . $e($urlContexte) . '">' . ($en ? 'All listings: ' : 'Toutes les annonces : ') . $e($libelle) . "</a></p>\n  </section>";
    }
}

/* Guides liés : hors du conteneur que product.js peut réécrire, pour que le
   lien reste en place quoi qu'il arrive. */
$guides = am_guides_lies($p);
$blocGuides = '';
if ($guides) {
    $blocGuides = "\n  <section class=\"product-guides\" aria-labelledby=\"product-guides-titre\">\n"
        . '    <h2 id="product-guides-titre">' . ($en ? 'Further reading' : 'Pour aller plus loin') . "</h2>\n    <ul>\n";
    foreach ($guides as $g) {
        $h1 = ($en && !empty($g['h1_en'])) ? $g['h1_en'] : $g['h1'];
        $resume = ($en && !empty($g['description_en'])) ? $g['description_en'] : $g['description'];
        $lien = '/guides/' . $g['slug'] . ($en && !empty($g['h1_en']) ? '?lang=en' : '');
        $blocGuides .= '      <li><a href="' . $e($lien) . '">' . $e($h1) . '</a><span>' . $e($resume) . "</span></li>\n";
    }
    /* Ceux qui lisent une fiche sont des collectionneurs, et beaucoup ont
       eux-mêmes des pièces à vendre : une ligne pour le leur rappeler. */
    $blocGuides .= "    </ul>\n    <p class=\"product-vendre\">"
        . ($en
            ? 'Have a similar piece? <a href="/sell?lang=en">List it for free</a>: it will be seen by the same collectors.'
            : 'Vous avez une pièce comparable ? <a href="/sell">Déposez-la gratuitement</a> : elle sera vue par les mêmes collectionneurs.')
        . "</p>\n  </section>";
}

/* ---------------------------------------------------------------------
   Assemblage
   --------------------------------------------------------------------- */

$html = $en ? am_traduire($gabarit, 'en') : $gabarit;

/* Pièce sensible (historically_sensitive : insigne encadré par la loi, voile
   flou sur la fiche) : sa photo ne sort pas de la page. Les aperçus de
   partage reçoivent la couverture du site, comme les pages fixes ; les
   données structurées ne déclarent aucune image (plus haut) ; rien n'est
   préchargé ; et « noimageindex » demande aux moteurs de ne pas indexer les
   images de la fiche, qui reste indexable. max-image-preview:none : aucune
   vignette dans les résultats. À l'écran, rien ne change : la photo reste
   sous son voile, que product.js lève pour un membre connecté. Même règle
   dans sitemap.php (pas d'image:image) ; le flux Shopping écarte déjà ces
   annonces (flux-produits.php). Audit du 10 oct. 2026, CODE-06. */
$imagePartage = $sensible ? AM_SITE . '/og-cover.jpg' : am_img_jpeg($photos[0], 1200);
$html = am_entete($html, [
    'lang'        => $lang,
    'title'       => $titrePage,
    'description' => $metaDesc,
    'robots'      => $sensible ? 'index, follow, noimageindex, max-image-preview:none' : 'index, follow, max-image-preview:large',
    'canonical'   => $canonique,
    'alternates'  => $alternates,
    'og'          => [
        'og:title'               => am_couper($titre, 90),
        'og:description'         => am_couper($description !== '' ? $description : $metaDesc, 200),
        'og:type'                => 'product',
        'og:url'                 => $canonique,
        'og:image'               => am_absolu($imagePartage),
        // Dimensions inconnues pour une photo de vendeur : mieux vaut ne rien déclarer que déclarer faux.
        // La couverture du site, elle, mesure 1200 x 630.
        'og:image:width'         => $sensible ? '1200' : null,
        'og:image:height'        => $sensible ? '630' : null,
        'og:image:alt'           => $sensible
            ? ($en ? 'Athena Militaria, French marketplace for collectible militaria' : 'Athena Militaria, place de marché française de militaria de collection')
            : $titre,
        'og:locale'              => $en ? 'en_US' : 'fr_FR',
        'product:price:amount'   => (string) am_nombre($p['price']),
        'product:price:currency' => 'EUR',
    ],
    'twitter'     => [
        'twitter:title'       => am_couper($titre, 70),
        'twitter:description' => am_couper($metaDesc, 200),
        'twitter:image'       => am_absolu($imagePartage),
    ],
    'jsonld'      => $graphe,
]);

// L'image principale est connue avant tout script : on la précharge. Pas
// celle d'une pièce sensible : rien ne l'annonce hors de la page.
if (!$sensible) {
    $html = am_avant_fin_head($html, '<link rel="preload" as="image" href="' . $e(am_img($photos[0], 800)) . '" fetchpriority="high">');
}

/* Ce que la fiche servie affirme, relu par product.js : il redessine la
   fiche si la base dit autre chose (prix, statut ou titre changés depuis la
   mise en cache), et, si la base ne répond pas, branche Acheter, Favori,
   Contacter et Signaler sur ces valeurs au lieu d'effacer la fiche. Le
   titre est celui de la base, non rogné, pour être comparé tel quel. */
$donnees = ' data-prix="' . $e(am_nombre($p['price'] ?? 0)) . '"'
    . ' data-statut="' . $e($p['status'] ?? '') . '"'
    . ' data-titre="' . $e($p['title'] ?? '') . '"'
    . ' data-vendeur="' . $e($p['user_id'] ?? '') . '"'
    . ' data-periode="' . $e($periode) . '"'
    . ' data-type="' . $e($sous) . '"';
$html = am_remplacer_interieur(
    $html,
    'id="product-container"',
    $fiche,
    '<div id="product-container" data-ssr="1" data-ssr-lang="' . $lang . '"' . $donnees . '>'
);
$html = am_inserer_apres($html, 'id="product-container"', $blocContexte . $blocGuides);

am_envoyer($html);
