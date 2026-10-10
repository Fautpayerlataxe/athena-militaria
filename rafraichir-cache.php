<?php
/* =====================================================================
   Vide le cache des réponses Supabase du rendu serveur (cache/api-*.json).

   Pourquoi : am_api() sert une réponse en cache, même périmée, puis la
   rafraîchit après l'envoi de la page (voir inc/athena.php). C'est ce qui
   rend les fiches et le catalogue rapides, mais une décision de modération
   (flouter ou déflouter une annonce, la retirer) n'apparaissait qu'au
   deuxième passage sur chaque page. Le 4 octobre 2026, l'exploitant a
   défloué le casque tankiste, rouvert la fiche, et l'a vue encore floutée.

   L'espace modération appelle ce script juste après chaque changement :
   les pages suivantes relisent la base.

   Réservé aux administrateurs : le jeton de session envoyé dans le corps
   de la requête est vérifié auprès de Supabase (auth/v1/user), et l'adresse
   qu'il porte doit figurer dans la même liste que les politiques RLS
   d'administration (ADD_ADMIN.sql). On ne fait confiance à rien d'autre
   venant du navigateur. Effacer le cache n'expose aucune donnée : au pire,
   les pages suivantes interrogent la base au lieu de leur copie.

   Depuis le 10 oct. 2026, deux demandes ciblées, ouvertes aussi au vendeur :

   - « annonce » : n'efface que les réponses en cache qui contiennent cette
     annonce (et le plan du site, le flux Shopping). Un vendeur qui changeait
     son prix voyait l'ancien sur sa fiche, et un acheteur lisait « Acheter
     400 € » quand Stripe débiterait 500 € : seules trois actions de la
     modération purgeaient le cache. Le vendeur doit être le propriétaire de
     la ligne, lue avec son propre jeton ; une ligne déjà supprimée ne
     protège plus rien.

   - « photos » : efface les copies WebP de media/ (400, 800 et 1 200 px).
     media.php les écrit sur disque, puis Apache les sert seul, un an, sans
     repasser par PHP : une photo supprimée par son vendeur ou retirée par
     la modération (insigne réglementé) restait publique sous /media/. Le
     dossier d'une photo est l'identifiant de son vendeur : seul lui, ou un
     administrateur, peut l'effacer. Même contrôle du chemin que media.php,
     aucune traversée possible. Le cache des navigateurs qui l'ont déjà vue
     reste hors de portée.
   ===================================================================== */

declare(strict_types=1);

// La bibliothèque ne se charge que pour un point d'entrée déclaré.
define('ATHENA', true);
require __DIR__ . '/inc/athena.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

const AM_ADMINS = ['sayrox.ar@gmail.com', 'renduambroise@gmail.com'];

function am_repondre(int $code, array $corps): void
{
    http_response_code($code);
    echo json_encode($corps, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    am_repondre(405, ['ok' => false, 'erreur' => 'methode']);
}

$entree = json_decode((string) file_get_contents('php://input'), true);
$jeton = is_array($entree) ? (string) ($entree['jeton'] ?? '') : '';
$annonce = is_array($entree) && isset($entree['annonce']) ? (string) $entree['annonce'] : '';
$photos = is_array($entree) && isset($entree['photos']) && is_array($entree['photos'])
    ? array_slice(array_values($entree['photos']), 0, 50) : [];
if ($annonce !== '' && !preg_match('~^[0-9]{1,12}$~', $annonce)) {
    am_repondre(400, ['ok' => false, 'erreur' => 'annonce']);
}
if (!preg_match('~^[A-Za-z0-9._-]{20,4096}$~', $jeton)) {
    am_repondre(401, ['ok' => false, 'erreur' => 'jeton']);
}

$cle = am_cle_publique();
if ($cle === '' || !function_exists('curl_init')) {
    am_repondre(500, ['ok' => false, 'erreur' => 'configuration']);
}

$ch = curl_init(AM_SUPABASE . '/auth/v1/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 6,
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_USERAGENT      => 'AthenaMilitaria-cache/1.0',
    CURLOPT_HTTPHEADER     => ['apikey: ' . $cle, 'Authorization: Bearer ' . $jeton, 'Accept: application/json'],
]);
$rep = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$utilisateur = ($code === 200 && is_string($rep)) ? json_decode($rep, true) : null;
$courriel = is_array($utilisateur) ? strtolower((string) ($utilisateur['email'] ?? '')) : '';
$uid = is_array($utilisateur) ? strtolower((string) ($utilisateur['id'] ?? '')) : '';
if ($courriel === '' || $uid === '') {
    am_repondre(401, ['ok' => false, 'erreur' => 'session']);
}
$admin = in_array($courriel, AM_ADMINS, true);

/* Purge complète : administrateurs seulement, comme avant. */
if ($annonce === '' && !$photos) {
    if (!$admin) {
        am_repondre(403, ['ok' => false, 'erreur' => 'droits']);
    }
    $effaces = 0;
    foreach (glob(AM_CACHE . '/api-*.json') ?: [] as $fichier) {
        if (@unlink($fichier)) {
            $effaces++;
        }
    }
    am_repondre(200, ['ok' => true, 'effaces' => $effaces]);
}

$effaces = 0;
if ($annonce !== '') {
    if (!$admin) {
        /* La ligne lue avec le jeton du demandeur : les politiques RLS lui
           montrent ses propres annonces, brouillons compris. */
        $ch = curl_init(AM_SUPABASE . '/rest/v1/products?select=user_id&id=eq.' . $annonce . '&limit=1');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 6,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_USERAGENT      => 'AthenaMilitaria-cache/1.0',
            CURLOPT_HTTPHEADER     => ['apikey: ' . $cle, 'Authorization: Bearer ' . $jeton, 'Accept: application/json'],
        ]);
        $repLigne = curl_exec($ch);
        $codeLigne = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $ligne = ($codeLigne === 200 && is_string($repLigne)) ? json_decode($repLigne, true) : null;
        if (!is_array($ligne)) {
            am_repondre(503, ['ok' => false, 'erreur' => 'base']);
        }
        if ($ligne && strtolower((string) ($ligne[0]['user_id'] ?? '')) !== $uid) {
            am_repondre(403, ['ok' => false, 'erreur' => 'droits']);
        }
    }
    /* Réponses PostgREST compactes : « "id":31, » ou « "id":31} ». Le
       guillemet avant id écarte product_id et user_id. */
    $motif = '~"id":' . $annonce . '[,}]~';
    foreach (glob(AM_CACHE . '/api-*.json') ?: [] as $fichier) {
        $contenu = @file_get_contents($fichier);
        if (is_string($contenu) && preg_match($motif, $contenu) === 1 && @unlink($fichier)) {
            $effaces++;
        }
    }
    // Plan du site et flux Shopping : reconstruits à la demande suivante.
    foreach ([AM_RACINE . '/sitemap-annonces-cache.xml', AM_RACINE . '/flux-produits-cache.xml'] as $fichier) {
        if (is_file($fichier) && @unlink($fichier)) {
            $effaces++;
        }
    }
}

$photosEffacees = 0;
$refusees = 0;
foreach ($photos as $photo) {
    $chemin = is_string($photo) ? (am_chemin_photo($photo) ?? $photo) : '';
    if (!preg_match('~^([0-9a-f-]{36})/([A-Za-z0-9._-]{1,120})$~', $chemin, $m) || strpos($m[2], '..') !== false) {
        continue;
    }
    if (!$admin && strtolower($m[1]) !== $uid) {
        $refusees++;
        continue;
    }
    foreach (AM_LARGEURS as $largeur) {
        $fichier = AM_RACINE . '/media/' . $largeur . '/' . $m[1] . '/' . $m[2] . '.webp';
        if (is_file($fichier) && @unlink($fichier)) {
            $photosEffacees++;
        }
    }
}

am_repondre(200, ['ok' => true, 'effaces' => $effaces, 'photos' => $photosEffacees, 'refusees' => $refusees]);
