# Audit Service — UTI

Registro imutável de operações sensíveis (principalmente reidentificação de
pacientes). Conforme **LGPD Art. 37** (registro das operações de tratamento).

## Estratégia: defesa em profundidade

Combina DUAS técnicas de proteção:

### 1) WORM (Write Once, Read Many) — barreira preventiva

O usuário do MongoDB usado por este serviço deve ter privilégio **apenas
de `insertOne`** na coleção `eventos` — sem `update`, sem `delete`. Mesmo o
próprio audit-service não consegue alterar registros depois de gravados.

**Setup no Atlas** (recomendado para a banca):
1. Database Access → ADD NEW DATABASE USER
2. Username: `uti_audit_service`
3. Password: Autogenerate (anote no gerenciador)
4. Database User Privileges → Specific Privileges:
   - Custom Role com **apenas a action `insert`** em `uti_auditoria.eventos`
   - + `find` (para leitura/verificação)
   - SEM `update`, SEM `remove`

### 2) Hash chain — barreira detectiva

Cada evento contém o hash SHA-256 do evento anterior, formando uma cadeia.
Se algum dia alguém com privilégios elevados adulterar o banco, a quebra na
cadeia deixa evidência matemática.

```
Evento 1: { sequencia: 1, hashAnterior: GENESIS, hash: a1b2... }
Evento 2: { sequencia: 2, hashAnterior: a1b2...,  hash: c3d4... }
Evento 3: { sequencia: 3, hashAnterior: c3d4...,  hash: e5f6... }
```

Endpoint `/eventos/verificar` varre a cadeia inteira e reporta inconsistências.

## API REST

| Método | Endpoint | Auth | Função |
|---|---|---|---|
| POST | `/eventos` | `X-Audit-Token` | Registra evento (chamado por patients-service) |
| GET | `/eventos` | (público no MVP) | Lista eventos (DPO) — filtros via query |
| GET | `/eventos/verificar` | (público no MVP) | Verifica integridade da cadeia |
| GET | `/health` | (público) | Health check |

> Nota de produção: GET endpoints devem ficar atrás do Gateway com
> `role=dpo`. Para o MVP, sem auth no GET (simplificação).

### Exemplo: registrar evento (interno)
```bash
curl -X POST http://localhost:8084/eventos \
  -H 'content-type: application/json' \
  -H "x-audit-token: $AUDIT_SHARED_TOKEN" \
  -d '{
    "tipo": "reidentificacao",
    "pseudonimo": "PAC-7f3a9b",
    "solicitante": "dr.silva",
    "solicitanteRole": "medico",
    "motivo": "prescricao"
  }'
```

### Exemplo: verificar integridade
```bash
curl http://localhost:8084/eventos/verificar
# {
#   "totalEventos": 42,
#   "integridade": "ok",
#   "problemas": []
# }
```

### Exemplo: DPO consulta acessos a um paciente
```bash
curl 'http://localhost:8084/eventos?pseudonimo=PAC-7f3a9b'
```

## Como rodar

```bash
npm install
cp .env.example .env
# Configure: MONGO_URL_AUDIT, AUDIT_SHARED_TOKEN
npm start
```

## Decisões de design

- **Sem endpoint de UPDATE/DELETE**: append-only no nível da API
- **Mutex interno**: gravações serializadas (cadeia não suporta concorrência)
- **Índice único em `sequencia`**: defesa adicional contra duplicação
- **Token compartilhado**: só patients-service (e demais serviços autorizados)
  conseguem gravar — caller precisa conhecer o segredo
- **Fail-closed do lado do cliente**: se audit-service cai, operações que
  dependem de auditoria também caem (LGPD)

## Estrutura

```
src/
  config.js       # Mongo, porta, token compartilhado
  hash-chain.js   # cálculo SHA-256 e verificação de cadeia
  repositorio.js  # inserção serializada via mutex + leitura ordenada
  servidor.js     # HTTP REST nativo
  index.js        # entrada
```
