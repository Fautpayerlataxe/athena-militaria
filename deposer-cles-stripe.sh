#!/bin/bash
#
# Dépose les secrets Stripe de production dans le trousseau du Mac.
#
#   ./deposer-cles-stripe.sh            les deux, l'un après l'autre
#   ./deposer-cles-stripe.sh cle        la clé secrète seulement
#   ./deposer-cles-stripe.sh webhook    le secret de signature seulement
#
# Ce que la première version faisait mal, et qui a coûté une saisie pour rien :
# elle n'écrivait qu'à la toute fin. Un blanc sur la seconde valeur jetait donc
# aussi la première, déjà correctement saisie. Chaque valeur est maintenant
# déposée dès qu'elle est validée, et une saisie vide est simplement redemandée
# au lieu de tout arrêter.
#
# Rien ne s'affiche pendant la saisie, rien n'est écrit dans un fichier, rien ne
# reste dans l'historique du terminal.
#
set -u

vert()  { printf "\033[32m%s\033[0m\n" "$1"; }
rouge() { printf "\033[31m%s\033[0m\n" "$1"; }
gris()  { printf "\033[90m%s\033[0m\n" "$1"; }

# Demande une valeur, la valide, la dépose. Trois tentatives, puis on renonce
# pour ce secret sans perdre l'autre.
demander() {
  local titre="$1" indice="$2" service="$3" prefixes="$4"
  local valeur essai p accepte

  for essai in 1 2 3; do
    echo
    echo "$titre"
    gris  "     $indice"
    printf "     Collez puis Entrée : "
    read -r -s valeur
    echo

    if [ -z "$valeur" ]; then
      rouge "     Rien n'est arrivé. Le copier-coller n'a peut-être pas pris."
      gris  "     Retournez sur Stripe, cliquez sur l'icône de copie, revenez ici,"
      gris  "     puis faites Cmd+V et Entrée. Tentative $essai sur 3."
      continue
    fi

    # Le motif ne peut pas venir d'une variable avec des alternatives : bash ne
    # découpe pas le « | » d'une variable dans un case. On compare préfixe par
    # préfixe, ce qui est aussi plus lisible.
    accepte=0
    for p in $prefixes; do
      case "$valeur" in "$p"*) accepte=1 ;; esac
    done

    if [ "$accepte" -eq 0 ]; then
      case "$valeur" in
        sk_test_*|rk_test_*|whsec_test_*)
          rouge "     C'est une valeur de TEST, pas de production."
          gris  "     Dans Stripe, le sélecteur en haut à droite doit être sur Production." ;;
        mk_*|pk_*)
          rouge "     Ce n'est pas la clé mais son identifiant, ou la clé publique."
          gris  "     La vraie clé commence par sk_live_ et ne s'affiche qu'une fois." ;;
        *)
          rouge "     Format inattendu. Attendu, au choix : $prefixes" ;;
      esac
      gris "     Tentative $essai sur 3."
      continue
    fi

    security add-generic-password -a "$USER" -s "$service" -w "$valeur" -U 2>/dev/null
    unset valeur
    vert  "     Enregistré."
    return 0
  done

  rouge "     Abandon après trois tentatives pour cette valeur."
  return 1
}

QUOI="${1:-tout}"
echo
echo "Dépôt des clés Stripe de production"
echo "───────────────────────────────────"
gris "Rien ne s'affichera pendant que vous collez. C'est normal, ne recommencez pas."

echecs=0

if [ "$QUOI" = "tout" ] || [ "$QUOI" = "cle" ]; then
  demander "Clé secrète de production" \
           "Elle commence par sk_live_ (ou rk_live_)" \
           "athena-stripe-live" \
           "sk_live_ rk_live_" || echecs=$((echecs + 1))
fi

if [ "$QUOI" = "tout" ] || [ "$QUOI" = "webhook" ]; then
  demander "Secret de signature du webhook de production" \
           "Il commence par whsec_" \
           "athena-stripe-live-webhook" \
           "whsec_" || echecs=$((echecs + 1))
fi

echo
echo "État du trousseau"
echo "─────────────────"
for couple in "athena-stripe-live:Clé secrète" "athena-stripe-live-webhook:Secret de signature"; do
  service="${couple%%:*}"; libelle="${couple#*:}"
  if security find-generic-password -a "$USER" -s "$service" -w > /dev/null 2>&1; then
    vert "  $libelle : déposé"
  else
    rouge "  $libelle : manquant"
  fi
done

echo
if [ "$echecs" -eq 0 ]; then
  gris "Aucune valeur n'a été affichée ni écrite dans un fichier."
  echo "Dites-le moi, je m'occupe de tout le reste."
else
  gris "Pour ne reprendre que ce qui manque :"
  gris "  ./deposer-cles-stripe.sh cle       (la clé secrète)"
  gris "  ./deposer-cles-stripe.sh webhook   (le secret de signature)"
fi
echo
