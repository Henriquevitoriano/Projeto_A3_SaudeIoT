# Mudanças do Passo 9

## CORS habilitado

Necessário para o dashboard (porta 8090) chamar o Gateway (porta 8080).

### Headers adicionados (em todas as respostas)
- `Access-Control-Allow-Origin` (configurável via `CORS_ORIGEM`)
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Access-Control-Max-Age: 600`
- `Vary: Origin`

### Tratamento de preflight
Requisições `OPTIONS` retornam 204 imediatamente (sem passar pelas rotas).

### Nova variável de ambiente (opcional)
- `CORS_ORIGEM` — origem permitida (default: `http://localhost:8090`)

Em produção, configurar para o domínio real do dashboard.
