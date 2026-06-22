import 'dotenv/config';
import mqtt from 'mqtt';
import { MongoClient } from 'mongodb';
import { MONGO as ING_MONGO, MQTT as ING_MQTT } from '../src/config.js';

/**
 * Gerador contínuo de sinais vitais — simula um monitor de UTI real.
 *
 * Publica via MQTT (não grava direto no Mongo) para passar pelo pipeline
 * de verdade: ingestion-service valida e grava, alerts-service avalia o
 * NEWS2 e dispara alertas via Observer (logger + WebSocket). Uma versão
 * anterior gravava direto no Mongo, bypassando MQTT inteiro — funcionava
 * para o GraphQL (que lê o snapshot direto do banco), mas o alerts-service
 * nunca recebia nada e o painel de alertas do dashboard ficava sempre vazio.
 *
 * Também é proposital que, a cada ciclo, TODO paciente receba uma leitura
 * de TODOS os sinais relevantes ao NEWS2 (fc, spo2, pas, resp, temperatura —
 * mais pad, que não entra no score mas é informação clínica real). Um
 * monitor de UTI de verdade lê continuamente todos os parâmetros de todos
 * os pacientes, não um sinal aleatório por vez.
 */

const INTERVAL_MS = Number(process.env.GEN_INTERVAL_MS) || 5000;
// Chance de UM paciente entrar em estado crítico a cada ciclo (por paciente).
const CRITICAL_CHANCE = Number(process.env.GEN_CRITICAL_CHANCE) || 0.04;
// Por quantos ciclos a excursão crítica dura antes de voltar ao normal.
const CRITICAL_DURATION_TICKS = Number(process.env.GEN_CRITICAL_DURATION) || 5;

const TIPOS = ['fc', 'spo2', 'pas', 'pad', 'resp', 'temperatura'];
const UNIDADES = { fc: 'bpm', spo2: '%', pas: 'mmHg', pad: 'mmHg', resp: 'rpm', temperatura: '°C' };

const BASELINE = {
  fc: () => 70 + Math.random() * 15,
  spo2: () => 95 + Math.random() * 4,
  pas: () => 110 + Math.random() * 15,
  pad: () => 70 + Math.random() * 10,
  resp: () => 14 + Math.random() * 6,
  temperatura: () => 36.5 + Math.random() * 1.0,
};

const CRITICO = {
  fc: () => 135 + Math.random() * 20,
  spo2: () => 80 + Math.random() * 6,
  pas: () => 200 + Math.random() * 30,
  pad: () => 110 + Math.random() * 15,
  resp: () => 27 + Math.random() * 6,
  temperatura: () => 39 + Math.random() * 1.2,
};

let intervalHandle;
let client;
// estado por paciente: { critico: boolean, ticksRestantes: number }
const estado = new Map();

function gerarValor(pseudonimo, tipo) {
  const e = estado.get(pseudonimo);
  const gerador = e?.critico ? CRITICO[tipo] : BASELINE[tipo];
  const valor = gerador();
  return tipo === 'temperatura' ? Number(valor.toFixed(1)) : Math.round(valor);
}

async function listarPseudonimos() {
  const url = process.env.MONGO_URL || ING_MONGO.url;
  const mongoClient = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await mongoClient.connect();
  const db = mongoClient.db('uti_pacientes');
  const col = db.collection('pacientes');
  const docs = await col.find({}, { projection: { pseudonimo: 1, _id: 0 } }).toArray();
  await mongoClient.close();
  return docs.map((d) => d.pseudonimo);
}

function atualizarEstado(pseudonimo) {
  const e = estado.get(pseudonimo);
  if (e.critico) {
    e.ticksRestantes--;
    if (e.ticksRestantes <= 0) e.critico = false;
  } else if (Math.random() < CRITICAL_CHANCE) {
    e.critico = true;
    e.ticksRestantes = CRITICAL_DURATION_TICKS;
  }
}

function publicar(pseudonimo, tipo, timestamp) {
  const valor = gerarValor(pseudonimo, tipo);
  const payload = JSON.stringify({
    pseudonimo,
    tipo,
    valor,
    unidade: UNIDADES[tipo],
    timestamp,
    sensor_id: `sim-${tipo}`,
  });
  client.publish(`hospital/uti/${pseudonimo}/${tipo}`, payload, { qos: 1 });
}

async function start() {
  console.log('[GEN-C] Inicializando gerador contínuo...');
  const pseudonimos = await listarPseudonimos();
  if (!pseudonimos || pseudonimos.length === 0) {
    console.error('[GEN-C] Nenhum paciente encontrado. Rode o seed primeiro.');
    process.exit(1);
  }
  for (const p of pseudonimos) estado.set(p, { critico: false, ticksRestantes: 0 });

  client = mqtt.connect(ING_MQTT.url, {
    username: ING_MQTT.username,
    password: ING_MQTT.password,
  });

  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });

  console.log('[GEN-C] Conectado ao MQTT. Pacientes:', pseudonimos.length, '- publicando todos os sinais a cada', INTERVAL_MS, 'ms');

  intervalHandle = setInterval(() => {
    const timestamp = new Date().toISOString();
    let criticos = 0;

    for (const pseudonimo of pseudonimos) {
      atualizarEstado(pseudonimo);
      if (estado.get(pseudonimo).critico) criticos++;
      for (const tipo of TIPOS) {
        publicar(pseudonimo, tipo, timestamp);
      }
    }

    console.log(`[GEN-C] tick: ${pseudonimos.length} pacientes publicados (${criticos} em estado crítico)`);
  }, INTERVAL_MS);

  process.on('SIGINT', () => {
    console.log('\n[GEN-C] SIGINT recebido: encerrando...');
    clearInterval(intervalHandle);
    client.end(false, {}, () => process.exit(0));
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
