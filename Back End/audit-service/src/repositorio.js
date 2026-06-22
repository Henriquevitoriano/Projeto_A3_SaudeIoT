/**
 * repositorio.js
 * -----------------------------------------------------------------------------
 * Persistência dos eventos de auditoria. Garante TRÊS coisas:
 *
 *   1. Conexão com o Mongo + índice em 'sequencia' único (defesa em
 *      profundidade contra duplicação acidental).
 *   2. Inserções SERIALIZADAS — a cadeia de hashes só funciona se os eventos
 *      forem inseridos um por vez, na ordem certa. Se duas requisições
 *      concorrentes calculassem 'hashAnterior' lendo o mesmo último evento,
 *      teríamos uma bifurcação. Resolvemos com um mutex interno.
 *   3. Leitura ordenada por sequência (para verificação da cadeia).
 *
 * NOTA DE PRODUÇÃO: o mutex em memória só funciona em UMA instância do
 * audit-service. Em produção com várias réplicas, isto vira um lock
 * distribuído (Redis, MongoDB transactions, ou um broker como SQS FIFO).
 * Para o MVP, uma única instância é suficiente — e isso é defensável:
 * auditoria não precisa escalar horizontalmente como tráfego de leitura.
 */

import { MongoClient } from "mongodb";
import { MONGO } from "./config.js";
import { calcularHash, GENESIS_HASH } from "./hash-chain.js";

let client;
let collection;

// Mutex simples para serializar gravações (ver justificativa acima)
let mutex = Promise.resolve();

export async function inicializar() {
  console.log("[MONGO] Conectando ao Atlas (banco de auditoria)...");
  client = new MongoClient(MONGO.url, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,
  });
  await client.connect();
  collection = client.db(MONGO.database).collection(MONGO.collection);

  // Índice único em 'sequencia' — defesa contra qualquer duplicação acidental
  // (mesmo que o mutex falhe por bug, o Mongo recusa a segunda inserção).
  await collection.createIndex({ sequencia: 1 }, { unique: true });
  // Índice em hashAnterior para a verificação ficar rápida
  await collection.createIndex({ hashAnterior: 1 });

  console.log(`[MONGO] Coleção '${MONGO.database}.${MONGO.collection}' pronta.`);
}

/**
 * Insere um evento na cadeia. Esta função É SERIALIZADA via mutex.
 *
 * Passos:
 *   1. Lê o último evento (para obter seu hash e sequência)
 *   2. Monta o corpo do novo evento com sequencia = anterior + 1
 *   3. Calcula o hash do novo evento usando o hash do anterior
 *   4. Insere
 *   5. Retorna o evento inserido
 */
export async function inserirEvento(dadosBrutos) {
  // Encadeia esta inserção depois da anterior. Cada chamada espera a
  // anterior terminar antes de começar — garante a ordem da cadeia.
  const tarefa = mutex.then(() => inserirInterno(dadosBrutos));
  // Atualiza o mutex para que a próxima chamada espere ESTA terminar.
  // O .catch() vazio garante que um erro não trava a cadeia toda.
  mutex = tarefa.catch(() => {});
  return tarefa;
}

async function inserirInterno(dadosBrutos) {
  // 1. Lê o último evento
  const ultimo = await collection
    .find({}, { sort: { sequencia: -1 }, limit: 1 })
    .next();

  const sequencia = (ultimo?.sequencia ?? 0) + 1;
  const hashAnterior = ultimo?.hash ?? GENESIS_HASH;

  // 2. Monta o corpo SEM o campo 'hash' (que ainda vai ser calculado)
  // A ordem dos campos importa para a stringificação determinística:
  // mantemos uma ordem canônica.
  const corpo = {
    sequencia,
    timestamp: new Date(),
    tipo: dadosBrutos.tipo,
    pseudonimo: dadosBrutos.pseudonimo ?? null,
    solicitante: dadosBrutos.solicitante ?? null,
    solicitanteRole: dadosBrutos.solicitanteRole ?? null,
    motivo: dadosBrutos.motivo ?? null,
    detalhes: dadosBrutos.detalhes ?? null,
    ip: dadosBrutos.ip ?? null,
    hashAnterior,
  };

  // 3. Calcula o hash do conteúdo
  const hash = calcularHash(corpo, hashAnterior);

  // 4. Insere
  const documento = { ...corpo, hash };
  await collection.insertOne(documento);

  return documento;
}

/**
 * Lê eventos ordenados por sequência. Para o DPO consultar e para a
 * verificação da cadeia.
 *
 * @param {object} filtro - filtros opcionais (pseudonimo, solicitante, etc)
 * @param {number} limite
 */
export async function listarEventos(filtro = {}, limite = 1000) {
  return collection
    .find(filtro)
    .sort({ sequencia: 1 })
    .limit(limite)
    .toArray();
}

/**
 * Lê toda a cadeia para verificação. Em produção com milhões de eventos,
 * isto seria paginado e a verificação seria incremental. Para o MVP, OK.
 */
export async function lerCadeiaCompleta() {
  return collection.find({}).sort({ sequencia: 1 }).toArray();
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
  mutex = Promise.resolve();
}
