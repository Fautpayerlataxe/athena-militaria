#!/usr/bin/env bash
# =====================================================================
#  Mise à l'essai du PHP sur le serveur, sans toucher au site.
#
#  PHP n'est pas installé sur le poste : une erreur de syntaxe dans
#  product.php ou category.php ne se voit qu'une fois en ligne, et elle
#  renvoie alors une 500 sur toutes les fiches. Ce script dépose une copie
#  complète du rendu serveur dans www/_essai_<jeton>/, sous d'autres noms
#  (product_essai.php, category_essai.php, page_essai.php), avec sa propre
#  bibliothèque inc/ et ses gabarits : le PHP d'essai lit ses fichiers à
#  lui (AM_RACINE), jamais ceux du site.
#
#  Usage :
#    set -a && . ./.env.deploy && set +a
#    ./essai-php.sh deposer     → envoie, contrôle la syntaxe, affiche l'adresse
#    ./essai-php.sh nettoyer    → supprime le dossier d'essai du serveur
#
#  Pages d'essai, par exemple :
#    <base>/product_essai.php?essai=/annonce/casque-a-pointe-22
#    <base>/category_essai.php?essai=/militaria/premiere-guerre-mondiale
#    <base>/page_essai.php?essai=community
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

: "${OVH_FTP_HOST:?charger .env.deploy avant}" "${OVH_FTP_USER:?}" "${OVH_FTP_PASS:?}" "${OVH_REMOTE_DIR:?}"
JETON_FICHIER=".cache/essai-php-jeton"
FTP="ftp://$OVH_FTP_HOST/$OVH_REMOTE_DIR"
AUTH=(--user "$OVH_FTP_USER:$OVH_FTP_PASS")

deposer() {
  mkdir -p .cache
  local jeton; jeton="$(openssl rand -hex 6)"
  echo "$jeton" > "$JETON_FICHIER"
  local d; d="$(mktemp -d)"
  mkdir -p "$d/inc"
  cp product.php "$d/product_essai.php"
  cp category.php "$d/category_essai.php"
  cp page.php "$d/page_essai.php"
  cp inc/athena.php inc/i18n-dict.json inc/guides.json "$d/inc/"
  [[ -f inc/categories.json ]] && cp inc/categories.json "$d/inc/"
  for f in taxonomie.js supabaseClient.js 404.html product.html category.html index.html about.html community.html sell.html legal.html; do
    [[ -f "$f" ]] && cp "$f" "$d/"
  done
  [[ -d categories ]] && cp -R categories "$d/"
  # Contrôle de syntaxe sans exécution : token_get_all en mode analyse.
  cat > "$d/lint.php" <<'PHP'
<?php
header('Content-Type: text/plain; charset=utf-8');
$ok = true;
foreach (['product_essai.php', 'category_essai.php', 'page_essai.php', 'inc/athena.php'] as $f) {
    try { token_get_all((string) file_get_contents(__DIR__ . '/' . $f), TOKEN_PARSE); echo "ok      $f\n"; }
    catch (Throwable $e) { $ok = false; echo "ERREUR  $f : " . $e->getMessage() . ' ligne ' . $e->getLine() . "\n"; }
}
echo $ok ? "SYNTAXE OK\n" : "SYNTAXE EN ERREUR\n";
PHP
  local n=0
  while IFS= read -r -d '' f; do
    local rel="${f#$d/}"
    curl -s --max-time 60 --ftp-create-dirs -T "$f" "${AUTH[@]}" "$FTP/_essai_$jeton/$rel" > /dev/null
    n=$((n + 1))
  done < <(find "$d" -type f -print0)
  rm -rf "$d"
  echo "   $n fichier(s) déposés dans _essai_$jeton/"
  sleep 3
  local rapport; rapport="$(curl -s "https://www.athenamilitaria.fr/_essai_$jeton/lint.php")"
  echo "$rapport"
  echo "   base : https://www.athenamilitaria.fr/_essai_$jeton"
  # Code de sortie non nul si la syntaxe est fausse : « deposer && deploy »
  # s'arrête alors de lui-même. Le 23 sept. 2026, un grep sur le mot SYNTAXE
  # avait laissé partir en production une apostrophe non échappée.
  if [[ "$rapport" != *"SYNTAXE OK"* ]]; then
    echo "   ❌ syntaxe en erreur : ne pas déployer"
    return 1
  fi
}

# Suppression récursive : FTP n'efface un dossier que vide.
effacer_dossier() {
  local chemin="$1" entree
  while IFS= read -r entree; do
    entree="$(printf '%s' "$entree" | tr -d '\r')"
    [[ -z "$entree" || "$entree" == "." || "$entree" == ".." ]] && continue
    if curl -s "${AUTH[@]}" -Q "DELE $OVH_REMOTE_DIR/$chemin/$entree" "$FTP/" -o /dev/null 2>/dev/null; then :; else
      effacer_dossier "$chemin/$entree"
    fi
  done < <(curl -s "${AUTH[@]}" --list-only "$FTP/$chemin/")
  curl -s "${AUTH[@]}" -Q "RMD $OVH_REMOTE_DIR/$chemin" "$FTP/" -o /dev/null
}

nettoyer() {
  [[ -f "$JETON_FICHIER" ]] || { echo "   aucun essai en cours"; return; }
  local jeton; jeton="$(cat "$JETON_FICHIER")"
  effacer_dossier "_essai_$jeton"
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "https://www.athenamilitaria.fr/_essai_$jeton/lint.php")"
  if [[ "$code" == "404" ]]; then echo "   _essai_$jeton supprimé"; rm -f "$JETON_FICHIER"; else echo "   ⚠️ _essai_$jeton répond encore ($code)"; fi
}

case "${1:-}" in
  deposer) deposer ;;
  nettoyer) nettoyer ;;
  *) echo "usage : $0 deposer|nettoyer"; exit 1 ;;
esac
