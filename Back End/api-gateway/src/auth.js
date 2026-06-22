/**
 * auth.js
 * -----------------------------------------------------------------------------
 * Autenticação: login com bcrypt + emissão/validação de JWT.
 *
 * FLUXO:
 *   1. Cliente envia POST /auth/login { login, senha }
 *   2. Gateway verifica o hash bcrypt do usuário
 *   3. Se bate, emite um JWT com claims { sub: login, role, nome, iss, iat, exp }
 *   4. Cliente envia o JWT no header `Authorization: Bearer <token>` nas
 *      requisições subsequentes
 *   5. O Gateway valida a assinatura e extrai role/nome do token
 *
 * SEGURANÇA:
 *  - Senhas NUNCA trafegam após o login (só o JWT vai e volta)
 *  - JWT é ASSINADO (HS256), não cifrado. O conteúdo (login, role) é legível,
 *    mas adulteração é detectada pela assinatura.
 *  - Em produção, JWT poderia usar RS256 (chave assimétrica) para que outros
 *    serviços validem sem ter o segredo. Para o MVP, HS256 é suficiente.
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT, USUARIOS } from "./config.js";

/**
 * Tenta autenticar com login/senha. Retorna o JWT ou null se falhou.
 *
 * IMPORTANTE: NÃO diferenciamos "usuário não existe" de "senha errada" — em
 * ambos os casos retornamos null. Diferenciar permite ENUMERAÇÃO de usuários
 * (atacante descobre quais logins existem). É uma proteção clássica.
 */
export async function login(loginInput, senhaInput) {
  if (!loginInput || !senhaInput) return null;

  const user = USUARIOS.find((u) => u.login === loginInput);

  // Mesmo se o user não existir, fazemos UMA comparação bcrypt fake para
  // que o tempo de resposta não revele a existência (timing attack).
  // O hash usado aqui é dummy mas válido.
  const hashParaComparar = user?.hash || "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi";
  const ok = await bcrypt.compare(senhaInput, hashParaComparar);

  if (!user || !ok) return null;

  const token = jwt.sign(
    {
      sub: user.login,
      role: user.role,
      nome: user.nome,
    },
    JWT.segredo,
    {
      algorithm: "HS256",
      expiresIn: JWT.expiracao,
      issuer: JWT.emissor,
    },
  );

  return {
    token,
    usuario: { login: user.login, role: user.role, nome: user.nome },
  };
}

/**
 * Valida um JWT vindo no header Authorization. Retorna o payload ou null.
 */
export function validar(headerAuth) {
  if (!headerAuth || !headerAuth.startsWith("Bearer ")) return null;
  const token = headerAuth.slice(7).trim();
  if (!token) return null;

  try {
    return jwt.verify(token, JWT.segredo, {
      algorithms: ["HS256"],     // explícito — impede ataque "alg: none"
      issuer: JWT.emissor,        // garante que o token foi emitido por nós
    });
  } catch {
    return null;
  }
}
