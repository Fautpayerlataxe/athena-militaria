/**
 * Le site réel, dans un vrai navigateur.
 *
 * Tout ce qui précède dans ce dossier lit du code ou interroge une base. Ici on
 * charge les pages telles qu'un visiteur les reçoit, à huit largeurs d'écran, et
 * on mesure. C'est le seul endroit qui peut dire si une page déborde sur un
 * téléphone, si une image manque, ou si la console crache une erreur.
 *
 * Par défaut la cible est la production. C'est délibéré : un test qui passe en
 * local pendant que le site en ligne est cassé ne sert à rien. Aucun de ces
 * contrôles n'écrit quoi que ce soit ni ne dépense d'argent : ils chargent des
 * pages publiques et lisent ce qu'elles rendent.
 *
 *     npm run test:browser
 *     SITE=http://localhost:3000 npm run test:browser
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";

const BASE = (process.env.SITE ?? "https://www.athenamilitaria.fr").replace(/\/$/, "");

/** Les largeurs qui comptent : du plus petit téléphone encore vendu au grand écran. */
const LARGEURS = [320, 375, 390, 430, 768, 1024, 1440, 1920];

/** Les pages qu'un visiteur atteint réellement. */
const PAGES = [
  { chemin: "/", nom: "accueil" },
  { chemin: "/product?id=9", nom: "fiche produit" },
  { chemin: "/category?cat=Guerre-froide", nom: "catégorie" },
  { chemin: "/account", nom: "compte" },
  { chemin: "/messages", nom: "messagerie" },
  { chemin: "/sell", nom: "mise en vente" },
  { chemin: "/order", nom: "commande" },
  { chemin: "/community", nom: "communauté" },
  { chemin: "/legal", nom: "mentions légales" },
  { chemin: "/guides/", nom: "guides" },
  { chemin: "/cette-page-nexiste-pas", nom: "page introuvable" },
];

let navigateur: Browser;

before(async () => {
  navigateur = await chromium.launch();
}, { timeout: 120_000 });

after(async () => {
  if (navigateur) await navigateur.close();
});

/**
 * Certaines erreurs de console ne disent rien du site : une extension, une
 * requête annulée par la navigation, un blocage réseau du poste. On ne veut pas
 * qu'un test devienne du bruit qu'on finit par ignorer.
 */
const BRUIT_CONNU = [
  /favicon/i,
  /ERR_BLOCKED_BY_CLIENT/i,
  /net::ERR_ABORTED/i,
  /Download the React DevTools/i,
];

type Releve = {
  erreurs: string[];
  requetesEchouees: string[];
  debordement: number;
  coupables: string[];
  petitesCibles: string[];
};

async function releverPage(page: Page, chemin: string, largeur: number): Promise<Releve> {
  const erreurs: string[] = [];
  const requetesEchouees: string[] = [];

  const surConsole = (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const texte = m.text();
    if (BRUIT_CONNU.some((r) => r.test(texte))) return;
    erreurs.push(texte.slice(0, 160));
  };
  const surPageError = (e: Error) => erreurs.push(`exception : ${e.message.slice(0, 160)}`);
  const surReponse = (r: { status: () => number; url: () => string }) => {
    if (r.status() >= 400 && !BRUIT_CONNU.some((x) => x.test(r.url()))) {
      requetesEchouees.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 110)}`);
    }
  };

  page.on("console", surConsole);
  page.on("pageerror", surPageError);
  page.on("response", surReponse);

  await page.setViewportSize({ width: largeur, height: 900 });
  await page.goto(BASE + chemin, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
  // Le site rend une partie de son contenu après la réponse de Supabase.
  await page.waitForTimeout(900);

  const mesures = await page.evaluate((w) => {
    const de = document.documentElement;
    const debordement = Math.max(0, de.scrollWidth - w);

    const decrire = (el: Element) => {
      const t = el.tagName.toLowerCase();
      const id = (el as HTMLElement).id ? "#" + (el as HTMLElement).id : "";
      const cl = typeof el.className === "string" && el.className
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
      return t + id + cl;
    };

    const coupables = debordement > 0
      ? [...document.querySelectorAll("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.right > w + 1 || r.left < -1);
          })
          .slice(0, 4)
          .map((el) => `${decrire(el)} jusqu'à ${Math.round(el.getBoundingClientRect().right)}px`)
      : [];

    // Une cible tactile sous 24 px de côté est difficile à atteindre au doigt.
    const petitesCibles = [...document.querySelectorAll("a, button, [role=button], input[type=submit]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return r.width < 24 || r.height < 24;
      })
      .slice(0, 5)
      .map((el) => `${decrire(el)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);

    return { debordement, coupables, petitesCibles };
  }, largeur);

  page.off("console", surConsole);
  page.off("pageerror", surPageError);
  page.off("response", surReponse);

  return { erreurs, requetesEchouees, ...mesures };
}

/* ================================================================== *
 *  Aucune page ne doit déborder horizontalement
 * ================================================================== */

describe("le site tient dans l'écran", { timeout: 900_000 }, () => {
  for (const largeur of LARGEURS) {
    test(`à ${largeur} px, aucune page ne déborde`, async () => {
      const page = await navigateur.newPage();
      const fautifs: string[] = [];
      try {
        for (const p of PAGES) {
          const r = await releverPage(page, p.chemin, largeur);
          if (r.debordement > 0) {
            fautifs.push(`${p.nom} (${p.chemin}) déborde de ${r.debordement}px : ${r.coupables.join(" · ")}`);
          }
        }
      } finally {
        await page.close();
      }
      assert.deepEqual(fautifs, [],
        `un débordement horizontal oblige le visiteur à faire glisser la page latéralement :\n  ${fautifs.join("\n  ")}`);
    }, { timeout: 600_000 });
  }
});

/* ================================================================== *
 *  Console et réseau
 * ================================================================== */

describe("rien ne casse en silence", { timeout: 900_000 }, () => {
  test("aucune erreur de console sur les pages principales", async () => {
    const page = await navigateur.newPage();
    const fautifs: string[] = [];
    try {
      for (const p of PAGES) {
        const r = await releverPage(page, p.chemin, 1440);
        // La page introuvable répond 404 par construction, et le navigateur le
        // journalise. C'est le comportement voulu, pas une erreur du site.
        const erreurs = p.chemin.includes("nexiste-pas")
          ? r.erreurs.filter((e) => !/status of 404/.test(e))
          : r.erreurs;
        if (erreurs.length) fautifs.push(`${p.nom} : ${[...new Set(erreurs)].join(" | ")}`);
      }
    } finally {
      await page.close();
    }
    assert.deepEqual(fautifs, [], `erreurs de console :\n  ${fautifs.join("\n  ")}`);
  }, { timeout: 600_000 });

  test("aucune ressource manquante ni requête en échec", async () => {
    const page = await navigateur.newPage();
    const fautifs: string[] = [];
    try {
      for (const p of PAGES) {
        const r = await releverPage(page, p.chemin, 1440);
        // La page « introuvable » répond 404 par construction : c'est le but.
        const echecs = p.chemin.includes("nexiste-pas")
          ? r.requetesEchouees.filter((e) => !e.startsWith("404 /cette-page"))
          : r.requetesEchouees;
        if (echecs.length) fautifs.push(`${p.nom} : ${[...new Set(echecs)].join(" | ")}`);
      }
    } finally {
      await page.close();
    }
    assert.deepEqual(fautifs, [], `requêtes en échec :\n  ${fautifs.join("\n  ")}`);
  }, { timeout: 600_000 });
});

/* ================================================================== *
 *  Aucun lien mort
 * ================================================================== */

describe("aucun lien mort", { timeout: 900_000 }, () => {
  test("tous les liens internes des pages principales aboutissent", async () => {
    const page = await navigateur.newPage();
    const casses: string[] = [];
    try {
      const aVerifier = new Map<string, string>();

      for (const p of PAGES.filter((x) => !x.chemin.includes("nexiste-pas"))) {
        await page.goto(BASE + p.chemin, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
        await page.waitForTimeout(700);
        const liens = await page.evaluate(() =>
          [...document.querySelectorAll("a[href]")]
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.startsWith(location.origin))
            // href="#" et les ancres sont traités en JavaScript, pas en navigation.
            .filter((h) => !h.includes("#"))
        );
        for (const l of liens) if (!aVerifier.has(l)) aVerifier.set(l, p.nom);
      }

      for (const [url, depuis] of aVerifier) {
        const r = await page.request.head(url, { failOnStatusCode: false, timeout: 20_000 })
          .catch(() => null);
        const statut = r?.status() ?? 0;
        if (statut === 0 || statut >= 400) {
          casses.push(`${statut || "injoignable"} ${url.replace(BASE, "")} (depuis ${depuis})`);
        }
      }
      console.log(`      ${aVerifier.size} lien(s) interne(s) distinct(s) vérifié(s)`);
    } finally {
      await page.close();
    }
    assert.deepEqual(casses, [], `liens cassés :\n  ${casses.join("\n  ")}`);
  }, { timeout: 600_000 });
});

/* ================================================================== *
 *  Référencement et accessibilité, ce qui se mesure sans juger
 * ================================================================== */

describe("référencement et accessibilité", { timeout: 900_000 }, () => {
  test("chaque page porte un titre, une description et une adresse canonique", async () => {
    const page = await navigateur.newPage();
    const manques: string[] = [];
    const titres = new Map<string, string>();
    try {
      for (const p of PAGES.filter((x) => !x.chemin.includes("nexiste-pas"))) {
        // networkidle et non domcontentloaded : le site pose son titre, sa
        // description et sa canonique en JavaScript, comme le fait tout site
        // statique sans étape de compilation. Un moteur les voit, ce contrôle
        // doit les voir aussi.
        await page.goto(BASE + p.chemin, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
        await page.waitForTimeout(900);

        const meta = await page.evaluate(() => {
          const visible = (el: Element) => {
            const s = getComputedStyle(el);
            return s.display !== "none" && s.visibility !== "hidden" &&
                   (el as HTMLElement).offsetParent !== null;
          };
          return {
            titre: document.title,
            description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
            canonique: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
            og: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
            // Les pages à double état (visiteur / connecté) portent un h1 par
            // état. Un seul est affiché : compter le DOM entier ferait croire
            // à un défaut qui n'existe pas.
            h1: [...document.querySelectorAll("h1")].filter(visible).length,
            indexable: !/noindex/i.test(
              document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? ""),
          };
        });

        if (!meta.titre || meta.titre.length < 10) manques.push(`${p.nom} : titre absent ou trop court`);
        if (!meta.description) manques.push(`${p.nom} : meta description absente`);
        if (meta.h1 === 0) manques.push(`${p.nom} : aucun h1 visible`);
        if (meta.h1 > 1) manques.push(`${p.nom} : ${meta.h1} balises h1 visibles, une seule attendue`);

        // Adresse canonique et Open Graph n'ont de sens que sur une page qu'on
        // veut voir indexée et partagée. Les exiger sur un espace privé serait
        // du bruit, et pousserait à ajouter des balises inutiles.
        if (meta.indexable) {
          if (!meta.canonique) manques.push(`${p.nom} : adresse canonique absente`);
          if (!meta.og) manques.push(`${p.nom} : og:title absent, le partage social affichera n'importe quoi`);

          const deja = titres.get(meta.titre);
          if (deja) manques.push(`${p.nom} : titre identique à ${deja}, duplication pour les moteurs`);
          else titres.set(meta.titre, p.nom);
        }
      }
    } finally {
      await page.close();
    }
    assert.deepEqual(manques, [], `manques :\n  ${manques.join("\n  ")}`);
  }, { timeout: 600_000 });

  test("les images portent une alternative textuelle", async () => {
    const page = await navigateur.newPage();
    const manques: string[] = [];
    try {
      for (const p of PAGES.filter((x) => !x.chemin.includes("nexiste-pas"))) {
        await page.goto(BASE + p.chemin, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
        await page.waitForTimeout(700);
        const sansAlt = await page.evaluate(() =>
          [...document.querySelectorAll("img")]
            .filter((i) => !i.hasAttribute("alt"))
            .slice(0, 5)
            .map((i) => (i.getAttribute("src") ?? "?").split("/").pop()!.slice(0, 40))
        );
        if (sansAlt.length) manques.push(`${p.nom} : ${sansAlt.join(", ")}`);
      }
    } finally {
      await page.close();
    }
    assert.deepEqual(manques, [],
      `images sans attribut alt (un lecteur d'écran ne peut pas les annoncer) :\n  ${manques.join("\n  ")}`);
  }, { timeout: 600_000 });

  test("les champs de formulaire sont étiquetés", async () => {
    const page = await navigateur.newPage();
    const manques: string[] = [];
    try {
      for (const p of PAGES.filter((x) => !x.chemin.includes("nexiste-pas"))) {
        await page.goto(BASE + p.chemin, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
        await page.waitForTimeout(700);
        const sansEtiquette = await page.evaluate(() =>
          [...document.querySelectorAll("input, select, textarea")]
            .filter((el) => {
              const e = el as HTMLInputElement;
              if (["hidden", "submit", "button"].includes(e.type)) return false;
              if (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby")) return false;
              if (e.getAttribute("title") || e.getAttribute("placeholder")) return false;
              if (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) return false;
              if (e.closest("label")) return false;
              return true;
            })
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}${(el as HTMLElement).id ? "#" + (el as HTMLElement).id : ""}`)
        );
        if (sansEtiquette.length) manques.push(`${p.nom} : ${sansEtiquette.join(", ")}`);
      }
    } finally {
      await page.close();
    }
    assert.deepEqual(manques, [], `champs sans étiquette :\n  ${manques.join("\n  ")}`);
  }, { timeout: 600_000 });

  test("la navigation au clavier laisse voir où l'on se trouve", async () => {
    const page = await navigateur.newPage();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45_000 });

      const sansFocusVisible: string[] = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        const etat = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const contour = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
          const ombre = s.boxShadow !== "none";
          const bordure = s.borderColor !== "rgba(0, 0, 0, 0)";
          return {
            visible: contour || ombre || bordure,
            quoi: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
          };
        });
        if (etat && !etat.visible) sansFocusVisible.push(etat.quoi);
      }
      assert.deepEqual([...new Set(sansFocusVisible)], [],
        "des éléments prennent le focus sans le montrer : au clavier, on ne sait plus où l'on est");
    } finally {
      await page.close();
    }
  }, { timeout: 300_000 });
});

/* ================================================================== *
 *  Les achats restent fermés, vu du navigateur
 * ================================================================== */

describe("l'état de maintenance est visible et tenu", { timeout: 300_000 }, () => {
  test("la fiche produit annonce la suspension et n'offre pas d'acheter", async () => {
    const page = await navigateur.newPage();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(BASE + "/product?id=9", { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForTimeout(1200);

      const texte = await page.evaluate(() => document.body.innerText);
      assert.match(texte, /achats sont momentanément suspendus/i,
        "le visiteur doit comprendre pourquoi il ne peut pas acheter");

      const boutonActif = await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .filter((b) => /acheter|payer|commander/i.test(b.textContent ?? ""))
          .filter((b) => !(b as HTMLButtonElement).disabled)
          .map((b) => (b.textContent ?? "").trim().slice(0, 40))
      );
      assert.deepEqual(boutonActif, [],
        "aucun bouton d'achat ne doit rester cliquable pendant la maintenance");

      // Contacter le vendeur doit rester possible : c'est ce que la page promet.
      const contact = await page.evaluate(() =>
        [...document.querySelectorAll("button, a")].some((e) => /contacter le vendeur/i.test(e.textContent ?? "")));
      assert.equal(contact, true, "la page annonce que le vendeur reste joignable");
    } finally {
      await page.close();
    }
  }, { timeout: 200_000 });
});
