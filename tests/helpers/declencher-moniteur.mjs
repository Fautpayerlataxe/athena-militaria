/* Déclenche payments-monitor comme le fait la tâche planifiée, en lisant le
   secret dans Vault, et affiche son diagnostic. Aucune écriture financière. */
import { execFileSync } from "node:child_process";
import { connecter } from "./connexion.mjs";

const password = execFileSync("/usr/bin/security", ["find-generic-password","-a",process.env.USER??"","-s","athena-supabase-db","-w"],
  { encoding:"utf8", stdio:["ignore","pipe","ignore"] }).trim();
const c = await connecter();
const { rows:[{ id }] } = await c.query(`
  SELECT net.http_post(
    url := 'https://uctaxgfqdoxtcidllyjv.supabase.co/functions/v1/payments-monitor',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.payments_cron_secret()),
    body := '{}'::jsonb) AS id`);
await new Promise(r => setTimeout(r, 22000));
const { rows } = await c.query("SELECT status_code, content FROM net._http_response WHERE id=$1", [id]);
await c.end();
if (!rows[0]) { console.log("  aucune réponse enregistrée"); process.exit(1); }
console.log(`  réponse HTTP ${rows[0].status_code}`);
try {
  const j = JSON.parse(rows[0].content);
  console.log(`  environnement Stripe : ${j.stripe.mode}`);
  const cpt = j.stripe.compte ?? {};
  if (Object.keys(cpt).length) {
    console.log(`  compte : encaisse ${cpt.encaisse ? "OUI" : "NON"} · virements ${cpt.verse ? "OUI" : "NON"} · ${cpt.pays} · ${String(cpt.devise).toUpperCase()}`);
  }
  for (const e of j.stripe.endpoints ?? []) {
    console.log(`  endpoint ${e.id}  mode ${e.mode}  actif ${e.actif}  événements ${e.evenements}  manquants ${e.manquants.length}`);
    if (e.manquants.length) console.log(`      ${e.manquants.join(", ")}`);
  }
  console.log(`  anomalies : ${j.anomalies}`);
  (j.details?.critiques ?? []).forEach(l => console.log(`    [critique] ${l}`));
  (j.details?.a_surveiller ?? []).forEach(l => console.log(`    [surveiller] ${l}`));
} catch { console.log("  " + rows[0].content.slice(0, 400)); }
