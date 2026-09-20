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
  "order.html"
  "sell.html"
  "404.html"
  # Feuille servie : style.css sans ses commentaires (build-css.cjs)
  "style.min.css"
  "script.js"
  "account.js"
  "admin.js"
  "product.js"
  "order.js"
  "messages.js"
  "supabaseClient.js"
  # Mesure d'audience : inerte tant qu'aucun identifiant n'y est inscrit.
  "analytics.js"
  # Traductions : le moteur, puis une table par langue. Une page ne charge
  # que la sienne (build-i18n-dict.cjs les écrit depuis i18n.js).
  "i18n-runtime.js"
  "i18n-fr.js"
  "i18n-en.js"
  "error-messages.js"
  "taxonomie.js"
  "logo.png"
  "logo.webp"
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
  "robots.txt"
  # Plan de site : sitemap.xml est un index, sitemap-pages.xml la moitié
  # statique, sitemap.php sert la moitié « annonces » depuis Supabase et
  # sitemap-annonces-secours.xml lui sert de filet si Supabase ne répond pas.
  "sitemap.xml"
  "sitemap-pages.xml"
  "sitemap-annonces-secours.xml"
  "sitemap.php"
  # Rendu côté serveur : fiche, catalogue, accueil et versions anglaises,
  # photos en WebP, et la bibliothèque commune avec ses tables (inc/).
  "product.php"
  "category.php"
  "page.php"
  "media.php"
  "inc/.htaccess"
  "inc/athena.php"
  "inc/i18n-dict.json"
  "inc/categories.json"
  "inc/guides.json"
)

echo "🚀 Déploiement vers ftp://$OVH_FTP_HOST/$OVH_REMOTE_DIR"
echo ""

# --- SEO : régénère sitemap.xml avec les annonces publiées (garde l'ancien si échec) ---
if command -v node > /dev/null 2>&1; then
  echo "🔤 Export du dictionnaire de traduction pour le rendu serveur..."
  node build-i18n-dict.cjs || { echo "   ❌ échec de l'export : déploiement interrompu"; exit 1; }
  echo "🎨 Feuille de style servie (sans commentaires)..."
  node build-css.cjs || { echo "   ❌ échec : déploiement interrompu"; exit 1; }
  echo "🗺  Régénération du sitemap (pages + annonces publiées)..."
  echo "📄 Génération des guides éditoriaux..."
  node build-guides.cjs || echo "   ⚠️ échec génération des guides"
  echo "🗂  Génération des pages catégories enrichies..."
  node build-categories.cjs || echo "   ⚠️ échec génération des catégories"
  node generate-sitemap.cjs && echo "   sitemap.xml à jour" || echo "   ⚠️ échec génération, sitemap existant conservé"
  echo ""
fi

# Les pages de guides sont ajoutées dynamiquement pour ne pas avoir à
# maintenir la liste à la main à chaque nouveau guide.
#
# Ce bloc doit rester APRÈS build-guides.cjs. Placé avant, le glob ne voyait
# que les pages déjà présentes sur le disque : un guide ajouté à
# guides-contenu.cjs était écrit ensuite, donc jamais envoyé, alors que
# generate-sitemap.cjs le déclarait dans sitemap-pages.xml. Google recevait
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

# Clé IndexNow : un fichier .txt de 32 caractères hexadécimaux, portant la
# clé pour nom et pour contenu. Les moteurs le lisent pour vérifier qu'une
# annonce de mise à jour vient bien du propriétaire du domaine. Repéré par son
# motif plutôt que nommé en dur, pour qu'une rotation de clé ne demande que de
# remplacer le fichier.
for k in [0-9a-f][0-9a-f]*.txt; do
  [[ -f "$k" && "$k" =~ ^[0-9a-f]{32}\.txt$ ]] && FILES+=("$k")
done

# .htaccess en dernier : ses règles envoient vers category.php, page.php et
# media.php, qui doivent être en place avant qu'elles ne s'appliquent.
FILES+=(".htaccess")

OK=0
FAIL=0
ECHECS=()

# OVH limite le nombre de connexions FTP simultanées et rapprochées. Sans
# reprise, une rafale de dépôts laissait la moitié des fichiers en arrière :
# le site se retrouvait à moitié à jour, ce qui est pire qu'un dépôt refusé,
# parce que rien ne le signale. Trois tentatives, avec une pause croissante.
envoyer() {
  local f="$1" essai
  for essai in 1 2 3 4; do
    if curl -s --max-time 60 --ftp-create-dirs -T "$f" \
         --user "$OVH_FTP_USER:$OVH_FTP_PASS" \
         "ftp://$OVH_FTP_HOST/$OVH_REMOTE_DIR/$f" > /dev/null 2>&1; then
      return 0
    fi
    sleep $((essai * 2))
  done
  return 1
}

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "⚠️  Ignoré (introuvable) : $f"
    continue
  fi
  printf "📤 %-25s ... " "$f"
  if envoyer "$f"; then
    echo "✅"
    OK=$((OK+1))
  else
    echo "❌"
    FAIL=$((FAIL+1))
    ECHECS+=("$f")
  fi
done

# Une seconde passe sur ce qui a échoué, après une pause : le serveur a le
# temps de libérer ses connexions.
if [[ ${#ECHECS[@]} -gt 0 ]]; then
  echo ""
  echo "Seconde passe sur ${#ECHECS[@]} fichier(s)…"
  sleep 15
  RESTANTS=()
  for f in "${ECHECS[@]}"; do
    printf "📤 %-25s ... " "$f"
    if envoyer "$f"; then echo "✅"; OK=$((OK+1)); FAIL=$((FAIL-1))
    else echo "❌"; RESTANTS+=("$f"); fi
  done
  ECHECS=("${RESTANTS[@]}")
fi

echo ""
echo "Terminé : $OK envoyés, $FAIL échecs."

if [[ $FAIL -eq 0 ]]; then
  # sitemap.php garde sa réponse six heures en cache : sans cette relance, un
  # changement d'adresses (catalogue, fiches) resterait annoncé à Google sous
  # l'ancienne forme jusqu'à expiration. Même jeton que la tâche planifiée.
  if curl -s --max-time 60 -o /dev/null -w "%{http_code}" \
       "https://www.athenamilitaria.fr/sitemap-annonces.xml?refresh=af9e943f873ff6307dde5ee8e854327d" | grep -q "^200$"; then
    echo "🗺  sitemap-annonces.xml régénéré"
  else
    echo "⚠️  sitemap-annonces.xml non régénéré : il se mettra à jour de lui-même sous six heures"
  fi
  # Bing, Yandex, Seznam et Naver sont prévenus directement des pages qui ont
  # changé, au lieu d'attendre qu'ils relisent le sitemap. Google n'accepte
  # pas ce protocole : pour lui, la relance du sitemap ci-dessus fait foi.
  if command -v node > /dev/null 2>&1; then
    echo "📣 Signalement des pages modifiées (IndexNow)..."
    node ping-indexnow.cjs || true
  fi
  echo "🎉 Site en ligne sur https://athenamilitaria.fr"
else
  echo ""
  echo "⚠️  Le site est PARTIELLEMENT à jour. Fichiers non déposés :"
  for f in "${ECHECS[@]}"; do echo "     $f"; done
  echo "   Relancez ./deploy-ovh.sh : les fichiers déjà déposés seront simplement réécrits."
  exit 1
fi
