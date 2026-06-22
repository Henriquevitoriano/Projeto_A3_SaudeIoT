/**
 * avaliador.js
 * -----------------------------------------------------------------------------
 * Ponte entre "chegou um sinal novo" e "deve disparar alerta?".
 *
 * Quando o assinante MQTT recebe um sinal vital novo, ele chama `avaliar()`.
 * O avaliador busca os sinais MAIS RECENTES do mesmo paciente no MongoDB
 * (um por tipo, dentro de uma janela de tempo), monta um snapshot completo
 * e calcula o NEWS2.
 *
 * Por que precisamos do banco aqui? Porque o NEWS2 é AGREGADO: pontuamos cada
 * sinal, somamos tudo. Uma única leitura nova (ex: SpO₂) não basta — precisamos
 * dos outros sinais para fechar o cálculo.
 */

import { calcularNEWS2 } from "./news2.js";

const TIPOS_NEWS2 = ["respiracao", "spo2", "pressao_sistolica", "freq_cardiaca", "temperatura"];
const JANELA_MS = 60_000; // só consideramos leituras dos últimos 60s

/**
 * Busca a leitura mais recente de CADA tipo de sinal do paciente, dentro da
 * janela temporal. Devolve um array no formato esperado pelo NEWS2.
 *
 * Usa o operador $match + $sort + $group do MongoDB para pegar o "último por
 * tipo" eficientemente. Numa coleção time-series, o índice por tempo torna
 * essa consulta rápida — outra vantagem de termos escolhido time-series.
 */
async function buscarSnapshot(collection, pseudonimo) {
  const desde = new Date(Date.now() - JANELA_MS);

  const cursor = collection.aggregate([
    { $match: {
        timestamp: { $gte: desde },
        "metadata.pseudonimo": pseudonimo,
        "metadata.tipo": { $in: TIPOS_NEWS2 },
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
  return docs.map((d) => ({
    tipo: d._id,
    valor: d.valor,
    unidade: d.unidade,
    timestamp: d.timestamp,
  }));
}

/**
 * Decide se deve emitir alerta para este paciente neste momento.
 *
 * Recebe um sinal recém-gravado (do MQTT), monta o snapshot com os 5 sinais,
 * roda o NEWS2 e — se risco médio ou alto — chama `motor.emitirAlerta()`.
 *
 * Também mantém um cache do último risco emitido por paciente para evitar
 * "alert fatigue": se o paciente continua em "medio", não vamos disparar a
 * cada nova leitura — só quando o nível SOBE ou quando ele tinha voltado a
 * "baixo" e piorou de novo. Essa é uma decisão de design clínica importante:
 * em UTI, alarmes que tocam o tempo todo são ignorados pela equipe.
 */
const ultimoRiscoPorPaciente = new Map();
const NIVEL = { baixo: 0, medio: 1, alto: 2 };

export async function avaliar(collection, motor, sinalRecente) {
  const { pseudonimo } = sinalRecente;
  const snapshot = await buscarSnapshot(collection, pseudonimo);

  // Se ainda não temos os 5 sinais (paciente recém-conectado), não dá para
  // calcular o NEWS2 completo. Esperamos a coleção encher.
  if (snapshot.length < TIPOS_NEWS2.length) {
    return { calculado: false, motivo: `snapshot incompleto (${snapshot.length}/${TIPOS_NEWS2.length})` };
  }

  const resultado = calcularNEWS2(snapshot);

  // Anti-spam de alertas: só emite se o risco PIOROU em relação ao último.
  const riscoAnterior = ultimoRiscoPorPaciente.get(pseudonimo) || "baixo";
  const piorou = NIVEL[resultado.risco] > NIVEL[riscoAnterior];
  ultimoRiscoPorPaciente.set(pseudonimo, resultado.risco);

  if (resultado.risco !== "baixo" && piorou) {
    motor.emitirAlerta({
      pseudonimo,
      risco: resultado.risco,
      scoreTotal: resultado.scoreTotal,
      maiorIndividual: resultado.maiorIndividual,
      detalhes: resultado.detalhes,
      timestamp: new Date().toISOString(),
      riscoAnterior,
    });
    return { calculado: true, emitido: true, ...resultado };
  }

  return { calculado: true, emitido: false, ...resultado };
}
