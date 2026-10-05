<?php
/* =====================================================================
   Mesure d'audience sans cookie (5 octobre 2026).

   Pourquoi : Google Analytics demandait un bandeau de consentement, que
   beaucoup de visiteurs refusent ; ses chiffres n'auraient décrit qu'une
   partie du public, et tout le monde avait une fenêtre de plus à fermer.
   L'exploitant voulait « uniquement qu'un message, un truc propre ». Ici,
   rien n'est déposé ni lu sur l'appareil du visiteur, aucun identifiant
   n'est calculé, l'adresse IP n'est pas conservée : on additionne des pages
   vues par jour. Sans traceur, la règle du consentement (article 82 de la
   loi Informatique et libertés) ne s'applique pas, et il n'y a donc pas de
   bandeau.

   Ce que reçoit ce script (script.js, à chaque page publique) : le chemin
   de la page, sa langue, et le nom du site d'où l'on vient (sans le reste
   de l'adresse). Ce qu'il garde, par jour, dans cache/audience/ : le nombre
   de vues par page, le nombre d'arrivées sur le site (visites), le nombre
   d'arrivées par provenance (Google, accès direct…) et par type d'appareil.
   Rien d'autre, et rien qui permette de suivre une personne.

   Les robots déclarés sont écartés ; les fichiers de plus de 25 mois sont
   effacés (durée recommandée par la CNIL pour des statistiques d'audience).
   ===================================================================== */

declare(strict_types=1);

define('ATHENA', true);
require __DIR__ . '/inc/athena.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function am_mesure_fin(int $code): void
{
    http_response_code($code);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    am_mesure_fin(405);
}

/* Le compteur ne répond qu'aux pages du site : un appel venu d'ailleurs ne
   gonfle rien. (Un script peut forger cet en-tête ; l'enjeu est d'écarter
   le bruit, pas de garder un secret.) */
$origine = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origine !== '' && !preg_match('~^https://(www\.)?athenamilitaria\.fr$~', $origine)) {
    am_mesure_fin(403);
}

$agent = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
if ($agent === '' || preg_match('~bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|python|curl|wget|java/|go-http|okhttp|node-fetch|axios|playwright|puppeteer|phantom~i', $agent)) {
    am_mesure_fin(204);
}

$entree = json_decode((string) file_get_contents('php://input', false, null, 0, 2048), true);
if (!is_array($entree)) {
    am_mesure_fin(400);
}

$chemin = (string) ($entree['p'] ?? '');
if ($chemin === '' || strlen($chemin) > 160 || !preg_match('~^/[A-Za-z0-9/_.%-]*$~', $chemin)) {
    am_mesure_fin(400);
}
if ($chemin !== '/') {
    $chemin = rtrim($chemin, '/');
}
$langue = in_array($entree['l'] ?? '', ['en', 'de'], true) ? $entree['l'] : 'fr';
$cle = $langue === 'fr' ? $chemin : $chemin . ' [' . $langue . ']';

/* Provenance : le seul nom du site, regroupé quand il a un nom connu. */
$hote = strtolower((string) ($entree['r'] ?? ''));
if ($hote !== '' && !preg_match('~^[a-z0-9.-]{1,100}$~', $hote)) {
    $hote = '';
}
$interne = (bool) preg_match('~(^|\.)athenamilitaria\.fr$~', $hote);
$source = '';
if (!$interne) {
    $connues = [
        '~(^|\.)google\.~' => 'Google',
        '~(^|\.)bing\.com$~' => 'Bing',
        '~(^|\.)duckduckgo\.com$~' => 'DuckDuckGo',
        '~(^|\.)qwant\.com$~' => 'Qwant',
        '~(^|\.)ecosia\.org$~' => 'Ecosia',
        '~(^|\.)yahoo\.~' => 'Yahoo',
        '~(^|\.)(chatgpt\.com|openai\.com)$~' => 'ChatGPT',
        '~(^|\.)perplexity\.ai$~' => 'Perplexity',
        '~(^|\.)(facebook\.com|fb\.com)$~' => 'Facebook',
        '~(^|\.)instagram\.com$~' => 'Instagram',
        '~(^|\.)linkedin\.com$~' => 'LinkedIn',
        '~(^|\.)(t\.co|x\.com|twitter\.com)$~' => 'X',
        '~(^|\.)pinterest\.~' => 'Pinterest',
    ];
    $source = 'Accès direct';
    if ($hote !== '') {
        $source = $hote;
        foreach ($connues as $motif => $nom) {
            if (preg_match($motif, $hote)) {
                $source = $nom;
                break;
            }
        }
    }
}

$appareil = preg_match('~iPad|Tablet|Nexus (7|9|10)|SM-T~i', $agent) ? 'tablette'
    : (preg_match('~Mobi|Android|iPhone|iPod~i', $agent) ? 'téléphone' : 'ordinateur');

if (!am_dossier_cache()) {
    am_mesure_fin(204);
}
$dossier = AM_CACHE . '/audience';
if (!is_dir($dossier) && !@mkdir($dossier, 0755, true)) {
    am_mesure_fin(204);
}

$jour = (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y-m-d');
$fichier = $dossier . '/' . $jour . '.json';
$nouveau = !is_file($fichier);

$h = @fopen($fichier, 'c+');
if ($h === false) {
    am_mesure_fin(204);
}
flock($h, LOCK_EX);
$donnees = json_decode((string) stream_get_contents($h), true);
if (!is_array($donnees)) {
    $donnees = ['vues' => 0, 'visites' => 0, 'pages' => [], 'sources' => [], 'appareils' => []];
}

/* Plafonds : un jour normal en est très loin ; ils bornent la taille du
   fichier si quelqu'un s'amusait à envoyer des chemins inventés. */
$donnees['vues']++;
if (isset($donnees['pages'][$cle]) || count($donnees['pages']) < 3000) {
    $donnees['pages'][$cle] = ($donnees['pages'][$cle] ?? 0) + 1;
}
if (!$interne) {
    $donnees['visites']++;
    $s = (isset($donnees['sources'][$source]) || count($donnees['sources']) < 300) ? $source : 'Autres';
    $donnees['sources'][$s] = ($donnees['sources'][$s] ?? 0) + 1;
    $donnees['appareils'][$appareil] = ($donnees['appareils'][$appareil] ?? 0) + 1;
}

ftruncate($h, 0);
rewind($h);
fwrite($h, (string) json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
fflush($h);
flock($h, LOCK_UN);
fclose($h);
// Signal de contrôle : la vue a bien été comptée (aucune donnée renvoyée).
header('X-Mesure: comptee');

/* Premier passage du jour : on efface ce qui dépasse 25 mois. */
if ($nouveau) {
    $limite = (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->modify('-25 months')->format('Y-m-d');
    foreach (glob($dossier . '/*.json') ?: [] as $f) {
        if (basename($f, '.json') < $limite) {
            @unlink($f);
        }
    }
}

am_mesure_fin(204);
