# Serviço de Consulta (GraphQL) — UTI

Camada de leitura do sistema. Expõe um único endpoint GraphQL que combina
dados de várias fontes (sinais vitais do Mongo + identidade do Patients Service
+ cálculo NEWS2 em runtime) numa única requisição.

## Por que GraphQL aqui (e não REST)?

O dashboard de UTI precisa **combinar dados de formas variáveis**:
- "lista de pacientes + score NEWS2 de cada um"
- "sinais de SpO₂ das últimas 2h de UM paciente"
- "todos os tipos de sinal + dados do paciente"

Com REST, cada combinação vira um endpoint novo. Com GraphQL, o **cliente
declara** o que quer e o servidor entrega exatamente isso — sem over-fetching
nem múltiplas idas ao servidor.

## Arquitetura

```
Dashboard (HTTP/GraphQL)
        │
        ▼
  ┌─────────────────┐
  │ Apollo Server   │
  └────────┬────────┘
           │ (resolvers paralelos)
   ┌───────┴───────┐
   ▼               ▼
MongoDB        patients-service
(sinais)       (HTTP REST)
```

**O query-service NÃO acessa o banco de PII e NÃO tem a chave de cripto.**
Toda PII vem via HTTP do patients-service, que registra auditoria.

## Schema (resumo)

```graphql
type Patient {
  pseudonimo: ID!
  leito: String
  idadeAprox: Int
  sexo: String
  sinais(tipos: [String!], janelaMin: Int, limite: Int): [VitalSign!]!
  news2: NEWS2Score
}

type NEWS2Score {
  scoreTotal: Int!
  risco: Risco!         # baixo | medio | alto | indeterminado
  maiorIndividual: Int!
  detalhes: [NEWS2Detalhe!]!
}

type Query {
  patients: [Patient!]!
  patient(pseudonimo: ID!): Patient
  vitalSigns(pseudonimo: ID!, ...): [VitalSign!]!
  news2(pseudonimo: ID!): NEWS2Score
}

type Mutation {
  reidentifyPatient(pseudonimo: ID!, solicitante: String!, motivo: String!): PatientIdentity
}
```

## Como rodar

```bash
# 1. Instalar
npm install

# 2. Configurar
cp .env.example .env
# Edite .env: MONGO_URL e PATIENTS_URL

# 3. Garantir que o patients-service (Passo 5) está rodando

# 4. Rodar
npm start
```

## Demo no GraphQL Playground

Acesse http://localhost:8083 no navegador. O Apollo abre uma interface
visual onde você pode digitar queries com autocomplete e ver os resultados.

### Exemplo 1: tela "lista de pacientes com risco"
```graphql
{
  patients {
    pseudonimo
    leito
    news2 {
      scoreTotal
      risco
    }
  }
}
```

### Exemplo 2: tela "histórico SpO₂ das últimas 2 horas"
```graphql
{
  vitalSigns(pseudonimo: "PAC-7f3a9b", tipos: ["spo2"], janelaMin: 120, limite: 200) {
    valor
    unidade
    timestamp
  }
}
```

### Exemplo 3: reidentificar (sensível — vai parar no audit log)
```graphql
mutation {
  reidentifyPatient(
    pseudonimo: "PAC-7f3a9b"
    solicitante: "dr.silva"
    motivo: "prescricao medicamento"
  ) {
    nome
    cpf
  }
}
```

## Decisões de design

- **Apollo Server standalone** — tooling padrão da indústria; playground
  embutido facilita demonstração.
- **Schema-first** — typeDefs em SDL, depois resolvers. Padrão GraphQL.
- **formatError customizado** — nunca retornamos stack trace ao cliente
  (evita information leak; padrão OWASP).
- **introspection: true** — habilitado para a demo; em produção real,
  desligaria para esconder o schema.
- **Resolvers aninhados em paralelo** — Apollo orquestra a busca paralela
  por padrão. Elimina o problema N+1 do REST.

## Estrutura

```
src/
  config.js              # Mongo, patients URL, porta HTTP
  schema.js              # typeDefs GraphQL (SDL)
  resolvers.js           # implementações dos campos do schema
  sinais.js              # acesso ao Mongo (somente leitura)
  pacientes-client.js    # HTTP do patients-service (com timeout)
  news2.js               # algoritmo NEWS2 (cópia do alerts-service)
  servidor.js            # Apollo Server standalone
  index.js               # ponto de entrada
```
