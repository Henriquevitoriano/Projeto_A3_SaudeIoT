/**
 * pacientes.js
 * -----------------------------------------------------------------------------
 * Camada de regras de negócio do domínio "Paciente".
 *
 * Aqui mora a ESTRATÉGIA LGPD do sistema inteiro:
 *  - gerarPseudonimo(): cria o identificador opaco que circulará por todo o
 *    resto do sistema (ingestion, alerts, dashboard).
 *  - cadastrar(): recebe dados pessoais REAIS, separa o que é PII (vai
 *    cifrado) do que é público (vai em claro), grava, devolve SÓ o pseudônimo.
 *  - reidentificar(): a operação MAIS SENSÍVEL do sistema. Recebe pseudônimo,
 *    decifra PII, devolve identidade. Aqui é onde a auditoria imutável vai
 *    se conectar no Passo 8.
 *  - obterPublico(): devolve dados não-identificáveis (leito, idade aprox,
 *    sexo) — para casos onde o solicitante não precisa da identidade.
 */

import { randomBytes } from "node:crypto";
import { cifrar, decifrar } from "./cripto.js";
import * as repo from "./repositorio.js";
import { registrarEvento } from "./audit-client.js";

/**
 * Gera um pseudônimo opaco no formato 'PAC-xxxxxx' (6 chars hex aleatórios).
 *
 * IMPORTANTE: o pseudônimo é gerado com `crypto.randomBytes`, que é um RNG
 * criptograficamente seguro. Não é derivado do CPF, nome ou qualquer outro
 * dado do paciente. Isso é PROPOSITAL — se fosse derivado, alguém com acesso
 * ao CPF poderia recomputar o pseudônimo e quebrar a pseudonimização.
 *
 * Espaço: 24 bits = 16.7 milhões de combinações. Para o MVP é folgado.
 * Em produção real, aumentaríamos para 8-12 bytes e/ou trataríamos colisões.
 */
function gerarPseudonimo() {
  return "PAC-" + randomBytes(3).toString("hex"); // ex: PAC-7f3a9b
}

/**
 * Cadastra um novo paciente.
 *
 * Recebe dados pessoais REAIS. Separa em três categorias:
 *  1) Identificadores PII (nome, cpf): vão CIFRADOS para o banco.
 *  2) Dados quase-identificadores públicos (leito, idade_aprox, sexo): em claro.
 *  3) Gera o pseudônimo opaco que será exposto para o resto do sistema.
 *
 * @param {{ nome, cpf, leito, idade_aprox, sexo, data_internacao }} dados
 * @returns {{ pseudonimo, leito, idade_aprox, sexo }} - sem PII real
 */
export async function cadastrar(dados) {
  // Validações mínimas de entrada (não confie no cliente)
  if (!dados || typeof dados !== "object") {
    throw new ValidationError("payload inválido");
  }
  if (!dados.nome || typeof dados.nome !== "string") {
    throw new ValidationError("campo 'nome' é obrigatório (string)");
  }
  if (!dados.cpf || typeof dados.cpf !== "string") {
    throw new ValidationError("campo 'cpf' é obrigatório (string)");
  }
  if (!dados.leito || typeof dados.leito !== "string") {
    throw new ValidationError("campo 'leito' é obrigatório (string)");
  }

  // Gera o pseudônimo. Em caso ASTRONOMICAMENTE improvável de colisão, regera.
  // (16M de espaço; nunca vamos ter milhões de pacientes simultâneos no A3.)
  let pseudonimo = gerarPseudonimo();
  // Verificação simples — se o índice unique falhar no insert, lançaremos erro.

  const doc = {
    pseudonimo,
    // PII cifrada (AES-256-GCM) — só o serviço de Pacientes pode decifrar
    nome_cifrado: cifrar(dados.nome),
    cpf_cifrado:  cifrar(dados.cpf),
    // Dados quase-identificadores em claro (úteis para a equipe sem
    // expor identidade real)
    leito:        dados.leito,
    idade_aprox:  dados.idade_aprox ?? null,    // ex: 65 (não dá data exata)
    sexo:         dados.sexo ?? null,
    ativo:        true,
    data_internacao: dados.data_internacao
      ? new Date(dados.data_internacao)
      : new Date(),
    criado_em:    new Date(),
  };

  try {
    await repo.criar(doc);
  } catch (e) {
    // 11000 = duplicate key (colisão de pseudônimo). Como é raríssimo, simples:
    if (e.code === 11000) {
      throw new Error("colisão de pseudônimo, tente novamente");
    }
    throw e;
  }

  // Retorna SÓ o pseudônimo + dados públicos. Identidade não sai daqui.
  return {
    pseudonimo: doc.pseudonimo,
    leito:      doc.leito,
    idade_aprox: doc.idade_aprox,
    sexo:       doc.sexo,
  };
}

/**
 * Reidentifica um paciente — OPERAÇÃO ALTAMENTE SENSÍVEL.
 *
 * Recebe um pseudônimo, decifra a PII, retorna a identidade real.
 *
 * Pré-requisito que o caller deve atender (Gateway + Auth no Passo 7):
 *   - JWT do solicitante tem role autorizada (médico, enfermeiro de plantão)
 *   - Motivo da reidentificação registrado (atendimento, prescrição, etc)
 *
 * No Passo 8 (auditoria imutável), TODA chamada aqui virará um registro WORM
 * para auditoria LGPD (Art. 37 — registro das operações de tratamento).
 *
 * @param {string} pseudonimo
 * @param {{ solicitante, motivo }} contexto - quem pediu e por quê (auditoria)
 * @returns {{ pseudonimo, nome, cpf, leito, ... } | null}
 */
export async function reidentificar(pseudonimo, contexto) {
  if (!pseudonimo) throw new ValidationError("pseudônimo obrigatório");

  const doc = await repo.buscarPorPseudonimo(pseudonimo);
  if (!doc) return null;

  // ─── AUDITORIA IMUTÁVEL (LGPD Art. 37) ──────────────────────────────────
  // REGRA FAIL-CLOSED: registra o evento ANTES de devolver a PII. Se o
  // audit-service estiver fora do ar, a reidentificação FALHA — sem
  // auditoria, não há acesso à identidade real.
  //
  // O 'solicitante' aqui vem do Gateway (header X-User-Login extraído do
  // JWT validado) — não é mais palavra do cliente, é não-falsificável.
  try {
    await registrarEvento({
      tipo: "reidentificacao",
      pseudonimo,
      solicitante: contexto?.solicitante || "anonimo",
      solicitanteRole: contexto?.solicitanteRole || null,
      motivo: contexto?.motivo || "nao-informado",
      ip: contexto?.ip || null,
    });
  } catch (e) {
    console.error("[AUDIT] FALHA AO REGISTRAR — reidentificação ABORTADA:", e.message);
    throw new Error("auditoria indisponível — reidentificação não autorizada");
  }

  return {
    pseudonimo: doc.pseudonimo,
    nome: decifrar(doc.nome_cifrado),
    cpf:  decifrar(doc.cpf_cifrado),
    leito: doc.leito,
    idade_aprox: doc.idade_aprox,
    sexo: doc.sexo,
    ativo: doc.ativo,
    data_internacao: doc.data_internacao,
  };
}

/**
 * Devolve dados PÚBLICOS de um paciente (sem PII).
 *
 * Use isto sempre que possível em vez de reidentificar — minimização.
 * Ex: "qual leito do PAC-7f3a9b?" não precisa expor nome/CPF.
 */
export async function obterPublico(pseudonimo) {
  const doc = await repo.buscarPorPseudonimo(pseudonimo);
  if (!doc) return null;
  return {
    pseudonimo: doc.pseudonimo,
    leito: doc.leito,
    idade_aprox: doc.idade_aprox,
    sexo: doc.sexo,
    ativo: doc.ativo,
  };
}

/**
 * Lista pacientes ativos (sem PII).
 */
export async function listar() {
  return repo.listar();
}

/**
 * Erro de validação — usado pelo servidor HTTP para devolver 400.
 */
export class ValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ValidationError";
  }
}
