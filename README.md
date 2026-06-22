# UTI Monitor — Projeto A3 (Sistemas Distribuídos)

Monitor de pacientes de UTI baseado em IoT, com 7 microsserviços Node.js +
dashboard React, requisitos de LGPD (pseudonimização, criptografia, auditoria
imutável) e padrões de projeto Circuit Breaker e Observer.

## Arquitetura

```
[Dashboard React] :8090
  │ (HTTP/GraphQL, WebSocket)
  ▼
[API Gateway] :8080  ───►  [Patients Service] :8082 ──► [Audit Service] :8084
  │                              │                            │
  └──►  [Query Service] :8083    │                            ▼
              │                  ▼                       MongoDB
              ▼              MongoDB                   (uti_auditoria)
          MongoDB          (uti_pacientes,
        (uti_monitor)      PII cifrada AES-256-GCM)

[Scripts de simulação] ──MQTT──► [Broker MQTT] :1883 ──► [Ingestion Service] ──► MongoDB
(ingestion-service/scripts/)                          └► [Alerts Service] :8081 ──WS──► Dashboard
```

## Serviços

| Serviço | Pasta | Porta | Responsabilidade |
|---|---|---|---|
| mqtt-broker | `Back End/mqtt-broker` | 1883 | Broker Aedes local (alternativa ao Mosquitto/Docker) |
| ingestion-service | `Back End/ingestion-service` | — | Assina MQTT, valida e grava sinais vitais no MongoDB (Circuit Breaker com `opossum`) |
| alerts-service | `Back End/alerts-service` | 8081 (WS) | Calcula NEWS2 e emite alertas clínicos (Observer: logger + WebSocket) |
| patients-service | `Back End/patients-service` | 8082 | Cadastro/pseudonimização/criptografia de pacientes (AES-256-GCM) e reidentificação fail-closed |
| query-service | `Back End/query-service` | 8083 | API GraphQL de leitura (Apollo Server), intermediário sem acesso a PII |
| audit-service | `Back End/audit-service` | 8084 | Log de auditoria imutável (hash chain, WORM lógico) |
| api-gateway | `Back End/api-gateway` | 8080 | Autenticação JWT, RBAC, rate limit, proxy reverso |
| dashboard | `Front End/dashboard` | 8090 | Interface React (Vite) |

Cada serviço tem seu próprio `README.md` com as decisões de design detalhadas.

## Como rodar

1. Configure o `.env` de cada serviço a partir do respectivo `.env.example`.
2. Rode `npm install` em cada pasta de serviço (incluindo `Front End/dashboard`).
3. Suba tudo:
   - Linux/Mac/Git Bash: `./start-all.sh`
   - Windows (PowerShell): `./start-all.ps1`

Logs de cada serviço ficam em `.logs/`.

## Fluxo de dados (resumo)

1. Sinais vitais são publicados via MQTT em `hospital/uti/{pseudonimo}/{tipo}`.
2. `ingestion-service` valida e grava no MongoDB (coleção time-series).
3. `alerts-service` consome o mesmo tópico, monta um snapshot dos últimos 60s
   por paciente e calcula o NEWS2; alertas são emitidos via Observer
   (logger + WebSocket) quando o risco muda.
4. `dashboard` consome o `api-gateway` (REST/GraphQL) e o WebSocket do
   `alerts-service` diretamente.
5. Reidentificação de pacientes (`patients-service`) exige token JWT de
   `medico` (RBAC no `api-gateway`) e é fail-closed: se o `audit-service`
   estiver indisponível, a operação falha e a PII não é liberada.
