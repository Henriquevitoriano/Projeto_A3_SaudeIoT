/**
 * resolvers.js
 * -----------------------------------------------------------------------------
 * Resolvers GraphQL — a "cola" entre o schema e os dados.
 *
 * Para cada campo do schema, Apollo chama o resolver correspondente. Resolvers
 * podem ser ASSÍNCRONOS e podem buscar em qualquer fonte (banco, outra API,
 * cálculo em runtime). Apollo orquestra o paralelismo e a composição.
 *
 * EXEMPLO de como GraphQL resolve composição:
 *   query {
 *     patients {           # ← resolver Query.patients (lista do patients-service)
 *       pseudonimo         # ← do objeto já retornado
 *       leito              # ← do objeto já retornado
 *       sinais(limite: 5)  # ← resolver Patient.sinais (busca no Mongo)
 *       news2 {            # ← resolver Patient.news2 (snapshot + cálculo)
 *         scoreTotal
 *         risco
 *       }
 *     }
 *   }
 * Apollo CHAMA OS RESOLVERS EM PARALELO para cada paciente — sem o cliente
 * precisar fazer N+1 requisições. Esse é o ganho concreto sobre REST.
 */

import * as sinaisRepo from "./sinais.js";
import * as patientsClient from "./pacientes-client.js";
import { calcularNEWS2 } from "./news2.js";

export const resolvers = {
  // ─── Query (leituras) ────────────────────────────────────────────────────
  Query: {
    /**
     * Lista pacientes — busca no patients-service e devolve sem PII.
     */
    patients: async () => {
      const lista = await patientsClient.listar();
      return lista.map(mapearPacienteRest);
    },

    /**
     * Busca paciente individual por pseudônimo.
     */
    patient: async (_, { pseudonimo }) => {
      const p = await patientsClient.buscarPorPseudonimo(pseudonimo);
      return p ? mapearPacienteRest(p) : null;
    },

    /**
     * Atalho: sinais vitais diretamente, sem ir pelo objeto Patient.
     * Útil para dashboards que só querem séries temporais.
     */
    vitalSigns: async (_, { pseudonimo, tipos, janelaMin, limite }) => {
      return sinaisRepo.buscarSinais(pseudonimo, tipos, janelaMin, limite);
    },

    /**
     * Atalho: score NEWS2 sem ir pelo objeto Patient.
     */
    news2: async (_, { pseudonimo }) => {
      return calcularNEWS2Resolver(pseudonimo);
    },
  },

  // ─── Mutation (operações sensíveis) ──────────────────────────────────────
  Mutation: {
    /**
     * REIDENTIFICAÇÃO — encaminha para o patients-service.
     * Aqui no query-service NÃO descriptografamos nada. Só intermediamos.
     * O patients-service é quem mantém a chave e registra a auditoria.
     */
    reidentifyPatient: async (_, { pseudonimo, solicitante, motivo }) => {
      // Validação mínima — o patients-service também valida, mas falhamos
      // cedo para economizar uma chamada HTTP desnecessária.
      if (!solicitante?.trim()) throw new Error("solicitante é obrigatório");
      if (!motivo?.trim())      throw new Error("motivo é obrigatório");

      const real = await patientsClient.reidentificar(pseudonimo, solicitante, motivo);
      if (!real) return null;

      return {
        pseudonimo: real.pseudonimo,
        nome: real.nome,
        cpf: real.cpf,
        leito: real.leito,
        idadeAprox: real.idade_aprox,
        sexo: real.sexo,
      };
    },
  },

  // ─── Resolvers ANINHADOS do tipo Patient ─────────────────────────────────
  // Estes são chamados quando o cliente pede sub-campos dentro de Patient.
  // O `parent` é o objeto retornado pelo resolver "pai" (Query.patients ou
  // Query.patient).
  Patient: {
    sinais: async (parent, { tipos, janelaMin, limite }) => {
      return sinaisRepo.buscarSinais(parent.pseudonimo, tipos, janelaMin, limite);
    },
    news2: async (parent) => {
      return calcularNEWS2Resolver(parent.pseudonimo);
    },
  },
};

// ─── Helpers internos ──────────────────────────────────────────────────────

/**
 * Converte o formato do patients-service (snake_case) para o do GraphQL
 * (camelCase). Padronizar idiomas é prática comum em GraphQL.
 */
function mapearPacienteRest(p) {
  return {
    pseudonimo: p.pseudonimo,
    leito: p.leito,
    idadeAprox: p.idade_aprox,
    sexo: p.sexo,
    ativo: p.ativo ?? true,
  };
}

/**
 * Helper que centraliza o cálculo NEWS2: busca snapshot, calcula, retorna no
 * formato esperado pelo GraphQL. Reutilizado pela Query.news2 e Patient.news2.
 */
async function calcularNEWS2Resolver(pseudonimo) {
  const snapshot = await sinaisRepo.buscarSnapshot(pseudonimo);
  // Se faltam sinais, devolvemos um score "indeterminado" — o cliente decide
  // como apresentar (ex: "aguardando dados" no dashboard).
  if (snapshot.length < 5) {
    return {
      scoreTotal: 0,
      risco: "indeterminado",
      maiorIndividual: 0,
      sinaisAvaliados: snapshot.length,
      detalhes: [],
      calculadoEm: new Date().toISOString(),
    };
  }
  const r = calcularNEWS2(snapshot);
  return {
    scoreTotal: r.scoreTotal,
    risco: r.risco,
    maiorIndividual: r.maiorIndividual,
    sinaisAvaliados: r.sinaisAvaliados,
    detalhes: r.detalhes,
    calculadoEm: new Date().toISOString(),
  };
}
