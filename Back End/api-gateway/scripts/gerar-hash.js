/**
 * scripts/gerar-hash.js
 * -----------------------------------------------------------------------------
 * Utilitário para gerar os hashes bcrypt dos usuários, prontos para copiar
 * para o .env.
 *
 * Uso:
 *   node scripts/gerar-hash.js
 *
 * O script gera três usuários (médico, enfermeiro, DPO) com senhas
 * pré-definidas para a demo. SUBSTITUA as senhas antes de usar em "produção"
 * (mesmo que seja só apresentação para a banca — senhas fracas são pegadas).
 */
import bcrypt from "bcryptjs";

const USUARIOS_DEMO = [
  { login: "dr.silva",   senha: "DemoMedico@2026",      role: "medico",     nome: "Dr. Silva" },
  { login: "enf.santos", senha: "DemoEnfermeiro@2026",  role: "enfermeiro", nome: "Enf. Santos" },
  { login: "dpo.admin",  senha: "DemoDPO@2026",         role: "dpo",        nome: "DPO Admin" },
];

const ROUNDS = 10; // custo do bcrypt; 10 é o equilíbrio padrão entre seg e perf

console.log("Gerando hashes bcrypt...\n");

const saida = [];
for (const u of USUARIOS_DEMO) {
  const hash = await bcrypt.hash(u.senha, ROUNDS);
  saida.push({ login: u.login, hash, role: u.role, nome: u.nome });
  console.log(`${u.login.padEnd(12)} hash gerado (senha em USUARIOS_DEMO, não impressa)`);
}

console.log("\n=========================================================");
console.log("COLE NO .env (em UMA LINHA, com aspas simples envolvendo):");
console.log("=========================================================\n");
console.log(`USUARIOS_JSON='${JSON.stringify(saida)}'\n`);
console.log("=========================================================");
console.log("LEMBRE-SE: troque essas senhas em qualquer uso real.");
console.log("=========================================================");
