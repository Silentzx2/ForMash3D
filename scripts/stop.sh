#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'
log(){ printf "${GREEN}[STOP]${NC} %s\n" "$*"; }
info(){ printf "${CYAN}[INFO]${NC} %s\n" "$*"; }
warn(){ printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
section(){ printf "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${WHITE}${BOLD}  %s${NC}\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n" "$*"; }

PID_DIR="$PROJECT_ROOT/.pids"
BACKEND_RUN_DIR="$PROJECT_ROOT/backend/run"

kill_group_from_file(){
  local file="$1" label="$2"
  [[ -f "$file" ]] || return 0
  local pid
  pid=$(cat "$file" 2>/dev/null || true)
  [[ "$pid" =~ ^[0-9]+$ ]] || { rm -f "$file"; return 0; }
  if kill -0 "$pid" 2>/dev/null; then
    info "Stopping $label (PID $pid)..."
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in {1..10}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "$label did not exit gracefully; forcing shutdown."
      kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    log "$label stopped."
  fi
  rm -f "$file"
}

kill_backend_children(){
  [[ -d "$BACKEND_RUN_DIR" ]] || return 0
  for file in "$BACKEND_RUN_DIR"/*.pid; do
    [[ -f "$file" ]] || continue
    local pid
    pid=$(cat "$file" 2>/dev/null || true)
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      info "Stopping backend worker PID $pid..."
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  done
}

stop_local_redis(){
  if [[ -f "$PID_DIR/redis.pid" ]]; then
    local pid
    pid=$(cat "$PID_DIR/redis.pid" 2>/dev/null || true)
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      info "Stopping project-started Redis (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$PID_DIR/redis.pid"
  fi
}

kill_by_pattern(){
  local pattern="$1" label="$2"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    info "Stopping $label processes matching '$pattern'..."
    pkill -f "$pattern" 2>/dev/null || true
    sleep 1
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      pkill -9 -f "$pattern" 2>/dev/null || true
    fi
    log "$label stopped."
  fi
}

kill_by_port(){
  local port="$1" label="$2"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -ti :"${port}" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

section "Stopping ForMash 3D"
kill_group_from_file "$PID_DIR/frontend.pid" "Frontend"
kill_group_from_file "$PID_DIR/backend.pid" "Backend supervisor"
kill_backend_children

# Thorough cleanup of orphan workers and processes
kill_by_pattern "uvicorn api.main_" "FastAPI workers"
kill_by_pattern "scheduler_service.py" "Scheduler service"
kill_by_pattern "next-server" "Next.js frontend"
kill_by_port 7842 "Backend port 7842"
kill_by_port 3000 "Frontend port 3000"

stop_local_redis

rm -f "$PID_DIR"/*.pid "$BACKEND_RUN_DIR"/*.pid 2>/dev/null || true
# Note: Cloudflare tunnels (.cloudflare_tunnels) are independent and intentionally preserved.
log "ForMash 3D services stopped. (Cloudflare tunnels remain active)"
