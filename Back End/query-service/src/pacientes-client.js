/**
 * pacientes-client.js
 * -----------------------------------------------------------------------------
 * Cliente HTTP do Serviço de Pacientes (Passo 5).
 *
 * Decisão arquitetural importante: este serviço de Consulta NÃO acessa o
 * banco de PII diretamente, e NÃO tem a chave de criptografia. Toda
 * informação identificável vem via HTTP do patients-service, que decide
 * o que liberar e mantém o log de auditoria.
 *
 * Isso é defesa em profundidade na prática:
 *  - O cluster de PII só aceita o usuário do patients-service.
 *  - O patients-service só decifra mediante chamada explícita.
 *  - A chave de criptografia mora APENAS no patients-service.
 *  - O query-service só consome a API REST, sem acesso direto.
 */

import { PATIENTS } from "./config.js";

/**
 * Wrapper sobre fetch com timeout e tratamento de erro padronizado.
 *
 * Por que timeout? Sem timeout, se o patients-service ficar lento ou cair,
 * a consulta GraphQL inteira fica pendurada esperando — ruim para o usuário.
 */
async function http(metodo, caminho, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PATIENTS.timeoutMs);

  try {
    const r = await fetch(`${PATIENTS.url}${caminho}`, {
      method: metodo,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (r.status === 404) return null;
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`patients-service ${r.status}: ${txt}`);
    }
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`patients-service timeout (${PATIENTS.timeoutMs}ms)`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function listar() {
  return (await http("GET", "/pacientes")) || [];
}

export async function buscarPorPseudonimo(pseudonimo) {
  return http("GET", `/pacientes/${pseudonimo}`);
}

export async function reidentificar(pseudonimo, solicitante, motivo) {
  return http("POST", `/pacientes/${pseudonimo}/reidentificar`, {
    solicitante, motivo,
  });
}

/** Hook de teste — substitui o fetch interno */
export function __setHttpForTest(stubHttp) {
  Object.assign({ http }, { http: stubHttp });
}
