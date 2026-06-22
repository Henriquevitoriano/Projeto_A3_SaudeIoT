import 'dotenv/config';
import * as repo from '../src/repositorio.js';
import { MongoClient } from 'mongodb';
import { MONGO as ING_MONGO } from '../src/config.js';

// Config
const INTERVAL_MS = Number(process.env.GEN_INTERVAL_MS) || 5000; // every 5s
const NORMAL_BATCH_SIZE = Number(process.env.GEN_BATCH_SIZE) || 5; // normal signals per interval
const CRITICAL_EVERY = Number(process.env.GEN_CRITICAL_EVERY) || 6; // every 6 intervals make critical for target

let intervalHandle;
let tick = 0;
let targetPseudonimo = null;

async function listarPseudonimos() {
  const url = process.env.MONGO_URL || ING_MONGO.url;
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db('uti_pacientes');
  const col = db.collection('pacientes');
  const docs = await col.find({}, { projection: { pseudonimo: 1, _id: 0 } }).toArray();
  await client.close();
  return docs.map(d => d.pseudonimo);
}

function gerarLeituraTipo(tipo, critical = false) {
  if (critical) {
    switch (tipo) {
      case 'fc': return 140; // very high -> 3
      case 'spo2': return 85; // low -> 3
      case 'pas': return 230; // high -> 3
      case 'pad': return 120; // high
      case 'resp': return 28; // high -> 2 or 3
      case 'temperatura': return 39.5; // febre alta
      default: return 999;
    }
  }
  switch (tipo) {
    case 'fc': return 70 + Math.floor(Math.random() * 15);
    case 'spo2': return 95 + Math.floor(Math.random() * 4);
    case 'pas': return 110 + Math.floor(Math.random() * 15);
    case 'pad': return 70 + Math.floor(Math.random() * 10);
    case 'resp': return 14 + Math.floor(Math.random() * 6);
    case 'temperatura': return 36.5 + Math.random() * 1.5; // 36.5-38.0°C
    default: return Math.random() * 100;
  }
}

async function start() {
  console.log('[GEN-C] Inicializando gerador contínuo...');
  const pseudonimos = await listarPseudonimos();
  if (!pseudonimos || pseudonimos.length === 0) {
    console.error('[GEN-C] Nenhum paciente encontrado. Rode o seed primeiro.');
    process.exit(1);
  }

  // pick a target that will occasionally receive critical readings
  targetPseudonimo = pseudonimos[0];
  console.log('[GEN-C] Pacientes encontrados:', pseudonimos.length, '- target:', targetPseudonimo);

  await repo.inicializar();

  intervalHandle = setInterval(async () => {
    tick++;
    const isCriticalTick = (tick % CRITICAL_EVERY) === 0;
    const tipos = ['fc','spo2','pas','pad','resp','temperatura'];

    try {
      // normal batch: random patients normal readings
      for (let i = 0; i < NORMAL_BATCH_SIZE; i++) {
        const p = pseudonimos[Math.floor(Math.random() * pseudonimos.length)];
        const tipo = tipos[Math.floor(Math.random() * tipos.length)];
        const valor = gerarLeituraTipo(tipo, false);
        const sinal = {
          pseudonimo: p,
          tipo,
          sensor_id: `sim-${Math.floor(Math.random()*1000)}`,
          valor,
          unidade: tipo === 'spo2' ? '%' : (tipo === 'fc' ? 'bpm' : tipo === 'resp' ? 'rpm' : tipo === 'temperatura' ? '°C' : 'mmHg'),
          timestamp: new Date().toISOString(),
        };
        await repo.gravarSinal(sinal);
      }

      // critical injection for target patient on critical tick
      if (isCriticalTick) {
        console.log('[GEN-C] Injetando leituras CRITICAS para', targetPseudonimo);
        // inject a set of critical signals to guarantee a 3-point
        const criticalTypes = ['spo2','fc'];
        for (const tipo of criticalTypes) {
          const valor = gerarLeituraTipo(tipo, true);
          const sinal = {
            pseudonimo: targetPseudonimo,
            tipo,
            sensor_id: `sim-crit-${Math.floor(Math.random()*1000)}`,
            valor,
            unidade: tipo === 'spo2' ? '%' : (tipo === 'fc' ? 'bpm' : 'mmHg'),
            timestamp: new Date().toISOString(),
          };
          await repo.gravarSinal(sinal);
        }
      }

    } catch (e) {
      console.error('[GEN-C] erro ao gravar sinal:', e.message);
    }

  }, INTERVAL_MS);

  process.on('SIGINT', async () => {
    console.log('\n[GEN-C] SIGINT recebido: encerrando...');
    clearInterval(intervalHandle);
    await repo.encerrar();
    process.exit(0);
  });
}

start().catch(e => { console.error(e); process.exit(1); });
