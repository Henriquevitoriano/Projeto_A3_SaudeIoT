/**
 * observador-logger.js
 * -----------------------------------------------------------------------------
 * OBSERVADOR Nº 1 — registra cada alerta no console, com destaque visual.
 *
 * É o observador mais simples possível. Serve para:
 *  - Demonstrar o padrão Observer (basta inscrever-se via motor.onAlerta)
 *  - Garantir trilha de auditoria mínima dos alertas emitidos
 *
 * Em produção real, este logger gravaria em Loki/CloudWatch/Datadog. No MVP,
 * console é suficiente — e é o que a banca vai ver durante a demo.
 */

const CORES = {
  alto:  "\x1b[41m\x1b[97m",  // fundo vermelho, texto branco
  medio: "\x1b[43m\x1b[30m",  // fundo amarelo, texto preto
  reset: "\x1b[0m",
};

export function registrar(motor) {
  motor.onAlerta((alerta) => {
    const cor = CORES[alerta.risco] || "";
    const linha = ` ALERTA ${alerta.risco.toUpperCase()} ${cor ? "" : ""}`;
    console.log(
      `${cor}${linha}${CORES.reset} ` +
      `paciente=${alerta.pseudonimo} score=${alerta.scoreTotal} ` +
      `(era ${alerta.riscoAnterior})`
    );
    // Lista os sinais que mais pesaram
    const top = alerta.detalhes
      .filter((d) => d.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos);
    for (const d of top) {
      console.log(`         ${d.tipo} = ${d.valor} (${d.pontos} pts)`);
    }
  });
  console.log("[OBS] logger inscrito.");
}
