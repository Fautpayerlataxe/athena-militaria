<?php
/* =====================================================================
   Tableau de bord de l'audience (Mon compte > Modération > Audience).

   Lit les totaux journaliers écrits par mesure.php et les rend, agrégés,
   aux seuls administrateurs. Même contrôle que rafraichir-cache.php : le
   jeton de session envoyé dans le corps est vérifié auprès de Supabase
   (auth/v1/user), et l'adresse qu'il porte doit figurer dans la liste des
   administrateurs (celle des politiques RLS, ADD_ADMIN.sql).
   ===================================================================== */

declare(strict_types=1);

define('ATHENA', true);
require __DIR__ . '/inc/athena.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

const AM_ADMINS_AUDIENCE = ['sayrox.ar@gmail.com', 'renduambroise@gmail.com'];

function am_audience_repondre(int $code, array $corps): void
{
    http_response_code($code);
    echo json_encode($corps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    am_audience_repondre(405, ['ok' => false, 'erreur' => 'methode']);
}

$entree = json_decode((string) file_get_contents('php://input'), true);
$jeton = is_array($entree) ? (string) ($entree['jeton'] ?? '') : '';
if (!preg_match('~^[A-Za-z0-9._-]{20,4096}$~', $jeton)) {
    am_audience_repondre(401, ['ok' => false, 'erreur' => 'jeton']);
}

$cle = am_cle_publique();
if ($cle === '' || !function_exists('curl_init')) {
    am_audience_repondre(500, ['ok' => false, 'erreur' => 'configuration']);
}
$ch = curl_init(AM_SUPABASE . '/auth/v1/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 6,
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_USERAGENT      => 'AthenaMilitaria-audience/1.0',
    CURLOPT_HTTPHEADER     => ['apikey: ' . $cle, 'Authorization: Bearer ' . $jeton, 'Accept: application/json'],
]);
$rep = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$utilisateur = ($code === 200 && is_string($rep)) ? json_decode($rep, true) : null;
$courriel = is_array($utilisateur) ? strtolower((string) ($utilisateur['email'] ?? '')) : '';
if ($courriel === '') {
    am_audience_repondre(401, ['ok' => false, 'erreur' => 'session']);
}
if (!in_array($courriel, AM_ADMINS_AUDIENCE, true)) {
    am_audience_repondre(403, ['ok' => false, 'erreur' => 'droits']);
}

/* 60 jours : la courbe en montre 30, et les 30 d'avant servent à comparer. */
$paris = new DateTimeZone('Europe/Paris');
$aujourdhui = new DateTimeImmutable('today', $paris);
$jours = [];
$pages = [];
$sources = [];
$appareils = [];
for ($i = 59; $i >= 0; $i--) {
    $d = $aujourdhui->modify('-' . $i . ' days')->format('Y-m-d');
    $f = AM_CACHE . '/audience/' . $d . '.json';
    $j = is_file($f) ? json_decode((string) @file_get_contents($f), true) : null;
    $vues = is_array($j) ? (int) ($j['vues'] ?? 0) : 0;
    $visites = is_array($j) ? (int) ($j['visites'] ?? 0) : 0;
    $jours[] = ['date' => $d, 'vues' => $vues, 'visites' => $visites, 'mesure' => is_array($j)];
    if ($i < 30 && is_array($j)) {
        foreach (($j['pages'] ?? []) as $p => $n) {
            $pages[$p] = ($pages[$p] ?? 0) + (int) $n;
        }
        foreach (($j['sources'] ?? []) as $s => $n) {
            $sources[$s] = ($sources[$s] ?? 0) + (int) $n;
        }
        foreach (($j['appareils'] ?? []) as $a => $n) {
            $appareils[$a] = ($appareils[$a] ?? 0) + (int) $n;
        }
    }
}
arsort($pages);
arsort($sources);
arsort($appareils);

$somme = static function (array $tranche, string $champ): int {
    return array_sum(array_column($tranche, $champ));
};

am_audience_repondre(200, [
    'ok'        => true,
    'jours'     => array_slice($jours, 30),
    'totaux'    => [
        'vues7'        => $somme(array_slice($jours, 53), 'vues'),
        'visites7'     => $somme(array_slice($jours, 53), 'visites'),
        'vues7avant'   => $somme(array_slice($jours, 46, 7), 'vues'),
        'visites7avant'=> $somme(array_slice($jours, 46, 7), 'visites'),
        'vues30'       => $somme(array_slice($jours, 30), 'vues'),
        'visites30'    => $somme(array_slice($jours, 30), 'visites'),
    ],
    'pages'     => array_slice(array_map(null, array_keys($pages), array_values($pages)), 0, 15),
    'sources'   => array_slice(array_map(null, array_keys($sources), array_values($sources)), 0, 10),
    'appareils' => $appareils,
]);
