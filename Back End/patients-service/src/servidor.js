/**
 * servidor.js
 * -----------------------------------------------------------------------------
 * Servidor HTTP REST nativo (módulo 'node:http', sem Express).
 *
 * Por que sem Express? Para 4 endpoints simples, Express adiciona uma
 * dependência grande e ~30 transitivas. Menos dependências = menor superfície
 * de ataque (ISO 27001) e nada de "mágica" escondida — você consegue defender
 * cada linha. Para 40 endpoints, valeria Express. Para 4, não.
 *
 * ENDPOINTS:
 *   POST  /pacientes                 -> cadastra (recebe PII real)
 *   GET   /pacientes                 -> lista (só pseudônimos + dados públicos)
 *   GET   /pacientes/:pseudonimo     -> dados públicos por pseudônimo
 *   POST  /pacientes/:pseudonimo/reidentificar -> retorna PII real (sensível!)
 *
 * SEGURANÇA NESTE MVP:
 *   Por ora, sem autenticação. O Passo 7 (API Gateway com JWT) plugará a
 *   verificação de role na frente — médicos podem reidentificar, enfermeiros
 *   só veem dados públicos, etc.
 */

import { createServer } from "node:http";
import * as pacientes from "./pacientes.js";
import { HTTP } from "./config.js";

// Limite de tamanho do body (proteção contra DoS por payload gigante)
const TAMANHO_MAX_BODY = 16 * 1024; // 16 KB é mais que suficiente para PII

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
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("body não é JSON válido"));
      }
    });
    req.on("error", reject);
  });
}

function responder(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // Headers de segurança recomendados pelo OWASP
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store", // PII NUNCA deve ser cacheada
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

// Pequeno roteador. Cada rota é { método, regex, handler }.
const rotas = [
  {
    metodo: "POST",
    regex: /^\/pacientes\/?$/,
    handler: async (req, res) => {
      const body = await lerBody(req);
      const resultado = await pacientes.cadastrar(body);
      responder(res, 201, resultado);
    },
  },
  {
    metodo: "GET",
    regex: /^\/pacientes\/?$/,
    handler: async (req, res) => {
      const lista = await pacientes.listar();
      responder(res, 200, lista);
    },
  },
  {
    metodo: "POST",
    regex: /^\/pacientes\/(PAC-[a-zA-Z0-9]+)\/reidentificar\/?$/,
    handler: async (req, res, [, pseudonimo]) => {
      const body = (await lerBody(req)) || {};
      // Prioridade: headers injetados pelo Gateway (X-User-*, extraídos do
      // JWT validado) sobre o body (que poderia ser forjado). Se a chamada
      // veio direto, sem Gateway, cai no body — útil para testes locais.
      const real = await pacientes.reidentificar(pseudonimo, {
        solicitante: req.headers["x-user-login"] || body.solicitante,
        solicitanteRole: req.headers["x-user-role"] || null,
        motivo: body.motivo,
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      });
      if (!real) return responder(res, 404, { erro: "paciente não encontrado" });
      responder(res, 200, real);
    },
  },
  {
    metodo: "GET",
    regex: /^\/pacientes\/(PAC-[a-zA-Z0-9]+)\/?$/,
    handler: async (req, res, [, pseudonimo]) => {
      const dados = await pacientes.obterPublico(pseudonimo);
      if (!dados) return responder(res, 404, { erro: "paciente não encontrado" });
      responder(res, 200, dados);
    },
  },
  // Health check
  {
    metodo: "GET",
    regex: /^\/health\/?$/,
    handler: async (req, res) => responder(res, 200, { status: "ok" }),
  },
];

export function criarServidor() {
  const server = createServer(async (req, res) => {
    const url = req.url.split("?")[0];

    for (const rota of rotas) {
      if (req.method !== rota.metodo) continue;
      const match = rota.regex.exec(url);
      if (!match) continue;

      try {
        await rota.handler(req, res, match);
      } catch (e) {
        if (e.name === "ValidationError") {
          return responder(res, 400, { erro: e.message });
        }
        console.error("[HTTP] erro:", e);
        return responder(res, 500, { erro: "erro interno" });
      }
      return;
    }

    responder(res, 404, { erro: "rota não encontrada" });
  });

  return server;
}

export function iniciar() {
  const server = criarServidor();
  return new Promise((resolve) => {
    server.listen(HTTP.porta, () => {
      console.log(`[HTTP] Servidor REST ouvindo na porta ${HTTP.porta}`);
      resolve(server);
    });
  });
}
