<?php
/* =====================================================================
   Sitemap des annonces (/sitemap-annonces.xml, voir .htaccess).

   Le plan est construit ici, depuis la base, et non plus par la fonction
   Supabase « sitemap » :
     - il déclare les photos de chaque fiche (balises image:image), sous leur
       adresse du site (/media/…). Google Images est une porte d'entrée
       majeure pour les objets de collection ;
     - il déclare les versions anglaises, désormais rendues par le serveur
       avec leur propre canonique (product.php, category.php). Une fiche sans
       titre traduit n'a pas de version anglaise et n'en annonce pas ;
     - une seule implémentation, en PHP, à côté des pages qu'elle décrit.
       generate-sitemap.cjs produit la copie de secours avec les mêmes règles.

   Ce qui ne change pas :
     - l'adresse reste sur www.athenamilitaria.fr ;
     - le résultat est gardé six heures ; si la base est injoignable, on sert
       la dernière version connue, puis la copie de secours déposée au
       déploiement, puis un 503 (un 404 dirait à Google que le sitemap
       n'existe pas) ;
     - pg_cron force la régénération chaque nuit avec ?refresh=.
   ===================================================================== */

define('ATHENA', 1);
require __DIR__ . '/inc/athena.php';

$CACHE   = __DIR__ . '/sitemap-annonces-cache.xml';
$SECOURS = __DIR__ . '/sitemap-annonces-secours.xml';
$DUREE   = 6 * 3600;

/* Un sitemap tronqué serait pire qu'un sitemap daté : on ne garde que ce qui
   se termine par sa balise fermante. Un catalogue vide produit un urlset
   valide et court, qui doit être accepté. */
function xml_complet($x): bool
{
    return is_string($x) && strpos($x, '<urlset') !== false && preg_match('~</urlset>\s*$~', $x) === 1;
}

function servir(string $xml, string $origine, ?int $date = null): void
{
    header('Content-Type: application/xml; charset=UTF-8');
    header('Cache-Control: public, max-age=3600');
    header('X-Sitemap-Origine: ' . $origine);
    /* sitemap.xml n'annonce aucune date pour ce fichier : Last-Modified est le
       seul signal de fraîcheur, et il permet de répondre 304. */
    if ($date) {
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $date) . ' GMT');
        $depuis = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) : false;
        if ($depuis !== false && $depuis >= $date) {
            http_response_code(304);
            exit;
        }
    }
    echo $xml;
    exit;
}

function x(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

/* Entrée <url>. $alternates : [langue => URL] ou []. Chaque version reçoit
   sa propre entrée, qui répète le jeu complet d'alternates. */
function entree(string $loc, ?string $lastmod, string $changefreq, string $priorite, array $alternates, array $images = []): string
{
    $s = "  <url>\n    <loc>" . x($loc) . "</loc>\n";
    if ($lastmod) {
        $s .= "    <lastmod>" . $lastmod . "</lastmod>\n";
    }
    $s .= "    <changefreq>$changefreq</changefreq>\n    <priority>$priorite</priority>\n";
    foreach ($alternates as $l => $u) {
        $s .= '    <xhtml:link rel="alternate" hreflang="' . $l . '" href="' . x($u) . "\"/>\n";
    }
    foreach ($images as $img) {
        $s .= "    <image:image>\n      <image:loc>" . x($img) . "</image:loc>\n    </image:image>\n";
    }
    return $s . "  </url>\n";
}

function date_jour(?string $d): ?string
{
    return ($d && preg_match('~^\d{4}-\d{2}-\d{2}~', $d, $m)) ? $m[0] : null;
}

function construire(): ?string
{
    $produits = am_api('products?select=id,created_at,translated_at,period,subcategory,title,title_en,image_url,image_urls'
        . '&status=eq.published&order=created_at.desc&limit=5000', 60);
    if ($produits === null) {
        return null;
    }
    /* Pièces vendues (archive des ventes) : leur fiche reste en ligne avec
       le prix de vente. Elles ne comptent pas dans les catégories, qui
       n'affichent que les annonces en cours. */
    $vendues = am_api('products?select=id,created_at,translated_at,sold_at,title,title_en,image_url,image_urls'
        . '&status=eq.sold&order=sold_at.desc&limit=5000', 60) ?? [];

    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' . "\n"
        . '        xmlns:xhtml="http://www.w3.org/1999/xhtml"' . "\n"
        . '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n\n";

    /* Catégories non vides seulement : category.php pose noindex sur les
       autres, les déclarer serait se contredire. */
    $periodes = [];
    $sous = [];
    foreach ($produits as $p) {
        $d = (string) ($p['created_at'] ?? '');
        if (!empty($p['period'])) {
            $periodes[$p['period']] = max($periodes[$p['period']] ?? '', $d);
            if (!empty($p['subcategory'])) {
                $k = $p['period'] . '|' . $p['subcategory'];
                $sous[$k] = max($sous[$k] ?? '', $d);
            }
        }
    }
    $paire = static function (string $fr): array {
        $en = $fr . (strpos($fr, '?') === false ? '?' : '&') . 'lang=en';
        return [$fr, $en, ['fr' => $fr, 'en' => $en, 'x-default' => $fr]];
    };
    foreach ($periodes as $periode => $der) {
        [$fr, $en, $alt] = $paire(AM_SITE . am_url_categorie($periode, null));
        $xml .= entree($fr, date_jour($der), 'weekly', '0.85', $alt) . entree($en, date_jour($der), 'weekly', '0.6', $alt) . "\n";
    }
    foreach ($sous as $k => $der) {
        [$periode, $type] = explode('|', $k, 2);
        [$fr, $en, $alt] = $paire(AM_SITE . am_url_categorie($periode, $type));
        $xml .= entree($fr, date_jour($der), 'weekly', '0.8', $alt) . entree($en, date_jour($der), 'weekly', '0.6', $alt) . "\n";
    }

    /* Catégories enrichies sans annonce : indexables en français depuis le
       22 septembre 2026, parce que leur texte rédigé et leurs guides liés
       suffisent à en faire une page utile (voir category.php). Depuis le
       28 sept. 2026, le texte existe aussi en anglais (resume_en, écrit par
       build-categories.cjs) : la version anglaise est alors indexable, et on
       déclare les deux versions avec leurs hreflang. Une catégorie sans
       resume_en garde son anglais hors index : on ne déclare alors que la
       française, sans hreflang, sans quoi le plan de site contredirait la
       page. Même condition que $bilingue dans category.php. */
    $manifeste = json_decode((string) @file_get_contents(__DIR__ . '/inc/categories.json'), true) ?: [];
    foreach ($manifeste as $c) {
        $periode = (string) ($c['periode'] ?? '');
        $type = (string) ($c['type'] ?? '');
        if ($periode === '') {
            continue;
        }
        $dejaListee = $type === '' ? isset($periodes[$periode]) : isset($sous[$periode . '|' . $type]);
        if ($dejaListee) {
            continue;
        }
        $url = AM_SITE . am_url_categorie($periode, $type !== '' ? $type : null);
        $priorite = $type === '' ? '0.7' : '0.6';
        if (trim((string) ($c['resume_en'] ?? '')) !== '') {
            [$fr, $en, $alt] = $paire($url);
            $xml .= entree($fr, null, 'monthly', $priorite, $alt) . entree($en, null, 'monthly', '0.5', $alt) . "\n";
        } else {
            $xml .= entree($url, null, 'monthly', $priorite, []) . "\n";
        }
    }

    if ($vendues) {
        [$fr, $en, $alt] = $paire(AM_SITE . '/ventes');
        $der = date_jour($vendues[0]['sold_at'] ?? null);
        $xml .= entree($fr, $der, 'weekly', '0.7', $alt) . entree($en, $der, 'weekly', '0.5', $alt) . "\n";
    }

    foreach (array_merge($produits, $vendues) as $p) {
        $fr = AM_SITE . am_url_fiche($p['id'], 'fr', $p['title'] ?? '');
        $photos = (is_array($p['image_urls'] ?? null) && $p['image_urls']) ? $p['image_urls'] : array_filter([$p['image_url'] ?? null]);
        $images = [];
        foreach (array_slice($photos, 0, 10) as $u) {
            $images[] = am_absolu(am_img($u, 1200));
        }
        // Une fiche vendue change le jour de la vente (bandeau, disponibilité).
        $lastmod = date_jour(max((string) ($p['created_at'] ?? ''), (string) ($p['sold_at'] ?? '')));
        if (!empty($p['title_en'])) {
            $en = AM_SITE . am_url_fiche($p['id'], 'en', $p['title'] ?? '');
            $alt = ['fr' => $fr, 'en' => $en, 'x-default' => $fr];
            $lastmodEn = date_jour(max((string) ($p['created_at'] ?? ''), (string) ($p['translated_at'] ?? '')));
            $xml .= entree($fr, $lastmod, 'weekly', '0.8', $alt, $images) . entree($en, $lastmodEn, 'weekly', '0.5', $alt) . "\n";
        } else {
            $xml .= entree($fr, $lastmod, 'weekly', '0.8', [], $images) . "\n";
        }
    }

    return $xml . "</urlset>\n";
}

/* Régénération forcée, réservée à la tâche planifiée. Le jeton n'est pas un
   secret sensible : il évite qu'un passant relance la génération en boucle. */
$forcer = isset($_GET['refresh']) && is_string($_GET['refresh'])
    && hash_equals('af9e943f873ff6307dde5ee8e854327d', $_GET['refresh']);

// 1. Cache encore valide.
if (!$forcer && is_readable($CACHE) && (time() - filemtime($CACHE)) < $DUREE) {
    $xml = (string) file_get_contents($CACHE);
    if (xml_complet($xml)) {
        servir($xml, 'cache', filemtime($CACHE));
    }
}

// 2. Construction depuis la base.
$xml = construire();
if ($xml !== null && xml_complet($xml)) {
    $tmp = $CACHE . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $xml) !== false) {
        @rename($tmp, $CACHE);
    } else {
        @unlink($tmp);
    }
    clearstatcache(true, $CACHE);
    servir($xml, 'base', @filemtime($CACHE) ?: time());
}

// 3. Base injoignable : dernière version connue, même périmée.
if (is_readable($CACHE)) {
    $xml = (string) file_get_contents($CACHE);
    if (xml_complet($xml)) {
        servir($xml, 'cache-perime', filemtime($CACHE));
    }
}

// 4. Copie déposée au dernier déploiement.
if (is_readable($SECOURS)) {
    $xml = (string) file_get_contents($SECOURS);
    if (xml_complet($xml)) {
        servir($xml, 'secours', filemtime($SECOURS));
    }
}

http_response_code(503);
header('Retry-After: 3600');
header('Content-Type: text/plain; charset=UTF-8');
echo "Sitemap des annonces temporairement indisponible.\n";
