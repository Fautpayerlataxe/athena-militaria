/* ==========================================================================
   Mesure d'audience, et le consentement qui la conditionne

   Tant que IDENTIFIANT_MESURE est vide, ce fichier ne fait strictement rien :
   pas de bandeau, pas de script tiers, pas de cookie. C'est volontaire.
   Afficher une demande de consentement alors qu'aucun traceur n'existe
   reviendrait à faire payer à chaque visiteur le prix d'une fonctionnalité
   qui n'est pas là, et à habituer les gens à cliquer sans lire.

   Quand l'identifiant sera renseigné, la règle appliquée est celle de la
   CNIL : aucun dépôt avant un acte positif. Google Analytics n'entre pas
   dans les exemptions de consentement pour la mesure d'audience, donc rien
   n'est chargé, pas même le script de Google, avant un « Accepter ». Le
   mode « consentement par défaut refusé » de Google, qui charge la
   bibliothèque tout de suite, n'est pas retenu : il fait partir une requête
   vers un domaine tiers sur une page que le visiteur n'a pas encore acceptée.

   Durées : un accord vaut treize mois, un refus est respecté six mois avant
   qu'on ose reposer la question. Ce sont les durées recommandées par la
   CNIL, et le refus est volontairement plus long que le cycle d'un
   bandeau agressif.
   ========================================================================== */

(function () {
  "use strict";

  /* Identifiant de mesure GA4, de la forme G-XXXXXXXXXX.
     Vide = aucune mesure, aucun bandeau.

     Volontairement vidé le 21 septembre 2026, le temps qu'Augustin dise à
     quoi il veut que le bandeau ressemble. Le 5 octobre 2026, il a préféré
     ne garder qu'un seul message à l'écran : l'audience est désormais
     comptée sans cookie ni bandeau (mesure.php, tableau de bord dans
     Mon compte > Modération > Audience). Ce fichier reste en place, inerte. On ne retire pas le bandeau en
     laissant la mesure : sans consentement, Google Analytics n'entre dans
     aucune exemption, et le site collecterait illégalement.
     La propriété reste créée ; pour rallumer, remettre G-DELVH23KW8. */
  var IDENTIFIANT_MESURE = "";

  var CLE = "athena_mesure";
  var JOUR = 86400000;
  var DUREE_ACCORD = 396 * JOUR;   // treize mois
  var DUREE_REFUS = 183 * JOUR;    // six mois

  function lire() {
    try {
      var brut = localStorage.getItem(CLE);
      if (!brut) return null;
      var v = JSON.parse(brut);
      if (v.choix !== "oui" && v.choix !== "non") return null;
      var duree = v.choix === "oui" ? DUREE_ACCORD : DUREE_REFUS;
      if (!v.date || Date.now() - v.date > duree) return null;
      return v.choix;
    } catch (e) { return null; }
  }

  function ecrire(choix) {
    try { localStorage.setItem(CLE, JSON.stringify({ choix: choix, date: Date.now() })); } catch (e) {}
  }

  function t(cle, secours) {
    return (window.I18N && typeof window.I18N.t === "function" && window.I18N.t(cle) !== cle)
      ? window.I18N.t(cle) : secours;
  }

  /* --- Chargement de la mesure, uniquement après un accord --- */
  var charge = false;
  function charger() {
    if (charge || !IDENTIFIANT_MESURE) return;
    charge = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    /* anonymize_ip reste posé explicitement : l'option est implicite dans
       GA4, la déclarer coûte une ligne et se vérifie dans le code servi. */
    window.gtag("config", IDENTIFIANT_MESURE, { anonymize_ip: true });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(IDENTIFIANT_MESURE);
    document.head.appendChild(s);
  }

  /* --- Bandeau ---
     Position fixe et hors du flux : il ne pousse rien, donc il ne déplace
     aucun contenu sous le doigt du visiteur pendant le chargement. */
  var bandeau = null;

  function fermer() {
    if (!bandeau) return;
    bandeau.remove();
    bandeau = null;
  }

  function repondre(choix) {
    ecrire(choix);
    fermer();
    if (choix === "oui") charger();
  }

  function afficher() {
    if (bandeau || !IDENTIFIANT_MESURE) return;
    bandeau = document.createElement("div");
    bandeau.className = "bandeau-mesure";
    /* Une région annoncée, pas une fenêtre qui prend la main : le bandeau
       ne bloque rien, et lui donner le focus à l'ouverture dessinait le
       cadre noir de focus autour de « Refuser » sans que personne n'ait
       touché au clavier (relevé le 5 oct. 2026). */
    bandeau.setAttribute("role", "region");
    bandeau.setAttribute("aria-live", "polite");
    bandeau.setAttribute("aria-label", t("cookies.titre", "Mesure d'audience"));

    var texte = document.createElement("p");
    texte.className = "bandeau-mesure-texte";
    texte.textContent = t("cookies.texte",
      "Nous aimerions compter les visites, pour savoir quelles pages vous servent vraiment. "
      + "Rien n'est déposé sans votre accord, et vous pouvez changer d'avis à tout moment.");
    var lien = document.createElement("a");
    lien.href = "/legal#cookies";
    lien.textContent = t("cookies.lien", "En savoir plus");
    texte.appendChild(document.createTextNode(" "));
    texte.appendChild(lien);

    var actions = document.createElement("div");
    actions.className = "bandeau-mesure-actions";

    var refuser = document.createElement("button");
    refuser.type = "button";
    refuser.className = "btn outline";
    refuser.textContent = t("cookies.refuser", "Refuser");
    refuser.addEventListener("click", function () { repondre("non"); });

    var accepter = document.createElement("button");
    accepter.type = "button";
    accepter.className = "cta-btn";
    accepter.textContent = t("cookies.accepter", "Accepter");
    accepter.addEventListener("click", function () { repondre("oui"); });

    /* Refuser d'abord : les deux choix doivent être aussi faciles l'un que
       l'autre, et l'ordre de lecture ne doit pas pousser vers l'accord. */
    actions.appendChild(refuser);
    actions.appendChild(accepter);
    bandeau.appendChild(texte);
    bandeau.appendChild(actions);
    document.body.appendChild(bandeau);
  }

  /* Rouvrir le choix depuis le pied de page ou les mentions légales. */
  window.revoirMesure = function () {
    if (!IDENTIFIANT_MESURE) return false;
    try { localStorage.removeItem(CLE); } catch (e) {}
    afficher();
    return true;
  };

  /** Pour les mentions légales : dire ce qui est réellement en place. */
  window.mesureActive = function () { return Boolean(IDENTIFIANT_MESURE); };

  function demarrer() {
    /* Le lien du pied de page ne s'affiche que s'il mène quelque part : sans
       mesure en place, il n'y a aucun choix à revoir, et un lien qui ne fait
       rien use la confiance plus sûrement qu'un lien absent. */
    var lien = document.getElementById("lien-mesure");
    if (lien) {
      if (IDENTIFIANT_MESURE) {
        lien.hidden = false;
        var a = lien.querySelector("a");
        if (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            window.revoirMesure();
          });
        }
      } else {
        lien.remove();
      }
    }
    if (!IDENTIFIANT_MESURE) return;
    var choix = lire();
    if (choix === "oui") { charger(); return; }
    if (choix === "non") return;
    afficher();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})();
