import { useState, useEffect } from "react";
import { conectarAlertas } from "../api/api.js";

/**
 * Alertas.jsx
 * ----------------------------------------------------------------------------
 * Painel lateral que mostra alertas clínicos em tempo real, recebidos por
 * WebSocket do alerts-service (Observer pattern do Passo 4 chegando ao
 * dashboard via Passo 9).
 *
 * Implementação:
 *  - Conecta no WebSocket via `conectarAlertas` (camada api)
 *  - Mantém os últimos N alertas em estado local
 *  - Reconecta automaticamente se a conexão cair (resiliência)
 *  - Indicador visual de status da conexão
 */

const MAX_ALERTAS = 30;
const RECONEXAO_MS = 3000;

export default function Alertas() {
  const [alertas, setAlertas] = useState([]);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    let ws;
    let timerReconexao;
    let ativo = true;

    function conectar() {
      if (!ativo) return;
      ws = conectarAlertas((alerta) => {
        // Adiciona no topo, mantém só os últimos N
        setAlertas((atual) => [
          { ...alerta, recebidoEm: new Date() },
          ...atual,
        ].slice(0, MAX_ALERTAS));
      });

      ws.addEventListener("open", () => setConectado(true));
      ws.addEventListener("close", () => {
        setConectado(false);
        if (ativo) {
          timerReconexao = setTimeout(conectar, RECONEXAO_MS);
        }
      });
      ws.addEventListener("error", () => {
        // O 'close' geralmente vem em sequência; deixamos ele tratar a reconexão
      });
    }

    conectar();

    return () => {
      ativo = false;
      clearTimeout(timerReconexao);
      if (ws && ws.readyState <= 1) ws.close();
    };
  }, []);

  return (
    <div className="alertas-panel">
      <h3 className="section-title">Alertas clínicos</h3>
      <div className={`conexao ${conectado ? "on" : "off"}`}>
        {conectado ? "● Conectado em tempo real" : "● Conexão perdida — reconectando..."}
      </div>

      {alertas.length === 0 ? (
        <div className="vazio">Aguardando alertas...</div>
      ) : (
        alertas.map((a, i) => <AlertaItem key={i} alerta={a} />)
      )}
    </div>
  );
}

function AlertaItem({ alerta }) {
  const detalhe = (alerta.detalhes || [])
    .filter((d) => d.pontos > 0)
    .map((d) => `${d.tipo}=${d.valor}`)
    .join(", ");

  return (
    <div className={`alerta-item ${alerta.risco}`}>
      <div>
        <span className="pseudo">{alerta.pseudonimo}</span>
        {" — risco "}<strong>{alerta.risco?.toUpperCase()}</strong>
        {" (NEWS2 "}{alerta.scoreTotal}{")"}
      </div>
      {detalhe && <div style={{ fontSize: 11, marginTop: 4 }}>{detalhe}</div>}
      <div className="meta">
        {alerta.recebidoEm?.toLocaleTimeString()} ·
        anterior: {alerta.riscoAnterior}
      </div>
    </div>
  );
}
