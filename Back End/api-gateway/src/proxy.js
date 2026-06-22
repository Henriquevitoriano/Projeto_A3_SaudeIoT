/**
 * proxy.js
 * -----------------------------------------------------------------------------
 * Proxy HTTP transparente. Recebe a requisição do cliente, encaminha para
 * o serviço interno correto e devolve a resposta ao cliente.
 *
 * DECISÃO IMPORTANTE: o Gateway INJETA headers úteis para o serviço interno:
 *   - X-User-Login:  login extraído do JWT (não do body — o cliente NÃO pode
 *                    forjar seu próprio login)
 *   - X-User-Role:   role do JWT
 *   - X-User-Name:   nome amigável do usuário
 *
 * Por que isso é importante para a defesa LGPD? Hoje, o patients-service
 * recebe `solicitante: "dr.house"` no body. Qualquer um pode mandar isso —
 * é palavra do cliente. Com o Gateway no caminho, o `X-User-Login` vem do
 * JWT validado pelo Gateway — não é mais falsificável.
 *
 * No Passo 8 (auditoria imutável), o patients-service vai preferir esse
 * header sobre o body, fechando a brecha.
 */

import { request as httpRequest } from "node:http";

/**
 * Encaminha uma requisição HTTP para o destino, retornando a resposta ao
 * cliente original.
 *
 * @param {http.IncomingMessage} req  - requisição do cliente
 * @param {http.ServerResponse}  res  - resposta para o cliente
 * @param {string} destino            - URL base do serviço (ex: http://localhost:8082)
 * @param {string} caminhoReescrito   - caminho a usar no destino
 * @param {object} payloadJwt         - claims do JWT já validado
 */
export function encaminhar(req, res, destino, caminhoReescrito, payloadJwt) {
  const urlDestino = new URL(caminhoReescrito, destino);

  const opcoes = {
    hostname: urlDestino.hostname,
    port: urlDestino.port,
    path: urlDestino.pathname + urlDestino.search,
    method: req.method,
    headers: {
      // Repassa headers úteis (sem Authorization — o Gateway já validou)
      "content-type": req.headers["content-type"] || "application/json",
      "accept": req.headers["accept"] || "application/json",
      // Headers injetados a partir do JWT (não-forjáveis pelo cliente)
      "x-user-login": payloadJwt.sub,
      "x-user-role":  payloadJwt.role,
      "x-user-name":  payloadJwt.nome,
      // X-Forwarded-For: padrão para o serviço interno saber o IP real
      "x-forwarded-for": req.socket.remoteAddress,
    },
    timeout: 10_000, // 10s — se um serviço travar, não trava o Gateway
  };

  const upstream = httpRequest(opcoes, (upstreamRes) => {
    // Repassa status e headers de resposta (filtrando alguns)
    const headers = { ...upstreamRes.headers };
    delete headers["transfer-encoding"]; // node trata por nós
    res.writeHead(upstreamRes.statusCode, headers);
    upstreamRes.pipe(res);
  });

  upstream.on("error", (err) => {
    console.error(`[PROXY] erro ao chamar ${destino}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ erro: "serviço upstream indisponível" }));
    }
  });

  upstream.on("timeout", () => {
    upstream.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { "content-type": "application/json" });
      res.end(JSON.stringify({ erro: "timeout no serviço upstream" }));
    }
  });

  // Pipe do body do cliente para o upstream
  req.pipe(upstream);
}
