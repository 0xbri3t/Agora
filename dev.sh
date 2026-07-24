#!/usr/bin/env bash
# FutarFi local dev orchestrator
#
#   ./dev.sh            start full local stack (mongo + anvil + contracts + backend + frontend)
#   ./dev.sh stop       stop everything
#   ./dev.sh status     show what's running
#   ./dev.sh logs [svc] tail logs (svc: anvil|backend|frontend, default: all)
#   ./dev.sh reset      stop + wipe mongo data (fresh DB next start)
#
# Services & ports:
#   MongoDB   localhost:27017  (docker: futarfi-mongo)
#   Anvil     localhost:8545   (chain id 31337)
#   Backend   localhost:3001   (nodemon, native)
#   Frontend  localhost:3000   (next dev, native)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DIR="$ROOT/.dev"
LOG_DIR="$DEV_DIR/logs"
PID_DIR="$DEV_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# docker compose v2 vs legacy docker-compose
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose -f "$ROOT/backend/docker-compose.yml")
else
  DC=(docker-compose -f "$ROOT/backend/docker-compose.yml")
fi

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m▸ %s\033[0m\n' "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { red "Missing '$1'. $2"; exit 1; }
}

pid_alive() { [ -f "$PID_DIR/$1.pid" ] && kill -0 "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; }

start_bg() { # name, cwd, cmd...
  local name="$1" cwd="$2"; shift 2
  if pid_alive "$name"; then info "$name already running (pid $(cat "$PID_DIR/$name.pid"))"; return; fi
  info "starting $name ..."
  ( cd "$cwd" && exec "$@" ) >"$LOG_DIR/$name.log" 2>&1 &
  echo $! > "$PID_DIR/$name.pid"
}

wait_for() { # name, url, tries
  local name="$1" url="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf -o /dev/null "$url"; then green "$name ready"; return 0; fi
    sleep 1
  done
  red "$name did not become ready ($url). See $LOG_DIR"; return 1
}

wait_for_rpc() {
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null -X POST -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","id":1}' http://127.0.0.1:8545; then
      green "anvil ready"; return 0
    fi
    sleep 1
  done
  red "anvil did not become ready"; return 1
}

cmd_start() {
  require docker  "Install Docker Desktop."
  require anvil   "Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  require forge   "Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  require node    "Install Node.js."
  require pnpm    "Install pnpm: npm i -g pnpm"
  require curl    "Install curl."

  # 1. backend/.env bootstrap (never clobber an existing one)
  if [ ! -f "$ROOT/backend/.env" ]; then
    cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
    info "created backend/.env from .env.example"
  fi

  # 2. MongoDB (docker, only the db service — API runs natively for hot reload)
  info "starting mongodb (docker) ..."
  "${DC[@]}" up -d mongodb

  # 3. Anvil — FORK of Sepolia so the 1inch Aqua stack exists locally
  local fork_url=""
  if [ -f "$ROOT/blockend/.env" ]; then
    fork_url="$(grep '^SEPOLIA_RPC_URL=' "$ROOT/blockend/.env" | cut -d= -f2-)"
  fi
  fork_url="${fork_url:-https://ethereum-sepolia-rpc.publicnode.com}"
  start_bg anvil "$ROOT" anvil --chain-id 31337 --port 8545 --fork-url "$fork_url"
  wait_for_rpc

  # 4. Contracts: deploy + mint PYUSD + sync addresses to frontend/backend
  info "deploying contracts to anvil ..."
  ( cd "$ROOT/blockend" && ./deploy-and-update.sh ) >"$LOG_DIR/deploy.log" 2>&1 \
    && green "contracts deployed (see $LOG_DIR/deploy.log)" \
    || { red "deploy failed — tail $LOG_DIR/deploy.log"; exit 1; }

  # 5. Backend (native nodemon; env overrides beat .env values via dotenv semantics)
  [ -d "$ROOT/backend/node_modules" ] || ( info "installing backend deps ..." && cd "$ROOT/backend" && npm install )
  MONGODB_URI="mongodb://admin:password123@localhost:27017/futarfi?authSource=admin" \
  RPC_URL="http://127.0.0.1:8545" \
  RPC_WS_URL="ws://127.0.0.1:8545" \
  CHAIN_ID="31337" \
  start_bg backend "$ROOT/backend" npm run dev
  wait_for backend http://localhost:3001/health 90

  # 6. Frontend
  [ -d "$ROOT/frontend/node_modules" ] || ( info "installing frontend deps ..." && cd "$ROOT/frontend" && pnpm install )
  start_bg frontend "$ROOT/frontend" pnpm dev
  wait_for frontend http://localhost:3000 120

  echo ""
  green "════════════ FutarFi local stack up ════════════"
  echo "  Frontend   http://localhost:3000"
  echo "  API        http://localhost:3001  (docs: /api-docs)"
  echo "  Anvil RPC  http://127.0.0.1:8545  (chain 31337)"
  echo "  MongoDB    mongodb://localhost:27017"
  echo ""
  echo "  Anvil test accounts (10000 ETH each, USDC collateral minted to #0 and #1):"
  echo "   #0 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (attestor/deployer)"
  echo "      pk 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  echo "   #1 0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
  echo "      pk 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  echo ""
  echo "  Logs:   ./dev.sh logs [anvil|backend|frontend]"
  echo "  Stop:   ./dev.sh stop      Fresh DB: ./dev.sh reset"
}

stop_one() {
  local name="$1"
  if pid_alive "$name"; then
    local pid; pid="$(cat "$PID_DIR/$name.pid")"
    # kill the whole process group children (nodemon/next spawn subprocesses)
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_DIR/$name.pid"
    info "stopped $name"
  else
    rm -f "$PID_DIR/$name.pid"
  fi
}

cmd_stop() {
  stop_one frontend
  stop_one backend
  stop_one anvil
  info "stopping mongodb ..."
  "${DC[@]}" stop mongodb >/dev/null 2>&1 || true
  green "stack stopped"
}

cmd_status() {
  for name in anvil backend frontend; do
    if pid_alive "$name"; then green "$name: running (pid $(cat "$PID_DIR/$name.pid"))"; else red "$name: stopped"; fi
  done
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^futarfi-mongo$'; then
    green "mongodb: running (docker futarfi-mongo)"
  else
    red "mongodb: stopped"
  fi
}

cmd_logs() {
  local svc="${1:-}"
  if [ -n "$svc" ]; then tail -f "$LOG_DIR/$svc.log"; else tail -f "$LOG_DIR"/*.log; fi
}

cmd_reset() {
  cmd_stop
  info "wiping mongo volume ..."
  "${DC[@]}" down -v >/dev/null 2>&1 || true
  green "reset done — next ./dev.sh start is a clean slate"
}

case "${1:-start}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  logs)   shift || true; cmd_logs "${1:-}" ;;
  reset)  cmd_reset ;;
  *) echo "usage: ./dev.sh [start|stop|status|logs [svc]|reset]"; exit 1 ;;
esac
