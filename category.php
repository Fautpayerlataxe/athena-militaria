<?php
/* =====================================================================
   Pages catalogue, rendues côté serveur.

   Avant : seize règles .htaccess choisissaient une copie statique de
   category.html, et la grille des annonces restait vide jusqu'au
   JavaScript. Le HTML servi ne contenait donc aucun lien vers une fiche :
   au-delà des huit annonces de l'accueil, toute fiche était orpheline pour
   un robot qui n'exécute pas le script. Une période inventée
   (?cat=Antiquite) répondait 200, et le noindex des catégories vides n'était
   posé qu'en JavaScript.

   Ce relais :
     - valide la période et le type contre taxonomie.js (404 sinon) ;
     - choisit la copie enrichie écrite par build-categories.cjs, ou le
       gabarit générique ;
     - écrit la grille des annonces, le compteur, le H1, le fil d'Ariane et
       les balises de tête ;
     - pose noindex sur une catégorie vide et sur une recherche interne ;
     - sert la version anglaise traduite (?lang=en).
   ===================================================================== */

define('ATHENA', 1);
require __DIR__ . '/inc/athena.php';

$lang = am_langue();
$en = $lang === 'en';
$q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';

/* ---------------------------------------------------------------------
   Adresse demandée

   /militaria, /militaria/<période>, /militaria/<période>/<type>. La page se
   déduit du chemin, jamais d'un paramètre, comme dans page.php : une même
   page n'a qu'une adresse. Une copie d'essai déposée sous un autre nom
   reçoit le chemin par ?essai=.
   --------------------------------------------------------------------- */

$chemin = trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH), '/');
if (basename(__FILE__) !== 'category.php' && isset($_GET['essai'])) {
    $chemin = trim((string) $_GET['essai'], '/');
}
$chemin = rawurldecode($chemin);

/* Anciennes adresses (/category?cat=…&sub=…), en service jusqu'au
   18 septembre 2026 et encore dans l'index de Google : redirection
   permanente vers leur équivalent, une période ou un type inconnus restant
   des 404 comme avant. */
if ($chemin === 'category') {
    $cat = isset($_GET['cat']) ? (string) $_GET['cat'] : '';
    $sub = isset($_GET['sub']) ? (string) $_GET['sub'] : '';
    $periode = $cat !== '' ? am_periode_ancienne($cat) : '';
    $type = $sub !== '' ? am_type_ancien($sub) : '';
    if (($cat !== '' && $periode === '') || ($sub !== '' && $type === '')) {
        am_introuvable($lang);
    }
    $cible = am_url_categorie($periode ?: null, $type ?: null, $lang);
    if ($q !== '') {
        $cible .= (strpos($cible, '?') === false ? '?' : '&') . 'q=' . rawurlencode($q);
    }
    header('Location: ' . AM_SITE . $cible, true, 301);
    exit;
}

/* Archive des ventes (/ventes) : même gabarit que le catalogue, avec les
   pièces vendues, de la vente la plus récente à la plus ancienne, et leur
   prix. Ces prix réels sont ce que cherche un collectionneur qui veut
   estimer une pièce. */
$archive = $chemin === 'ventes';
$periode = '';
$sous = '';
if ($archive) {
    $q = '';
} else {
    $segments = $chemin === 'militaria' ? [] : explode('/', (string) preg_replace('~^militaria/~', '', $chemin));
    if (strpos($chemin . '/', 'militaria/') !== 0 || count($segments) > 2) {
        am_introuvable($lang);
    }
    $periode = isset($segments[0]) ? am_periode_depuis_segment($segments[0]) : '';
    $sous = isset($segments[1]) ? am_type_depuis_segment($segments[1]) : '';
    /* Taxonomie illisible (fichier manquant) : 503 plutôt qu'une 404 sur tout
       le catalogue, que Google prendrait pour une suppression. */
    if ($segments && !am_segments_periodes()) {
        am_introuvable($lang, 503);
    }
    if ((isset($segments[0]) && $periode === '') || (isset($segments[1]) && $sous === '')) {
        am_introuvable($lang);
    }
}

/* ---------------------------------------------------------------------
   Gabarit
   --------------------------------------------------------------------- */

$fichier = __DIR__ . '/category.html';
$enrichie = null;
$manifeste = json_decode((string) @file_get_contents(__DIR__ . '/inc/categories.json'), true) ?: [];
if ($q === '' && $periode !== '') {
    foreach ($manifeste as $c) {
        if ($c['periode'] === $periode && ($c['type'] ?? '') === $sous && is_file(__DIR__ . '/categories/' . $c['slug'] . '.html')) {
            $enrichie = $c;
            $fichier = __DIR__ . '/categories/' . $c['slug'] . '.html';
            break;
        }
    }
}
$html = (string) file_get_contents($fichier);

if ($en) {
    /* Les textes de contexte et le guide du catalogue n'existent qu'en
       français : les laisser dans la page anglaise en ferait une page
       bilingue, que ni le lecteur ni le moteur ne savent classer. */
    $html = preg_replace('~<!-- contexte:debut -->.*?<!-- contexte:fin -->~s', '', $html);
    $html = am_remplacer_interieur($html, 'id="catalogue-guide"', '', '<section class="about-section" id="catalogue-guide" hidden>');
    $html = am_traduire($html, 'en');
}

/* ---------------------------------------------------------------------
   Recherche interne : servie telle quelle, hors index
   --------------------------------------------------------------------- */

if ($q !== '') {
    $html = am_entete($html, ['lang' => $lang, 'robots' => 'noindex, follow', 'alternates' => null]);
    am_envoyer($html);
}

/* ---------------------------------------------------------------------
   Annonces
   --------------------------------------------------------------------- */

$requete = $archive
    ? 'products?select=id,title,title_en,price,image_url,historically_sensitive,created_at,status,sold_at'
        . '&status=eq.sold&order=sold_at.desc&limit=120'
    : 'products?select=id,title,title_en,price,image_url,historically_sensitive,created_at'
        . '&status=eq.published&order=created_at.desc&limit=60';
if ($periode !== '') {
    $requete .= '&period=eq.' . rawurlencode($periode);
}
if ($sous !== '') {
    $requete .= '&subcategory=eq.' . rawurlencode($sous);
}
$annonces = am_api($requete, 300);

/* ---------------------------------------------------------------------
   Libellés
   --------------------------------------------------------------------- */

$libPeriode = $periode !== '' ? am_libelle_periode($periode, $lang) : '';
$libSous = $sous !== '' ? am_libelle_sous($sous, $lang) : '';

if ($archive) {
    $h1 = am_t('archive.title', $lang);
    $titre = am_t('archive.seo_title', $lang);
    $description = am_t('archive.seo_desc', $lang);
    $nomPage = $h1;
} elseif ($libPeriode === '' && $libSous === '') {
    $h1 = null;   // catalogue complet : H1 traduit par data-i18n
    $titre = am_t('seo.category.title', $lang);
    $description = am_t('seo.category.desc', $lang);
    $nomPage = $en ? 'Militaria catalogue' : 'Catalogue militaria';
} else {
    if ($en) {
        $theme = trim($libPeriode . ' ' . mb_strtolower($libSous));
        $h1 = $libSous !== '' ? $theme : $theme . ' militaria';
        $titre = am_titre_page($theme . ' militaria for sale');
        $description = ucfirst($theme) . ' militaria for sale between collectors: detailed photos, described condition, protected payment and direct contact with the seller.';
    } else {
        /* Mêmes formules que build-categories.cjs, déjà indexées : on ne
           change pas un titre qui se positionne sans raison. */
        $theme = trim($libSous . ' ' . $libPeriode);
        $variantes = ['2nde Guerre Mondiale' => ' (39-45)', '1ère Guerre Mondiale' => ' (14-18)'];
        $h1 = 'Militaria ' . $theme . ($libSous === '' ? ($variantes[$libPeriode] ?? '') : '');
        $titre = am_titre_page($theme . ' : annonces de militaria');
        $nombre = is_array($annonces) ? count($annonces) : 0;
        $description = ($nombre > 5 ? $nombre . ' pièces de militaria ' : 'Militaria ') . $theme
            . ' à vendre entre collectionneurs : photos détaillées, état décrit, paiement protégé et échange direct avec le vendeur.';
    }
    $nomPage = $h1;
}

/* ---------------------------------------------------------------------
   Adresses
   --------------------------------------------------------------------- */

$chemin = $archive ? '/ventes' : am_url_categorie($periode ?: null, $sous ?: null);
$urlFr = AM_SITE . $chemin;
$urlEn = $urlFr . (strpos($urlFr, '?') === false ? '?' : '&') . 'lang=en';
$canonique = $en ? $urlEn : $urlFr;

/* ---------------------------------------------------------------------
   Contenu de la grille
   --------------------------------------------------------------------- */

if (is_array($annonces)) {
    $grille = "\n";
    foreach ($annonces as $a) {
        $grille .= am_carte($a, $lang);
    }
    if (!$annonces) {
        $grille = '<p>' . am_e(am_t('tr_js_script.no_items_found', $lang)) . '</p>';
    }
    $n = count($annonces);
    $mots = $archive ? ['archive.vente_word', 'archive.ventes_word'] : ['tr_js_script.annonce_word', 'tr_js_script.annonces_word'];
    $compteur = $n . ' ' . am_t($mots[$n > 1 ? 1 : 0], $lang);
    $html = am_remplacer_interieur($html, 'id="category-grid"', $grille . '      ');
    $html = am_remplacer_interieur($html, 'id="category-count"', am_e($compteur), '<div class="category-count" id="category-count">');
}

/* Filtre relu par loadCategoryProducts (script.js) quand le visiteur change
   le tri : les valeurs en base, que le script n'a plus à déduire de
   l'adresse. */
$html = str_replace(
    '<div class="items-grid" id="category-grid">',
    '<div class="items-grid" id="category-grid" data-periode="' . am_e($periode) . '" data-type="' . am_e($sous) . '"'
        . ($archive ? ' data-statut="sold"' : '') . '>',
    $html
);

/* Texte de la page : l'archive remplace la présentation du catalogue par
   la sienne, dans les deux langues. Le catalogue complet renvoie vers
   l'archive dès qu'elle contient une vente. */
$ouvertureGuide = '<section class="about-section" id="catalogue-guide" aria-labelledby="catalogue-guide-title">';
if ($archive) {
    $html = am_remplacer_interieur(
        $html,
        'id="catalogue-guide"',
        "\n        " . '<h2 id="catalogue-guide-title">' . am_e(am_t('archive.intro_title', $lang)) . '</h2>'
            . "\n        " . am_t('archive.intro_html', $lang) . "\n      ",
        $ouvertureGuide
    );
} elseif ($periode === '' && $q === '') {
    $vendues = am_api('products?select=id&status=eq.sold&limit=1', 300);
    if ($vendues) {
        $lien = '<p class="lien-archive"><a href="/ventes' . ($en ? '?lang=en' : '') . '">'
            . am_e(am_t('archive.link', $lang)) . '</a></p>' . "\n\n      ";
        $pos = strpos($html, '<section class="about-section" id="catalogue-guide"');
        if ($pos !== false) {
            $html = substr($html, 0, $pos) . $lien . substr($html, $pos);
        }
    }
}

/* Périodes ajoutées à la demande (1870, Indochine, Algérie…) : absentes du
   menu écrit dans category.html, elles y entrent d'elles-mêmes dès qu'une
   annonce y est publiée, avec les seuls types qui en contiennent. Un menu
   ne mène ainsi jamais à une page vide. */
$publiees = am_api('products?select=period,subcategory&status=eq.published&limit=1000', 300);
if (is_array($publiees)) {
    $presence = [];
    foreach ($publiees as $a) {
        $presence[(string) ($a['period'] ?? '')][(string) ($a['subcategory'] ?? '')] = true;
    }
    $segP = am_segments_periodes();
    $dates = am_objet_js('taxonomie.js', 'DATES_PERIODES');
    $clesP = am_objet_js('taxonomie.js', 'CLES_PERIODES');
    $clesT = am_objet_js('taxonomie.js', 'CLES_TYPES');
    /* Chaque période manquante est placée avant la première période plus
       récente déjà présente dans le menu : l'ordre reste chronologique. */
    $periodes = am_periodes();
    foreach ($periodes as $i => $p) {
        $seg = $segP[$p] ?? '';
        if ($seg === '' || empty($presence[$p]) || strpos($html, 'data-cat="' . $seg . '"') !== false) {
            continue;
        }
        $liens = '<li><a href="' . am_e(am_url_categorie($p, null)) . '"><span data-i18n="category.all_pieces">'
            . am_e(am_t('category.all_pieces', $lang)) . '</span></a></li>';
        foreach (am_sous_categories() as $t) {
            if (!empty($presence[$p][$t])) {
                $liens .= "\n            " . '<li><a href="' . am_e(am_url_categorie($p, $t)) . '"><span data-i18n="' . am_e($clesT[$t] ?? '') . '">'
                    . am_e(am_libelle_sous($t, $lang)) . '</span></a></li>';
            }
        }
        $groupe = '<details class="sidebar-group" data-cat="' . am_e($seg) . '">' . "\n"
            . '          <summary>' . "\n"
            . '            <span class="sidebar-group-title" data-i18n="' . am_e($clesP[$p] ?? '') . '">' . am_e(am_libelle_periode($p, $lang)) . '</span>' . "\n"
            . '            <span class="sidebar-group-dates">' . am_e($dates[$p] ?? '') . '</span>' . "\n"
            . '          </summary>' . "\n"
            . '          <ul>' . "\n            " . $liens . "\n          </ul>\n"
            . "        </details>\n        ";
        $debutNav = strpos($html, '<nav class="sidebar-nav">');
        if ($debutNav === false) {
            break;
        }
        $finNav = (int) strpos($html, '</nav>', $debutNav);
        $avant = $finNav;
        foreach (array_slice($periodes, $i + 1) as $suivante) {
            $pos = strpos($html, '<details class="sidebar-group" data-cat="' . ($segP[$suivante] ?? '') . '"', $debutNav);
            if ($pos !== false && $pos < $finNav) {
                $avant = $pos;
                break;
            }
        }
        if ($avant === $finNav) {
            // Période la plus récente : après le dernier groupe.
            $groupe = '  ' . rtrim($groupe) . "\n      ";
        }
        $html = substr($html, 0, $avant) . $groupe . substr($html, $avant);
    }
}

if ($h1 !== null) {
    $html = preg_replace_callback('~<h1 id="category-title"[^>]*>.*?</h1>~s', static function () use ($h1) {
        return '<h1 id="category-title" data-ssr="1">' . am_e($h1) . '</h1>';
    }, $html, 1);

    // Fil d'Ariane visible : même structure que celle qu'écrivait script.js.
    $fil = '<a href="' . ($en ? '/?lang=en' : '/') . '">' . am_e(am_t('tr_category.breadcrumb_home', $lang)) . '</a>'
        . "\n        " . '<span class="breadcrumb-sep">/</span>';
    if ($libPeriode !== '' && $libSous !== '') {
        $fil .= "\n        " . '<a href="' . am_e(am_url_categorie($periode, null, $lang)) . '">' . am_e($libPeriode) . '</a>'
            . "\n        " . '<span class="breadcrumb-sep">/</span>';
    }
    $fil .= "\n        " . '<span class="breadcrumb-current" id="breadcrumb-current">' . am_e($libSous !== '' ? $libSous : ($libPeriode !== '' ? $libPeriode : $h1)) . '</span>' . "\n      ";
    $html = am_remplacer_interieur($html, 'class="breadcrumb" aria-label="Fil d\'Ariane"', "\n        " . $fil);
}

/* ---------------------------------------------------------------------
   Tête
   --------------------------------------------------------------------- */

$vide = is_array($annonces) && !$annonces;
// Une catégorie vide n'a rien à offrir à un visiteur venu d'un moteur. Le
// catalogue complet, lui, reste indexable en toutes circonstances.
$robots = ($vide && ($archive || ($periode . $sous) !== '')) ? 'noindex, follow' : 'index, follow, max-image-preview:large';

$miettes = [
    ['@type' => 'ListItem', 'position' => 1, 'name' => am_t('tr_category.breadcrumb_home', $lang), 'item' => AM_SITE . '/' . ($en ? '?lang=en' : '')],
    $archive
        ? ['@type' => 'ListItem', 'position' => 2, 'name' => $h1, 'item' => $canonique]
        : ['@type' => 'ListItem', 'position' => 2, 'name' => am_t('category.title_all', $lang), 'item' => AM_SITE . am_url_categorie(null, null, $lang)],
];
if ($libPeriode !== '') {
    $miettes[] = ['@type' => 'ListItem', 'position' => 3, 'name' => $libPeriode, 'item' => AM_SITE . am_url_categorie($periode, null, $lang)];
}
if ($libSous !== '') {
    $miettes[] = ['@type' => 'ListItem', 'position' => count($miettes) + 1, 'name' => $libSous, 'item' => $canonique];
}

$graphe = [[
    '@type'       => 'CollectionPage',
    '@id'         => $canonique,
    'url'         => $canonique,
    'name'        => $nomPage,
    'description' => $description,
    'inLanguage'  => $en ? 'en' : 'fr-FR',
    'isPartOf'    => ['@id' => AM_SITE . '/#website'],
    'breadcrumb'  => ['@id' => $canonique . '#fil'],
]];
$graphe[] = ['@type' => 'BreadcrumbList', '@id' => $canonique . '#fil', 'itemListElement' => $miettes];
if (is_array($annonces) && $annonces) {
    $elements = [];
    foreach (array_values($annonces) as $i => $a) {
        $elements[] = [
            '@type'    => 'ListItem',
            'position' => $i + 1,
            'url'      => AM_SITE . am_url_fiche($a['id'], $en && !empty($a['title_en']) ? 'en' : 'fr', $a['title'] ?? ''),
            'name'     => am_titre_annonce($a, $lang),
        ];
    }
    $graphe[0]['mainEntity'] = ['@id' => $canonique . '#annonces'];
    $graphe[] = ['@type' => 'ItemList', '@id' => $canonique . '#annonces', 'numberOfItems' => count($elements), 'itemListElement' => $elements];
}

$titreCourt = preg_replace('~ \| Athena Militaria$~', '', $titre);
$html = am_entete($html, [
    'lang'        => $lang,
    'title'       => $titre,
    'description' => $description,
    'robots'      => $robots,
    'canonical'   => $canonique,
    'alternates'  => $vide ? null : ['fr' => $urlFr, 'en' => $urlEn, 'x-default' => $urlFr],
    'og'          => [
        'og:title'       => $titreCourt,
        'og:description' => $description,
        'og:url'         => $canonique,
        'og:locale'      => $en ? 'en_US' : 'fr_FR',
    ],
    'twitter'     => [
        'twitter:title'       => $titreCourt,
        'twitter:description' => $description,
    ],
    'jsonld'      => $graphe,
]);

am_envoyer($html);
