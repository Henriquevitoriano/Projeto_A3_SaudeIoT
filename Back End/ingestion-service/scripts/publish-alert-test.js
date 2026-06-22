import 'dotenv/config';
import mqtt from 'mqtt';
import { MongoClient } from 'mongodb';
import { MONGO as ING_MONGO } from '../src/config.js';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USER = process.env.MQTT_USER || undefined;
const MQTT_PASS = process.env.MQTT_PASS || undefined;
const MONGO_URL = process.env.MONGO_URL || ING_MONGO.url;

const SIGNALS = [
  { tipo: 'spo2', valor: 85, unidade: '%' },
  { tipo: 'fc', valor: 140, unidade: 'bpm' },
  { tipo: 'resp', valor: 28, unidade: 'rpm' },
  { tipo: 'pas', valor: 230, unidade: 'mmHg' },
  { tipo: 'temperatura', valor: 39.5, unidade: '°C' },
  { tipo: 'pad', valor: 120, unidade: 'mmHg' },
];

async function pickPseudonimo() {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db('uti_pacientes');
  const pacientes = await db.collection('pacientes').find({}, { projection: { pseudonimo: 1, _id: 0 } }).limit(10).toArray();
  await client.close();
  if (!pacientes.length) {
    throw new Error('Nenhum paciente encontrado em uti_pacientes.pacientes');
  }
  return pacientes[0].pseudonimo;
}

function publishMessage(client, pseudonimo, signal) {
  const topic = `hospital/uti/${pseudonimo}/${signal.tipo}`;
  const payload = JSON.stringify({
    pseudonimo,
    tipo: signal.tipo,
    valor: signal.valor,
    unidade: signal.unidade,
    sensor_id: `test-${Math.floor(Math.random() * 10000)}`,
    timestamp: new Date().toISOString(),
  });
  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[PUB] erro ao publicar', topic, err.message);
    } else {
      console.log('[PUB] publicado', topic, payload);
    }
  });
}

async function main() {
  const pseudonimo = await pickPseudonimo();
  console.log('[PUB] usando paciente', pseudonimo);
  const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USER,
    password: MQTT_PASS,
    reconnectPeriod: 1000,
  });

  client.on('connect', async () => {
    console.log('[PUB] conectado em', MQTT_URL);
    for (const signal of SIGNALS) {
      publishMessage(client, pseudonimo, signal);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log('[PUB] mensagens enviadas, aguardando confirmação...');
    setTimeout(() => {
      client.end(false, {}, () => process.exit(0));
    }, 2000);
  });

  client.on('error', (err) => {
    console.error('[PUB] erro MQTT:', err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[PUB] erro:', err.message);
  process.exit(1);
});
