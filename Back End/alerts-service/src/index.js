/**
 * index.js
 * -----------------------------------------------------------------------------
 * Ponto de entrada. Faz o "wiring" do serviço:
 *   1. Conecta no MongoDB Atlas (só LEITURA aqui — não escrevemos nada)
 *   2. Cria o motor de alertas (Observer)
 *   3. Registra os observadores (logger + websocket)
 *   4. Sobe o assinante MQTT que dispara avaliações
 */

import { MongoClient } from "mongodb";
import { MONGO, WS } from "./config.js";
import { MotorDeAlertas } from "./motor.js";
import * as logger from "./observador-logger.js";
import * as websocket from "./observador-websocket.js";
import { iniciar, encerrar, obterMetricas } from "./assinante.js";

async function main() {
  console.log("=== Serviço de Alertas - UTI (NEWS2 + Observer) ===\n");

  // 1. Mongo (leitura)
  const client = new MongoClient(MONGO.url, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    retryWrites: true,
    w: "majority",
  });
  await client.connect();
  console.log("[MONGO] Conectado.");
  const collection = client.db(MONGO.database).collection(MONGO.collection);

  // 2. Motor (Observer)
  const motor = new MotorDeAlertas();

  // 3. Observadores
  logger.registrar(motor);
  const wss = websocket.registrar(motor, WS.porta);

  // 4. Assinante MQTT
  iniciar(collection, motor);

  // Shutdown gracioso
  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Encerrando...");
    console.log("[METRICAS]", obterMetricas());
    await encerrar();
    wss.close();
    await client.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
