<?php
/* =====================================================================
   Rendu côté serveur : bibliothèque commune.

   Les fiches, les pages catalogue, la page d'accueil et les versions
   anglaises étaient des gabarits vides que le JavaScript remplissait après
   coup. Google finit par exécuter ce JavaScript, mais plus tard et moins
   souvent ; Bing, les aperçus de partage et la plupart des robots d'IA ne
   l'exécutent jamais. Ils voyaient donc « Chargement du produit… », un
   titre générique et l'image de couverture du site.

   Ce fichier fournit aux relais PHP (product.php, category.php, page.php,
   media.php, sitemap.php) ce dont ils ont besoin pour écrire le HTML final :
   lecture de la base avec cache, traductions reprises de i18n.js, balises de
   tête, cartes d'annonce. Il n'invente aucune règle : chaque fonction
   reproduit celle du navigateur qu'elle double, et le nomme.

   Inclus seulement : un appel direct répond 404 (et .htaccess refuse déjà
   tout le dossier inc/).
   ===================================================================== */

if (!defined('ATHENA')) {
    http_response_code(404);
    exit;
}

const AM_SITE     = 'https://www.athenamilitaria.fr';
const AM_SUPABASE = 'https://uctaxgfqdoxtcidllyjv.supabase.co';
const AM_IMG_FN   = AM_SUPABASE . '/functions/v1/img';
const AM_LARGEURS = [400, 800, 1200];   // liste blanche imposée par la fonction img

define('AM_RACINE', dirname(__DIR__));
define('AM_CACHE', AM_RACINE . '/cache');

/* ---------------------------------------------------------------------
   Outils de base
   --------------------------------------------------------------------- */

/* Même rôle que window.escapeHtml (script.js). */
function am_e($v): string
{
    return htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/* La langue ne vient que de l'URL : c'est elle que décrivent la canonique et
   les hreflang. Une préférence mémorisée côté visiteur n'a pas cours ici. */
function am_langue(): string
{
    return (isset($_GET['lang']) && $_GET['lang'] === 'en') ? 'en' : 'fr';
}

/* Coupe un texte sur un mot entier, comme coupe() dans product.js. */
function am_couper(string $txt, int $max): string
{
    $t = trim(preg_replace('~\s+~u', ' ', $txt));
    if (mb_strlen($t) <= $max) {
        return $t;
    }
    $bout = mb_substr($t, 0, $max);
    $esp = mb_strrpos($bout, ' ');
    return rtrim(mb_substr($bout, 0, $esp !== false ? $esp : $max), " ,;:·") . '…';
}

function am_absolu(string $url): string
{
    if (preg_match('~^https?://~', $url)) {
        return $url;
    }
    return AM_SITE . '/' . ltrim($url, '/');
}

function am_json_ld(array $graphe): string
{
    $json = json_encode(
        ['@context' => 'https://schema.org', '@graph' => array_values($graphe)],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_PRETTY_PRINT
    );
    return "<script type=\"application/ld+json\">\n" . $json . "\n  </script>";
}

/* Nombre sans décimale inutile : 250 et non 250.0, 12.5 et non 12.50. */
function am_nombre($v)
{
    $n = (float) $v;
    return floor($n) == $n ? (int) $n : round($n, 2);
}

/* ---------------------------------------------------------------------
   Traductions : la table de i18n.js, exportée par build-i18n-dict.cjs
   --------------------------------------------------------------------- */

function am_dict(string $lang): array
{
    static $tout = null;
    if ($tout === null) {
        $json = @file_get_contents(__DIR__ . '/i18n-dict.json');
        $tout = $json ? (json_decode($json, true) ?: []) : [];
    }
    return $tout[$lang] ?? [];
}

/* Même repli que t() dans i18n.js : langue demandée, puis français, puis la clé. */
function am_t(string $cle, string $lang): string
{
    $d = am_dict($lang);
    if (isset($d[$cle])) {
        return $d[$cle];
    }
    $fr = am_dict('fr');
    return $fr[$cle] ?? $cle;
}

/* Table complète d'une langue, complétée des tables propres à une page
   (window.__guidesI18n sur l'accueil et l'index des guides). */
function am_table(string $lang, array $supplement = []): array
{
    $table = array_merge(am_dict('fr'), $supplement['fr'] ?? []);
    if ($lang !== 'fr') {
        $table = array_merge($table, am_dict($lang), $supplement[$lang] ?? []);
    }
    return $table;
}

/* Lit la table que build-guides.cjs dépose dans certaines pages. */
function am_supplement_page(string $html): array
{
    if (preg_match('~window\.__guidesI18n\s*=\s*(\{.*?\});\s*</script>~s', $html, $m)) {
        $d = json_decode($m[1], true);
        if (is_array($d)) {
            return $d;
        }
    }
    return [];
}

/* Applique au HTML ce que applyTo() (i18n.js) applique au DOM :
   data-i18n (texte), data-i18n-html (HTML), et les attributs placeholder,
   aria-label, title, alt. Les scripts, styles et commentaires sont mis à
   l'abri avant, pour qu'aucun gabarit JavaScript ne soit réécrit. */
function am_traduire(string $html, string $lang, array $supplement = []): string
{
    $table = am_table($lang, $supplement);
    $t = static function (string $cle) use ($table): string {
        return $table[$cle] ?? $cle;
    };

    $abri = [];
    $html = preg_replace_callback('~<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->~is', static function ($m) use (&$abri) {
        $abri[] = $m[0];
        return "\x00" . (count($abri) - 1) . "\x00";
    }, $html);

    // Attributs
    $html = preg_replace_callback(
        '~<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*\bdata-i18n-(?:placeholder|aria-label|title|alt)="[^"]*"[^>]*>~',
        static function ($m) use ($t) {
            $balise = $m[0];
            foreach (['placeholder', 'aria-label', 'title', 'alt'] as $attr) {
                if (!preg_match('~\sdata-i18n-' . $attr . '="([^"]*)"~', $balise, $k) || $k[1] === '') {
                    continue;
                }
                $valeur = $attr . '="' . am_e($t(html_entity_decode($k[1], ENT_QUOTES, 'UTF-8'))) . '"';
                // (\s) exclut data-i18n-<attr> : on ne vise que l'attribut réel.
                $motif = '~(\s)' . preg_quote($attr, '~') . '="[^"]*"~';
                if (preg_match($motif, $balise)) {
                    $balise = preg_replace_callback($motif, static function ($x) use ($valeur) {
                        return $x[1] . $valeur;
                    }, $balise, 1);
                } else {
                    $balise = preg_replace_callback('~^<[a-zA-Z][a-zA-Z0-9-]*~', static function ($x) use ($valeur) {
                        return $x[0] . ' ' . $valeur;
                    }, $balise, 1);
                }
            }
            return $balise;
        },
        $html
    );

    // Contenus
    $html = am_remplacer_contenus($html, $t);

    // <html lang>
    $html = preg_replace('~<html\s+lang="[^"]*"~i', '<html lang="' . $lang . '"', $html, 1);

    return preg_replace_callback("~\x00(\d+)\x00~", static function ($m) use ($abri) {
        return $abri[(int) $m[1]];
    }, $html);
}

/* Position de la balise fermante qui correspond à une balise ouverte, en
   tenant compte des éléments de même nom imbriqués. */
function am_fin_element(string $html, string $nom, int $depuis): ?int
{
    $profondeur = 1;
    $motif = '~<(/?)' . preg_quote($nom, '~') . '(?=[\s>/])~i';
    $pos = $depuis;
    while (preg_match($motif, $html, $m, PREG_OFFSET_CAPTURE, $pos)) {
        $pos = $m[0][1] + 1;
        if ($m[1][0] === '/') {
            if (--$profondeur === 0) {
                return $m[0][1];
            }
        } else {
            $profondeur++;
        }
    }
    return null;
}

function am_remplacer_contenus(string $html, callable $t): string
{
    static $vides = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'];
    $motif = '~<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?\sdata-i18n(-html)?="([^"]*)"[^>]*>~';
    $sortie = '';
    $pos = 0;
    while (preg_match($motif, $html, $m, PREG_OFFSET_CAPTURE, $pos)) {
        $finOuverture = $m[0][1] + strlen($m[0][0]);
        $nom = strtolower($m[1][0]);
        $cle = html_entity_decode($m[3][0], ENT_QUOTES, 'UTF-8');
        $fin = (in_array($nom, $vides, true) || $cle === '') ? null : am_fin_element($html, $nom, $finOuverture);
        $sortie .= substr($html, $pos, $finOuverture - $pos);
        if ($fin === null) {
            $pos = $finOuverture;
            continue;
        }
        $valeur = $t($cle);
        // Comme dans le navigateur : textContent pour data-i18n, innerHTML pour data-i18n-html.
        $sortie .= ($m[2][0] === '-html') ? $valeur : am_e($valeur);
        $pos = $fin;
    }
    return $sortie . substr($html, $pos);
}

/* Remplace le contenu d'un élément repéré par un fragment de sa balise
   ouvrante (par exemple 'id="category-grid"'). */
function am_remplacer_interieur(string $html, string $reperage, string $contenu, ?string $nouvelleOuverture = null): string
{
    $i = strpos($html, $reperage);
    if ($i === false) {
        return $html;
    }
    $debut = strrpos(substr($html, 0, $i), '<');
    if ($debut === false || !preg_match('~<([a-zA-Z][a-zA-Z0-9-]*)~', $html, $n, 0, $debut)) {
        return $html;
    }
    $finOuverture = strpos($html, '>', $i);
    if ($finOuverture === false) {
        return $html;
    }
    $finOuverture++;
    $fin = am_fin_element($html, strtolower($n[1]), $finOuverture);
    if ($fin === null) {
        return $html;
    }
    $ouverture = $nouvelleOuverture ?? substr($html, $debut, $finOuverture - $debut);
    return substr($html, 0, $debut) . $ouverture . $contenu . substr($html, $fin);
}

/* Insère un fragment juste après la fin de l'élément repéré. */
function am_inserer_apres(string $html, string $reperage, string $fragment): string
{
    $i = strpos($html, $reperage);
    if ($i === false) {
        return $html;
    }
    $debut = strrpos(substr($html, 0, $i), '<');
    if ($debut === false || !preg_match('~<([a-zA-Z][a-zA-Z0-9-]*)~', $html, $n, 0, $debut)) {
        return $html;
    }
    $nom = strtolower($n[1]);
    $fin = am_fin_element($html, $nom, strpos($html, '>', $i) + 1);
    if ($fin === null) {
        return $html;
    }
    $apres = $fin + strlen('</' . $nom . '>');
    return substr($html, 0, $apres) . $fragment . substr($html, $apres);
}

/* ---------------------------------------------------------------------
   Balises de tête
   --------------------------------------------------------------------- */

function am_avant_fin_head(string $html, string $fragment): string
{
    $i = stripos($html, '</head>');
    return $i === false ? $html : substr($html, 0, $i) . '  ' . $fragment . "\n" . substr($html, $i);
}

function am_meta(string $html, string $attr, string $nom, ?string $valeur): string
{
    $motif = '~[ \t]*<meta\s+' . $attr . '="' . preg_quote($nom, '~') . '"\s+content="[^"]*"\s*/?>\n?~';
    if ($valeur === null) {
        return preg_replace($motif, '', $html);
    }
    $balise = '<meta ' . $attr . '="' . $nom . '" content="' . am_e($valeur) . '">';
    if (preg_match($motif, $html)) {
        return preg_replace_callback($motif, static function ($m) use ($balise) {
            preg_match('~^[ \t]*~', $m[0], $retrait);
            return $retrait[0] . $balise . (substr($m[0], -1) === "\n" ? "\n" : '');
        }, $html, 1);
    }
    return am_avant_fin_head($html, $balise);
}

/* Réécrit la tête du document. Chaque clé absente laisse la balise telle
   quelle ; une valeur null la retire.
   Clés : lang, title, description, robots, canonical, alternates (tableau
   langue => URL, ou null pour retirer), og (tableau propriété => valeur),
   twitter (tableau nom => valeur), jsonld (tableau de nœuds, remplace les
   blocs existants). */
function am_entete(string $html, array $h): string
{
    if (isset($h['lang'])) {
        $html = preg_replace('~<html\s+lang="[^"]*"~i', '<html lang="' . $h['lang'] . '" data-ssr="1"', $html, 1);
        /* Une page ne charge que le dictionnaire de sa langue : le gabarit
           porte celui du français, la version anglaise reçoit le sien. */
        if ($h['lang'] === 'en') {
            $html = str_replace('/i18n-fr.js', '/i18n-en.js', $html);
            /* Les liens aussi. am_entete reçoit la page entière, contenu
               compris : c'est le seul endroit où l'en-tête, le pied et le
               corps passent ensemble. Les adresses canoniques et les
               hreflang sont réécrits plus bas, après cette passe, donc ils
               ne sont pas touchés. */
            $html = am_anglaiser_liens($html);
        }
    }
    if (array_key_exists('title', $h)) {
        $html = preg_replace_callback('~<title>.*?</title>~s', static function () use ($h) {
            return '<title>' . am_e($h['title']) . '</title>';
        }, $html, 1);
    }
    if (array_key_exists('description', $h)) {
        $html = am_meta($html, 'name', 'description', $h['description']);
    }
    if (array_key_exists('robots', $h)) {
        $html = am_meta($html, 'name', 'robots', $h['robots']);
    }
    if (!empty($h['canonical'])) {
        $url = am_e($h['canonical']);
        $html = preg_match('~<link rel="canonical" href="[^"]*"~', $html)
            ? preg_replace_callback('~<link rel="canonical" href="[^"]*"~', static function () use ($url) {
                return '<link rel="canonical" href="' . $url . '"';
            }, $html, 1)
            : am_avant_fin_head($html, '<link rel="canonical" href="' . $url . '">');
    }
    if (array_key_exists('alternates', $h)) {
        $html = preg_replace('~[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?~', '', $html);
        if (is_array($h['alternates'])) {
            $lignes = '';
            foreach ($h['alternates'] as $l => $u) {
                $lignes .= '<link rel="alternate" hreflang="' . $l . '" href="' . am_e($u) . '">' . "\n  ";
            }
            $html = am_avant_fin_head($html, rtrim($lignes));
        }
    }
    foreach ($h['og'] ?? [] as $prop => $val) {
        $html = am_meta($html, 'property', $prop, $val);
    }
    foreach ($h['twitter'] ?? [] as $nom => $val) {
        $html = am_meta($html, 'name', $nom, $val);
    }
    if (array_key_exists('jsonld', $h)) {
        $html = preg_replace('~[ \t]*<script type="application/ld\+json"[^>]*>.*?</script>\n?~s', '', $html);
        $html = preg_replace('~[ \t]*<!-- JSON-LD Product injecté[^>]*-->\n?~', '', $html);
        if ($h['jsonld']) {
            $html = am_avant_fin_head($html, am_json_ld($h['jsonld']));
        }
    }
    /* En dernier : le sélecteur de langue lit les hreflang tels que la page
       les déclare au final, une fois ceux de $h écrits. */
    return am_lien_langue($html);
}

/* Le sélecteur de langue devient un vrai lien vers l'autre version.
   C'était un <button> qui changeait d'adresse en JavaScript. Google ne suit
   que les <a href> : aucun des liens des pages françaises ne menait donc à
   une page anglaise, que les moteurs ne trouvaient que par le plan du site
   et les hreflang (audit d'octobre 2026).

   La cible est l'adresse que la page déclare elle-même pour l'autre langue,
   dans son <link rel="alternate" hreflang>, et non une adresse recalculée
   ici : un seul endroit décide de ce qu'est la version anglaise d'une page.
   Elle est absolue, ce qui la met à l'abri de am_anglaiser_liens, qui ne
   réécrit que les chemins commençant par « / ».

   Sans hreflang vers l'autre langue (fiche non traduite, recherche ?q=,
   catégorie vide), il n'existe pas de page à désigner : le sélecteur est
   un bouton. Même chose si la cible est la page elle-même (fiche servie
   sans la base, où la tête n'est pas réécrite pour l'anglais) : un lien
   vers soi-même ne mène nulle part. Un gabarit qui porte déjà un lien
   (about.html, community.html, sell.html et legal.html, servis tels quels
   en français) est alors remis en <button>, sans href ni hreflang : il
   désignerait sinon une autre version qui n'existe pas pour la page
   servie.

   Le clic simple ne change pas : bindToggle (i18n.js) l'intercepte avec
   preventDefault et garde la requête et l'ancre de l'adresse courante. Un
   clic qui ouvre un autre onglet suit le lien ; vers le français,
   bindToggle y ajoute ?lang=fr au moment du geste, sans quoi la préférence
   anglaise enregistrée reprendrait la main dans le nouvel onglet. Le
   lien sert aux moteurs et aux navigateurs sans JavaScript. L'élément est
   repéré par son id, quel que soit son texte, puisque am_traduire a déjà
   écrit « FR » sur une page anglaise. */
function am_lien_langue(string $html): string
{
    $url = null;
    $autre = '';
    if (preg_match('~<html\s+lang="(fr|en)"~i', $html, $l)) {
        $autre = strtolower($l[1]) === 'fr' ? 'en' : 'fr';
        if (preg_match('~<link rel="alternate" hreflang="' . $autre . '" href="(https?://[^"]+)"~', $html, $a)) {
            // Valeur reprise telle quelle de l'attribut : elle est déjà échappée.
            $url = $a[1];
            if (preg_match('~<link rel="canonical" href="([^"]*)"~', $html, $c) && $c[1] === $url) {
                $url = null;
            }
        }
    }
    return (string) preg_replace_callback(
        '~<(button|a)\b([^>]*?)\sid="lang-toggle"([^>]*)>(.*?)</\1>~s',
        static function (array $m) use ($url, $autre): string {
            /* Classe, data-i18n et aria-label sont gardés ; type n'a pas de
               sens sur un lien, et un href déjà posé est remplacé. */
            $avant = (string) preg_replace('~\s(?:type|href|hreflang)="[^"]*"~', '', $m[2]);
            $apres = (string) preg_replace('~\s(?:type|href|hreflang)="[^"]*"~', '', $m[3]);
            if ($url === null) {
                // Pas d'autre version : un bouton reste tel quel, un lien redevient bouton.
                if ($m[1] !== 'a') {
                    return $m[0];
                }
                return '<button' . $avant . ' id="lang-toggle"' . $apres . '>' . $m[4] . '</button>';
            }
            return '<a' . $avant . ' id="lang-toggle" href="' . $url . '" hreflang="' . $autre . '"' . $apres . '>'
                . $m[4] . '</a>';
        },
        $html,
        1
    );
}

/* ---------------------------------------------------------------------
   Base de données (PostgREST), avec cache fichier
   --------------------------------------------------------------------- */

/* La clé publique est lue dans supabaseClient.js : c'est l'unique endroit où
   la changer lors d'une rotation. */
function am_cle_publique(): string
{
    static $cle = null;
    if ($cle === null) {
        $src = (string) @file_get_contents(AM_RACINE . '/supabaseClient.js');
        $cle = preg_match('~SUPABASE_ANON_KEY\s*=\s*"([A-Za-z0-9._-]+)"~', $src, $m) ? $m[1] : '';
    }
    return $cle;
}

function am_dossier_cache(): bool
{
    if (!is_dir(AM_CACHE) && !@mkdir(AM_CACHE, 0755, true)) {
        return false;
    }
    if (!is_file(AM_CACHE . '/.htaccess')) {
        @file_put_contents(AM_CACHE . '/.htaccess', "Require all denied\n");
    }
    return is_writable(AM_CACHE);
}

/* Lecture PostgREST en tant que visiteur anonyme.
   Renvoie le tableau décodé, [] si la requête n'a rien trouvé, et null si la
   base n'a pas pu être jointe : les appelants distinguent « introuvable »
   (404) de « panne » (on sert alors l'ancien gabarit rendu par le navigateur,
   plutôt que d'annoncer à Google qu'une annonce existante a disparu). */
/* Requêtes dont le cache, périmé, a été servi tel quel : elles sont
   rejouées après l'envoi de la page (voir am_envoyer). */
$AM_A_RAFRAICHIR = [];

/* Relit la base et écrit le cache ; renvoie le tableau, ou null en panne. */
function am_api_lire(string $requete, string $fichier, bool $ecriture): ?array
{
    $cle = am_cle_publique();
    if ($cle === '' || !function_exists('curl_init')) {
        return null;
    }
    $ch = curl_init(AM_SUPABASE . '/rest/v1/' . $requete);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 6,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_USERAGENT      => 'AthenaMilitaria-rendu/1.0',
        CURLOPT_HTTPHEADER     => ['apikey: ' . $cle, 'Authorization: Bearer ' . $cle, 'Accept: application/json'],
    ]);
    $rep = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($rep)) {
        return null;
    }
    $d = json_decode($rep, true);
    if (!is_array($d)) {
        return null;
    }
    if ($ecriture) {
        $tmp = $fichier . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, $rep) !== false) {
            @rename($tmp, $fichier);
        } else {
            @unlink($tmp);
        }
    }
    return $d;
}

function am_api(string $requete, int $duree = 300): ?array
{
    global $AM_A_RAFRAICHIR;
    $ecriture = am_dossier_cache();
    $fichier = AM_CACHE . '/api-' . md5($requete) . '.json';

    if (is_readable($fichier)) {
        $age = time() - (int) @filemtime($fichier);
        $d = json_decode((string) @file_get_contents($fichier), true);
        if (is_array($d)) {
            if ($age < $duree) {
                return $d;
            }
            /* Cache périmé mais récent : on le sert tel quel et on le
               rafraîchit une fois la page partie (am_envoyer). Mesuré le
               29 sept. 2026 : le catalogue répondait en 0,95 s quand le
               cache de cinq minutes avait expiré, contre 0,12 s sinon, et
               sur un site à quelques visites par heure, c'est le cas de
               la plupart des passages de Googlebot. Le visiteur, lui,
               reçoit de toute façon les annonces à jour par le JavaScript.
               Sans fastcgi_finish_request, rien ne peut tourner après
               l'envoi : on garde alors la lecture synchrone. */
            if ($age < 86400 && $ecriture && function_exists('fastcgi_finish_request')) {
                /* Les scripts qui n'appellent pas am_envoyer (sitemap.php,
                   flux-produits.php) doivent rafraîchir aussi : la fonction
                   de fin d'exécution s'en charge, et ne fait rien si
                   am_envoyer est déjà passé par là. */
                static $enregistre = false;
                if (!$enregistre) {
                    register_shutdown_function('am_rafraichir_apres_envoi');
                    $enregistre = true;
                }
                $AM_A_RAFRAICHIR[$requete] = $fichier;
                return $d;
            }
        }
    }

    $d = am_api_lire($requete, $fichier, $ecriture);
    if ($d !== null) {
        return $d;
    }

    // Panne : dernière réponse connue, même ancienne.
    if (is_readable($fichier)) {
        $d = json_decode((string) @file_get_contents($fichier), true);
        if (is_array($d)) {
            return $d;
        }
    }
    return null;
}

/* ---------------------------------------------------------------------
   Taxonomie et adresses : reprises des fichiers du navigateur
   --------------------------------------------------------------------- */

function am_source(string $fichier): string
{
    static $cache = [];
    return $cache[$fichier] ??= (string) @file_get_contents(AM_RACINE . '/' . $fichier);
}

/* Objet littéral de chaînes déclaré en `const NOM = { "a": "b", … };`
   (ou `var`, dans taxonomie.js). */
function am_objet_js(string $fichier, string $nom): array
{
    $sortie = [];
    if (preg_match('~(?:const|var) ' . preg_quote($nom, '~') . ' = \{(.*?)\};~s', am_source($fichier), $b)) {
        preg_match_all('~"([^"]+)"\s*:\s*"([^"]+)"~', $b[1], $p, PREG_SET_ORDER);
        foreach ($p as $x) {
            $sortie[$x[1]] = $x[2];
        }
    }
    return $sortie;
}

/* Liste `var NOM = [ "a", "b" ];` de taxonomie.js. */
function am_liste_js(string $fichier, string $nom): array
{
    if (!preg_match('~var ' . preg_quote($nom, '~') . '\s*=\s*\[(.*?)\];~s', am_source($fichier), $m)) {
        return [];
    }
    preg_match_all('~"([^"]+)"~', $m[1], $v);
    return $v[1];
}

function am_periodes(): array
{
    return am_liste_js('taxonomie.js', 'PERIODES');
}

function am_sous_categories(): array
{
    return am_liste_js('taxonomie.js', 'SOUS_CATEGORIES');
}

/* Valeur en base => segment d'adresse (/militaria/<période>/<type>). */
function am_segments_periodes(): array
{
    return am_objet_js('taxonomie.js', 'SEGMENTS_PERIODES');
}

function am_segments_types(): array
{
    return am_objet_js('taxonomie.js', 'SEGMENTS_TYPES');
}

/* Segment d'adresse => valeur en base ('' si inconnu). */
function am_periode_depuis_segment(string $s): string
{
    $v = array_search($s, am_segments_periodes(), true);
    return $v === false ? '' : (string) $v;
}

function am_type_depuis_segment(string $s): string
{
    $v = array_search($s, am_segments_types(), true);
    return $v === false ? '' : (string) $v;
}

/* Anciennes adresses (/category?cat=Guerre-froide&sub=Armes), jusqu'au
   18 septembre 2026 : la période avec ses espaces changés en tirets, et le
   type sous une forme courte. Ne sert plus qu'aux redirections 301. */
function am_periode_ancienne(string $cat): string
{
    $v = str_replace('-', ' ', trim($cat));
    return in_array($v, am_periodes(), true) ? $v : '';
}

function am_type_ancien(string $sub): string
{
    $v = str_replace('-', ' ', trim($sub));
    $v = ['Armes' => 'Armes (neutralisées/maquettes)', 'Médailles' => 'Médailles & décorations'][$v] ?? $v;
    return in_array($v, am_sous_categories(), true) ? $v : '';
}

/* Libellé traduit d'une période ou d'un type (clés cat.* de i18n.js). */
function am_libelle_periode(string $periode, string $lang): string
{
    $cle = am_objet_js('taxonomie.js', 'CLES_PERIODES')[$periode] ?? null;
    return $cle ? strip_tags(am_t($cle, $lang)) : $periode;
}

/* La période telle qu'on la tape dans un moteur : « casque à pointe 14-18 »,
   pas « 1ère Guerre Mondiale ». Sert aux titres et descriptions des fiches. */
function am_periode_courte(string $periode, string $lang): string
{
    $fr = ['Guerre Napoléonienne' => 'Premier Empire', 'Guerre de 1870' => '1870', '1ère Guerre Mondiale' => '14-18',
        '2nde Guerre Mondiale' => '39-45', "Guerre d'Indochine" => 'Indochine', "Guerre d'Algérie" => 'Algérie',
        'Guerre froide' => 'guerre froide'];
    $en = ['Guerre Napoléonienne' => 'Napoleonic', 'Guerre de 1870' => '1870', '1ère Guerre Mondiale' => 'WW1',
        '2nde Guerre Mondiale' => 'WW2', "Guerre d'Indochine" => 'Indochina War', "Guerre d'Algérie" => 'Algerian War',
        'Guerre froide' => 'Cold War'];
    return ($lang === 'en' ? $en : $fr)[$periode] ?? '';
}

/* Même idée pour les pages de catégorie : « Médailles 14-18 à vendre ».
   Les périodes sans forme courte naturelle gardent leur libellé. */
function am_ere_categorie(string $periode, string $lang): string
{
    if ($lang !== 'en') {
        $propres = ['Guerre Napoléonienne' => '', "Guerre d'Algérie" => "guerre d'Algérie"];
        if (array_key_exists($periode, $propres)) {
            return $propres[$periode];
        }
    }
    return am_periode_courte($periode, $lang);
}

function am_libelle_sous(string $sous, string $lang): string
{
    $cle = am_objet_js('taxonomie.js', 'CLES_TYPES')[$sous] ?? null;
    return $cle ? strip_tags(am_t($cle, $lang)) : $sous;
}

/* Même calcul que TAXONOMIE.urlCategorie (taxonomie.js). Un type sans
   période n'a pas d'adresse propre : on renvoie au catalogue. */
function am_url_categorie(?string $periode, ?string $sous, string $lang = 'fr'): string
{
    $chemin = '/militaria';
    $p = am_segments_periodes();
    if ($periode && isset($p[$periode])) {
        $chemin .= '/' . $p[$periode];
        $t = am_segments_types();
        if ($sous && isset($t[$sous])) {
            $chemin .= '/' . $t[$sous];
        }
    }
    return $chemin . ($lang === 'en' ? '?lang=en' : '');
}

/* Même découpe que TAXONOMIE.slugTitre (taxonomie.js) : minuscules, sans
   accents, tirets, 60 caractères au plus. Les deux doivent coïncider, sinon
   le serveur et le navigateur fabriquent deux adresses pour une même fiche. */
function am_slug_titre($titre): string
{
    $t = (string) ($titre ?? '');
    if (class_exists('Normalizer')) {
        $t = (string) Normalizer::normalize($t, Normalizer::FORM_D);
        $t = (string) preg_replace('~\p{Mn}+~u', '', $t);
    } else {
        $t = (string) @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $t);
    }
    $t = str_replace(['œ', 'Œ', 'æ', 'Æ'], ['oe', 'oe', 'ae', 'ae'], $t);
    $t = strtolower($t);
    $t = (string) preg_replace('~[^a-z0-9]+~', '-', $t);
    $t = trim($t, '-');
    if (strlen($t) > 60) {
        $t = substr($t, 0, 60);
        $coupe = strrpos($t, '-');
        if ($coupe !== false && $coupe > 20) {
            $t = substr($t, 0, $coupe);
        }
        $t = rtrim($t, '-');
    }
    return $t === '' ? 'annonce' : $t;
}

/* Le nom du site en fin de titre rassure sur l'origine d'un résultat, quand
   il tient. Au-delà d'une soixantaine de caractères, Google coupe, et c'est la
   fin qu'il coupe : le suffixe emporterait alors le mot qui décrit la page.
   On ne l'ajoute donc que s'il rentre, le nom du site étant de toute façon
   affiché au-dessus du titre dans les résultats. */
/* Coupe un titre de fiche sur un mot entier, sans points de suspension, et
   sans laisser un mot-outil en fin de titre : « …lame avec » ou « …insignes
   de » n'annoncent rien (audit du 1er oct. 2026 : quatre titres sur douze). */
function am_couper_titre(string $txt, int $max): string
{
    $t = trim(preg_replace('~\s+~u', ' ', $txt));
    if (mb_strlen($t) <= $max) {
        return $t;
    }
    $bout = mb_substr($t, 0, $max + 1);
    $esp = mb_strrpos($bout, ' ');
    $t = rtrim(mb_substr($bout, 0, $esp !== false ? $esp : $max), " ,;:·-");
    static $outils = ['avec', 'de', 'des', 'du', 'd', 'et', 'à', 'a', 'en', 'pour', 'sur', 'le', 'la', 'les', 'un', 'une', 'ou',
        'with', 'of', 'and', 'the', 'for', 'in', 'on', 'or', 'to'];
    while (preg_match('~\s([^\s]+)$~u', $t, $m) && in_array(mb_strtolower(rtrim($m[1], "'’")), $outils, true)) {
        $t = rtrim(mb_substr($t, 0, -mb_strlen($m[0])), " ,;:·-");
    }
    return $t;
}

function am_titre_page(string $descriptif, int $max = 60): string
{
    $suffixe = ' | Athena Militaria';
    return mb_strlen($descriptif) + mb_strlen($suffixe) <= $max
        ? $descriptif . $suffixe
        : $descriptif;
}

/* Adresse d'une fiche : /annonce/<titre>-<identifiant>. L'identifiant ferme
   l'adresse : un titre corrigé change le texte, jamais la cible, et
   product.php redirige l'ancienne forme. */
function am_url_fiche($id, string $lang = 'fr', $titre = ''): string
{
    return '/annonce/' . am_slug_titre($titre) . '-' . rawurlencode((string) $id)
        . ($lang === 'en' ? '?lang=en' : '');
}

/* ---------------------------------------------------------------------
   Photos
   --------------------------------------------------------------------- */

function am_chemin_photo($url): ?string
{
    if (!is_string($url) || !preg_match('~/storage/v1/(?:object|render/image)/public/product-images/(.+?)(?:\?.*)?$~', $url, $m)) {
        return null;
    }
    return rawurldecode($m[1]);
}

/* imgUrl (script.js). Les photos au nom sûr passent par le relais du site
   (/media/…, voir media.php), servi en WebP et mis en cache sur place. */
function am_img($url, int $w): string
{
    $w = in_array($w, AM_LARGEURS, true) ? $w : 800;
    $chemin = am_chemin_photo($url);
    if ($chemin === null) {
        return is_string($url) && $url !== '' ? $url : '/hero.png';
    }
    if (preg_match('~^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$~', $chemin)) {
        return '/media/' . $w . '/' . $chemin . '.webp';
    }
    return am_img_jpeg($url, $w);
}

/* URL de la fonction d'origine, en JPEG : pour les aperçus de partage, dont
   tous les réseaux ne lisent pas le WebP. */
function am_img_jpeg($url, int $w): string
{
    $chemin = am_chemin_photo($url);
    if ($chemin === null) {
        return is_string($url) && $url !== '' ? $url : '/hero.png';
    }
    $w = in_array($w, AM_LARGEURS, true) ? $w : 800;
    return AM_IMG_FN . '?path=' . implode('/', array_map('rawurlencode', explode('/', $chemin))) . '&w=' . $w;
}

/* ---------------------------------------------------------------------
   Formats d'affichage
   --------------------------------------------------------------------- */

/* window.formatPrice : séparateur de milliers fine insécable, comme fr-FR. */
function am_prix($prix): string
{
    $n = (float) $prix;
    if (floor($n) == $n) {
        $s = number_format($n, 0, ',', "\u{202F}");
    } else {
        $s = rtrim(rtrim(number_format($n, 2, ',', "\u{202F}"), '0'), ',');
    }
    return $s . ' €';
}

/* ---------------------------------------------------------------------
   Protection acheteurs

   Ce que l'acheteur paie en plus du prix et de la livraison, et que la
   plateforme garde : 5 % du prix de l'article + 0,70 € (fonction SQL
   buyer_protection_fee_cents, migration 20260813000200, l. 146-165,
   appelée par checkout_reserve). Stripe le débite sur sa propre ligne.
   La fiche l'affiche et le compte dans les frais de livraison déclarés à
   Google, le flux Shopping aussi : annoncer à Merchant Center un total
   inférieur à celui débité relève de la « présentation trompeuse », que
   Google sanctionne par une suspension du compte sans avertissement
   (support.google.com/merchants/answer/6150127), et les frais de service
   se déclarent avec la livraison (answer/6324371, attribut price).

   Le calcul est refait ici plutôt que demandé à la base : la fonction SQL
   renvoie un nombre seul, qu'am_api écarte (elle n'accepte qu'un tableau
   JSON, voir am_api_lire), et la formule est figée par le barème. Le même
   calcul existe donc en SQL, ici et dans product.js ;
   tests/protection-acheteurs.test.ts vérifie que les trois rendent les
   mêmes centimes, et les compare à la fonction en ligne.
   --------------------------------------------------------------------- */

const AM_PROTECTION_TAUX_BPS = 500;   // 5,00 % du prix de l'article
const AM_PROTECTION_FIXE_CENTS = 70;  // + 0,70 € par achat

/* Prix en base vers centimes, comme ROUND(price * 100) dans
   checkout_reserve. Le formulaire de vente n'accepte que deux décimales
   (step="0.01") : l'écart du calcul en virgule flottante (19,99 × 100 =
   1 998,999…) reste loin de la demie, et round() le rattrape. */
function am_centimes($prix): int
{
    return (int) round((float) $prix * 100);
}

/* ROUND(centimes × 500 / 10000) + 70. En PostgreSQL, ROUND d'un numeric
   arrondit la demie en s'éloignant de zéro (0,5 → 1 ; 2,5 → 3), jamais
   au pair : ajouter 5 000 avant la division entière donne exactement ce
   résultat, en entiers, sans flottant. Un prix négatif n'existe pas en
   base ; le compter pour zéro évite seulement un montant absurde. */
function am_protection_cents(int $centimes): int
{
    return intdiv(max(0, $centimes) * AM_PROTECTION_TAUX_BPS + 5000, 10000) + AM_PROTECTION_FIXE_CENTS;
}

/* Montant en centimes, écrit dans la langue de la page avec ses deux
   décimales, comme les tarifs de livraison (tr_js_product.ship_price_post) :
   « 13,20 € », « €13.20 ». Espaces insécables : le montant ne se coupe
   jamais en fin de ligne. */
function am_montant_cents(int $centimes, string $lang): string
{
    $n = $centimes / 100;
    return $lang === 'en'
        ? '€' . number_format($n, 2, '.', ',')
        : number_format($n, 2, ',', "\u{202F}") . "\u{00A0}€";
}

/* window.timeAgo */
function am_depuis(?string $date, string $lang): string
{
    $t = $date ? strtotime($date) : false;
    if ($t === false) {
        return '';
    }
    $ecart = time() - $t;
    if ($ecart < 60) {
        return am_t('tr_js_script.just_now', $lang);
    }
    foreach ([[3600, 60, 'time_min'], [86400, 3600, 'time_hour'], [2592000, 86400, 'time_day']] as [$borne, $unite, $cle]) {
        if ($ecart < $borne) {
            return str_replace('{n}', (string) floor($ecart / $unite), am_t('tr_js_script.' . $cle, $lang));
        }
    }
    if (class_exists('IntlDateFormatter')) {
        $f = new IntlDateFormatter($lang === 'en' ? 'en_GB' : 'fr_FR', IntlDateFormatter::NONE, IntlDateFormatter::NONE, 'Europe/Paris', null, 'd MMM y');
        return (string) $f->format($t);
    }
    return date('d/m/Y', $t);
}

/* État de conservation : la base garde la valeur française du formulaire
   (taxonomie.js, ETATS). La version anglaise l'affiche traduite. */
function am_etat(string $etat, string $lang): string
{
    static $en = [
        'Neuf'          => 'New',
        'Très bon état' => 'Very good condition',
        'Bon état'      => 'Good condition',
        'État correct'  => 'Fair condition',
        'À restaurer'   => 'Needs restoration',
    ];
    return $lang === 'en' ? ($en[$etat] ?? $etat) : $etat;
}

function am_titre_annonce(array $p, string $lang): string
{
    return ($lang === 'en' && !empty($p['title_en'])) ? (string) $p['title_en'] : (string) ($p['title'] ?? '');
}

const AM_SVG_CADENAS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

/* Icônes au trait des boutons secondaires de la fiche (mêmes tracés dans
   product.js) : la famille du partage et du signalement, pas les caractères
   ♡ et ✉ qu'une police de secours dessinait à sa façon. */
/* Sceau de l'avis d'authenticité : un écu et une coche, au trait comme les
   autres icônes. La taille vient de la feuille de style. */
const AM_SVG_SCEAU = '<svg class="sceau" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 19.5 5.6v5.6c0 4.5-3.1 8.4-7.5 10-4.4-1.6-7.5-5.5-7.5-10V5.6z"/><path d="m8.7 12.1 2.3 2.3 4.4-4.6"/></svg>';

const AM_SVG_COEUR = '<svg class="btn-icone" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const AM_SVG_ENVELOPPE = '<svg class="btn-icone" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>';

/* « septembre 2026 » ou « September 2026 », sans dépendre de l'extension
   intl du serveur. */
function am_mois_annee(?string $date, string $lang): string
{
    $t = $date ? strtotime($date) : false;
    if ($t === false) {
        return '';
    }
    static $mois = [
        'fr' => ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
        'en' => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    ];
    $m = (int) gmdate('n', $t) - 1;
    return $mois[$lang === 'en' ? 'en' : 'fr'][$m] . ' ' . gmdate('Y', $t);
}

/* Date d'une vente, en toutes lettres : « 12 octobre 2026 ». */
function am_date_longue(?string $date, string $lang): string
{
    $t = $date ? strtotime($date) : false;
    if ($t === false) {
        return '';
    }
    if (class_exists('IntlDateFormatter')) {
        $f = new IntlDateFormatter($lang === 'en' ? 'en_GB' : 'fr_FR', IntlDateFormatter::LONG, IntlDateFormatter::NONE, 'Europe/Paris');
        return (string) $f->format($t);
    }
    return date('d/m/Y', $t);
}

/* Carte d'annonce des grilles : même structure que renderProductCard
   (script.js), rendue pour un visiteur non connecté. Une pièce vendue
   (archive des ventes) porte le bandeau « Vendu » et la date de la vente.

   $rang : place de la carte en tête d'une page catalogue (0, 1…), ou null
   ailleurs. Sur téléphone, les deux premières cartes forment la première
   rangée, visible dès l'arrivée, et la photo de l'une d'elles est
   l'élément le plus grand de l'écran (LCP). En loading="lazy", le
   navigateur attendait d'avoir calculé la mise en page pour la demander.
   Mesuré le 9 oct. 2026 avec une copie de vitals-mesure.mjs (390 px, 4G
   lente, processeur ralenti 4 fois, mesure.php coupé, 5 passes, seule la
   grille changeant d'une série à l'autre) : LCP médian de 2 092 à
   1 344 ms sur /militaria, de 1 848 à 1 336 ms sur une période ; le
   premier affichage recule d'environ 200 ms, la photo prenant sa part du
   débit. fetchpriority="high" sur la première seule :
   la mesure ne le distingue pas de son absence, il ne coûte rien. Les
   autres grilles (accueil, annonces semblables de la fiche) gardent
   loading="lazy" : elles ne sont pas en haut de leur page. */
function am_carte(array $p, string $lang, ?int $rang = null): string
{
    $titre = am_titre_annonce($p, $lang);
    $vendue = ($p['status'] ?? '') === 'sold';
    $flou = !empty($p['historically_sensitive']);
    $voile = $flou
        ? '<div class="sensitive-overlay"><span class="sensitive-pastille">' . AM_SVG_CADENAS
          . '<span data-i18n="product.sensitive_overlay">' . am_e(am_t('tr_js_script.sensitive_overlay', $lang)) . '</span></span></div>'
        : '';
    $avis = !empty($p['authenticated_at'])
        ? '<p class="item-card-auth">' . AM_SVG_SCEAU . '<span>' . am_e(am_t('tr_js_script.card_auth', $lang)) . '</span></p>'
        : '';
    $bandeau = $vendue ? '<div class="sold-overlay">' . am_e(am_t('tr_js_product.sold_overlay', $lang)) . '</div>' : '';
    $date = $vendue ? am_date_longue($p['sold_at'] ?? null, $lang) : '';
    $chargement = $rang === 0 ? ' fetchpriority="high"' : ($rang === 1 ? '' : ' loading="lazy"');
    return '      <a class="item-card' . ($vendue ? ' is-sold' : '') . '" href="' . am_e(am_url_fiche($p['id'], $lang, $p['title'] ?? '')) . '">'
        . '<div class="item-card-img' . ($flou ? ' is-blurred' : '') . '">'
        . '<img src="' . am_e(am_img($p['image_url'] ?? null, 400)) . '" alt=""' . $chargement . ' decoding="async" onerror="this.onerror=null;this.src=\'/hero.png\'">'
        . $bandeau . $voile . '</div>'
        . '<h3>' . am_e($titre) . '</h3>'
        . '<p class="price">' . am_e(am_prix($p['price'] ?? 0)) . '</p>'
        . $avis
        . ($date !== '' ? '<p class="item-card-vendu">' . am_e(str_replace('{date}', $date, am_t('archive.sold_on', $lang))) . '</p>' : '')
        . "</a>\n";
}

/* ---------------------------------------------------------------------
   Réponses
   --------------------------------------------------------------------- */

/* Donne un maillage interne à la version anglaise.
   
   Jusqu'ici, une page servie en ?lang=en renvoyait vers des adresses
   françaises : l'en-tête, le pied de page et les liens de contenu ne
   portaient pas le paramètre. L'anglais n'était donc qu'une vingtaine de
   pages orphelines, atteignables par le plan de site et par une annotation
   hreflang, et Search Console les rangeait en « détectées, actuellement non
   indexées » : Google les connaissait et ne jugeait pas utile de les
   explorer. Une page vers laquelle rien ne pointe n'a aucune raison d'être
   explorée, quelle que soit sa qualité.
   
   Restent intacts : les fichiers, reconnus à un point dans leur dernier
   segment (/logo.webp, /media/...), les liens qui portent déjà une requête,
   et tout ce qui n'est pas une adresse interne absolue. L'ancre, elle, se
   replace après le paramètre, sans quoi le navigateur ne la suivrait pas. */
function am_anglaiser_liens(string $html): string
{
    return (string) preg_replace_callback(
        '~href="(/[^"#?]*)(#[^"]*)?"~',
        static function (array $m): string {
            $chemin = $m[1];
            $coupe = strrpos($chemin, '/');
            $dernier = $coupe === false ? $chemin : substr($chemin, $coupe);
            if (strpos($dernier, '.') !== false) {
                return $m[0];
            }
            return 'href="' . $chemin . '?lang=en' . ($m[2] ?? '') . '"';
        },
        $html
    );
}

function am_envoyer(string $html, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: text/html; charset=UTF-8');
    // Même règle que les .html : toujours revalidé.
    header('Cache-Control: public, max-age=0, must-revalidate');
    global $AM_A_RAFRAICHIR;
    header('X-Rendu: serveur' . (empty($AM_A_RAFRAICHIR) ? '' : '; cache perime, rafraichi apres envoi'));
    echo $html;
    am_rafraichir_apres_envoi();
    exit;
}

/* Termine la réponse, puis rejoue les requêtes dont le cache périmé a été
   servi (am_api). Le visiteur n'attend rien ; le passage suivant trouve un
   cache frais. Sans fastcgi_finish_request, la liste est vide. */
function am_rafraichir_apres_envoi(): void
{
    global $AM_A_RAFRAICHIR;
    if (empty($AM_A_RAFRAICHIR) || !function_exists('fastcgi_finish_request')) {
        return;
    }
    ignore_user_abort(true);
    fastcgi_finish_request();
    foreach ($AM_A_RAFRAICHIR as $requete => $fichier) {
        am_api_lire($requete, $fichier, true);
    }
    $AM_A_RAFRAICHIR = [];
}

/* Vraie 404, avec la page d'erreur du site et son noindex. */
function am_introuvable(string $lang = 'fr', int $code = 404): void
{
    $html = (string) @file_get_contents(AM_RACINE . '/404.html');
    if ($lang === 'en') {
        $html = am_traduire($html, 'en');
    }
    header('Cache-Control: no-cache');
    http_response_code($code);
    header('Content-Type: text/html; charset=UTF-8');
    echo $html;
    exit;
}

/* Guides éditoriaux (inc/guides.json, écrit par build-guides.cjs). */
function am_guides(): array
{
    static $g = null;
    if ($g === null) {
        $json = @file_get_contents(__DIR__ . '/guides.json');
        $g = $json ? (json_decode($json, true) ?: []) : [];
    }
    return $g;
}

/* Guides pertinents pour une annonce : ceux dont un mot-clé apparaît dans le
   titre, la description, la période ou le type. Le guide sur les faux reste
   utile à tout acheteur et complète la liste. */
function am_guides_lies(array $p, int $max = 2): array
{
    $texte = mb_strtolower(implode(' ', [
        $p['title'] ?? '', $p['description'] ?? '', $p['period'] ?? '', $p['subcategory'] ?? '', $p['condition'] ?? '',
    ]));
    $retenus = [];
    foreach (am_guides() as $g) {
        foreach ($g['motsCles'] ?? [] as $mot) {
            if ($mot !== '' && mb_strpos($texte, mb_strtolower($mot)) !== false) {
                $retenus[$g['slug']] = $g;
                break;
            }
        }
    }
    foreach (am_guides() as $g) {
        if (count($retenus) >= $max) {
            break;
        }
        if (!empty($g['pourTousLesAcheteurs'])) {
            $retenus[$g['slug']] = $g;
        }
    }
    return array_slice(array_values($retenus), 0, $max);
}
