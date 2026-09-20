<?php
/* =====================================================================
   Photos d'annonce servies depuis le domaine, en WebP.

   Les photos passaient par la fonction Supabase « img », qui renvoie du JPEG
   et que le CDN de Supabase ne met pas en cache : 0,4 s pour une vignette,
   1,7 s pour la version de 1200 px, à chaque visite. Sur la fiche, c'était
   l'essentiel du LCP.

   /media/<largeur>/<dossier>/<fichier>.webp est d'abord cherché sur le
   disque par Apache. S'il n'existe pas, .htaccess envoie ici : on demande la
   photo à la fonction une seule fois, on la convertit en WebP, et on l'écrit
   exactement à l'adresse demandée. Toutes les visites suivantes lisent le
   fichier, sans PHP ni appel réseau, avec un cache navigateur d'un an.

   Seuls les noms produits par le formulaire de vente sont acceptés
   (dossier = identifiant du vendeur, fichier = horodatage et suffixe) :
   aucune autre écriture n'est possible dans media/.
   ===================================================================== */

define('ATHENA', 1);
require __DIR__ . '/inc/athena.php';

function refuser(int $code): void
{
    http_response_code($code);
    header('Cache-Control: no-store');
    if ($code === 503) {
        header('Retry-After: 300');
    }
    header('Content-Type: text/plain; charset=UTF-8');
    echo $code === 404 ? "Photo introuvable.\n" : "Photo momentanément indisponible.\n";
    exit;
}

$largeur = (int) ($_GET['w'] ?? 0);
$demande = (string) ($_GET['p'] ?? '');
if (!in_array($largeur, AM_LARGEURS, true)
    || !preg_match('~^([0-9a-f-]{36})/([A-Za-z0-9._-]{1,120})\.webp$~', $demande, $m)
    || strpos($m[2], '..') !== false) {
    refuser(404);
}
[, $dossier, $fichier] = $m;

$ch = curl_init(AM_IMG_FN . '?path=' . rawurlencode($dossier) . '/' . rawurlencode($fichier) . '&w=' . $largeur);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 25,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_USERAGENT      => 'AthenaMilitaria-media/1.0',
]);
$octets = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($code === 404 || $code === 400) {
    refuser(404);
}
if ($code !== 200 || !is_string($octets) || $octets === '' || strpos($type, 'image/') !== 0) {
    // Panne passagère : un 503 invite à repasser, un 404 ferait oublier la photo.
    refuser(503);
}

$image = @imagecreatefromstring($octets);
if ($image === false) {
    // Format que GD ne sait pas lire : on sert l'original, sans le garder.
    header('Content-Type: ' . $type);
    header('Cache-Control: public, max-age=3600');
    echo $octets;
    exit;
}
if (!imageistruecolor($image)) {
    imagepalettetotruecolor($image);
}
imagealphablending($image, true);
imagesavealpha($image, true);

$cible = __DIR__ . '/media/' . $largeur . '/' . $dossier . '/' . $fichier . '.webp';
$tmp = $cible . '.' . getmypid() . '.tmp';
$ecrit = false;
if (is_dir(dirname($cible)) || @mkdir(dirname($cible), 0755, true)) {
    /* Qualité 78 : à l'oeil, identique au JPEG d'origine (lui-même déjà
       recompressé par la fonction), pour un poids nettement moindre. */
    $ecrit = @imagewebp($image, $tmp, 78) && @rename($tmp, $cible);
    if (!$ecrit) {
        @unlink($tmp);
    }
}

if ($ecrit) {
    $sortie = (string) file_get_contents($cible);
} else {
    ob_start();
    imagewebp($image, null, 78);
    $sortie = (string) ob_get_clean();
}
imagedestroy($image);

header('Content-Type: image/webp');
header('Cache-Control: public, max-age=31536000, immutable');
header('Content-Length: ' . strlen($sortie));
echo $sortie;
