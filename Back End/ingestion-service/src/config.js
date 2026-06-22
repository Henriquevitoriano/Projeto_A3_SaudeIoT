/**
 * config.js
 * -----------------------------------------------------------------------------
 * Centraliza TODA a configuração do serviço. Lê de variáveis de ambiente, com
 * defaults sensatos para desenvolvimento local.
 *
 * IMPORTANTE: NUNCA coloque a senha do MongoDB ou credenciais aqui. Elas vivem
 * no arquivo .env (que está no .gitignore e nunca vai para o repositório).
 * Isso é uma exigência da ISO 27001 (gestão de credenciais) e uma das regras
 * mais básicas de segurança em qualquer projeto.
 */

import "dotenv/config"; // carrega o arquivo .env e popula process.env

// ─── MQTT ────────────────────────────────────────────────────────────────────
export const MQTT = {
  url: process.env.MQTT_URL || "mqtt://localhost:1883",
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASS || undefined,

  // O curinga '+' captura qualquer valor naquele nível do tópico.
  // Assinar 'hospital/uti/+/+' significa: "receba TODOS os sinais de TODOS os
  // pacientes". Uma única assinatura cobre o sistema inteiro.
  topicoAssinatura: "hospital/uti/+/+",
};

// ─── MONGODB ATLAS ───────────────────────────────────────────────────────────
export const MONGO = {
  // String de conexão completa (vinda do .env). Exemplo:
  // mongodb+srv://user:senha@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
  url: process.env.MONGO_URL,

  // Nome do banco e da coleção. O MongoDB cria automaticamente na 1a gravação.
  database: process.env.MONGO_DB || "uti_monitor",
  collection: process.env.MONGO_COLLECTION || "sinais_vitais",
};

// Falha cedo se MONGO_URL não foi definida — melhor estourar agora do que
// descobrir lá na frente que estamos sem banco.
if (!MONGO.url) {
  throw new Error(
    "MONGO_URL não definida. Copie .env.example para .env e configure."
  );
}

// ─── CIRCUIT BREAKER ─────────────────────────────────────────────────────────
// Parâmetros do padrão Circuit Breaker (livro 'Release It!' de Michael Nygard).
//
// timeout: se o MongoDB não responder em X ms, considera a chamada falha.
// errorThresholdPercentage: % de erros nas últimas chamadas para ABRIR o
//   circuito. 50% = se metade das tentativas falhou, paramos de tentar.
// resetTimeout: depois de aberto, quanto tempo esperar antes de tentar de novo
//   (estado HALF_OPEN). Se a próxima tentativa der certo, fecha o circuito.
// rollingCountTimeout: janela de tempo (ms) considerada para calcular o %.
//
// Esses valores são razoáveis para um MVP. Em produção, calibra-se observando
// a latência real do serviço.
export const CIRCUIT_BREAKER = {
  timeout: 3000,                  // 3s p/ o Mongo responder
  errorThresholdPercentage: 50,   // abre se >= 50% das chamadas falharem
  resetTimeout: 10000,            // espera 10s antes de tentar de novo
  rollingCountTimeout: 10000,     // janela de 10s para estatística
  rollingCountBuckets: 10,        // 10 buckets de 1s cada
};
