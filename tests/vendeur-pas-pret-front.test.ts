/**
 * Vente conclue chez un vendeur qui n'a pas fini son inscription Stripe :
 * ce que le site en dit (décision du 10 oct. 2026).
 *
 * Le serveur (migration 20261010000000_vendeur_pas_pret.sql, checkout-status,
 * payout-release) est contrôlé par tests/vendeur-pas-pret.test.ts et
 * tests/db-vendeur-pas-pret.test.ts. Ici, le site :
 *
 *   - les libellés, en français et en anglais, dans i18n.js, dans la table
 *     exportée pour PHP (inc/i18n-dict.json) et dans les textes de secours
 *     de account.js ; typographie française, aucun tiret cadratin ;
 *   - le paragraphe des conditions de vente et les deux questions de la FAQ,
 *     texte en dur, dictionnaire et FAQPage ;
 *   - Mon compte, exécuté avec une page simulée : Mes ventes (inscription à
 *     finaliser, échéance passée, vente annulée, refus d'expédition par
 *     error.hint), Mes achats, et la carte de paiement ;
 *   - la page de confirmation (/order) avec et sans sellerPending ;
 *   - l'échéance au même format que les courriels (formatEcheance).
 *
 * Avant la migration, les colonnes seller_ready_* n'existent pas : chaque
 * écran doit alors se comporter exactement comme avant. Ce cas est vérifié
 * aussi.
 *
 * Lancement : npm run test:unit
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { REGLAGES_VENDEUR_PAS_PRET } from "../supabase/functions/_shared/payments.ts";
import { etatVendeurPourAcheteur, formatEcheance } from "../supabase/functions/_shared/vendeur-pas-pret.ts";

const lire = (nom: string) => readFileSync(new URL(`../${nom}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ *
 *  Dictionnaire
 * ------------------------------------------------------------------ */

const dico = lire("i18n.js");
const debutEn = dico.indexOf("\n    en: {");
function valeur(cle: string, langue: "fr" | "en"): string | undefined {
  const partie = langue === "fr" ? dico.slice(0, debutEn) : dico.slice(debutEn);
  const m = new RegExp(`^\\s*"${cle.replace(/\./g, "\\.")}": ("(?:[^"\\\\]|\\\\.)*"),$`, "m").exec(partie);
  return m ? JSON.parse(m[1]) : undefined;
}
const exporte = JSON.parse(lire("inc/i18n-dict.json")) as { fr: Record<string, string>; en: Record<string, string> };

const CLES_COMPTE = [
  "sale_stripe_required", "sale_stripe_finish_btn", "sale_deadline_passed", "payout_waiting_stripe",
  "payout_not_applicable", "sale_canceled_seller_not_ready", "ship_blocked_stripe", "ship_blocked_canceled",
  "stripe_pending_sales", "stripe_pending_sales_one", "purchase_seller_pending", "purchase_refund_in_progress",
  "purchase_canceled_seller_not_ready",
].map((c) => "tr_js_account." + c);
const CLES_PAGES = [
  "tr_account.stripe_text", "tr_legal.s3_4_seller_pending",
  "tr_about.faq_q7", "tr_about.faq_a7", "tr_about.faq_q8", "tr_about.faq_a8",
];
const NOUVELLES_CLES = [...CLES_COMPTE, ...CLES_PAGES];

/* textContent d'un fragment HTML, espaces ordinaires resserrés. */
const texte = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/[ \t\r\n]+/g, " ").trim();

/** Typographie d'un texte français : U+00A0 avant : ; ? !, vouvoiement, pas de tiret long. */
function typographieFrancaise(t: string, ou: string) {
  assert.doesNotMatch(t, / [:;?!]/, `${ou} : espace ordinaire avant : ; ? !`);
  assert.doesNotMatch(t, /(?<! )[;?!]|(?<![ \d])[:]/, `${ou} : espace insécable manquante avant : ; ? !`);
  assert.doesNotMatch(t, /[—–]/, `${ou} : tiret cadratin ou demi-cadratin`);
  assert.doesNotMatch(t, /\b(tu|toi|ton|ta|tes)\b/i, `${ou} : vouvoiement`);
}
function sansTiretLong(t: string, ou: string) {
  assert.doesNotMatch(t, /[—–]/, `${ou} : tiret cadratin ou demi-cadratin`);
}

/* ------------------------------------------------------------------ *
 *  Page simulée pour account.js
 * ------------------------------------------------------------------ */

/** Élément de page minimal : ce que account.js touche dans Mes achats, Mes ventes et la carte de paiement. */
class El {
  tagName: string;
  id = "";
  className = "";
  enfants: El[] = [];
  parent: El | null = null;
  style: Record<string, string> = {};
  attributs: Record<string, string> = {};
  ecouteurs: Record<string, Array<(e?: unknown) => unknown>> = {};
  disabled = false;
  type = "";
  value = "";
  placeholder = "";
  maxLength = 0;
  src = "";
  alt = "";
  loading = "";
  onerror: unknown = null;
  dataset: Record<string, string> = {};
  focalise = false;
  defile = 0;
  clics = 0;
  private _texte = "";
  private _html = "";
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this._texte + this.enfants.map((e) => e.textContent).join(" "); }
  set textContent(v: string) { this._texte = String(v); this.enfants = []; }
  get innerHTML(): string { return this._html; }
  set innerHTML(v: string) { this._html = String(v); this._texte = String(v).replace(/<[^>]+>/g, ""); this.enfants = []; }
  get classList() {
    const el = this;
    return {
      add: (c: string) => { if (!el.className.split(/\s+/).includes(c)) el.className = (el.className + " " + c).trim(); },
      remove: (c: string) => { el.className = el.className.split(/\s+/).filter((x) => x !== c).join(" "); },
      contains: (c: string) => el.className.split(/\s+/).includes(c),
    };
  }
  appendChild(e: El) { e.parent = this; this.enfants.push(e); return e; }
  insertAdjacentElement(ou: string, e: El) {
    assert.equal(ou, "afterend");
    const p = this.parent as El;
    if (e.parent) e.parent.enfants = e.parent.enfants.filter((x) => x !== e);
    e.parent = p;
    p.enfants.splice(p.enfants.indexOf(this) + 1, 0, e);
    return e;
  }
  setAttribute(k: string, v: string) { this.attributs[k] = String(v); }
  getAttribute(k: string) { return this.attributs[k] ?? null; }
  addEventListener(t: string, f: (e?: unknown) => unknown) { (this.ecouteurs[t] ??= []).push(f); }
  click() { this.clics++; for (const f of this.ecouteurs.click ?? []) f(); }
  focus() { this.focalise = true; }
  scrollIntoView() { this.defile++; }
  tous(): El[] { return this.enfants.flatMap((e) => [e, ...e.tous()]); }
  querySelector(sel: string): El | null {
    const classe = /^\.([\w-]+)$/.exec(sel)?.[1];
    assert.ok(classe, `sélecteur non simulé : ${sel}`);
    return this.tous().find((e) => e.className.split(/\s+/).includes(classe)) ?? null;
  }
  parClasse(c: string): El[] { return this.tous().filter((e) => e.className.split(/\s+/).includes(c)); }
  parTag(t: string): El[] { return this.tous().filter((e) => e.tagName === t.toUpperCase()); }
}

type Requete = { table: string; appels: Array<[string, unknown[]]> };
type Reponses = {
  orders?: (q: Requete) => { data: unknown; error: unknown };
  profiles?: { data: unknown; error?: unknown };
  rpc?: (nom: string, args: unknown) => { data?: unknown; error: unknown };
};

/** account.js exécuté dans un bac à sable, avec une page et un Supabase simulés. */
function chargerCompte(reponses: Reponses, langue: "fr" | "en" = "fr") {
  const elements: Record<string, El> = {};
  for (const id of ["my-orders-list", "my-sales-list", "stripeConnectCard", "stripeConnectBtn", "stripeConnectStatus", "stripeConnectText"]) {
    elements[id] = new El(id === "stripeConnectBtn" ? "button" : "div");
    elements[id].id = id;
  }
  elements.stripeConnectCard.appendChild(elements.stripeConnectText);
  elements.stripeConnectCard.appendChild(elements.stripeConnectStatus);
  elements.stripeConnectCard.appendChild(elements.stripeConnectBtn);
  const ongletReglages = new El("button");
  ongletReglages.dataset.tab = "my-settings";

  const requetes: Requete[] = [];
  const toasts: Array<[string, string]> = [];
  const rpcs: Array<[string, unknown]> = [];

  function constructeur(table: string) {
    const q: Requete = { table, appels: [] };
    requetes.push(q);
    const resultat = () => {
      if (table === "orders") return reponses.orders ? reponses.orders(q) : { data: [], error: null };
      if (table === "profiles") return { error: null, ...(reponses.profiles ?? { data: null }) };
      return { data: null, error: null };
    };
    const proxy: unknown = new Proxy({}, {
      get(_c, nom: string) {
        if (nom === "then") return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(resultat).then(ok, ko);
        if (nom === "maybeSingle" || nom === "single") return async () => resultat();
        return (...args: unknown[]) => { q.appels.push([nom, args]); return proxy; };
      },
    });
    return proxy;
  }

  const dictionnaire = langue === "fr" ? exporte.fr : exporte.en;
  const ctx: Record<string, unknown> = {
    console, URL, URLSearchParams, setTimeout, clearTimeout,
    location: { search: "", pathname: "/account", href: "https://www.athenamilitaria.fr/account" },
    history: { state: null, replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: (t: string) => new El(t),
      querySelector: (sel: string) => (sel === '.tab-btn[data-tab="my-settings"]' ? ongletReglages : null),
      querySelectorAll: () => [],
      addEventListener() {},
    },
    sb: {
      auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }) },
      from: constructeur,
      rpc: async (nom: string, args: unknown) => { rpcs.push([nom, args]); return reponses.rpc ? reponses.rpc(nom, args) : { data: null, error: null }; },
    },
    I18N: { current: langue },
    TR: (k: string) => dictionnaire[k] ?? k,
    toast: (m: string) => toasts.push(["info", m]),
    toastError: (m: string) => toasts.push(["erreur", m]),
    toastSuccess: (m: string) => toasts.push(["succes", m]),
    toastWarn: (m: string) => toasts.push(["alerte", m]),
    matchMedia: () => ({ matches: true }),
    SUPABASE_URL: "https://projet.supabase.co",
    SUPABASE_ANON_KEY: "cle-anon",
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(lire("account.js"), ctx, { filename: "account.js" });
  Object.assign(ctx, { __elements: elements, __requetes: requetes, __toasts: toasts, __rpcs: rpcs, __ongletReglages: ongletReglages });
  return ctx as Record<string, any>;
}

const vider = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const T = (cle: string, langue: "fr" | "en" = "fr") => valeur("tr_js_account." + cle, langue) as string;

function vente(extra: Record<string, unknown> = {}) {
  return {
    id: "a1b2c3d4-0000-0000-0000-000000000001", product_id: 7, created_at: "2026-10-10T08:00:00Z",
    status: "paid", products: { title: "Casque Adrian" }, amount_total_cents: 12000,
    seller_amount_cents: 11000, product_amount_cents: 10000, shipping_amount_cents: 1000,
    payout_state: "pending", shipping_method: "post",
    shipping_address: { name: "Jean Martin", line1: "1 rue de Paris", postal_code: "75001", city: "Paris", country: "FR" },
    ...extra,
  };
}

const FUTUR = new Date(Date.now() + 4 * 86400000).toISOString();
const PASSE = new Date(Date.now() - 2 * 3600000).toISOString();

async function mesVentes(commandes: unknown[], profil: unknown, extra: Reponses = {}, langue: "fr" | "en" = "fr") {
  const ctx = chargerCompte({ orders: () => ({ data: commandes, error: null }), ...extra }, langue);
  vm.runInContext("PROFIL_PAIEMENT = Promise.resolve(__profil)", Object.assign(ctx, { __profil: profil }));
  await ctx.loadMySales("vendeur-1");
  return ctx;
}

describe("libellés", () => {
  test("chaque nouvelle clé existe en français et en anglais, dans i18n.js et dans inc/i18n-dict.json", () => {
    for (const cle of NOUVELLES_CLES) {
      for (const langue of ["fr", "en"] as const) {
        const v = valeur(cle, langue);
        assert.ok(v && v.length > 0, `${cle} (${langue}) absente de i18n.js`);
        assert.equal(exporte[langue][cle], v, `${cle} (${langue}) : inc/i18n-dict.json pas régénéré (node build-i18n-dict.cjs)`);
      }
      assert.notEqual(valeur(cle, "fr"), valeur(cle, "en"), `${cle} : anglais non traduit`);
    }
  });

  test("typographie française, aucun tiret long, vouvoiement", () => {
    for (const cle of NOUVELLES_CLES) {
      typographieFrancaise(texte(valeur(cle, "fr") ?? ""), `${cle} (fr)`);
      sansTiretLong(valeur(cle, "en") ?? "", `${cle} (en)`);
    }
  });

  test("les espaces avant : ; ? ! sont bien des U+00A0 (et non des espaces fines ou ordinaires)", () => {
    assert.match(valeur("tr_js_account.sale_stripe_required", "fr") ?? "", /l'expédition : n'expédiez/);
    assert.match(valeur("tr_about.faq_q8", "fr") ?? "", /mes paiements : que se passe-t-il si je vends \?$/);
  });

  test("les mêmes repères dans les deux langues ({date}, {n})", () => {
    for (const cle of CLES_COMPTE) {
      const reperes = (t: string) => (t.match(/\{[a-z]+\}/g) ?? []).sort().join(",");
      assert.equal(reperes(valeur(cle, "fr") ?? ""), reperes(valeur(cle, "en") ?? ""), cle);
    }
    assert.match(valeur("tr_js_account.sale_stripe_required", "fr") ?? "", /avant le \{date\}/);
    assert.match(valeur("tr_js_account.stripe_pending_sales", "fr") ?? "", /^\{n\} ventes /);
    assert.doesNotMatch(valeur("tr_js_account.stripe_pending_sales_one", "fr") ?? "", /\{n\}/);
  });

  test("les textes de secours de account.js sont ceux du dictionnaire", () => {
    const ctx = chargerCompte({});
    const table = vm.runInContext("TEXTES_VENDEUR_PAS_PRET", ctx) as Record<string, [string, string]>;
    assert.deepEqual(Object.keys(table).map((c) => "tr_js_account." + c).sort(), [...CLES_COMPTE].sort());
    for (const [c, [fr, en]] of Object.entries(table)) {
      assert.equal(fr, valeur("tr_js_account." + c, "fr"), `${c} (fr)`);
      assert.equal(en, valeur("tr_js_account." + c, "en"), `${c} (en)`);
    }
  });

  test("la carte de paiement dit qu'on peut vendre avant d'avoir fini, avec le délai", () => {
    const fr = valeur("tr_account.stripe_text", "fr") ?? "";
    assert.match(fr, /^Pour être payé, connectez votre compte bancaire via Stripe\. Vous pouvez vendre avant d'avoir terminé, mais chaque vente vous laisse alors 7 jours après le paiement/);
    assert.match(fr, /Aucune commission n'est prélevée aujourd'hui :/);
    assert.match(valeur("tr_account.stripe_text", "en") ?? "", /You can sell before you finish, but each sale then gives you 7 days after payment/);
    const html = lire("account.html");
    const enDur = /<p id="stripeConnectText" data-i18n="tr_account\.stripe_text">([^<]*)<\/p>/.exec(html)?.[1];
    assert.equal(enDur, fr, "account.html : texte en dur différent du dictionnaire");
  });
});

/* ------------------------------------------------------------------ *
 *  Conditions de vente et FAQ
 * ------------------------------------------------------------------ */

describe("conditions de vente et FAQ", () => {
  test("le paragraphe des CGV suit celui du versement au vendeur, en dur et dans le dictionnaire", () => {
    const html = lire("legal.html");
    const m = /<p data-i18n-html="tr_legal\.s3_4_seller_pending">([\s\S]*?)<\/p>/.exec(html);
    assert.ok(m, "paragraphe absent de legal.html");
    assert.equal(texte(m[1]), texte(valeur("tr_legal.s3_4_seller_pending", "fr") ?? ""));
    const i = html.indexOf('data-i18n="tr_legal.s3_4_body"');
    const j = html.indexOf('data-i18n-html="tr_legal.s3_4_seller_pending"');
    const k = html.indexOf('data-i18n="tr_legal.s3_5_title"');
    assert.ok(i > 0 && i < j && j < k, "le paragraphe doit suivre 3.4 (versement au vendeur) et précéder 3.5");
    const fr = texte(valeur("tr_legal.s3_4_seller_pending", "fr") ?? "");
    assert.match(fr, /^Vendeur dont l'inscription au paiement n'est pas terminée\. Un achat peut être conclu/);
    assert.match(fr, /Le vendeur dispose de 7 jours à compter du paiement pour finaliser son inscription ; tant qu'elle n'est pas terminée, il ne peut pas déclarer l'expédition\./);
    assert.match(fr, /il dispose alors de 5 jours ouvrés pour expédier/);
    assert.match(fr, /intégralement remboursé \(prix de l'article, frais de livraison et frais de Protection acheteurs\)/);
    assert.match(texte(valeur("tr_legal.s3_4_seller_pending", "en") ?? ""), /^Seller whose payment setup is not complete\. A purchase can be made/);
  });

  test("les durées annoncées sont celles du serveur", () => {
    const { joursEcheance, relance1Jours, relance2Jours, joursOuvresExpedition } = REGLAGES_VENDEUR_PAS_PRET;
    assert.deepEqual([joursEcheance, relance1Jours, relance2Jours, joursOuvresExpedition], [7, 2, 5, 5],
      "les délais ont changé : revoir les CGV, la FAQ, account.html et order.js");
    assert.match(valeur("tr_about.faq_a8", "fr") ?? "", /dans les 7 jours suivant le paiement de l'acheteur.*Nous vous le rappelons 2 jours puis 5 jours après le paiement/);
    assert.match(valeur("tr_about.faq_a8", "en") ?? "", /within 7 days of the buyer's payment.*We remind you 2 days and then 5 days after the payment/);
  });

  test("dernière mise à jour des conditions : 10 octobre 2026", () => {
    assert.equal(valeur("tr_legal.updated", "fr"), "Dernière mise à jour : 10 octobre 2026");
    assert.equal(valeur("tr_legal.updated", "en"), "Last updated: 10 October 2026");
    assert.match(lire("legal.html"), /<p class="legal-updated" data-i18n="tr_legal\.updated">Dernière mise à jour.: 10 octobre 2026<\/p>/);
  });

  test("les deux questions sont dans le FAQPage d'À propos, identiques au texte visible", () => {
    const html = lire("about.html");
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const faq = JSON.parse(json)["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
    for (const n of [7, 8]) {
      const q = new RegExp(`<summary data-i18n="tr_about\\.faq_q${n}">([^<]*)</summary>`).exec(html)?.[1];
      const a = new RegExp(`<p data-i18n="tr_about\\.faq_a${n}">([^<]*)</p>`).exec(html)?.[1];
      assert.ok(q && a, `question ${n} absente de about.html`);
      assert.equal(q, valeur(`tr_about.faq_q${n}`, "fr"));
      assert.equal(a, valeur(`tr_about.faq_a${n}`, "fr"));
      const entree = faq.mainEntity[n - 1];
      assert.equal(entree.name, q, `FAQPage, question ${n}`);
      assert.equal(entree.acceptedAnswer.text, a, `FAQPage, réponse ${n}`);
    }
    assert.match(faq.mainEntity[6].name, /^Puis-je acheter à un vendeur qui n'a pas terminé son inscription au paiement \?$/);
  });
});

/* ------------------------------------------------------------------ *
 *  Échéance : même format que les courriels
 * ------------------------------------------------------------------ */

const ECHEANCES = [
  "2026-10-17T12:05:00.000Z",            // samedi 17 octobre 2026, 14 h 05 (heure d'été)
  "2026-10-17T12:05:00.123456+00:00",    // format de PostgREST (microsecondes)
  "2026-10-25T00:30:00Z",                // nuit du passage à l'heure d'hiver
  "2026-12-24T23:30:00Z",                // minuit passé à Paris : le 25
  "2027-03-28T01:15:00Z",                // passage à l'heure d'été
];

describe("format de l'échéance", () => {
  const ctx = chargerCompte({});
  const fmtEcheance = vm.runInContext("fmtEcheance", ctx) as (iso: string | null) => string;
  const fmtEN = vm.runInContext("fmtEN", ctx) as (iso: string | null) => string;

  test("français : identique à formatEcheance des courriels", () => {
    assert.equal(fmtEcheance("2026-10-17T12:05:00.000Z"), "samedi 17 octobre 2026 à 14\u00a0h\u00a005");
    for (const iso of ECHEANCES) assert.equal(fmtEcheance(iso), formatEcheance(iso), iso);
    assert.equal(fmtEcheance("2026-12-24T23:30:00Z"), "vendredi 25 décembre 2026 à 00\u00a0h\u00a030");
  });

  test("anglais : heure de Paris, dite comme telle", () => {
    assert.equal(fmtEN("2026-10-17T12:05:00.000Z"), "Saturday 17 October 2026, 14:05 (Paris time)");
    assert.equal(fmtEN("2026-12-24T23:30:00Z"), "Friday 25 December 2026, 00:30 (Paris time)");
  });

  test("date absente ou illisible : chaîne vide, jamais « Invalid Date »", () => {
    for (const iso of [null, "", "pas une date"]) {
      assert.equal(fmtEcheance(iso), "");
      assert.equal(fmtEN(iso), "");
    }
  });
});

/* ------------------------------------------------------------------ *
 *  État d'une commande
 * ------------------------------------------------------------------ */

describe("état d'une commande (venteVendeurPasPret)", () => {
  const ctx = chargerCompte({});
  const etat = vm.runInContext("venteVendeurPasPret", ctx) as (o: unknown) => { attente: boolean; echue: boolean; annulee: boolean };
  const futur = new Date(Date.now() + 3 * 86400000).toISOString();
  const passe = new Date(Date.now() - 3600000).toISOString();
  const simple = (o: unknown) => ({ ...etat(o) });

  test("sans les colonnes (avant la migration) : rien de tout cela", () => {
    for (const status of ["paid", "disputed", "shipped", "refunded", "completed"]) {
      assert.deepEqual(simple({ status }), { attente: false, echue: false, annulee: false });
    }
  });

  test("en attente, échue, annulée", () => {
    assert.deepEqual(simple({ status: "paid", seller_ready_deadline_at: futur }), { attente: true, echue: false, annulee: false });
    assert.deepEqual(simple({ status: "disputed", seller_ready_deadline_at: futur }), { attente: true, echue: false, annulee: false });
    assert.deepEqual(simple({ status: "paid", seller_ready_deadline_at: passe }), { attente: false, echue: true, annulee: false });
    assert.deepEqual(simple({ status: "paid", seller_ready_deadline_at: passe, seller_ready_cancel_at: passe }), { attente: false, echue: false, annulee: true });
    assert.deepEqual(simple({ status: "refunded", seller_ready_deadline_at: passe, seller_ready_cancel_at: passe, seller_ready_refunded_at: passe }), { attente: false, echue: false, annulee: true });
  });

  test("reprise constatée, ou commande expédiée : plus rien", () => {
    assert.deepEqual(simple({ status: "paid", seller_ready_deadline_at: futur, seller_ready_at: passe }), { attente: false, echue: false, annulee: false });
    assert.deepEqual(simple({ status: "shipped", seller_ready_deadline_at: futur }), { attente: false, echue: false, annulee: false });
  });

  test("d'accord avec ce que checkout-status dit à l'acheteur", () => {
    const cas = [
      { status: "paid", seller_ready_deadline_at: futur },
      { status: "paid", seller_ready_deadline_at: futur, seller_ready_at: passe },
      { status: "paid", seller_ready_deadline_at: futur, seller_ready_cancel_at: passe },
      { status: "paid" },
    ];
    for (const o of cas) assert.equal(etat(o).attente, etatVendeurPourAcheteur(o).attente, JSON.stringify(o));
  });
});

/* ------------------------------------------------------------------ *
 *  Mon compte, avec une page simulée
 * ------------------------------------------------------------------ */

describe("Mon compte, Mes ventes", () => {
  test("inscription à finaliser : la note avec l'échéance, « Finaliser mon inscription », pas de champ de suivi", async () => {
    const ctx = await mesVentes([vente({ seller_ready_deadline_at: FUTUR })], { stripe_account_id: "acct_1", stripe_onboarded: false });
    const liste: El = ctx.__elements["my-sales-list"];
    assert.equal(liste.parTag("input").length, 0, "champ de suivi affiché");
    assert.equal(liste.parClasse("order-payout").length, 1, "le montant reste affiché");
    assert.equal(liste.parClasse("order-address").length, 1);
    const boutons = liste.parTag("button");
    assert.deepEqual(boutons.map((b) => b.textContent), [T("sale_stripe_finish_btn")]);
    assert.equal(boutons[0].className, "btn small");
    const note = liste.parClasse("order-window-note");
    assert.equal(note.length, 1);
    assert.equal(note[0].textContent, T("sale_stripe_required").replace("{date}", formatEcheance(FUTUR)));
    assert.equal(liste.parClasse("order-payout-state")[0].textContent, T("payout_waiting_stripe"));

    // Le bouton ouvre Paramètres, montre la carte et y met le focus.
    boutons[0].click();
    assert.equal(ctx.__ongletReglages.clics, 1);
    assert.equal(ctx.__elements.stripeConnectCard.defile, 1);
    assert.equal(ctx.__elements.stripeConnectBtn.focalise, true);
  });

  test("en anglais, l'échéance est dite en anglais, à l'heure de Paris", async () => {
    const ctx = await mesVentes([vente({ seller_ready_deadline_at: "2026-10-17T12:05:00Z" })], null, {}, "en");
    // La commande est échue ou non selon la date du jour : on vérifie seulement le texte quand elle attend.
    const note = ctx.__elements["my-sales-list"].parClasse("order-window-note")[0] as El;
    if (Date.now() < Date.parse("2026-10-17T12:05:00Z")) {
      assert.equal(note.textContent, T("sale_stripe_required", "en").replace("{date}", "Saturday 17 October 2026, 14:05 (Paris time)"));
    } else {
      assert.equal(note.textContent, T("sale_deadline_passed", "en"));
    }
  });

  test("inscription terminée mais reprise pas encore notée : l'expédition s'affiche normalement", async () => {
    const ctx = await mesVentes([vente({ seller_ready_deadline_at: FUTUR })], { stripe_account_id: "acct_1", stripe_onboarded: true });
    const liste: El = ctx.__elements["my-sales-list"];
    assert.equal(liste.parTag("input").length, 1);
    assert.deepEqual(liste.parTag("button").map((b) => b.textContent), [T("mark_shipped")]);
    assert.equal(liste.parClasse("order-window-note").length, 0);
    assert.equal(liste.parClasse("order-payout-state")[0].textContent, T("payout_pending"));
  });

  test("échéance passée : la note, aucune action", async () => {
    const ctx = await mesVentes([vente({ seller_ready_deadline_at: PASSE })], { stripe_account_id: "acct_1", stripe_onboarded: true });
    const liste: El = ctx.__elements["my-sales-list"];
    assert.equal(liste.parTag("input").length + liste.parTag("button").length, 0);
    assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent), [T("sale_deadline_passed")]);
    assert.equal(liste.parClasse("order-payout-state").length, 0, "« en attente de la confirmation de réception » serait faux");
    assert.equal(liste.parClasse("order-payout").length, 0, "« Vous recevrez » serait faux");
    assert.equal(liste.parClasse("order-address").length, 0, "l'article ne doit pas partir");
  });

  test("vente annulée et remboursée : la note, « Aucun versement », aucune action", async () => {
    const ctx = await mesVentes([vente({
      status: "refunded", payout_state: "not_applicable",
      seller_ready_deadline_at: PASSE, seller_ready_cancel_at: PASSE, seller_ready_refunded_at: PASSE,
    })], null);
    const liste: El = ctx.__elements["my-sales-list"];
    assert.equal(liste.parTag("input").length + liste.parTag("button").length, 0);
    assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent), [T("sale_canceled_seller_not_ready")]);
    assert.equal(liste.parClasse("order-payout-state")[0].textContent, T("payout_not_applicable"));
    assert.equal(liste.parClasse("order-payout").length, 0, "« Vous recevrez » serait faux");
  });

  test("annulation décidée, remboursement pas encore passé : aucune expédition", async () => {
    const ctx = await mesVentes([vente({ seller_ready_deadline_at: PASSE, seller_ready_cancel_at: PASSE })], null);
    const liste: El = ctx.__elements["my-sales-list"];
    assert.equal(liste.parTag("input").length + liste.parTag("button").length, 0);
    assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent), [T("sale_canceled_seller_not_ready")]);
  });

  test("sans les colonnes (avant la migration) : exactement comme avant, sans attendre le profil", async () => {
    const ctx = chargerCompte({ orders: () => ({ data: [vente()], error: null }) });
    // Un profil qui ne répond jamais : Mes ventes ne doit pas l'attendre.
    vm.runInContext("PROFIL_PAIEMENT = new Promise(() => {})", ctx);
    await ctx.loadMySales("vendeur-1");
    const liste: El = ctx.__elements["my-sales-list"];
    assert.equal(liste.parTag("input").length, 1);
    assert.deepEqual(liste.parTag("button").map((b) => b.textContent), [T("mark_shipped")]);
    assert.equal(liste.parClasse("order-window-note").length, 0);
    assert.equal(liste.parClasse("order-payout-state")[0].textContent, T("payout_pending"));
  });

  test("refus d'expédition : SELLER_STRIPE_NOT_READY et ORDER_CANCELED_SELLER_NOT_READY ont leur message", async () => {
    for (const [hint, cle, recharge] of [
      ["SELLER_STRIPE_NOT_READY", "ship_blocked_stripe", false],
      ["ORDER_CANCELED_SELLER_NOT_READY", "ship_blocked_canceled", true],
      ["AUTRE", null, false],
    ] as const) {
      const ctx = await mesVentes([vente({ seller_ready_deadline_at: FUTUR })], { stripe_account_id: "acct_1", stripe_onboarded: true }, {
        rpc: () => ({ error: { message: "refus", hint } }),
      });
      const liste: El = ctx.__elements["my-sales-list"];
      liste.parTag("input")[0].value = "6A123";
      const avant = ctx.__requetes.filter((q: Requete) => q.table === "orders").length;
      const bouton = liste.parTag("button")[0];
      await bouton.ecouteurs.click[0]();
      await vider();
      assert.deepEqual(ctx.__rpcs.map((r: [string, unknown]) => r[0]), ["order_mark_shipped"]);
      assert.deepEqual(ctx.__toasts, [["erreur", cle ? T(cle) : T("action_failed")]], hint);
      const apres = ctx.__requetes.filter((q: Requete) => q.table === "orders").length;
      assert.equal(apres - avant, recharge ? 1 : 0, `${hint} : rechargement de Mes ventes`);
      if (!recharge) assert.equal(bouton.disabled, false);
    }
  });
});

describe("Mon compte, Mes achats", () => {
  async function mesAchats(commandes: unknown[], langue: "fr" | "en" = "fr") {
    const ctx = chargerCompte({ orders: () => ({ data: commandes, error: null }) }, langue);
    await ctx.loadMyOrders("acheteur-1");
    return ctx.__elements["my-orders-list"] as El;
  }

  test("vendeur en attente : l'échéance, et « Signaler un problème » reste", async () => {
    const liste = await mesAchats([vente({ seller_ready_deadline_at: FUTUR })]);
    assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent),
      [T("purchase_seller_pending").replace("{date}", formatEcheance(FUTUR))]);
    assert.deepEqual(liste.parTag("button").map((b) => b.textContent), [T("report_problem")]);
  });

  test("échéance passée, ou annulation décidée : remboursement en cours", async () => {
    for (const extra of [
      { seller_ready_deadline_at: PASSE },
      { seller_ready_deadline_at: PASSE, seller_ready_cancel_at: PASSE },
      { status: "disputed", seller_ready_deadline_at: PASSE, seller_ready_cancel_at: PASSE },
    ]) {
      const liste = await mesAchats([vente(extra)]);
      assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent), [T("purchase_refund_in_progress")], JSON.stringify(extra));
    }
  });

  test("remboursée : commande annulée, sans bouton", async () => {
    const liste = await mesAchats([vente({
      status: "refunded", seller_ready_deadline_at: PASSE, seller_ready_cancel_at: PASSE, seller_ready_refunded_at: PASSE,
    })]);
    assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent), [T("purchase_canceled_seller_not_ready")]);
    assert.equal(liste.parTag("button").length, 0);
  });

  test("sans les colonnes : la note d'attente d'expédition d'aujourd'hui", async () => {
    const liste = await mesAchats([vente(), vente({ status: "refunded" })]);
    assert.deepEqual(liste.parClasse("order-window-note").map((e) => e.textContent), [T("awaiting_shipment")]);
    assert.deepEqual(liste.parTag("button").map((b) => b.textContent), [T("report_problem")]);
  });
});

describe("Mon compte, carte de paiement", () => {
  async function carte(profil: unknown, ventes: (q: Requete) => { data: unknown; error: unknown }, langue: "fr" | "en" = "fr") {
    const ctx = chargerCompte({ profiles: { data: profil }, orders: ventes }, langue);
    const retour = await ctx.initStripeConnect({ id: "vendeur-1" });
    await vider();
    return { ctx, retour, carte: ctx.__elements.stripeConnectCard as El };
  }

  test("ventes en attente : nombre, première échéance, sous le texte de la carte", async () => {
    const premiere = new Date(Date.now() + 86400000).toISOString();
    const { ctx, retour, carte: c } = await carte({ stripe_account_id: "acct_1", stripe_onboarded: false },
      () => ({ data: [{ seller_ready_deadline_at: premiere }, { seller_ready_deadline_at: FUTUR }], error: null }));
    assert.deepEqual(retour, { stripe_account_id: "acct_1", stripe_onboarded: false }, "le profil est rendu à Mes ventes");
    const note = c.enfants[1];
    assert.equal(note.id, "stripePendingSales");
    assert.equal(note.className, "order-window-note");
    assert.equal(note.textContent, T("stripe_pending_sales").replace("{n}", "2").replace("{date}", formatEcheance(premiere)));
    // La requête est celle de la spécification : ventes de ce vendeur, encore en attente.
    const q = (ctx.__requetes as Requete[]).find((r) => r.table === "orders") as Requete;
    // Copie dans ce contexte : les tableaux écrits par account.js viennent du bac à sable.
    const appels = JSON.parse(JSON.stringify(q.appels));
    const limite = appels[6][1][1];
    assert.ok(Math.abs(Date.parse(limite) - Date.now()) < 60000, "comparée à maintenant");
    assert.deepEqual(appels, [
      ["select", ["seller_ready_deadline_at"]],
      ["eq", ["seller_id", "vendeur-1"]],
      ["not", ["seller_ready_deadline_at", "is", null]],
      ["is", ["seller_ready_at", null]],
      ["is", ["seller_ready_cancel_at", null]],
      ["in", ["status", ["paid", "disputed"]]],
      ["gt", ["seller_ready_deadline_at", limite]],
      ["order", ["seller_ready_deadline_at"]],
    ]);
  });

  test("une seule vente : au singulier ; en anglais, à l'heure de Paris", async () => {
    const { carte: c } = await carte(null, () => ({ data: [{ seller_ready_deadline_at: "2099-10-17T12:05:00Z" }], error: null }), "en");
    assert.equal(c.enfants[1].textContent,
      T("stripe_pending_sales_one", "en").replace("{date}", "Saturday 17 October 2099, 14:05 (Paris time)"));
  });

  test("colonnes absentes (avant la migration) : erreur ignorée, carte d'aujourd'hui", async () => {
    const { carte: c } = await carte({ stripe_account_id: "acct_1", stripe_onboarded: false },
      () => ({ data: null, error: { code: "42703", message: "column orders.seller_ready_deadline_at does not exist" } }));
    assert.equal(c.enfants.length, 3, "aucune note ajoutée");
    assert.equal(c.parClasse("order-window-note").length, 0);
  });

  test("requête qui lève : rien ne casse", async () => {
    const { retour, carte: c } = await carte(null, () => { throw new Error("réseau"); });
    assert.equal(retour, null);
    assert.equal(c.parClasse("order-window-note").length, 0);
  });

  test("vendeur déjà prêt : aucune requête sur les ventes", async () => {
    const { ctx } = await carte({ stripe_account_id: "acct_1", stripe_onboarded: true }, () => ({ data: [], error: null }));
    assert.equal((ctx.__requetes as Requete[]).filter((r) => r.table === "orders").length, 0);
  });
});

describe("Mon compte, liens des courriels", () => {
  test("?tab=my-settings ouvre Paramètres sur la carte de paiement", () => {
    const src = lire("account.js");
    assert.match(src, /new URLSearchParams\(location\.search\)\.get\("tab"\)/);
    assert.match(src, /if \(ongletDemande === "my-settings"\) \{\s*ouvrirOnglet\("my-settings", "stripeConnectCard"\);/);
  });
});

/* ------------------------------------------------------------------ *
 *  Page de confirmation (/order)
 * ------------------------------------------------------------------ */

/* Échappement de order.js (esc) : & < > " ' */
const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

async function pageCommande(reponse: Record<string, unknown>, langue: "fr" | "en" = "fr") {
  const carte = { innerHTML: "" };
  let pret: (() => Promise<void>) | null = null;
  const ctx: Record<string, unknown> = {
    console, URLSearchParams,
    location: { search: "?session_id=cs_test_1" + (langue === "en" ? "&lang=en" : "") },
    document: {
      getElementById: (id: string) => (id === "orderCard" ? carte : null),
      addEventListener: (t: string, f: () => Promise<void>) => { if (t === "DOMContentLoaded") pret = f; },
      createElement: () => ({}),
      head: { appendChild() {} },
    },
    fetch: async () => ({ ok: true, json: async () => reponse }),
    sb: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton" } } }) } },
    history: { replaceState() {} },
    I18N: { current: langue },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(lire("order.js"), ctx, { filename: "order.js" });
  assert.ok(pret, "order.js n'attend pas DOMContentLoaded");
  await (pret as unknown as () => Promise<void>)();
  await vider();
  return carte.innerHTML;
}

describe("page de confirmation", () => {
  const order = {
    reference: "A1B2C3D4", state: "paid", amount: "120,00 €", shipping: "Colissimo", productTitle: "Casque <Adrian>",
  };
  const T_ORDER = (() => {
    const src = lire("order.js");
    const prendre = (langue: "fr" | "en", cle: string) => {
      const bloc = src.slice(src.indexOf(`    ${langue}: {`));
      return JSON.parse(new RegExp(`\\n      ${cle}: ("(?:[^"\\\\]|\\\\.)*"),`).exec(bloc)?.[1] ?? "null");
    };
    return prendre;
  })();

  test("sellerPending : le bloc d'attente avec l'échéance du serveur, et la suite adaptée", async () => {
    const html = await pageCommande({
      status: "fulfilled",
      order: { ...order, sellerPending: true, sellerDeadline: "2026-10-17T12:05:00Z", sellerDeadlineText: formatEcheance("2026-10-17T12:05:00Z") },
    });
    assert.match(html, /<div class="order-confirm-next"><h3>Le vendeur finalise son inscription au paiement<\/h3><p>/);
    assert.ok(html.includes("À défaut le samedi 17 octobre 2026 à 14\u00a0h\u00a005, votre commande sera annulée"));
    assert.ok(html.includes("<li>" + echapper(T_ORDER("fr", "seller_pending_next_1")) + "</li>"));
    assert.ok(!html.includes(echapper(T_ORDER("fr", "next_1"))), "« Le vendeur a été prévenu et prépare l'expédition » serait faux");
    assert.ok(html.includes("Casque &lt;Adrian&gt;"), "titre échappé");
    assert.ok(html.indexOf("order-confirm-summary") < html.indexOf("Le vendeur finalise"), "le bloc suit le récapitulatif");
    assert.ok(html.indexOf("Le vendeur finalise") < html.indexOf(echapper(T_ORDER("fr", "next_title"))), "et précède « Et maintenant ? »");
  });

  test("sellerPending en anglais : date à l'heure de Paris", async () => {
    const html = await pageCommande({
      status: "fulfilled",
      order: { ...order, sellerPending: true, sellerDeadline: "2026-10-17T12:05:00Z", sellerDeadlineText: formatEcheance("2026-10-17T12:05:00Z") },
    }, "en");
    assert.ok(html.includes("<h3>The seller is completing their payment setup</h3>"));
    assert.ok(html.includes("If they have not done so by Saturday 17 October 2026, 14:05 (Paris time), your order will be cancelled"));
    assert.ok(html.includes("<li>" + echapper(T_ORDER("en", "seller_pending_next_1")) + "</li>"));
    assert.ok(!html.includes("samedi"));
  });

  test("le texte d'échéance du serveur est échappé", async () => {
    const html = await pageCommande({
      status: "fulfilled",
      order: { ...order, sellerPending: true, sellerDeadline: null, sellerDeadlineText: "<img src=x onerror=alert(1)>" },
    });
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });

  test("sans sellerPending (serveur d'avant, ou vendeur prêt) : la page d'aujourd'hui", async () => {
    for (const o of [order, { ...order, sellerPending: false, sellerDeadline: null, sellerDeadlineText: null }]) {
      const html = await pageCommande({ status: "fulfilled", order: o });
      assert.ok(html.includes("<li>" + echapper(T_ORDER("fr", "next_1")) + "</li>"));
      assert.ok(!html.includes(echapper(T_ORDER("fr", "seller_pending_title"))));
      assert.equal((html.match(/order-confirm-next/g) ?? []).length, 1);
    }
  });

  test("textes de order.js : typographie, pas de tiret long", () => {
    for (const cle of ["seller_pending_title", "seller_pending_text", "seller_pending_next_1"]) {
      typographieFrancaise(T_ORDER("fr", cle), `order.js ${cle} (fr)`);
      sansTiretLong(T_ORDER("en", cle), `order.js ${cle} (en)`);
      assert.ok(T_ORDER("en", cle), `order.js ${cle} (en) absente`);
    }
    assert.match(T_ORDER("fr", "seller_pending_next_1"), /5 jours ouvrés/);
  });
});
