<?php
/* =====================================================================
   Accueil et versions anglaises des pages fixes, rendus côté serveur.

   Accueil : la grille « Derniers articles » était figée au déploiement
   (generate-sitemap.cjs) ; une annonce publiée entre deux déploiements
   n'apparaissait dans le HTML servi qu'au suivant. On la réécrit ici à
   chaque demande, avec cinq minutes de cache.

   ?lang=en sur l'accueil, À propos, Communauté, Vendre et Mentions : le
   HTML servi était le français, avec une canonique vers la page française,
   que i18n.js remplaçait ensuite par l'adresse anglaise. Google recevait
   deux signaux contraires et tranchait au cas par cas. La traduction est
   désormais appliquée ici, avec la table de i18n.js, et la tête du document
   décrit la version anglaise dès le HTML brut.

   La page est déduite de l'adresse demandée, jamais d'un paramètre : un
   visiteur ne peut pas faire servir une page à l'adresse d'une autre.
   ===================================================================== */

define('ATHENA', 1);
require __DIR__ . '/inc/athena.php';

const PAGES = ['' => 'index', 'about' => 'about', 'community' => 'community', 'sell' => 'sell', 'legal' => 'legal'];

$chemin = trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH), '/');
/* Copie d'essai déposée sous un autre nom avant mise en production : la page
   ne peut pas se déduire de l'adresse, on l'indique en paramètre. Sans effet
   sur page.php lui-même. */
if (basename(__FILE__) !== 'page.php' && isset($_GET['essai'])) {
    $chemin = (string) $_GET['essai'];
}
if (!array_key_exists($chemin, PAGES)) {
    am_introuvable();
}
$page = PAGES[$chemin];
$lang = am_langue();
$en = $lang === 'en';

$html = (string) file_get_contents(__DIR__ . '/' . $page . '.html');

/* Dernières annonces de l'accueil : mêmes cartes que loadLatestProducts. */
if ($page === 'index') {
    $annonces = am_api('products?select=id,title,title_en,price,image_url,historically_sensitive,authenticated_at'
        . '&status=eq.published&order=created_at.desc&limit=32', 300);
    $debut = '<!-- annonces:debut -->';
    $fin = '<!-- annonces:fin -->';
    $a = strpos($html, $debut);
    $b = strpos($html, $fin);
    if (is_array($annonces) && $a !== false && $b !== false && $b > $a) {
        $cartes = "\n";
        foreach ($annonces as $p) {
            $cartes .= am_carte($p, $lang);
        }
        $html = substr($html, 0, $a + strlen($debut)) . $cartes . '      ' . substr($html, $b);
    }
}

if (!$en) {
    am_envoyer(am_entete($html, ['lang' => 'fr']));
}

$fr = AM_SITE . '/' . $chemin;
$urlEn = $fr . '?lang=en';
$titre = am_t('seo.' . $page . '.title', 'en');
$description = am_t('seo.' . $page . '.desc', 'en');
$titreCourt = preg_replace('~\s*[|:]\s*Athena Militaria$~', '', $titre);

$html = am_traduire($html, 'en', am_supplement_page($html));

/* Les données structurées du français décrivent un contenu français (FAQ,
   présentation) : les garder sur la page anglaise contredirait le texte
   affiché. On les remplace par une description de la page elle-même. */
$graphe = [[
    '@type'       => $page === 'about' ? 'AboutPage' : 'WebPage',
    '@id'         => $urlEn,
    'url'         => $urlEn,
    'name'        => $titreCourt,
    'description' => $description,
    'inLanguage'  => 'en',
    'isPartOf'    => ['@id' => AM_SITE . '/#website'],
]];
if ($page !== 'index') {
    $graphe[] = [
        '@type'           => 'BreadcrumbList',
        '@id'             => $urlEn . '#breadcrumb',
        'itemListElement' => [
            ['@type' => 'ListItem', 'position' => 1, 'name' => 'Home', 'item' => AM_SITE . '/?lang=en'],
            ['@type' => 'ListItem', 'position' => 2, 'name' => $titreCourt, 'item' => $urlEn],
        ],
    ];
}
$graphe[] = [
    '@type' => 'Organization',
    '@id'   => AM_SITE . '/#organization',
    'name'  => 'Athena Militaria',
    'url'   => AM_SITE . '/',
    'logo'  => ['@type' => 'ImageObject', 'url' => AM_SITE . '/icon-192.png', 'width' => 192, 'height' => 192],
];
if ($page === 'index') {
    $graphe[] = [
        '@type'      => 'WebSite',
        '@id'        => AM_SITE . '/#website',
        'url'        => AM_SITE . '/',
        'name'       => 'Athena Militaria',
        'inLanguage' => ['fr-FR', 'en'],
        'publisher'  => ['@id' => AM_SITE . '/#organization'],
    ];
}

$html = am_entete($html, [
    'lang'        => 'en',
    'title'       => $titre,
    'description' => $description,
    'canonical'   => $urlEn,
    'alternates'  => ['fr' => $fr, 'en' => $urlEn, 'x-default' => $fr],
    'og'          => [
        'og:title'            => $titreCourt,
        'og:description'      => $description,
        'og:url'              => $urlEn,
        'og:locale'           => 'en_US',
        'og:locale:alternate' => 'fr_FR',
    ],
    'twitter'     => [
        'twitter:title'       => $titreCourt,
        'twitter:description' => $description,
    ],
    'jsonld'      => $graphe,
]);

am_envoyer($html);
