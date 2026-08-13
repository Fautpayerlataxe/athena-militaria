#!/bin/bash
#
# Dépose les deux secrets Stripe de production dans le trousseau du Mac.
#
# Une seule commande à lancer, deux valeurs à coller. Rien ne s'affiche pendant
# la saisie, rien n'est écrit dans un fichier, rien ne reste dans l'historique
# du terminal : le trousseau est le seul endroit où les valeurs atterrissent.
#
#   ./deposer-cles-stripe.sh
#
set -u

vert()  { printf "\033[32m%s\033[0m\n" "$1"; }
rouge() { printf "\033[31m%s\033[0m\n" "$1"; }
gris()  { printf "\033[90m%s\033[0m\n" "$1"; }

echo
echo "Dépôt des clés Stripe de production"
echo "───────────────────────────────────"
gris "Rien ne s'affichera pendant que vous collez. C'est normal."
gris "Collez avec Cmd+V, puis appuyez sur Entrée."
echo

# --- 1. La clé secrète -------------------------------------------------------
echo "1/2  Clé secrète de production"
gris "     Elle commence par sk_live_"
printf "     Collez-la puis Entrée : "
read -r -s CLE
echo

if [ -z "$CLE" ]; then
  rouge "     Rien n'a été collé. Relancez la commande."
  exit 1
fi
case "$CLE" in
  sk_live_*|rk_live_*) ;;
  sk_test_*|rk_test_*)
    rouge "     C'est une clé de TEST, pas de production."
    gris  "     Dans Stripe, basculez le sélecteur en haut à droite sur Production."
    exit 1 ;;
  mk_*|pk_*)
    rouge "     Ce n'est pas la clé mais son identifiant, ou la clé publique."
    gris  "     La vraie clé commence par sk_live_ et ne s'affiche qu'une fois,"
    gris  "     au moment où vous la créez."
    exit 1 ;;
  *)
    rouge "     Format inattendu : une clé secrète commence par sk_live_."
    exit 1 ;;
esac

# --- 2. Le secret de signature du webhook ------------------------------------
echo
echo "2/2  Secret de signature du webhook de production"
gris "     Il commence par whsec_"
printf "     Collez-le puis Entrée : "
read -r -s WHSEC
echo

if [ -z "$WHSEC" ]; then
  rouge "     Rien n'a été collé. Relancez la commande."
  exit 1
fi
case "$WHSEC" in
  whsec_*) ;;
  *)
    rouge "     Format inattendu : un secret de signature commence par whsec_."
    exit 1 ;;
esac

# --- Dépôt -------------------------------------------------------------------
security add-generic-password -a "$USER" -s athena-stripe-live         -w "$CLE"   -U 2>/dev/null
security add-generic-password -a "$USER" -s athena-stripe-live-webhook -w "$WHSEC" -U 2>/dev/null

# Les variables disparaissent avec le processus ; on les efface tout de même.
unset CLE WHSEC

echo
vert "Les deux valeurs sont dans le trousseau."
gris "Elles n'ont été affichées nulle part et ne sont dans aucun fichier."
echo
echo "Dites-le moi, je m'occupe de tout le reste."
echo
