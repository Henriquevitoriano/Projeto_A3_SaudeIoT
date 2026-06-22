/**
 * sinais.js
 * -----------------------------------------------------------------------------
 * Camada de acesso ao MongoDB de sinais vitais. SOMENTE LEITURA — este serviço
 * não grava nada, só consulta.
 *
 * Duas operações:
 *  - buscarSinais(): histórico filtrado por paciente/tipo/janela/limite
 *  - buscarSnapshot(): último valor de cada tipo do paciente (para NEWS2)
 */

import { MongoClient } from "mongodb";
import { MONGO } from "./config.js";

let client;
let collection;

export async function inicializar() {
  console.log("[MONGO] Conectando ao Atlas...");
  client = new MongoClient(MONGO.url, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    retryWrites: true,
    w: "majority",
  });
  await client.connect();
  collection = client.db(MONGO.database).collection(MONGO.collection);
  console.log("[MONGO] Conectado.");
}

function ensureCollection() {
  if (!collection) {
    throw new Error("[MONGO] Conexão não inicializada. Chame inicializar() antes de consultar.");
  }
}

/**
 * Busca histórico de sinais de um paciente.
 *
 * @param {string} pseudonimo
 * @param {string[]} tipos     - se vazio, todos os tipos
 * @param {number} janelaMin   - quantos minutos para trás
 * @param {number} limite      - máximo de pontos retornados
 */
export async function buscarSinais(pseudonimo, tipos, janelaMin, limite) {
  ensureCollection();
  const desde = new Date(Date.now() - janelaMin * 60 * 1000);
  const filtro = {
    "metadata.pseudonimo": pseudonimo,
    timestamp: { $gte: desde },
  };
  if (tipos && tipos.length > 0) {
    filtro["metadata.tipo"] = { $in: tipos };
  }

  const docs = await collection
    .find(filtro)
    .sort({ timestamp: -1 })
    .limit(limite)
    .toArray();

  // Achata: documentos de time-series têm metadata aninhada; nivelamos para o
  // formato que o GraphQL espera.
  return docs.map((d) => ({
    pseudonimo: d.metadata.pseudonimo,
    tipo: d.metadata.tipo,
    valor: d.valor,
    unidade: d.unidade,
    timestamp: d.timestamp.toISOString(),
    sensorId: d.metadata.sensor_id,
  }));
}

/**
 * Pega o ÚLTIMO valor de cada tipo de sinal do paciente, dentro da janela.
 * Usado para calcular NEWS2.
 *
 * Pipeline: $match + $sort + $group ($first por tipo) — mesma técnica que
 * usamos no Passo 4.
 */
const TIPOS_NEWS2 = [
  "respiracao", "spo2", "pressao_sistolica", "freq_cardiaca", "temperatura",
];
const TIPO_CANONICO = {
  resp: "respiracao",
  respiracao: "respiracao",
  fc: "freq_cardiaca",
  freq_cardiaca: "freq_cardiaca",
  pas: "pressao_sistolica",
  pressao_sistolica: "pressao_sistolica",
  spo2: "spo2",
  temperatura: "temperatura",
};
const TIPOS_BUSCA = Object.keys(TIPO_CANONICO);
const JANELA_NEWS2_MS = 60_000;

export async function buscarSnapshot(pseudonimo) {
  ensureCollection();
  const desde = new Date(Date.now() - JANELA_NEWS2_MS);
  const cursor = collection.aggregate([
    { $match: {
        timestamp: { $gte: desde },
        "metadata.pseudonimo": pseudonimo,
        "metadata.tipo": { $in: TIPOS_BUSCA },
    } },
    { $sort: { timestamp: -1 } },
    { $group: {
        _id: "$metadata.tipo",
        valor: { $first: "$valor" },
        unidade: { $first: "$unidade" },
        timestamp: { $first: "$timestamp" },
    } },
  ]);
  const docs = await cursor.toArray();
  const snapshot = new Map();
  for (const d of docs) {
    const tipoCanonico = TIPO_CANONICO[d._id];
    if (!tipoCanonico) continue;
    if (snapshot.has(tipoCanonico)) continue;
    snapshot.set(tipoCanonico, {
      tipo: tipoCanonico,
      valor: d.valor,
      unidade: d.unidade,
      timestamp: d.timestamp,
    });
  }
  return Array.from(snapshot.values());
}

export async function encerrar() {
  if (client) {
    await client.close();
    console.log("[MONGO] Conexão encerrada.");
  }
}

/** Hook de teste */
export function __setCollectionForTest(stub) {
  collection = stub;
}
