/**
 * hash-chain.js
 * -----------------------------------------------------------------------------
 * Cadeia de hashes (hash chain) — garante DETECTIVAMENTE a integridade do log
 * de auditoria. Inspirada na estrutura de um blockchain, sem a complexidade
 * distribuída.
 *
 * COMO FUNCIONA:
 *   Cada evento E_n carrega 3 campos especiais:
 *     - sequencia:  número incremental (1, 2, 3...)
 *     - hashAnterior:  hash SHA-256 do evento E_{n-1} (ou GENESIS para o primeiro)
 *     - hash:       hash SHA-256 do CORPO de E_n + hashAnterior
 *
 *   Resultado: se alguém editar o evento E_k no banco depois de gravado,
 *   o `hash` de E_k não bate mais com o conteúdo, E o `hashAnterior` de
 *   E_{k+1} aponta para o hash original (não bate com o novo).
 *   A adulteração é DETECTÁVEL com uma verificação simples (varrer e
 *   recomputar a cadeia).
 *
 * IMPORTANTE: o hash chain NÃO IMPEDE a adulteração. Para impedir, dependemos
 * da combinação com permissões WORM no Atlas (usuário só pode insertOne).
 * Defesa em profundidade: a permissão é a prevenção, a cadeia é a detecção.
 */

import { createHash } from "node:crypto";

export const GENESIS_HASH = "GENESIS";

/**
 * Calcula o hash de um evento. É calculado sobre o JSON STRINGIFICADO do
 * corpo (sem o próprio campo 'hash') + o hashAnterior.
 *
 * Por que JSON stringificado? Porque queremos um hash determinístico sobre
 * todo o conteúdo. Mas atenção: a ordem dos campos importa para o hash.
 * Vamos garantir ordem fixa montando o corpo na função de gravação.
 */
export function calcularHash(corpo, hashAnterior) {
  const conteudo = JSON.stringify(corpo) + "|" + hashAnterior;
  return createHash("sha256").update(conteudo, "utf8").digest("hex");
}

/**
 * Verifica se UM evento individual está consistente.
 * @returns {boolean} true se o hash do evento bate com seu próprio conteúdo
 */
export function verificarEvento(evento) {
  const { hash, ...corpoSemHash } = evento;
  // Remove o _id do Mongo também — ele não fazia parte do hash original
  delete corpoSemHash._id;
  const recalculado = calcularHash(corpoSemHash, corpoSemHash.hashAnterior);
  return recalculado === hash;
}

/**
 * Verifica a cadeia INTEIRA: ordem de sequência, link entre hashes e
 * integridade individual.
 *
 * @param {Array} eventos - ordenados por sequencia ASC
 * @returns {{ ok: boolean, problemas: Array<{sequencia, motivo}> }}
 */
export function verificarCadeia(eventos) {
  const problemas = [];
  let hashEsperado = GENESIS_HASH;
  let sequenciaEsperada = 1;

  for (const ev of eventos) {
    if (ev.sequencia !== sequenciaEsperada) {
      problemas.push({
        sequencia: ev.sequencia,
        motivo: `sequência esperada ${sequenciaEsperada}, encontrada ${ev.sequencia} (lacuna ou reordenação)`,
      });
    }
    if (ev.hashAnterior !== hashEsperado) {
      problemas.push({
        sequencia: ev.sequencia,
        motivo: `hashAnterior não bate (link da cadeia quebrado)`,
      });
    }
    if (!verificarEvento(ev)) {
      problemas.push({
        sequencia: ev.sequencia,
        motivo: `hash do próprio evento não bate (conteúdo adulterado)`,
      });
    }
    hashEsperado = ev.hash;
    sequenciaEsperada++;
  }

  return { ok: problemas.length === 0, problemas };
}
