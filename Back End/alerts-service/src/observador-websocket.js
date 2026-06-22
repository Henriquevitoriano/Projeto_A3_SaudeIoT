/**
 * observador-websocket.js
 * -----------------------------------------------------------------------------
 * OBSERVADOR Nº 2 — broadcast de alertas via WebSocket.
 *
 * Sobe um servidor WebSocket numa porta. Quando o motor emite um alerta,
 * este observador o envia (em JSON) para TODOS os clientes conectados.
 *
 * Por que WebSocket? Porque é a forma natural de "push em tempo real" para
 * navegadores. No futuro, o Dashboard (Passo 9) conecta neste WS e exibe os
 * alertas piscando — sem precisar fazer polling no servidor.
 *
 * Coerente com o C4: a relação "Serviço de Alertas -> Dashboard via WebSocket"
 * está exatamente desenhada lá.
 */

import { WebSocketServer, WebSocket } from "ws";

export function registrar(motor, porta = 8081) {
  const wss = new WebSocketServer({ port: porta });

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS] cliente conectado (${ip}). Total: ${wss.clients.size}`);
    // Mensagem inicial só para o cliente saber que está conectado
    ws.send(JSON.stringify({ tipo: "hello", servico: "alertas" }));
    ws.on("close", () => console.log(`[WS] cliente saiu. Restantes: ${wss.clients.size}`));
  });

  motor.onAlerta((alerta) => {
    const mensagem = JSON.stringify({ tipo: "alerta", payload: alerta });
    let entregues = 0;
    for (const cliente of wss.clients) {
      // WebSocket.OPEN === 1: só envia para clientes ainda conectados.
      if (cliente.readyState === WebSocket.OPEN) {
        cliente.send(mensagem);
        entregues++;
      }
    }
    console.log(`[WS] alerta entregue a ${entregues} cliente(s).`);
  });

  console.log(`[OBS] websocket inscrito (porta ${porta}).`);
  return wss;
}
