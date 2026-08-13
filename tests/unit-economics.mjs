/**
 * Rentabilité unitaire de la plateforme, au centime.
 *
 * Modèle décidé :
 *   - l'acheteur paie   : prix article + frais de livraison + Protection acheteurs
 *   - Protection        : 5 % du prix de l'article + 0,70 € fixes
 *   - le vendeur reçoit : 100 % du prix + 100 % des frais de livraison, sans
 *                         aucune commission ni retenue
 *   - la plateforme garde la Protection acheteurs et supporte les frais Stripe
 *
 * Le point délicat, et la raison d'être de ce calcul : les frais Stripe
 * portent sur le TOTAL encaissé (article + livraison + protection), alors que
 * la plateforme ne conserve que la protection. Plus les frais de livraison
 * sont élevés par rapport au prix de l'article, plus Stripe prélève sur une
 * assiette dont la plateforme ne garde rien.
 *
 * Tarifs Stripe France relevés sur stripe.com/fr/pricing le 13/08/2026 :
 *   carte standard EEE   1,50 % + 0,25 €
 *   carte premium EEE    2,80 % + 0,25 €
 *   carte hors EEE       3,15 % + 0,25 €   (la Suisse est dans les pays livrés)
 *   litige reçu          20,00 €
 *
 * Tout est calculé en centimes entiers : aucun flottant ne décide d'un montant.
 */

/* --- Règles tarifaires, version 1 ---------------------------------------- */
const PROTECTION_RATE_BPS = 500;   // 5,00 % en points de base
const PROTECTION_FIXED_CENTS = 70; // 0,70 €

/** Frais de Protection acheteurs, en centimes. Arrondi au centime supérieur
 *  pour la part variable : on ne facture jamais moins que la règle annoncée. */
export function protectionFeeCents(priceCents) {
  return Math.round((priceCents * PROTECTION_RATE_BPS) / 10000) + PROTECTION_FIXED_CENTS;
}

const STRIPE = {
  "standard EEE": { bps: 150, fixed: 25 },
  "premium EEE": { bps: 280, fixed: 25 },
  "hors EEE": { bps: 315, fixed: 25 },
};

function stripeFeeCents(totalCents, tier) {
  const t = STRIPE[tier];
  return Math.round((totalCents * t.bps) / 10000) + t.fixed;
}

/* Frais Stripe Connect, relevés sur stripe.com/fr/connect/pricing le
 * 13/08/2026, modèle « vous gérez les tarifs » :
 *   - 0,25 % + 0,10 € par virement vers le compte connecté
 *   - 2,00 € par mois et par compte connecté actif (un mois où un virement part)
 *
 * Le second est un coût par VENDEUR et par MOIS, pas par commande. Il ne peut
 * donc pas être imputé à une transaction isolée : on l'amortit sur le nombre
 * de ventes que le vendeur réalise dans le mois. Un vendeur qui ne vend qu'une
 * fois porte les 2 € à lui seul. */
const CONNECT_PAYOUT_BPS = 25;
const CONNECT_PAYOUT_FIXED = 10;
const CONNECT_ACTIVE_ACCOUNT_MONTHLY = 200;

function connectPayoutFeeCents(sellerAmountCents) {
  return Math.round((sellerAmountCents * CONNECT_PAYOUT_BPS) / 10000) + CONNECT_PAYOUT_FIXED;
}

const euro = (cents) => (cents / 100).toFixed(2).replace(".", ",").padStart(8) + " €";

/* --- Scénarios ------------------------------------------------------------ */
const PRICES = [100, 500, 1000, 2500, 4500, 10000, 50000];
const SHIPPING = [
  ["remise en main propre", 0],
  ["point relais", 490],
  ["envoi postal", 890],
];

console.log("MODÈLE : acheteur = article + livraison + protection · vendeur = article + livraison (100 %)");
console.log("Protection acheteurs = 5 % du prix + 0,70 €\n");

const negatives = [];

for (const [shipLabel, ship] of SHIPPING) {
  console.log("─".repeat(104));
  console.log(`LIVRAISON : ${shipLabel} (${euro(ship).trim()})`);
  console.log("─".repeat(104));
  console.log(
    "article".padStart(9), "protection".padStart(11), "payé".padStart(10),
    "vendeur".padStart(10), "|", "net std".padStart(9), "net prem.".padStart(10),
    "net h.EEE".padStart(10), "|", "1 vente/mois".padStart(13),
  );

  for (const price of PRICES) {
    const protection = protectionFeeCents(price);
    const total = price + ship + protection;
    const sellerAmount = price + ship;
    const payoutFee = connectPayoutFeeCents(sellerAmount);

    // Marge par commande, frais de virement Connect inclus.
    const nets = Object.keys(STRIPE).map(
      (tier) => protection - stripeFeeCents(total, tier) - payoutFee);
    const [std, premium, intl] = nets;

    // Pire cas réaliste : le vendeur ne vend qu'une fois dans le mois et porte
    // seul les 2 € de compte actif.
    const soloSeller = std - CONNECT_ACTIVE_ACCOUNT_MONTHLY;

    for (const [i, tier] of Object.keys(STRIPE).entries()) {
      if (nets[i] <= 0) negatives.push({ price, ship, shipLabel, tier, net: nets[i], cause: "frais par transaction" });
    }
    if (soloSeller <= 0) {
      negatives.push({ price, ship, shipLabel, tier: "standard EEE, vendeur à 1 vente/mois", net: soloSeller, cause: "compte actif Connect" });
    }

    console.log(
      euro(price), euro(protection), euro(total), euro(sellerAmount),
      "|", euro(std), euro(premium), euro(intl),
      "|", euro(soloSeller),
    );
  }
  console.log();
}

/* --- Verdict -------------------------------------------------------------- */
console.log("═".repeat(104));
if (negatives.length === 0) {
  console.log("AUCUNE combinaison déficitaire sur les scénarios testés.");
} else {
  console.log(`${negatives.length} COMBINAISON(S) DÉFICITAIRE(S) :`);
  for (const n of negatives) {
    console.log(`  article ${euro(n.price).trim()} + ${n.shipLabel}, carte ${n.tier} → ${euro(n.net).trim()}`);
  }
}

/* --- Seuil de rentabilité par vendeur ------------------------------------ */
console.log("\nNombre de ventes mensuelles nécessaires pour absorber les 2 € de compte actif Connect");
console.log("(carte standard EEE, envoi postal 8,90 €) :");
for (const price of PRICES) {
  const protection = protectionFeeCents(price);
  const total = price + 890 + protection;
  const net = protection - stripeFeeCents(total, "standard EEE") - connectPayoutFeeCents(price + 890);
  const needed = net > 0 ? Math.ceil(CONNECT_ACTIVE_ACCOUNT_MONTHLY / net) + 1 : Infinity;
  console.log("  article " + euro(price).trim().padStart(9) + " → marge/commande " + euro(net).trim().padStart(8) +
    " → " + (needed === Infinity ? "jamais rentable" : needed + " vente(s)/mois du MÊME vendeur"));
}

console.log("\nExposition maximale par commande (remboursement ou litige après versement) :");
for (const price of [100, 4500, 50000]) {
  const protection = protectionFeeCents(price);
  const total = price + 890 + protection;
  console.log("  article " + euro(price).trim() + " + envoi postal : " + euro(total).trim() +
    " à récupérer chez le vendeur, + 20,00 € de frais si litige bancaire");
}
