# Serviço de Pacientes (PII) — UTI

Gerencia a identidade dos pacientes da UTI com **pseudonimização** e
**criptografia em nível de aplicação** (AES-256-GCM). É o ÚNICO serviço do
sistema que conhece a ligação entre o pseudônimo opaco (ex: `PAC-7f3a9b`) e
a identidade real do paciente.

## Decisões de design

### 1. Pseudônimo gerado com RNG criptograficamente seguro

`crypto.randomBytes(3)` → formato `PAC-xxxxxx`. NÃO é derivado de nome ou CPF —
se fosse, alguém com acesso à PII poderia recomputar o pseudônimo e quebrar
a separação. Imprevisibilidade é requisito de pseudonimização real (LGPD Art. 13).

### 2. Criptografia application-level (AES-256-GCM)

PII (nome, CPF) é cifrada com AES-256-GCM ANTES de chegar ao Mongo. A chave
mora no `.env` (futuramente, em KMS). Vantagens do GCM sobre CBC/ECB:
- Não-determinístico (IV aleatório por mensagem)
- Autenticado (tag de 16 bytes detecta adulteração — AEAD)
- Padrão NIST recomendado

### 3. Diferenciação PII vs. quase-identificadores

- **PII (cifrada):** nome, CPF
- **Pública (em claro):** pseudônimo, leito, idade aproximada, sexo

Idade aproximada (não data de nascimento) e sexo são "quase-identificadores"
úteis para a equipe clínica sem facilitar reidentificação direta.

### 4. Banco lógico separado

Banco `uti_pacientes` (PII) é distinto de `uti_monitor` (sinais). No MVP,
ambos no mesmo cluster Atlas. Em produção, promove-se para cluster físico
separado mudando só `MONGO_URL_PII` — zero alteração de código.

## API REST

| Método | Endpoint | Função | Sensibilidade |
|---|---|---|---|
| POST | `/pacientes` | Cadastrar (recebe PII real) | Alta |
| GET  | `/pacientes` | Listar (só pseudônimos + público) | Baixa |
| GET  | `/pacientes/:pseudonimo` | Dados públicos do paciente | Baixa |
| POST | `/pacientes/:pseudonimo/reidentificar` | Retorna PII em claro | **CRÍTICA** |
| GET  | `/health` | Health check | — |

### Exemplo: cadastrar
```bash
curl -X POST http://localhost:8082/pacientes \
  -H 'content-type: application/json' \
  -d '{
    "nome": "Joao da Silva",
    "cpf": "12345678900",
    "leito": "UTI-01",
    "idade_aprox": 65,
    "sexo": "M"
  }'
# Resposta: { "pseudonimo": "PAC-7f3a9b", "leito": "UTI-01", ... }
```

### Exemplo: reidentificar (com motivo para auditoria)
```bash
curl -X POST http://localhost:8082/pacientes/PAC-7f3a9b/reidentificar \
  -H 'content-type: application/json' \
  -d '{ "solicitante": "dr.silva", "motivo": "prescricao medicamento" }'
```

## Como rodar

```bash
# 1. Instalar
npm install

# 2. Gerar a chave de criptografia (UMA VEZ; guardar com segurança)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Configurar .env
cp .env.example .env
# Cole a chave gerada e a MONGO_URL_PII

# 4. Rodar
npm start
```

## Pré-requisito Atlas (recomendado): segundo usuário do banco

Para aplicar o princípio do menor privilégio (ISO 27001 / LGPD), crie no
Atlas um SEGUNDO usuário do banco APENAS para este serviço, com acesso
restrito ao banco `uti_pacientes`:

1. Atlas → Database Access → **+ ADD NEW DATABASE USER**
2. Username: `uti_patients_service`
3. Password: Autogenerate Secure Password (anote no gerenciador de senhas)
4. **Database User Privileges** → Select **Specific Privileges**:
   - Role: `readWrite`
   - Database: `uti_pacientes` (apenas este!)
5. Add User

Use a connection string deste usuário em `MONGO_URL_PII`. Se ele vazar, o
incidente fica contido APENAS ao banco de PII — o de sinais permanece
inacessível com essa credencial.

## Estrutura

```
src/
  config.js        # Mongo, porta HTTP, lê env
  cripto.js        # AES-256-GCM (cifrar/decifrar)
  repositorio.js   # MongoDB (recebe docs já cifrados)
  pacientes.js     # Regras de negócio + pseudonimização
  servidor.js      # HTTP REST nativo (sem Express)
  index.js         # Ponto de entrada
```

## Próximos passos (referência)

- Passo 7: API Gateway com JWT — adiciona autenticação na frente
- Passo 8: Auditoria imutável — substitui o `[AUDIT-PLACEHOLDER]` por log WORM
