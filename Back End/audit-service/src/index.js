/**
 * index.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada do audit-service.
 */

import { inicializar, encerrar } from "./repositorio.js";
import { iniciar } from "./servidor.js";

async function main() {
  console.log("=== Audit Service (auditoria imutável) - UTI ===\n");

  await inicializar();
  const server = await iniciar();

  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Encerrando audit-service...");
    server.close();
    await encerrar();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
