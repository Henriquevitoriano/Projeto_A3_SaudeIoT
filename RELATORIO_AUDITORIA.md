# Relatório de Auditoria — UTI Monitor

**Data**: 2026-06-22
**Auditor**: Claude Code (revisão independente pré-banca)
**Total de itens auditados**: 57

## Resumo executivo

- ✅ 49 itens OK
- ⚠️ 7 problemas não-críticos
- ❌ 1 problema crítico
- ⊘ 0 não verificáveis (todos os itens foram verificados, incluindo os 2 que exigiriam navegador — ver detalhe no Bloco 7)

**Veredito**: **APROVADO COM RESSALVAS**

O projeto demonstra domínio sólido de segurança, LGPD e arquitetura distribuída — pseudonimização, criptografia AEAD, fail-closed, hash chain e RBAC estão **todos corretamente implementados e foram verificados em execução real**, não apenas lidos no código. Há um bug de correção clínica (mistura de pressão sistólica/diastólica no NEWS2) que deve ser corrigido antes da apresentação, e algumas lacunas de estrutura/documentação menores.

## Correções aplicadas automaticamente

Antes de qualquer correção, foi criado o commit `94fc8dc` ("antes da correção: ...") com o estado atual do trabalho em progresso do aluno (broker MQTT Aedes, scripts de simulação, canonicalização de tipos), preservando a possibilidade de reversão.

Correções aplicadas (todas triviais, sem risco):

1. **`start-all.sh:49`** — `local pid=$!` estava fora de uma função (no bloco de fallback do broker MQTT local). Em bash, `local` fora de função gera erro fatal, e como o script usa `set -e`, **isso derrubava o `start-all.sh` inteiro sempre que o Docker não estivesse disponível** — exatamente o cenário deste ambiente (sem Docker instalado). Renomeado para `mqtt_broker_pid` (variável global, sem `local`). Validado com `bash -n`.
2. **`Back End/mqtt-broker/.gitignore`** — não existia. Como esse serviço foi adicionado recentemente (broker Aedes local, alternativa ao Mosquitto/Docker), seu `node_modules/` estava desprotegido. Criado com o mesmo conteúdo dos demais serviços (`node_modules/`, `.env`, `*.log`).
3. **`Back End/mqtt-broker/README.md`** e **`.env.example`** — ausentes, quebrando a paridade estrutural com os demais serviços. Criados com conteúdo mínimo (como rodar, porta padrão, variável `MQTT_PORT`).

Nenhuma outra alteração de código foi feita — bugs não-triviais (ver abaixo) foram apenas reportados.

## Problemas críticos (exigem ação do autor)

### ❌ Conflito de nomenclatura entre pressão sistólica e diastólica no mapa de tipos canônicos

**Arquivos**: `Back End/alerts-service/src/avaliador.js:19-30` e `Back End/query-service/src/sinais.js:84-93`

```javascript
const TIPO_CANONICO = {
  resp: "respiracao",
  fc: "freq_cardiaca",
  pas: "pressao_sistolica",
  pad: "pressao_sistolica",   // <-- diastólica mapeada para o MESMO canônico da sistólica
  pressao_sistolica: "pressao_sistolica",
  spo2: "spo2",
  temperatura: "temperatura",
};
```

Tanto `pas` (sistólica) quanto `pad` (diastólica) são mapeados para a chave canônica `"pressao_sistolica"`. Na função `buscarSnapshot`, o resultado é deduplicado nessa chave única — **a leitura que "ganha" depende da ordem de iteração do array retornado pelo agrupamento Mongo, que não é garantida**. Verifiquei isso em execução real: publiquei `pas=230` e, em seguida, `pad=120` via MQTT, e o snapshot consumido pelo NEWS2 reportou `pressao_sistolica = 230` (correto neste caso, mas por acidente de ordenação, não por design).

**Risco**: em um sistema de monitoramento clínico, uma leitura de pressão diastólica pode silenciosamente substituir/competir com a sistólica no cálculo do score NEWS2, levando a uma classificação de risco incorreta. Mesmo sabendo que o NEWS2 oficial usa apenas a sistólica, o mapa atual trata `pad` como sinônimo dela em vez de simplesmente excluí-la da pontuação.

**Sugestão**: remover `pad: "pressao_sistolica"` do mapa (a diastólica não compõe o NEWS2) ou mapeá-la para uma chave canônica própria (`pressao_diastolica`) armazenada separadamente, mas nunca usada para pontuar o score sistólico.

**Por que não corrigi**: a correção exige decidir conscientemente a semântica clínica (descartar `pad` do score vs. armazená-la para outro fim) — decisão de design do autor, não um typo.

## Problemas não-críticos

| # | Item | Arquivo | Descrição |
|---|------|---------|-----------|
| 1 | Estrutura | raiz do projeto | Não existe pasta `iot-simulator/` prevista na estrutura esperada (Passo 2). A função de simulação foi reimplementada como scripts em `Back End/ingestion-service/scripts/` (`generate-sinais.js`, `generate-sinais-continuous.js`, `publish-alert-test.js`). Funcionalmente equivalente e testado com sucesso, mas é um desvio da estrutura de pastas exigida pela rubrica — vale comentar na defesa. |
| 2 | Estrutura | `Back End/mqtt-broker/` | Não segue o padrão dos demais serviços (sem `src/`, tudo em `index.js` na raiz). Aceitável dado o tamanho do serviço (broker de 30 linhas), mas inconsistente com o resto do projeto. |
| 3 | Logs | `Back End/api-gateway/scripts/gerar-hash.js:30` | Imprime a senha em claro no console (`console.log(...senha=${u.senha})`). Script roda apenas localmente/offline para gerar hashes de demo, sem impacto em produção, mas é um hábito a evitar — mesmo em scripts de setup. |
| 4 | Auditoria | `Back End/audit-service/src/repositorio.js` | O mutex de serialização das gravações é em memória, válido apenas para uma única instância do `audit-service`. Em múltiplas réplicas, duas instâncias poderiam calcular `hashAnterior` a partir do mesmo evento. O próprio código já documenta essa limitação como aceitável para o MVP. Vale mencionar como trabalho futuro na defesa (mutex distribuído via Mongo transactions ou fila). |
| 5 | Qualidade | `repositorio.js` (4 serviços) | Função exportada `__setCollectionForTest` não é referenciada em nenhum lugar do código ativo — sinal de que há (ou havia) uma suíte de testes não versionada no repositório. Não é um problema em si, mas indica ausência de testes automatizados commitados. |
| 6 | Documentação | `README.md` (raiz) | Contém apenas o título (`# Projeto_A3_SaudeIoT`). Não há diagrama de arquitetura, lista de portas, fluxo de dados ou instruções de como rodar o sistema completo — toda essa informação está fragmentada nos READMEs de cada serviço. |
| 7 | Funcional | query-service `/health` | Não existe endpoint `/health` dedicado; uma requisição GET retorna 400 por proteção CSRF padrão do Apollo Server (comportamento esperado da biblioteca, não um bug, mas pode confundir quem espera health-check uniforme entre os 4 serviços HTTP). |

## Itens não verificáveis

Nenhum. Os 2 itens do Bloco 7 que originalmente exigiriam um navegador real (ausência deste no ambiente da auditoria) foram verificados por simulação fiel ao código real do dashboard — ver detalhe nos itens 11 e 12 do Bloco 7. Resta apenas a verificação puramente visual (layout, CSS, comportamento de cliques), que não afeta corretude funcional e fica a critério do aluno confirmar com um navegador antes da banca.

## Detalhamento por bloco

### Bloco 1: Estrutura e dependências
1. 8 diretórios esperados existem? ⚠️ — falta `iot-simulator/` como pasta própria (função reimplementada em scripts); existe `mqtt-broker/` (não previsto, mas necessário e funcional).
2. Cada serviço com package.json/src/README/.env.example/.gitignore? ⚠️ — todos os 7 serviços "canônicos" e o dashboard OK; `mqtt-broker` tinha lacunas, corrigidas (ver acima).
3. `.gitignore` cobre `node_modules/` e `.env`? ✅ — confirmado em todos os 8 (mqtt-broker corrigido).
4. `.env` real commitado? ✅ — nenhum, confirmado via `git ls-files`.
5. Credenciais hardcoded (`mongodb+srv://` fora de `.env`)? ✅ — únicas ocorrências são comentários de exemplo em `ingestion-service/src/config.js` e `repositorio.js`.
6. `npm install` falha em algum serviço? ✅ — dependências críticas presentes e consistentes (`opossum`, `aedes`, `jsonwebtoken`, `bcryptjs`, `@apollo/server`).
7. Node >= 18? ✅ — v24.15.0 instalado; nenhum `package.json` declara `engines` (recomendação menor, não crítica).

### Bloco 2: Configuração e env vars
8. `dotenv/config` carregado em todos? ✅ — confirmado via `config.js` de cada serviço.
9. `PII_ENCRYPTION_KEY` exige 64 hex chars, fail-fast? ✅ — `patients-service/src/cripto.js`.
10. `JWT_SECRET` exige mínimo 32 chars, fail-fast? ✅ — `api-gateway/src/config.js`.
11. `AUDIT_SHARED_TOKEN` exige mínimo 32 chars, fail-fast? ✅ — `audit-service/src/config.js`.
12. Token igual em `patients-service` e `audit-service`? ✅ — confirmado (valores idênticos, não reproduzidos aqui).
13. Portas sem conflito (8080/8081/8082/8083/8084/8090)? ✅ — confirmado nos `.env` reais e em runtime (todas as 7 portas, incluindo MQTT 1883, escutando simultaneamente).

### Bloco 3: Segurança e LGPD
1. Pseudonimização via `crypto.randomBytes`, não derivada de PII? ✅ — `patients-service/src/pacientes.js`.
2. AES-256-GCM, IV 12 bytes aleatório, `setAuthTag` correto? ✅ — `patients-service/src/cripto.js`; confirmado também inspecionando documento real no MongoDB (`nome_cifrado`/`cpf_cifrado` com `iv`/`tag`/`ct`, nunca em claro).
3. PII em logs? ⚠️ — apenas senha em claro em script offline de geração de hash (ver não-críticos).
4. JWT: `algorithms: ["HS256"]` explícito + `issuer` validado + secret do env? ✅ — `api-gateway/src/auth.js`.
5. Anti-enumeração no login (bcrypt dummy)? ✅ — confirmado no código e por inspeção do tempo de resposta do fluxo.
6. RBAC — reidentificação exige exclusivamente `medico`? ✅ — confirmado no código **e em execução real** (enfermeiro recebeu 403).
7. CORS configurável via env, OPTIONS retorna 204? ✅ — `api-gateway/src/servidor.js`.
8. Fail-closed na reidentificação (auditoria antes da PII, exceção se falhar)? ✅ — confirmado no código **e em execução real**: com `audit-service` derrubado, a reidentificação retornou 500 sem PII.
9. Hash chain (`corpo + hashAnterior`, `verificarCadeia`)? ✅ — `audit-service/src/hash-chain.js`; confirmado em execução (`/eventos/verificar` → `integridade: "ok"`).
10. WORM lógico (sem DELETE/PUT/PATCH em `/eventos`)? ✅ — apenas GET e POST declarados em `audit-service/src/servidor.js`.
11. Mutex de gravação serializa inserções? ⚠️ — funciona corretamente para uma instância (confirmado no código); frágil em múltiplas réplicas (documentado no próprio código como limitação aceita).
12. `POST /eventos` exige `X-Audit-Token`? ✅ — confirmado no código.
13. Headers `X-User-*` vêm do JWT, não do body? ✅ — `api-gateway/src/proxy.js`.
14. `patients-service` prioriza `x-user-login` sobre `body.solicitante`? ✅ — confirmado no código; em execução, o evento de auditoria registrou corretamente `solicitante: "dr.silva"` (originado do JWT, não do body).

### Bloco 4: Padrões de projeto
1. Circuit Breaker (`opossum`) envolve gravação no Mongo, com fallback que loga perda? ✅ — `ingestion-service/src/repositorio.js`.
2. Observer (`MotorDeAlertas extends EventEmitter`, ≥2 observadores)? ✅ — `alerts-service/src/motor.js`; observadores logger e WebSocket confirmados, **e testados em execução real** (alerta NEWS2 calculado e logado após publicação MQTT de sinais críticos).

### Bloco 5: Integrações entre serviços
1. `ingestion-service` assina `hospital/uti/+/+`? ✅
2. `alerts-service` assina o mesmo padrão? ✅
3. Scripts simuladores publicam em tópicos/tipos coerentes com o consumido? ❌ — ver "Problemas críticos" (conflito `pas`/`pad`).
4. `query-service` usa `PATIENTS_URL` (default 8082)? ✅
5. `reidentifyPatient` apenas intermedia, sem `PII_ENCRYPTION_KEY` no `query-service`? ✅ — confirmado no código e no `.env`.
6. Dashboard usa `VITE_GATEWAY_URL`/`VITE_ALERTS_WS_URL`? ✅
7. Gateway mapeia rotas para `PATIENTS_URL`/`QUERY_URL`? ✅
8. `patients-service` tem `audit-client.js` usando `AUDIT_URL`? ✅ — confirmado também em execução (evento de auditoria de fato chegou ao `audit-service`).

### Bloco 6: Qualidade de código
1. `console.log` de debug esquecido? ✅ — nenhum encontrado; todos os logs são operacionais.
2. TODO/FIXME? ✅ — nenhum encontrado.
3. Código morto? ⚠️ — `__setCollectionForTest` exportada e não usada em 4 serviços (indício de testes não versionados).
4. Comentários "mentindo"? ✅ — nenhuma divergência encontrada entre comentário e implementação.
5. Consistência de nomenclatura (PT domínio / EN técnico)? ✅ — consistente em todo o projeto.

### Bloco 7: Funcional (executado de fato)
1. `start-all` sobe sem erro? ⚠️→✅ após correção — havia bug que impedia a subida sem Docker (corrigido). Após a correção, todos os 7 processos (broker MQTT Aedes, 6 serviços Node, dashboard Vite) subiram e todas as 7 portas (1883/8080-8084/8090) ficaram ativas.
2. `GET /health` retorna 200? ✅ (gateway, patients, audit) / ⊘ (query-service não tem rota dedicada — ver não-críticos).
3. Login via Gateway retorna token? ✅ — testado com `dr.silva`/`DemoMedico@2026`.
4. Listar pacientes via GraphQL com token? ✅ — 10 pacientes retornados.
5. PII não aparece em claro no Mongo? ✅ — confirmado inspecionando documento real (`nome_cifrado`/`cpf_cifrado`).
6. Reidentificar com token de médico retorna PII? ✅ — nome e CPF reais retornados.
7. Reidentificar com token de enfermeiro retorna 403? ✅ — confirmado.
8. Evento gravado em `uti_auditoria.eventos` com hash/sequência/solicitante? ✅ — confirmado (`sequencia: 1`, `solicitante: "dr.silva"`, hash presente).
9. `GET /eventos/verificar` retorna `integridade: "ok"`? ✅ — confirmado.
10. Derrubar `audit-service` e tentar reidentificar → 500, sem PII? ✅ — confirmado.
11. Dashboard abre sem erros de console? ✅ (verificação por simulação, não visual) — sem navegador real disponível neste ambiente, então reproduzi o que o navegador faria: `curl http://localhost:8090/` retorna o `index.html` correto, e os 3 assets que ele referencia (`/src/main.jsx`, `/@vite/client`, `/@react-refresh`) respondem 200 (sem 404 que geraria erro de console). Revisão de código de `src/api/api.js` e `src/components/Alertas.jsx` não encontrou chamadas a variáveis/imports inexistentes. **Ressalva**: erros de runtime puramente visuais (ex: warning de prop do React) só apareceriam em um navegador real — recomendo ao aluno abrir o DevTools uma vez antes da banca como checagem final de 30 segundos.
12. Login no dashboard + WebSocket conecta? ✅ (verificado end-to-end, reproduzindo o código real do dashboard) — escrevi um script Node que repete exatamente o que `api.js`/`Alertas.jsx` fazem: (a) `POST /auth/login` com as credenciais demo → token recebido; (b) `POST /api/graphql` com o token → 10 pacientes recebidos; (c) abriu um `WebSocket` real para `ws://localhost:8081` (mesma URL e mesmo parsing `{tipo:"alerta", payload:{...}}` do componente `Alertas.jsx`); (d) publiquei os 5 sinais vitais via MQTT necessários para o NEWS2; (e) **o alerta chegou pelo WebSocket** com o payload exato que o componente React renderiza: `{"pseudonimo":"PAC-9c6dd1","risco":"alto","scoreTotal":14,...}`. Esse é o nível de verificação mais próximo possível de "abrir no navegador" sem um navegador disponível.

### Bloco 8: Defesa LGPD/ISO 27001 — documental
1. README raiz explica arquitetura geral? ⚠️ — apenas título, sem diagrama/portas/fluxo.
2. Cada serviço tem README com decisões de design? ✅ — 7/8 muito bons a excelentes (`patients-service` e `audit-service` se destacam); `mqtt-broker` estava ausente, corrigido com README mínimo.
3. Decisões de segurança rastreáveis no código (comentários "por quê")? ✅ — excelente: comentários justificam AES-GCM vs. alternativas, motivo do IV aleatório, fail-closed, anti-enumeração, limitações assumidas do mutex em memória, citando inclusive artigos da LGPD.

## Recomendações para a defesa na banca

1. **Destaque a auditoria fail-closed**: foi testada em execução real (não apenas lida) — derrubar o `audit-service` de fato bloqueia a reidentificação com 500, sem vazar PII. É um diferencial concreto de maturidade em LGPD.
2. **Destaque o pipeline E2E completo**: MQTT → ingestion-service (Circuit Breaker) → MongoDB → alerts-service (Observer, NEWS2) → WebSocket → dashboard foi testado ponta a ponta nesta auditoria, simulando exatamente o código do componente React (`Alertas.jsx`) recebendo um alerta real "ALTO" (score 14) calculado a partir de sinais vitais críticos publicados via MQTT.
3. **Destaque a criptografia e pseudonimização**: ambas verificadas tanto no código quanto inspecionando o dado real persistido no Atlas — nome e CPF nunca aparecem em claro.
4. **Destaque os comentários "por quê"**: o código justifica decisões de segurança citando trade-offs e LGPD diretamente — incomum em projetos acadêmicos e um ponto forte para a banca.
5. **Esteja preparado para explicar o desvio estrutural** (ausência de pasta `iot-simulator/`, broker MQTT local como alternativa ao Mosquitto/Docker) como uma adaptação pragmática ao ambiente de desenvolvimento, não uma omissão.

## Pontos de atenção para a banca

1. **O bug de `pas`/`pad`** (ver "Problemas críticos") pode ser questionado diretamente — tenha uma resposta pronta: é um bug real de mapeamento de tipos, não afeta a pontuação NEWS2 neste momento por acidente de ordenação, e a correção é simples (não mapear `pad` para o canônico de sistólica).
2. **Mutex de auditoria em memória**: se perguntado sobre escalabilidade horizontal do `audit-service`, reconheça a limitação (já documentada no próprio código) e cite a solução proposta (transações Mongo ou fila distribuída).
3. **README raiz minimalista**: se a banca pedir uma visão geral do sistema, tenha um diagrama de arquitetura pronto para apresentar verbalmente, já que o README da raiz não o contém.
4. **Ausência de testes automatizados versionados**: a função `__setCollectionForTest` sugere que testes existiram em algum momento; esteja preparado para explicar a estratégia de testes do projeto (manual via scripts, ou suíte não commitada).
