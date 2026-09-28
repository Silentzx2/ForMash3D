#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'; GRAY='\033[0;90m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'

# Load environment variables (auto-copy from .env.example if missing)
if [[ ! -f "$PROJECT_ROOT/.env" && -f "$PROJECT_ROOT/.env.example" ]]; then
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
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
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:7842}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:3000}"

banner(){
  clear 2>/dev/null || true
  printf "${CYAN}"
  cat <<'ART'

  ███████╗ ██████╗ ██████╗ ███╗   ███╗ █████╗ ███████╗██╗  ██╗   ██████╗ ██████╗ 
  ██╔════╝██╔═══██╗██╔══██╗████╗ ████║██╔══██╗██╔════╝██║  ██║   ╚════██╗██╔══██╗
  █████╗  ██║   ██║██████╔╝██╔████╔██║███████║███████╗███████║    █████╔╝██║  ██║
  ██╔══╝  ██║   ██║██╔══██╗██║╚██╔╝██║██╔══██║╚════██║██╔══██║    ╚═══██╗██║  ██║
  ██║     ╚██████╔╝██║  ██║██║ ╚═╝ ██║██║  ██║███████║██║  ██║   ██████╔╝██████╔╝
  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═════╝ ╚═════╝ 

                               SERVICE MANAGER                               
ART
  printf "${NC}\n"
}

pause(){ printf "\n${DIM}Press Enter to continue...${NC}"; read -r _ || true; }

status_badge(){
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null || true)
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      printf "${GREEN}● RUNNING${NC}"
      return
    fi
  fi
  printf "${GRAY}○ STOPPED${NC}"
}

health(){
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "$BACKEND_URL/health" >/dev/null 2>&1; then
    printf "${GREEN}● HEALTHY${NC}"
  else
    printf "${RED}● UNAVAILABLE${NC}"
  fi
}

service_pill(){
  local name="$1"
  local state="$2"
  case "$state" in
    running|ready|healthy)
      printf " [${GREEN}● ${name}${NC}]"
      ;;
    building|warning)
      printf " [${YELLOW}▲ ${name}${NC}]"
      ;;
    error|unavailable)
      printf " [${RED}✕ ${name}${NC}]"
      ;;
    *)
      printf " [${GRAY}○ ${name}${NC}]"
      ;;
  esac
}

render_status_pills(){
  local redis_state="stopped"
  if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    redis_state="ready"
  fi

  local backend_state="stopped"
  if [[ -f "$PID_DIR/backend.pid" ]]; then
    local bpid
    bpid=$(cat "$PID_DIR/backend.pid" 2>/dev/null || true)
    if [[ "$bpid" =~ ^[0-9]+$ ]] && kill -0 "$bpid" 2>/dev/null; then
      if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "$BACKEND_URL/health" >/dev/null 2>&1; then
        backend_state="healthy"
      else
        backend_state="building"
      fi
    fi
  elif command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "$BACKEND_URL/health" >/dev/null 2>&1; then
    backend_state="healthy"
  fi

  local frontend_state="stopped"
  if [[ -f "$PID_DIR/frontend.pid" ]]; then
    local fpid
    fpid=$(cat "$PID_DIR/frontend.pid" 2>/dev/null || true)
    if [[ "$fpid" =~ ^[0-9]+$ ]] && kill -0 "$fpid" 2>/dev/null; then
      frontend_state="running"
    fi
  fi

  local cf_state="stopped"
  if pgrep -f "cloudflared" >/dev/null 2>&1; then
    cf_state="running"
  fi

  printf "  Services:%s%s%s%s\n" \
    "$(service_pill "Redis" "$redis_state")" \
    "$(service_pill "Backend" "$backend_state")" \
    "$(service_pill "Frontend" "$frontend_state")" \
    "$(service_pill "Tunnel" "$cf_state")"
}

show_status(){
  banner
  printf "${WHITE}${BOLD}SYSTEM STATUS${NC}\n\n"
  printf "  ${CYAN}Frontend${NC}   %-18s  %s\n" "" "$(status_badge "$PID_DIR/frontend.pid")"
  printf "  ${CYAN}Backend${NC}    %-18s  %s\n" "" "$(status_badge "$PID_DIR/backend.pid")"
  printf "  ${CYAN}API Health${NC} %-18s  %s\n" "" "$(health)"

  if redis-cli -u "${REDIS_URL:-redis://localhost:6379/0}" ping >/dev/null 2>&1; then
    printf "  ${CYAN}Redis${NC}      %-18s  ${GREEN}● READY${NC}\n" ""
  else
    printf "  ${CYAN}Redis${NC}      %-18s  ${GRAY}○ STOPPED${NC}\n" ""
  fi

  printf "\n  ${DIM}Frontend: $FRONTEND_URL${NC}\n"
  printf "  ${DIM}Backend:  $BACKEND_URL${NC}\n"
  printf "  ${DIM}Docs:     $BACKEND_URL/docs${NC}\n"
}

# ── External tool managers ────────────────────────────────────────────────

cmd_cloudflare() {
    clear

    local script="$PROJECT_ROOT/scripts/cloudflare.sh"

    if [[ ! -f "$script" ]]; then
        echo -e "${RED}[✗]${NC} Cloudflare script not found:"
        echo "    $script"
        return 1
    fi

    chmod +x "$script"

    echo -e "${CYAN}Launching Cloudflare Tunnel Manager...${NC}"
    echo

    bash "$script"

    echo
    echo -e "${GREEN}[✓]${NC} Returned from Cloudflare manager."
}

cmd_models() {
    clear

    local script="$PROJECT_ROOT/backend/scripts/download_models.sh"

    if [[ ! -f "$script" ]]; then
        echo -e "${RED}[✗]${NC} Model manager script not found:"
        echo "    $script"
        return 1
    fi

    chmod +x "$script"

    while true; do
        banner
        printf "\t ${WHITE}${BOLD}MODEL DOWNLOAD${NC}\n\n"
        printf "  Select models to download from HuggingFace:\n\n"
        printf "  ${CYAN}[1]${NC}  PartField          - Mesh segmentation checkpoint\n"
        printf "  ${CYAN}[2]${NC}  Hunyuan3D-Shape-v2-1 - 3.3B shape model\n"
        printf "  ${CYAN}[3]${NC}  Hunyuan3D-Paint-v2-1 - PBR texture model\n"
        printf "  ${CYAN}[4]${NC}  Hunyuan3D-DiT-v2-mini-Turbo - low-VRAM shape model\n"
        printf "  ${CYAN}[5]${NC}  Hunyuan3D-2.1 Legacy - legacy integration\n"
        printf "  ${CYAN}[6]${NC}  TRELLIS            - Image-large generation model\n"
        printf "  ${CYAN}[7]${NC}  TRELLIS Text-XL    - Text-xlarge generation model (optional)\n"
        printf "  ${CYAN}[8]${NC}  TRELLIS.2-4B       - Image-based generation model\n"
        printf "  ${CYAN}[9]${NC}  P3-SAM             - Part segmentation model\n"
        printf "  ${CYAN}[10]${NC} UniRig             - Auto-rigging model\n"
        printf "  ${CYAN}[11]${NC} PartPacker         - Part packing model\n"
        printf "  ${CYAN}[12]${NC} PartUV             - UV unwrapping model\n"
        printf "  ${CYAN}[13]${NC} FastMesh           - Mesh upscaling V1K/V4K\n"
        printf "  ${CYAN}[14]${NC} UltraShape         - Shape generation model\n"
        printf "  ${CYAN}[15]${NC} Misc               - RealESRGAN, DINOv2\n"
        printf "  ${CYAN}[16]${NC} TripoSR            - Fast feedforward image-to-mesh model\n"
        printf "  ${CYAN}[17]${NC} TripoSG            - High-fidelity image-to-3D + RMBG\n"
        printf "  ${CYAN}[18]${NC} ARDY               - Motion AI / Animation checkpoints\n"
        printf "  ${CYAN}[19]${NC} TripoSF            - SparseFlex high-res arbitrary topology\n"
        printf "\n"
        printf "  ${CYAN}[a]${NC}  Download ALL models\n"
        printf "  ${CYAN}[v]${NC}  Verify existing models only\n"
        printf "  ${RED}[b]${NC}  Back\n\n"

        printf "  ${BOLD}Enter model numbers to download (comma-separated) or [a/v/b]:${NC} "
        read -r choice

        case "$choice" in
            a|A)
                echo
                echo -e "${CYAN}[INFO]${NC} Downloading ALL models..."
                bash "$script" -m all
                pause
                ;;
            v|V)
                echo
                echo -e "${CYAN}[INFO]${NC} Verifying existing models..."
                bash "$script" -v
                pause
                ;;
            b|B)
                return 0
                ;;
            *)
                if [[ -z "$choice" ]]; then
                    continue
                fi

                local models_csv=""
                local IFS=','
                for num in $choice; do
                    num=$(echo "$num" | tr -d ' ')
                    case "$num" in
                        1) models_csv="${models_csv}partfield," ;;
                        2) models_csv="${models_csv}hunyuan3d_shape_v21," ;;
                        3) models_csv="${models_csv}hunyuan3d_paint_v21," ;;
                        4) models_csv="${models_csv}hunyuan3d_dit_v2_mini_turbo," ;;
                        5) models_csv="${models_csv}hunyuan21," ;;
                        6) models_csv="${models_csv}trellis," ;;
                        7) models_csv="${models_csv}trellis-text," ;;
                        8) models_csv="${models_csv}trellis2," ;;
                        9) models_csv="${models_csv}p3sam," ;;
                        10) models_csv="${models_csv}unirig," ;;
                        11) models_csv="${models_csv}partpacker," ;;
                        12) models_csv="${models_csv}partuv," ;;
                        13) models_csv="${models_csv}fastmesh," ;;
                        14) models_csv="${models_csv}ultrashape," ;;
                        15) models_csv="${models_csv}misc," ;;
                        16) models_csv="${models_csv}triposr," ;;
                        17) models_csv="${models_csv}triposg," ;;
                        18) models_csv="${models_csv}ardy," ;;
                        19) models_csv="${models_csv}triposf," ;;
                        *)
                            echo -e "${RED}[✗]${NC} Invalid selection: $num"
                            sleep 1
                            continue 2
                            ;;
                    esac
                done
                models_csv="${models_csv%,}"

                if [[ -z "$models_csv" ]]; then
                    echo -e "${RED}[✗]${NC} No valid models selected."
                    sleep 1
                    continue
                fi

                echo
                echo -e "${CYAN}[INFO]${NC} Downloading models: ${models_csv//,/ }"
                bash "$script" -m "$models_csv"
                pause
                ;;
        esac
    done
}

run_setup(){
  banner
  bash "$PROJECT_ROOT/scripts/setup.sh"
  pause
}

run_start(){
  bash "$PROJECT_ROOT/scripts/start.sh"
  pause
}

run_stop(){
  bash "$PROJECT_ROOT/scripts/stop.sh"
  pause
}

run_restart(){
  bash "$PROJECT_ROOT/scripts/restart.sh"
  pause
}

show_logs(){
  banner
  printf "${WHITE}${BOLD}LOG VIEWER (Press Ctrl+C to return)${NC}\n\n"
  printf "  ${CYAN}[0]${NC} ${GREEN}${BOLD}ALL LOGS (Live Stream Combined)${NC}\n"
  printf "  ${CYAN}[1]${NC} Frontend (Runtime)\n"
  printf "  ${CYAN}[2]${NC} Frontend (Build log)\n"
  printf "  ${CYAN}[3]${NC} Backend (Combined / Supervisor)\n"
  printf "  ${CYAN}[4]${NC} Backend (Scheduler)\n"
  printf "  ${CYAN}[5]${NC} Backend (API Workers)\n"
  printf "  ${CYAN}[b]${NC} Back\n\n"
  printf "  ${BOLD}Select an action:${NC} "
  read -r choice

  # Ensure log files exist so tail doesn't fail
  touch "$PROJECT_ROOT/logs/frontend.log" "$PROJECT_ROOT/logs/frontend-build.log" \
        "$PROJECT_ROOT/logs/backend.log" "$PROJECT_ROOT/logs/backend-supervisor.log" \
        "$PROJECT_ROOT/backend/logs/scheduler.log" "$PROJECT_ROOT/backend/logs/api.log" 2>/dev/null || true

  case "$choice" in
    0)
      printf "\n${CYAN}[INFO]${NC} Streaming ALL logs in real time... (Press Ctrl+C to exit)\n\n"
      tail -n 30 -f \
        "$PROJECT_ROOT/logs/frontend.log" \
        "$PROJECT_ROOT/logs/frontend-build.log" \
        "$PROJECT_ROOT/logs/backend.log" \
        "$PROJECT_ROOT/backend/logs/scheduler.log" \
        "$PROJECT_ROOT/backend/logs/api.log" 2>/dev/null || true
      ;;
    1) tail -n 80 -f "$PROJECT_ROOT/logs/frontend.log" 2>/dev/null || true ;;
    2) tail -n 80 -f "$PROJECT_ROOT/logs/frontend-build.log" 2>/dev/null || true ;;
    3) tail -n 80 -f "$PROJECT_ROOT/logs/backend.log" "$PROJECT_ROOT/logs/backend-supervisor.log" 2>/dev/null || true ;;
    4) tail -n 80 -f "$PROJECT_ROOT/backend/logs/scheduler.log" "$PROJECT_ROOT/logs/scheduler.log" 2>/dev/null || true ;;
    5) tail -n 80 -f "$PROJECT_ROOT/backend/logs/api.log" "$PROJECT_ROOT/logs/api.log" 2>/dev/null || true ;;
    b|B) return 0 ;;
  esac
  pause
}

clean_runtime(){
  banner
  printf "${WHITE}${BOLD}RUNTIME CLEANUP${NC}\n\n"
  printf "  This removes generated runtime artifacts only:\n"
  printf "  ${GRAY}• logs/*.log${NC}\n"
  printf "  ${GRAY}• .pids/*.pid${NC}\n"
  printf "  ${GRAY}• .next build cache${NC}\n"
  printf "  ${GRAY}• Python __pycache__${NC}\n\n"
  read -rp "  Continue? [y/N] " answer
  [[ "${answer,,}" == "y" ]] || return 0
  bash "$PROJECT_ROOT/scripts/stop.sh" >/dev/null 2>&1 || true
  rm -f "$PROJECT_ROOT"/logs/*.log "$PROJECT_ROOT"/.pids/*.pid 2>/dev/null || true
  rm -rf "$PROJECT_ROOT/.next" 2>/dev/null || true
  find "$PROJECT_ROOT/backend" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
  find "$PROJECT_ROOT/backend" -type f -name '*.py[co]' -delete 2>/dev/null || true
  printf "\n${GREEN}✓ Runtime cleanup complete.${NC}\n"
  pause
}

main_menu(){
  while true; do
    banner
    printf "\t ${WHITE}${BOLD}CONTROL CENTER${NC}\n\n"
    printf "  ${CYAN}[0]${NC}  Setup / Install\n"
    printf "  ${CYAN}[1]${NC}  Overview / Status\n"
    printf "  ${CYAN}[2]${NC}  Start Studio\n"
    printf "  ${CYAN}[3]${NC}  Stop Studio\n"
    printf "  ${CYAN}[4]${NC}  Restart Studio\n"
    printf "  ${CYAN}[5]${NC}  View Logs\n"
    printf "  ${CYAN}[6]${NC}  Clean Runtime\n"
    printf "  ${CYAN}[7]${NC}  Cloudflare Tunnel\n"
    printf "  ${CYAN}[8]${NC}  3D Model Install\n"
    printf "  ${RED}[q]${NC}   Exit\n"

    printf "${DIM}──────────────────────────────────────────────────────────────${NC}\n"
    render_status_pills
    printf "  API %s   •   UI %s\n" "$BACKEND_URL" "$FRONTEND_URL"
    printf "${DIM}──────────────────────────────────────────────────────────────${NC}\n\n"
    printf "  ${BOLD}Select an action:${NC} "
    read -r choice
    case "$choice" in
      0) run_setup ;;
      1) show_status; pause ;;
      2) run_start ;;
      3) run_stop ;;
      4) run_restart ;;
      5) show_logs ;;
      6) clean_runtime ;;
      7) cmd_cloudflare ;;
      8) cmd_models ;;
      q|Q) printf "\n${CYAN}ForMash 3D manager closed.${NC}\n"; exit 0 ;;
      *) printf "\n${RED}Invalid option.${NC}\n"; sleep 1 ;;
    esac
  done
}

main_menu
