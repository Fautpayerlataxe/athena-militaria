/* =====================================================================
   Client Supabase, chargé seulement quand il sert.

   La bibliothèque supabase-js pèse 55 Ko compressés et vient d'un autre
   domaine (jsDelivr) : deux connexions et un téléchargement, sur chaque
   page. Or un guide lu par un visiteur déconnecté n'interroge jamais la
   base : les annonces, le catalogue et les fiches sont désormais écrits
   par le serveur (product.php, category.php, page.php).

   Deux situations :
     - la page charge la bibliothèque elle-même (balise script avant
       celle-ci) : le client est créé tout de suite, comme avant ;
     - la page ne la charge pas : chargerSupabase() va la chercher au
       premier besoin réel (connexion, dépôt d'annonce, filtre, favori).
       Un visiteur déjà connecté (jeton en localStorage) la reçoit dès
       l'arrivée, pour que l'en-tête affiche son compte sans délai.

   window.sb reste la même chose qu'avant une fois le client créé.
   ===================================================================== */

const SUPABASE_URL = "https://uctaxgfqdoxtcidllyjv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjdGF4Z2ZxZG94dGNpZGxseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NzQ0NzgsImV4cCI6MjA5MTQ1MDQ3OH0.AEFktTgMmccF0UiKcCiJBTej0Px5q6_jqi7l7hgePVA";

// Exposées explicitement : product.js recopiait la clé anon en dur dans son
// propre fichier. Deux copies d'une même valeur finissent par diverger, et
// celle-ci sert à joindre les fonctions de paiement.
// `const` ne s'attache pas à window, d'où l'affectation manuelle.
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

const CDN_SUPABASE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

function creerClient() {
  if (!window.sb) window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return window.sb;
}

/* Un visiteur connecté a un jeton de session en localStorage. Même test que
   le script du bandeau d'accueil. */
function jetonPresent() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.+-auth-token$/.test(k) && localStorage.getItem(k)) return true;
    }
  } catch (e) { /* stockage refusé : on considère qu'il n'y a pas de session */ }
  return false;
}
window.sessionPossible = jetonPresent;

let promesse = null;

/** Rend le client Supabase, en chargeant la bibliothèque si nécessaire. */
window.chargerSupabase = function () {
  if (window.sb) return Promise.resolve(window.sb);
  if (window.supabase) return Promise.resolve(creerClient());
  if (promesse) return promesse;
  promesse = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CDN_SUPABASE;
    s.onload = () => resolve(creerClient());
    s.onerror = () => { promesse = null; reject(new Error("supabase-js injoignable")); };
    document.head.appendChild(s);
  });
  return promesse;
};

if (window.supabase) {
  creerClient();
} else if (jetonPresent()) {
  window.chargerSupabase();
}
