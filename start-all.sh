#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# start-all.sh
# Sobe TODOS os processos do sistema UTI Monitor para a demo.
#
# Pré-requisitos:
#   - Docker rodando (para o Mosquitto)
#   - Cada serviço com seu .env configurado
#   - npm install já rodado em cada pasta
#
# Uso:
#   chmod +x start-all.sh
#   ./start-all.sh
#
# Para parar tudo: Ctrl+C nesta janela (mata todos os processos filhos)
# -----------------------------------------------------------------------------

set -e

PROJETO_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$PROJETO_DIR/.logs"
mkdir -p "$LOG_DIR"

echo "==============================================="
echo "  UTI Monitor - Subindo o sistema completo"
echo "==============================================="

# ─── 1) Mosquitto (broker MQTT) ─────────────────────────────────────────────
echo ""
echo "[1/7] Mosquitto (broker MQTT)..."
if ! docker ps --format '{{.Names}}' | grep -q "^mosquitto$"; then
  if docker ps -a --format '{{.Names}}' | grep -q "^mosquitto$"; then
    docker start mosquitto > /dev/null
  else
    docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto > /dev/null
  fi
  sleep 2
fi
echo "      ✓ Mosquitto em 1883"

# Função para subir um serviço Node em background
start_servico() {
  local nome="$1"
  local pasta="$2"
  local porta="$3"

  echo ""
  echo "[$nome] Iniciando..."
  cd "$PROJETO_DIR/$pasta"
  if [ ! -d node_modules ]; then
    echo "      ! node_modules não encontrado em $pasta — rode 'npm install' primeiro"
    exit 1
  fi
  if [ ! -f .env ]; then
    echo "      ! .env não encontrado em $pasta — copie .env.example e configure"
    exit 1
  fi
  npm start > "$LOG_DIR/$nome.log" 2>&1 &
  local pid=$!
  echo "      ✓ PID $pid em :$porta (logs: $LOG_DIR/$nome.log)"
  cd "$PROJETO_DIR"
}

# ─── 2-6) Microsserviços (Back End) ────────────────────────────────────────
start_servico "audit-service"     "Back End/audit-service"     8084
sleep 1
start_servico "patients-service"  "Back End/patients-service"  8082
sleep 1
start_servico "query-service"     "Back End/query-service"     8083
sleep 1
start_servico "alerts-service"    "Back End/alerts-service"    8081
sleep 1
start_servico "ingestion-service" "Back End/ingestion-service" "-"
sleep 1
start_servico "api-gateway"       "Back End/api-gateway"       8080
sleep 1

# ─── 7) Dashboard (último, Front End) ──────────────────────────────────────
echo ""
echo "[dashboard] Iniciando (Vite dev server)..."
cd "$PROJETO_DIR/Front End/dashboard"
if [ ! -d node_modules ]; then
  echo "      ! node_modules não encontrado — rode 'npm install' em Front End/dashboard/"
  exit 1
fi
npm run dev > "$LOG_DIR/dashboard.log" 2>&1 &
echo "      ✓ PID $! em :8090"
cd "$PROJETO_DIR"

echo ""
echo "==============================================="
echo "  Sistema no ar:"
echo "    Dashboard:        http://localhost:8090"
echo "    API Gateway:      http://localhost:8080"
echo "    GraphQL (direto): http://localhost:8083"
echo ""
echo "  Logs em: $LOG_DIR/"
echo ""
echo "  Para parar tudo: Ctrl+C nesta janela"
echo "==============================================="

# Mata todos os processos filhos quando este script for interrompido
trap 'echo ""; echo "Encerrando processos..."; kill 0 2>/dev/null; exit 0' INT TERM

# Mantém o script vivo
wait
