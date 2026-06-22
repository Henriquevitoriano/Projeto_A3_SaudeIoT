/**
 * config.js
 * -----------------------------------------------------------------------------
 * Configuração do Serviço de Auditoria.
 *
 * Em produção real, este serviço deveria usar um cluster MongoDB FISICAMENTE
 * SEPARADO dos demais (para que comprometer o cluster principal não permita
 * apagar a auditoria). E o usuário do banco usado aqui deveria ter privilégio
 * APENAS de insertOne na coleção 'eventos' — nem update, nem delete.
 *
 * Para o MVP usamos o mesmo cluster (banco lógico separado 'uti_auditoria').
 * No README explicamos como configurar o usuário WORM no Atlas — passo
 * importante para a defesa LGPD na banca.
 */

import "dotenv/config";

export const MONGO = {
  // Idealmente uma URL de cluster separado. Para o MVP, reutilizamos
  // MONGO_URL do projeto (banco lógico distinto).
  url: process.env.MONGO_URL_AUDIT || process.env.MONGO_URL,
  database: process.env.MONGO_DB_AUDIT || "uti_auditoria",
  collection: process.env.MONGO_COLLECTION_AUDIT || "eventos",
};

if (!MONGO.url) {
  throw new Error(
    "MONGO_URL_AUDIT (ou MONGO_URL) não definida. Veja .env.example."
  );
}

export const HTTP = {
  porta: Number(process.env.HTTP_PORTA) || 8084,
};

// Token simples para autenticação service-to-service entre patients-service
// e audit-service. NÃO é o JWT do Gateway — é um segredo compartilhado entre
// os DOIS serviços, evita que qualquer um consiga gravar evento.
// Em produção real isto seria mTLS entre os pods.
export const AUDIT_TOKEN = process.env.AUDIT_SHARED_TOKEN;
if (!AUDIT_TOKEN || AUDIT_TOKEN.length < 32) {
  throw new Error(
    "AUDIT_SHARED_TOKEN ausente ou curto (<32 chars). Gere com:\n" +
    "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}
