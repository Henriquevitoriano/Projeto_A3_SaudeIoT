/**
 * schema.js
 * -----------------------------------------------------------------------------
 * Schema GraphQL — o "contrato" da API. Define quais tipos existem, quais
 * queries podem ser feitas e quais mutations podem alterar estado.
 *
 * Por que GraphQL aqui (e não REST)?
 *  - O dashboard de UTI precisa COMBINAR dados de formas variáveis:
 *    "lista de pacientes + score NEWS2 de cada um", "sinais de SpO2 das
 *    últimas 2h de UM paciente", "todos os tipos de sinal de um paciente
 *    com timestamp". Cada combinação seria um endpoint REST diferente.
 *  - Com GraphQL, o CLIENTE declara o que quer. O servidor entrega exatamente
 *    isso — sem over-fetching (trazer dados a mais) nem under-fetching
 *    (precisar de várias chamadas para montar uma tela).
 *  - É decisão coerente com o C4: definimos lá que usaríamos GraphQL no
 *    "Serviço de Consulta" e REST nos serviços de comando.
 *
 * Convenção de nomes: SDL (Schema Definition Language) usa nomes em inglês
 * como padrão da indústria, então mantenho aqui (Patient, VitalSign, etc).
 * Os RESOLVERS internos podem usar nomes do nosso domínio em português.
 */

export const typeDefs = `#graphql
  # ─── TIPOS DE DADOS ────────────────────────────────────────────────────

  """
  Um paciente da UTI. Note: NUNCA expõe PII (nome, CPF) por aqui.
  Para obter a identidade real, é preciso usar a mutation 'reidentifyPatient'
  com motivo e solicitante (auditado pelo serviço de Pacientes).
  """
  type Patient {
    pseudonimo: ID!
    leito: String
    idadeAprox: Int
    sexo: String
    ativo: Boolean

    "Sinais vitais do paciente (com filtros opcionais)"
    sinais(
      "Tipos de sinal a retornar (vazio = todos)"
      tipos: [String!]
      "Janela em minutos para trás (default 60)"
      janelaMin: Int = 60
      "Limite de pontos por sinal (default 100)"
      limite: Int = 100
    ): [VitalSign!]!

    "Score NEWS2 calculado a partir do snapshot mais recente"
    news2: NEWS2Score
  }

  """
  Uma leitura individual de sinal vital. Indexada por timestamp e tipo.
  """
  type VitalSign {
    pseudonimo: ID!
    tipo: String!
    valor: Float!
    unidade: String!
    timestamp: String!
    sensorId: String
  }

  """
  Resultado do cálculo NEWS2 para um paciente em um momento.
  """
  type NEWS2Score {
    scoreTotal: Int!
    risco: Risco!
    maiorIndividual: Int!
    sinaisAvaliados: Int!
    detalhes: [NEWS2Detalhe!]!
    calculadoEm: String!
  }

  type NEWS2Detalhe {
    tipo: String!
    valor: Float!
    pontos: Int!
  }

  enum Risco { baixo medio alto indeterminado }

  """
  Identidade real do paciente (PII). SÓ retornada via mutation
  'reidentifyPatient' com solicitante e motivo registrados em auditoria.
  """
  type PatientIdentity {
    pseudonimo: ID!
    nome: String!
    cpf: String!
    leito: String
    idadeAprox: Int
    sexo: String
  }

  # ─── QUERIES (leituras) ────────────────────────────────────────────────

  type Query {
    "Lista todos os pacientes ativos (sem PII)."
    patients: [Patient!]!

    "Busca um paciente pelo pseudônimo (sem PII)."
    patient(pseudonimo: ID!): Patient

    "Sinais vitais de um paciente, com filtros opcionais."
    vitalSigns(
      pseudonimo: ID!
      tipos: [String!]
      janelaMin: Int = 60
      limite: Int = 100
    ): [VitalSign!]!

    "Score NEWS2 atual de um paciente."
    news2(pseudonimo: ID!): NEWS2Score
  }

  # ─── MUTATIONS (operações sensíveis) ───────────────────────────────────

  type Mutation {
    """
    Reidentifica um paciente — operação ALTAMENTE SENSÍVEL.
    Encaminha a chamada para o serviço de Pacientes, que faz a decriptação
    e registra a operação em auditoria.
    """
    reidentifyPatient(
      pseudonimo: ID!
      solicitante: String!
      motivo: String!
    ): PatientIdentity
  }
`;
