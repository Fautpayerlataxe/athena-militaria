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
       laisse un titre se terminer par une année (« …-adrian-1915-22 »). */
    if (!preg_match('~^(.*)-([0-9]{1,12})$~', $reste, $m)) {
        am_introuvable($lang);
    }
    $slugDemande = $m[1];
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

$gabarit = (string) file_get_contents(__DIR__ . '/product.html');

$colonnes = 'id,user_id,title,title_en,description,description_en,period,subcategory,condition,price,quantity,'
    . 'location,ship_pickup,ship_post,ship_relay,status,created_at,sold_at,image_url,image_urls,historically_sensitive,weight_grams';
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
$sel = 'id,title,title_en,price,image_url,condition,subcategory,period,historically_sensitive';
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
$photos = (is_array($p['image_urls'] ?? null) && $p['image_urls']) ? $p['image_urls']
    : (!empty($p['image_url']) ? [$p['image_url']] : ['/hero.png']);
$prix = am_prix($p['price']);
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
if ($slugDemande !== $slugReel) {
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
   vente. Si tout ne tient pas, la période saute d'abord, puis la mention.
   Le suffixe de marque est ajouté par am_titre_page s'il rentre. */
$nom = $titre !== '' ? $titre : $T('tr_js_product.item_default');
$ere = am_periode_courte($periode, $lang);
if ($ere !== '' && mb_stripos($nom, $ere) !== false) {
    $ere = ''; // déjà dans le titre du vendeur
}
$aVendre = $vendu ? '' : ($en ? 'for sale' : 'à vendre');
$titrePage = null;
foreach ([[$nom, $ere, $aVendre], [$nom, $aVendre], [$nom]] as $essai) {
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

$livraisons = [];
foreach ($modesActifs as $cle => $m) {
    if ($cle === 'pickup' || !isset($tarifs[$cle])) {
        continue;
    }
    $r = $tarifs[$cle];
    $livraisons[] = [
        '@type'               => 'OfferShippingDetails',
        'shippingLabel'       => strip_tags($T($m['label'])),
        'shippingRate'        => ['@type' => 'MonetaryAmount', 'value' => am_nombre($r['amount_cents'] / 100), 'currency' => 'EUR'],
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
    /* Reprend l'article 3.6 des conditions de vente tel qu'il est affiché :
       14 jours à compter de la réception, retour par voie postale, frais à la
       charge de l'acheteur. Si cet article change, cette déclaration doit
       changer avec lui.
       ReturnFeesCustomerResponsibility et non ReturnShippingFees : pour
       Google, cette dernière valeur signifie que le marchand facture le
       retour, et elle exige un montant que personne ne fixe ici. */
    'hasMerchantReturnPolicy' => [
        '@type'                => 'MerchantReturnPolicy',
        'applicableCountry'    => 'FR',
        'returnPolicyCategory' => 'https://schema.org/MerchantReturnFiniteReturnWindow',
        'merchantReturnDays'   => 14,
        'returnMethod'         => 'https://schema.org/ReturnByMail',
        'returnFees'           => 'https://schema.org/ReturnFeesCustomerResponsibility',
    ],
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
    'image'              => $images,
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

$graphe = [
    [
        '@type'      => 'ItemPage',
        '@id'        => $canonique,
        'url'        => $canonique,
        'name'       => $titre,
        'inLanguage' => $en ? 'en' : 'fr-FR',
        'isPartOf'   => ['@id' => AM_SITE . '/#website'],
        'mainEntity' => ['@id' => $canonique . '#produit'],
        'breadcrumb' => ['@id' => $canonique . '#fil'],
    ],
    $produit,
    ['@type' => 'BreadcrumbList', '@id' => $canonique . '#fil', 'itemListElement' => $miettes],
];

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

$miniatures = '';
if (count($photos) > 1) {
    $miniatures = '<div class="product-thumbs" role="group" aria-label="' . $T('tr_js_product.photos_aria') . '"' . ($sensible ? ' aria-hidden="true"' : '') . '>';
    foreach ($photos as $i => $u) {
        $miniatures .= '<button type="button" class="product-thumb' . ($i === 0 ? ' is-active' : '') . ($sensible ? ' is-blurred' : '')
            . '" data-img="' . $e(am_img($u, 800)) . '" aria-pressed="' . ($i === 0 ? 'true' : 'false') . '" aria-label="Photo ' . ($i + 1) . ' / ' . count($photos) . '"' . ($sensible ? ' tabindex="-1"' : '') . '>'
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
}

/* Pas de style en ligne sur les boutons désactivés : la feuille fixe leur
   état (opacité, curseur, aucun effet au survol). Sans aucun mode de remise
   proposé par le vendeur, l'achat en ligne ne peut pas aboutir : on le dit
   au lieu d'afficher un bouton qui échouerait. */
$bouton = $vendu
    ? '<button class="cta-btn" disabled>' . $T('tr_js_product.sold_button') . '</button>'
    : (PAIEMENTS_EN_MAINTENANCE
        ? '<button class="cta-btn" disabled>' . $T('tr_js_product.maintenance_button') . '</button>'
        : (!$modesActifs
            ? '<button class="cta-btn" disabled>' . $T('tr_js_product.no_shipping_button') . '</button>'
            : '<button class="cta-btn" id="buyBtn">' . $T('tr_js_product.buy') . ' ' . $prix . '</button>'));

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
    $carteVendeur = '
      <h2 id="seller-title" class="sr-only">' . $T('tr_js_product.seller_title') . '</h2>
      <div class="seller-left">' . $avatar . '
        <div class="seller-meta">
          <div class="seller-name">' . $e($pseudo) . '</div>'
        . ($depuis !== '' ? '<div class="seller-since">' . $T('tr_js_product.member_since') . ' ' . $e($depuis) . '</div>' : '')
        . (!empty($vendeur['location']) ? '<div class="seller-loc">' . $e($vendeur['location']) . '</div>' : '') . '
        </div>
      </div>
      <div class="seller-stats" aria-busy="true">'
        . '<div class="seller-stat"><strong>&nbsp;</strong><span>' . $T('tr_js_product.active_listings') . '</span></div>'
        . '<div class="seller-stat"><strong>&nbsp;</strong><span>' . $T('tr_js_product.sales_made') . '</span></div>'
        . '<div class="seller-stat"><strong>&nbsp;</strong><span>' . $T('tr_js_product.reviews_label') . '</span></div></div>';
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
          <img id="product-main-img" src="' . $e(am_img($photos[0], 800)) . '" alt="' . $e($titre) . '" class="product-img' . ($sensible ? ' is-blurred' : '') . '" fetchpriority="high" decoding="async" onerror="this.onerror=null;this.src=\'/hero.png\'">
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
          </div>
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

$imagePartage = am_img_jpeg($photos[0], 1200);
$html = am_entete($html, [
    'lang'        => $lang,
    'title'       => $titrePage,
    'description' => $metaDesc,
    'robots'      => 'index, follow, max-image-preview:large',
    'canonical'   => $canonique,
    'alternates'  => $alternates,
    'og'          => [
        'og:title'               => am_couper($titre, 90),
        'og:description'         => am_couper($description !== '' ? $description : $metaDesc, 200),
        'og:type'                => 'product',
        'og:url'                 => $canonique,
        'og:image'               => am_absolu($imagePartage),
        // Dimensions inconnues pour une photo de vendeur : mieux vaut ne rien déclarer que déclarer faux.
        'og:image:width'         => null,
        'og:image:height'        => null,
        'og:image:alt'           => $titre,
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

// L'image principale est connue avant tout script : on la précharge.
$html = am_avant_fin_head($html, '<link rel="preload" as="image" href="' . $e(am_img($photos[0], 800)) . '" fetchpriority="high">');

$html = am_remplacer_interieur(
    $html,
    'id="product-container"',
    $fiche,
    '<div id="product-container" data-ssr="1" data-ssr-lang="' . $lang . '">'
);
$html = am_inserer_apres($html, 'id="product-container"', $blocContexte . $blocGuides);

am_envoyer($html);
