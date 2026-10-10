/**
 * Ce que tous les courriels en texte brut du site partagent.
 *
 * Le 10 octobre 2026, la relecture des 44 courriels a montré autant de
 * formules de politesse que de fonctions, des espaces ordinaires devant les
 * deux-points dans la moitié d'entre eux, et aucun moyen de joindre l'équipe :
 * tout partait de noreply@, sans adresse de réponse. Une seule source pour la
 * typographie, les montants, les liens vers Mon compte, la signature et
 * l'adresse de réponse rend ces écarts impossibles à réintroduire sans le voir.
 *
 * Seules les fonctions qui importent déjà _shared/ s'en servent (order-notify,
 * stripe-webhook, checkout-status, payments-monitor, payout-release). Les
 * gabarits HTML (message-notify, listing-notify, authenticity-notify,
 * weekly-newsletter) sont autonomes, comme leurs copies de urls.ts : le
 * tableau de bord Supabase ne résout pas les imports vers ../_shared/.
 */

import { EXPEDITEUR_COURRIEL } from "./payments.ts";

export const SITE = "https://www.athenamilitaria.fr";

/** L'adresse que donnent les CGV (legal.html) et la page À propos. */
export const ADRESSE_CONTACT = "contact@athenamilitaria.fr";

/* Les liens des courriels ouvrent directement la bonne rubrique de Mon compte
 * (account.js lit ?tab=). Sans paramètre, /account ouvre Mes annonces. */
export const LIEN_MES_ACHATS = `${SITE}/account?tab=my-orders`;
export const LIEN_MES_VENTES = `${SITE}/account?tab=my-sales`;
export const LIEN_PARAMETRES = `${SITE}/account?tab=my-settings`;
export const LIEN_MES_ANNONCES = `${SITE}/account`;

/** Conversation avec un membre, rattachée à une annonce si on la connaît. */
export function lienMessagerie(membreId: unknown, produitId?: unknown): string | null {
  if (typeof membreId !== "string" || membreId === "") return null;
  const produit = produitId === null || produitId === undefined || produitId === "" ? "" : `&product=${encodeURIComponent(String(produitId))}`;
  return `${SITE}/messages?to=${encodeURIComponent(membreId)}${produit}`;
}

/**
 * Délais que les courriels annoncent, tels que la base les applique
 * (platform_settings, migration 20260813000200_buyer_protection_pricing.sql) :
 *   - heuresSignalement : report_window_hours, la fenêtre ouverte par la
 *     confirmation de réception, pendant laquelle l'acheteur peut encore
 *     signaler un problème et après laquelle seulement le vendeur est payé ;
 *   - joursSilenceAcheteur : buyer_silence_days, au-delà duquel une commande
 *     expédiée et jamais confirmée passe en revue manuelle
 *     (orders_flag_manual_review, règle a) ;
 *   - joursOuvresExpedition : shipping_deadline_business_days, au-delà
 *     duquel une expédition non déclarée passe en revue (règle b).
 * tests/courriels.test.ts relit la migration pour que les deux s'accordent.
 */
export const DELAIS = {
  heuresSignalement: 48,
  joursSilenceAcheteur: 14,
  joursOuvresExpedition: 5,
} as const;

/** Formule de fin, la même partout. « L'équipe Athena Militaria » est la
 *  signature du bandeau du site (i18n, note.signature). */
export const FORMULE_FIN = `Bien cordialement,\nL'équipe Athena Militaria\n${SITE}`;

/** Avant la formule : comment nous joindre. Vrai parce que chaque courriel
 *  aux membres porte reply_to vers cette adresse (chargeResend). */
export const LIGNE_CONTACT =
  `Pour toute question, répondez simplement à ce courriel ou écrivez-nous à ${ADRESSE_CONTACT}.`;

/**
 * Espaces insécables du français : avant « : ; ? ! », et à l'intérieur des
 * guillemets. Appliquée au texte fini plutôt qu'écrite à la main dans chaque
 * phrase : une espace ordinaire oubliée devant un deux-points est invisible à
 * la relecture, et coupe la ligne au mauvais endroit dans la boîte de
 * réception. Sans effet sur un texte déjà converti.
 */
export function typographie(texte: string): string {
  return texte
    .replace(/ ([:;?!])/g, " $1")
    .replace(/« /g, "« ")
    .replace(/ »/g, " »");
}

/**
 * Montant en euros pour un courriel : « 1 250,00 € », avec une espace fine
 * insécable entre les milliers et une insécable devant le symbole, comme les
 * pages PHP du site (number_format avec U+202F, puis U+00A0 €). Sans elle,
 * « 250,00 » pouvait finir une ligne et « € » commencer la suivante.
 * Écrit à la main plutôt que par Intl : le résultat ne dépend pas de la
 * version d'ICU du moteur.
 */
export function montant(cents: number | null | undefined): string {
  const valeur = Number(cents ?? 0);
  if (!Number.isFinite(valeur)) return "0,00 €";
  const signe = valeur < 0 ? "-" : "";
  const absolu = Math.round(Math.abs(valeur));
  const euros = String(Math.floor(absolu / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${signe}${euros},${String(absolu % 100).padStart(2, "0")} €`;
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

/** « samedi 17 octobre à 14 h 05 », sans l'année : pour un objet de
 *  courriel, où la place compte et où l'échéance est à quelques jours. */
export function formatJourHeure(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = partiesParis(iso, {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  if (!p) return "";
  return `${p.weekday} ${p.day} ${p.month} à ${p.hour} h ${p.minute}`;
}

/** « 17 octobre 2026 », à l'heure de Paris. */
export function formatDateCourte(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = partiesParis(iso, { day: "numeric", month: "long", year: "numeric" });
  return p ? `${p.day} ${p.month} ${p.year}` : "";
}

/** Coupe un titre trop long pour un objet, sur un mot si possible, avec des
 *  points de suspension. Un objet coupé par la boîte de réception perd la
 *  fin ; coupé ici, il le dit. */
export function abreger(texte: string, max: number): string {
  const t = String(texte ?? "").trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1);
  const espace = coupe.lastIndexOf(" ");
  return (espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd() + "…";
}

/** « 1 échec », « 2 échecs », « 0 échec » : plus de « échec(s) ». */
export function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n} ${n > 1 ? plusieurs : un}`;
}

/** Pays d'une adresse : « France » plutôt que « FR ». */
export function nomDuPays(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * Corps d'un courriel à un membre : « Bonjour, », les paragraphes, la ligne de
 * contact, la formule de fin. Les paragraphes vides sont ignorés, ce qui
 * permet d'écrire les variantes en ligne (`condition && "…"`).
 */
export function corpsMembre(paragraphes: Array<string | null | undefined | false>): string {
  const blocs = paragraphes.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return typographie(["Bonjour,", ...blocs, LIGNE_CONTACT, FORMULE_FIN].join("\n\n"));
}

/**
 * Charge utile Resend. Un courriel à un membre porte reply_to vers l'adresse
 * de contact : un acheteur qui répond à « Commande annulée » écrit alors à
 * quelqu'un, et non à noreply@. Une alerte à l'exploitant n'en a pas besoin.
 */
export function chargeResend(to: string, subject: string, text: string): Record<string, unknown> {
  return {
    from: EXPEDITEUR_COURRIEL,
    to: [to],
    subject,
    text,
    ...(to.toLowerCase() === ADRESSE_CONTACT ? {} : { reply_to: ADRESSE_CONTACT }),
  };
}
