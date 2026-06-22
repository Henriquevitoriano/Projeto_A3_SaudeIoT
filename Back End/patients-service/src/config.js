/**
 * config.js
 * -----------------------------------------------------------------------------
 * Configuração centralizada. Tudo via variável de ambiente.
 *
 * Decisão arquitetural: o banco aqui é UM BANCO LÓGICO SEPARADO ('uti_pacientes')
 * dentro do mesmo cluster Atlas. Em produção, isso se promoveria para um
 * cluster físico separado sem mudar uma linha de código — só a MONGO_URL
 * deste serviço (cada serviço tem seu próprio .env, isolado dos demais).
 *
 * Em produção, idealmente, o usuário do banco usado por este serviço teria
 * privilégio APENAS sobre o banco 'uti_pacientes' (princípio do menor
 * privilégio). Veja README sobre como criar esse usuário no Atlas.
 */

import "dotenv/config";

export const MONGO = {
  url: process.env.MONGO_URL,
  database: process.env.MONGO_DB || "uti_pacientes",
  collection: process.env.MONGO_COLLECTION || "pacientes",
};

if (!MONGO.url) {
  throw new Error(
    "MONGO_URL não definida. Copie .env.example para .env e configure."
  );
}

// Porta do servidor HTTP REST
export const HTTP = {
  porta: Number(process.env.HTTP_PORTA) || 8082,
};
