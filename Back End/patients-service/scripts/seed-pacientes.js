import 'dotenv/config';
import { cadastrar } from '../src/pacientes.js';
import * as repo from '../src/repositorio.js';

function gerarCPF() {
  // gera um CPF simples (sem dígitos verificadores corretos) só para testes
  const n = () => Math.floor(Math.random() * 10);
  return Array.from({ length: 11 }, () => String(n())).join('');
}

function escolherSexo() {
  return Math.random() < 0.5 ? 'M' : 'F';
}

const nomes = [
  'JESSE FERREIRA GUIMARAES',
  'Alice Ines dos Santos',
  'César Henrique Soares',
  'Gustavo Villar Teragi',
  'Henrique Assao',
  'Victoria Silva Gonçalves',
  'Mariana Costa',
  'Lucas Pereira',
  'Beatriz Oliveira',
  'Rafael Souza',
];

async function main() {
  console.log('Iniciando seed de pacientes (10)...');
  await repo.inicializar();
  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i];
    const cpf = gerarCPF();
    const leito = `U-${String(Math.floor(i / 2) + 1).padStart(2, '0')}-${String((i % 2) + 1).padStart(2, '0')}`;
    const idade_aprox = 25 + Math.floor(Math.random() * 60);
    const sexo = escolherSexo();

    try {
      const res = await cadastrar({
        nome,
        cpf,
        leito,
        idade_aprox,
        sexo,
      });
      console.log(`OK: ${nome} -> ${res.pseudonimo} (leito ${res.leito})`);
    } catch (e) {
      console.error('ERRO ao cadastrar', nome, e.message);
    }
  }
  console.log('Seed finalizado.');
  await repo.encerrar();
  process.exit(0);
}

main();
