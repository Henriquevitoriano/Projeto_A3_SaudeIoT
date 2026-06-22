/**
 * config.js
 * -----------------------------------------------------------------------------
 * Configuração centralizada.
 *
 * NOTA: este serviço acessa DOIS recursos externos:
 *  - MongoDB (banco de sinais, somente leitura)
 *  - Patients Service (via HTTP REST)
 *
 * Idealmente, em produção, o usuário Mongo deste serviço teria privilégio
 * APENAS de leitura na coleção 'sinais_vitais'. Princípio do menor privilégio.
 */

import "dotenv/config";

export const MONGO = {
  url: process.env.MONGO_URL,
  database: process.env.MONGO_DB || "uti_monitor",
  collection: process.env.MONGO_COLLECTION || "sinais_vitais",
};

if (!MONGO.url) {
  throw new Error("MONGO_URL não definida. Copie .env.example para .env.");
}

export const PATIENTS = {
  // Onde o patients-service (Passo 5) está ouvindo
  url: process.env.PATIENTS_URL || "http://localhost:8082",
  // timeout em ms — chamadas longas podem segurar o GraphQL
  timeoutMs: Number(process.env.PATIENTS_TIMEOUT_MS) || 3000,
};

export const HTTP = {
  porta: Number(process.env.HTTP_PORTA) || 8083,
};
