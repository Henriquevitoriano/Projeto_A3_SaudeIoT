/**
 * rate-limit.js
 * -----------------------------------------------------------------------------
 * Rate limiter em memória — defesa simples contra força bruta no endpoint
 * de login.
 *
 * COMO FUNCIONA: para cada IP que tenta logar, mantemos uma janela de tempo
 * (default 1 min). Se exceder N tentativas falhas (default 5), bloqueia até
 * a janela expirar.
 *
 * LIMITAÇÕES (e por que estão OK para o MVP):
 *  - Em memória: se reiniciar o Gateway, o contador zera. Em produção real,
 *    isso iria para Redis. Para o MVP, aceitável.
 *  - Por instância: se rodar 2 Gateways, o atacante pode dividir tentativas
 *    entre eles. Em produção real, Redis compartilhado resolve.
 *  - Por IP: usuários atrás do mesmo NAT compartilham o limite. Trade-off
 *    conhecido; em produção, geralmente combina-se IP + login.
 *
 * Para um MVP que demonstra o conceito, isto é suficiente.
 */

import { RATE_LIMIT } from "./config.js";

// Map<ip, { tentativas: number, resetEm: timestamp }>
const tentativasPorIp = new Map();

/**
 * Verifica se um IP pode tentar logar agora.
 * @returns {{ permitido: boolean, restantes: number }}
 */
export function podeTentar(ip) {
  const agora = Date.now();
  const entrada = tentativasPorIp.get(ip);

  // Sem entrada ou janela expirada — libera e reinicia o contador
  if (!entrada || entrada.resetEm < agora) {
    tentativasPorIp.set(ip, { tentativas: 0, resetEm: agora + RATE_LIMIT.janelaMs });
    return { permitido: true, restantes: RATE_LIMIT.maxTentativas };
  }

  const restantes = RATE_LIMIT.maxTentativas - entrada.tentativas;
  return { permitido: restantes > 0, restantes: Math.max(0, restantes) };
}

/**
 * Registra uma tentativa FALHA do IP. Tentativas com sucesso não contam
 * — só penalizamos erros.
 */
export function registrarFalha(ip) {
  const entrada = tentativasPorIp.get(ip);
  if (entrada) entrada.tentativas++;
}

/**
 * Limpeza periódica de entradas antigas para não vazar memória.
 * Roda a cada 5 minutos.
 */
setInterval(() => {
  const agora = Date.now();
  for (const [ip, entrada] of tentativasPorIp.entries()) {
    if (entrada.resetEm < agora) tentativasPorIp.delete(ip);
  }
}, 5 * 60 * 1000).unref(); // .unref() = não impede o processo de encerrar
