/**
 * repositorio.js
 * -----------------------------------------------------------------------------
 * Camada de acesso ao MongoDB. Faz três coisas:
 *
 *  1. Conecta no Atlas (com TLS automático via 'mongodb+srv://').
 *  2. Garante que a coleção de sinais vitais é uma TIME-SERIES collection
 *     (otimizada para dados temporais ordenados — nosso caso exato).
 *  3. Expõe uma função `gravarSinal()` PROTEGIDA por Circuit Breaker (opossum).
 *
 * Por que o Circuit Breaker fica AQUI e não em outro lugar? Porque é aqui que
 * mora a chamada de rede vulnerável (`collection.insertOne`). O Circuit Breaker
 * envelopa a operação que pode falhar. Outros módulos só pedem "grave isso"
 * sem saber que existe proteção — é o princípio do encapsulamento.
 */

import { MongoClient } from "mongodb";
import CircuitBreaker from "opossum";
import { MONGO, CIRCUIT_BREAKER } from "./config.js";

let client;          // cliente MongoDB (conexão única reutilizada)
let collection;      // referência à coleção de sinais
let breaker;         // instância do Circuit Breaker que protege a gravação

/**
 * Conecta no Atlas e prepara a coleção time-series.
 * Chamado uma vez no startup do serviço.
 */
export async function inicializar() {
  console.log("[MONGO] Conectando ao Atlas...");

  client = new MongoClient(MONGO.url, {
    // Boas práticas de pool de conexões:
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    retryWrites: true,
    w: "majority",
  });

  await client.connect();
  console.log("[MONGO] Conectado.");

  const db = client.db(MONGO.database);

  // Cria a coleção como TIME-SERIES se ainda não existir.
  // Esse tipo de coleção é otimizada para dados que chegam ordenados no tempo:
  // o MongoDB agrupa internamente buckets por tempo, comprimindo e indexando
  // de forma muito mais eficiente que uma coleção comum. Para nossas séries
  // de sinais vitais, é a escolha técnica correta.
  const existentes = await db.listCollections({ name: MONGO.collection }).toArray();
  if (existentes.length === 0) {
    await db.createCollection(MONGO.collection, {
      timeseries: {
        timeField: "timestamp",      // qual campo é o tempo
        metaField: "metadata",        // campo com metadados (pseudonimo, tipo)
        granularity: "seconds",       // resolução: leituras chegam a cada poucos segundos
      },
    });
    console.log(`[MONGO] Coleção time-series '${MONGO.collection}' criada.`);
  } else {
    console.log(`[MONGO] Coleção '${MONGO.collection}' já existe.`);
  }

  collection = db.collection(MONGO.collection);

  // Índices de consulta: necessário para consultas rápidas por paciente/tipo
  // e para agrupar o último valor por tipo dentro da janela de tempo.
  await collection.createIndex(
    { "metadata.pseudonimo": 1, "metadata.tipo": 1, timestamp: -1 },
    { name: "idx_pseudonimo_tipo_timestamp" }
  );
  await collection.createIndex(
    { "metadata.pseudonimo": 1, timestamp: -1 },
    { name: "idx_pseudonimo_timestamp" }
  );

  // Cria o Circuit Breaker envolvendo a função que faz a gravação real.
  // O `opossum` recebe uma função assíncrona e devolve uma versão "protegida".
  // Toda chamada passa pelo breaker, que conta sucessos/falhas e decide se
  // permite ou bloqueia (estado OPEN).
  breaker = new CircuitBreaker(gravarSinalReal, CIRCUIT_BREAKER);

  // Eventos do breaker — logamos para termos visibilidade do estado dele.
  // Em UTI, saber que o circuito abriu é informação CRÍTICA de operação.
  breaker.on("open",     () => console.warn("[BREAKER] ⚠️  ABERTO - parando de tentar gravar (falhas demais)."));
  breaker.on("halfOpen", () => console.warn("[BREAKER] 🟡 HALF-OPEN - testando uma chamada de recuperação..."));
  breaker.on("close",    () => console.log( "[BREAKER] ✅ FECHADO - operação normalizada."));
  breaker.on("reject",   () => console.warn("[BREAKER] ✋ chamada REJEITADA (circuito aberto)."));
  breaker.on("timeout",  () => console.warn("[BREAKER] ⏱  timeout: MongoDB não respondeu a tempo."));

  // Fallback: se o breaker estiver aberto OU a chamada falhar, executamos isto.
  // Em UTI a melhor estratégia é NUNCA perder dados silenciosamente: logamos a
  // perda em destaque. Numa versão futura, poderíamos bufferizar em arquivo
  // local ou em uma fila para reprocessar depois (resilience pattern).
  breaker.fallback((doc) => {
    console.error(
      `[FALLBACK] ❌ Sinal NÃO gravado (banco indisponível): ` +
      `${doc.metadata?.pseudonimo} / ${doc.metadata?.tipo} = ${doc.valor}`
    );
    // Retorna null para sinalizar "não gravou" sem quebrar quem chamou.
    return null;
  });
}

/**
 * Função INTERNA que faz a gravação real no MongoDB.
 * O Circuit Breaker do opossum envolve esta função — quem chama de fora usa
 * `gravarSinal()` (a versão protegida), não esta.
 */
async function gravarSinalReal(doc) {
  return collection.insertOne(doc);
}

/**
 * API pública: grava um sinal vital. Internamente passa pelo Circuit Breaker.
 *
 * @param {object} sinal - sinal já validado pelo validador
 * @returns o resultado da gravação, ou `null` se o fallback foi acionado
 */
export async function gravarSinal(sinal) {
  // Monta o documento no formato que a coleção time-series espera:
  // - `timestamp` é o campo de tempo
  // - `metadata` agrupa os campos que NÃO mudam por leitura individual
  //    (pseudônimo, tipo de sinal, sensor) — o Mongo usa isto para bucketing
  // - `valor` e `unidade` são a medição em si
  const doc = {
    timestamp: new Date(sinal.timestamp),
    metadata: {
      pseudonimo: sinal.pseudonimo,
      tipo: sinal.tipo,
      sensor_id: sinal.sensor_id,
    },
    valor: sinal.valor,
    unidade: sinal.unidade,
  };

  return breaker.fire(doc); // .fire() executa via Circuit Breaker
}

/**
 * Encerra a conexão de forma graciosa. Chamado no shutdown.
 */
export async function encerrar() {
  if (client) {
    await client.close();
    console.log("[MONGO] Conexão encerrada.");
  }
}

/**
 * Exporta o breaker para o harness de teste (e para métricas futuras).
 */
export function obterBreaker() {
  return breaker;
}

/**
 * HOOK DE TESTE — permite injetar uma coleção stub e ativar o Circuit Breaker
 * sem precisar de um MongoDB real. NÃO usado em produção.
 *
 * Padrão de design: "dependency injection via hook" — uma forma simples de
 * tornar o código testável sem reescrever toda a arquitetura.
 */
export function __setCollectionForTest(stubCollection) {
  collection = stubCollection;
  breaker = new CircuitBreaker(gravarSinalReal, CIRCUIT_BREAKER);
  breaker.on("open",     () => console.warn("[BREAKER] ⚠️  ABERTO - parando de tentar gravar (falhas demais)."));
  breaker.on("halfOpen", () => console.warn("[BREAKER] 🟡 HALF-OPEN - testando uma chamada de recuperação..."));
  breaker.on("close",    () => console.log( "[BREAKER] ✅ FECHADO - operação normalizada."));
  breaker.on("reject",   () => console.warn("[BREAKER] ✋ chamada REJEITADA (circuito aberto)."));
  breaker.on("timeout",  () => console.warn("[BREAKER] ⏱  timeout: MongoDB não respondeu a tempo."));
  breaker.fallback((doc) => {
    console.error(
      `[FALLBACK] ❌ Sinal NÃO gravado (banco indisponível): ` +
      `${doc.metadata?.pseudonimo} / ${doc.metadata?.tipo} = ${doc.valor}`
    );
    return null;
  });
}
