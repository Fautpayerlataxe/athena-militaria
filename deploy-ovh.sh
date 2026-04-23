#!/bin/bash
# Script de déploiement Athena Militaria vers OVH
# Usage : OVH_FTP_USER=xxx OVH_FTP_PASS=xxx OVH_FTP_HOST=ftp.cluster0xx.hosting.ovh.net ./deploy-ovh.sh
#
# Alternative : remplir les 3 variables ci-dessous directement (puis chmod +x deploy-ovh.sh)

: "${OVH_FTP_HOST:=ftp.cluster0xx.hosting.ovh.net}"
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
  "robots.txt"
  "sitemap.xml"
)

echo "🚀 Déploiement vers ftp://$OVH_FTP_HOST/$OVH_REMOTE_DIR"
echo ""

OK=0
FAIL=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "⚠️  Ignoré (introuvable) : $f"
    continue
  fi
  printf "📤 %-25s ... " "$f"
  if curl -s -T "$f" --user "$OVH_FTP_USER:$OVH_FTP_PASS" \
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
