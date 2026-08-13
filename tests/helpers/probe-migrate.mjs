/* Première exécution réelle de tout l'historique du schéma. */

import { startPostgres, stopPostgres } from "./postgres.mjs";
import { migrateFresh } from "./migrate.mjs";

await startPostgres();
try {
  const { applied } = await migrateFresh("am2_probe");
  console.log("\n=== MIGRATIONS APPLIQUÉES ===");
  applied.forEach((a, i) => console.log(String(i + 1).padStart(2), a));
  console.log("\nTotal :", applied.length);
} catch (err) {
  console.error("\n=== ÉCHEC ===\n" + err.message);
  process.exitCode = 1;
} finally {
  await stopPostgres();
}
