<?php
/* =====================================================================
   Flux produits pour Google Merchant Center (/flux-produits.xml).

   Pourquoi : Search Console proposait d'afficher les annonces dans l'onglet
   Shopping de Google, gratuitement, à condition de les déclarer dans
   Merchant Center. Ce flux est relu par Google toutes les 24 heures : une
   annonce publiée y entre d'elle-même, une annonce vendue en sort.

   Ce qui n'y entre pas, par prudence : Google Shopping interdit les armes
   (dagues, baïonnettes, armes neutralisées comprises), les munitions et les
   symboles des régimes de 1933-1945. Une seule annonce contraire à ces
   règles peut faire suspendre le compte marchand tout entier, et avec lui le
   programme Avis clients. On écarte donc la catégorie « Armes », les
   annonces signalées sensibles par leur vendeur, et celles dont le titre ou
   la description emploie un mot de ces familles. Elles restent en vente sur
   le site, simplement absentes de Shopping.

   Format : RSS 2.0 avec l'espace de noms g:, celui que Merchant Center lit.
   Cache d'une heure ; si la base ne répond pas, on sert la dernière version.
   ===================================================================== */

define('ATHENA', 1);
require __DIR__ . '/inc/athena.php';

$CACHE = __DIR__ . '/flux-produits-cache.xml';
$DUREE = 3600;

function flux_servir(string $xml): void
{
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    header('X-Robots-Tag: noindex');
    echo $xml;
    exit;
}

if (is_file($CACHE) && time() - filemtime($CACHE) < $DUREE && !isset($_GET['refresh'])) {
    flux_servir((string) file_get_contents($CACHE));
}

$annonces = am_api('products?select=id,title,description,period,subcategory,condition,price,quantity,'
    . 'image_url,image_urls,historically_sensitive,ship_pickup,ship_post,ship_relay'
    . '&status=eq.published&order=created_at.desc&limit=1000', 600);
if (!is_array($annonces)) {
    if (is_file($CACHE)) {
        flux_servir((string) file_get_contents($CACHE));
    }
    http_response_code(503);
    header('Retry-After: 3600');
    exit;
}

$tarifs = [];
foreach (am_api('shipping_rates?select=method,amount_cents', 86400) ?: [] as $r) {
    $tarifs[$r['method']] = $r;
}

/* Familles refusées par Google Shopping : armes et munitions, symboles des
   régimes de 1933-1945. Liste volontairement large : une annonce écartée à
   tort reste en vente sur le site, une annonce admise à tort met le compte
   en danger. */
const FLUX_MOTS_EXCLUS = '~(*UCP)\b(dagues?|poignards?|ba[iï]onnettes?|couteaux?|sabres?|[ée]p[ée]es?|glaives?|machettes?'
    . '|fusils?|carabines?|pistolets?|revolvers?|mousquetons?|armes?|munitions?|obus|grenades?|cartouches?|douilles?'
    . '|fus[ée]es?|d[ée]tonateurs?|percutantes?|explosifs?|mines?|roquettes?|mortiers?'
    . '|nazie?s?|ss|nsdap|svastika|swastika|croix gamm[ée]e|hitler|waffen|reich\w*|third reich)\b~iu';

function flux_exclue(array $p): bool
{
    if (!empty($p['historically_sensitive'])) {
        return true;
    }
    /* Remise en main propre seulement : Google refuse une fiche Shopping sans
       livraison (« informations de livraison manquantes »), et déclarer des
       frais de port que le vendeur n'a pas proposés serait faux. Relevé du
       26 sept. 2026 : c'était le motif de refus des deux premières fiches. */
    if (empty($p['ship_post']) && empty($p['ship_relay'])) {
        return true;
    }
    if (strpos((string) ($p['subcategory'] ?? ''), 'Armes') === 0) {
        return true;
    }
    return preg_match(FLUX_MOTS_EXCLUS, ($p['title'] ?? '') . ' ' . ($p['description'] ?? '')) === 1;
}

function flux_x(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function flux_absolu(string $u): string
{
    return strpos($u, 'http') === 0 ? $u : AM_SITE . $u;
}

/* Achats suspendus (PAIEMENTS_EN_MAINTENANCE dans product.php) : le flux ne
   propose aucun produit. Google Shopping exige qu'un produit annoncé puisse
   être acheté sur la page d'arrivée ; tant que le paiement en ligne reste en
   mode test, le lister serait une présentation trompeuse (audit du 6 oct.
   2026). Repasser à false avec product.php et product.js. */
const FLUX_ACHATS_SUSPENDUS = false;
if (FLUX_ACHATS_SUSPENDUS) {
    $annonces = [];
}

$items = '';
$retenues = 0;
foreach ($annonces as $p) {
    if (flux_exclue($p) || (float) ($p['price'] ?? 0) <= 0) {
        continue;
    }
    $photos = (is_array($p['image_urls'] ?? null) && $p['image_urls']) ? $p['image_urls']
        : (!empty($p['image_url']) ? [$p['image_url']] : []);
    if (!$photos) {
        continue;   // Google refuse un produit sans image
    }
    $titre = trim((string) $p['title']);
    $description = trim(preg_replace('~\s+~u', ' ', (string) ($p['description'] ?? '')));
    $libPeriode = am_libelle_periode((string) ($p['period'] ?? ''), 'fr');
    $libSous = am_libelle_sous((string) ($p['subcategory'] ?? ''), 'fr');

    $items .= "    <item>\n"
        . '      <g:id>' . flux_x((string) $p['id']) . "</g:id>\n"
        . '      <title>' . flux_x(mb_substr($titre, 0, 150)) . "</title>\n"
        . '      <description>' . flux_x(mb_substr($description !== '' ? $description : $titre, 0, 5000)) . "</description>\n"
        . '      <link>' . flux_x(AM_SITE . am_url_fiche($p['id'], 'fr', $titre)) . "</link>\n"
        . '      <g:image_link>' . flux_x(flux_absolu(am_img($photos[0], 1200))) . "</g:image_link>\n";
    foreach (array_slice($photos, 1, 9) as $ph) {
        $items .= '      <g:additional_image_link>' . flux_x(flux_absolu(am_img($ph, 1200))) . "</g:additional_image_link>\n";
    }
    $items .= "      <g:availability>in_stock</g:availability>\n"
        . '      <g:price>' . number_format((float) $p['price'], 2, '.', '') . " EUR</g:price>\n"
        . '      <g:condition>' . (($p['condition'] ?? '') === 'Neuf' ? 'new' : 'used') . "</g:condition>\n"
        // Pièce de collection ancienne : ni code-barres ni référence fabricant.
        . "      <g:identifier_exists>no</g:identifier_exists>\n"
        . "      <g:google_product_category>Arts &amp; Entertainment &gt; Hobbies &amp; Creative Arts &gt; Collectibles</g:google_product_category>\n"
        . '      <g:product_type>' . flux_x(implode(' > ', array_filter(['Militaria', $libPeriode, $libSous]))) . "</g:product_type>\n";
    /* Frais d'envoi déclarés : tarif du mode plus Protection acheteurs
       (am_protection_cents). Stripe débite les deux en plus du prix, et
       Merchant Center compare le prix et la livraison annoncés au total
       payé : un total annoncé plus bas est une présentation trompeuse, que
       Google sanctionne par une suspension du compte. g:price reste le prix
       de l'article, comme sur la fiche ; la Protection n'a pas d'autre
       attribut où se déclarer, le nom du service le dit. */
    $protection = am_protection_cents(am_centimes($p['price']));
    foreach (['post' => 'Colissimo suivi', 'relay' => 'Point relais'] as $mode => $service) {
        if (!empty($p['ship_' . $mode]) && isset($tarifs[$mode])) {
            $items .= "      <g:shipping>\n        <g:country>FR</g:country>\n"
                . '        <g:service>' . flux_x($service . ', Protection acheteurs comprise') . "</g:service>\n"
                . '        <g:price>' . number_format(((int) $tarifs[$mode]['amount_cents'] + $protection) / 100, 2, '.', '') . " EUR</g:price>\n"
                . "      </g:shipping>\n";
        }
    }
    $items .= "    </item>\n";
    $retenues++;
}

$xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
    . '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">' . "\n"
    . "  <channel>\n"
    . "    <title>Athena Militaria</title>\n"
    . '    <link>' . AM_SITE . "/militaria</link>\n"
    . "    <description>Militaria de collection à vendre entre collectionneurs</description>\n"
    . "    <!-- " . $retenues . ' annonce(s) sur ' . count($annonces) . " en vente -->\n"
    . $items
    . "  </channel>\n</rss>\n";

@file_put_contents($CACHE, $xml, LOCK_EX);
flux_servir($xml);
