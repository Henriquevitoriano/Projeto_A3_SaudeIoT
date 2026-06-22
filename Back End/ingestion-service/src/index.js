/**
 * index.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada. Inicializa o repositório (conecta no Atlas e cria a coleção
 * time-series), depois sobe o assinante MQTT.
 *
 * A ordem importa: precisamos do banco PRONTO antes de começar a receber
 * mensagens, senão as primeiras leituras quebrariam o serviço.
 */

import { inicializar, encerrar as encerrarRepo } from "./repositorio.js";
import { iniciar, encerrar as encerrarMqtt, obterMetricas } from "./assinante.js";

async function main() {
  console.log("=== Serviço de Ingestão - UTI ===\n");

  // 1. Banco primeiro (sem banco, não tem onde gravar)
  await inicializar();

  // 2. MQTT depois
  iniciar();

  // Shutdown gracioso: fecha MQTT, depois Mongo, depois sai.
  // Ordem inversa da inicialização — princípio do "último a abrir, primeiro
  // a fechar" (LIFO).
  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Encerrando serviço de ingestão...");
    console.log("[METRICAS]", obterMetricas());
    await encerrarMqtt();
    await encerrarRepo();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL] erro na inicialização:", e.message);
  process.exit(1);
});
