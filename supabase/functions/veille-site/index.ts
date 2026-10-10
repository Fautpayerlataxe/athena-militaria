/**
 * Veille du site, appelée toutes les dix minutes par la tâche pg_cron
 * « veille-site » (migration 20261010000100_veille_site.sql).
 *
 * Elle charge quelques adresses publiques du site, garde l'état dans la table
 * veille_site (une seule ligne) et écrit à l'exploitant au deuxième échec de
 * suite, puis au retour. La décision est dans veille.ts, testée sous Node.
 *
 * Même garde que payout-release et payments-monitor : l'en-tête
 * x-cron-secret doit valoir PAYMENTS_CRON_SECRET, que seule la tâche connaît.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decider, type Controle, type EtatVeille } from "./veille.ts";

const ADMIN_EMAIL = "contact@athenamilitaria.fr";
const SITE = "https://www.athenamilitaria.fr";

/* Une page de chaque famille : l'accueil (PHP), un guide (fichier statique),
   le plan du site (lu par Google) et le flux Shopping (lu par le Merchant
   Center). Le contenu attendu évite de prendre pour un succès une page de
   suspension de l'hébergeur servie en 200. */
const ADRESSES: Array<{ url: string; attendu: string }> = [
  { url: `${SITE}/`, attendu: "Athena Militaria" },
  { url: `${SITE}/guides/vendre-militaria-legalement-france`, attendu: "Athena Militaria" },
  { url: `${SITE}/sitemap.xml`, attendu: "<sitemapindex" },
  { url: `${SITE}/flux-produits.xml`, attendu: "<rss" },
];

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function controler(url: string, attendu: string): Promise<Controle> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "AthenaMilitaria-Veille/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (r.status !== 200) return { url, ok: false, detail: `réponse ${r.status}` };
    const texte = await r.text();
    if (!texte.includes(attendu)) return { url, ok: false, detail: "contenu inattendu" };
    return { url, ok: true, detail: "200" };
  } catch (e) {
    const nom = (e as Error)?.name === "TimeoutError" ? "pas de réponse en 15 s" : String((e as Error)?.message ?? e).slice(0, 120);
    return { url, ok: false, detail: nom };
  }
}

/* contact@ est hébergée chez OVH, le prestataire même dont la veille doit
 * signaler la panne : si la messagerie liée à l'hébergement tombe avec lui,
 * Resend accepte l'envoi et le message rebondit. Une adresse de secours hors
 * du domaine, lue dans le secret ALERTE_SECOURS, reçoit alors aussi l'alerte.
 * Sans ce secret, rien ne change. */
function destinataires(): string[] {
  const secours = (Deno.env.get("ALERTE_SECOURS") ?? "").trim();
  return secours.includes("@") && secours.toLowerCase() !== ADMIN_EMAIL ? [ADMIN_EMAIL, secours] : [ADMIN_EMAIL];
}

async function envoyer(sujet: string, corps: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: "Athena Militaria <noreply@athenamilitaria.fr>", to: destinataires(), subject: sujet, text: corps }),
  }).catch(() => null);
  return !!r && r.ok;
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("PAYMENTS_CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const controles = await Promise.all(ADRESSES.map((a) => controler(a.url, a.attendu)));
  const { data } = await admin.from("veille_site").select("echecs_consecutifs, en_panne, panne_depuis").eq("id", 1).maybeSingle();
  const precedent: EtatVeille = {
    echecs_consecutifs: data?.echecs_consecutifs ?? 0,
    en_panne: data?.en_panne ?? false,
    panne_depuis: data?.panne_depuis ?? null,
  };
  const maintenant = new Date();
  const { etat, courriel } = decider(precedent, controles, maintenant);

  // Un courriel qui ne part pas (Resend en panne) laisse l'état inchangé :
  // la tâche suivante réessaiera au lieu de croire l'alerte donnée.
  let parti = true;
  if (courriel) parti = await envoyer(courriel.sujet, courriel.corps);
  if (parti) {
    await admin.from("veille_site").upsert({
      id: 1, ...etat, dernier_controle: maintenant.toISOString(),
      dernier_detail: controles.filter((c) => !c.ok).map((c) => `${c.url} : ${c.detail}`).join(" | ") || null,
    });
  }

  console.log(JSON.stringify({ scope: "veille_site", ok: controles.every((c) => c.ok), echecs: etat.echecs_consecutifs, alerte: courriel?.sujet ?? null, parti }));
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
