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

/* Catégorie sans texte propre (pas d'entrée dans le manifeste) : on lui
   prête le résumé de sa période. Elle servait sinon le texte générique du
   catalogue complet (« Le catalogue militaria d'Athena Militaria », « Les
   périodes couvertes »…) : Équipements 39-45, Objets divers 14-18,
   Médailles 39-45 et Objets divers de la Guerre froide partageaient 93 à
   97 % de leur texte avec /militaria (audit du 10 oct. 2026). Aucun texte
   nouveau : le résumé est déjà relu et publié sur la page de la période.
   Ses guides, eux, ne sont pas prêtés : plusieurs sont gelés jusqu'au
   20 oct. 2026, et des liens nouveaux vers eux fausseraient le bilan.
   Décision de l'exploitant (10 oct. 2026) : cette recopie reste, y compris
   sur les deux catégories 39-45, et aucun texte nouveau sur 1933-1945. Le
   bloc « Acheter en confiance » reste sous le résumé (voir plus bas). */
$periodeTexte = null;
if ($enrichie === null && $periode !== '' && $q === '') {
    foreach ($manifeste as $c) {
        if ($c['periode'] === $periode && ($c['type'] ?? '') === '') {
            $periodeTexte = $c;
            break;
        }
    }
}

/* Guides qui répondent à la question du visiteur de cette catégorie
   (inc/categories.json, choix éditorial fait dans build-categories.cjs). */
$guidesCategorie = [];
if ($enrichie && !empty($enrichie['guides'])) {
    $parSlug = [];
    foreach (am_guides() as $g) {
        $parSlug[$g['slug']] = $g;
    }
    foreach ($enrichie['guides'] as $slug) {
        if (isset($parSlug[$slug])) {
            $guidesCategorie[] = $parSlug[$slug];
        }
    }
}

/* Texte de la catégorie : la copie porte la version française et, depuis le
   28 sept. 2026, la version anglaise (build-categories.cjs). On ne sert que
   celle de la langue demandée ; une page bilingue, ni le lecteur ni le moteur
   ne savent la classer. */
if ($en) {
    $html = preg_replace('~<!-- contexte-fr:debut -->.*?<!-- contexte-fr:fin -->~s', '', $html);
    $html = str_replace(' lang="en" aria-labelledby=', ' aria-labelledby=', $html);
    $html = (string) preg_replace('~(<!-- contexte-en:debut -->\s*<section[^>]*?) hidden>~', '$1>', $html);
    /* Le texte générique du catalogue (#catalogue-guide) était retiré ici,
       faute de version anglaise : les pages anglaises indexées n'avaient que
       quelques dizaines de mots. Ses blocs portent désormais leurs clés
       (category.guide_*, i18n.js), traduites par am_traduire comme le
       reste de la page. */
    $html = am_traduire($html, 'en');
} else {
    $html = preg_replace('~<!-- contexte-en:debut -->.*?<!-- contexte-en:fin -->~s', '', $html);
}

/* ---------------------------------------------------------------------
   Recherche interne : servie telle quelle, hors index
   --------------------------------------------------------------------- */

if ($q !== '') {
    /* Titre de l'onglet et H1 d'une recherche, dans la formule qu'écrit le
       script de category.html. L'onglet gardait le titre du catalogue
       complet, en français même sur ?lang=en, et le H1 ne changeait
       qu'une fois ce script passé : l'historique, les onglets et les
       lecteurs d'écran ne distinguaient pas une recherche d'une autre, et
       une recherche anglaise montrait d'abord « Militaria catalogue: all
       listings ». Le H1 ne porte ni data-i18n ni data-ssr : le script le
       réécrit à l'identique, dans la langue servie (la page française reste
       française, i18n.js). Le visiteur qui a choisi l'anglais ne la voit
       pas : la recherche n'a pas de hreflang, et le script en ligne du haut
       de page redemande la même adresse avec lang=en, servie ici en
       anglais. La page reste hors index : ce titre ne sert qu'au visiteur. */
    $resultats = $en
        ? 'Results for “' . $q . '”'
        : "Résultats pour «\u{00A0}" . $q . "\u{00A0}»";
    $html = preg_replace_callback('~<h1 id="category-title"[^>]*>.*?</h1>~s', static function () use ($resultats) {
        return '<h1 id="category-title">' . am_e($resultats) . '</h1>';
    }, $html, 1);
    $html = am_entete($html, [
        'lang'        => $lang,
        'title'       => $resultats . ' | Athena Militaria',
        'description' => am_t('seo.category.desc', $lang),
        'robots'      => 'noindex, follow',
        'alternates'  => null,
    ]);
    am_envoyer($html);
}

/* ---------------------------------------------------------------------
   Annonces
   --------------------------------------------------------------------- */

$requete = $archive
    ? 'products?select=id,title,title_en,price,image_url,historically_sensitive,authenticated_at,created_at,status,sold_at'
        . '&status=eq.sold&order=sold_at.desc&limit=120'
    : 'products?select=id,title,title_en,price,image_url,historically_sensitive,authenticated_at,created_at'
        . '&status=eq.published&order=created_at.desc&limit=60';
if ($periode !== '') {
    $requete .= '&period=eq.' . rawurlencode($periode);
}
if ($sous !== '') {
    $requete .= '&subcategory=eq.' . rawurlencode($sous);
}
$annonces = am_api($requete, 300);

/* Annonces en ligne, période et type seulement : le menu s'en sert plus bas
   (périodes et types ajoutés à la demande), et le compteur ici. La grille
   s'arrête à 60 annonces ; au-delà, le compteur et les données
   structurées disaient « 60 », quand un membre connecté (script.js, sans
   limite) voyait le vrai total. Cette liste le donne sans requête de plus.
   En deçà de 60, la grille est complète et fait foi : les deux réponses en
   cache peuvent dater de passages différents. */
$publiees = am_api('products?select=period,subcategory&status=eq.published&limit=1000', 300);
$total = is_array($annonces) ? count($annonces) : 0;
if (!$archive && $total >= 60 && is_array($publiees)) {
    $compte = 0;
    foreach ($publiees as $ligne) {
        if (($periode === '' || ($ligne['period'] ?? '') === $periode) && ($sous === '' || ($ligne['subcategory'] ?? '') === $sous)) {
            $compte++;
        }
    }
    $total = max($total, $compte);
}

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
    /* Titres dans les mots qu'on tape : « médailles 14-18 à vendre »,
       « militaria 39-45 à vendre ». Relevé Search Console du 23 sept. 2026 :
       la page Médailles, titrée « Médailles 1ère Guerre Mondiale : annonces
       de militaria », comptait 87 impressions en position 42 et aucun clic,
       pour des requêtes comme « médailles 14 18 » ou « médaille de guerre
       14 18 ». Mêmes formules dans build-categories.cjs.
       « Paiement protégé » a quitté les descriptions le 23 sept. 2026, quand
       le paiement en ligne n'était pas encore ouvert. */
    $ere = am_ere_categorie($periode, $lang) ?: $libPeriode;
    $nombre = $total;
    if ($en) {
        $theme = trim($ere . ' ' . ($libSous !== '' ? mb_strtolower($libSous) : 'militaria'));
        $h1 = $theme . ' for sale';
        $titre = am_titre_page($h1);
        $description = ucfirst($theme) . ' for sale between collectors: detailed photos, described condition and direct contact with the seller. Listing is free.';
    } else {
        $theme = $libSous !== '' ? $libSous . ' ' . $ere : 'Militaria ' . $ere;
        $precision = ['1ère Guerre Mondiale' => ' : Première Guerre mondiale', '2nde Guerre Mondiale' => ' : Seconde Guerre mondiale'];
        $h1 = $libSous !== '' ? $theme . ' à vendre' : $theme . ($precision[$periode] ?? '');
        $titre = am_titre_page($theme . ' à vendre');
        $description = !empty($enrichie['seoDescription'])
            ? $enrichie['seoDescription']
            : ($nombre > 5 ? $nombre . ' pièces : ' : '') . $theme
                . ' à vendre entre collectionneurs : photos détaillées, état décrit, contact direct avec le vendeur. Dépôt d\'annonce gratuit.';
    }
    /* Sans annonce, la description promettait des « photos détaillées » et
       un « état décrit » qui n'existaient pas (audit du 1er oct. 2026, onze
       pages). On dit alors ce que la page contient vraiment. */
    if ($nombre === 0 && !$archive) {
        $description = $en
            ? ucfirst($theme) . ': collecting pointers, key pieces, points to check and guides. No listing at the moment: list yours for free.'
            : ucfirst($theme) . ' : repères pour collectionner, pièces emblématiques, points de vigilance et guides. Aucune annonce en ce moment : déposez la vôtre.';
        /* Les thèmes longs (« Révolution et Premier Empire ») dépassent la
           longueur affichée par Google : on retire un membre de phrase. */
        if (mb_strlen($description) > 165) {
            $description = str_replace([', points de vigilance et guides', ', points to check and guides'], [' et guides', ' and guides'], $description);
        }
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
    // Rang de la carte : les deux premières ne sont pas différées (am_carte).
    $rang = 0;
    foreach ($annonces as $a) {
        $grille .= am_carte($a, $lang, $rang++);
    }
    if (!$annonces) {
        /* Une catégorie sans annonce était une impasse : « Aucun article
           trouvé », puis rien. Le visiteur venu d'un moteur repartait sans
           savoir qu'une réponse à sa question existait deux clics plus
           loin. On dit ce qu'il en est, et on l'invite à déposer la pièce
           qu'il cherche peut-être à vendre. Rien sur le paiement : la mention
           « et le paiement sécurisé » a été retirée le 6 oct. 2026, pendant
           la suspension des achats, rouverts le jour même. La remettre se
           décide en même temps que celle des descriptions, plus haut, et du
           texte du catalogue (category.html), retirées elles aussi quand le
           paiement n'était pas ouvert. */
        $grille = $archive
            ? '<p>' . am_e(am_t('tr_js_script.no_items_found', $lang)) . '</p>'
            : '<div class="categorie-vide"><p>'
                . am_e($en
                    ? 'No piece is listed in this category at the moment.'
                    : 'Aucune pièce n\'est en vente dans cette catégorie pour le moment.')
                . '</p><p>'
                . am_e($en
                    ? 'Have one to sell? Listing is free.'
                    : 'Vous en avez une à vendre ? La mise en ligne est gratuite.')
                . ' <a href="' . am_e('/sell' . ($en ? '?lang=en' : '')) . '">'
                . am_e($en ? 'List a piece' : 'Déposer une annonce') . '</a></p></div>';
    }
    $n = $total;
    $mots = $archive ? ['archive.vente_word', 'archive.ventes_word'] : ['tr_js_script.annonce_word', 'tr_js_script.annonces_word'];
    /* Zéro prend le singulier en français (« 0 annonce ») mais le pluriel en
       anglais (« 0 listings »). Les catégories anglaises vides qui ont leur
       texte sont désormais indexables (voir $bilingue plus bas) : le
       compteur, lu par les lecteurs d'écran et les moteurs, doit s'y lire
       juste. */
    $pluriel = $en ? $n !== 1 : $n > 1;
    $compteur = $n . ' ' . am_t($mots[$pluriel ? 1 : 0], $lang);
    $html = am_remplacer_interieur($html, 'id="category-grid"', $grille . '      ');
    if ($archive) {
        $html = am_remplacer_interieur($html, 'id="grille-titre"', $en ? 'Sold pieces' : 'Pièces vendues', '<h2 class="sr-only" id="grille-titre">');
    }
    $html = am_remplacer_interieur($html, 'id="category-count"', am_e($compteur), '<div class="category-count" id="category-count" role="status" aria-live="polite">');
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
} elseif ($periodeTexte !== null) {
    /* Le texte de la période, dans la langue servie, et le lien vers sa
       page : la catégorie dit à quoi elle se rattache au lieu de répéter la
       présentation du catalogue complet. */
    $resume = ($en && trim((string) ($periodeTexte['resume_en'] ?? '')) !== '') ? $periodeTexte['resume_en'] : ($periodeTexte['resume'] ?? '');
    if (trim((string) $resume) !== '') {
        $libelleP = am_libelle_periode($periodeTexte['periode'], $lang);
        /* « Acheter en confiance » reste sous le résumé : seul le texte
           générique du catalogue (présentation, périodes couvertes) cède la
           place. Le bloc est repris tel que la page le porte à ce stade,
           donc déjà dans la langue servie (am_traduire, plus haut), avec ses
           clés data-i18n. Il disparaissait avec le reste, et ces catégories
           perdaient le seul passage qui dit quoi vérifier avant d'acheter. */
        $confiance = preg_match('~<h3 data-i18n="category\.guide_trust_title">.*?</p>~s', $html, $bloc)
            ? "\n\n        " . $bloc[0]
            : '';
        $html = am_remplacer_interieur(
            $html,
            'id="catalogue-guide"',
            "\n        " . '<h2 id="catalogue-guide-title">' . am_e($libelleP) . '</h2>'
                . "\n        " . '<p>' . am_e($resume) . '</p>'
                . "\n        " . '<p class="product-vendre"><a href="' . am_e(am_url_categorie($periodeTexte['periode'], null)) . '">'
                . am_e(($en ? 'All listings: ' : "Toutes les annonces\u{00A0}: ") . $libelleP) . '</a></p>'
                . $confiance . "\n      ",
            $ouvertureGuide
        );
    }
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
   ne mène ainsi jamais à une page vide. $publiees est lu plus haut, avec
   les annonces. */
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

/* Types qui ont des annonces, absents du menu d'une période déjà présente.
   Le menu écrit dans category.html ne liste que les trois types rédigés de
   chaque période : Équipements 39-45, qui portait trois des dix annonces en
   ligne, ne recevait que quatre liens internes, quand les types vides du
   menu en recevaient 23 à 26 (audit du 10 oct. 2026). Même balisage que les
   autres entrées ; ajoutés en fin de liste, dans l'ordre de taxonomie.js. */
if (is_array($publiees)) {
    $segP = $segP ?? am_segments_periodes();
    $clesT = $clesT ?? am_objet_js('taxonomie.js', 'CLES_TYPES');
    foreach (am_periodes() as $p) {
        $seg = $segP[$p] ?? '';
        if ($seg === '' || empty($presence[$p])) {
            continue;
        }
        $debutGroupe = strpos($html, '<details class="sidebar-group" data-cat="' . $seg . '"');
        if ($debutGroupe === false) {
            continue;
        }
        $finListe = strpos($html, '</ul>', $debutGroupe);
        if ($finListe === false) {
            continue;
        }
        $ajouts = '';
        foreach (am_sous_categories() as $t) {
            $url = am_url_categorie($p, $t);
            if (empty($presence[$p][$t]) || strpos(substr($html, $debutGroupe, $finListe - $debutGroupe), 'href="' . $url . '"') !== false) {
                continue;
            }
            $ajouts .= '  <li><a href="' . am_e($url) . '"><span data-i18n="' . am_e($clesT[$t] ?? '') . '">'
                . am_e(am_libelle_sous($t, $lang)) . "</span></a></li>\n          ";
        }
        if ($ajouts !== '') {
            $html = substr($html, 0, $finListe) . $ajouts . substr($html, $finListe);
        }
    }
}

/* Compteurs du menu : ajoutés le 3 oct. 2026, retirés le 4 à la demande de
   l'exploitant, qui ne veut pas afficher le nombre d'annonces par catégorie.
   Ne pas les remettre. */

if ($h1 !== null) {
    $html = preg_replace_callback('~<h1 id="category-title"[^>]*>.*?</h1>~s', static function () use ($h1) {
        return '<h1 id="category-title" data-ssr="1">' . am_e($h1) . '</h1>';
    }, $html, 1);

    // Fil d'Ariane visible : même structure que celle qu'écrivait script.js.
    // Chaque chevron est soudé au maillon qui le suit (même balisage que la
    // fiche) : il ne reste jamais seul en fin de ligne sur téléphone.
    $sep = '<span class="breadcrumb-sep crumb-sep" aria-hidden="true">›</span>';
    $fil = '<a href="' . ($en ? '/?lang=en' : '/') . '">' . am_e(am_t('tr_category.breadcrumb_home', $lang)) . '</a>';
    if ($libPeriode !== '' && $libSous !== '') {
        $fil .= "\n        " . '<span class="crumb">' . $sep . '<a href="' . am_e(am_url_categorie($periode, null, $lang)) . '">' . am_e($libPeriode) . '</a></span>';
    }
    $fil .= "\n        " . '<span class="crumb">' . $sep . '<span class="breadcrumb-current" id="breadcrumb-current">' . am_e($libSous !== '' ? $libSous : ($libPeriode !== '' ? $libPeriode : $h1)) . '</span></span>' . "\n      ";
    /* Repérage sans le libellé : sur la page anglaise, am_traduire a déjà
       écrit « Breadcrumb » (data-i18n-aria-label). */
    $html = am_remplacer_interieur($html, 'class="breadcrumb" aria-label="', "\n        " . $fil);
}

/* ---------------------------------------------------------------------
   Tête
   --------------------------------------------------------------------- */

if ($guidesCategorie) {
    $titreGuides = $en ? 'Guides for these pieces' : 'Guides pour ces pièces';
    $blocGuides = "\n    <section class=\"product-guides categorie-guides\" aria-labelledby=\"categorie-guides-titre\">\n"
        . '      <h2 id="categorie-guides-titre">' . am_e($titreGuides) . "</h2>\n      <ul>\n";
    foreach ($guidesCategorie as $g) {
        $h1g = ($en && !empty($g['h1_en'])) ? $g['h1_en'] : $g['h1'];
        $resume = ($en && !empty($g['description_en'])) ? $g['description_en'] : $g['description'];
        $lien = '/guides/' . $g['slug'] . ($en && !empty($g['h1_en']) ? '?lang=en' : '');
        $blocGuides .= '        <li><a href="' . am_e($lien) . '">' . am_e($h1g) . '</a><span>' . am_e($resume) . "</span></li>\n";
    }
    $blocGuides .= "      </ul>\n";
    /* Une catégorie qui a des annonces est lue par des collectionneurs de
       la période, dont beaucoup ont des pièces à vendre. (La catégorie vide
       porte déjà son invitation, dans la grille.) */
    if (!$archive && is_array($annonces) && $annonces) {
        $blocGuides .= '      <p class="product-vendre">'
            . ($en
                ? 'Have pieces from this period? <a href="/sell?lang=en">List them for free</a>: they will be seen by the collectors browsing this page.'
                : 'Vous avez des pièces de cette période ? <a href="/sell">Déposez-les gratuitement</a> : elles seront vues par les collectionneurs qui consultent cette page.')
            . "</p>\n";
    }
    $blocGuides .= "    </section>\n";
    /* Juste après la grille : c'est là que le regard tombe quand la grille
       est vide, et là qu'un acheteur qui hésite cherche de quoi trancher. */
    /* La grille contient des cartes, elles-mêmes faites de <div> : le
       premier </div> rencontré n'est pas celui de la grille. On compte donc
       la profondeur jusqu'à la fermeture qui lui correspond. */
    $posGrille = strpos($html, 'id="category-grid"');
    if ($posGrille !== false) {
        $debut = strrpos(substr($html, 0, $posGrille), '<div');
        $profondeur = 0;
        $i = $debut;
        $fin = false;
        while (preg_match('~<div\b|</div>~', $html, $m, PREG_OFFSET_CAPTURE, $i)) {
            $pos = $m[0][1];
            if ($m[0][0] === '</div>') {
                $profondeur--;
                if ($profondeur === 0) { $fin = $pos + 6; break; }
            } else {
                $profondeur++;
            }
            $i = $pos + 4;
        }
        if ($fin !== false) {
            $html = substr($html, 0, $fin) . $blocGuides . substr($html, $fin);
        }
    }
}

$vide = is_array($annonces) && !$annonces;
// Archive, période ou type : tout sauf le catalogue complet.
$filtree = $archive || ($periode . $sous) !== '';
/* Une catégorie vide n'avait rien à offrir à un visiteur venu d'un moteur,
   d'où le noindex. Mais la règle était trop large : les seize catégories
   enrichies portent 450 à 700 mots rédigés et, depuis le 22 septembre
   2026, les guides qui répondent à la question du visiteur. L'ancienne
   adresse des médailles 14-18 recevait 87 impressions quand elle a été
   redirigée vers une page vide, donc exclue : Google allait perdre une
   page qu'il servait. Une page enrichie reste donc indexable même vide.
   La version anglaise en était exclue parce qu'elle n'avait pas ce texte.
   build-categories.cjs écrit aussi le texte anglais, le bloc contexte-en
   depuis le 28 sept. 2026 et resume_en depuis le 29 sept. ; resume_en
   n'existe que si le bloc contexte-en existe. La version anglaise suit
   donc la même règle dès que resume_en existe. Une catégorie enrichie sans
   resume_en garderait son anglais hors index. */
$bilingue = $enrichie !== null && trim((string) ($enrichie['resume_en'] ?? '')) !== '';
$editoriale = $enrichie !== null && (!$en || $bilingue);
$robots = ($vide && !$editoriale && $filtree)
    ? 'noindex, follow'
    : 'index, follow, max-image-preview:large';
/* hreflang : posés seulement quand les deux versions sont indexables. Le
   calcul ne dépend pas de la langue servie, sinon la page française
   pourrait annoncer une version anglaise en noindex, ou l'inverse, et les
   alternates ne seraient plus réciproques. La version anglaise est la plus
   exigeante des deux ($bilingue implique $enrichie) : c'est elle qui
   décide. Même règle dans sitemap.php et generate-sitemap.cjs. */
$alternes = !($vide && !$bilingue && $filtree);

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
    $graphe[] = ['@type' => 'ItemList', '@id' => $canonique . '#annonces', 'numberOfItems' => max(count($elements), $total), 'itemListElement' => $elements];
}

$titreCourt = preg_replace('~ \| Athena Militaria$~', '', $titre);
$html = am_entete($html, [
    'lang'        => $lang,
    'title'       => $titre,
    'description' => $description,
    'robots'      => $robots,
    'canonical'   => $canonique,
    'alternates'  => $alternes ? ['fr' => $urlFr, 'en' => $urlEn, 'x-default' => $urlFr] : null,
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
