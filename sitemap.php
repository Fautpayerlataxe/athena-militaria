<?php
/* =====================================================================
   Relais du sitemap des annonces.

   /sitemap-annonces.xml est réécrit vers ce fichier (voir .htaccess). Le
   contenu, lui, vient de la fonction Supabase « sitemap », qui lit les
   annonces en base et renvoie donc toujours un plan à jour.

   Pourquoi un relais plutôt qu'une redirection vers supabase.co :
     - l'adresse annoncée aux moteurs reste sur www.athenamilitaria.fr, sur
       le même domaine que les URLs listées. Un sitemap hébergé ailleurs
       relève du cas particulier « cross-domain », qu'il n'y a aucune raison
       d'aller chercher ici ;
     - le résultat est mis en cache six heures sur l'hébergement : les robots
       n'appellent pas Supabase à chaque passage ;
     - si Supabase est injoignable, on continue de servir la dernière version
       connue, puis la copie de secours déposée au déploiement. Un sitemap
       d'hier vaut infiniment mieux qu'une erreur : Google qui échoue à lire
       un sitemap peut cesser de le consulter.
   ===================================================================== */

$FONCTION = 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/sitemap';
$CACHE    = __DIR__ . '/sitemap-annonces-cache.xml';
$SECOURS  = __DIR__ . '/sitemap-annonces-secours.xml';
$DUREE    = 6 * 3600;   // 6 heures

/* Clé anonyme du projet Supabase. Elle n'a rien de secret : c'est celle que
   toutes les pages du site exposent déjà dans supabaseClient.js, et elle ne
   donne accès qu'à ce qu'un visiteur non connecté peut lire.
   L'envoyer ici évite d'avoir à désactiver la vérification du JWT sur la
   fonction : le réglage reste sur sa valeur par défaut côté Supabase, et
   l'endpoint n'est pas ouvert à tout venant. */
$ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdGF4Z2ZxZG94dGNpZGxseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzQ0NzgsImV4cCI6MjA5MTQ1MDQ3OH0.AEFktTgMmccF0UiKcCiJBTej0Px5q6_jqi7l7hgePVA';

/* Un sitemap tronqué (coupure réseau en cours de lecture) serait pire qu'une
   version un peu datée : Google le lit, n'y trouve plus la moitié des pages,
   et les considère abandonnées. On ne garde donc que ce qui est complet. */
function xml_complet($x) {
    /* Validation structurelle et non par la taille. Un seuil en octets
       paraissait commode, mais un catalogue vide (toutes les annonces
       vendues) produit un urlset parfaitement valide de 162 octets : il
       aurait été pris pour un fichier tronqué, et le site aurait servi
       indéfiniment la copie de secours, laquelle déclare des fiches qui ne
       sont plus publiées. On vérifie donc ce qui compte vraiment : le
       document s'ouvre, et surtout il se TERMINE par sa balise fermante,
       ce qu'une coupure réseau en cours de lecture ne peut pas produire. */
    return is_string($x)
        && strpos($x, '<urlset') !== false
        && preg_match('~</urlset>\s*$~', $x) === 1;
}

function servir($xml, $origine, $date = null) {
    header('Content-Type: application/xml; charset=UTF-8');
    header('Cache-Control: public, max-age=3600');
    header('X-Sitemap-Origine: ' . $origine);
    /* sitemap.xml n'annonce volontairement aucune date pour ce fichier, qui
       change entre deux déploiements. Last-Modified est donc le seul signal
       de fraîcheur dont dispose Google, et celui qui lui permet de repartir
       sur un 304 quand rien n'a bougé. */
    if ($date) {
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $date) . ' GMT');
        /* Annoncer une date sans honorer If-Modified-Since revenait à
           renvoyer le fichier entier à chaque passage de robot alors qu'il
           venait demander « a-t-il changé ? ». On répond 304 quand la
           réponse est non. */
        $depuis = isset($_SERVER['HTTP_IF_MODIFIED_SINCE'])
            ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) : false;
        if ($depuis !== false && $depuis >= $date) {
            header('HTTP/1.1 304 Not Modified');
            exit;
        }
    }
    echo $xml;
    exit;
}

/* Régénération forcée, réservée à la tâche planifiée (pg_cron, chaque nuit à
   3h20 UTC). Sans elle, le cron ne servirait à rien : il tomberait sur un
   cache encore valide et repartirait sans rien rafraîchir.
   Le jeton n'est pas un secret sensible, il évite simplement qu'un passant
   puisse relancer la génération en boucle. */
$FORCER = isset($_GET['refresh']) && is_string($_GET['refresh'])
    && hash_equals('af9e943f873ff6307dde5ee8e854327d', $_GET['refresh']);

// 1. Cache encore valide : rien d'autre à faire.
if (!$FORCER && is_readable($CACHE) && (time() - filemtime($CACHE)) < $DUREE) {
    $xml = file_get_contents($CACHE);
    if (xml_complet($xml)) servir($xml, 'cache', filemtime($CACHE));
}

// 2. Régénération depuis Supabase.
$xml = false;
if (function_exists('curl_init')) {
    $ch = curl_init($FONCTION);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT      => 'AthenaMilitaria-sitemap/1.0',
        CURLOPT_HTTPHEADER     => array(
            'Authorization: Bearer ' . $ANON,
            'apikey: ' . $ANON,
        ),
    ));
    $rep  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code === 200 && xml_complet($rep)) $xml = $rep;
}

if ($xml !== false) {
    /* Écriture atomique : un robot qui lirait le fichier pendant l'écriture
       récupérerait sinon un XML à moitié écrit. */
    $tmp = $CACHE . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $xml) !== false) {
        @rename($tmp, $CACHE);
    } else {
        @unlink($tmp);   // dossier non inscriptible : on sert sans mettre en cache
    }
    /* filemtime a déjà été consulté plus haut sur ce même chemin : sans
       purge, PHP renverrait la date mémorisée avant l'écriture, et
       Last-Modified annoncerait une fraîcheur périmée sur la seule réponse
       réellement fraîche. */
    clearstatcache(true, $CACHE);
    servir($xml, 'supabase', @filemtime($CACHE) ?: time());
}

// 3. Supabase indisponible : dernière version connue, même périmée.
if (is_readable($CACHE)) {
    $xml = file_get_contents($CACHE);
    if (xml_complet($xml)) servir($xml, 'cache-perime', filemtime($CACHE));
}

// 4. Filet de sécurité : copie déposée au dernier déploiement.
if (is_readable($SECOURS)) {
    $xml = file_get_contents($SECOURS);
    if (xml_complet($xml)) servir($xml, 'secours', filemtime($SECOURS));
}

/* Plus rien de servable. Un 503 dit au robot de repasser ; un 404 lui dirait
   que le sitemap n'existe pas, ce qui est faux et bien plus coûteux. */
header('HTTP/1.1 503 Service Unavailable');
header('Retry-After: 3600');
header('Content-Type: text/plain; charset=UTF-8');
echo "Sitemap des annonces temporairement indisponible.\n";
