#!/bin/bash
# Script de déploiement Athena Militaria vers OVH
# Usage : OVH_FTP_USER=xxx OVH_FTP_PASS=xxx OVH_FTP_HOST=ftp.cluster0xx.hosting.ovh.net ./deploy-ovh.sh
#
# Alternative : remplir les 3 variables ci-dessous directement (puis chmod +x deploy-ovh.sh)

: "${OVH_FTP_HOST:=ftp.cluster100.hosting.ovh.net}"
: "${OVH_FTP_USER:?Définir OVH_FTP_USER (export OVH_FTP_USER=xxx)}"
: "${OVH_FTP_PASS:?Définir OVH_FTP_PASS (export OVH_FTP_PASS=xxx)}"
: "${OVH_REMOTE_DIR:=www}"   # dossier distant (généralement 'www' chez OVH)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FILES=(
  "index.html"
  "about.html"
  "account.html"
  "admin.html"
  "category.html"
  "community.html"
  "legal.html"
  "messages.html"
  "product.html"
  "sell.html"
  "404.html"
  "style.css"
  "script.js"
  "account.js"
  "admin.js"
  "product.js"
  "messages.js"
  "supabaseClient.js"
  "i18n.js"
  "logo.png"
  "hero.png"
  "og-cover.jpg"
  "favicon.ico"
  "icon-192.png"
  "icon-48.png"
  "icon-32.png"
  "apple-touch-icon.png"
  "manifest.webmanifest"
  "pictures/hero-photo-1.jpg"
  "pictures/hero-photo-1-800.webp"
  "pictures/hero-photo-1-1400.webp"
  "pictures/hero-photo-1-1400.jpg"
  ".htaccess"
  "robots.txt"
  # Plan de site : sitemap.xml est un index, sitemap-pages.xml la moitié
  # statique, sitemap.php sert la moitié « annonces » depuis Supabase et
  # sitemap-annonces-secours.xml lui sert de filet si Supabase ne répond pas.
  "sitemap.xml"
  "sitemap-pages.xml"
  "sitemap-annonces-secours.xml"
  "sitemap.php"
)

echo "🚀 Déploiement vers ftp://$OVH_FTP_HOST/$OVH_REMOTE_DIR"
echo ""

# --- SEO : régénère sitemap.xml avec les annonces publiées (garde l'ancien si échec) ---
if command -v node > /dev/null 2>&1; then
  echo "🗺  Régénération du sitemap (pages + annonces publiées)..."
  echo "📄 Génération des guides éditoriaux..."
  node build-guides.js || echo "   ⚠️ échec génération des guides"
  echo "🗂  Génération des pages catégories enrichies..."
  node build-categories.js || echo "   ⚠️ échec génération des catégories"
  node generate-sitemap.js && echo "   sitemap.xml à jour" || echo "   ⚠️ échec génération, sitemap existant conservé"
  echo ""
fi

# Les pages de guides sont ajoutées dynamiquement pour ne pas avoir à
# maintenir la liste à la main à chaque nouveau guide.
#
# Ce bloc doit rester APRÈS build-guides.js. Placé avant, le glob ne voyait
# que les pages déjà présentes sur le disque : un guide ajouté à
# guides-contenu.js était écrit ensuite, donc jamais envoyé, alors que
# generate-sitemap.js le déclarait dans sitemap-pages.xml. Google recevait
# une URL annoncée par le sitemap et répondant 404. Sur un clone neuf du
# dépôt, où guides/ n'existe pas encore, c'était le cas des six guides.
if compgen -G "guides/*.html" > /dev/null; then
  for g in guides/*.html; do FILES+=("$g"); done
fi

# Versions anglaises des guides. Le glob des guides ne descend pas dans les
# sous-dossiers : sans cette boucle, guides/en/ resterait sur le poste et la
# règle de réécriture, ne trouvant aucun fichier, servirait le français.
if compgen -G "guides/en/*.html" > /dev/null; then
  for g in guides/en/*.html; do FILES+=("$g"); done
fi

# Idem pour les copies enrichies des pages catégories.
if compgen -G "categories/*.html" > /dev/null; then
  for c in categories/*.html; do FILES+=("$c"); done
fi

OK=0
FAIL=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "⚠️  Ignoré (introuvable) : $f"
    continue
  fi
  printf "📤 %-25s ... " "$f"
  if curl -s --ftp-create-dirs -T "$f" --user "$OVH_FTP_USER:$OVH_FTP_PASS" \
       "ftp://$OVH_FTP_HOST/$OVH_REMOTE_DIR/$f" > /dev/null; then
    echo "✅"
    OK=$((OK+1))
  else
    echo "❌"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "Terminé : $OK envoyés, $FAIL échecs."
[[ $FAIL -eq 0 ]] && echo "🎉 Site en ligne sur https://athenamilitaria.fr"
