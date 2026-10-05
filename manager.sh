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

  local docker_state="stopped"
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
    docker_state="running"
  fi

  printf "  Services:%s%s%s%s%s\n" \
    "$(service_pill "Redis" "$redis_state")" \
    "$(service_pill "Backend" "$backend_state")" \
    "$(service_pill "Frontend" "$frontend_state")" \
    "$(service_pill "Tunnel" "$cf_state")" \
    "$(service_pill "Docker" "$docker_state")"
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
        printf "  ${CYAN}[20]${NC} Zero123++ v1.2     - Multi-view image generation model\n"
        printf "  ${CYAN}[21]${NC} Zero123++ Normals   - Normal generation ControlNet (optional)\n"
         printf "  ${CYAN}[22]${NC} VoxHammer           - Local text/image mesh editing (~40GB VRAM)\n"
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
                        20) models_csv="${models_csv}zero123plus," ;;
                        21) models_csv="${models_csv}zero123plus_normal_controlnet," ;;
                        22) models_csv="${models_csv}voxhammer," ;;
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

check_docker_cli() {
  if ! command -v docker >/dev/null 2>&1; then
    printf "${RED}[✗] Docker is not installed or not in PATH.${NC}\n"
    printf "    Please install Docker engine and nvidia-container-toolkit.\n"
    return 1
  fi
  return 0
}

docker_build() {
  banner
  printf "${WHITE}${BOLD}BUILD SINGLE DOCKER IMAGE${NC}\n\n"
  printf "  This builds the complete all-in-one image: ${CYAN}formash3d:latest${NC}\n"
  printf "  Includes: CUDA 12.4 + Conda Python 3.10 (3daigc-api) + Backend + Next.js Frontend\n\n"

  check_docker_cli || { pause; return 1; }

  mkdir -p "$PROJECT_ROOT/backend/storage" "$PROJECT_ROOT/backend/pretrained" \
           "$PROJECT_ROOT/backend/models" "$PROJECT_ROOT/backend/logs" \
           "$PROJECT_ROOT/backend/data" "$PROJECT_ROOT/backend/uploads"

  printf "${CYAN}[INFO]${NC} Starting docker build from repository root...\n"
  printf "${GRAY}Command: docker build -t formash3d:latest -f Dockerfile .${NC}\n\n"

  if docker build -t formash3d:latest -f "$PROJECT_ROOT/Dockerfile" "$PROJECT_ROOT"; then
    printf "\n${GREEN}✓ Docker image 'formash3d:latest' built successfully!${NC}\n"
    printf "  You can now run it using Option [2] or: ./manager.sh docker-run\n"
  else
    printf "\n${RED}[✗] Docker build failed.${NC}\n"
  fi
  pause
}

docker_run() {
  banner
  printf "${WHITE}${BOLD}RUN SINGLE DOCKER CONTAINER${NC}\n\n"
  check_docker_cli || { pause; return 1; }

  local image_tag="formash3d:latest"
  if ! docker image inspect "$image_tag" >/dev/null 2>&1; then
    printf "${YELLOW}[!] Image '$image_tag' not found locally.${NC}\n"
    read -rp "  Build image now? [Y/n] " ans
    if [[ "${ans,,}" != "n" ]]; then
      docker_build
    else
      return 1
    fi
  fi

  # Check if container exists
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
      printf "${YELLOW}[!] Container 'formash3d' is already running.${NC}\n"
      read -rp "  Restart container? [y/N] " rst
      if [[ "${rst,,}" == "y" ]]; then
        docker stop formash3d >/dev/null 2>&1 || true
        docker rm formash3d >/dev/null 2>&1 || true
      else
        pause
        return 0
      fi
    else
      docker rm formash3d >/dev/null 2>&1 || true
    fi
  fi

  # Determine GPU flag
  local gpu_flag="--gpus all"
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    printf "${YELLOW}[WARN] nvidia-smi not detected on host. Attempting without GPU pass-through...${NC}\n"
    gpu_flag=""
  fi

  printf "${CYAN}[INFO]${NC} Launching container 'formash3d'...\n"
  mkdir -p "$PROJECT_ROOT/backend/storage" "$PROJECT_ROOT/backend/pretrained" \
           "$PROJECT_ROOT/backend/models" "$PROJECT_ROOT/backend/logs" \
           "$PROJECT_ROOT/backend/data" "$PROJECT_ROOT/backend/uploads"

  # shellcheck disable=SC2086
  if docker run -d \
      --name formash3d \
      $gpu_flag \
      -p 3000:3000 \
      -p 7842:7842 \
      -v "$PROJECT_ROOT/backend/storage:/app/backend/storage" \
      -v "$PROJECT_ROOT/backend/pretrained:/app/backend/pretrained" \
      -v "$PROJECT_ROOT/backend/models:/app/backend/models" \
      -v "$PROJECT_ROOT/backend/logs:/app/backend/logs" \
      -v "$PROJECT_ROOT/backend/data:/app/backend/data" \
      -v "$PROJECT_ROOT/backend/uploads:/app/backend/uploads" \
      -v "$PROJECT_ROOT/backend/config:/app/backend/config" \
      "$image_tag"; then
    printf "\n${GREEN}✓ Container 'formash3d' launched successfully!${NC}\n\n"
    printf "  ${BOLD}Studio Web UI:${NC}    ${CYAN}http://localhost:3000${NC}\n"
    printf "  ${BOLD}Backend API:${NC}      ${CYAN}http://localhost:7842${NC}\n"
    printf "  ${BOLD}Swagger Docs:${NC}     ${CYAN}http://localhost:7842/docs${NC}\n"
    printf "  ${BOLD}Interactive Shell:${NC} docker exec -it formash3d bash\n"
  else
    printf "\n${RED}[✗] Failed to start Docker container.${NC}\n"
  fi
  pause
}

docker_stop() {
  banner
  printf "${WHITE}${BOLD}STOP DOCKER CONTAINER${NC}\n\n"
  check_docker_cli || { pause; return 1; }

  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
    printf "${CYAN}[INFO]${NC} Stopping container 'formash3d'...\n"
    docker stop formash3d >/dev/null 2>&1 || true
    docker rm formash3d >/dev/null 2>&1 || true
    printf "${GREEN}✓ Container 'formash3d' stopped and removed.${NC}\n"
  else
    printf "${GRAY}No running 'formash3d' container found.${NC}\n"
  fi
  pause
}

docker_logs() {
  check_docker_cli || { pause; return 1; }
  banner
  printf "${WHITE}${BOLD}CONTAINER LOGS (Press Ctrl+C to return)${NC}\n\n"
  docker logs -f formash3d 2>&1 || {
    printf "${RED}[✗] Could not fetch logs. Is 'formash3d' running?${NC}\n"
    pause
  }
}

docker_shell() {
  check_docker_cli || { pause; return 1; }
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
    printf "${RED}[✗] Container 'formash3d' is not running. Start it first with Option [2].${NC}\n"
    pause
    return 1
  fi
  printf "\n${CYAN}[INFO]${NC} Entering container shell (Conda 3daigc-api active)... Type 'exit' to return.\n\n"
  docker exec -it formash3d /bin/bash
}

docker_compose_up() {
  banner
  printf "${WHITE}${BOLD}DOCKER COMPOSE DEPLOYMENT${NC}\n\n"
  check_docker_cli || { pause; return 1; }

  printf "${CYAN}[INFO]${NC} Running docker compose up --build -d...\n"
  if docker compose -f "$PROJECT_ROOT/docker-compose.yml" up --build -d; then
    printf "\n${GREEN}✓ Docker compose services launched!${NC}\n"
    printf "  Web UI: http://localhost:3000\n"
    printf "  API:    http://localhost:7842\n"
  else
    printf "\n${RED}[✗] Docker compose failed.${NC}\n"
  fi
  pause
}

docker_export() {
  banner
  printf "${WHITE}${BOLD}EXPORT / PACKAGE DOCKER IMAGE FOR OTHER MACHINE${NC}\n\n"
  check_docker_cli || { pause; return 1; }

  local archive_path="$PROJECT_ROOT/formash3d_image.tar.gz"
  printf "  This will save and compress 'formash3d:latest' (including Conda env,\n"
  printf "  CUDA runtime, model libraries, and Next.js UI) into an archive file:\n"
  printf "  ${CYAN}%s${NC}\n\n" "$archive_path"
  read -rp "  Proceed with export? [y/N] " ans
  [[ "${ans,,}" == "y" ]] || return 0

  printf "\n${CYAN}[INFO]${NC} Exporting and compressing image... (this may take a few minutes)\n"
  if docker save formash3d:latest | gzip > "$archive_path"; then
    printf "\n${GREEN}✓ Export completed successfully!${NC}\n"
    printf "  Archive saved at: %s (%s)\n\n" "$archive_path" "$(du -h "$archive_path" | cut -f1)"
    printf "  ${BOLD}How to run on another machine:${NC}\n"
    printf "  1. Copy %s to your new machine.\n" "$(basename "$archive_path")"
    printf "  2. Run: ${CYAN}docker load < %s${NC}\n" "$(basename "$archive_path")"
    printf "  3. Start: ${CYAN}docker run -d --gpus all -p 3000:3000 -p 7842:7842 formash3d:latest${NC}\n"
  else
    printf "\n${RED}[✗] Image export failed.${NC}\n"
  fi
  pause
}

cmd_docker() {
  while true; do
    banner
    printf "\t ${WHITE}${BOLD}DOCKER CONTAINER & ENGINE MANAGER${NC}\n\n"
    printf "  ${GRAY}Single All-in-One Image with Conda (3daigc-api) + GPU Backend + Frontend${NC}\n\n"

    local docker_installed="no"
    local container_state="stopped"
    if command -v docker >/dev/null 2>&1; then
      docker_installed="yes"
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
        container_state="running"
      elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^formash3d$"; then
        container_state="created"
      fi
    fi

    printf "  Docker Status: "
    if [[ "$docker_installed" == "yes" ]]; then
      printf "${GREEN}Installed${NC}"
    else
      printf "${RED}Not Installed${NC}"
    fi
    printf "   Container: "
    if [[ "$container_state" == "running" ]]; then
      printf "${GREEN}● RUNNING${NC}\n\n"
    elif [[ "$container_state" == "created" ]]; then
      printf "${YELLOW}▲ STOPPED${NC}\n\n"
    else
      printf "${GRAY}○ NOT CREATED${NC}\n\n"
    fi

    printf "  ${CYAN}[1]${NC}  Build Single Docker Image (${BOLD}formash3d:latest${NC})\n"
    printf "  ${CYAN}[2]${NC}  Run Container with GPU (${BOLD}3000 + 7842${NC})\n"
    printf "  ${CYAN}[3]${NC}  Stop & Remove Container\n"
    printf "  ${CYAN}[4]${NC}  View Live Container Logs\n"
    printf "  ${CYAN}[5]${NC}  Shell into Container (with Conda active)\n"
    printf "  ${CYAN}[6]${NC}  Run with Docker Compose (Single Service)\n"
    printf "  ${CYAN}[7]${NC}  Export/Package Docker Image for Other Machine (.tar.gz)\n"
    printf "  ${CYAN}[b]${NC}  Back to Main Menu\n\n"

    read -rp "  Select an action: " dchoice
    case "$dchoice" in
      1) docker_build ;;
      2) docker_run ;;
      3) docker_stop ;;
      4) docker_logs ;;
      5) docker_shell ;;
      6) docker_compose_up ;;
      7) docker_export ;;
      b|B) return 0 ;;
      *) printf "\n${RED}Invalid option.${NC}\n"; sleep 1 ;;
    esac
  done
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
    printf "  ${CYAN}[9]${NC}  Docker Engine (Single All-in-One Image)\n"
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
      9) cmd_docker ;;
      q|Q) printf "\n${CYAN}ForMash 3D manager closed.${NC}\n"; exit 0 ;;
      *) printf "\n${RED}Invalid option.${NC}\n"; sleep 1 ;;
    esac
  done
}

# CLI argument handling
if [[ $# -gt 0 ]]; then
  case "$1" in
    docker) cmd_docker ;;
    docker-build|build-docker) docker_build ;;
    docker-run|run-docker) docker_run ;;
    docker-stop|stop-docker) docker_stop ;;
    docker-logs|logs-docker) docker_logs ;;
    docker-shell|shell-docker) docker_shell ;;
    docker-export|export-docker) docker_export ;;
    start) run_start ;;
    stop) run_stop ;;
    restart) run_restart ;;
    status) show_status ;;
    logs) show_logs ;;
    models) cmd_models ;;
    setup) run_setup ;;
    *) echo "Usage: $0 {start|stop|restart|status|logs|models|docker|docker-build|docker-run|docker-stop|docker-logs|docker-shell|docker-export}"; exit 1 ;;
  esac
  exit 0
fi

main_menu
