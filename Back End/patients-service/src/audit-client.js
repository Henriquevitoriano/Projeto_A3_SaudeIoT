/**
 * audit-client.js
 * -----------------------------------------------------------------------------
 * Cliente HTTP do audit-service.
 *
 * REGRA DE OURO (LGPD): se a auditoria falhar, a operação que dependia dela
 * TAMBÉM DEVE FALHAR (fail-closed). Sem registro de quem reidentificou um
 * paciente, não há reidentificação. Isto é o trade-off correto entre
 * disponibilidade e conformidade — em ambiente clínico, reidentificação
 * formal não é emergência (atendimento real ocorre pelo leito direto).
 */

const AUDIT_URL = process.env.AUDIT_URL || "http://localhost:8084";
const AUDIT_TOKEN = process.env.AUDIT_SHARED_TOKEN;
const TIMEOUT_MS = 3000;

if (!AUDIT_TOKEN) {
  throw new Error("AUDIT_SHARED_TOKEN ausente no patients-service");
}

/**
 * Registra um evento de auditoria. LANÇA se falhar — fail-closed.
 *
 * @param {object} evento - { tipo, pseudonimo, solicitante, solicitanteRole, motivo, ip, detalhes }
 * @returns {object} o evento gravado (com sequencia, hash, timestamp)
 */
export async function registrarEvento(evento) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(`${AUDIT_URL}/eventos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-audit-token": AUDIT_TOKEN,
      },
      body: JSON.stringify(evento),
      signal: controller.signal,
    });

    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`audit-service ${r.status}: ${txt}`);
    }
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`audit-service timeout (${TIMEOUT_MS}ms) — fail-closed`);
    }
    throw new Error(`audit-service indisponível: ${e.message} — fail-closed`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health check — usado para diagnóstico.
 */
export async function healthCheck() {
  try {
    const r = await fetch(`${AUDIT_URL}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}
