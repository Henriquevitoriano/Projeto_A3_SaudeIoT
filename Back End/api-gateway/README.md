# API Gateway — UTI

Porta única, autenticação JWT, RBAC e proxy transparente para os
microsserviços internos.

## Por que existe

Antes do Gateway:
- Cada serviço escutava direto na internet (3 portas expostas)
- Sem autenticação — qualquer um chamava `reidentifyPatient`
- Sem controle de acesso por papel (médico vs enfermeiro)

Depois do Gateway:
- **Uma única porta pública** (8080); os outros escutam só em loopback
- **JWT obrigatório** em toda chamada `/api/*`
- **RBAC declarativo** em `config.js` — quem pode chamar o quê
- **Headers `X-User-*` injetados** a partir do JWT para os serviços internos
  (o `solicitante` da auditoria vem do token validado, não do body)
- **Rate limit** contra força bruta no login

## Endpoints

| Método | Caminho | Acesso | Função |
|---|---|---|---|
| POST | `/auth/login` | Público | Autentica, devolve JWT |
| GET | `/health` | Público | Health check |
| GET | `/api/pacientes` | Qualquer autenticado | Lista pacientes |
| GET | `/api/pacientes/:p` | Qualquer autenticado | Dados públicos |
| POST | `/api/pacientes` | Médico/enfermeiro | Cadastra paciente |
| POST | `/api/pacientes/:p/reidentificar` | **Apenas médico** | PII em claro |
| POST | `/api/graphql` | Qualquer autenticado | Consulta GraphQL |

## Como rodar

```bash
# 1. Instalar
npm install

# 2. Gerar segredo JWT
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Gerar hashes dos usuários demo
npm run gerar-hash
# (copia a linha USUARIOS_JSON=... para o .env)

# 4. Configurar .env (JWT_SECRET, USUARIOS_JSON, URLs dos serviços)
cp .env.example .env
# editar...

# 5. Subir os serviços que o GW vai chamar (patients, query, alerts)
# em terminais separados

# 6. Rodar o Gateway
npm start
```

## Usuários demo (gerados pelo script)

| Login | Senha | Role | Pode |
|---|---|---|---|
| `dr.silva` | `DemoMedico@2026` | médico | Tudo, inclusive reidentificar |
| `enf.santos` | `DemoEnfermeiro@2026` | enfermeiro | Ver e cadastrar, **não** reidentificar |
| `dpo.admin` | `DemoDPO@2026` | dpo | Ver tudo (auditoria no Passo 8) |

## Exemplo de uso

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8080/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"dr.silva","senha":"DemoMedico@2026"}' | jq -r .token)

# Chamada autenticada
curl http://localhost:8080/api/pacientes \
  -H "Authorization: Bearer $TOKEN"

# Reidentificar (só médico passa)
curl -X POST http://localhost:8080/api/pacientes/PAC-7f3a9b/reidentificar \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"motivo":"prescricao"}'
```

## Decisões de segurança

- **JWT HS256 com algorithms explícito** — impede ataque `alg: none`
- **Validação de issuer** — só aceita tokens emitidos pelo próprio Gateway
- **Anti-enumeração no login** — mesma mensagem e mesmo tempo para
  "usuário inexistente" vs "senha errada" (timing attack mitigado)
- **Rate limit** — 5 tentativas falhas por minuto por IP
- **Body size limit** — 32 KB máx (defesa DoS por payload gigante)
- **Headers de segurança** — `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`
- **formatError sem stack trace** — proteção contra information disclosure
- **`solicitante` vem do JWT, não do body** — não é mais forjável pelo cliente
- **Authorization não é repassado aos serviços internos** — eles confiam
  nos headers `X-User-*` injetados pelo Gateway

## Estrutura

```
src/
  config.js       # JWT, usuários, rotas, RBAC
  auth.js         # login bcrypt + emissão/validação JWT
  rate-limit.js   # contador em memória contra brute force
  proxy.js        # encaminha HTTP, injeta X-User-*
  servidor.js     # roteamento, autenticação, autorização
  index.js        # entrada
scripts/
  gerar-hash.js   # utilitário para criar hashes bcrypt
```
