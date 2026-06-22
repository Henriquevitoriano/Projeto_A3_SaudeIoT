# Guia de Apresentação — UTI Monitor

Este documento explica o projeto para quem **não participou do desenvolvimento**,
de um jeito que sirva de roteiro para apresentar na banca. Não é documentação
técnica de referência (isso já existe nos READMEs de cada serviço) — é a
"história" do sistema, contada em ordem.

---

## 1. A premissa: qual problema o projeto resolve?

Um hospital tem pacientes internados na UTI, cada um ligado a sensores que
medem sinais vitais (frequência cardíaca, oxigenação no sangue, pressão,
respiração, temperatura). O projeto simula um **sistema de monitoramento
contínuo** desses sinais, que:

1. **Recebe** os sinais vitais em tempo real (de sensores reais ou simulados).
2. **Calcula automaticamente o risco clínico** de cada paciente (protocolo
   médico NEWS2 — usado de verdade em hospitais) e **dispara um alerta**
   quando o risco sobe.
3. **Protege a identidade dos pacientes**: o sistema todo trabalha com um
   "pseudônimo" (ex: `PAC-7f3a9b`) em vez do nome real. Só uma pessoa com
   permissão de médico, e com motivo registrado, consegue ver o nome e CPF
   reais — e essa consulta fica **gravada permanentemente** em um log de
   auditoria que não pode ser editado nem apagado.
4. Tudo isso seguindo **LGPD** (lei de proteção de dados) e os princípios de
   segurança da **ISO/IEC 27001** — não são só "boas práticas genéricas", são
   requisitos da disciplina que o projeto atende com mecanismos concretos
   (ver seção 6).

A ideia central para a banca: **não é só um CRUD de pacientes** — é um sistema
**distribuído**, onde cada responsabilidade (receber dados, calcular risco,
guardar identidade, consultar, auditar, autenticar) é um **serviço separado**,
porque é assim que sistemas hospitalares reais são construídos: nenhum único
ponto de falha deve conseguir, sozinho, expor dados sensíveis de pacientes.

---

## 2. Visão geral da arquitetura

```
[Simulador de sinais] ──MQTT──► [Broker MQTT] ──► [Ingestion Service] ──► MongoDB
                                      │                                  (sinais_vitais)
                                      └────────────► [Alerts Service] ──WS──► [Dashboard]
                                                       (calcula NEWS2)

[Dashboard React] ──HTTP/GraphQL──► [API Gateway] ──┬──► [Patients Service] ──► [Audit Service]
        ▲                                            │     (identidade,              │
        └───────────────WebSocket direto─────────────┤      criptografia)            ▼
                  (alertas em tempo real)             └──► [Query Service]       MongoDB
                                                             (GraphQL,            (auditoria)
                                                              leitura)
```

8 peças, cada uma com uma responsabilidade única:

| Peça | Pasta | Porta | Em uma frase |
|---|---|---|---|
| Broker MQTT | `Back End/mqtt-broker` | 1883 | O "correio" que entrega sinais vitais de quem publica para quem assina |
| Ingestion Service | `Back End/ingestion-service` | — | Recebe sinais vitais via MQTT e grava no banco |
| Alerts Service | `Back End/alerts-service` | 8081 (WS) | Calcula o risco clínico (NEWS2) e dispara alertas |
| Patients Service | `Back End/patients-service` | 8082 | Único serviço que conhece a identidade real do paciente |
| Query Service | `Back End/query-service` | 8083 | API de consulta (GraphQL) para o dashboard |
| Audit Service | `Back End/audit-service` | 8084 | Log de auditoria à prova de adulteração |
| API Gateway | `Back End/api-gateway` | 8080 | Porta de entrada única: login, permissões, repasse |
| Dashboard | `Front End/dashboard` | 8090 | Interface visual (React) |

---

## 3. O que é o "broker MQTT" e por que ele existe

**MQTT** é um protocolo de mensagens leve, feito para IoT (sensores, dispositivos
com pouca capacidade de processamento e rede instável). Funciona no modelo
**publish/subscribe**: quem produz dados *publica* uma mensagem em um "tópico"
(uma espécie de endereço/categoria, ex: `hospital/uti/PAC-7f3a9b/spo2`), e quem
quer aqueles dados *assina* aquele tópico (ou um padrão de tópicos). Quem
publica não precisa saber quem está assinando, e vice-versa — é um
desacoplamento total entre produtor e consumidor.

O **broker** é o servidor central que recebe as publicações e as redistribui
para todos os assinantes daquele tópico. Sem o broker, cada sensor precisaria
saber o endereço de cada serviço interessado nos dados dele — o que não
escala e não é como sistemas IoT reais funcionam.

Neste projeto, o broker está em `Back End/mqtt-broker/index.js` e usa a
biblioteca **Aedes** (um broker MQTT implementado em Node.js puro). Ele existe
como **alternativa ao Mosquitto** (o broker MQTT "padrão de mercado", que
normalmente rodaria em um container Docker): como a máquina de desenvolvimento
não tinha Docker disponível, em vez de travar o projeto, foi implementado um
broker equivalente em ~30 linhas de JavaScript. Funcionalmente, é a mesma
peça da arquitetura — só a forma de rodá-lo localmente que mudou. O
`start-all.sh`/`start-all.ps1` tenta Mosquitto via Docker primeiro e só usa o
Aedes como *fallback* se o Docker não estiver disponível.

**Quem publica nos tópicos**: os scripts em `Back End/ingestion-service/scripts/`
(simuladores — fazem o papel dos sensores reais, que neste MVP não existem
fisicamente).

**Quem assina os tópicos**: `ingestion-service` e `alerts-service`, ambos
assinando o mesmo padrão `hospital/uti/+/+` (o `+` é um "qualquer coisa" do
MQTT — captura qualquer pseudônimo e qualquer tipo de sinal). Os dois recebem
**a mesma mensagem, de forma independente** — é assim que pub/sub permite que
múltiplos serviços reajam ao mesmo evento sem se conhecerem.

---

## 4. A divisão de microsserviços — o porquê de cada um

A pergunta que a banca pode fazer: "por que não é tudo um serviço só?". A
resposta, peça por peça:

### `ingestion-service` — só recebe e grava
**Pasta-chave:** `src/assinante.js` (assina MQTT), `src/validador.js` (valida
cada mensagem — rejeita payload incompleto, tipo de sinal desconhecido, e
**qualquer campo de PII que apareça por engano**, como uma barreira extra),
`src/repositorio.js` (grava no MongoDB, protegido por **Circuit Breaker**).

Por que separado: é o único ponto de entrada de dados não-confiáveis (vêm de
"sensores", que podem enviar lixo). Isolar essa responsabilidade significa que
um sensor com firmware bugado não consegue corromper o banco nem afetar os
outros serviços — o validador descarta a mensagem e segue.

### `alerts-service` — só calcula risco e avisa
**Pasta-chave:** `src/news2.js` (a fórmula do protocolo clínico NEWS2, função
pura — não toca rede nem banco, só calcula), `src/avaliador.js` (busca os
sinais recentes de um paciente e chama o cálculo), `src/motor.js`
(`MotorDeAlertas`, o padrão **Observer** — ver seção 5), `src/observador-logger.js`
e `src/observador-websocket.js` (os dois "observadores" que reagem a um alerta).

Por que separado: o cálculo de risco é um *use case* totalmente diferente de
"gravar dado" — tem sua própria lógica de negócio (a tabela de pontuação
NEWS2) e seu próprio canal de saída (WebSocket em tempo real para o
dashboard, não REST).

### `patients-service` — o único que conhece a identidade real
**Pasta-chave:** `src/cripto.js` (criptografia AES-256-GCM do nome/CPF),
`src/pacientes.js` (gera o pseudônimo aleatório, cadastra, e a função
`reidentificar` — a operação mais sensível do sistema), `src/audit-client.js`
(avisa o `audit-service` sempre que alguém vê a identidade real).

Por que separado: é a fronteira de **minimização de dados** da LGPD. Nenhum
outro serviço do sistema tem acesso à chave de criptografia nem ao nome/CPF —
nem o `query-service`, nem o `alerts-service`. Se qualquer um desses outros
serviços for comprometido, o atacante não chega à PII.

### `audit-service` — a "caixa-preta" que ninguém pode editar
**Pasta-chave:** `src/hash-chain.js` (cada evento de auditoria carrega o hash
do evento anterior — se alguém adulterar um registro depois de gravado, a
cadeia "quebra" e isso é detectável), `src/servidor.js` (só tem rotas de
criar e ler — propositalmente **não existe rota de editar ou apagar**).

Por que separado: um log de auditoria que pudesse ser editado pelo mesmo
serviço que ele audita não serviria para nada. Separar garante que, mesmo que
o `patients-service` seja comprometido, o histórico de quem acessou o quê
continua intacto em outro processo, outro banco lógico.

### `query-service` — só lê, nunca decide nada sensível
**Pasta-chave:** `src/schema.js` + `src/resolvers.js` (API GraphQL — o
dashboard pede exatamente os campos que precisa, numa única requisição),
`src/sinais.js` (recalcula o NEWS2 a partir do snapshot de sinais, de forma
independente do `alerts-service`), `src/pacientes-client.js` (chama o
`patients-service` via HTTP quando alguém pede para reidentificar — só repassa
a chamada, nunca decifra nada aqui).

Por que separado: é a camada de leitura otimizada para o dashboard, sem
nenhum acesso a segredo (nem chave de criptografia, nem token de auditoria).

### `api-gateway` — a única porta de entrada
**Pasta-chave:** `src/auth.js` (login, gera token JWT), `src/config.js`
(tabela de rotas e **quem pode chamar cada uma** — RBAC), `src/proxy.js`
(repassa a chamada para o serviço certo, **injetando quem é o usuário a
partir do token validado**, nunca confiando no que o cliente mandou no corpo
da requisição).

Por que separado: nenhum dos outros serviços fica exposto diretamente à
internet/rede do cliente — só o Gateway. Login, limite de tentativas
(`rate-limit.js`), CORS e a decisão de "quem pode fazer o quê" ficam
concentrados em um único lugar, em vez de replicados (e possivelmente
esquecidos) em cada serviço.

**Tabela de permissões (RBAC) configurada no Gateway:**

| Quem pode | Reidentificar paciente | Cadastrar paciente | Ver lista/dados públicos | Consultar GraphQL |
|---|---|---|---|---|
| `medico` | ✅ | ✅ | ✅ | ✅ |
| `enfermeiro` | ❌ | ✅ | ✅ | ✅ |
| `dpo` (encarregado de dados) | ❌ | ❌ | ✅ | ✅ |

### `dashboard` — a única coisa que o usuário final vê
**Pasta-chave:** `src/components/Pacientes.jsx` (lista os pacientes e o score
NEWS2, atualizando a cada 5s), `src/components/Alertas.jsx` (painel de
alertas em tempo real, conectado direto no WebSocket do `alerts-service`),
`src/api/api.js` (única peça do front-end que conhece os endereços dos
serviços).

Por que separado: é "só" a camada de apresentação — não tem lógica de
negócio, não decide nada, só mostra o que os serviços de backend já
calcularam e protegeram.

---

## 5. Padrões de projeto aplicados (peça obrigatória da rubrica)

### Circuit Breaker — `ingestion-service/src/repositorio.js`
Protege a gravação no MongoDB usando a biblioteca `opossum`. Se o banco
começar a falhar repetidamente, o circuito "abre" e o serviço **para de
tentar gravar por um tempo** (em vez de empilhar tentativas e piorar a
situação), registrando no log que dados estão sendo perdidos. Depois de um
tempo, testa uma chamada de recuperação — se der certo, volta ao normal.

### Observer — `alerts-service/src/motor.js`
A classe `MotorDeAlertas` herda de `EventEmitter` e expõe dois métodos com
nome de domínio: `onAlerta()` (inscrever um observador) e `emitirAlerta()`
(publicar um alerta). Dois observadores reais estão inscritos:
1. **Logger** (`observador-logger.js`) — imprime o alerta no console.
2. **WebSocket** (`observador-websocket.js`) — transmite o alerta para todos
   os clientes do dashboard conectados.

Quando um alerta é emitido, **os dois reagem automaticamente**, sem que o
código que calculou o NEWS2 saiba que eles existem — esse é o ponto do
padrão: desacoplar "o que aconteceu" de "o que fazer quando acontece".

---

## 6. Onde a LGPD/ISO 27001 aparece de verdade no código (não só na teoria)

| Princípio | Onde está implementado |
|---|---|
| **Pseudonimização real** (não reversível por dedução) | `patients-service/src/pacientes.js` — pseudônimo gerado com `crypto.randomBytes`, nunca derivado do nome/CPF |
| **Criptografia de dados pessoais** | `patients-service/src/cripto.js` — AES-256-GCM, com IV aleatório a cada gravação |
| **Minimização de dados** | Só o `patients-service` tem a chave de criptografia; todos os outros serviços só veem o pseudônimo |
| **Auditoria de acesso a dados sensíveis** (Art. 37 LGPD) | `audit-service` — toda reidentificação é registrada com hash chain (à prova de adulteração) |
| **Fail-closed** | `patients-service/src/pacientes.js` (`reidentificar`) — se o `audit-service` estiver fora do ar, a operação de reidentificação **falha** em vez de liberar o dado sem registro |
| **Controle de acesso (RBAC)** | `api-gateway/src/config.js` — só `medico` reidentifica |
| **Gestão de credenciais** (ISO 27001) | Nenhuma senha/chave hardcoded; tudo em `.env` (fora do controle de versão), com validação que recusa rodar se a chave for fraca/ausente |

---

## 7. Roteiro sugerido para a apresentação

1. **Abra com o problema**: "imagine uma UTI onde cada sensor manda dados o
   tempo todo — como organizar isso sem expor a identidade dos pacientes?"
2. **Mostre o diagrama da seção 2** e nomeie os 7 microsserviços + dashboard.
3. **Explique o MQTT/broker em 30 segundos** (seção 3) — é a pergunta mais
   comum que a banca faz quando vê "broker" na arquitetura.
4. **Escolha 2-3 serviços para aprofundar** (sugestão: `patients-service` por
   ser o coração da LGPD, e `alerts-service` por ter o padrão Observer e o
   protocolo clínico real).
5. **Faça uma demo ao vivo**: suba o sistema (`start-all.ps1`), mostre o
   dashboard recebendo alertas em tempo real, e finalize reidentificando um
   paciente como médico — depois mostre o evento gravado no `audit-service`
   com o hash chain íntegro (`GET /eventos/verificar`).
6. **Encerre com os 2 padrões de projeto** (seção 5) e a tabela da seção 6
   como prova de que LGPD/ISO 27001 não foram só citados, foram implementados.
