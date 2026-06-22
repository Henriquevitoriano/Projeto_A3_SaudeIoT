# Serviço de Ingestão — UTI

Consome sinais vitais do broker MQTT, valida cada mensagem e persiste em uma
coleção time-series do MongoDB Atlas. Protegido por **Circuit Breaker** (opossum).

## Arquitetura interna

```
Broker MQTT → Assinante → Validador → Repositório → MongoDB Atlas
                                          ↑
                                  (Circuit Breaker)
```

Cada módulo tem responsabilidade única (princípio SRP).

## Decisões de design

- **Time-series collection**: coleção MongoDB otimizada para dados temporais
  ordenados. Performance muito superior a uma coleção comum para nosso padrão.
- **Validação na entrada**: cada mensagem é checada contra o contrato de dados.
  Inclui *barreira anti-PII* (LGPD) que rejeita payloads com `nome`, `cpf`, etc.
- **Circuit Breaker**: protege a gravação no Mongo. Se o banco ficar lento ou
  cair, o circuito abre e o fallback loga a perda em vez de travar o serviço.
- **Credenciais via env**: a connection string do Atlas NUNCA fica no código.

## Como rodar

```bash
# 1. Instalar dependências
npm install

# 2. Configurar credenciais
cp .env.example .env
# edite .env e cole sua MONGO_URL do Atlas (com a senha real)

# 3. Garantir que existe um broker MQTT no ar
docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto

# 4. Rodar o serviço
npm start

# 5. Publicar mensagens MQTT de teste em hospital/uti/{pseudonimo}/{tipo}
# (não há, neste repositório, um serviço simulador de sensores dedicado —
# use um cliente MQTT qualquer, ex.: mosquitto_pub, para gerar dados de teste)
```

## Verificar os dados gravados

No painel do Atlas: `Database → Browse Collections → uti_monitor → sinais_vitais`.
Ou via extensão MongoDB no VS Code.

## Estrutura

```
src/
  config.js        # configs centralizadas (broker, mongo, breaker)
  validador.js     # valida contrato + barreira anti-PII (LGPD)
  repositorio.js   # MongoDB + Circuit Breaker (opossum)
  assinante.js     # cliente MQTT, orquestra validação→gravação
  index.js         # ponto de entrada
```
