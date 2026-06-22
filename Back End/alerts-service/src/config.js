/**
 * config.js
 * -----------------------------------------------------------------------------
 * Configuração centralizada. Tudo via variável de ambiente, com defaults
 * sensatos para dev local. Credenciais NUNCA hardcoded.
 */

import "dotenv/config";

export const MQTT = {
  url: process.env.MQTT_URL || "mqtt://localhost:1883",
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASS || undefined,
  topicoAssinatura: "hospital/uti/+/+",
};

export const MONGO = {
  url: process.env.MONGO_URL,
  database: process.env.MONGO_DB || "uti_monitor",
  collection: process.env.MONGO_COLLECTION || "sinais_vitais",
};

if (!MONGO.url) {
  throw new Error("MONGO_URL não definida. Copie .env.example para .env e configure.");
}

export const WS = {
  porta: Number(process.env.WS_PORTA) || 8081,
};
