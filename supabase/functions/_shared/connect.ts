/**
 * Comptes vendeurs Stripe Connect : relire chez Stripe, puis aligner la base.
 *
 * Un seul chemin pour quatre appelants : le webhook (account.updated), le
 * retour d'inscription (connect-onboard), la surveillance toutes les 6 h
 * (payments-monitor) et l'ouverture d'un paiement (create-checkout). Avoir
 * quatre versions de « ce compte est-il prêt ? » est exactement ce qui finit
 * par laisser vendre un vendeur que Stripe ne peut pas payer.
 *
 * Trois principes :
 *
 *   - l'état vient de Stripe, relu au moment de décider, jamais de la charge
 *     utile d'un événement. Stripe ne garantit pas l'ordre de livraison : un
 *     account.updated ancien qui arrive après un récent ferait sinon
 *     repasser un vendeur prêt en « non prêt », ou l'inverse ;
 *   - l'écriture est conditionnée à l'identifiant lu. Si le vendeur a obtenu
 *     un nouveau compte entre la lecture et l'écriture, l'écriture ne touche
 *     rien : on n'efface jamais un compte qu'on n'a pas relu ;
 *   - un identifiant effacé est journalisé en entier. Ce n'est pas un secret,
 *     et c'est la seule trace qui permette de le remettre si l'effacement
 *     était une erreur (clé d'un autre compte Stripe, par exemple). Sans
 *     elle, il faudrait fouiller Stripe compte par compte.
 *
 * Les dépendances sont injectées, comme dans fulfillment.ts, pour que toute
 * cette logique soit testable sous Node sans réseau (tests/payments.test.ts).
 */

import {
  compteConnectIntrouvable,
  connectAccountReady,
  type IssueSynchro,
  type LectureCompte,
  logEvent,
  planSynchroConnect,
  redactSecrets,
  type StripeMode,
} from "./payments.ts";

type Loose = Record<string, unknown>;
type ErreurBase = { message?: string } | null;

export interface ConnectStripeLike {
  accounts: {
    retrieve(id: string): Promise<unknown>;
  };
}

export interface ConnectDbLike {
  /** Applique `patch` au profil `id`, seulement si son stripe_account_id vaut
   *  encore `compteLu`. Zéro ligne modifiée n'est pas une erreur : `modifie`
   *  le dit. */
  majProfil(id: string, compteLu: string, patch: Loose): Promise<{ error: ErreurBase; modifie: boolean }>;
}

export interface ConnectDeps {
  stripe: ConnectStripeLike;
  db: ConnectDbLike;
  /** Mode de la clé Stripe du déploiement : seul « live » autorise à effacer
   *  un compte introuvable (voir compteEffacable). */
  keyMode: StripeMode;
  now?: () => Date;
  /** Journal ; logEvent par défaut. Injecté pour que les tests le lisent. */
  journal?: (scope: string, fields: Record<string, unknown>) => void;
}

export type ProfilConnect = {
  id: string;
  stripe_account_id: string | null;
  stripe_onboarded?: boolean | null;
};

export type SynchroConnect = {
  issue: IssueSynchro | "sans_compte";
  lecture: LectureCompte | null;
  /** Une ligne a-t-elle réellement changé en base ? Faux si rien n'était à
   *  écrire, ou si l'identifiant avait changé entre la lecture et l'écriture. */
  ecrit: boolean;
};

/**
 * Relit un compte chez Stripe. Renvoie « introuvable » seulement quand Stripe
 * le dit ; toute autre erreur remonte, pour que l'appelant choisisse entre
 * réessayer (webhook : 500), passer son tour (surveillance) ou laisser faire
 * (paiement).
 */
export async function lireCompteConnect(stripe: ConnectStripeLike, accountId: string): Promise<LectureCompte> {
  try {
    const compte = ((await stripe.accounts.retrieve(accountId)) ?? {}) as Loose;
    if (compte.deleted === true) return { etat: "introuvable", motif: "compte supprimé chez Stripe" };
    return { etat: "present", pret: connectAccountReady(compte) };
  } catch (err) {
    if (compteConnectIntrouvable(err)) {
      return { etat: "introuvable", motif: redactSecrets((err as Error)?.message ?? String(err)) };
    }
    throw err;
  }
}

/**
 * Aligne le profil sur une lecture déjà faite. Séparé de la lecture pour que
 * la surveillance puisse tout lire d'abord, puis décider d'effacer ou non
 * (voir effacementsSuspects).
 */
export async function appliquerSynchroConnect(
  deps: ConnectDeps,
  profil: ProfilConnect,
  lecture: LectureCompte,
  options: { effacer?: boolean } = {},
): Promise<SynchroConnect> {
  const compteLu = profil.stripe_account_id;
  if (!compteLu) return { issue: "sans_compte", lecture: null, ecrit: false };

  const { issue, patch } = planSynchroConnect(
    profil, lecture, deps.keyMode, (deps.now?.() ?? new Date()).toISOString(), options,
  );
  if (!patch) return { issue, lecture, ecrit: false };

  const { error, modifie } = await deps.db.majProfil(profil.id, compteLu, patch);
  if (error) throw new Error(`profiles.update: ${error.message ?? "erreur inconnue"}`);

  if (issue === "introuvable_efface" && modifie) {
    (deps.journal ?? logEvent)("connect_account_erased", {
      profile_id: profil.id,
      account_id: compteLu,
      etait_pret: profil.stripe_onboarded === true,
      motif: lecture.etat === "introuvable" ? lecture.motif : null,
      key_mode: deps.keyMode,
    });
  }
  return { issue, lecture, ecrit: modifie };
}

/** Relit le compte du profil et aligne stripe_account_id / stripe_onboarded. */
export async function synchroniserProfilConnect(
  deps: ConnectDeps,
  profil: ProfilConnect,
  options: { effacer?: boolean } = {},
): Promise<SynchroConnect> {
  const compteLu = profil.stripe_account_id;
  if (!compteLu) return { issue: "sans_compte", lecture: null, ecrit: false };
  const lecture = await lireCompteConnect(deps.stripe, compteLu);
  return appliquerSynchroConnect(deps, profil, lecture, options);
}

/* ------------------------------------------------------------------ *
 *  Enregistrer un compte neuf
 * ------------------------------------------------------------------ */

export interface EnregistrementDbLike {
  /** Pose `nouveau` (non prêt) sur le profil, seulement si son identifiant
   *  vaut encore `ancien` ou est vide. */
  poserCompte(id: string, ancien: string | null, nouveau: string): Promise<{ error: ErreurBase; modifie: boolean }>;
  compteActuel(id: string): Promise<{ error: ErreurBase; compte: string | null }>;
}

export type Enregistrement = "enregistre" | "deja_enregistre" | { conflit: string | null };

/**
 * Enregistre le compte Express qu'on vient de créer, sans jamais écraser un
 * compte qu'on n'a pas vu.
 *
 * Pour un remplacement (compte de test introuvable avec la clé live),
 * l'ancien identifiant n'est PAS effacé d'abord : le compte neuf le remplace
 * en une seule écriture, conditionnée à l'ancien. Si cette écriture échoue,
 * l'ancien reste en base, le prochain essai relit le même ancien compte,
 * reprend la même clé d'idempotence et retombe sur le même compte neuf. Dans
 * l'ordre inverse (effacer, puis créer, puis écrire), un échec laissait le
 * profil vide, le prochain essai prenait une autre clé, et le premier compte
 * neuf restait orphelin chez Stripe.
 *
 * L'identifiant vide est accepté aussi : la surveillance a pu effacer
 * l'ancien entre-temps. Si la ligne n'a pas bougé, on relit : la même valeur
 * vient d'une requête jumelle (double clic), une autre valeur est un conflit
 * que l'appelant signale sans écraser.
 */
export async function enregistrerCompteConnect(
  db: EnregistrementDbLike,
  userId: string,
  ancien: string | null,
  nouveau: string,
): Promise<Enregistrement> {
  const { error, modifie } = await db.poserCompte(userId, ancien, nouveau);
  if (error) throw new Error(`profiles.update: ${error.message ?? "erreur inconnue"}`);
  if (modifie) return "enregistre";

  const actuel = await db.compteActuel(userId);
  if (actuel.error) throw new Error(`profiles.select: ${actuel.error.message ?? "erreur inconnue"}`);
  return actuel.compte === nouveau ? "deja_enregistre" : { conflit: actuel.compte };
}

/* ------------------------------------------------------------------ *
 *  Adaptateur Supabase
 * ------------------------------------------------------------------ */

type Resultat = { data: unknown; error: ErreurBase };

/** Le constructeur de requêtes de supabase-js, réduit à ce qui sert ici. */
export interface RequeteLike extends PromiseLike<Resultat> {
  eq(colonne: string, valeur: unknown): RequeteLike;
  is(colonne: string, valeur: null): RequeteLike;
  or(filtre: string): RequeteLike;
  select(colonnes: string): RequeteLike;
  maybeSingle(): PromiseLike<Resultat>;
}

export interface SupabaseLike {
  from(table: string): {
    update(patch: Loose): RequeteLike;
    select(colonnes: string): RequeteLike;
  };
}

/** Un identifiant de compte entre dans un filtre PostgREST écrit en texte :
 *  on n'y laisse passer que la forme exacte d'un identifiant Stripe. */
function identifiantSur(compte: string): string {
  if (!/^acct_[A-Za-z0-9]+$/.test(compte)) throw new Error("identifiant de compte inattendu en base");
  return compte;
}

function lignes(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

export function profilsConnect(client: SupabaseLike): ConnectDbLike & EnregistrementDbLike {
  return {
    async majProfil(id, compteLu, patch) {
      const { data, error } = await client.from("profiles").update(patch)
        .eq("id", id).eq("stripe_account_id", compteLu).select("id");
      return { error, modifie: lignes(data) > 0 };
    },

    async poserCompte(id, ancien, nouveau) {
      const patch = { stripe_account_id: nouveau, stripe_onboarded: false, stripe_onboarded_at: null };
      const base = client.from("profiles").update(patch).eq("id", id);
      const filtre = ancien
        ? base.or(`stripe_account_id.is.null,stripe_account_id.eq.${identifiantSur(ancien)}`)
        : base.is("stripe_account_id", null);
      const { data, error } = await filtre.select("id");
      return { error, modifie: lignes(data) > 0 };
    },

    async compteActuel(id) {
      const { data, error } = await client.from("profiles").select("stripe_account_id").eq("id", id).maybeSingle();
      const compte = (data as { stripe_account_id?: string | null } | null)?.stripe_account_id ?? null;
      return { error, compte };
    },
  };
}
