/**
 * Photos des annonces : rien ne quitte le stockage sans ligne confirmée,
 * et la modération efface aussi les originaux.
 *
 * Relecture finale de l'audit du 10 oct. 2026 :
 *   - en modifiant une annonce, la photo remplacée était effacée du bucket
 *     product-images même quand la base n'avait modifié aucune ligne
 *     (refus RLS ou annonce supprimée, que PostgREST ne signale pas comme
 *     une erreur) : l'annonce pointait alors vers un fichier disparu ;
 *   - même défaut en supprimant une annonce depuis Mon compte ;
 *   - une suppression par la modération laissait l'original public, et
 *     media.php refabriquait à la demande les copies WebP que
 *     rafraichir-cache.php venait d'effacer.
 *
 * Le code du navigateur (account.js, admin.js, et les deux aides de
 * script.js) tourne ici dans un bac à sable, avec un Supabase simulé qui
 * consigne chaque appel : aucune écriture réelle. La politique de stockage
 * (20261010000200_moderation_photos.sql) est lue ici, et exécutée sur un
 * vrai Postgres par tests/db-security.test.ts.
 *
 * Lancement : npm run test:unit
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const lire = (nom: string) => readFileSync(new URL(`../${nom}`, import.meta.url), "utf8");
const dico = JSON.parse(lire("inc/i18n-dict.json")) as { fr: Record<string, string>; en: Record<string, string> };

const SUPA = "https://uctaxgfqdoxtcidllyjv.supabase.co";
const VENDEUR = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const publique = (chemin: string) => `${SUPA}/storage/v1/object/public/product-images/${chemin}`;
const ANCIENNE = publique(`${VENDEUR}/1759000000000.webp`);
const DEUXIEME = publique(`${VENDEUR}/1759000000001.webp`);
// Ancienne forme : nom encodé dans l'adresse, suivi d'un paramètre.
const ENCODEE = publique(`${VENDEUR}/photo%20casque.jpg?t=1`);

/* ------------------------------------------------------------------ *
 *  Politique de stockage
 * ------------------------------------------------------------------ */

const MIGRATION = "supabase/migrations/20261010000200_moderation_photos.sql";
const sql = lire(MIGRATION);
const sansCommentaires = sql.replace(/--[^\n]*/g, "");
const adresses = (texte: string) => [...texte.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]).sort();

describe("politique de stockage de la modération", () => {
  const NOM = "Admin can delete any product image";

  test("idempotente : DROP POLICY IF EXISTS, puis CREATE POLICY du même nom", () => {
    const drop = sansCommentaires.indexOf(`DROP POLICY IF EXISTS "${NOM}" ON storage.objects;`);
    const create = sansCommentaires.indexOf(`CREATE POLICY "${NOM}"`);
    assert.ok(drop !== -1, "DROP POLICY IF EXISTS absent");
    assert.ok(create > drop, "CREATE POLICY absent ou avant le DROP");
    assert.equal(sansCommentaires.match(/CREATE POLICY/g)?.length, 1, "une seule politique");
  });

  test("suppression seulement, membres connectés, bucket des annonces seulement", () => {
    const corps = sansCommentaires.slice(sansCommentaires.indexOf("CREATE POLICY")).replace(/\s+/g, " ");
    assert.match(corps, /ON storage\.objects FOR DELETE TO authenticated USING \(/);
    assert.match(corps, /bucket_id = 'product-images' AND /);
    assert.doesNotMatch(corps, /\bOR\b/, "un OR ouvrirait la politique au-delà des administrateurs");
    assert.doesNotMatch(sansCommentaires, /FOR (ALL|INSERT|UPDATE|SELECT)/);
  });

  test("les administrateurs reconnus comme partout ailleurs : adresse du jeton, même liste", () => {
    assert.match(sansCommentaires, /auth\.jwt\(\)->>'email' IN \('[^)]+'\)/);
    const attendues = ["renduambroise@gmail.com", "sayrox.ar@gmail.com"];
    assert.deepEqual(adresses(sansCommentaires), attendues);
    // ADD_ADMIN.sql : la politique « Admin can delete any product », sur products.
    const addAdmin = lire("ADD_ADMIN.sql");
    const produits = addAdmin.slice(addAdmin.indexOf('CREATE POLICY "Admin can delete any product"'));
    assert.deepEqual(adresses(produits.slice(0, produits.indexOf(";"))), attendues);
    // Le navigateur : ADMIN_EMAILS (admin.js) et MOD_ADMIN_EMAILS (account.js).
    for (const [fichier, nom] of [["admin.js", "ADMIN_EMAILS"], ["account.js", "MOD_ADMIN_EMAILS"]]) {
      const m = new RegExp(`const ${nom} = \\[([^\\]]+)\\]`).exec(lire(fichier));
      assert.ok(m, `${nom} introuvable dans ${fichier}`);
      assert.deepEqual([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort(), attendues, fichier);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  Bac à sable : Supabase simulé, aides de script.js
 * ------------------------------------------------------------------ */

type Reponse = { data: unknown; error: unknown };
type Options = {
  /** Réponse d'un update ou d'un delete sur products. */
  produits?: Reponse;
};

const script = lire("script.js");
const AIDES = script.slice(
  script.indexOf("window.photosAnnonce = function"),
  script.indexOf("\n};\n", script.indexOf("window.supprimerOriginaux = async function")) + 4,
);

function bac(fichier: "account.js" | "admin.js", options: Options = {}) {
  const journal: string[] = [];
  const toasts: Array<[string, string]> = [];
  const requetes: Array<{ table: string; appels: string[] }> = [];

  function constructeur(table: string) {
    const q = { table, appels: [] as string[] };
    requetes.push(q);
    const resultat = (): Reponse => {
      if (table === "products" && q.appels.some((a) => a === "update" || a === "delete")) {
        journal.push(`${q.appels.includes("update") ? "update" : "delete"} products`);
        return options.produits ?? { data: [], error: null };
      }
      if (table === "reports") journal.push("update reports");
      return { data: null, error: null };
    };
    const proxy: unknown = new Proxy({}, {
      get(_c, nom: string) {
        if (nom === "then") return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(resultat).then(ok, ko);
        return (..._args: unknown[]) => { q.appels.push(nom); return proxy; };
      },
    });
    return proxy;
  }

  const ctx: Record<string, any> = {
    console, URL, URLSearchParams, setTimeout, clearTimeout, Date, JSON, Promise,
    location: { search: "", pathname: "/account", href: "https://www.athenamilitaria.fr/account" },
    history: { state: null, replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    sb: {
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: { id: "admin-1", email: "sayrox.ar@gmail.com" } } }),
      },
      from: constructeur,
      storage: {
        from: (bucket: string) => ({
          upload: async (chemin: string) => { journal.push(`upload ${bucket}:${chemin}`); return { error: null }; },
          getPublicUrl: (chemin: string) => ({ data: { publicUrl: publique(chemin) } }),
          remove: async (chemins: string[]) => {
            journal.push(`remove ${bucket}:${chemins.join(",")}`);
            return { data: chemins.map((name) => ({ name })), error: null };
          },
        }),
      },
    },
    I18N: { current: "fr" },
    TR: (k: string) => dico.fr[k] ?? k,
    toast: (m: string) => toasts.push(["info", m]),
    toastError: (m: string) => toasts.push(["erreur", m]),
    toastSuccess: (m: string) => toasts.push(["succes", m]),
    askConfirm: async () => true,
    confirm: () => true,
    purgerServeur: async (d: unknown) => { journal.push(`purge ${JSON.stringify(d)}`); return true; },
    urlFiche: (id: string) => `/annonce/x-${id}`,
    matchMedia: () => ({ matches: true }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(AIDES, ctx, { filename: "script.js (photosAnnonce, supprimerOriginaux)" });
  vm.runInContext(lire(fichier), ctx, { filename: fichier });
  return { ctx, journal, toasts, requetes };
}

const supprimes = (journal: string[]) => journal.filter((l) => l.startsWith("remove ")).map((l) => l.slice("remove product-images:".length));

/* ------------------------------------------------------------------ *
 *  Aides de script.js
 * ------------------------------------------------------------------ */

describe("supprimerOriginaux (script.js)", () => {
  test("chemins du bucket, décodés, sans paramètre ni doublon ; rien hors du bucket", async () => {
    const { ctx, journal } = bac("account.js");
    const n = await ctx.supprimerOriginaux([ANCIENNE, ANCIENNE, ENCODEE, "/hero.png", "https://exemple.fr/a.jpg", null]);
    assert.equal(n, 2);
    assert.deepEqual(supprimes(journal), [`${VENDEUR}/1759000000000.webp,${VENDEUR}/photo casque.jpg`]);
  });

  test("aucune photo du bucket : aucun appel au stockage", async () => {
    const { ctx, journal } = bac("account.js");
    assert.equal(await ctx.supprimerOriginaux(["/hero.png"]), 0);
    assert.deepEqual(journal, []);
  });

  test("par lots de 100", async () => {
    const { ctx, journal } = bac("account.js");
    const photos = Array.from({ length: 230 }, (_, i) => publique(`${VENDEUR}/${i}.webp`));
    assert.equal(await ctx.supprimerOriginaux(photos), 230);
    assert.deepEqual(supprimes(journal).map((l) => l.split(",").length), [100, 100, 30]);
  });
});

/* ------------------------------------------------------------------ *
 *  Mon compte : modifier, supprimer
 * ------------------------------------------------------------------ */

function fenetre() {
  const champs: Record<string, any> = {
    "#edit-title": { value: "Casque Adrian 1915" },
    "#edit-description": { value: "Coque d'origine, bombe repeinte." },
    "#edit-price": { value: "180" },
    "#edit-quantity": { value: "1" },
    "#edit-period": { value: "1ère Guerre Mondiale" },
    "#edit-subcategory": { value: "Casques" },
    "#edit-condition": { value: "Bon" },
    "#edit-status": { value: "published" },
    "#edit-location": { value: "Lyon" },
    "#edit-image-file": { files: [] },
    "#editSaveBtn": { disabled: false, textContent: "" },
  };
  return {
    dataset: { productId: "22" },
    __photoEnCours: false,
    __photoPreparee: { name: "nouvelle.webp", type: "image/webp" },
    __photosActuelles: [ANCIENNE, DEUXIEME],
    querySelector: (sel: string) => champs[sel] ?? null,
  };
}

async function enregistrer(produits: Reponse) {
  const b = bac("account.js", { produits });
  vm.runInContext(`MY_USER_ID = "${VENDEUR}"; closeEditListingModal = () => { __ferme = true; }; loadMyListings = () => {};`, b.ctx);
  await b.ctx.saveEditedListing(fenetre());
  const nouvelle = b.journal.find((l) => l.startsWith("upload "))?.split(":")[1] as string;
  return { ...b, nouvelle };
}

describe("modifier une annonce et remplacer sa photo (account.js)", () => {
  test("aucune ligne modifiée : refus affiché, la nouvelle photo sort du stockage, l'ancienne reste", async () => {
    const { journal, toasts, nouvelle, ctx } = await enregistrer({ data: [], error: null });
    assert.ok(nouvelle, "la nouvelle photo est envoyée avant l'écriture");
    assert.deepEqual(supprimes(journal), [nouvelle]);
    assert.ok(!journal.some((l) => l.includes("1759000000000")), "l'ancienne photo ne doit pas être touchée");
    assert.ok(!journal.some((l) => l.startsWith("purge ")));
    assert.deepEqual(toasts, [["erreur", dico.fr["tr_js_account.edit_not_saved"]]]);
    assert.equal(ctx.__ferme, undefined, "la fenêtre reste ouverte");
  });

  test("ligne confirmée : l'ancienne photo sort du stockage, après l'écriture, puis le cache", async () => {
    const { journal, nouvelle, ctx } = await enregistrer({ data: [{ id: 22 }], error: null });
    assert.deepEqual(supprimes(journal), [`${VENDEUR}/1759000000000.webp`]);
    assert.ok(!supprimes(journal).includes(nouvelle));
    const ordre = (debut: string) => journal.findIndex((l) => l.startsWith(debut));
    assert.ok(ordre("update products") < ordre("remove ") && ordre("remove ") < ordre("purge "), journal.join(" | "));
    assert.equal(ctx.__ferme, true);
  });

  test("erreur de la base : rien n'est effacé (la réponse perdue ne prouve pas que rien n'est écrit)", async () => {
    const { journal, toasts } = await enregistrer({ data: null, error: { message: "Failed to fetch" } });
    assert.deepEqual(supprimes(journal), []);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0][0], "erreur");
  });

  test("la requête demande les lignes modifiées (.select) et vise l'annonce du vendeur", async () => {
    const { requetes } = await enregistrer({ data: [{ id: 22 }], error: null });
    const maj = requetes.find((q) => q.table === "products" && q.appels.includes("update"));
    assert.deepEqual(maj?.appels, ["update", "eq", "eq", "select"]);
  });
});

describe("supprimer une annonce (account.js)", () => {
  const annonce = { id: 22, title: "Casque", image_url: ANCIENNE, image_urls: [ANCIENNE, DEUXIEME] };

  async function supprimer(produits: Reponse) {
    const b = bac("account.js", { produits });
    vm.runInContext(`MY_USER_ID = "${VENDEUR}"; loadMyListings = () => {};`, b.ctx);
    await b.ctx.deleteListing(annonce);
    return b;
  }

  test("aucune ligne supprimée : refus affiché, stockage intact, cache intact", async () => {
    const { journal, toasts } = await supprimer({ data: [], error: null });
    assert.deepEqual(supprimes(journal), []);
    assert.ok(!journal.some((l) => l.startsWith("purge ")));
    assert.deepEqual(toasts, [["erreur", dico.fr["tr_js_account.delete_not_done"]]]);
  });

  test("ligne confirmée : toutes les photos de la ligne supprimée, originaux avant /media/", async () => {
    const ligne = { id: 22, image_url: ANCIENNE, image_urls: [ANCIENNE, DEUXIEME, ENCODEE] };
    const { journal } = await supprimer({ data: [ligne], error: null });
    assert.deepEqual(supprimes(journal), [[`${VENDEUR}/1759000000000.webp`, `${VENDEUR}/1759000000001.webp`, `${VENDEUR}/photo casque.jpg`].join(",")]);
    assert.ok(journal.findIndex((l) => l.startsWith("remove ")) < journal.findIndex((l) => l.startsWith("purge ")));
  });
});

/* ------------------------------------------------------------------ *
 *  Modération : Mon compte > Modération, et la page d'administration
 * ------------------------------------------------------------------ */

describe("modération dans Mon compte (account.js)", () => {
  async function cliquerSupprimer(produits: Reponse) {
    const b = bac("account.js", { produits });
    let clic: (() => Promise<void>) | null = null;
    const bouton = { dataset: { id: "22", title: "Casque" }, disabled: false, textContent: "", addEventListener: (_t: string, f: () => Promise<void>) => { clic = f; } };
    const liste = { innerHTML: "", querySelectorAll: (sel: string) => (sel.includes('data-action="delete"') ? [bouton] : []) };
    b.ctx.document.getElementById = (id: string) => (id === "modList" ? liste : null);
    b.ctx.__produit = { id: 22, title: "Casque", status: "published", image_url: ANCIENNE, image_urls: [ANCIENNE, DEUXIEME], user_id: VENDEUR, created_at: "2026-10-01T10:00:00Z" };
    vm.runInContext("MOD_STATE.products = [__produit]; updateModerationStats = () => {};", b.ctx);
    b.ctx.renderModerationList();
    assert.ok(clic, "bouton Supprimer non branché");
    await (clic as unknown as () => Promise<void>)();
    return b;
  }

  test("suppression confirmée : originaux effacés avant les copies WebP", async () => {
    const { journal } = await cliquerSupprimer({ data: [{ id: 22, image_url: ANCIENNE, image_urls: [ANCIENNE, DEUXIEME] }], error: null });
    assert.deepEqual(supprimes(journal), [`${VENDEUR}/1759000000000.webp,${VENDEUR}/1759000000001.webp`]);
    assert.ok(journal.findIndex((l) => l.startsWith("remove ")) < journal.findIndex((l) => l.startsWith("purge ")));
  });

  test("suppression refusée (aucune ligne) : rien ne quitte le stockage", async () => {
    const { journal } = await cliquerSupprimer({ data: [], error: null });
    assert.deepEqual(supprimes(journal), []);
    assert.ok(!journal.some((l) => l.startsWith("purge ")));
  });

  test("suppression d'un membre : les originaux de ses annonces supprimées, puis /media/", async () => {
    const b = bac("account.js", { produits: { data: [{ id: 22, image_url: ANCIENNE, image_urls: [ANCIENNE, DEUXIEME] }], error: null } });
    vm.runInContext("loadModUsers = async () => {}; loadModBlockedBadge = () => {};", b.ctx);
    await b.ctx.handleModUserAction({ dataset: { modAction: "delete", uid: VENDEUR, email: "vendeur@test.local" } });
    assert.deepEqual(supprimes(b.journal), [`${VENDEUR}/1759000000000.webp,${VENDEUR}/1759000000001.webp`]);
    assert.ok(b.journal.findIndex((l) => l.startsWith("remove ")) < b.journal.findIndex((l) => l.startsWith("purge ")));
    const suppression = b.requetes.find((q) => q.table === "products" && q.appels.includes("delete"));
    assert.deepEqual(suppression?.appels, ["delete", "eq", "select"]);
  });
});

describe("page d'administration (admin.js)", () => {
  function admin(produits: Reponse) {
    const b = bac("admin.js", { produits });
    vm.runInContext("loadAdminReports = loadReportsBadge = loadAdminStats = loadAdminUsers = loadBlockedUsersBadge = loadAdminProducts = () => {};", b.ctx);
    return b;
  }
  const ligne = { id: 22, image_url: ANCIENNE, image_urls: [ANCIENNE, DEUXIEME] };

  test("article signalé supprimé : originaux, puis /media/, puis signalement clôturé", async () => {
    const b = admin({ data: [ligne], error: null });
    await b.ctx.handleReportAction({ dataset: { action: "delete-product", rid: "7", pid: "22" } });
    assert.deepEqual(supprimes(b.journal), [`${VENDEUR}/1759000000000.webp,${VENDEUR}/1759000000001.webp`]);
    const i = (debut: string) => b.journal.findIndex((l) => l.startsWith(debut));
    assert.ok(i("delete products") < i("remove ") && i("remove ") < i("purge ") && i("purge ") < i("update reports"), b.journal.join(" | "));
  });

  test("article signalé non supprimé (aucune ligne) : stockage intact, signalement ouvert, refus affiché", async () => {
    const b = admin({ data: [], error: null });
    await b.ctx.handleReportAction({ dataset: { action: "delete-product", rid: "7", pid: "22" } });
    assert.deepEqual(supprimes(b.journal), []);
    assert.ok(!b.journal.includes("update reports"), "le signalement ne doit pas être clôturé");
    assert.deepEqual(b.toasts, [["erreur", dico.fr["tr_js_admin.suppression_sans_effet"]]]);
  });

  test("suppression d'un compte : les originaux de toutes ses annonces supprimées", async () => {
    const autre = { id: 23, image_url: ENCODEE, image_urls: [ENCODEE] };
    const b = admin({ data: [ligne, autre], error: null });
    await b.ctx.handleUserAction({ dataset: { action: "delete", uid: VENDEUR, email: "vendeur@test.local" } });
    assert.deepEqual(supprimes(b.journal), [`${VENDEUR}/1759000000000.webp,${VENDEUR}/1759000000001.webp,${VENDEUR}/photo casque.jpg`]);
  });

  test("chaque suppression de products relit ses lignes (.select) avant de toucher au stockage", () => {
    const source = lire("admin.js");
    const suppressions = [...source.matchAll(/from\("products"\)\.delete\(\)[^;]*;/g)].map((m) => m[0]);
    assert.equal(suppressions.length, 3);
    for (const s of suppressions) assert.match(s, /\.select\("id, image_url, image_urls"\)/, s);
    assert.doesNotMatch(source, /storage\.from\("product-images"\)\.remove/, "passer par supprimerOriginaux (script.js)");
  });
});

describe("libellés des refus", () => {
  test("présents en français et en anglais, typographie française", () => {
    for (const cle of ["tr_js_account.edit_not_saved", "tr_js_account.delete_not_done", "tr_js_admin.suppression_sans_effet"]) {
      const fr = dico.fr[cle];
      const en = dico.en[cle];
      assert.ok(fr && en && fr !== en, `${cle} : absente ou non traduite (node build-i18n-dict.cjs)`);
      assert.doesNotMatch(fr, / [:;?!]/, `${cle} : espace ordinaire avant : ; ? !`);
      assert.match(fr, / :/, `${cle} : espace insécable avant les deux-points`);
      assert.doesNotMatch(fr + en, /[—–]/, `${cle} : tiret cadratin`);
    }
  });
});
