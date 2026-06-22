/**
 * validador.js
 * -----------------------------------------------------------------------------
 * Valida que uma mensagem MQTT recebida está em conformidade com o "contrato
 * de dados" do sistema antes de ser gravada.
 *
 * Por que validar? Princípio da fortaleza: cada serviço se defende sozinho,
 * não confia em ninguém — nem mesmo "no nosso próprio simulador". Se amanhã
 * alguém (ou um sensor com firmware bugado) publicar lixo num tópico, este
 * serviço descarta a mensagem e segue funcionando, sem corromper o banco.
 *
 * Validações realizadas:
 *   1. Tópico no formato hospital/uti/{pseudonimo}/{tipo}
 *   2. Payload é JSON válido
 *   3. Todos os campos do contrato estão presentes
 *   4. Tipos corretos (valor numérico, timestamp ISO 8601 etc.)
 *   5. NENHUM campo de PII (nome, cpf...) - barreira anti-vazamento LGPD
 *   6. Coerência: pseudonimo/tipo no payload batem com o do tópico
 */

const CAMPOS_OBRIGATORIOS = [
  "pseudonimo", "tipo", "valor", "unidade", "timestamp", "sensor_id",
];

// Lista (não exaustiva) de campos que NÃO podem aparecer no payload.
// Se aparecerem, é vazamento de PII e a mensagem é REJEITADA.
const CAMPOS_PII_PROIBIDOS = [
  "nome", "name", "cpf", "rg", "email", "telefone", "phone",
  "paciente_nome", "patient_name", "endereco", "address",
];

const TOPICO_REGEX = /^hospital\/uti\/(PAC-[a-zA-Z0-9]+)\/([a-z_0-9]+)$/;

/**
 * Valida uma mensagem completa (tópico + payload em buffer).
 * @returns {{ valido: boolean, motivo?: string, sinal?: object }}
 *   - valido=true:  devolve o objeto `sinal` pronto para o repositório.
 *   - valido=false: devolve `motivo` explicando por que foi rejeitada.
 */
export function validar(topico, payloadBuffer) {
  // 1) Tópico no padrão
  const m = TOPICO_REGEX.exec(topico);
  if (!m) {
    return { valido: false, motivo: `tópico fora do padrão: ${topico}` };
  }
  const pseudonimoTopico = m[1];
  const tipoTopico = m[2];

  // 2) Payload é JSON válido
  let obj;
  try {
    obj = JSON.parse(payloadBuffer.toString());
  } catch {
    return { valido: false, motivo: "payload não é JSON válido" };
  }

  // 3) Todos os campos obrigatórios presentes
  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (!(campo in obj)) {
      return { valido: false, motivo: `campo obrigatório ausente: ${campo}` };
    }
  }

  // 4) Tipos corretos
  if (typeof obj.valor !== "number" || !Number.isFinite(obj.valor)) {
    return { valido: false, motivo: `valor deve ser número finito (recebido: ${obj.valor})` };
  }
  if (isNaN(Date.parse(obj.timestamp))) {
    return { valido: false, motivo: `timestamp inválido: ${obj.timestamp}` };
  }

  // 5) BARREIRA ANTI-PII: rejeita se algum campo proibido apareceu.
  // Isso é uma "linha de defesa" extra: mesmo que algum dia alguém erre e
  // publique PII num tópico, o serviço descarta a mensagem e LOGA o incidente.
  for (const proibido of CAMPOS_PII_PROIBIDOS) {
    if (proibido in obj) {
      return {
        valido: false,
        motivo: `BARREIRA LGPD: campo PII proibido detectado no payload: '${proibido}'`,
      };
    }
  }

  // 6) Coerência: pseudonimo e tipo do payload devem bater com o tópico.
  // Previne mensagens "fora do lugar" (ex: tópico spo2 com payload de temperatura).
  if (obj.pseudonimo !== pseudonimoTopico) {
    return {
      valido: false,
      motivo: `pseudônimo divergente: tópico='${pseudonimoTopico}' payload='${obj.pseudonimo}'`,
    };
  }
  if (obj.tipo !== tipoTopico) {
    return {
      valido: false,
      motivo: `tipo divergente: tópico='${tipoTopico}' payload='${obj.tipo}'`,
    };
  }

  return { valido: true, sinal: obj };
}
