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
if ($courriel === '') {
    am_repondre(401, ['ok' => false, 'erreur' => 'session']);
}
if (!in_array($courriel, AM_ADMINS, true)) {
    am_repondre(403, ['ok' => false, 'erreur' => 'droits']);
}

$effaces = 0;
foreach (glob(AM_CACHE . '/api-*.json') ?: [] as $fichier) {
    if (@unlink($fichier)) {
        $effaces++;
    }
}

am_repondre(200, ['ok' => true, 'effaces' => $effaces]);
