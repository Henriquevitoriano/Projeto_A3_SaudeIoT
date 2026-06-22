/**
 * motor.js
 * -----------------------------------------------------------------------------
 * MotorDeAlertas — implementação do padrão OBSERVER sobre EventEmitter.
 *
 * O EventEmitter nativo do Node.js JÁ É uma implementação canônica do
 * padrão Observer (pub-sub em memória, com vários "subscribers" reagindo a um
 * "publisher" sem acoplamento direto). Em vez de reinventar a roda, herdamos
 * dele e EXPOMOS UMA API COM OS NOMES DO NOSSO DOMÍNIO:
 *
 *   motor.onAlerta(handler)            -> registra um observador
 *   motor.emitirAlerta(payload)        -> publica um evento de alerta
 *
 * Isso é deliberado: na leitura do código fica claro que o padrão Observer
 * está aplicado conscientemente — não é "evento solto" pelo código.
 *
 * Em produção, este motor poderia ser substituído por uma fila externa
 * (Kafka, RabbitMQ) sem mudar a API. Eis a força do padrão.
 */

import { EventEmitter } from "node:events";

const EVENTO_ALERTA = "alertaClinico";

export class MotorDeAlertas extends EventEmitter {
  constructor() {
    super();
    // Como não temos certeza de quantos observadores teremos, removemos o
    // limite padrão de 10 listeners (que é um aviso conservador do Node).
    this.setMaxListeners(0);
  }

  /**
   * Registra um observador (subscriber) para alertas clínicos.
   * @param {(alerta: object) => void} handler
   * @returns uma função para descadastrar (`unsubscribe`)
   */
  onAlerta(handler) {
    this.on(EVENTO_ALERTA, handler);
    return () => this.off(EVENTO_ALERTA, handler);
  }

  /**
   * Emite um alerta clínico. Todos os observadores cadastrados serão chamados
   * de forma síncrona (mas podem fazer trabalho assíncrono dentro deles).
   * @param {object} alerta - { pseudonimo, risco, scoreTotal, detalhes, ... }
   */
  emitirAlerta(alerta) {
    this.emit(EVENTO_ALERTA, alerta);
  }
}
