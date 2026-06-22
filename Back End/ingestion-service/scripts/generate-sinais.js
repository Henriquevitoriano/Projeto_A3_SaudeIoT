import 'dotenv/config';
import { MongoClient } from 'mongodb';
import * as repo from '../src/repositorio.js';
import { MONGO as ING_MONGO } from '../src/config.js';

async function listarPseudonimos() {
  // conecta ao mesmo cluster e lê a coleção de pacientes (uti_pacientes.pacientes)
  const url = process.env.MONGO_URL || ING_MONGO.url;
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db('uti_pacientes');
  const col = db.collection('pacientes');
  const docs = await col.find({}, { projection: { pseudonimo: 1, _id: 0 } }).toArray();
  await client.close();
  return docs.map(d => d.pseudonimo);
}

function gerarLeitura(tipo) {
  switch (tipo) {
    case 'fc': // batimentos
      return 50 + Math.floor(Math.random() * 70); // 50-119
    case 'spo2':
      return 90 + Math.floor(Math.random() * 11); // 90-100
    case 'pas':
      return 90 + Math.floor(Math.random() * 60); // 90-149
    case 'pad':
      return 50 + Math.floor(Math.random() * 50); // 50-99
    case 'resp':
      return 10 + Math.floor(Math.random() * 20); // 10-29
    case 'temperatura':
      return 36 + Math.random() * 2; // 36.0-38.0°C
    default:
      return Math.random() * 100;
  }
}

async function main() {
  console.log('[GEN] Iniciando gerador de sinais (inserção direta no Mongo)...');
  const pseudonimos = await listarPseudonimos();
  if (!pseudonimos || pseudonimos.length === 0) {
    console.error('[GEN] Nenhum paciente encontrado em uti_pacientes.pacientes — rode o seed primeiro.');
    process.exit(1);
  }

  await repo.inicializar();

  const tipos = ['fc', 'spo2', 'pas', 'pad', 'resp', 'temperatura'];
  const totalPerPatient = 20; // ~20 leituras cada -> 200 total if 10 pacientes

  let count = 0;
  for (const p of pseudonimos) {
    for (let i = 0; i < totalPerPatient; i++) {
      const tipo = tipos[Math.floor(Math.random() * tipos.length)];
      const valor = gerarLeitura(tipo);
      // timestamp ao longo da última hora
      const timestamp = new Date(Date.now() - Math.floor(Math.random() * 60 * 60 * 1000));
      const sinal = {
        pseudonimo: p,
        tipo,
        sensor_id: `sim-${Math.floor(Math.random() * 1000)}`,
        valor,
        unidade: tipo === 'spo2' ? '%' : (tipo === 'fc' ? 'bpm' : tipo === 'resp' ? 'rpm' : tipo === 'temperatura' ? '°C' : 'mmHg'),
        timestamp: timestamp.toISOString(),
      };
      await repo.gravarSinal(sinal);
      count++;
    }
  }

  console.log(`[GEN] Inseridas ${count} leituras.`);
  await repo.encerrar();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
