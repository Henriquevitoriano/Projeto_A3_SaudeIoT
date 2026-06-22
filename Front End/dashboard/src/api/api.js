/**
 * api.js
 * -----------------------------------------------------------------------------
 * Camada de comunicação com o backend. ÚNICO arquivo que conhece URLs do
 * Gateway e do WebSocket. Se em produção a porta mudar, é aqui que se altera.
 *
 * Centraliza:
 *  - Endereços (Gateway e WebSocket)
 *  - Armazenamento do JWT (sessionStorage — combinado no Passo 9)
 *  - Função única de chamada GraphQL
 *  - Função de conexão WebSocket
 *
 * Por que sessionStorage? Equilíbrio razoável para o MVP:
 *  - Persiste enquanto a aba estiver aberta (não some ao trocar de tela)
 *  - Some ao fechar a aba (zero rastro depois)
 *  - Vulnerável a XSS, mas no MVP nosso domínio é controlado
 *  Em produção: cookie httpOnly + flags Secure/SameSite=Strict.
 */

// Configuração via variável de ambiente do Vite (com defaults para dev local).
// Variáveis VITE_* são embutidas no bundle final pelo Vite.
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "http://localhost:8080";
const ALERTS_WS_URL = import.meta.env.VITE_ALERTS_WS_URL || "ws://localhost:8081";

const TOKEN_KEY = "uti.token";
const USER_KEY = "uti.user";

// ─── GESTÃO DO TOKEN ─────────────────────────────────────────────────────────
export function obterToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function obterUsuario() {
  const json = sessionStorage.getItem(USER_KEY);
  return json ? JSON.parse(json) : null;
}

function salvarSessao(token, usuario) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(usuario));
}

export function limparSessao() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────
/**
 * Faz login no Gateway. Em caso de sucesso, armazena token+usuário e devolve
 * o usuário. Em caso de falha, lança Error com a mensagem.
 */
export async function login(loginValue, senha) {
  const r = await fetch(`${GATEWAY_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: loginValue, senha }),
  });

  if (r.status === 429) {
    throw new Error("Muitas tentativas. Aguarde 1 minuto.");
  }
  if (!r.ok) {
    throw new Error("Credenciais inválidas");
  }
  const dados = await r.json();
  salvarSessao(dados.token, dados.usuario);
  return dados.usuario;
}

// ─── CHAMADA GraphQL ─────────────────────────────────────────────────────────
/**
 * Executa uma query/mutation GraphQL contra o Gateway.
 *
 * Trata 401 (sessão expirou ou token inválido) limpando a sessão — assim o
 * App detecta e redireciona para o login.
 */
export async function graphql(query, variables) {
  const token = obterToken();
  if (!token) throw new Error("não autenticado");

  const r = await fetch(`${GATEWAY_URL}/api/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (r.status === 401) {
    limparSessao();
    throw new Error("sessão expirada");
  }
  if (r.status === 403) {
    throw new Error("acesso negado para sua role");
  }
  if (!r.ok) {
    throw new Error(`erro HTTP ${r.status}`);
  }

  const json = await r.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message || "erro GraphQL");
  }
  return json.data;
}

// ─── WEBSOCKET DE ALERTAS ────────────────────────────────────────────────────
/**
 * Conecta no WebSocket do alerts-service.
 *
 * NOTA: no MVP, o WS é direto (não passa pelo Gateway). Trade-off conhecido —
 * em produção, o Gateway faria proxy do upgrade WebSocket. Como o WS é
 * read-only e não expõe PII, o risco é baixo.
 *
 * @param {(alerta: object) => void} onAlerta - callback para cada alerta recebido
 * @returns {WebSocket} a conexão, para o caller fechar quando quiser
 */
export function conectarAlertas(onAlerta) {
  const ws = new WebSocket(ALERTS_WS_URL);

  ws.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.tipo === "alerta") onAlerta(msg.payload);
    } catch {
      // ignora mensagens malformadas
    }
  });

  return ws;
}
