/**
 * index.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada do API Gateway. Sobe o servidor HTTP.
 */

import { iniciar } from "./servidor.js";
import { USUARIOS } from "./config.js";

async function main() {
  console.log("=== API Gateway - UTI ===\n");
  console.log(`Usuários carregados: ${USUARIOS.length}`);
  USUARIOS.forEach((u) => console.log(`  - ${u.login.padEnd(12)} (${u.role})`));
  console.log("");

  const server = await iniciar();

  process.on("SIGINT", () => {
    console.log("\n[SHUTDOWN] Encerrando Gateway...");
    server.close(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
