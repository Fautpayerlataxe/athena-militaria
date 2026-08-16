<?php
/* =====================================================================
   Fiche article : canonique servie, pas promise.

   product.html est un gabarit statique : sa balise canonique déclarait
   « /product » tout court, et c'était du JavaScript (product.js, i18n.js)
   qui la corrigeait après coup en « /product?id=N ». Google juge d'abord le
   HTML brut : la Search Console pouvait donc replier chaque annonce sur
   /product et ne jamais l'indexer. Pour la page qui fait vendre, c'est
   inacceptable.

   Ce relais lit product.html et réécrit canonique, og:url et hreflang avec
   l'identifiant réellement demandé, avant tout JavaScript. Le reste du
   fichier part tel quel : le contenu, lui, reste rempli par product.js.

   Sans identifiant valide, le gabarit part inchangé : product.js marque
   alors la page noindex, comportement déjà en place et testé.
   ===================================================================== */

$html = file_get_contents(__DIR__ . '/product.html');

$id = isset($_GET['id']) ? (string) $_GET['id'] : '';
$en = isset($_GET['lang']) && $_GET['lang'] === 'en';

if (preg_match('/^[0-9]{1,12}$/', $id) === 1) {
    /* Dans un attribut HTML, « & » s'écrit « &amp; » : c'est la forme que
       les navigateurs comme les robots décodent en URL réelle. */
    $fr    = 'https://www.athenamilitaria.fr/product?id=' . $id;
    $enUrl = $fr . '&amp;lang=en';
    $self  = $en ? $enUrl : $fr;

    $html = preg_replace('~(<link rel="canonical" href=")[^"]*(")~', '${1}' . $self . '${2}', $html, 1);
    $html = preg_replace('~(<link rel="alternate" hreflang="fr" href=")[^"]*(")~', '${1}' . $fr . '${2}', $html, 1);
    $html = preg_replace('~(<link rel="alternate" hreflang="en" href=")[^"]*(")~', '${1}' . $enUrl . '${2}', $html, 1);
    $html = preg_replace('~(<link rel="alternate" hreflang="x-default" href=")[^"]*(")~', '${1}' . $fr . '${2}', $html, 1);
    $html = preg_replace('~(<meta property="og:url" content=")[^"]*(")~', '${1}' . $self . '${2}', $html, 1);
}

header('Content-Type: text/html; charset=UTF-8');
/* Même règle de cache que les .html : toujours revalidé. Le FilesMatch de
   .htaccess ne couvre que les extensions statiques, on la pose donc ici. */
header('Cache-Control: public, max-age=0, must-revalidate');
echo $html;
