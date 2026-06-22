# Serviço de Alertas — UTI (NEWS2 + Observer)

Detecta deterioração clínica de pacientes da UTI aplicando o protocolo
**NEWS2** (National Early Warning Score 2 — Royal College of Physicians, 2017)
e distribui alertas via padrão **Observer** para múltiplos canais.

## Arquitetura interna

```
Broker MQTT → Assinante → Avaliador NEWS2 → MotorDeAlertas (Observer)
                              ↑                       ↓
                       busca histórico         ┌──────┴──────┐
                       no MongoDB         Logger        WebSocket
                                          (obs 1)        (obs 2)
```

- **Avaliador NEWS2**: função pura que pontua cada sinal (0–3) e classifica
  o paciente em risco baixo, médio ou alto. Inclui a regra especial do NEWS2:
  se *qualquer* sinal isolado pontua 3, o risco mínimo é médio.
- **MotorDeAlertas**: extends `EventEmitter`. Expõe `onAlerta()` e
  `emitirAlerta()` — API com nomes de domínio que tornam o padrão explícito.
- **Anti-spam**: alertas só são emitidos quando o risco do paciente **piora**
  em relação ao último estado — evita *alert fatigue* na equipe clínica.

## Padrões de projeto aplicados

- **Observer** (este serviço) — desacopla a detecção do alerta dos canais
  de notificação. Para adicionar email/SMS/push, basta criar mais um
  arquivo `observador-X.js` e registrar — zero mudança no código existente.

## Como rodar

```bash
# 1. Instalar dependências
npm install

# 2. Configurar credenciais
cp .env.example .env
# edite .env e cole sua MONGO_URL do Atlas

# 3. Garantir que existe um broker MQTT no ar
docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto

# 4. Rodar o serviço
npm start
```

Em paralelo: rodar o **ingestion-service**, que assina o mesmo broker MQTT e
grava os sinais no MongoDB. Os dois conversam via MQTT/MongoDB sem precisar
se conhecer (não há, neste repositório, um simulador de sensores dedicado —
publique mensagens de teste manualmente, ex.: via `mosquitto_pub`).

## Conectar um cliente WebSocket (futuro Dashboard)

```js
const ws = new WebSocket("ws://localhost:8081");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

## Estrutura

```
src/
  config.js                  # MQTT, Mongo, porta WS
  news2.js                   # algoritmo NEWS2 (função pura)
  avaliador.js               # busca histórico + aplica NEWS2 + decide emitir
  motor.js                   # MotorDeAlertas extends EventEmitter (Observer)
  observador-logger.js       # observador 1: log no console
  observador-websocket.js    # observador 2: broadcast WebSocket
  assinante.js               # cliente MQTT que dispara avaliações
  index.js                   # ponto de entrada (wiring)
```
