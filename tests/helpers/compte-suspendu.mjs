import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connecter } from "./connexion.mjs";

const password = execFileSync("/usr/bin/security", ["find-generic-password","-a",process.env.USER??"","-s","athena-supabase-db","-w"],
  { encoding:"utf8", stdio:["ignore","pipe","ignore"] }).trim();
const c = await connecter();

console.log("  politiques INSERT sur products :");
const pol = await c.query(`SELECT policyname, permissive, coalesce(with_check,'') w FROM pg_policies
  WHERE schemaname='public' AND tablename='products' AND cmd='INSERT' ORDER BY policyname`);
pol.rows.forEach(r => console.log(`    ${r.permissive === 'PERMISSIVE' ? 'permissive ' : 'RESTRICTIVE'} ${r.policyname}\n        ${r.w.replace(/\s+/g,' ').slice(0,150)}`));

const banni = randomUUID();
await c.query("BEGIN");
try {
  await c.query(`INSERT INTO auth.users (id, email, created_at) VALUES ($1,'banni@test.invalid', now())`, [banni]);
  await c.query(`UPDATE public.profiles SET blocked = true, block_reason = 'fraude' WHERE id = $1`, [banni]);
  const v = await c.query(`SELECT blocked FROM public.profiles WHERE id = $1`, [banni]);
  console.log(`\n  compte de test suspendu : blocked = ${v.rows[0].blocked}`);

  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub:banni, role:"authenticated", aud:"authenticated"})]);
  await c.query("SET LOCAL ROLE authenticated");
  try {
    const r = await c.query(`INSERT INTO public.products (user_id, title, period, subcategory, condition, description, price, location, quantity)
      VALUES ($1,'Annonce d un compte suspendu','1GM','Uniformes','Bon','test',10,'Tarbes',1) RETURNING id`, [banni]);
    await c.query("RESET ROLE");
    const p = await c.query(`SELECT count(*)::int n FROM public.products WHERE user_id = $1`, [banni]);
    console.log(p.rows[0].n > 0
      ? `  [!!] un compte SUSPENDU a publié une annonce (id ${r.rows[0].id})`
      : `  [ok] rien n'a été écrit`);
  } catch (e) {
    console.log(`  [ok] publication refusée : ${String(e.message).split("\n")[0].slice(0,70)}`);
  }
  await c.query("ROLLBACK");

  // Fermer la porte est facile ; ne pas murer l'entrée l'est moins.
  const sain = randomUUID();
  await c.query("BEGIN");
  try {
    await c.query(`INSERT INTO auth.users (id, email, created_at) VALUES ($1,'sain@test.invalid', now())`, [sain]);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({sub:sain, role:"authenticated", aud:"authenticated"})]);
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(`INSERT INTO public.products (user_id, title, period, subcategory, condition, description, price, location, quantity)
      VALUES ($1,'Annonce normale','1GM','Uniformes','Bon','test',10,'Tarbes',1)`, [sain]);
    console.log("  [ok] compte sain : publie normalement");
  } catch (e) {
    console.log(`  [!!] compte sain : PUBLICATION CASSÉE (${String(e.message).split("\n")[0].slice(0,80)})`);
  }
} finally { await c.query("ROLLBACK"); await c.end(); }
