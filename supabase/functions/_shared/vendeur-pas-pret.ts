/**
 * Ventes conclues chez un vendeur dont le compte de paiement n'est pas prêt.
 *
 * Décision du 10 octobre 2026 : l'achat est accepté même si le vendeur n'a
 * pas terminé son inscription Stripe. L'argent reste sur le compte de la
 * plateforme, comme pour toute vente (paiements et transferts distincts), et
 * le vendeur a 7 jours après le paiement pour finaliser son inscription.
 * Passé ce délai, la commande est annulée et l'acheteur remboursé en entier.
 *
 * La base porte les décisions et l'idempotence (migration
 * 20261010000000_vendeur_pas_pret.sql) :
 *   - l'échéance est posée au paiement par un déclencheur ;
 *   - la reprise, quand le vendeur devient prêt, par un déclencheur sur
 *     profiles ;
 *   - l'annulation est décidée une seule fois, sous verrou, par
 *     order_seller_not_ready_cancel_claim ;
 *   - chaque courriel est réservé dans order_notifications avant de partir.
 *
 * Ce module fait ce que la base ne peut pas faire : appeler Stripe pour
 * rembourser, relire un compte vendeur, écrire aux gens. Il est appelé toutes
 * les heures par payout-release, que la tâche pg_cron « payout-release »
 * déclenche déjà : aucune tâche planifiée de plus.
 *
 * Les dépendances sont injectées, comme dans fulfillment.ts et connect.ts,
 * pour que tout soit testable sous Node sans réseau
 * (tests/vendeur-pas-pret.test.ts).
 */

import { formatEuroCents, logEvent, redactSecrets, REGLAGES_VENDEUR_PAS_PRET } from "./payments.ts";

/** Délais annoncés dans les textes. Ce sont ceux de la base
 *  (platform_settings) : tests/db-vendeur-pas-pret.test.ts compare. */
const JOURS_OUVRES = REGLAGES_VENDEUR_PAS_PRET.joursOuvresExpedition;

type Loose = Record<string, unknown>;
type ErreurBase = { message?: string } | null;

/** Où le vendeur termine son inscription : Mon compte, rubrique Paramètres. */
export const LIEN_INSCRIPTION_PAIEMENT = "https://www.athenamilitaria.fr/account?tab=my-settings";
export const LIEN_MON_COMPTE = "https://www.athenamilitaria.fr/account";

/** Événements de order_notifications. Les noms sont aussi écrits dans la
 *  migration (orders_seller_ready_queue) : les deux doivent rester d'accord. */
export const EVENEMENTS = {
  relance_1: "vendeur_pas_pret_relance_1",
  relance_2: "vendeur_pas_pret_relance_2",
  annulationAcheteur: "vendeur_pas_pret_annulation_acheteur",
  annulationVendeur: "vendeur_pas_pret_annulation_vendeur",
  repriseAcheteur: "vendeur_pret_reprise_acheteur",
  repriseVendeur: "vendeur_pret_reprise_vendeur",
} as const;

/* ------------------------------------------------------------------ *
 *  Typographie et dates
 * ------------------------------------------------------------------ */

/**
 * Espaces insécables du français : avant « : ; ? ! », et à l'intérieur des
 * guillemets. Appliquée au texte fini plutôt qu'écrite à la main dans chaque
 * phrase : une espace ordinaire oubliée devant un deux-points est invisible à
 * la relecture, et coupe la ligne au mauvais endroit dans la boîte de
 * réception.
 */
export function typographie(texte: string): string {
  return texte
    .replace(/ ([:;?!])/g, " $1")
    .replace(/« /g, "« ")
    .replace(/ »/g, " »");
}

function partiesParis(iso: string, options: Intl.DateTimeFormatOptions): Record<string, string> | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parties: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", ...options }).formatToParts(date)) {
    parties[p.type] = p.value;
  }
  return parties;
}

/** « samedi 17 octobre 2026 à 14 h 05 », à l'heure de Paris. L'heure compte :
 *  l'échéance tombe à l'heure exacte du paiement, sept jours plus tard. */
export function formatEcheance(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = partiesParis(iso, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  if (!p) return "";
  return `${p.weekday} ${p.day} ${p.month} ${p.year} à ${p.hour} h ${p.minute}`;
}

/** « 17 octobre 2026 », à l'heure de Paris. */
export function formatDateCourte(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = partiesParis(iso, { day: "numeric", month: "long", year: "numeric" });
  return p ? `${p.day} ${p.month} ${p.year}` : "";
}

/* ------------------------------------------------------------------ *
 *  État d'une commande
 * ------------------------------------------------------------------ */

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** La commande attend-elle encore le compte du vendeur ? Vrai tant que ni la
 *  reprise ni l'annulation n'ont eu lieu. */
export function enAttenteDuVendeur(order: Loose | null | undefined): boolean {
  if (!order) return false;
  return str(order.seller_ready_deadline_at) !== null
    && !str(order.seller_ready_at)
    && !str(order.seller_ready_cancel_at)
    && !str(order.seller_ready_refunded_at);
}

/** Ce que la page de confirmation peut dire à l'acheteur. */
export function etatVendeurPourAcheteur(order: Loose | null | undefined):
  { attente: boolean; echeance: string | null; echeanceTexte: string | null } {
  if (!enAttenteDuVendeur(order)) return { attente: false, echeance: null, echeanceTexte: null };
  const echeance = str(order!.seller_ready_deadline_at);
  return { attente: true, echeance, echeanceTexte: formatEcheance(echeance) };
}

/** Le remboursement de cette commande est-il celui de l'annulation
 *  automatique ? Le webhook s'en sert pour ne pas envoyer à l'acheteur un
 *  second courriel, moins clair, en plus de celui qui explique l'annulation. */
export function remboursementDeLAnnulationAutomatique(order: Loose | null | undefined): boolean {
  return Boolean(order && str(order.seller_ready_cancel_at));
}

/* ------------------------------------------------------------------ *
 *  Textes des courriels
 *
 *  Vouvoiement, pas de tiret cadratin, espaces insécables. Chaque phrase dit
 *  ce que fait le code, rien de plus : l'échéance, le remboursement intégral
 *  et la remise en vente sont exactement ce que font la migration et
 *  traiterVendeursPasPrets.
 * ------------------------------------------------------------------ */

export type Courriel = { sujet: string; corps: string };

/** Paragraphe de la confirmation d'achat quand le vendeur n'est pas prêt. */
export function paragrapheAcheteurAttente(echeanceIso: string): string {
  return typographie(
    `Le vendeur doit encore finaliser son inscription auprès de Stripe, notre prestataire de paiement, ` +
    `pour pouvoir recevoir l'argent de cette vente. Il a été prévenu. Dès que ce sera fait, il disposera ` +
    `de ${JOURS_OUVRES} jours ouvrés pour expédier votre commande, et nous vous écrirons.\n\n` +
    `S'il ne l'a pas fait le ${formatEcheance(echeanceIso)}, votre commande sera annulée et intégralement ` +
    `remboursée (prix de l'article, frais de livraison et Protection acheteurs), automatiquement, sans ` +
    `démarche de votre part. D'ici là, votre paiement reste sur le compte d'Athena Militaria : rien n'est ` +
    `versé au vendeur.`,
  );
}

/** Paragraphe du courriel de nouvelle vente quand le vendeur n'est pas prêt. */
export function paragrapheVendeurAttente(echeanceIso: string): string {
  return typographie(
    `IMPORTANT : pour recevoir cet argent, finalisez votre inscription au paiement (Stripe) depuis ` +
    `Mon compte, rubrique Paramètres :\n${LIEN_INSCRIPTION_PAIEMENT}\n\n` +
    `Tant que votre inscription n'est pas terminée, vous ne pouvez pas déclarer l'expédition : ` +
    `n'expédiez pas encore l'article. Une fois votre compte prêt, vous disposerez de ${JOURS_OUVRES} jours ouvrés ` +
    `pour expédier et renseigner le numéro de suivi depuis Mon compte, rubrique Mes ventes.\n\n` +
    `Si votre inscription n'est pas terminée le ${formatEcheance(echeanceIso)}, la commande sera ` +
    `annulée automatiquement et l'acheteur intégralement remboursé.`,
  );
}

type Ligne = Loose;

function reference(ligne: Ligne): string {
  return String(ligne.order_id ?? ligne.id ?? "").slice(0, 8).toUpperCase();
}

function titre(ligne: Ligne): string {
  return str(ligne.product_title) ?? "Article";
}

export function courrielRelance(ligne: Ligne, etape: "relance_1" | "relance_2"): Courriel {
  const echeance = formatEcheance(str(ligne.seller_ready_deadline_at));
  const montant = formatEuroCents(ligne.seller_amount_cents as number | null);
  const sujet = etape === "relance_2"
    ? `Dernier rappel : sans inscription terminée, votre vente ${reference(ligne)} sera annulée le ` +
      `${formatDateCourte(str(ligne.seller_ready_deadline_at))}`
    : `Rappel : finalisez votre inscription pour recevoir ${montant}`;
  const corps =
    `Bonjour,\n\n` +
    `Votre article « ${titre(ligne)} » a été vendu (commande ${reference(ligne)}), mais votre inscription ` +
    `au paiement (Stripe) n'est pas encore terminée. Sans elle, les ${montant} de cette vente ne peuvent ` +
    `pas vous être versés, et vous ne pouvez pas déclarer l'expédition.\n\n` +
    `Finalisez-la depuis Mon compte, rubrique Paramètres :\n${LIEN_INSCRIPTION_PAIEMENT}\n\n` +
    `Échéance : ${echeance}. Passé ce moment, la commande sera annulée automatiquement et l'acheteur ` +
    `intégralement remboursé.\n\n` +
    `Une fois votre compte prêt, vous disposerez de ${JOURS_OUVRES} jours ouvrés pour expédier.\n\n` +
    `Athena Militaria`;
  return { sujet: typographie(sujet), corps: typographie(corps) };
}

export function courrielAnnulationAcheteur(ligne: Ligne): Courriel {
  const total = formatEuroCents(ligne.amount_total_cents as number | null);
  const corps =
    `Bonjour,\n\n` +
    `Le vendeur de « ${titre(ligne)} » n'a pas finalisé son inscription au paiement dans le délai prévu. ` +
    `Comme annoncé lors de votre achat, votre commande ${reference(ligne)} est annulée et intégralement ` +
    `remboursée : ${total}.\n\n` +
    `Prix de l'article : ${formatEuroCents(ligne.product_amount_cents as number | null)}\n` +
    `Frais de livraison : ${formatEuroCents(ligne.shipping_amount_cents as number | null)}\n` +
    `Protection acheteurs : ${formatEuroCents(ligne.protection_fee_cents as number | null)}\n\n` +
    `Le montant réapparaîtra sur votre moyen de paiement sous cinq à dix jours ouvrés, selon votre banque. ` +
    `Vous n'avez rien à faire.\n\n` +
    `Nous sommes désolés pour ce contretemps.\nAthena Militaria`;
  return {
    sujet: typographie(`Commande ${reference(ligne)} annulée et remboursée`),
    corps: typographie(corps),
  };
}

export function courrielAnnulationVendeur(ligne: Ligne): Courriel {
  const corps =
    `Bonjour,\n\n` +
    `Votre inscription au paiement (Stripe) n'était pas terminée le ` +
    `${formatEcheance(str(ligne.seller_ready_deadline_at))}. Comme annoncé, la commande ` +
    `${reference(ligne)} (« ${titre(ligne)} ») est annulée et l'acheteur est intégralement remboursé. ` +
    `N'expédiez pas l'article.\n\n` +
    // order_apply_refund rend l'exemplaire à l'annonce, mais ne la republie
    // que si elle était marquée vendue : une annonce retirée entre-temps le
    // reste. D'où la réserve.
    `L'exemplaire vendu est rendu à votre annonce, qui redevient visible si elle était marquée vendue ` +
    `(une annonce que vous aviez retirée entre-temps le reste). Vous pouvez la modifier ou la retirer ` +
    `depuis Mon compte, rubrique Mes annonces.\n\n` +
    `Pour vos prochaines ventes, finalisez votre inscription depuis Mon compte, rubrique Paramètres :\n` +
    `${LIEN_INSCRIPTION_PAIEMENT}\n\nAthena Militaria`;
  return {
    sujet: typographie(`Vente ${reference(ligne)} annulée : inscription au paiement non terminée`),
    corps: typographie(corps),
  };
}

export function courrielRepriseVendeur(ligne: Ligne): Courriel {
  const limite = formatEcheance(str(ligne.ship_deadline_at));
  const corps =
    `Bonjour,\n\n` +
    `Votre compte de paiement est prêt. La commande ${reference(ligne)} (« ${titre(ligne)} ») reprend ` +
    `son cours : vous pouvez maintenant expédier l'article et renseigner le numéro de suivi depuis ` +
    `Mon compte, rubrique Mes ventes` + (limite ? `, au plus tard le ${limite}` : "") + `.\n\n` +
    `Le versement partira automatiquement après que l'acheteur aura confirmé la réception, puis passé ` +
    `un délai de 48 heures.\n\n${LIEN_MON_COMPTE}\n\nAthena Militaria`;
  return {
    sujet: typographie(`Vous pouvez expédier la commande ${reference(ligne)}`),
    corps: typographie(corps),
  };
}

export function courrielRepriseAcheteur(ligne: Ligne): Courriel {
  const limite = formatDateCourte(str(ligne.ship_deadline_at));
  const corps =
    `Bonjour,\n\n` +
    `Le vendeur a finalisé son inscription au paiement : votre commande ${reference(ligne)} ` +
    `(« ${titre(ligne)} ») suit son cours, et elle ne sera pas annulée pour ce motif. ` +
    `Il doit maintenant l'expédier` + (limite ? ` (au plus tard le ${limite})` : "") + `.\n\n` +
    `Votre paiement n'est versé au vendeur qu'après votre confirmation de réception. Dès que vous aurez ` +
    `reçu l'article, confirmez-le depuis Mon compte, rubrique Mes achats.\n\nAthena Militaria`;
  return {
    sujet: typographie(`Votre commande ${reference(ligne)} suit son cours`),
    corps: typographie(corps),
  };
}

/* ------------------------------------------------------------------ *
 *  Traitement horaire
 * ------------------------------------------------------------------ */

export interface StripeRemboursementLike {
  refunds: {
    create(params: Loose, options: { idempotencyKey: string }): Promise<Loose>;
  };
}

export interface VendeursPasPretsDeps {
  rpc(name: string, args: Loose): Promise<{ data: unknown; error: ErreurBase }>;
  stripe: StripeRemboursementLike;
  /** Relit le compte du vendeur chez Stripe et aligne le profil (ce qui
   *  déclenche la reprise en base s'il est prêt). Vrai si le compte est prêt.
   *  Lève si Stripe ne répond pas. */
  relireVendeur(sellerId: string, accountId: string, onboarded: boolean): Promise<boolean>;
  /** Adresse d'un utilisateur. null s'il n'en a pas ; lève si la lecture
   *  échoue, pour que la notification soit retentée. */
  emailUtilisateur(userId: string): Promise<string | null>;
  /** Vrai si le courriel est parti. */
  envoyer(to: string, subject: string, body: string): Promise<boolean>;
  journal?: (scope: string, fields: Record<string, unknown>) => void;
  limite?: number;
}

export type BilanVendeursPasPrets = {
  examinees: number;
  relances: number;
  annulations: number;
  reprises: number;
  courriels: number;
  echecs: number;
  /** Lignes lisibles pour le courriel à l'exploitant. */
  rapport: string[];
};

/**
 * Clé d'idempotence du remboursement.
 *
 * Tant qu'aucun essai n'a échoué, une seule clé par commande : un appel
 * rejoué avant la fin de l'écriture en base retombe sur le même
 * remboursement. Après chaque échec enregistré, la clé change
 * (…:1, …:2) : Stripe garde 24 h la réponse d'une clé, refus compris, et
 * sans ce changement les passages suivants rejoueraient le même refus au lieu
 * de retenter. Changer de clé ne peut pas faire rembourser deux fois : le
 * remboursement est demandé sans montant, il solde la charge, et une charge
 * soldée est refusée par Stripe (charge_already_refunded, traité comme un
 * succès plus bas).
 */
export function cleRemboursement(orderId: string, tentativesEchouees = 0): string {
  return tentativesEchouees > 0 ? `vendeur-pas-pret:${orderId}:${tentativesEchouees}` : `vendeur-pas-pret:${orderId}`;
}

/** Codes écrits en base (orders.seller_ready_last_error). Neutres : la
 *  colonne est lisible par l'acheteur et le vendeur. Le détail Stripe va au
 *  journal et au courriel de l'exploitant. */
export const CODES_ECHEC = {
  refus: "refund_failed",
  nonAbouti: "refund_not_succeeded",
  sansPaiement: "no_payment",
} as const;

/** Alerter l'exploitant au premier échec, puis une fois par jour : le
 *  remboursement est retenté toutes les heures, et payments-monitor signale
 *  de son côté une annulation non remboursée au-delà de deux heures. */
export function alerterApresEchec(tentativesEchouees: number): boolean {
  return tentativesEchouees <= 1 || tentativesEchouees % 24 === 0;
}

export async function traiterVendeursPasPrets(deps: VendeursPasPretsDeps): Promise<BilanVendeursPasPrets> {
  const journal = deps.journal ?? logEvent;
  const bilan: BilanVendeursPasPrets = {
    examinees: 0, relances: 0, annulations: 0, reprises: 0, courriels: 0, echecs: 0, rapport: [],
  };

  const { data, error } = await deps.rpc("orders_seller_ready_queue", { p_limit: deps.limite ?? 50 });
  if (error) throw new Error(`orders_seller_ready_queue: ${error.message ?? "erreur inconnue"}`);
  const lignes = (Array.isArray(data) ? data : []) as Ligne[];
  bilan.examinees = lignes.length;

  /** Réserve l'événement, envoie, rend la réservation si l'envoi échoue.
   *  Un destinataire absent consomme la réservation : il n'y a personne à
   *  qui écrire, et retenter toutes les heures n'y changerait rien. */
  const notifier = async (ligne: Ligne, evenement: string, destinataire: () => Promise<string | null>,
    courriel: Courriel): Promise<void> => {
    const orderId = String(ligne.order_id);
    const { data: pris, error: claimError } = await deps.rpc("order_notification_claim", {
      p_order_id: orderId, p_event: evenement,
    });
    if (claimError) throw new Error(`order_notification_claim: ${claimError.message ?? "?"}`);
    if (pris !== true) return;

    let parti = false;
    try {
      const to = await destinataire();
      if (!to) {
        journal("seller_ready_mail_no_recipient", { order_id: orderId, event: evenement });
        return;
      }
      parti = await deps.envoyer(to, courriel.sujet, courriel.corps);
      if (parti) bilan.courriels++;
    } catch (err) {
      journal("seller_ready_mail_error", {
        order_id: orderId, event: evenement, message: redactSecrets((err as Error)?.message ?? String(err)),
      });
    }
    if (!parti) {
      await deps.rpc("order_notification_release", { p_order_id: orderId, p_event: evenement });
      // Un destinataire absent a consommé la réservation plus haut (return) :
      // on n'arrive ici que sur un envoi raté, à retenter.
      bilan.echecs++;
    }
  };

  const vendeur = (ligne: Ligne) => async () =>
    ligne.seller_id ? await deps.emailUtilisateur(String(ligne.seller_id)) : null;
  const acheteur = (ligne: Ligne) => async () => {
    const direct = str(ligne.customer_email);
    if (direct) return direct;
    return ligne.buyer_id ? await deps.emailUtilisateur(String(ligne.buyer_id)) : null;
  };

  const annoncerAnnulation = async (ligne: Ligne) => {
    await notifier(ligne, EVENEMENTS.annulationAcheteur, acheteur(ligne), courrielAnnulationAcheteur(ligne));
    await notifier(ligne, EVENEMENTS.annulationVendeur, vendeur(ligne), courrielAnnulationVendeur(ligne));
  };

  const annoncerReprise = async (ligne: Ligne) => {
    await notifier(ligne, EVENEMENTS.repriseVendeur, vendeur(ligne), courrielRepriseVendeur(ligne));
    await notifier(ligne, EVENEMENTS.repriseAcheteur, acheteur(ligne), courrielRepriseAcheteur(ligne));
  };

  /** Décide sous verrou en base. Renvoie la décision et la commande à jour. */
  const reclamer = async (orderId: string): Promise<{ decision: string; order: Loose; motif?: string }> => {
    const { data: r, error: e } = await deps.rpc("order_seller_not_ready_cancel_claim", { p_order_id: orderId });
    if (e) throw new Error(`order_seller_not_ready_cancel_claim: ${e.message ?? "?"}`);
    const res = (r ?? {}) as Loose;
    return { decision: String(res.decision ?? "hors_champ"), order: (res.order ?? {}) as Loose, motif: str(res.motif) ?? undefined };
  };

  /** Note l'échec en base (code neutre, compteur de tentatives) et
   *  n'ajoute une ligne au rapport de l'exploitant qu'au premier échec puis
   *  une fois par jour. */
  const echec = async (ligne: Ligne, code: string, detail: string): Promise<void> => {
    const orderId = String(ligne.order_id);
    const { data: n } = await deps.rpc("order_seller_not_ready_cancel_failed", { p_order_id: orderId, p_code: code });
    const tentatives = Number(n ?? 1) || 1;
    journal("seller_ready_refund_failed", { order_id: orderId, code, tentatives, message: detail });
    bilan.echecs++;
    if (alerterApresEchec(tentatives)) {
      bilan.rapport.push(`Commande ${reference(ligne)} : remboursement automatique en échec ` +
        `(tentative ${tentatives}, ${detail}). Nouvel essai au prochain passage horaire, avec une ` +
        `nouvelle clé d'idempotence.`);
    }
  };

  /** Rembourse en entier puis enregistre. Rejouable : même clé
   *  d'idempotence chez Stripe tant qu'aucun échec n'est noté, et un
   *  remboursement déjà constaté en base n'est pas redemandé. */
  const rembourser = async (ligne: Ligne, order: Loose): Promise<boolean> => {
    const orderId = String(ligne.order_id);
    const total = Number(order.stripe_amount_total_cents ?? order.amount_total_cents ?? ligne.amount_total_cents ?? 0);
    const dejaRembourse = Number(order.amount_refunded_cents ?? 0);
    const tentatives = Number(order.seller_ready_refund_attempts ?? 0) || 0;
    let refundId: string | null = null;
    // Le CUMUL remboursé, comme charge.amount_refunded que lit le webhook :
    // un remboursement sans montant solde la charge.
    let cumul = total;

    if (!(total > 0 && dejaRembourse >= total)) {
      const intent = str(order.stripe_payment_intent_id) ?? str(ligne.stripe_payment_intent_id);
      const charge = str(order.stripe_charge_id) ?? str(ligne.stripe_charge_id);
      if (!intent && !charge) {
        await echec(ligne, CODES_ECHEC.sansPaiement, "aucun paiement Stripe rattaché, remboursement à faire à la main");
        return false;
      }
      try {
        // Sans montant : Stripe rembourse tout ce qui reste sur la charge,
        // c'est-à-dire prix, port et Protection acheteurs. Pas de « reason » :
        // Stripe n'accepte que duplicate, fraudulent ou requested_by_customer,
        // et l'acheteur n'a rien demandé ; le motif est dans metadata.
        const refund = await deps.stripe.refunds.create({
          ...(intent ? { payment_intent: intent } : { charge }),
          metadata: { order_id: orderId, motif: "vendeur_pas_pret" },
        }, { idempotencyKey: cleRemboursement(orderId, tentatives) });
        const statut = str(refund.status);
        if (statut === "failed" || statut === "canceled") {
          // Créé mais refusé d'emblée : ce n'est pas un remboursement.
          // Rien n'est enregistré, personne n'est prévenu à tort.
          await echec(ligne, CODES_ECHEC.nonAbouti,
            `remboursement ${str(refund.id) ?? "?"} au statut ${statut}` +
            (str(refund.failure_reason) ? ` (${str(refund.failure_reason)})` : ""));
          return false;
        }
        refundId = str(refund.id);
        const montant = Number(refund.amount);
        if (Number.isFinite(montant) && montant > 0) cumul = Math.max(total, dejaRembourse + montant);
      } catch (err) {
        const e = err as Loose;
        const code = str(e?.code) ?? str((e?.raw as Loose | undefined)?.code);
        if (code !== "charge_already_refunded") {
          await echec(ligne, CODES_ECHEC.refus, redactSecrets((err as Error)?.message ?? String(err)));
          return false;
        }
        // Déjà soldée chez Stripe (essai précédent dont la réponse s'est
        // perdue, ou remboursement depuis le tableau de bord) : on enregistre.
      }
    }

    const { error: e } = await deps.rpc("order_seller_not_ready_cancel_complete", {
      p_order_id: orderId, p_refund_id: refundId, p_refunded_cents: cumul,
    });
    if (e) {
      // Le remboursement existe chez Stripe : le prochain passage retombe sur
      // la même clé d'idempotence (rien n'a été noté en échec), et le webhook
      // charge.refunded l'enregistre de son côté. Rien n'est perdu, mais on
      // le dit.
      journal("seller_ready_refund_record_failed", { order_id: orderId, refund_id: refundId, message: e.message });
      bilan.echecs++;
      bilan.rapport.push(`Commande ${reference(ligne)} : remboursement ${refundId ?? "?"} créé chez Stripe, ` +
        `écriture en base échouée (${e.message ?? "?"}). Nouvel essai au prochain passage horaire.`);
      return false;
    }

    bilan.annulations++;
    journal("seller_ready_order_canceled", { order_id: orderId, refund_id: refundId, amount_cents: cumul });
    bilan.rapport.push(`Commande ${reference(ligne)} annulée et remboursée (${formatEuroCents(cumul)}) : ` +
      `vendeur ${String(ligne.seller_id ?? "?").slice(0, 8).toUpperCase()} non inscrit au paiement à l'échéance.`);
    return true;
  };

  for (const ligne of lignes) {
    const orderId = String(ligne.order_id);
    const phase = String(ligne.phase);
    try {
      if (phase === "attente") {
        /** Fait constater la reprise par la base. Vrai si elle a eu lieu
         *  (décision « pret », ou seller_ready_at déjà posé par le
         *  déclencheur de profiles) ; les courriels de reprise partent alors. */
        const reprendre = async (): Promise<boolean> => {
          const { decision, order } = await reclamer(orderId);
          if (decision === "pret" || str(order.seller_ready_at)) {
            bilan.reprises++;
            await annoncerReprise({ ...ligne, ...order, order_id: orderId, product_title: ligne.product_title });
            return true;
          }
          return false;
        };

        // Déjà prêt en base sans que la reprise ait été constatée (course
        // entre le paiement et le webhook Connect) : la base suffit, aucun
        // appel à Stripe. Sinon, une panne de Stripe aux passages de J+2, J+5
        // et de la dernière heure ferait annuler la vente d'un vendeur prêt
        // depuis le premier jour.
        if (str(ligne.seller_account_id) && ligne.seller_onboarded === true) {
          if (await reprendre()) continue;
        } else if (str(ligne.seller_account_id)) {
          // Avant l'échéance : on relit le compte chez Stripe, pour ne pas
          // relancer un vendeur déjà prêt, et pour qu'un webhook perdu ne
          // fasse pas annuler la commande d'un vendeur qui a bien fini à temps.
          try {
            const pret = await deps.relireVendeur(
              String(ligne.seller_id), String(ligne.seller_account_id), ligne.seller_onboarded === true);
            // La relecture a aligné le profil, et le déclencheur de profiles a
            // pu faire reprendre la commande. On ne saute la relance que si la
            // reprise est effective : si l'écriture du profil n'a pas eu lieu,
            // la relance due part quand même.
            if (pret && await reprendre()) continue;
          } catch (err) {
            journal("seller_ready_account_unreadable", {
              order_id: orderId, seller_id: ligne.seller_id,
              message: redactSecrets((err as Error)?.message ?? String(err)),
            });
          }
        }
        const etape = ligne.relance === "relance_2" ? "relance_2" : ligne.relance === "relance_1" ? "relance_1" : null;
        if (etape) {
          const avant = bilan.courriels;
          await notifier(ligne, EVENEMENTS[etape], vendeur(ligne), courrielRelance(ligne, etape));
          if (bilan.courriels > avant) bilan.relances++;
        }
        continue;
      }

      if (phase === "echeance" || phase === "annulation") {
        const { decision, order, motif } = await reclamer(orderId);
        if (decision === "annuler") {
          if (await rembourser(ligne, order)) await annoncerAnnulation({ ...ligne, ...order, order_id: orderId, product_title: ligne.product_title });
        } else if (decision === "deja_rembourse") {
          await annoncerAnnulation({ ...ligne, ...order, order_id: orderId, product_title: ligne.product_title });
        } else if (decision === "pret") {
          bilan.reprises++;
          await annoncerReprise({ ...ligne, ...order, order_id: orderId, product_title: ligne.product_title });
        } else {
          journal("seller_ready_claim_skipped", { order_id: orderId, decision, motif: motif ?? null });
          if (decision === "hors_champ") {
            bilan.rapport.push(`Commande ${reference(ligne)} : échéance passée mais pas d'annulation ` +
              `automatique (${motif ?? "?"}). À regarder.`);
          }
        }
        continue;
      }

      if (phase === "annulee") {
        await annoncerAnnulation(ligne);
        continue;
      }

      if (phase === "reprise") {
        await annoncerReprise(ligne);
        continue;
      }
    } catch (err) {
      bilan.echecs++;
      const message = redactSecrets((err as Error)?.message ?? String(err));
      journal("seller_ready_row_failed", { order_id: orderId, phase, message });
      bilan.rapport.push(`Commande ${reference(ligne)} (${phase}) : ${message}`);
    }
  }

  journal("seller_ready_batch", {
    examinees: bilan.examinees, relances: bilan.relances, annulations: bilan.annulations,
    reprises: bilan.reprises, courriels: bilan.courriels, echecs: bilan.echecs,
  });
  return bilan;
}
