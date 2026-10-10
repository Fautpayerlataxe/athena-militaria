/**
 * Point d'entrée unique du traitement d'un paiement.
 *
 * Le webhook Stripe et la page de confirmation appellent tous les deux cette
 * fonction, avec le même identifiant de session. C'est voulu : Stripe
 * recommande explicitement de déclencher le traitement des deux côtés, parce
 * qu'un webhook peut être retardé et qu'un acheteur peut fermer son navigateur
 * avant la redirection. Le chemin étant unique et idempotent, être appelé deux
 * fois, ou dix, ne produit qu'un seul encaissement, un seul décrément de stock
 * et un seul email.
 *
 * L'état vient toujours de Stripe, jamais du navigateur ni de la charge utile
 * de l'événement : on relit la session avant de décider. Un événement rejoué
 * trois jours plus tard ne peut donc pas réaffirmer un état périmé.
 *
 * Les dépendances sont injectées pour que la totalité de cette logique soit
 * testable sous Node sans réseau (voir tests/fulfillment.test.ts).
 */

import { buildShippingAddress, logEvent, redactSecrets, shippingLabel } from "./payments.ts";
import {
  abreger,
  corpsMembre,
  DELAIS,
  formatEcheance,
  LIEN_MES_ACHATS,
  LIEN_MES_VENTES,
  lienMessagerie,
  montant,
  nomDuPays,
  typographie,
} from "./courriels.ts";
import { enAttenteDuVendeur, paragrapheAcheteurAttente, paragrapheVendeurAttente } from "./vendeur-pas-pret.ts";

type Loose = Record<string, unknown>;

export interface StripeLike {
  checkout: {
    sessions: {
      retrieve(id: string, params?: Loose): Promise<Loose>;
    };
  };
}

export interface DbResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

export interface DbLike {
  rpc(name: string, args: Loose): Promise<DbResult<unknown>>;
  productTitle(productId: unknown): Promise<{ title: string | null; sellerId: string | null }>;
  sellerEmail(sellerId: string): Promise<string | null>;
}

export type Mailer = (to: string, subject: string, body: string) => Promise<void>;

export interface FulfillDeps {
  stripe: StripeLike;
  db: DbLike;
  sendEmail: Mailer;
  /** Permet d'écrire les emails hors du chemin critique du webhook : Stripe
   *  n'attend que quelques secondes, et Checkout retarde la redirection de
   *  l'acheteur tant que l'endpoint n'a pas répondu. */
  defer?: (task: Promise<unknown>) => void;
}

export interface FulfillOutcome {
  status: "fulfilled" | "pending_payment" | "not_paid";
  firstTime: boolean;
  order: Loose | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof (value as Loose).id === "string") {
    return (value as Loose).id as string;
  }
  return null;
}

export function chargeIdFrom(session: Loose): string | null {
  const intent = session.payment_intent;
  if (intent && typeof intent === "object") {
    const expanded = intent as Loose;
    const latest = idOf(expanded.latest_charge);
    if (latest) return latest;
    const charges = expanded.charges as Loose | undefined;
    const list = charges?.data;
    if (Array.isArray(list) && list.length > 0) return idOf(list[0]);
  }
  return null;
}

/** Construit la charge utile envoyée à order_settle_payment. Extraite pour
 *  être testable seule : c'est elle qui décide de ce que la base retiendra
 *  d'un paiement. */
export function settlePayloadFrom(session: Loose): Loose {
  const metadata = (session.metadata ?? {}) as Loose;
  const customer = (session.customer_details ?? {}) as Loose;
  const shippingMethod = str(metadata.shipping_method);
  const relayPostal = str(metadata.relay_postal);

  return {
    p_payload: {
      order_id: str(session.client_reference_id) ?? str(metadata.order_id),
      session_id: str(session.id),
      payment_intent_id: idOf(session.payment_intent),
      charge_id: chargeIdFrom(session),
      payment_status: str(session.payment_status) ?? "unpaid",
      amount_total_cents: Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : null,
      currency: str(session.currency) ?? "eur",
      customer_email: str(customer.email),
      product_id: str(metadata.product_id),
      seller_id: str(metadata.seller_id),
      buyer_id: str(metadata.buyer_id),
      shipping_method: shippingMethod,
      relay_postal: relayPostal,
      shipping_address: buildShippingAddress(session, shippingMethod, relayPostal),
    },
  };
}

export async function fulfillCheckoutSession(
  deps: FulfillDeps,
  sessionId: string,
): Promise<FulfillOutcome> {
  // On relit la session : la charge utile de l'événement est un instantané, et
  // la page de confirmation, elle, n'a qu'un identifiant fourni par le
  // navigateur. Dans les deux cas c'est Stripe qui fait foi.
  const session = await deps.stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });

  const paymentStatus = str(session.payment_status) ?? "unpaid";
  const args = settlePayloadFrom(session);

  const { data, error } = await deps.db.rpc("order_settle_payment", args);
  if (error) {
    // Remonter l'erreur est essentiel : c'est ce qui fait répondre 500 au
    // webhook, donc ce qui fait rejouer Stripe. L'ancienne version avalait
    // l'échec et répondait 200, ce qui perdait la commande définitivement.
    throw new Error(`order_settle_payment: ${error.message ?? "erreur inconnue"}`);
  }

  const result = (data ?? {}) as Loose;
  const order = (result.order ?? null) as Loose | null;
  const firstTime = result.first_time === true;

  logEvent("fulfillment", {
    session_id: sessionId,
    order_id: order?.id ?? null,
    payment_intent: order?.stripe_payment_intent_id ?? null,
    payment_status: paymentStatus,
    order_status: order?.status ?? null,
    first_time: firstTime,
    needs_review: order?.needs_review ?? false,
  });

  if (paymentStatus === "unpaid") {
    return { status: "pending_payment", firstTime: false, order };
  }

  if (firstTime && order) {
    // Les emails ne partent qu'au tout premier encaissement. Un rejeu de
    // webhook n'en renverra pas : first_time est décidé par la transition
    // d'état en base, pas par le nombre d'appels.
    const task = sendOrderEmails(deps, order).catch((err) => {
      logEvent("fulfillment_email_error", { order_id: order.id ?? null, message: String(err?.message ?? err) });
    });
    if (deps.defer) deps.defer(task);
    else await task;
  }

  return { status: "fulfilled", firstTime, order };
}

/** Titre d'annonce dans un objet de courriel : au-delà, la boîte de
 *  réception coupe au hasard, souvent avant ce qui compte. */
const TITRE_OBJET_MAX = 70;

/**
 * Les deux courriels du paiement : récapitulatif à l'acheteur, nouvelle vente
 * au vendeur. Chacun part dans son propre essai : une panne de Resend sur le
 * premier ne doit pas priver le vendeur du sien, alors que ses cinq jours
 * ouvrés courent déjà.
 */
export async function sendOrderEmails(deps: FulfillDeps, order: Loose): Promise<void> {
  const { title, sellerId } = await deps.db.productTitle(order.product_id);
  const productTitle = title ?? "Article";
  const titreObjet = abreger(productTitle, TITRE_OBJET_MAX);
  const methode = str(order.shipping_method);
  const label = shippingLabel(methode);
  const enMain = methode === "pickup";
  const relais = methode === "relay";
  const address = order.shipping_address as Loose | null;
  const reference = String(order.id ?? "").slice(0, 8).toUpperCase();
  const buyerEmail = str(order.customer_email);
  const seller = str(order.seller_id) ?? sellerId;
  const jours = DELAIS.joursOuvresExpedition;

  /* Adresse : complète pour un envoi postal ; pour un point relais, Stripe
   * ne collecte que le nom et le code postal du point souhaité, et c'est au
   * vendeur de choisir le Mondial Relay le plus proche (buildShippingAddress
   * le note dans address.note, que l'ancien texte perdait). En main propre,
   * aucune adresse : celle que Stripe aurait pu renvoyer est une adresse de
   * facturation, pas un lieu de remise. */
  const adressePostale = !enMain && !relais && address
    ? [
        str(address.name),
        str(address.line1),
        str(address.line2),
        [str(address.postal_code), str(address.city)].filter(Boolean).join(" ") || null,
        nomDuPays(str(address.country)),
      ].filter(Boolean).join("\n")
    : null;
  const nomRelais = relais && address ? str(address.name) : null;
  const codeRelais = relais && address ? str(address.postal_code) : null;

  // Vendeur dont le compte de paiement n'était pas prêt au moment du
  // paiement : la base a posé une échéance (seller_ready_deadline_at). Les
  // deux courriels le disent tout de suite, avec la date, au lieu du délai
  // d'expédition habituel que le vendeur ne peut pas encore tenir.
  const echeance = enAttenteDuVendeur(order) ? str(order.seller_ready_deadline_at) : null;

  const envoyer = async (qui: string, to: string, sujet: string, corps: string) => {
    try {
      await deps.sendEmail(to, sujet, corps);
    } catch (err) {
      logEvent("fulfillment_email_error", {
        order_id: order.id ?? null, destinataire: qui,
        message: redactSecrets((err as Error)?.message ?? String(err)),
      });
    }
  };

  if (buyerEmail) {
    const livraison = enMain
      ? `Livraison : ${label}` + (echeance ? `, date et lieu à convenir avec le vendeur par la messagerie du site.` : "")
      : relais
        ? `Livraison : ${label}\nCode postal du point relais souhaité : ${codeRelais ?? "non renseigné"}\n` +
          `Le vendeur choisira le point Mondial Relay le plus proche de ce code postal.`
        : `Livraison : ${label}\nAdresse de livraison :\n${adressePostale ?? "non renseignée"}`;
    const delai = echeance
      ? paragrapheAcheteurAttente(echeance, enMain)
      : enMain
        ? `Le vendeur a été prévenu. Convenez ensemble de la date et du lieu de la remise par la messagerie ` +
          `du site` + (seller ? ` :\n${lienMessagerie(seller, order.product_id)}` : `.`)
        : `Le vendeur a été prévenu et dispose de ${jours} jours ouvrés pour expédier votre commande.`;

    await envoyer("acheteur", buyerEmail,
      typographie(`Achat confirmé : « ${titreObjet} »`),
      corpsMembre([
        `Votre paiement a bien été reçu. Voici le récapitulatif de votre commande.`,
        `Commande : ${reference}\nArticle : ${productTitle}`,
        `Prix de l'article : ${montant(order.product_amount_cents as number | null)}\n` +
        `Frais de livraison : ${montant(order.shipping_amount_cents as number | null)}\n` +
        `Protection acheteurs : ${montant(order.protection_fee_cents as number | null)}\n` +
        `Total débité : ${montant(order.amount_total_cents as number | null)}`,
        livraison,
        delai,
        `Votre paiement n'est versé au vendeur qu'après votre confirmation de réception. Dès que vous aurez ` +
        `l'article entre les mains, confirmez-le depuis Mon compte, rubrique Mes achats (bouton ` +
        `« J'ai bien reçu l'article ») :\n${LIEN_MES_ACHATS}`,
        `Si l'article ne vous parvient pas, ou ne correspond pas à l'annonce, ne confirmez pas la réception : ` +
        `signalez le problème depuis la même rubrique (bouton « Signaler un problème »). Après votre ` +
        `confirmation, vous disposez encore de ${DELAIS.heuresSignalement} heures pour le faire ; le vendeur ` +
        `n'est payé qu'ensuite.`,
        `Merci pour votre confiance.`,
      ]),
    );
  }

  if (seller) {
    const sellerEmail = await deps.db.sellerEmail(seller);
    if (sellerEmail) {
      const livraison = enMain
        ? `Mode de livraison : ${label}`
        : relais
          ? `Mode de livraison : ${label}\n` + (nomRelais ? `Nom de l'acheteur : ${nomRelais}\n` : "") +
            `Code postal du point relais souhaité : ${codeRelais ?? "non renseigné"}\n` +
            `Choisissez le point Mondial Relay le plus proche de ce code postal.`
          : `Mode de livraison : ${label}\nAdresse de livraison :\n${adressePostale ?? "non renseignée"}`;
      // L'adresse électronique de l'acheteur n'est plus donnée : la politique
      // de confidentialité ne compte pas le vendeur parmi les destinataires
      // des données, et les échanges passent par la messagerie du site.
      const ecrire = lienMessagerie(str(order.buyer_id), order.product_id);
      /* Le délai court depuis le paiement, pas depuis la remise : la base
       * pose ship_deadline_at au passage en « paid » (orders_set_ship_deadline,
       * 5 jours ouvrés), et orders_flag_manual_review (règle b) met en revue
       * toute commande encore « paid » après cette date, main propre comprise.
       * order_settle_payment renvoie la ligne entière : la date est là. */
      const limite = formatEcheance(str(order.ship_deadline_at));
      const quand = limite
        ? `au plus tard le ${limite} (${jours} jours ouvrés après le paiement)`
        : `dans les ${jours} jours ouvrés qui suivent le paiement`;
      const delai = echeance
        ? paragrapheVendeurAttente(echeance, enMain)
        : enMain
          ? `Remettez l'article et enregistrez la remise ${quand}, depuis Mon compte, rubrique Mes ventes, ` +
            `en indiquant sa date et son lieu (bouton « Confirmer la remise en main propre ») :\n${LIEN_MES_VENTES}` +
            `\n\nPassé ce délai, la commande est examinée par notre équipe avant tout versement.`
          : `Expédiez l'article et renseignez le numéro de suivi ${quand}, depuis Mon compte, rubrique ` +
            `Mes ventes (bouton « Marquer comme expédié ») :\n${LIEN_MES_VENTES}` +
            `\n\nPassé ce délai, la commande est examinée par notre équipe avant tout versement.`;

      await envoyer("vendeur", sellerEmail,
        // L'objet suffit parfois à décider d'ouvrir un courriel : quand une
        // action conditionne le paiement, il le dit, en tête.
        typographie(echeance
          ? `Article vendu : finalisez votre inscription pour être payé`
          : `Article vendu : « ${titreObjet} »`),
        corpsMembre([
          `Votre article « ${productTitle} » vient d'être vendu.`,
          `Commande : ${reference}`,
          `Prix de l'article : ${montant(order.product_amount_cents as number | null)}\n` +
          `Frais de livraison : ${montant(order.shipping_amount_cents as number | null)}\n` +
          `Montant que vous recevrez : ${montant(order.seller_amount_cents as number | null)}\n` +
          `Frais et commission à votre charge : ${montant(0)}`,
          livraison,
          ecrire && (enMain
            ? `Convenez avec l'acheteur de la date et du lieu de la remise par la messagerie du site :\n${ecrire}`
            : `Pour écrire à l'acheteur, passez par la messagerie du site :\n${ecrire}`),
          delai,
          `Le versement partira automatiquement au plus tôt ${DELAIS.heuresSignalement} heures après la ` +
          `confirmation de réception par l'acheteur, si aucun problème n'a été signalé entre-temps. ` +
          (enMain ? `Enregistrer la remise` : `Saisir le numéro de suivi`) + ` ne déclenche pas le versement. ` +
          `Si l'acheteur ne confirme pas la réception dans les ${DELAIS.joursSilenceAcheteur} jours suivant ` +
          (enMain ? `la remise` : `l'expédition`) + `, notre équipe examine la commande avant tout versement.`,
          `Merci pour votre confiance.`,
        ]),
      );
    }
  }
}
