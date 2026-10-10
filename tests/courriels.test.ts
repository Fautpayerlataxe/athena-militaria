/**
 * Ce que tous les courriels partagent (supabase/functions/_shared/courriels.ts)
 * et ce que disent les confirmations d'achat selon le mode de livraison.
 *
 * Le 10 octobre 2026, la relecture des courriels a trouvé du tutoiement, des
 * flèches, des espaces ordinaires devant les deux-points, une remise en main
 * propre annoncée comme une expédition, un code postal de point relais livré
 * sans explication et l'adresse électronique de l'acheteur donnée au vendeur.
 * Ces contrôles empêchent que cela revienne.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  abreger,
  ADRESSE_CONTACT,
  chargeResend,
  corpsMembre,
  DELAIS,
  formatJourHeure,
  FORMULE_FIN,
  LIGNE_CONTACT,
  lienMessagerie,
  montant,
  nomDuPays,
  pluriel,
  typographie,
} from "../supabase/functions/_shared/courriels.ts";
import { sendOrderEmails, type FulfillDeps } from "../supabase/functions/_shared/fulfillment.ts";
import {
  courrielAnnulationVendeur,
  courrielRepriseAcheteur,
  courrielRepriseVendeur,
  paragrapheAcheteurAttente,
  paragrapheVendeurAttente,
} from "../supabase/functions/_shared/vendeur-pas-pret.ts";
import { de, objetDuMessage } from "../supabase/functions/message-notify/objet.ts";

/** Source d'une fonction edge qui ne tourne que sous Deno (imports jsr: et
 *  https:) : on en contrôle le texte, faute de pouvoir l'exécuter ici. */
const source = (chemin: string) =>
  readFileSync(new URL(`../supabase/functions/${chemin}`, import.meta.url), "utf8");

const NBSP = " ";

/** Les règles d'écriture de tous les courriels aux membres. */
function verifierRegles(texte: string, contexte: string) {
  assert.doesNotMatch(texte, /(?<![\p{L}'’])(tu|ton|ta|tes|toi)(?![\p{L}'’])/iu, `tutoiement : ${contexte}`);
  assert.doesNotMatch(texte, /[—–]/, `tiret cadratin : ${contexte}`);
  assert.doesNotMatch(texte, /[←-⇿➔➡]/u, `flèche : ${contexte}`);
  assert.doesNotMatch(texte, / [:;?!»]/, `espace ordinaire avant une ponctuation haute : ${contexte}`);
  assert.doesNotMatch(texte, /« /, `espace ordinaire après « : ${contexte}`);
  assert.doesNotMatch(texte, /"/, `guillemets droits : ${contexte}`);
  assert.doesNotMatch(texte, /\d €/, `espace ordinaire avant € : ${contexte}`);
}

describe("outils des courriels", () => {
  test("montant : insécable devant €, espace fine entre les milliers", () => {
    assert.equal(montant(27210), `272,10${NBSP}€`);
    assert.equal(montant(125000), `1 250,00${NBSP}€`);
    assert.equal(montant(123456789), `1 234 567,89${NBSP}€`);
    assert.equal(montant(5), `0,05${NBSP}€`);
    assert.equal(montant(-10480), `-104,80${NBSP}€`);
    assert.equal(montant(null), `0,00${NBSP}€`);
    assert.equal(montant(Number.NaN), `0,00${NBSP}€`);
  });

  test("typographie : insécables, et sans effet sur un texte déjà converti", () => {
    const une = typographie("Total : « 3 » ? Oui ; non !");
    assert.equal(une, `Total${NBSP}: «${NBSP}3${NBSP}»${NBSP}? Oui${NBSP}; non${NBSP}!`);
    assert.equal(typographie(une), une);
    assert.equal(typographie("https://www.athenamilitaria.fr/account?tab=my-orders"),
      "https://www.athenamilitaria.fr/account?tab=my-orders", "une adresse n'est pas touchée");
  });

  test("abreger : coupe sur un mot, avec des points de suspension", () => {
    assert.equal(abreger("Casque Adrian", 70), "Casque Adrian");
    const long = "Casque Adrian modèle 1915 d'infanterie avec sa coiffe et sa jugulaire d'origine, très bel état";
    const court = abreger(long, 70);
    assert.ok(court.length <= 70, court);
    assert.match(court, /…$/);
    assert.match(court, /sa…$/, "coupé après un mot entier");
  });

  test("pluriel : 0 et 1 au singulier, plus de « (s) »", () => {
    assert.equal(pluriel(0, "échec", "échecs"), "0 échec");
    assert.equal(pluriel(1, "échec", "échecs"), "1 échec");
    assert.equal(pluriel(2, "échec", "échecs"), "2 échecs");
  });

  test("jour et heure sans l'année, pour un objet", () => {
    assert.equal(formatJourHeure("2026-10-17T12:05:00.000Z"), `samedi 17 octobre à 14${NBSP}h${NBSP}05`);
    assert.equal(formatJourHeure(null), "");
  });

  test("pays en toutes lettres", () => {
    assert.equal(nomDuPays("FR"), "France");
    assert.equal(nomDuPays("be"), "Belgique");
    assert.equal(nomDuPays(null), null);
  });

  test("corps d'un courriel à un membre : salutation, contact, formule commune", () => {
    const corps = corpsMembre(["Premier paragraphe.", false, null, "", "Second : fin."]);
    assert.match(corps, /^Bonjour,\n\nPremier paragraphe\.\n\nSecond : fin\.\n\n/);
    assert.ok(corps.endsWith(typographie(`${LIGNE_CONTACT}\n\n${FORMULE_FIN}`)));
    assert.match(corps, /L'équipe Athena Militaria\nhttps:\/\/www\.athenamilitaria\.fr$/);
    assert.match(corps, new RegExp(ADRESSE_CONTACT.replace(/\./g, "\\.")));
  });

  test("adresse de réponse : vers le contact pour un membre, pas pour une alerte à l'exploitant", () => {
    const membre = chargeResend("camille@example.test", "Objet", "Corps");
    assert.equal(membre.reply_to, ADRESSE_CONTACT);
    assert.equal(membre.from, "Athena Militaria <noreply@athenamilitaria.fr>");
    assert.deepEqual(membre.to, ["camille@example.test"]);
    const alerte = chargeResend(ADRESSE_CONTACT, "[Paiements] Objet", "Corps");
    assert.equal("reply_to" in alerte, false);
  });

  test("lien de messagerie absolu, avec l'annonce si on la connaît", () => {
    assert.equal(lienMessagerie("b7c8d9e0", 42), "https://www.athenamilitaria.fr/messages?to=b7c8d9e0&product=42");
    assert.equal(lienMessagerie("b7c8d9e0"), "https://www.athenamilitaria.fr/messages?to=b7c8d9e0");
    assert.equal(lienMessagerie(null, 42), null);
  });

  test("les délais annoncés sont ceux de la base", () => {
    const sql = readFileSync(
      new URL("../supabase/migrations/20260813000200_buyer_protection_pricing.sql", import.meta.url), "utf8");
    const reglage = (cle: string) => Number(sql.match(new RegExp(`\\('${cle}',\\s*(\\d+)\\)`))?.[1]);
    assert.equal(reglage("report_window_hours"), DELAIS.heuresSignalement);
    assert.equal(reglage("buyer_silence_days"), DELAIS.joursSilenceAcheteur);
    assert.equal(reglage("shipping_deadline_business_days"), DELAIS.joursOuvresExpedition);
  });
});

/* ================================================================== *
 *  Confirmations d'achat et de vente, par mode de livraison
 * ================================================================== */

describe("confirmations d'achat et de vente", () => {
  function deps() {
    const envoyes: Array<{ to: string; subject: string; body: string }> = [];
    const d = {
      stripe: { checkout: { sessions: { retrieve: async () => ({}) } } },
      db: {
        rpc: async () => ({ data: null, error: null }),
        productTitle: async () => ({ title: "Casque Adrian modèle 1915", sellerId: "vendeur-1" }),
        sellerEmail: async () => "vendeur@example.test",
      },
      sendEmail: async (to: string, subject: string, body: string) => { envoyes.push({ to, subject, body }); },
    } as unknown as FulfillDeps;
    return { d, envoyes };
  }
  const base = {
    id: "3f9c2a7e-8b41-4d2a-9e6f-5c1b0d7a2e84", product_id: 42, seller_id: "vendeur-1", buyer_id: "acheteur-1",
    customer_email: "acheteur@example.test", amount_total_cents: 27210, product_amount_cents: 25000,
    shipping_amount_cents: 890, protection_fee_cents: 1320, seller_amount_cents: 25890,
  };

  test("envoi postal : adresse complète, pays en lettres, liens vers les bonnes rubriques", async () => {
    const { d, envoyes } = deps();
    await sendOrderEmails(d, {
      ...base, shipping_method: "post",
      shipping_address: { name: "Camille Durand", line1: "12 rue des Tanneurs", postal_code: "54000", city: "Nancy", country: "FR" },
    });
    const [acheteur, vendeur] = envoyes;
    assert.equal(acheteur.subject, `Achat confirmé${NBSP}: «${NBSP}Casque Adrian modèle 1915${NBSP}»`);
    assert.match(acheteur.body, /54000 Nancy\nFrance/);
    assert.match(acheteur.body, /Total débité : 272,10 €/);
    assert.match(acheteur.body, /https:\/\/www\.athenamilitaria\.fr\/account\?tab=my-orders/);
    assert.match(vendeur.body, /https:\/\/www\.athenamilitaria\.fr\/account\?tab=my-sales/);
    assert.match(vendeur.body, /Montant que vous recevrez : 258,90 €/);
    for (const c of envoyes) verifierRegles(c.subject + "\n" + c.body, c.to);
  });

  test("envoi postal : la date limite est celle que la base a posée au paiement", async () => {
    const { d, envoyes } = deps();
    await sendOrderEmails(d, {
      ...base, shipping_method: "post", ship_deadline_at: "2026-10-17T12:05:00.000Z",
      shipping_address: { name: "Camille Durand", line1: "12 rue des Tanneurs", postal_code: "54000", city: "Nancy", country: "FR" },
    });
    const vendeur = envoyes.find((c) => c.to === "vendeur@example.test")!;
    assert.match(vendeur.body, new RegExp(`Expédiez l'article et renseignez le numéro de suivi au plus tard le ` +
      `samedi 17 octobre 2026 à 14${NBSP}h${NBSP}05 \\(5 jours ouvrés après le paiement\\)`));
  });

  test("le vendeur ne reçoit plus l'adresse électronique de l'acheteur, mais un lien vers la messagerie", async () => {
    const { d, envoyes } = deps();
    await sendOrderEmails(d, { ...base, shipping_method: "post", shipping_address: null });
    const vendeur = envoyes.find((c) => c.to === "vendeur@example.test")!;
    assert.doesNotMatch(vendeur.body, /acheteur@example\.test/);
    assert.match(vendeur.body, /https:\/\/www\.athenamilitaria\.fr\/messages\?to=acheteur-1&product=42/);
  });

  test("point relais : le code postal est expliqué, et le vendeur sait qu'il choisit le point", async () => {
    const { d, envoyes } = deps();
    await sendOrderEmails(d, {
      ...base, shipping_method: "relay", shipping_amount_cents: 490,
      shipping_address: { name: "Camille Durand", postal_code: "54000", note: "…" },
    });
    const [acheteur, vendeur] = envoyes;
    assert.match(acheteur.body, /Code postal du point relais souhaité : 54000/);
    assert.match(acheteur.body, /Le vendeur choisira le point Mondial Relay le plus proche de ce code postal\./);
    assert.match(vendeur.body, /Nom de l'acheteur : Camille Durand/);
    assert.match(vendeur.body, /Choisissez le point Mondial Relay le plus proche de ce code postal\./);
    for (const c of envoyes) verifierRegles(c.subject + "\n" + c.body, c.to);
  });

  test("remise en main propre : rien n'est « expédié », et personne n'est un tiers", async () => {
    const { d, envoyes } = deps();
    await sendOrderEmails(d, {
      ...base, shipping_method: "pickup", shipping_amount_cents: 0, amount_total_cents: 26320,
      seller_amount_cents: 25000, ship_deadline_at: "2026-10-17T12:05:00.000Z",
      // Adresse de facturation que Stripe pourrait renvoyer : elle ne doit
      // pas passer pour un lieu de remise.
      shipping_address: { name: "Camille Durand", country: "FR" },
    });
    const [acheteur, vendeur] = envoyes;
    assert.doesNotMatch(acheteur.body, /expédier votre commande/);
    assert.doesNotMatch(acheteur.body, /Adresse de livraison/);
    assert.match(acheteur.body, /Convenez ensemble de la date et du lieu de la remise par la messagerie du site/);
    assert.match(acheteur.body, /messages\?to=vendeur-1&product=42/);
    assert.doesNotMatch(vendeur.body, /À convenir avec le vendeur/);
    assert.doesNotMatch(vendeur.body, /renseigner le numéro de suivi/);
    assert.match(vendeur.body, /Confirmer la remise en main propre/);
    assert.match(vendeur.body, /Enregistrer la remise ne déclenche pas le versement/);
    // Le délai court depuis le paiement (ship_deadline_at, posé au passage en
    // « paid »), pas depuis la remise : le texte donne la date et le dit.
    assert.match(vendeur.body, new RegExp(`Remettez l'article et enregistrez la remise au plus tard le ` +
      `samedi 17 octobre 2026 à 14${NBSP}h${NBSP}05 \\(5 jours ouvrés après le paiement\\)`));
    assert.doesNotMatch(vendeur.body, /Une fois l'article remis, enregistrez la remise dans les/);
    for (const c of envoyes) verifierRegles(c.subject + "\n" + c.body, c.to);
  });

  test("remise en main propre sans date connue : le délai part du paiement", async () => {
    const { d, envoyes } = deps();
    await sendOrderEmails(d, { ...base, shipping_method: "pickup", shipping_address: null });
    const vendeur = envoyes.find((c) => c.to === "vendeur@example.test")!;
    assert.match(vendeur.body, /Remettez l'article et enregistrez la remise dans les 5 jours ouvrés qui suivent le paiement/);
  });

  test("vendeur pas prêt et main propre : les paragraphes d'attente parlent de remise", () => {
    const echeance = "2026-10-17T12:05:00.000Z";
    assert.match(paragrapheAcheteurAttente(echeance, true), /pour vous remettre l'article/);
    assert.match(paragrapheVendeurAttente(echeance, true), /vous ne pouvez pas enregistrer la remise en main propre/);
    assert.match(paragrapheVendeurAttente(echeance), /vous ne pouvez pas déclarer l'expédition/);
    assert.match(paragrapheVendeurAttente(echeance), /d'ici le samedi 17 octobre 2026 à 14\u00a0h\u00a005/);
  });
});

describe("reprise après inscription du vendeur, signalement en cours", () => {
  const ligne = {
    order_id: "aaaaaaaa-1111-2222-3333-444444444444", product_title: "Casque", status: "disputed",
    ship_deadline_at: "2026-10-19T10:00:00Z",
  };

  test("on ne dit pas au vendeur qu'il peut expédier une commande signalée", () => {
    const c = courrielRepriseVendeur(ligne);
    assert.doesNotMatch(c.sujet, /Vous pouvez expédier/);
    // Mode de livraison inconnu (la file ne le porte pas) : les deux gestes.
    assert.match(c.corps, /N'expédiez ni ne remettez l'article tant que le signalement n'est pas réglé/);
    verifierRegles(c.sujet + "\n" + c.corps, "reprise vendeur");
    assert.match(courrielRepriseVendeur({ ...ligne, shipping_method: "post" }).corps,
      /N'expédiez pas l'article tant que le signalement n'est pas réglé/);
  });

  test("main propre signalée : « ne remettez pas », jamais « expédier »", () => {
    const c = courrielRepriseVendeur({ ...ligne, shipping_method: "pickup" });
    assert.match(c.corps, /Ne remettez pas l'article tant que le signalement n'est pas réglé/);
    assert.doesNotMatch(c.sujet + c.corps, /expédi/i);
  });

  test("ni à l'acheteur que le vendeur doit maintenant l'expédier", () => {
    const c = courrielRepriseAcheteur(ligne);
    assert.doesNotMatch(c.corps, /doit maintenant l'expédier/);
    assert.match(c.corps, /Votre signalement reste ouvert/);
    verifierRegles(c.sujet + "\n" + c.corps, "reprise acheteur");
  });

  test("sans signalement, le geste suit le mode de livraison, avec le lien vers Mes ventes", () => {
    const poste = courrielRepriseVendeur({ ...ligne, status: "paid", shipping_method: "post" });
    assert.match(poste.sujet, /^Vous pouvez expédier la commande AAAAAAAA$/);
    assert.match(poste.corps, /account\?tab=my-sales/);
    assert.match(poste.corps, /dans les 14 jours suivant l'expédition,/);

    const main = courrielRepriseVendeur({ ...ligne, status: "paid", shipping_method: "pickup" });
    assert.equal(main.sujet, "Vous pouvez remettre l'article de la commande AAAAAAAA");
    assert.match(main.corps, /dans les 14 jours suivant la remise,/);
    assert.doesNotMatch(main.sujet + main.corps, /expédi/i);
    const acheteur = courrielRepriseAcheteur({ ...ligne, status: "paid", shipping_method: "pickup" });
    assert.match(acheteur.corps, /Il doit maintenant vous remettre l'article/);
    assert.doesNotMatch(acheteur.corps, /expédi/i);

    // Mode inconnu : l'objet ne promet plus une expédition.
    const inconnu = courrielRepriseVendeur({ ...ligne, status: "paid" });
    assert.equal(inconnu.sujet, "Vous pouvez expédier ou remettre l'article de la commande AAAAAAAA");
    for (const c of [poste, main, acheteur, inconnu]) verifierRegles(c.sujet + "\n" + c.corps, c.sujet);
  });

  test("annulation : « ne remettez pas » en main propre", () => {
    const main = courrielAnnulationVendeur({ ...ligne, status: "paid", shipping_method: "pickup",
      seller_ready_deadline_at: "2026-10-17T12:05:00.000Z" });
    assert.match(main.corps, /Ne remettez pas l'article\./);
    assert.doesNotMatch(main.corps, /expédi/i);
    verifierRegles(main.sujet + "\n" + main.corps, "annulation main propre");
  });
});

/* ================================================================== *
 *  Messagerie : objet du courriel « nouveau message »
 * ================================================================== */

describe("objet du courriel de la messagerie", () => {
  test("élision de « de » devant une voyelle ou un h muet", () => {
    assert.equal(de("Antoine"), "d'Antoine");
    assert.equal(de("emile_1916"), "d'emile_1916");
    assert.equal(de("Oscar"), "d'Oscar");
    assert.equal(de("Yves"), "d'Yves");
    assert.equal(de("Hugo"), "d'Hugo");
    assert.equal(de("Helene54"), "d'Helene54");
  });

  test("pas d'élision devant une consonne, un y consonne, un h aspiré, un chiffre", () => {
    assert.equal(de("Bernard"), "de Bernard");
    assert.equal(de("Yann"), "de Yann");
    assert.equal(de("Hussard1870"), "de Hussard1870");
    assert.equal(de("heros14"), "de heros14");
    assert.equal(de("1erRegiment"), "de 1erRegiment");
    assert.equal(de("_poilu"), "de _poilu");
  });

  test("avec une annonce : l'objet dit de quoi il s'agit, sans le pseudo", () => {
    const objet = objetDuMessage("Antoine", "Casque Adrian modèle 1915");
    assert.equal(objet, `Nouveau message au sujet de «${NBSP}Casque Adrian modèle 1915${NBSP}»`);
    assert.doesNotMatch(objet, /Antoine/);
  });

  test("sans annonce : le pseudo, élidé, et toujours présenté comme un membre", () => {
    assert.equal(objetDuMessage("Antoine", null), `Nouveau message d'Antoine, membre d'Athena${NBSP}Militaria`);
    assert.equal(objetDuMessage("AthenaMilitaria", ""), `Nouveau message d'AthenaMilitaria, membre d'Athena${NBSP}Militaria`);
    assert.equal(objetDuMessage("Bernard", null), `Nouveau message de Bernard, membre d'Athena${NBSP}Militaria`);
    assert.equal(objetDuMessage(null, null), "Nouveau message d'un membre");
  });

  test("aucun « de » non élidé devant une voyelle, quel que soit le cas", () => {
    for (const pseudo of ["Antoine", "Ulysse", "Isabelle", "Emile", "Yvonne", null]) {
      for (const titre of ["Insigne de béret", null]) {
        const objet = objetDuMessage(pseudo, titre);
        assert.doesNotMatch(objet, /\bde [AEIOUaeiou]/, objet);
        assert.doesNotMatch(objet, /\bde Y[^aeiouy]/, objet);
        verifierRegles(objet, objet);
      }
    }
  });

  test("message-notify se sert de cet objet, et le préentête présente l'auteur comme un membre", () => {
    const s = source("message-notify/index.ts");
    assert.match(s, /import \{ objetDuMessage \} from "\.\/objet\.ts"/);
    assert.match(s, /const sujet = objetDuMessage\(/);
    assert.doesNotMatch(s, /`de \$\{pseudo\}`/);
    assert.match(s, /\$\{nom\}, membre d&rsquo;Athena&nbsp;Militaria,/);
  });
});

/* ================================================================== *
 *  Fonctions Deno : ce que leur texte doit dire
 * ================================================================== */

describe("signalement d'un problème (order-notify)", () => {
  const s = source("order-notify/index.ts");
  const bloc = s.slice(s.indexOf(`event === "disputed"`));

  test("l'exploitant est prévenu avant les parties, qui ne disent « prévenu » que de qui l'est", () => {
    const exploitant = bloc.indexOf("suivi_litige_exploitant");
    const vendeur = bloc.indexOf("suivi_litige_vendeur");
    const acheteur = bloc.indexOf("suivi_litige_acheteur");
    assert.ok(exploitant > 0 && exploitant < vendeur && vendeur < acheteur, "ordre : exploitant, vendeur, acheteur");
    assert.match(bloc, /const equipePrevenue = await notifierUneFois\(`suivi_litige_exploitant/);
    assert.match(bloc, /const vendeurPrevenu = await notifierUneFois\(`suivi_litige_vendeur/);
    assert.doesNotMatch(bloc, /`Le vendeur et notre équipe sont prévenus\. Rien/, "plus d'affirmation inconditionnelle");
    assert.match(bloc, /equipePrevenue\s*\?\s*`Notre équipe est prévenue, et c'est elle qui clôt le signalement`/);
  });

  test("l'accusé à l'acheteur donne le lien vers la messagerie du vendeur", () => {
    assert.match(bloc, /const ecrireVendeur = lienMessagerie\(order\.seller_id, order\.product_id\)/);
    assert.match(bloc, /depuis la messagerie du site` \+\s*\(ecrireVendeur \? ` :\\n\$\{ecrireVendeur\}`/);
  });

  test("en main propre, on ne demande pas au vendeur de ne pas « expédier »", () => {
    assert.match(bloc, /const enMain = order\.shipping_method === "pickup"/);
    assert.match(bloc, /La remise de l'article n'est pas encore enregistrée : ne le remettez pas tant que le signalement/);
  });
});

describe("alerte de nouvelle annonce (listing-notify)", () => {
  test("sans le secret ADMIN_EMAIL, rien ne part (comportement d'origine)", () => {
    const s = source("listing-notify/index.ts");
    assert.match(s, /const ADMIN_EMAIL = Deno\.env\.get\("ADMIN_EMAIL"\);/);
    assert.match(s, /if \(!ADMIN_EMAIL \|\| !RESEND_API_KEY\)/);
    assert.doesNotMatch(s, /Deno\.env\.get\("ADMIN_EMAIL"\) \|\|/);
  });
});

describe("lettre hebdomadaire (weekly-newsletter)", () => {
  test("une seule pièce : corps et préentête au singulier", () => {
    const s = source("weekly-newsletter/index.ts");
    assert.match(s, /const uneSeule = annonces\.length === 1;/);
    assert.match(s, /"Voici la pi&egrave;ce mise en vente cette semaine\."/);
    assert.match(s, /"La nouvelle pi&egrave;ce mise en vente cette semaine\."/);
    assert.match(s, /opacity:0">\$\{preentete\}<\/div>/);
  });
});

describe("coût du mois (payments-monitor)", () => {
  test("le courriel dit ce que mesure la somme, et n'impute rien à ce qu'elle ne compte pas", () => {
    const s = source("payments-monitor/index.ts");
    assert.match(s, /for \(const tx of page\.data\) feesCents \+= tx\.fee \?\? 0;/, "la somme est celle du champ fee");
    assert.doesNotMatch(s, /Les postes les plus probables/);
    assert.doesNotMatch(s, /Frais Stripe réellement prélevés/);
    assert.match(s, /frais Connect par compte actif et par virement, n'y sont/);
  });
});
