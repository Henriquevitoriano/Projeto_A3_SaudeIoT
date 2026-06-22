/**
 * assinante.js
 * -----------------------------------------------------------------------------
 * Cliente MQTT do Serviço de Alertas. Assina os mesmos tópicos da Ingestão
 * (em paralelo) e, para cada sinal recebido, dispara uma avaliação NEWS2.
 *
 * Diferença importante em relação ao assinante da Ingestão:
 *  - Ingestão GRAVA o sinal no banco.
 *  - Alertas AVALIA o sinal contra o histórico do banco para decidir alerta.
 *
 * Os dois rodam em paralelo, cada um com sua responsabilidade. Isso é o
 * princípio do desacoplamento via broker: vários consumidores reagindo ao
 * mesmo fluxo sem se conhecerem.
 */

import mqtt from "mqtt";
import { MQTT } from "./config.js";
import { avaliar } from "./avaliador.js";

const TOPICO_REGEX = /^hospital\/uti\/(PAC-[a-zA-Z0-9]+)\/([a-z_0-9]+)$/;

let client;
let totalRecebidas = 0;
let totalAvaliadas = 0;
let totalAlertasEmitidos = 0;

export function iniciar(collection, motor) {
  console.log(`[MQTT] Conectando em ${MQTT.url}...`);

  client = mqtt.connect(MQTT.url, {
    username: MQTT.username,
    password: MQTT.password,
    reconnectPeriod: 2000,
  });

  client.on("connect", () => {
    console.log("[MQTT] Conectado.");
    client.subscribe(MQTT.topicoAssinatura, { qos: 1 }, (err) => {
      if (err) console.error("[MQTT] Falha ao assinar:", err.message);
      else console.log(`[MQTT] Assinou '${MQTT.topicoAssinatura}'.`);
    });
  });

  client.on("reconnect", () => console.log("[MQTT] Reconectando..."));
  client.on("error", (err) => console.error("[MQTT] Erro:", err.message));

  client.on("message", async (topico, payload) => {
    totalRecebidas++;

    // Validação mínima local — só o suficiente para extrair pseudonimo/tipo.
    // A validação rigorosa contra PII é feita pela Ingestão antes de gravar;
    // aqui, se a mensagem nem casa com o padrão, ignoramos silenciosamente.
    if (!TOPICO_REGEX.test(topico)) return;

    let sinal;
    try {
      sinal = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (typeof sinal.valor !== "number" || !sinal.pseudonimo) return;

    try {
      const resultado = await avaliar(collection, motor, sinal);
      if (resultado.calculado) {
        totalAvaliadas++;
        if (resultado.emitido) totalAlertasEmitidos++;
      }
    } catch (e) {
      console.error("[ALERTAS] erro ao avaliar:", e.message);
    }
  });
}

export function obterMetricas() {
  return { totalRecebidas, totalAvaliadas, totalAlertasEmitidos };
}

export function encerrar() {
  return new Promise((resolve) => {
    if (!client) return resolve();
    client.end(false, {}, () => {
      console.log("[MQTT] Conexão encerrada.");
      resolve();
    });
  });
}
