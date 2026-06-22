/**
 * repositorio.js
 * -----------------------------------------------------------------------------
 * Camada de persistência. Conhece o MongoDB, mas NÃO conhece regras de negócio
 * (não gera pseudônimos, não decide o que cifrar). É um "saco de dados puro".
 *
 * Os documentos gravados aqui contêm os campos sensíveis JÁ CIFRADOS — quem
 * faz cifrar/decifrar é a camada de serviço (pacientes.js). Esta separação
 * garante que mesmo que o repositório tenha um bug, ele não consegue revelar
 * PII em claro: a chave de cifragem nem está acessível neste módulo.
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
  });
  await client.connect();
  console.log("[MONGO] Conectado.");

  const db = client.db(MONGO.database);
  collection = db.collection(MONGO.collection);

  // Índice único no pseudônimo: pseudônimo é o identificador primário do
  // paciente para o resto do sistema, não pode haver duplicata.
  await collection.createIndex({ pseudonimo: 1 }, { unique: true });

  console.log(`[MONGO] Coleção '${MONGO.database}.${MONGO.collection}' pronta.`);
}

/**
 * Insere um novo paciente. O documento deve VIR JÁ COM CAMPOS CIFRADOS
 * (a camada de serviço cuida disso antes de chamar aqui).
 *
 * @param {{ pseudonimo, nome_cifrado, cpf_cifrado, leito, ... }} doc
 */
export async function criar(doc) {
  return collection.insertOne(doc);
}

/**
 * Busca por pseudônimo. Retorna o documento bruto (com campos cifrados) ou
 * null se não existir.
 */
export async function buscarPorPseudonimo(pseudonimo) {
  return collection.findOne({ pseudonimo });
}

/**
 * Lista todos os pacientes ativos. Retorna SÓ pseudônimo + dados públicos —
 * a PII cifrada não é nem trazida do banco (otimização + minimização).
 */
export async function listar() {
  return collection
    .find({ ativo: true }, { projection: {
      _id: 0, pseudonimo: 1, leito: 1, idade_aprox: 1, sexo: 1, ativo: 1,
    }})
    .toArray();
}

/**
 * Encerra a conexão de forma graciosa.
 */
export async function encerrar() {
  if (client) {
    await client.close();
    console.log("[MONGO] Conexão encerrada.");
  }
}

/**
 * Hook para teste: permite injetar uma coleção stub sem precisar do Atlas.
 */
export function __setCollectionForTest(stub) {
  collection = stub;
}
