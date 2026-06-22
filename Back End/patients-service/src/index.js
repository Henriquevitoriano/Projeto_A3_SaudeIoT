/**
 * index.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada. Inicializa o repositório (banco) e sobe o servidor REST.
 */

import { inicializar, encerrar } from "./repositorio.js";
import { iniciar } from "./servidor.js";

async function main() {
  console.log("=== Serviço de Pacientes (PII) - UTI ===\n");

  await inicializar();
  const server = await iniciar();

  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Encerrando...");
    server.close();
    await encerrar();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
