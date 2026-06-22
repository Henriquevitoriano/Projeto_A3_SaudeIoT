/**
 * cripto.js
 * -----------------------------------------------------------------------------
 * Criptografia em nível de aplicação para campos sensíveis (nome, CPF, etc).
 *
 * ALGORITMO: AES-256-GCM
 *
 * Por que AES-256-GCM (e não AES-CBC, AES-ECB, etc)?
 *  - AES-256: padrão da indústria, recomendado pelo NIST e pela ISO 27001.
 *  - GCM (Galois/Counter Mode): além de criptografar (confidencialidade),
 *    produz uma "tag de autenticação" que detecta se o ciphertext foi
 *    adulterado. É o que chamamos de "autenticated encryption" (AEAD).
 *  - CBC e ECB NÃO são autenticados — ECB é especialmente ruim por preservar
 *    padrões do plaintext. Em projeto sério, GCM é a escolha correta.
 *
 * PARÂMETROS:
 *  - chave: 32 bytes (256 bits), armazenada como hex no .env
 *  - IV (Initialization Vector): 12 bytes ALEATÓRIOS por mensagem
 *  - tag de autenticação: 16 bytes, gerada automaticamente pelo GCM
 *
 * FORMATO DE ARMAZENAMENTO:
 *  Cada campo cifrado vira um objeto: { iv, tag, ciphertext } — todos em hex.
 *  Isso permite descriptografar depois sem precisar de metadados externos.
 *
 * IMPORTANTE: o IV é PÚBLICO mas DEVE ser único por mensagem. Reusar IV com
 * a mesma chave QUEBRA a segurança do GCM. Por isso geramos com randomBytes
 * a cada chamada, nunca derivamos do conteúdo.
 *
 * GESTÃO DE CHAVE: a chave fica no .env, NUNCA no código. Em produção real,
 * usaríamos um KMS (Key Management Service) como AWS KMS, GCP KMS ou
 * MongoDB CSFLE com KMIP. Para o MVP, .env é o trade-off aceito.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; // 12 bytes = padrão recomendado para GCM
const TAMANHO_CHAVE_HEX = 64; // 32 bytes em hex = 64 chars

// Lê a chave do .env e valida. Falha cedo se estiver errada.
const CHAVE_HEX = process.env.PII_ENCRYPTION_KEY;
if (!CHAVE_HEX) {
  throw new Error(
    "PII_ENCRYPTION_KEY não definida. Gere com:\n" +
    "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
    "e cole no .env como PII_ENCRYPTION_KEY=<valor>"
  );
}
if (CHAVE_HEX.length !== TAMANHO_CHAVE_HEX) {
  throw new Error(
    `PII_ENCRYPTION_KEY deve ter exatamente ${TAMANHO_CHAVE_HEX} caracteres hex ` +
    `(=${TAMANHO_CHAVE_HEX/2} bytes). Tem: ${CHAVE_HEX.length}.`
  );
}
const CHAVE = Buffer.from(CHAVE_HEX, "hex");

/**
 * Criptografa uma string. Retorna um objeto pronto para gravar no Mongo.
 *
 * @param {string} texto - dado em claro (ex: "João da Silva")
 * @returns {{ iv: string, tag: string, ct: string } | null}
 *          retorna null se o texto for null/undefined/'' (para PII opcional)
 */
export function cifrar(texto) {
  if (texto === null || texto === undefined || texto === "") return null;
  if (typeof texto !== "string") {
    throw new TypeError(`cifrar() espera string, recebeu ${typeof texto}`);
  }

  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv(ALGORITMO, CHAVE, iv);

  const ct = Buffer.concat([
    cipher.update(texto, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    iv:  iv.toString("hex"),
    tag: tag.toString("hex"),
    ct:  ct.toString("hex"),
  };
}

/**
 * Descriptografa o objeto produzido por cifrar().
 *
 * Se a tag de autenticação não bater (ciphertext adulterado ou chave errada),
 * o GCM LANÇA UMA EXCEÇÃO — é a garantia de integridade do AEAD.
 *
 * @param {{ iv, tag, ct } | null} pacote
 * @returns {string | null}
 */
export function decifrar(pacote) {
  if (pacote === null || pacote === undefined) return null;
  if (!pacote.iv || !pacote.tag || !pacote.ct) {
    throw new Error("pacote cifrado inválido: faltam campos iv/tag/ct");
  }

  const iv  = Buffer.from(pacote.iv,  "hex");
  const tag = Buffer.from(pacote.tag, "hex");
  const ct  = Buffer.from(pacote.ct,  "hex");

  const decipher = createDecipheriv(ALGORITMO, CHAVE, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([
    decipher.update(ct),
    decipher.final(), // se a tag não bater, lança aqui
  ]);
  return plain.toString("utf8");
}
