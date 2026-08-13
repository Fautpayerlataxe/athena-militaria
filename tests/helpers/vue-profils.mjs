import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connecter } from "./connexion.mjs";

const password = execFileSync("/usr/bin/security", ["find-generic-password","-a",process.env.USER??"","-s","athena-supabase-db","-w"],
  { encoding:"utf8", stdio:["ignore","pipe","ignore"] }).trim();
const c = await connecter();

const droits = await c.query(`
  SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) p
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='public_profiles' AND grantee IN ('anon','authenticated')
   GROUP BY grantee ORDER BY grantee`);
droits.rows.forEach(r => console.log(`  ${r.grantee.padEnd(15)} ${r.p}`));

const v = await c.query(`SELECT reloptions FROM pg_class WHERE relname='public_profiles'`);
console.log(`  options de la vue : ${v.rows[0]?.reloptions ?? "aucune (donc security_invoker désactivé)"}`);

const victime = randomUUID();
await c.query("BEGIN");
try {
  await c.query(`INSERT INTO auth.users (id, email, created_at) VALUES ($1,'cible@test.invalid', now())`, [victime]);
  await c.query(`UPDATE public.profiles SET pseudo = 'Intact' WHERE id = $1`, [victime]);
  await c.query(`SELECT set_config('request.jwt.claims', '{"role":"anon","aud":"anon"}', true)`);
  await c.query("SET LOCAL ROLE anon");
  /* Le troisième champ est la PREUVE DU DÉGÂT : une requête qui ne rend une
     ligne que si l'attaque a réellement modifié la base. Sans elle, un ordre
     avalé en silence par une règle DO INSTEAD NOTHING passerait pour un
     succès, alors que rien n'a bougé. */
  for (const [quoi, ordre, preuve] of [
    ["avatar_url", `UPDATE public.public_profiles SET avatar_url = 'https://pirate.invalid/a.png' WHERE id = $1`,
     `SELECT 1 FROM public.profiles WHERE id = $1 AND avatar_url = 'https://pirate.invalid/a.png'`],
    ["location", `UPDATE public.public_profiles SET location = 'Pwned' WHERE id = $1`,
     `SELECT 1 FROM public.profiles WHERE id = $1 AND location = 'Pwned'`],
    ["tous les profils d'un coup", `UPDATE public.public_profiles SET location = 'Partout'`,
     `SELECT 1 FROM public.profiles WHERE location = 'Partout'`],
    ["suppression d'un profil", `DELETE FROM public.public_profiles WHERE id = $1`,
     `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = $1)`],
  ]) {
    await c.query("SAVEPOINT s");
    try {
      await c.query(ordre, ordre.includes("$1") ? [victime] : []);
      await c.query("RESET ROLE");
      const r = await c.query(preuve, preuve.includes("$1") ? [victime] : []);
      if ((r.rowCount ?? 0) > 0) console.log(`  [!!] ${quoi} : DÉGÂT RÉEL`);
      else console.log(`  [ok] ${quoi} : ordre accepté mais sans effet`);
      await c.query(`SELECT set_config('request.jwt.claims', '{"role":"anon","aud":"anon"}', true)`);
      await c.query("SET LOCAL ROLE anon");
    } catch (e) {
      console.log(`  [ok] ${quoi} : refusé (${String(e.message).split("\n")[0].slice(0,60)})`);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query(`SELECT set_config('request.jwt.claims', '{"role":"anon","aud":"anon"}', true)`);
      await c.query("SET LOCAL ROLE anon");
    }
  }
} finally { await c.query("ROLLBACK"); await c.end(); }
