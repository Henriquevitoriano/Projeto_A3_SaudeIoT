/**
 * assinante.js
 * -----------------------------------------------------------------------------
 * Cliente MQTT que assina os tópicos de sinais vitais, recebe cada mensagem,
 * passa pelo validador e, se aprovada, manda para o repositório (que por sua
 * vez grava no Mongo via Circuit Breaker).
 *
 * Este módulo é a "cola" entre o mundo MQTT e o mundo do banco. Ele NÃO sabe
 * detalhes de validação (delega) nem de gravação (delega). Apenas orquestra.
 */

import mqtt from "mqtt";
import { MQTT } from "./config.js";
import { validar } from "./validador.js";
import { gravarSinal } from "./repositorio.js";

let client;

// Contadores simples para observabilidade. Em produção usaríamos Prometheus.
let totalRecebidas = 0;
let totalValidas   = 0;
let totalInvalidas = 0;
let totalGravadas  = 0;

export function iniciar() {
  console.log(`[MQTT] Conectando em ${MQTT.url}...`);

  client = mqtt.connect(MQTT.url, {
    username: MQTT.username,
    password: MQTT.password,
    reconnectPeriod: 2000, // resiliência: reconecta sozinho se cair
  });

  client.on("connect", () => {
    console.log("[MQTT] Conectado.");
    // QoS 1 ao assinar: o broker re-envia até confirmarmos recepção.
    // Garantia "at-least-once" — coerente com a publicação do simulador.
    client.subscribe(MQTT.topicoAssinatura, { qos: 1 }, (err) => {
      if (err) {
        console.error("[MQTT] Falha ao assinar:", err.message);
      } else {
        console.log(`[MQTT] Assinou '${MQTT.topicoAssinatura}'.`);
      }
    });
  });

  client.on("reconnect", () => console.log("[MQTT] Reconectando..."));
  client.on("error", (err) => console.error("[MQTT] Erro:", err.message));

  // O handler é async porque a gravação é assíncrona. Note que erros aqui não
  // podem subir e quebrar o cliente — capturamos tudo num try/catch.
  client.on("message", async (topico, payload) => {
    totalRecebidas++;

    const resultado = validar(topico, payload);
    if (!resultado.valido) {
      totalInvalidas++;
      console.warn(`[VALIDADOR] ✗ rejeitada: ${resultado.motivo}`);
      return;
    }
    totalValidas++;

    try {
      const r = await gravarSinal(resultado.sinal);
      if (r) {
        totalGravadas++;
        const { pseudonimo, tipo } = resultado.sinal;
        console.log(`[INGESTAO] ✓ ${pseudonimo}/${tipo} = ${resultado.sinal.valor}${resultado.sinal.unidade}`);
      }
      // Se r === null, o Circuit Breaker está aberto e o fallback já logou.
      // Contadores: gravadas só conta sucessos reais.
    } catch (e) {
      console.error("[INGESTAO] erro inesperado ao gravar:", e.message);
    }
  });
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

export function obterMetricas() {
  return { totalRecebidas, totalValidas, totalInvalidas, totalGravadas };
}
