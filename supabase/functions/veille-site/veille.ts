/**
 * Veille du site : décider, à partir des contrôles qui viennent d'être faits
 * et de l'état précédent, s'il faut prévenir l'exploitant.
 *
 * Pourquoi : pendant la coupure de l'hébergement OVH (septembre-octobre 2026),
 * le site est resté injoignable plusieurs jours sans que personne en soit
 * prévenu ; Google, lui, l'a vu. Une alerte au deuxième échec consécutif
 * (vingt minutes avec une tâche toutes les dix minutes) évite les fausses
 * alertes d'un simple hoquet réseau, et un second courriel annonce le retour.
 *
 * Aucune dépendance : testable sous Node (tests/veille-site.test.ts).
 */

export type Controle = { url: string; ok: boolean; detail: string };

export type EtatVeille = {
  echecs_consecutifs: number;
  en_panne: boolean;
  panne_depuis: string | null;
};

export type Decision = {
  etat: EtatVeille;
  courriel: null | { sujet: string; corps: string };
};

/** Nombre d'échecs consécutifs avant d'écrire. */
export const SEUIL_ALERTE = 2;

const NBSP = " ";

/** « 2 h 15 min », « 35 min » : durée lisible d'une panne. */
export function duree(depuisIso: string | null, maintenant: Date): string {
  if (!depuisIso) return "une durée inconnue";
  const minutes = Math.max(0, Math.round((maintenant.getTime() - new Date(depuisIso).getTime()) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}${NBSP}h${NBSP}${m}${NBSP}min` : `${m}${NBSP}min`;
}

/** Heure de Paris, au format des autres courriels du site. */
export function heureParis(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(d).replace(":", `${NBSP}h${NBSP}`).replace(" à ", ` à${NBSP}`);
}

export function decider(precedent: EtatVeille, controles: Controle[], maintenant: Date): Decision {
  const echecs = controles.filter((c) => !c.ok);
  const lignes = controles.map((c) => `${c.ok ? "OK" : "ÉCHEC"}${NBSP}: ${c.url} (${c.detail})`).join("\n");

  if (echecs.length === 0) {
    const etat: EtatVeille = { echecs_consecutifs: 0, en_panne: false, panne_depuis: null };
    if (!precedent.en_panne) return { etat, courriel: null };
    return {
      etat,
      courriel: {
        sujet: "Athena Militaria répond de nouveau",
        corps: `Bonjour,\n\nLe site athenamilitaria.fr répond de nouveau normalement depuis le ${heureParis(maintenant)}, après une interruption d'environ ${duree(precedent.panne_depuis, maintenant)}.\n\nContrôles${NBSP}:\n${lignes}\n\nSi l'interruption a duré plusieurs heures, il peut être utile de demander une nouvelle exploration des pages principales dans la Search Console.\n\nLa veille automatique d'Athena Militaria`,
      },
    };
  }

  const nb = precedent.echecs_consecutifs + 1;
  const panneDepuis = precedent.panne_depuis ?? maintenant.toISOString();
  const etat: EtatVeille = { echecs_consecutifs: nb, en_panne: precedent.en_panne || nb >= SEUIL_ALERTE, panne_depuis: panneDepuis };
  if (precedent.en_panne || nb < SEUIL_ALERTE) return { etat, courriel: null };
  return {
    etat,
    courriel: {
      sujet: "Athena Militaria ne répond plus",
      corps: `Bonjour,\n\nLe site athenamilitaria.fr ne répond plus correctement depuis le ${heureParis(new Date(panneDepuis))} (${nb} contrôles de suite en échec, à dix minutes d'intervalle).\n\nContrôles${NBSP}:\n${lignes}\n\nÀ vérifier en premier${NBSP}: l'espace client OVH (hébergement, domaine, certificat HTTPS). Un second courriel vous préviendra dès que le site répondra de nouveau.\n\nLa veille automatique d'Athena Militaria`,
    },
  };
}
