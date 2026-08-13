/* Sonde d'environnement : vérifie qu'un vrai serveur Postgres démarre et
   quelles extensions sont disponibles. Sert à qualifier ce qui est réellement
   testable sur ce poste. */

import { startPostgres, stopPostgres, connectionConfig } from "./postgres.mjs";
import pg from "pg";

const t0 = Date.now();
await startPostgres();

const client = new pg.Client(connectionConfig());
await client.connect();

const version = await client.query("SELECT version() AS v, current_setting('server_version_num') AS num");
console.log(version.rows[0].v);
console.log("server_version_num :", version.rows[0].num);

const extensions = await client.query(
  "SELECT name FROM pg_available_extensions WHERE name = ANY($1::text[]) ORDER BY name",
  [["pgcrypto", "pg_cron", "pg_net", "uuid-ossp", "plpgsql"]],
);
console.log("extensions disponibles :", extensions.rows.map((r) => r.name).join(", ") || "aucune");

await client.end();
await stopPostgres();
console.log("cycle démarrage + arrêt :", ((Date.now() - t0) / 1000).toFixed(1), "s");
