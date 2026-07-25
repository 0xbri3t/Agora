#!/usr/bin/env bash
# Agora local dev orchestrator
#
#   ./dev.sh            start full local stack (mongo + anvil + contracts + backend + frontend)
#   ./dev.sh stop       stop everything
#   ./dev.sh status     show what's running
#   ./dev.sh logs [svc] tail logs (svc: anvil|backend|frontend, default: all)
#   ./dev.sh reset      stop + wipe mongo data (fresh DB next start)
#   ./dev.sh skip ...   time travel on the local chain:
#                         skip auction <id>  mine to the CCA end block + settle
#                         skip live <id>     warp past the live period + resolve
#                         skip 50            mine 50 blocks
#                         skip 3600s         warp 3600 seconds
#
# Services & ports:
#   MongoDB   localhost:27017  (docker: agora-mongo)
#   Anvil     localhost:8545   (chain id 31337)
#   Backend   localhost:3001   (nodemon, native)
#   Frontend  localhost:3000   (next dev, native)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Seconds per block on the local chain (CCA auctions advance by block number)
BLOCK_TIME="${BLOCK_TIME:-2}"
RPC_LOCAL="http://127.0.0.1:8545"
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

# Kill whatever holds a port that isn't ours. A leftover process from an
# earlier session (one that outlived its pidfile) otherwise silently wins the
# port and the service we just started dies with EADDRINUSE.
free_port() { # port, name
  local port="$1" name="$2" owner
  # Only act when we are about to start this service: if our own pidfile is
  # alive, start_bg will skip it and the port legitimately belongs to us.
  if pid_alive "$name"; then return 0; fi
  owner="$(lsof -ti :"$port" 2>/dev/null | head -1 || true)"
  if [ -z "$owner" ]; then return 0; fi
  info "port $port held by a stale process (pid $owner) — stopping it"
  kill "$owner" 2>/dev/null || true
  sleep 1
  if lsof -ti :"$port" >/dev/null 2>&1; then
    kill -9 "$owner" 2>/dev/null || true
    sleep 1
  fi
  return 0
}

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

  # The backend runs natively here, so Docker-internal hostnames resolve to
  # nothing. dotenv keeps the LAST assignment, so an uncommented Docker line
  # silently wins and the API talks to a database that does not exist.
  if grep -qE '^(MONGODB_URI|RPC_URL|RPC_WS_URL)=.*(@mongodb:|host\.docker\.internal)' "$ROOT/backend/.env"; then
    red "backend/.env points at Docker hostnames (mongodb: / host.docker.internal)."
    red "Comment those lines out — running natively they must use localhost."
    exit 1
  fi

  # 2. MongoDB (docker, only the db service — API runs natively for hot reload)
  info "starting mongodb (docker) ..."
  "${DC[@]}" up -d mongodb

  # 3. Anvil — FORK of Sepolia so the 1inch Aqua + Uniswap CCA stacks exist locally.
  #    --block-time keeps blocks flowing: Uniswap CCA auctions advance by BLOCK
  #    number, so on a mine-on-demand chain they would never end.
  local fork_url=""
  if [ -f "$ROOT/blockend/.env" ]; then
    fork_url="$(grep '^SEPOLIA_RPC_URL=' "$ROOT/blockend/.env" | cut -d= -f2-)"
  fi
  fork_url="${fork_url:-https://ethereum-sepolia-rpc.publicnode.com}"
  # Pin the fork a few blocks back from the tip: free RPCs serve recent state
  # but 403 on deep history, and an unpinned fork drifts into archive requests.
  local fork_block
  fork_block="$(curl -s -m 10 -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$fork_url" \
    | sed -E 's/.*"result":"0x([0-9a-f]+)".*/\1/')"
  local fork_args=()
  if [ -n "$fork_block" ]; then
    fork_args=(--fork-block-number "$(( 16#$fork_block - 5 ))")
    info "forking Sepolia at block $(( 16#$fork_block - 5 ))"
  fi
  free_port 8545 anvil
  start_bg anvil "$ROOT" anvil --chain-id 31337 --host 0.0.0.0 --port 8545 --block-time "$BLOCK_TIME" \
    --fork-url "$fork_url" "${fork_args[@]}"
  wait_for_rpc

  # 4. Contracts: deploy + mint PYUSD + sync addresses to frontend/backend
  info "deploying contracts to anvil ..."
  ( cd "$ROOT/blockend" && ./deploy-and-update.sh ) >"$LOG_DIR/deploy.log" 2>&1 \
    && green "contracts deployed (see $LOG_DIR/deploy.log)" \
    || { red "deploy failed — tail $LOG_DIR/deploy.log"; exit 1; }

  # 5. Backend (native nodemon; env overrides beat .env values via dotenv semantics)
  [ -d "$ROOT/backend/node_modules" ] || ( info "installing backend deps ..." && cd "$ROOT/backend" && npm install )
  free_port 3001 backend
  MONGODB_URI="mongodb://admin:password123@localhost:27017/agora?authSource=admin" \
  RPC_URL="http://127.0.0.1:8545" \
  RPC_WS_URL="ws://127.0.0.1:8545" \
  CHAIN_ID="31337" \
  start_bg backend "$ROOT/backend" npm run dev
  wait_for backend http://localhost:3001/health 90

  # 6. Frontend
  [ -d "$ROOT/frontend/node_modules" ] || ( info "installing frontend deps ..." && cd "$ROOT/frontend" && pnpm install )
  # `next build` and `next dev` share .next, so a production build run while
  # the dev server is up leaves it serving 404s for every chunk. Start clean.
  if [ -d "$ROOT/frontend/.next" ] && [ ! -f "$ROOT/frontend/.next/BUILD_ID" ]; then
    : # dev-only cache, fine to keep
  elif [ -d "$ROOT/frontend/.next" ]; then
    info "clearing .next left behind by a production build"
    rm -rf "$ROOT/frontend/.next"
  fi
  free_port 3000 frontend
  start_bg frontend "$ROOT/frontend" pnpm dev
  wait_for frontend http://localhost:3000 120

  echo ""
  green "════════════ Agora local stack up ════════════"
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
  echo "  Time:   ./dev.sh skip auction <id> | live <id> | <blocks> | <seconds>s"
}

# Time travel on the local chain. Uniswap CCA auctions end at a BLOCK number
# while the proposal's Live phase ends at a TIMESTAMP, so we mine and warp.
cmd_skip() {
  local what="${1:-}"
  if [ -z "$what" ]; then
    red "usage: ./dev.sh skip auction <proposalId> | live <proposalId> | <blocks> | <seconds>s"
    exit 1
  fi
  require cast "Install Foundry."

  local pm
  pm="$(grep '^PROPOSAL_MANAGER_ADDRESS=' "$ROOT/backend/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r')"

  proposal_addr() { # proposalId -> address
    [ -n "$pm" ] || { red "PROPOSAL_MANAGER_ADDRESS not set in backend/.env"; exit 1; }
    cast call "$pm" "proposals(uint256)(address)" "$1" --rpc-url "$RPC_LOCAL"
  }

  # cast prints numbers as "12345 [1.2e4]" — keep just the decimal part
  num() { awk '{print $1}'; }

  mine_blocks() { # count
    local n="$1"
    info "mining $n blocks ..."
    cast rpc anvil_mine "$(printf '0x%x' "$n")" --rpc-url "$RPC_LOCAL" >/dev/null
  }

  warp_seconds() { # seconds
    local s="$1"
    info "warping $s seconds ..."
    cast rpc evm_increaseTime "$s" --rpc-url "$RPC_LOCAL" >/dev/null
    cast rpc anvil_mine 0x1 --rpc-url "$RPC_LOCAL" >/dev/null
  }

  case "$what" in
    auction)
      local p end now
      p="$(proposal_addr "${2:?proposalId required}")"
      end="$(cast call "$p" "auctionEndBlock()(uint64)" --rpc-url "$RPC_LOCAL" | num)"
      now="$(cast block-number --rpc-url "$RPC_LOCAL")"
      if [ "$now" -ge "$end" ]; then
        green "auction already past its end block ($now >= $end)"
      else
        mine_blocks $(( end - now + 1 ))
        green "at block $(cast block-number --rpc-url "$RPC_LOCAL") (auction end was $end)"
      fi
      info "settling ..."
      cast send "$p" "settleAuctions()" --rpc-url "$RPC_LOCAL" \
        --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 >/dev/null \
        && green "settled — proposal state: $(cast call "$p" "state()(uint8)" --rpc-url "$RPC_LOCAL")" \
        || red "settle failed (both auctions must have graduated, or it is already settled)"
      ;;
    live)
      local p live_end now_ts
      p="$(proposal_addr "${2:?proposalId required}")"
      live_end="$(cast call "$p" "liveEnd()(uint256)" --rpc-url "$RPC_LOCAL" | num)"
      now_ts="$(cast block --rpc-url "$RPC_LOCAL" --field timestamp)"
      if [ "$now_ts" -ge "$live_end" ]; then
        green "live period already over"
      else
        warp_seconds $(( live_end - now_ts + 1 ))
      fi
      info "resolving ..."
      cast send "$p" "resolve()" --rpc-url "$RPC_LOCAL" \
        --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 >/dev/null \
        && green "resolved — proposal state: $(cast call "$p" "state()(uint8)" --rpc-url "$RPC_LOCAL")" \
        || red "resolve failed (TWAPs must be pushed and the live period over)"
      ;;
    *s)
      warp_seconds "${what%s}"
      ;;
    *)
      mine_blocks "$what"
      ;;
  esac
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
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^agora-mongo$'; then
    green "mongodb: running (docker agora-mongo)"
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
  skip)   shift || true; cmd_skip "$@" ;;
  *) echo "usage: ./dev.sh [start|stop|status|logs [svc]|reset|skip <target>]"; exit 1 ;;
esac
