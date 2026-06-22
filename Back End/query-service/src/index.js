/**
 * index.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada. Conecta no Mongo de sinais e sobe o Apollo Server.
 *
 * Note: NÃO conectamos no banco de PII aqui. Esse serviço só fala com o
 * patients-service via HTTP. A chave de cripto NÃO entra no escopo deste
 * processo — isolamento por design.
 */

import { inicializar, encerrar } from "./sinais.js";
import { iniciar } from "./servidor.js";

async function main() {
  console.log("=== Serviço de Consulta (GraphQL) - UTI ===\n");

  await inicializar();
  const server = await iniciar();

  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Encerrando...");
    await server.stop();
    await encerrar();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
