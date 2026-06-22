/**
 * news2.js
 * -----------------------------------------------------------------------------
 * Implementação do protocolo clínico NEWS2 (National Early Warning Score 2).
 *
 * Função PURA: recebe um snapshot de sinais vitais, devolve pontuação e risco.
 * Não toca em rede, banco ou estado externo. Isso a torna trivialmente testável.
 *
 * Referência: Royal College of Physicians (RCP), 2017.
 * https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/
 */

// ─── Tabelas de pontuação por sinal ──────────────────────────────────────────
// Cada entrada: [min, max, pontos]. O valor cai na faixa onde min ≤ v ≤ max.

const FAIXAS = {
  respiracao: [
    [-Infinity, 8,        3],
    [9,         11,       1],
    [12,        20,       0],
    [21,        24,       2],
    [25,        Infinity, 3],
  ],
  spo2: [
    [-Infinity, 91,       3],
    [92,        93,       2],
    [94,        95,       1],
    [96,        Infinity, 0],
  ],
  pressao_sistolica: [
    [-Infinity, 90,       3],
    [91,        100,      2],
    [101,       110,      1],
    [111,       219,      0],
    [220,       Infinity, 3],
  ],
  freq_cardiaca: [
    [-Infinity, 40,       3],
    [41,        50,       1],
    [51,        90,       0],
    [91,        110,      1],
    [111,       130,      2],
    [131,       Infinity, 3],
  ],
  temperatura: [
    [-Infinity, 35.0,     3],
    [35.1,      36.0,     1],
    [36.1,      38.0,     0],
    [38.1,      39.0,     1],
    [39.1,      Infinity, 2],
  ],
};

/**
 * Pontua UM sinal segundo a tabela. Retorna 0 se o tipo não estiver mapeado
 * (sinal não usado pelo NEWS2 ainda).
 */
function pontuarSinal(tipo, valor) {
  const tabela = FAIXAS[tipo];
  if (!tabela) return 0;
  for (const [min, max, pontos] of tabela) {
    if (valor >= min && valor <= max) return pontos;
  }
  return 0;
}

/**
 * Classifica o nível de risco a partir do escore agregado e do maior escore
 * individual. Regra especial do NEWS2: se QUALQUER sinal sozinho pontuou 3,
 * o nível mínimo é "medio" — mesmo que o agregado seja baixo.
 *
 * Limiares oficiais do RCP:
 *   0       -> baixo
 *   1-4     -> baixo (mas reavaliação)
 *   5-6     -> médio  (resposta urgente)
 *   ≥7      -> alto   (resposta emergencial)
 *   qualquer sinal = 3 -> médio no mínimo
 */
function classificarRisco(agregado, maiorIndividual) {
  if (agregado >= 7) return "alto";
  if (agregado >= 5 || maiorIndividual === 3) return "medio";
  return "baixo";
}

/**
 * Calcula o NEWS2 completo para um snapshot do paciente.
 *
 * @param {Array} snapshot - array de { tipo, valor, unidade, timestamp }
 * @returns {{
 *   scoreTotal: number,
 *   risco: 'baixo' | 'medio' | 'alto',
 *   detalhes: Array<{ tipo, valor, pontos }>,
 *   maiorIndividual: number,
 *   sinaisAvaliados: number
 * }}
 */
export function calcularNEWS2(snapshot) {
  const detalhes = [];
  let scoreTotal = 0;
  let maiorIndividual = 0;

  for (const leitura of snapshot) {
    const pontos = pontuarSinal(leitura.tipo, leitura.valor);
    detalhes.push({ tipo: leitura.tipo, valor: leitura.valor, pontos });
    scoreTotal += pontos;
    if (pontos > maiorIndividual) maiorIndividual = pontos;
  }

  const risco = classificarRisco(scoreTotal, maiorIndividual);
  return { scoreTotal, risco, detalhes, maiorIndividual, sinaisAvaliados: snapshot.length };
}
