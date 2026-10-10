/**
 * Ce que le site promet sur l'achat, la rétractation et les armes, et ce
 * qu'il fait au retour d'inscription Stripe.
 *
 * Relevé du 9 oct. 2026 (audit des promesses de paiement, plan SEO rang 10) :
 * /about et les conditions de vente promettaient une inscription « via
 * Google » qui n'existe pas, 14 jours de rétractation « comme l'exige la
 * loi » pour toute vente, des armes « de catégorie D libre », un signalement
 * « depuis la messagerie » sous 14 jours, et renvoyaient à une plateforme
 * européenne fermée le 20 juillet 2025. La fiche déclarait à Google la même
 * politique de retour de 14 jours pour toutes les annonces.
 *
 * Ce qui vaut réellement :
 *   - le droit de rétractation (Code de la consommation, L221-18) ne joue
 *     que face à un vendeur professionnel (L221-1 : contrat entre un
 *     professionnel et un consommateur) ; entre particuliers, ni rétractation
 *     ni garantie légale de conformité, mais la garantie des vices cachés
 *     (D111-8, II) ;
 *   - le signalement se fait depuis Mon compte, avant la confirmation de
 *     réception ou dans les 48 heures qui la suivent (order_report_dispute,
 *     report_window_hours = 48) ;
 *   - une arme à feu neutralisée relève en principe de la catégorie C
 *     depuis 2018 (code de la sécurité intérieure, R311-2 et R314-20).
 *
 * Ces contrôles lisent les fichiers du dépôt : textes français et anglais du
 * dictionnaire, texte en dur de about.html et legal.html (ce que lit un
 * moteur avant tout script), FAQPage, données structurées des fiches, et
 * l'appel de synchronisation de account.js, exécuté avec un fetch simulé.
 *
 * Lancement : npm run test:unit
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lire = (nom: string) => readFileSync(new URL(`../${nom}`, import.meta.url), "utf8");

/* Valeurs du dictionnaire i18n.js : [français, anglais]. */
const dico = lire("i18n.js");
const debutEn = dico.indexOf("\n    en: {");
function valeur(cle: string, langue: "fr" | "en"): string | undefined {
  const partie = langue === "fr" ? dico.slice(0, debutEn) : dico.slice(debutEn);
  const m = new RegExp(`^\\s*"${cle.replace(/\./g, "\\.")}": ("(?:[^"\\\\]|\\\\.)*"),$`, "m").exec(partie);
  return m ? JSON.parse(m[1]) : undefined;
}
const toutesLesValeurs = (langue: "fr" | "en") =>
  [...(langue === "fr" ? dico.slice(0, debutEn) : dico.slice(debutEn))
    .matchAll(/^\s*"([^"]+)": ("(?:[^"\\]|\\.)*"),$/gm)].map((m) => [m[1], JSON.parse(m[2]) as string] as const);

/* textContent d'un fragment HTML, espaces ordinaires resserrés (les espaces
   insécables restent : ils font partie du texte). */
const texte = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/[ \t\r\n]+/g, " ").trim();

/* ================================================================== *
 *  Les phrases fausses ont disparu, en français et en anglais
 * ================================================================== */

describe("plus de promesse fausse", () => {
  const INTERDITS: Array<[RegExp, string]> = [
    [/via Google/, "inscription par Google : seule l'inscription par e-mail existe (script.js)"],
    [/\(WWI, WWII|XXᵉ/, "périodes du catalogue : de la Révolution à la guerre froide"],
    [/catégorie D libre|category D weapons freely/, "arme neutralisée : catégorie C depuis 2018"],
    [/Comme l'exige la loi française|As required by French law/, "rétractation : seulement face à un professionnel"],
    [/négocier directement|negotiate directly/, "le paiement se fait au prix de l'annonce"],
    [/524\/2013|consumers\/odr/, "plateforme européenne fermée le 20 juillet 2025"],
    [/depuis la messagerie du site dans les 14 jours|messaging system within 14 days/, "signalement : Mon compte, 48 heures"],
    [/Google Analytics/, "mesure d'audience sans Google Analytics depuis le 5 oct. 2026"],
    [/^Décris /, "vouvoiement"],
  ];

  for (const langue of ["fr", "en"] as const) {
    test(`dictionnaire ${langue}`, () => {
      for (const [cle, v] of toutesLesValeurs(langue)) {
        for (const [motif, raison] of INTERDITS) {
          assert.doesNotMatch(v, motif, `${cle} (${langue}) : ${raison}`);
        }
      }
    });
  }

  test("texte en dur de about.html et legal.html", () => {
    for (const nom of ["about.html", "legal.html"]) {
      // Les commentaires du source expliquent ce qui a été retiré.
      const html = lire(nom).replace(/<!--[\s\S]*?-->/g, "");
      for (const [motif, raison] of INTERDITS) {
        assert.doesNotMatch(html, new RegExp(motif.source.replace(/^\^/, ""), motif.flags), `${nom} : ${raison}`);
      }
    }
  });

  test("le renvoi à la plateforme européenne n'existe plus nulle part", () => {
    assert.equal(valeur("tr_legal.s3_9_body2", "fr"), undefined);
    assert.equal(valeur("tr_legal.s3_9_body2", "en"), undefined);
    assert.doesNotMatch(lire("legal.html"), /data-i18n(-html)?="tr_legal\.s3_9_body2"/);
  });
});

/* ================================================================== *
 *  Ce que disent désormais les textes
 * ================================================================== */

describe("rétractation, garanties, signalement", () => {
  test("la rétractation est réservée aux ventes d'un professionnel", () => {
    assert.match(valeur("tr_legal.s3_6_body1", "fr") ?? "", /ne s'applique qu'aux ventes conclues entre un vendeur professionnel et un acheteur consommateur/);
    assert.match(valeur("tr_legal.s3_6_body1", "en") ?? "", /only applies to sales concluded between a professional seller and a consumer buyer/);
    assert.match(valeur("tr_legal.s3_6_body4", "fr") ?? "", /^Lorsque le vendeur est un particulier, l'acheteur ne dispose d'aucun droit de rétractation, sauf accord du vendeur\./);
    assert.match(valeur("tr_legal.s3_6_body4", "en") ?? "", /^When the seller is a private individual, the buyer has no right of withdrawal, unless the seller agrees\./);
    assert.match(lire("legal.html"), /<p data-i18n="tr_legal\.s3_6_body4">Lorsque le vendeur est un particulier/);
    // Délais de l'article L221-24 : à compter de la notification, différables.
    assert.match(valeur("tr_legal.s3_6_body2", "fr") ?? "", /au plus tard 14 jours après que le vendeur a été informé de la décision/);
    /* L221-21 laisse au consommateur le formulaire type ou « toute autre
       déclaration, dénuée d'ambiguïté » : la messagerie n'est qu'un exemple,
       et la copie à l'équipe n'est pas une condition. */
    assert.match(valeur("tr_legal.s3_6_body2", "fr") ?? "",
      /^Pour l'exercer, l'acheteur informe le vendeur de sa décision par toute déclaration dénuée d'ambiguïté, par exemple par la messagerie du site, de préférence avec copie à /);
    assert.match(valeur("tr_legal.s3_6_body2", "en") ?? "",
      /^To exercise it, the buyer informs the seller of their decision by any unequivocal statement, for example through the site's messaging, preferably with a copy to /);
  });

  test("garanties selon la qualité du vendeur", () => {
    assert.match(valeur("tr_legal.s3_7_li1", "fr") ?? "", /^<strong>Vendeur professionnel<\/strong> : garantie légale de conformité/);
    assert.match(valeur("tr_legal.s3_7_li2", "fr") ?? "", /^<strong>Vendeur particulier<\/strong> : pas de garantie légale de conformité ; garantie des vices cachés \(articles 1641 à 1649 du Code civil\)/);
    assert.match(valeur("tr_legal.s3_7_li2", "en") ?? "", /^<strong>Private seller<\/strong>: no legal guarantee of conformity/);
  });

  test("signalement : Mon compte, avant confirmation ou dans les 48 heures", () => {
    assert.match(valeur("tr_legal.s3_8_body", "fr") ?? "",
      /depuis Mon compte, rubrique Mes achats, avec le bouton « Signaler un problème » : avant de confirmer la réception, ou au plus tard 48 heures après l'avoir confirmée\./);
    // Le bouton porte bien ce nom, et la fenêtre est bien de 48 heures.
    assert.equal(valeur("tr_js_account.report_problem", "fr"), "Signaler un problème");
    assert.equal(valeur("tr_js_account.report_problem", "en"), "Report a problem");
    const tarifs = lire("supabase/migrations/20260813000200_buyer_protection_pricing.sql");
    assert.match(tarifs, /\('report_window_hours', 48\)/);
  });

  test("FAQ des armes : la règle du site, la loi, le guide", () => {
    const fr = valeur("tr_about.faq_a2", "fr") ?? "";
    const en = valeur("tr_about.faq_a2", "en") ?? "";
    /* La règle du site est celle de la CGU 2.4 (« Toutes armes à feu en état
       de fonctionnement »), sans liste de catégories : avec « des catégories
       A, B et C », la FAQ laissait croire qu'une arme d'avant 1900 en état de
       tir (catégorie D) était admise, et contredisait le paragraphe sur la
       modération de la même page. */
    assert.match(fr, /^Les armes à feu en état de fonctionnement sont interdites sur le site \(article 2\.4 de nos <a href="\/legal#cgu">conditions d'utilisation<\/a>\)\./);
    assert.match(en, /^Working firearms are prohibited on the site \(article 2\.4 of our <a href="\/legal\?lang=en#cgu">terms of use<\/a>\)\./);
    assert.doesNotMatch(fr + en, /catégories A, B et C sont interdites|categories A, B and C are prohibited/);
    assert.match(valeur("tr_legal.s2_4_li1", "fr") ?? "", /^Toutes armes à feu en état de fonctionnement /);
    assert.match(valeur("tr_about.security_mod_text", "fr") ?? "", /armes à feu en état de fonctionnement/);
    assert.match(fr, /relève en principe de la catégorie C depuis le 1er août 2018/);
    assert.match(fr, /<a href="\/guides\/vendre-militaria-legalement-france">/);
    assert.match(en, /<a href="\/guides\/vendre-militaria-legalement-france\?lang=en">/);
    // Les liens exigent l'insertion en HTML : data-i18n-html, pas data-i18n.
    assert.match(lire("about.html"), /<p data-i18n-html="tr_about\.faq_a2">/);
    // L'ancre visée existe bien.
    assert.match(lire("legal.html"), /<section id="cgu">/);
  });
});

/* ================================================================== *
 *  Le HTML en dur dit la même chose que le dictionnaire
 * ================================================================== */

describe("about.html et legal.html suivent le dictionnaire", () => {
  /* Le HTML servi en français est le fichier tel quel : c'est ce que lisent
     les moteurs et les assistants. i18n-runtime.js le remplace ensuite par
     la valeur du dictionnaire. Un écart, c'est deux textes pour une page. */
  for (const nom of ["about.html", "legal.html"]) {
    test(nom, () => {
      const html = lire(nom);
      const motif = /<([a-z0-9]+)\b[^>]*?\sdata-i18n(-html)?="(tr_(?:about|legal)\.[^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
      let n = 0;
      for (const m of html.matchAll(motif)) {
        const attendu = valeur(m[3], "fr");
        assert.ok(attendu !== undefined, `${nom} : clé ${m[3]} absente du dictionnaire`);
        // Espaces insécables mis à part : leur place est contrôlée plus bas, sur le dictionnaire.
        const sansInsecables = (t: string) => texte(t).replace(/[\u00a0\u202f]/g, " ");
        assert.equal(sansInsecables(m[4]), sansInsecables(attendu as string), `${nom} : ${m[3]}`);
        n++;
      }
      assert.ok(n > 30, `${nom} : ${n} éléments seulement`);
    });
  }

  test("les réponses du FAQPage sont le texte affiché", () => {
    const html = lire("about.html");
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const faq = JSON.parse(json)["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage");
    assert.equal(faq.mainEntity.length, 6);
    faq.mainEntity.forEach((q: { acceptedAnswer: { text: string } }, i: number) => {
      const visible = new RegExp(`<p data-i18n(?:-html)?="tr_about\\.faq_a${i + 1}">([\\s\\S]*?)</p>`).exec(html)?.[1];
      assert.ok(visible, `réponse ${i + 1} absente`);
      assert.equal(q.acceptedAnswer.text, texte(visible as string), `FAQPage, réponse ${i + 1}`);
    });
  });

  test("typographie française des textes d'À propos et des conditions", () => {
    for (const [cle, v] of toutesLesValeurs("fr")) {
      if (!/^tr_(about|legal)\./.test(cle)) continue;
      const t = texte(v);
      assert.doesNotMatch(t, / [:;?!]/, `${cle} : espace insécable avant : ; ? !`);
      assert.doesNotMatch(t, /« | »/, `${cle} : espace insécable dans « »`);
      assert.doesNotMatch(t, /—/, `${cle} : pas de tiret cadratin`);
    }
  });
});

/* ================================================================== *
 *  Fiche : pas de politique de retour commune, lien vers les CGV
 * ================================================================== */

describe("fiche article", () => {
  /* Le code seul : les commentaires expliquent pourquoi la déclaration a été
     retirée et la nomment. */
  const sansCommentaires = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("aucune politique de retour déclarée, côté serveur ni navigateur", () => {
    assert.doesNotMatch(sansCommentaires(lire("product.php")), /hasMerchantReturnPolicy|merchantReturnDays/);
    assert.doesNotMatch(sansCommentaires(lire("product.js")), /hasMerchantReturnPolicy|merchantReturnDays/);
  });

  test("la ligne de la Protection se termine par le lien vers les conditions de vente", () => {
    const php = lire("product.php");
    assert.match(php, /\$T\('tr_js_product\.protection_line'\)\)\)\s*\. ' ' \. str_replace\('<a ', '<a style="' \. \$styleLien \. '" ', \$T\('tr_js_product\.protection_cgv'\)\) \. '<\/p>'/);
    assert.match(lire("product.js"), /\$\{renvoiCgv\}<\/p>`/);
    // Le lien a le même dessin des deux côtés (or de texte, pas le bleu par défaut).
    const stylePhp = /\$styleLien = '([^']+)';/.exec(php)?.[1];
    const styleJs = /const STYLE_LIEN_PROTECTION = "([^"]+)";/.exec(lire("product.js"))?.[1];
    assert.ok(stylePhp && stylePhp === styleJs, "style du lien différent entre product.php et product.js");
    assert.match(stylePhp as string, /^color:var\(--gold-text\);/);
    assert.equal(valeur("tr_js_product.protection_cgv", "fr"), "En payant, vous acceptez nos <a href=\"/legal#cgv\">conditions de vente</a>.");
    assert.equal(valeur("tr_js_product.protection_cgv", "en"), "By paying, you accept our <a href=\"/legal?lang=en#cgv\">terms of sale</a>.");
    // Le texte de secours de product.js, pour un dictionnaire resté en cache, est le même.
    assert.ok(lire("product.js").includes("'En payant, vous acceptez nos <a href=\"/legal#cgv\">conditions de vente</a>.'"));
  });
});

/* ================================================================== *
 *  Retour d'inscription Stripe : synchronisation avant lecture du statut
 * ================================================================== */

describe("Mon compte, retour d'inscription Stripe", () => {
  const compte = lire("account.js");

  function fonction(nom: string): string {
    const m = new RegExp(`async function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(compte);
    assert.ok(m, `${nom} absente de account.js`);
    return m[0];
  }

  type Appel = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };
  function synchroniser(session: unknown, reponse: () => Promise<unknown>) {
    const appels: Appel[] = [];
    const fetch = (url: string, init: Appel["init"]) => { appels.push({ url, init }); return reponse(); };
    const window = { sb: { auth: { getSession: async () => ({ data: { session } }) } } };
    const fn = new Function("window", "fetch", "SUPABASE_URL", "SUPABASE_ANON_KEY", "AbortController", "setTimeout", "clearTimeout",
      fonction("synchroniserCompteStripe") + "\nreturn synchroniserCompteStripe;")(
      window, fetch, "https://projet.supabase.co", "cle-anon", AbortController, setTimeout, clearTimeout,
    ) as () => Promise<void>;
    return { appels, fn };
  }

  test("appelle connect-onboard avec { action: \"synchroniser\" }, la session et la clé publique", async () => {
    const { appels, fn } = synchroniser({ access_token: "jeton" }, async () => ({ ok: true }));
    await fn();
    assert.equal(appels.length, 1);
    assert.equal(appels[0].url, "https://projet.supabase.co/functions/v1/connect-onboard");
    assert.equal(appels[0].init.method, "POST");
    assert.deepEqual(JSON.parse(appels[0].init.body ?? ""), { action: "synchroniser" });
    assert.equal(appels[0].init.headers?.apikey, "cle-anon");
    assert.equal(appels[0].init.headers?.Authorization, "Bearer jeton");
  });

  test("muette en cas d'échec, et rien sans session", async () => {
    const enPanne = synchroniser({ access_token: "jeton" }, async () => { throw new TypeError("Failed to fetch"); });
    await enPanne.fn(); // ne lève pas
    assert.equal(enPanne.appels.length, 1);
    const deconnecte = synchroniser(null, async () => ({ ok: true }));
    await deconnecte.fn();
    assert.equal(deconnecte.appels.length, 0);
  });

  test("au retour ?connect=done ou refresh, la synchronisation précède la lecture du statut", () => {
    const init = fonction("initStripeConnect");
    const appel = init.indexOf("await synchroniserCompteStripe()");
    assert.ok(appel > 0, "synchronisation absente de initStripeConnect");
    assert.ok(appel < init.indexOf('.from("profiles")'), "la synchronisation doit précéder la lecture du profil");
    assert.match(init, /if \(retourStripe === "done" \|\| retourStripe === "refresh"\) \{\s*await synchroniserCompteStripe\(\);/);
  });

  /* Au retour ?connect=refresh, le vendeur doit recliquer pour obtenir un
     nouveau lien : le bouton répond pendant la synchronisation (jusqu'à dix
     secondes), et le statut lu ensuite n'écrase pas « Redirection vers
     Stripe... ». initStripeConnect est exécutée avec une page simulée. */
  test("le bouton répond pendant la synchronisation, sans que le statut écrase la redirection", async () => {
    const vider = () => new Promise((r) => setImmediate(r));
    type Bouton = { textContent: string; disabled: boolean; ecouteurs: Array<() => Promise<void>>; addEventListener: (t: string, f: () => Promise<void>) => void };
    const btn: Bouton = {
      textContent: "Configurer mes paiements", disabled: false, ecouteurs: [],
      addEventListener(type, f) { if (type === "click") this.ecouteurs.push(f); },
    };
    const statut = { style: {} as Record<string, string>, className: "", textContent: "" };
    const elements: Record<string, unknown> = {
      stripeConnectCard: {}, stripeConnectBtn: btn, stripeConnectStatus: statut, stripeConnectText: { textContent: "" },
    };
    let libererSync = () => {};
    const synchro = () => new Promise<void>((r) => { libererSync = r; });
    let repondre: (v: unknown) => void = () => {};
    const fetch = () => new Promise((r) => { repondre = r; });
    const adresses: string[] = [];
    const window = {
      location: { search: "?connect=refresh", href: "https://www.athenamilitaria.fr/account?connect=refresh" },
      sb: {
        auth: { getSession: async () => ({ data: { session: { access_token: "jeton" } } }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stripe_account_id: "acct_1", stripe_onboarded: false } }) }) }) }),
      },
    };
    const muet = () => {};
    const init = new Function("document", "window", "history", "URL", "URLSearchParams", "TRa", "toast", "toastSuccess", "toastError", "ERRa",
      "fetch", "SUPABASE_URL", "SUPABASE_ANON_KEY", "synchroniserCompteStripe",
      fonction("initStripeConnect") + "\nreturn initStripeConnect;")(
      { getElementById: (id: string) => elements[id] ?? null }, window,
      { state: null, replaceState: (_s: unknown, _t: string, a: string) => { adresses.push(a); } },
      URL, URLSearchParams, (k: string) => k, muet, muet, muet, String,
      fetch, "https://projet.supabase.co", "cle-anon", synchro,
    ) as (u: { id: string }) => Promise<void>;

    const fin = init({ id: "u1" });
    await vider();
    assert.equal(btn.ecouteurs.length, 1, "clic branché avant la fin de la synchronisation");
    const clic = btn.ecouteurs[0]();
    await vider();
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, "tr_js_account.stripe_redirecting");

    libererSync();
    await fin;
    assert.equal(statut.textContent, "tr_js_account.stripe_status_pending");
    assert.equal(btn.textContent, "tr_js_account.stripe_redirecting", "le statut n'écrase pas la redirection en cours");
    assert.deepEqual(adresses, ["/account"]);

    // La redirection échoue : le bouton reprend le libellé du statut.
    repondre({ json: async () => ({ error: "indisponible" }) });
    await clic;
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, "tr_js_account.stripe_finish_btn");
  });
});
