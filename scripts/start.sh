#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'
log(){ printf "${GREEN}[START]${NC} %s\n" "$*"; }
info(){ printf "${CYAN}[INFO]${NC}  %s\n" "$*"; }
warn(){ printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
fail(){ printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; exit 1; }
section(){ printf "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${WHITE}${BOLD}  %s${NC}\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n" "$*"; }

banner(){
  printf "${CYAN}\n"
  cat <<'ART'
  ╔══════════════════════════════════════════════════════════════╗
  ║                     FORMASH 3D                             ║
  ║                 starting services...                       ║
  ╚══════════════════════════════════════════════════════════════╝
ART
  printf "${NC}\n"
}

# Load environment variables (auto-copy from .env.example if missing)
if [[ ! -f "$PROJECT_ROOT/.env" && -f "$PROJECT_ROOT/.env.example" ]]; then
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  log "Created .env from .env.example"
fi
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  [[ -z "${GITHUB_TOKEN:-}" || -z "${GITHUB_TOKEN// /}" ]] && unset GITHUB_TOKEN
  [[ -z "${GH_TOKEN:-}" || -z "${GH_TOKEN// /}" ]] && unset GH_TOKEN
  [[ -z "${HF_TOKEN:-}" || -z "${HF_TOKEN// /}" ]] && unset HF_TOKEN
  [[ -z "${HUGGINGFACE_TOKEN:-}" || -z "${HUGGINGFACE_TOKEN// /}" ]] && unset HUGGINGFACE_TOKEN
fi

# Ensure bun is on PATH if installed
BUN_INSTALL_DIR="${BUN_INSTALL:-$HOME/.bun}"
[[ -d "$BUN_INSTALL_DIR/bin" ]] && export PATH="$BUN_INSTALL_DIR/bin:$PATH"

PID_DIR="$PROJECT_ROOT/.pids"
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:7842}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:3000}"

write_pid(){ printf '%s\n' "$2" > "$1"; }

is_alive(){ [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }


start_redis(){
  section "1/2 Redis"
  if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    log "Redis is already running."
    return 0
  fi

  # Auto-install Redis if missing (Colab / generic VPS)
  if ! command -v redis-server >/dev/null 2>&1 || ! command -v redis-cli >/dev/null 2>&1; then
    info "Redis not found. Auto-installing via apt..."
    local sudo_cmd=""
    command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
    if command -v apt-get >/dev/null 2>&1; then
      $sudo_cmd apt-get update -qq 2>/dev/null || true
      $sudo_cmd apt-get install -y --no-install-recommends redis-server redis-tools 2>/dev/null || true
    fi
  fi

  # Try SysV init / Colab service first, then systemctl (systemd VPS), then direct daemon
  if command -v service >/dev/null 2>&1; then
    service redis-server start >/dev/null 2>&1 || true
  elif command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start redis-server >/dev/null 2>&1 || true
  fi

  if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    log "Redis is ready."
    return 0
  fi

  if command -v redis-server >/dev/null 2>&1; then
    info "Starting local Redis daemon..."
    redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --save '' --appendonly no >/dev/null 2>&1 || true
    sleep 1
  fi

  if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    log "Redis is ready."
    return 0
  fi

  fail "Redis is unavailable. Install Redis and rerun setup."
}


start_backend() {
  section "2/2 Backend API"

  local script="$PROJECT_ROOT/backend/scripts/run_server.sh"
  [[ -f "$script" ]] || fail "run_server.sh not found at $script"
  chmod +x "$script" 2>/dev/null || true

  for attempt in 1 2; do
    if [[ -f "$PID_DIR/backend.pid" ]] && is_alive "$(cat "$PID_DIR/backend.pid" 2>/dev/null || true)" && curl -fsS --max-time 2 "$BACKEND_URL/health" >/dev/null 2>&1; then
      log "Backend already running and healthy: $BACKEND_URL"
      return 0
    fi

    rm -f "$PID_DIR/backend.pid"
    info "Launching backend services (Multi-Worker)..."

    # Run backend detached with setsid + nohup so terminal interrupts / manager exit do not kill it
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup bash "$script" >> "$PROJECT_ROOT/logs/backend.log" 2>&1 &
    else
      nohup bash "$script" >> "$PROJECT_ROOT/logs/backend.log" 2>&1 &
    fi
    local b_pid=$!
    disown "$b_pid" 2>/dev/null || true
    echo $b_pid > "$PID_DIR/backend.pid"

    # Poll health endpoint up to 35 seconds
    local healthy=false
    for _ in $(seq 1 35); do
      if curl -fsS --max-time 2 "$BACKEND_URL/health" >/dev/null 2>&1 || curl -fsS --max-time 2 "http://127.0.0.1:7842/health" >/dev/null 2>&1; then
        healthy=true
        break
      fi
      sleep 1
    done

    if [[ "$healthy" == "true" ]]; then
      log "Backend healthy: $BACKEND_URL"
      return 0
    fi

    [[ "$attempt" -eq 1 ]] && {
      warn "Backend did not respond yet. Checking logs..."
      tail -n 15 "$PROJECT_ROOT/logs/backend.log" 2>/dev/null || true
      warn "Retrying backend start..."
      kill "$(cat "$PID_DIR/backend.pid" 2>/dev/null || true)" 2>/dev/null || true
      fuser -k 7842/tcp 2>/dev/null || true
      pkill -f "scheduler_service.py" 2>/dev/null || true
      rm -f "$PID_DIR/backend.pid"
      sleep 3
    }
  done


  warn "━━━━━━━━━━━━━━━━ Backend Startup Failure Log ━━━━━━━━━━━━━━━━"
  tail -n 35 "$PROJECT_ROOT/logs/backend.log" 2>/dev/null || true
  if [[ -f "$PROJECT_ROOT/backend/logs/scheduler.log" ]]; then
    warn "━━━━━━━━━━━━━━━━ Scheduler Log ━━━━━━━━━━━━━━━━"
    tail -n 25 "$PROJECT_ROOT/backend/logs/scheduler.log" 2>/dev/null || true
  fi
  if [[ -f "$PROJECT_ROOT/backend/logs/api.log" ]]; then
    warn "━━━━━━━━━━━━━━━━ API Log ━━━━━━━━━━━━━━━━"
    tail -n 25 "$PROJECT_ROOT/backend/logs/api.log" 2>/dev/null || true
  fi
  fail "Backend failed after 2 attempts. See error log above."
}



start_frontend(){
  section "2/2 Frontend"
  BUN_INSTALL_DIR="${BUN_INSTALL:-$HOME/.bun}"
  [[ -d "$BUN_INSTALL_DIR/bin" ]] && export PATH="$BUN_INSTALL_DIR/bin:$PATH"
  [[ -d "$PROJECT_ROOT/node_modules" ]] || fail "Frontend dependencies are missing. Run bash scripts/setup.sh first."

  if [[ -f "$PID_DIR/frontend.pid" ]] && is_alive "$(cat "$PID_DIR/frontend.pid" 2>/dev/null || true)"; then
    log "Frontend process is already running."
    return 0
  fi

  if [[ ! -f "$PROJECT_ROOT/.next/BUILD_ID" ]]; then
    info "Production build not found. Building Next.js..."
    if command -v bun >/dev/null 2>&1; then
      bun run build > "$LOG_DIR/frontend-build.log" 2>&1
    else
      npm run build > "$LOG_DIR/frontend-build.log" 2>&1
    fi
    log "Frontend build completed."
  fi

  local cmd
  if command -v bun >/dev/null 2>&1; then
    cmd=(bun run start)
  else
    cmd=(npm run start)
  fi

  info "Launching frontend on http://localhost:3000"
  setsid env BACKEND_URL="$BACKEND_URL" AI_PROVIDER=3d_aigc_api RUNTIME_MODE=3d_aigc_api \
    "${cmd[@]}" > "$LOG_DIR/frontend.log" 2>&1 &
  write_pid "$PID_DIR/frontend.pid" "$!"
  sleep 2

  if ! is_alive "$(cat "$PID_DIR/frontend.pid" 2>/dev/null || true)"; then
    fail "Frontend failed to start. Inspect logs/frontend.log."
  fi
  log "Frontend started: $FRONTEND_URL"
}

banner
start_redis
start_backend
start_frontend

section "ForMash 3D is Running"
printf "  ${WHITE}${BOLD}Frontend${NC}  ${CYAN}%s${NC}\n" "$FRONTEND_URL"
printf "  ${WHITE}${BOLD}Backend${NC}   ${CYAN}%s${NC}\n" "$BACKEND_URL"
printf "  ${WHITE}${BOLD}API Docs${NC}  ${CYAN}%s/docs${NC}\n" "$BACKEND_URL"
printf "  ${WHITE}${BOLD}Health${NC}    ${CYAN}%s/health${NC}\n\n" "$BACKEND_URL"
printf "  ${DIM}Stop:${NC}    bash scripts/stop.sh\n"
printf "  ${DIM}Restart:${NC} bash scripts/restart.sh\n"
printf "  ${DIM}Manager:${NC} bash manager.sh\n"
