# Dashboard de Monitoramento — UTI

Frontend React + Vite. Consome o sistema completo (Gateway HTTP/GraphQL +
WebSocket de alertas).

## Funcionalidades

- **Login** com usuário/senha (chama o `/auth/login` do Gateway)
- **Lista de pacientes** com score NEWS2 colorido por risco (verde/amarelo/vermelho)
- **Painel de alertas em tempo real** via WebSocket
- **Modal de reidentificação** (médico) — exige motivo, mostra PII, auditado
- **RBAC frontend** — botão de reidentificar só aparece para `role: "medico"`

## Decisões de design

- **React + Vite** — hot reload, build otimizado, padrão de mercado
- **sessionStorage** para o JWT — perde ao fechar aba (vs `localStorage`
  que persistiria); em produção, cookie httpOnly
- **`useEffect` com cleanup** — evita memory leaks ao trocar de tela
- **Auto-reconexão do WebSocket** — UTI exige resiliência também no frontend
- **RBAC defesa em profundidade** — o frontend esconde o botão por UX,
  mas a barreira de segurança real é o Gateway (responde 403 se enfermeiro
  tentar via DevTools)
- **Camada `api.js`** isola HTTP do React — único arquivo que conhece URLs

## Como rodar

```bash
# 1. Instalar
npm install

# 2. (Opcional) ajustar URLs do backend
cp .env.example .env
# Por padrão, aponta para http://localhost:8080 (Gateway) e ws://localhost:8081

# 3. Subir o Gateway + demais serviços (em outros terminais)
# Ver start-all.sh na raiz do projeto

# 4. Rodar o dashboard
npm run dev
# Abre em http://localhost:8090
```

## Usuários demo (configurados no Gateway)

| Login | Senha | Role | Vê o quê |
|---|---|---|---|
| `dr.silva` | `DemoMedico@2026` | médico | Tudo, inclusive reidentificar |
| `enf.santos` | `DemoEnfermeiro@2026` | enfermeiro | Sem botão de reidentificar |
| `dpo.admin` | `DemoDPO@2026` | dpo | Painel de pacientes |

## Estrutura

```
src/
  api/
    api.js                    # camada de comunicação (Gateway, WS)
  components/
    Login.jsx                  # tela de autenticação
    Pacientes.jsx              # lista + cards com NEWS2
    Reidentificar.jsx          # modal de reidentificação
    Alertas.jsx                # painel WS em tempo real
  App.jsx                      # raiz, decide login vs dashboard
  main.jsx                     # entrada React
  styles.css                   # paleta hospitalar
```

## Notas de produção

- O WebSocket conecta direto no `alerts-service`, sem passar pelo Gateway.
  Trade-off do MVP — em produção, o Gateway faria proxy do upgrade.
- A variável `solicitante` na mutation de reidentificação é placeholder; o
  backend prioriza o header `X-User-Login` injetado pelo Gateway a partir
  do JWT validado.
- CORS está habilitado no Gateway via `CORS_ORIGEM` (default: localhost:8090).
