/**
 * servidor.js
 * -----------------------------------------------------------------------------
 * Sobe o Apollo Server (standalone) com playground habilitado.
 *
 * O Apollo Server cuida sozinho de:
 *  - Parsing/validação da query contra o schema
 *  - Roteamento dos campos para os resolvers
 *  - Paralelismo de resolvers aninhados
 *  - Formatação consistente de erros
 *  - Servir o GraphQL Playground em GET /graphql (interface visual para
 *    explorar e testar queries — excelente para a demo na banca)
 */

import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";
import { HTTP } from "./config.js";

export async function iniciar() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    // introspection: true permite ferramentas (Apollo Studio, playground)
    // descobrirem o schema. Em produção real, normalmente DESLIGAMOS para
    // não expor a API. Para o MVP/demo, deixamos ligado.
    introspection: true,
    // formatError customizado: garante que NUNCA enviamos stack trace nem
    // detalhes internos para o cliente — proteção contra information leak.
    formatError: (formatted, err) => {
      console.error("[GRAPHQL]", err);
      return {
        message: formatted.message,
        path: formatted.path,
        // omite `extensions.stacktrace`, `locations` etc.
      };
    },
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: HTTP.porta },
  });

  console.log(`[GRAPHQL] Apollo Server pronto em ${url}`);
  return server;
}
