/**
 * servidor.js
 * -----------------------------------------------------------------------------
 * Servidor HTTP REST do audit-service. Três endpoints:
 *
 *   POST /eventos           - registra um evento (autenticado por X-Audit-Token)
 *   GET  /eventos           - lista eventos (lista pública para o DPO; em
 *                             produção, ficaria atrás do Gateway com role=dpo)
 *   GET  /eventos/verificar - varre a cadeia inteira e retorna inconsistências
 *   GET  /health            - health check
 *
 * Note: este serviço NÃO valida JWT do usuário. Quem valida JWT é o Gateway.
 * Aqui, o que valida que a chamada é legítima é o `X-Audit-Token` —
 * segredo compartilhado entre patients-service e audit-service.
 */

import { createServer } from "node:http";
import { inserirEvento, listarEventos, lerCadeiaCompleta } from "./repositorio.js";
import { verificarCadeia } from "./hash-chain.js";
import { HTTP, AUDIT_TOKEN } from "./config.js";

const TAMANHO_MAX_BODY = 16 * 1024;

function lerBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let tamanho = 0;
    req.on("data", (c) => {
      tamanho += c.length;
      if (tamanho > TAMANHO_MAX_BODY) { req.destroy(); return reject(new Error("body too large")); }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("body não é JSON válido")); }
    });
    req.on("error", reject);
  });
}

function responder(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export function criarServidor() {
  return createServer(async (req, res) => {
    const url = req.url.split("?")[0];

    if (req.method === "GET" && url === "/health") {
      return responder(res, 200, { status: "ok", servico: "audit-service" });
    }

    // POST /eventos — gravação. Exige X-Audit-Token.
    if (req.method === "POST" && url === "/eventos") {
      // Validação do token compartilhado: o caller TEM QUE conhecer
      // o segredo. Sem ele, recusa. Isto é o "elo" entre patients e audit.
      // Em produção real, seria mTLS — aqui um header equivalente.
      const tokenRecebido = req.headers["x-audit-token"];
      if (tokenRecebido !== AUDIT_TOKEN) {
        return responder(res, 401, { erro: "token de auditoria inválido" });
      }

      let body;
      try { body = await lerBody(req); }
      catch (e) { return responder(res, 400, { erro: e.message }); }

      if (!body?.tipo) {
        return responder(res, 400, { erro: "campo 'tipo' obrigatório" });
      }

      try {
        const evento = await inserirEvento(body);
        return responder(res, 201, evento);
      } catch (e) {
        console.error("[AUDIT] erro ao inserir:", e);
        return responder(res, 500, { erro: "falha ao registrar auditoria" });
      }
    }

    // GET /eventos/verificar — varre a cadeia
    if (req.method === "GET" && url === "/eventos/verificar") {
      try {
        const eventos = await lerCadeiaCompleta();
        const resultado = verificarCadeia(eventos);
        return responder(res, 200, {
          totalEventos: eventos.length,
          integridade: resultado.ok ? "ok" : "ADULTERADA",
          problemas: resultado.problemas,
        });
      } catch (e) {
        return responder(res, 500, { erro: e.message });
      }
    }

    // GET /eventos — lista (com filtros opcionais via querystring)
    if (req.method === "GET" && url === "/eventos") {
      try {
        const urlObj = new URL(req.url, `http://localhost:${HTTP.porta}`);
        const filtro = {};
        if (urlObj.searchParams.get("pseudonimo")) filtro.pseudonimo = urlObj.searchParams.get("pseudonimo");
        if (urlObj.searchParams.get("solicitante")) filtro.solicitante = urlObj.searchParams.get("solicitante");
        if (urlObj.searchParams.get("tipo")) filtro.tipo = urlObj.searchParams.get("tipo");
        const limite = Math.min(Number(urlObj.searchParams.get("limite")) || 100, 1000);

        const eventos = await listarEventos(filtro, limite);
        return responder(res, 200, eventos);
      } catch (e) {
        return responder(res, 500, { erro: e.message });
      }
    }

    return responder(res, 404, { erro: "rota não encontrada" });
  });
}

export function iniciar() {
  const server = criarServidor();
  return new Promise((resolve) => {
    server.listen(HTTP.porta, () => {
      console.log(`[AUDIT] Servidor REST ouvindo na porta ${HTTP.porta}`);
      resolve(server);
    });
  });
}
