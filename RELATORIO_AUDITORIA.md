# Relatório de Auditoria — UTI Monitor

**Data**: 2026-06-22
**Auditor**: Claude Code (revisão independente pré-banca)
**Total de itens auditados**: 57

## Resumo executivo

- ✅ 49 itens OK
- ⚠️ 5 observações não-críticas mantidas como decisão consciente (sem ação necessária — justificativa abaixo)
- ❌ 0 problemas críticos pendentes (corrigido — ver abaixo)
- ⊘ 0 não verificáveis

**Veredito**: **APROVADO**

Atualização pós-correção: a pedido do autor, revisei todos os 8 achados do relatório original (1 crítico + 7 não-críticos). **3 foram corrigidos** (o bug crítico de pas/pad, a senha em claro no script de hash, e o README raiz) **e revalidados em execução real**. **5 foram deliberadamente mantidos sem alteração de código**, porque corrigi-los exigiria mudanças de arquitetura/comportamento (mutex distribuído, troca do servidor HTTP do Apollo) ou porque não são de fato bugs (hook de teste intencional, organização de pastas que já foi parcialmente regularizada no lote 1) — cada um está marcado e justificado na tabela abaixo. O estado original de cada achado, com evidência completa, permanece documentado para fins de defesa/rastreabilidade.

## Correções aplicadas

Antes de qualquer correção, foram criados dois commits de segurança: `94fc8dc` ("antes da correção: ...", estado do WIP do aluno antes do primeiro lote de fixes triviais) e um commit equivalente antes deste segundo lote (bug crítico + itens não-críticos), preservando a possibilidade de reversão em qualquer ponto.

**Lote 1 (triviais, estrutura):**

1. **`start-all.sh:49`** — `local pid=$!` estava fora de uma função (bloco de fallback do broker MQTT local). Em bash, isso gera erro fatal e, com `set -e`, **derrubava o `start-all.sh` inteiro sempre que o Docker não estivesse disponível** — exatamente o cenário deste ambiente. Renomeado para `mqtt_broker_pid` (variável global, sem `local`). Validado com `bash -n` e reexecutado com sucesso.
2. **`Back End/mqtt-broker/.gitignore`** — não existia; `node_modules/` estava desprotegido. Criado com o mesmo conteúdo dos demais serviços.
3. **`Back End/mqtt-broker/README.md`** e **`.env.example`** — ausentes. Criados com conteúdo mínimo.

**Lote 2 (a pedido explícito do autor, após revisão do relatório):**

4. **Bug crítico pas/pad** (`Back End/alerts-service/src/avaliador.js:24-29`) — removida a entrada `pad: "pressao_sistolica"` do `TIPO_CANONICO`. Diastólica (`pad`) agora é corretamente excluída do snapshot do NEWS2 em vez de competir com a sistólica (`pas`) pelo mesmo slot. **Importante**: ao reler `query-service/src/sinais.js` durante a correção, constatei que esse arquivo **nunca teve o bug** — a citação dele no achado original (abaixo) estava incorreta; o `git diff` que eu mesmo capturei antes da auditoria já mostrava que só `avaliador.js` continha `pad`. Corrigido apenas onde o bug de fato existia. Revalidado em execução real: publiquei `pas=230` seguido de `pad=60` via MQTT e confirmei no log do `alerts-service` que o `pad` não incrementa a contagem do snapshot (ficou em `1/5` antes e depois da mensagem de `pad`), ou seja, não é mais considerado no cálculo.
5. **Senha em claro no console** (`Back End/api-gateway/scripts/gerar-hash.js:30`) — o `console.log` deixou de imprimir a senha; agora mostra apenas confirmação de que o hash foi gerado.
6. **`README.md` da raiz** — reescrito com diagrama de arquitetura, tabela de serviços/portas, instruções de execução (`start-all.sh`/`start-all.ps1`) e resumo do fluxo de dados ponta a ponta.
7. **Código morto (`__setCollectionForTest`)** — avaliado e **mantido intencionalmente**: é um hook de teste documentado (`"Hook para teste: permite injetar uma coleção stub sem precisar do Atlas"`), presente de forma consistente em 4 serviços. Não é código morto acidental, é um ponto de extensão para testes — removê-lo destruiria infraestrutura de teste futura sem nenhum ganho. Nenhuma alteração feita aqui.

## Problema crítico identificado e corrigido

### ✅ (corrigido) Conflito de nomenclatura entre pressão sistólica e diastólica no mapa de tipos canônicos

**Arquivo afetado de fato**: `Back End/alerts-service/src/avaliador.js:19-30` (ver nota de correção do item 4 acima sobre `query-service/src/sinais.js` não ser afetado)

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

**Sugestão original**: remover `pad: "pressao_sistolica"` do mapa, já que a diastólica não compõe o NEWS2.

**Correção aplicada**: exatamente essa — removida a linha `pad: "pressao_sistolica"` de `avaliador.js`, com comentário explicando o motivo. Revalidado em execução real publicando `pas` seguido de `pad` via MQTT (ver "Correções aplicadas", item 4).

## Problemas não-críticos

| # | Item | Arquivo | Status | Descrição |
|---|------|---------|--------|-----------|
| 1 | Estrutura | raiz do projeto | ⊘ Não alterado (decisão consciente) | Não existe pasta `iot-simulator/` prevista na estrutura esperada (Passo 2); a função foi reimplementada como scripts em `Back End/ingestion-service/scripts/`. Funcionalmente equivalente e testado com sucesso. Renomear/mover pastas neste estágio arrisca quebrar caminhos relativos e scripts de start sem benefício real — é uma observação para a defesa, não um bug. |
| 2 | Estrutura | `Back End/mqtt-broker/` | ⊘ Não alterado (decisão consciente) | Não segue o padrão dos demais serviços (sem `src/`). Aceitável dado o tamanho do serviço (~30 linhas); reestruturar arriscaria mais do que o ganho organizacional justificaria. `.gitignore`/`README`/`.env.example` já foram adicionados (lote 1). |
| 3 | Logs | `Back End/api-gateway/scripts/gerar-hash.js:30` | ✅ Corrigido | Imprimia a senha em claro no console. Corrigido para não exibir a senha. |
| 4 | Auditoria | `Back End/audit-service/src/repositorio.js` | ⊘ Não alterado (decisão consciente) | Mutex em memória, válido para uma única instância do `audit-service`. Implementar um mutex distribuído (Mongo transactions/fila) seria uma mudança de arquitetura, não um fix seguro/comportamento-preservado — o próprio código já documenta essa limitação como aceitável para o MVP. Recomendado como trabalho futuro, não corrigido aqui. |
| 5 | Qualidade | `repositorio.js` (4 serviços) | ⊘ Não alterado (decisão consciente) | `__setCollectionForTest` não é código morto acidental — é um hook de teste documentado e intencional. Removê-lo destruiria infraestrutura de teste sem ganho. Mantido. |
| 6 | Documentação | `README.md` (raiz) | ✅ Corrigido | Continha apenas o título. Reescrito com diagrama de arquitetura, tabela de serviços/portas, instruções de execução e fluxo de dados. |
| 7 | Funcional | query-service `/health` | ⊘ Não alterado (decisão consciente) | Não existe endpoint `/health` dedicado porque o serviço usa `startStandaloneServer` do Apollo, que não expõe rotas customizadas sem trocar para `expressMiddleware` — uma mudança de servidor HTTP, não um fix trivial. O 400 em GET é comportamento padrão do Apollo (proteção CSRF), não um bug. Não alterado. |

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
3. PII em logs? ✅ (corrigido) — senha em claro em script offline de geração de hash, removida (ver "Correções aplicadas").
4. JWT: `algorithms: ["HS256"]` explícito + `issuer` validado + secret do env? ✅ — `api-gateway/src/auth.js`.
5. Anti-enumeração no login (bcrypt dummy)? ✅ — confirmado no código e por inspeção do tempo de resposta do fluxo.
6. RBAC — reidentificação exige exclusivamente `medico`? ✅ — confirmado no código **e em execução real** (enfermeiro recebeu 403).
7. CORS configurável via env, OPTIONS retorna 204? ✅ — `api-gateway/src/servidor.js`.
8. Fail-closed na reidentificação (auditoria antes da PII, exceção se falhar)? ✅ — confirmado no código **e em execução real**: com `audit-service` derrubado, a reidentificação retornou 500 sem PII.
9. Hash chain (`corpo + hashAnterior`, `verificarCadeia`)? ✅ — `audit-service/src/hash-chain.js`; confirmado em execução (`/eventos/verificar` → `integridade: "ok"`).
10. WORM lógico (sem DELETE/PUT/PATCH em `/eventos`)? ✅ — apenas GET e POST declarados em `audit-service/src/servidor.js`.
11. Mutex de gravação serializa inserções? ⚠️ (mantido, decisão consciente) — funciona corretamente para uma instância (confirmado no código); frágil em múltiplas réplicas. Corrigir exigiria mutex distribuído (mudança de arquitetura), não um fix seguro — mantido como limitação documentada, aceitável para o MVP.
12. `POST /eventos` exige `X-Audit-Token`? ✅ — confirmado no código.
13. Headers `X-User-*` vêm do JWT, não do body? ✅ — `api-gateway/src/proxy.js`.
14. `patients-service` prioriza `x-user-login` sobre `body.solicitante`? ✅ — confirmado no código; em execução, o evento de auditoria registrou corretamente `solicitante: "dr.silva"` (originado do JWT, não do body).

### Bloco 4: Padrões de projeto
1. Circuit Breaker (`opossum`) envolve gravação no Mongo, com fallback que loga perda? ✅ — `ingestion-service/src/repositorio.js`.
2. Observer (`MotorDeAlertas extends EventEmitter`, ≥2 observadores)? ✅ — `alerts-service/src/motor.js`; observadores logger e WebSocket confirmados, **e testados em execução real** (alerta NEWS2 calculado e logado após publicação MQTT de sinais críticos).

### Bloco 5: Integrações entre serviços
1. `ingestion-service` assina `hospital/uti/+/+`? ✅
2. `alerts-service` assina o mesmo padrão? ✅
3. Scripts simuladores publicam em tópicos/tipos coerentes com o consumido? ✅ (corrigido) — havia conflito `pas`/`pad` no `alerts-service` (ver "Problema crítico identificado e corrigido"); removido e revalidado em execução real.
4. `query-service` usa `PATIENTS_URL` (default 8082)? ✅
5. `reidentifyPatient` apenas intermedia, sem `PII_ENCRYPTION_KEY` no `query-service`? ✅ — confirmado no código e no `.env`.
6. Dashboard usa `VITE_GATEWAY_URL`/`VITE_ALERTS_WS_URL`? ✅
7. Gateway mapeia rotas para `PATIENTS_URL`/`QUERY_URL`? ✅
8. `patients-service` tem `audit-client.js` usando `AUDIT_URL`? ✅ — confirmado também em execução (evento de auditoria de fato chegou ao `audit-service`).

### Bloco 6: Qualidade de código
1. `console.log` de debug esquecido? ✅ — nenhum encontrado; todos os logs são operacionais.
2. TODO/FIXME? ✅ — nenhum encontrado.
3. Código morto? ⚠️ (mantido, decisão consciente) — `__setCollectionForTest` exportada e não usada em 4 serviços. Avaliado e mantido: é um hook de teste documentado, não código morto acidental (ver "Correções aplicadas").
4. Comentários "mentindo"? ✅ — nenhuma divergência encontrada entre comentário e implementação.
5. Consistência de nomenclatura (PT domínio / EN técnico)? ✅ — consistente em todo o projeto.

### Bloco 7: Funcional (executado de fato)
1. `start-all` sobe sem erro? ⚠️→✅ após correção — havia bug que impedia a subida sem Docker (corrigido). Após a correção, todos os 7 processos (broker MQTT Aedes, 6 serviços Node, dashboard Vite) subiram e todas as 7 portas (1883/8080-8084/8090) ficaram ativas.
2. `GET /health` retorna 200? ✅ (gateway, patients, audit) / ⚠️ (mantido, decisão consciente) — query-service não tem rota dedicada por limitação do `startStandaloneServer` do Apollo (ver não-críticos); o 400 retornado é comportamento padrão da biblioteca, não um bug.
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
1. README raiz explica arquitetura geral? ✅ (corrigido) — reescrito com diagrama, tabela de serviços/portas e fluxo de dados.
2. Cada serviço tem README com decisões de design? ✅ — 7/8 muito bons a excelentes (`patients-service` e `audit-service` se destacam); `mqtt-broker` estava ausente, corrigido com README mínimo.
3. Decisões de segurança rastreáveis no código (comentários "por quê")? ✅ — excelente: comentários justificam AES-GCM vs. alternativas, motivo do IV aleatório, fail-closed, anti-enumeração, limitações assumidas do mutex em memória, citando inclusive artigos da LGPD.

## Recomendações para a defesa na banca

1. **Destaque a auditoria fail-closed**: foi testada em execução real (não apenas lida) — derrubar o `audit-service` de fato bloqueia a reidentificação com 500, sem vazar PII. É um diferencial concreto de maturidade em LGPD.
2. **Destaque o pipeline E2E completo**: MQTT → ingestion-service (Circuit Breaker) → MongoDB → alerts-service (Observer, NEWS2) → WebSocket → dashboard foi testado ponta a ponta nesta auditoria, simulando exatamente o código do componente React (`Alertas.jsx`) recebendo um alerta real "ALTO" (score 14) calculado a partir de sinais vitais críticos publicados via MQTT.
3. **Destaque a criptografia e pseudonimização**: ambas verificadas tanto no código quanto inspecionando o dado real persistido no Atlas — nome e CPF nunca aparecem em claro.
4. **Destaque os comentários "por quê"**: o código justifica decisões de segurança citando trade-offs e LGPD diretamente — incomum em projetos acadêmicos e um ponto forte para a banca.
5. **Esteja preparado para explicar o desvio estrutural** (ausência de pasta `iot-simulator/`, broker MQTT local como alternativa ao Mosquitto/Docker) como uma adaptação pragmática ao ambiente de desenvolvimento, não uma omissão.

## Pontos de atenção para a banca

1. **O bug de `pas`/`pad` já foi corrigido nesta auditoria** — se questionado, explique que existia um bug real de mapeamento de tipos (diastólica competindo com sistólica no NEWS2), identificado e corrigido com revalidação em execução real (publicação MQTT de `pas` seguido de `pad`, confirmando que a diastólica deixou de ser contabilizada). É um bom exemplo de processo de revisão funcionando.
2. **Mutex de auditoria em memória**: se perguntado sobre escalabilidade horizontal do `audit-service`, reconheça a limitação (já documentada no próprio código, e mantida deliberadamente nesta auditoria por exigir mudança de arquitetura) e cite a solução proposta (transações Mongo ou fila distribuída).
3. **Ausência de testes automatizados versionados**: a função `__setCollectionForTest` sugere que testes existiram em algum momento; esteja preparado para explicar a estratégia de testes do projeto (manual via scripts, ou suíte não commitada). Foi mantida deliberadamente por ser um hook de teste intencional, não código morto.
4. **query-service sem `/health` dedicado**: se perguntado, explique que é uma limitação do `startStandaloneServer` do Apollo (não expõe rotas customizadas sem trocar para `expressMiddleware`), não um descuido — o 400 em GET é o comportamento padrão de proteção CSRF da biblioteca.
