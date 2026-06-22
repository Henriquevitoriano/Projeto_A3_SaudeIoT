/**
 * servidor.js
 * -----------------------------------------------------------------------------
 * Servidor HTTP do Gateway. Junta autenticação, RBAC e proxy.
 *
 * Endpoints diretos do Gateway:
 *   POST /auth/login          → autentica e devolve JWT
 *   GET  /health              → health check
 *   *    /api/*               → encaminhado (proxy) após auth + RBAC
 */

import { createServer } from "node:http";
import { login, validar } from "./auth.js";
import { podeTentar, registrarFalha } from "./rate-limit.js";
import { encaminhar } from "./proxy.js";
import { ROTAS, HTTP } from "./config.js";

const TAMANHO_MAX_BODY = 32 * 1024; // 32 KB — suficiente para login e cadastro

function lerBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let tamanho = 0;
    req.on("data", (chunk) => {
      tamanho += chunk.length;
      if (tamanho > TAMANHO_MAX_BODY) {
        req.destroy();
        return reject(new Error("body too large"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("body não é JSON válido")); }
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

/**
 * Encontra a rota que casa com (método, caminho).
 */
function buscarRota(metodo, caminho) {
  for (const rota of ROTAS) {
    if (rota.metodo !== metodo) continue;
    if (rota.padrao.test(caminho)) return rota;
  }
  return null;
}

export function criarServidor() {
  return createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    const ip = req.socket.remoteAddress;

    // ─── CORS ─────────────────────────────────────────────────────
    // Permite que o dashboard (origem diferente — porta 8090) chame esta API.
    // Em produção, restringiríamos Access-Control-Allow-Origin para o
    // domínio específico do dashboard. Para o MVP, configurável via env.
    const origemDashboard = process.env.CORS_ORIGEM || "http://localhost:8090";
    res.setHeader("Access-Control-Allow-Origin", origemDashboard);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "600"); // browser cacheia preflight 10min
    res.setHeader("Vary", "Origin");

    // Preflight OPTIONS: browser pergunta "posso fazer esta chamada?" antes
    // de chamadas com headers customizados (Authorization, content-type json).
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // ─── HEALTH CHECK ─────────────────────────────────────────────
    if (req.method === "GET" && url === "/health") {
      return responder(res, 200, { status: "ok", servico: "api-gateway" });
    }

    // ─── LOGIN ────────────────────────────────────────────────────
    if (req.method === "POST" && url === "/auth/login") {
      // Rate limit: 5 tentativas falhas por minuto por IP
      const limite = podeTentar(ip);
      if (!limite.permitido) {
        return responder(res, 429, {
          erro: "muitas tentativas falhas, aguarde",
        });
      }

      let body;
      try { body = await lerBody(req); }
      catch (e) { return responder(res, 400, { erro: e.message }); }

      const resultado = await login(body?.login, body?.senha);
      if (!resultado) {
        registrarFalha(ip);
        return responder(res, 401, { erro: "credenciais inválidas" });
      }
      return responder(res, 200, resultado);
    }

    // ─── PROXY (rotas /api/*) ─────────────────────────────────────
    if (url.startsWith("/api/")) {
      // 1) Autenticação
      const payload = validar(req.headers.authorization);
      if (!payload) {
        return responder(res, 401, { erro: "token inválido ou ausente" });
      }

      // 2) Encontrar rota
      const rota = buscarRota(req.method, url);
      if (!rota) {
        return responder(res, 404, { erro: "rota não encontrada" });
      }

      // 3) RBAC
      if (rota.rolesPermitidas.length > 0 && !rota.rolesPermitidas.includes(payload.role)) {
        return responder(res, 403, {
          erro: `acesso negado: role '${payload.role}' não pode acessar ${rota.descricao}`,
        });
      }

      // 4) Reescrever caminho e encaminhar
      const caminhoReescrito = rota.reescreverPara(url);
      console.log(
        `[GW] ${req.method} ${url} -> ${rota.destino}${caminhoReescrito} ` +
        `(user=${payload.sub} role=${payload.role})`
      );
      return encaminhar(req, res, rota.destino, caminhoReescrito, payload);
    }

    // ─── 404 ──────────────────────────────────────────────────────
    return responder(res, 404, { erro: "rota não encontrada" });
  });
}

export function iniciar() {
  const server = criarServidor();
  return new Promise((resolve) => {
    server.listen(HTTP.porta, () => {
      console.log(`[GW] API Gateway ouvindo na porta ${HTTP.porta}`);
      resolve(server);
    });
  });
}
