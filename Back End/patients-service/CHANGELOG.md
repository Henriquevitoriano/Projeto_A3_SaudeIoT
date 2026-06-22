# Mudanças do Passo 8

## Auditoria imutável de reidentificação

O placeholder `[AUDIT-PLACEHOLDER]` que existia em `pacientes.js` foi
substituído por uma chamada REAL ao novo `audit-service`.

### Novos arquivos
- `src/audit-client.js` — cliente HTTP do audit-service

### Comportamento alterado
- `reidentificar()` agora chama `registrarEvento()` ANTES de devolver PII
- Se o audit-service estiver fora, a reidentificação FALHA (fail-closed)
- O `solicitante` agora vem PRIMARIAMENTE do header `X-User-Login` (injetado
  pelo Gateway a partir do JWT), com fallback para o body

### Novas variáveis de ambiente
- `AUDIT_URL` — URL do audit-service (default http://localhost:8084)
- `AUDIT_SHARED_TOKEN` — segredo compartilhado entre os dois serviços
