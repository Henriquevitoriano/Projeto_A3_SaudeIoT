/**
 * config.js
 * -----------------------------------------------------------------------------
 * Centraliza TODA a configuração do Gateway.
 *
 * Aqui mora:
 *  - Segredo JWT e tempo de expiração
 *  - Diretório de usuários (carregado do .env, com senhas em hash bcrypt)
 *  - Mapeamento de rotas -> serviços internos
 *  - Política RBAC: qual role pode acessar qual rota
 *
 * O Gateway é A ÚNICA PORTA pública. Os outros serviços passam a escutar em
 * 127.0.0.1 (loopback). Em produção real, isso vira "rede interna do cluster".
 * O efeito é o mesmo: ninguém de fora consegue falar direto com Pacientes,
 * Consulta ou Alertas sem passar pelo Gateway.
 */

import "dotenv/config";

// ─── JWT ─────────────────────────────────────────────────────────────────────
export const JWT = {
  // Segredo de assinatura. CRÍTICO: se vazar, qualquer um pode forjar tokens.
  // Em produção iria para um KMS. Aqui no MVP fica no .env.
  segredo: process.env.JWT_SECRET,
  expiracao: process.env.JWT_EXPIRACAO || "1h", // formato de jsonwebtoken
  emissor: "uti-api-gateway",
};

if (!JWT.segredo || JWT.segredo.length < 32) {
  throw new Error(
    "JWT_SECRET ausente ou curto (<32 chars). Gere com:\n" +
    "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
}

// ─── DIRETÓRIO DE USUÁRIOS ───────────────────────────────────────────────────
// Carregado do .env como JSON. Em produção real, seria um banco ou um IdP
// (Keycloak, Auth0). Para o MVP, três usuários estáticos cobrem o RBAC.
//
// Formato esperado em .env:
//   USUARIOS_JSON='[
//     {"login":"dr.silva","hash":"$2a$10$...","role":"medico","nome":"Dr. Silva"},
//     {"login":"enf.santos","hash":"$2a$10$...","role":"enfermeiro","nome":"Enf. Santos"},
//     {"login":"dpo.admin","hash":"$2a$10$...","role":"dpo","nome":"DPO Admin"}
//   ]'
let usuarios = [];
try {
  usuarios = JSON.parse(process.env.USUARIOS_JSON || "[]");
} catch (e) {
  throw new Error("USUARIOS_JSON não é JSON válido. Veja .env.example.");
}
if (usuarios.length === 0) {
  throw new Error(
    "USUARIOS_JSON vazio. Use 'npm run gerar-hash' para gerar hashes e cole no .env."
  );
}
export const USUARIOS = usuarios;

// ─── ROLES e RBAC ────────────────────────────────────────────────────────────
// Os três papéis suportados pelo sistema.
export const ROLES = ["dpo", "medico", "enfermeiro"];

/**
 * Política de acesso por rota. Cada entrada:
 *   { metodo, padrao (RegExp), rolesPermitidas, destino }
 *
 * - `metodo` e `padrao` casam a requisição do cliente
 * - `rolesPermitidas` diz quem pode chamar (RBAC). Vazio = qualquer autenticado.
 * - `destino` é o serviço interno para onde encaminhar (proxy transparente)
 *
 * IMPORTANTE: a ordem importa — a primeira rota que casar vence. Coloque
 * sempre as MAIS ESPECÍFICAS antes das genéricas (ex: /reidentificar antes
 * de /:pseudonimo).
 */
export const ROTAS = [
  // ─── PACIENTES (REST) ───────────────────────────────────────────
  // Reidentificar é a operação MAIS SENSÍVEL. Só médico.
  {
    metodo: "POST",
    padrao: /^\/api\/pacientes\/(PAC-[a-zA-Z0-9]+)\/reidentificar\/?$/,
    rolesPermitidas: ["medico"],
    destino: process.env.PATIENTS_URL || "http://localhost:8082",
    reescreverPara: (caminho) => caminho.replace(/^\/api/, ""),
    descricao: "Reidentificar paciente (PII em claro)",
  },
  // Cadastrar paciente: médico ou enfermeiro
  {
    metodo: "POST",
    padrao: /^\/api\/pacientes\/?$/,
    rolesPermitidas: ["medico", "enfermeiro"],
    destino: process.env.PATIENTS_URL || "http://localhost:8082",
    reescreverPara: (caminho) => caminho.replace(/^\/api/, ""),
    descricao: "Cadastrar paciente",
  },
  // Listar e ver paciente (dados públicos): qualquer autenticado
  {
    metodo: "GET",
    padrao: /^\/api\/pacientes\/?(.*)$/,
    rolesPermitidas: ["medico", "enfermeiro", "dpo"],
    destino: process.env.PATIENTS_URL || "http://localhost:8082",
    reescreverPara: (caminho) => caminho.replace(/^\/api/, ""),
    descricao: "Listar/ver paciente (público)",
  },

  // ─── CONSULTA (GraphQL) ─────────────────────────────────────────
  // Toda chamada GraphQL passa pelo mesmo /api/graphql. O controle fino
  // (quem pode chamar a mutation reidentifyPatient) acontece com o Gateway
  // injetando o JWT no header para o query-service VALIDAR a role da mutation.
  // Para o MVP, deixamos médicos e enfermeiros entrarem; o query-service usa
  // o header X-User-Role para decidir.
  {
    metodo: "POST",
    padrao: /^\/api\/graphql\/?$/,
    rolesPermitidas: ["medico", "enfermeiro", "dpo"],
    destino: process.env.QUERY_URL || "http://localhost:8083",
    reescreverPara: () => "/", // Apollo standalone serve em /
    descricao: "Consulta GraphQL",
  },
];

// ─── HTTP ────────────────────────────────────────────────────────────────────
export const HTTP = {
  porta: Number(process.env.HTTP_PORTA) || 8080,
};

// ─── RATE LIMIT (defesa simples contra força bruta no login) ─────────────────
export const RATE_LIMIT = {
  janelaMs: 60_000,     // janela de 1 minuto
  maxTentativas: 5,     // máx 5 tentativas falhas por IP por minuto
};
