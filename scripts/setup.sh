#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; WHITE='\033[1;37m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'

log(){ printf "${GREEN}[SETUP]${NC} %s\n" "$*"; }
info(){ printf "${CYAN}[INFO]${NC}  %s\n" "$*"; }
warn(){ printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
fail(){ printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; exit 1; }
# Load .env if present
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Parse command line flags
AUTO_MODE=0
SKIP_CUDA=0
ENV_MANAGER="${FORMASH3D_ENV_MANAGER:-conda}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto|-auto|-y|--yes|--non-interactive)
      AUTO_MODE=1
      export NONINTERACTIVE=1
      shift
      ;;
    --skip-cuda)
      SKIP_CUDA=1
      shift
      ;;
    --conda)
      ENV_MANAGER="conda"
      export FORMASH3D_ENV_MANAGER="conda"
      shift
      ;;
    --venv)
      ENV_MANAGER="venv"
      export FORMASH3D_ENV_MANAGER="venv"
      shift
      ;;
    --env-manager=*)
      ENV_MANAGER="${1#*=}"
      export FORMASH3D_ENV_MANAGER="$ENV_MANAGER"
      shift
      ;;
    --env-manager)
      ENV_MANAGER="$2"
      export FORMASH3D_ENV_MANAGER="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

section(){ printf "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${WHITE}${BOLD}  %s${NC}\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n" "$*"; }

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

                         3D GENERATIVE STUDIO
ART
  printf "${NC}\n"
}



require_commands(){
  section "Environment Check"
  local missing=()
  for cmd in git curl python3; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if ((${#missing[@]})); then
    fail "Missing required commands: ${missing[*]}"
  fi
  log "Git: $(git --version)"
  log "Python: $(python3 --version 2>&1)"
  log "Curl: available"

  if command -v nvidia-smi >/dev/null 2>&1; then
    log "GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
  else
    warn "nvidia-smi not found. 3D AI generation requires a compatible NVIDIA runtime."
  fi
}
detect_gpu() {
  echo "GPU Detection"
  GPU_AVAILABLE=false
  GPU_NAME=""
  CUDA_VERSION=""

  # Testing mode: simulate CUDA presence
  if [[ "${CUDA_FORCE_PRESENT:-}" == "1" ]]; then
    GPU_NAME="Simulated GPU (TEST_MODE)"
    GPU_AVAILABLE=true
    CUDA_VERSION="${CUDA_FORCE_VERSION:-124}"
    log "GPU detected : ${CYAN}${GPU_NAME}${NC}"
    log "CUDA (test) : cu${CUDA_VERSION}"
    return 0
  fi

  if command -v nvidia-smi &>/dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)
    if [[ -n "$GPU_NAME" ]]; then
      GPU_AVAILABLE=true
      DRIVER_VER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo "unknown")
      log "GPU detected : ${CYAN}${GPU_NAME}${NC}"
      log "Driver       : $DRIVER_VER"
    fi
  fi

  # Detect CUDA version: driver first (more reliable), nvcc fallback
  # ponytail: driver version determines max supported CUDA toolkit version.
  # Newer drivers support newer CUDA — don't cap, pass through to PyTorch.
  if command -v nvidia-smi &>/dev/null; then
    DRIVER_MAJOR=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 | awk -F. '{print $1}')
    if [[ -n "$DRIVER_MAJOR" ]]; then
      if [[ "$DRIVER_MAJOR" -ge 570 ]]; then
        CUDA_VERSION="128"
      elif [[ "$DRIVER_MAJOR" -ge 560 ]]; then
        CUDA_VERSION="126"
      elif [[ "$DRIVER_MAJOR" -ge 550 ]]; then
        CUDA_VERSION="124"
      elif [[ "$DRIVER_MAJOR" -ge 535 ]]; then
        CUDA_VERSION="121"
      elif [[ "$DRIVER_MAJOR" -ge 525 ]]; then
        CUDA_VERSION="118"
      else
        CUDA_VERSION="121"
      fi
      log "CUDA (from driver): ${CYAN}cu${CUDA_VERSION}${NC}"
    fi
  fi

  # Fallback: check nvcc if driver detection failed
  if [[ -z "$CUDA_VERSION" ]] && command -v nvcc &>/dev/null; then
    CUDA_FULL=$(nvcc --version 2>/dev/null | grep "release" | sed 's/.*release //' | sed 's/,.*//')
    if [[ -n "$CUDA_FULL" ]]; then
      CUDA_VERSION=$(echo "$CUDA_FULL" | awk -F. '{print $1$2}')
      log "CUDA toolkit : ${CYAN}${CUDA_FULL}${NC}"
    fi
  fi

  if [[ "$GPU_AVAILABLE" == "false" ]]; then
    warn "No NVIDIA GPU detected — AI inference requires CUDA-capable hardware."
    warn "The stack will start, but generation jobs will fail without a GPU."
    if [[ "${REQUIRE_GPU:-}" == "1" ]]; then
      fail "REQUIRE_GPU=1 is set — aborting without GPU."
      exit 1
    fi
    if [[ -t 0 ]] && [[ "${CI:-}" != "true" ]] && [[ "${NONINTERACTIVE:-}" != "1" ]] && [[ "${AUTO_MODE:-0}" != "1" ]]; then
      read -rp "  Continue without GPU? [y/N] " choice
      if [[ "${choice,,}" != "y" ]]; then
        fail "Aborting. Install an NVIDIA GPU + driver and re-run."
        exit 1
      fi
    else
      warn "Non-interactive environment detected — proceeding with CPU fallback."
      warn "Generation jobs will fail without a GPU."
    fi
  fi
}

# ── Clean up conflicting CUDA APT sources ──────────────────────────────────
_sanitize_apt_cuda_sources() {
  if [[ "${SKIP_CUDA:-0}" == "1" ]]; then
    return 0
  fi
  # Remove duplicate/conflicting NVIDIA repository lists that cause APT "Conflicting values set for option Signed-By"
  rm -f /etc/apt/sources.list.d/*cuda*.list \
        /etc/apt/sources.list.d/*nvidia*.list \
        /etc/apt/sources.list.d/*cuda*.sources \
        /etc/apt/sources.list.d/*nvidia*.sources 2>/dev/null || true
  if [[ -f /etc/apt/sources.list ]]; then
    sed -i '/developer\.download\.nvidia\.com/d' /etc/apt/sources.list 2>/dev/null || true
  fi
  for src in /etc/apt/sources.list.d/*.sources; do
    if [[ -f "$src" ]] && grep -q "developer.download.nvidia.com" "$src" 2>/dev/null; then
      sed -i '/developer\.download\.nvidia\.com/d' "$src" 2>/dev/null || true
    fi
  done
  for lst in /etc/apt/sources.list.d/*.list; do
    if [[ -f "$lst" ]] && grep -q "developer.download.nvidia.com" "$lst" 2>/dev/null; then
      sed -i '/developer\.download\.nvidia\.com/d' "$lst" 2>/dev/null || true
    fi
  done
}


setup_cuda_124() {
  echo "CUDA Toolkit 12.4 — Detection & Installation"

  if [[ "${SKIP_CUDA:-0}" == "1" ]]; then
    log "Skipping CUDA installation (--skip-cuda specified; using system/container CUDA)."
    setup_cuda_env
    return 0
  fi

  # ── Detect NVIDIA driver ──────────────────────────────────────────────────
  local DRIVER_VER=""
  if command -v nvidia-smi &>/dev/null; then
    DRIVER_VER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || true)
    log "NVIDIA driver: ${CYAN}${DRIVER_VER}${NC}"
  else
    warn "nvidia-smi not found — skipping CUDA setup"
    return 0
  fi

  # Check driver supports CUDA 12.4 (requires >= 525.60.13)
  local DRIVER_MAJOR
  DRIVER_MAJOR=$(echo "$DRIVER_VER" | awk -F. '{print $1}')
  if [[ -n "$DRIVER_MAJOR" ]] && [[ "$DRIVER_MAJOR" -lt 525 ]]; then
    err "NVIDIA driver ${DRIVER_VER} is too old for CUDA 12.4 (requires >= 525.60.13)"
    err "Please update your NVIDIA driver: https://www.nvidia.com/drivers"
    return 1
  fi

  # ── If CUDA 12.4 is already installed, just make it the default ──────────
  if [[ -d "/usr/local/cuda-12.4" ]] && [[ -x "/usr/local/cuda-12.4/bin/nvcc" ]]; then
    _cuda_make_default
    setup_cuda_env
    log "CUDA 12.4 is active and set as default (/usr/local/cuda → /usr/local/cuda-12.4)"
    return 0
  fi

  # ── Detect any existing CUDA version ─────────────────────────────────────
  local current_cuda=""
  if command -v nvcc &>/dev/null; then
    current_cuda=$(nvcc --version 2>/dev/null | grep release | sed 's/.*release //;s/,.*//' || echo "")
  elif [[ -x "/usr/local/cuda/bin/nvcc" ]]; then
    current_cuda=$(/usr/local/cuda/bin/nvcc --version 2>/dev/null | grep release | sed 's/.*release //;s/,.*//' || echo "")
  fi
  if [[ -n "$current_cuda" && "$current_cuda" != *"12.4"* ]]; then
    warn "Current system CUDA is ${current_cuda} — installing CUDA 12.4 and making it default..."
  else
    info "CUDA 12.4 toolkit not found on disk — installing CUDA 12.4..."
  fi

  # ── Add NVIDIA CUDA apt repo and install toolkit ─────────────────────────
  local ubuntu_ver repo_ver
  ubuntu_ver=$(lsb_release -rs 2>/dev/null | tr -d '.' || echo "2204")
  repo_ver="$ubuntu_ver"
  if [[ "$ubuntu_ver" -ge 2404 ]]; then
    repo_ver="2204"
  elif [[ "$ubuntu_ver" -lt 2004 ]]; then
    repo_ver="2004"
  fi

  _sanitize_apt_cuda_sources
  echo "deb [trusted=yes] https://developer.download.nvidia.com/compute/cuda/repos/ubuntu${repo_ver}/x86_64/ /" \
    | sudo tee /etc/apt/sources.list.d/cuda-12-4.list >/dev/null 2>&1 || true
  sudo apt-get update -qq 2>/dev/null || true

  info "Installing CUDA 12.4 packages (cuda-toolkit-12-4, nvcc, cusparse)..."
  sudo apt-get install -y --no-install-recommends cuda-toolkit-12-4 2>/dev/null || \
  sudo apt-get install -y --no-install-recommends cuda-nvcc-12-4 cuda-cudart-dev-12-4 \
    libcublas-dev-12-4 libcusparse-dev-12-4 libcusolver-dev-12-4 libcufft-dev-12-4 2>/dev/null || {
    warn "Direct apt-get install of CUDA 12.4 had warnings; continuing..."
  }
  sudo rm -f /etc/apt/sources.list.d/cuda-12-4.list 2>/dev/null || true

  # ── Make /usr/local/cuda default symlink to /usr/local/cuda-12.4 ─────────
  if [[ -d "/usr/local/cuda-12.4" ]]; then
    _cuda_make_default
    log "CUDA 12.4 successfully installed and set as default (/usr/local/cuda → /usr/local/cuda-12.4)"
  else
    warn "CUDA 12.4 directory not found after install — toolkit may have failed"
  fi

  setup_cuda_env
}

_cuda_make_default() {
  if [[ -L /usr/local/cuda ]]; then
    sudo rm -f /usr/local/cuda 2>/dev/null || true
  elif [[ -d /usr/local/cuda ]]; then
    sudo mv /usr/local/cuda "/usr/local/cuda-backup-$(date +%s)" 2>/dev/null || true
  fi
  sudo ln -sf /usr/local/cuda-12.4 /usr/local/cuda 2>/dev/null || true
}

setup_cuda_env() {
  local nproc_count
  nproc_count=$(nproc 2>/dev/null || echo 4)
  export MAX_JOBS="$nproc_count"
  export CMAKE_BUILD_PARALLEL_LEVEL="$nproc_count"
  export CMAKE_GENERATOR="Ninja"
  export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-7.5;8.0;8.6;8.9;9.0+PTX}"

  if [[ -d "/usr/local/cuda-12.4" ]]; then
    export CUDA_HOME="/usr/local/cuda-12.4"
    export PATH="/usr/local/cuda-12.4/bin:${PATH}"
    export LD_LIBRARY_PATH="/usr/local/cuda-12.4/lib64:${LD_LIBRARY_PATH:-}"
  elif [[ -d "/usr/local/cuda" ]]; then
    export CUDA_HOME="/usr/local/cuda"
    export PATH="/usr/local/cuda/bin:${PATH}"
    export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}"
  fi

  if [[ -n "${CUDA_HOME:-}" && -d "${CUDA_HOME}/include" ]]; then
    export CPATH="${CUDA_HOME}/include:${CPATH:-}"
  fi
}
ensure_redis(){
  section "Redis Installation"
  if ! command -v redis-server >/dev/null 2>&1 || ! command -v redis-cli >/dev/null 2>&1; then
    info "Installing Redis server and tools..."
    local sudo_cmd=""
    command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
    if command -v apt-get >/dev/null 2>&1; then
      $sudo_cmd apt-get update -qq 2>/dev/null || true
      $sudo_cmd apt-get install -y --no-install-recommends redis-server redis-tools 2>/dev/null || true
    fi
  fi

  # Start Redis service (supports Colab/Docker containers and standard VPS)
  if command -v service >/dev/null 2>&1; then
    service redis-server start >/dev/null 2>&1 || true
  elif command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start redis-server >/dev/null 2>&1 || true
  elif command -v redis-server >/dev/null 2>&1; then
    redis-server --daemonize yes --bind 127.0.0.1 --port 6379 >/dev/null 2>&1 || true
  fi

  if command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1; then
    log "Redis installed & running (port 6379)."
  elif command -v redis-server >/dev/null 2>&1; then
    log "Redis package installed: $(redis-server --version | head -1)"
  else
    warn "Redis installation could not be completed automatically."
  fi
}

# ── Frontend runtime version lock ─────────────────────────────────
# Locked runtime versions. Must stay in sync with package.json
# "engines" and the "_runtime" metadata field.
REQUIRED_NODE_VERSION="24.21.0"
REQUIRED_NPM_VERSION="11.19.0"
REQUIRED_BUN_VERSION="1.4.2"
NODE_RUNTIME_DIR="${FORMASH3D_NODE_RUNTIME_DIR:-$HOME/.formash3d/node}"

_ensure_node_version() {
  local current=""
  if command -v node >/dev/null 2>&1; then
    current=$(node --version 2>/dev/null | sed 's/^v//' || true)
  fi
  if [[ "$current" == "$REQUIRED_NODE_VERSION" ]]; then
    log "Node: v${current} (locked version active)"
    return 0
  fi
  if [[ -n "$current" ]]; then
    warn "Node v${current} found — locked version is v${REQUIRED_NODE_VERSION}. Installing locked version..."
  else
    info "Node not found — installing locked version v${REQUIRED_NODE_VERSION}..."
  fi
  local arch os tarball url staging
  os="linux"
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "Unsupported architecture for locked Node install: $arch" ;;
  esac
  tarball="node-v${REQUIRED_NODE_VERSION}-${os}-${arch}.tar.xz"
  url="https://nodejs.org/dist/v${REQUIRED_NODE_VERSION}/${tarball}"
  mkdir -p "$NODE_RUNTIME_DIR"
  staging="$(mktemp -d)"
  if ! curl -fsSL --retry 3 -o "$staging/$tarball" "$url"; then
    tarball="node-v${REQUIRED_NODE_VERSION}-${os}-${arch}.tar.gz"
    url="https://nodejs.org/dist/v${REQUIRED_NODE_VERSION}/${tarball}"
    curl -fsSL --retry 3 -o "$staging/$tarball" "$url" || {
      rm -rf "$staging"
      fail "Failed to download Node v${REQUIRED_NODE_VERSION} from ${url}"
    }
  fi
  if [[ "$tarball" == *.xz ]]; then
    tar -xJf "$staging/$tarball" -C "$staging"
  else
    tar -xzf "$staging/$tarball" -C "$staging"
  fi
  rm -rf "${NODE_RUNTIME_DIR}/current"
  mv "$staging/node-v${REQUIRED_NODE_VERSION}-${os}-${arch}" "${NODE_RUNTIME_DIR}/current"
  rm -rf "$staging"
  export PATH="${NODE_RUNTIME_DIR}/current/bin:${PATH}"
  hash -r
  local verify
  verify=$(node --version 2>/dev/null | sed 's/^v//' || true)
  if [[ "$verify" == "$REQUIRED_NODE_VERSION" ]]; then
    log "Node v${REQUIRED_NODE_VERSION} installed at ${NODE_RUNTIME_DIR}/current and forced on PATH."
    return 0
  fi
  fail "Node v${REQUIRED_NODE_VERSION} installation failed verification (found: ${verify:-none}). Aborting."
}

_ensure_npm_version() {
  local current=""
  if command -v npm >/dev/null 2>&1; then
    current=$(npm --version 2>/dev/null || true)
  fi
  if [[ "$current" == "$REQUIRED_NPM_VERSION" ]]; then
    log "npm: v${current} (locked version active)"
    return 0
  fi
  warn "npm ${current:-none} found — locked version is v${REQUIRED_NPM_VERSION}. Installing locked version..."
  local sudo_cmd=""
  command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
  $sudo_cmd npm install -g "npm@${REQUIRED_NPM_VERSION}" >/dev/null 2>&1 \
    || warn "npm self-upgrade to v${REQUIRED_NPM_VERSION} failed (permission issue; try running with sudo). Continuing..."
  hash -r
  local verify
  verify=$(npm --version 2>/dev/null || echo 'unknown')
  if [[ "$verify" == "$REQUIRED_NPM_VERSION" ]]; then
    log "npm: v${verify} (locked version active)"
    return 0
  fi
  fail "npm v${REQUIRED_NPM_VERSION} could not be enforced (found: ${verify:-none}). Aborting."
}

_ensure_bun_version() {
  local current=""
  if command -v bun >/dev/null 2>&1; then
    current=$(bun --version 2>/dev/null || true)
  fi
  if [[ "$current" == "$REQUIRED_BUN_VERSION" ]]; then
    log "Bun: v${current} (locked version active)"
    return 0
  fi
  if [[ -n "$current" ]]; then
    warn "Bun v${current} found — locked version is v${REQUIRED_BUN_VERSION}. Installing locked version..."
  else
    info "Bun not found — installing locked version v${REQUIRED_BUN_VERSION}..."
  fi
  if curl -fsSL https://bun.sh/install | bash -s "bun-v${REQUIRED_BUN_VERSION}" >/dev/null 2>&1; then
    BUN_INSTALL_DIR="${BUN_INSTALL:-$HOME/.bun}"
    [[ -d "$BUN_INSTALL_DIR/bin" ]] && export PATH="$BUN_INSTALL_DIR/bin:$PATH"
    hash -r
  fi
  current=$(bun --version 2>/dev/null || true)
  if [[ "$current" == "$REQUIRED_BUN_VERSION" ]]; then
    command -v sudo >/dev/null 2>&1 && sudo ln -sf "$(command -v bun)" /usr/local/bin/bun 2>/dev/null || ln -sf "$(command -v bun)" /usr/local/bin/bun 2>/dev/null || true
    log "Bun v${REQUIRED_BUN_VERSION} installed and forced."
    return 0
  fi
  fail "Bun v${REQUIRED_BUN_VERSION} could not be enforced (found: ${current:-none}). Aborting."
}

ensure_bun_or_npm(){
  section "Frontend Toolchain (locked: Node v${REQUIRED_NODE_VERSION} / npm v${REQUIRED_NPM_VERSION} / Bun v${REQUIRED_BUN_VERSION})"
  _ensure_node_version
  _ensure_npm_version
  _ensure_bun_version
  if ! command -v bun >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; then
    fail "Neither Bun nor npm is available after runtime lock enforcement. Install Node v${REQUIRED_NODE_VERSION} or Bun v${REQUIRED_BUN_VERSION} and rerun setup."
  fi
}

ensure_uv(){
  section "Python Toolchain"
  export PATH="$HOME/.local/bin:$PATH"
  if command -v uv >/dev/null 2>&1; then
    log "uv: $(uv --version)"
    return 0
  fi
  info "uv not found. Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null 2>&1 || fail "uv installation completed but uv is not on PATH."
  log "uv: $(uv --version)"
}

create_directories(){
  section "Preparing Project Directories"
  mkdir -p \
    "$PROJECT_ROOT/logs" \
    "$PROJECT_ROOT/.pids" \
    "$PROJECT_ROOT/backend/storage/uploads" \
    "$PROJECT_ROOT/backend/storage/models" \
    "$PROJECT_ROOT/backend/storage/thumbnails" \
    "$PROJECT_ROOT/backend/storage/images" \
    "$PROJECT_ROOT/backend/.hf_cache/hub" \
    "$PROJECT_ROOT/backend/.runtime_cache" 

  if [[ ! -f "$PROJECT_ROOT/.env" && -f "$PROJECT_ROOT/.env.example" ]]; then
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    log "Created .env from .env.example"
  fi

  log "Project runtime directories are ready."
}

# wheels downloading
download_release_wheels() {
    local WHEELS_DIR="${1:-$PROJECT_ROOT/backend/thirdparty/wheels}"
    local API="https://api.github.com/repos/Silentzx2/ForMash3D/releases/tags/Wheels"

    mkdir -p "$WHEELS_DIR" || return 1

    echo "→ Downloading wheels to: $WHEELS_DIR"

    local release_json
    release_json=$(curl -fsSL -H "User-Agent: ForMash3D-Installer" "$API" 2>/dev/null || echo "")
    if [[ -z "$release_json" ]]; then
        echo "[WARN] Could not fetch release wheels list from GitHub API; continuing..."
        return 0
    fi

    echo "$release_json" |
        jq -r '.assets[]? | select(.name | endswith(".whl")) |
               [.name, .browser_download_url] | @tsv' 2>/dev/null |
        while IFS=$'\t' read -r NAME URL; do
            [[ -z "$NAME" || -z "$URL" ]] && continue
            local FILE="$WHEELS_DIR/$NAME"

            if [[ -f "$FILE" && -s "$FILE" ]]; then
                echo "✓ Exists: $NAME"
                continue
            fi

            echo "↓ Downloading: $NAME"
            curl -fL --retry 3 -o "$FILE" "$URL" 2>/dev/null || {
                echo "✗ Failed: $NAME"
                rm -f "$FILE"
                continue
            }
        done || true

    echo "✓ Release wheels check completed in $WHEELS_DIR"
}

# Compatibility alias
download_and_install_release_wheels() {
    download_release_wheels "$@"
}

build_deps () {
  # ── Fast build toolchain ────────────────────────────────────────────────────
  # System-level ninja (apt) as a fallback: the pip `ninja` package only lands a
  # binary in the active env's bin/, so if a downstream subprocess runs with a
  # different PATH (e.g. TRELLIS.2's bare `pip`), `ninja` may not resolve. The
  # apt package puts a native binary in /usr/bin/ninja — always on PATH.
  if ! command -v ninja >/dev/null 2>&1; then
      echo "[INFO] ninja not on PATH — installing ninja-build via apt..."
      sudo apt-get update -qq 2>/dev/null || true
      sudo apt-get install -y --no-install-recommends ninja-build 2>/dev/null || \
          echo "[WARN] apt ninja-build install failed; relying on pip ninja."
  fi
  command -v ninja >/dev/null 2>&1 && echo "[SUCCESS] ninja: $(ninja --version 2>/dev/null || echo 'available')" || \
      echo "[WARN] ninja still not resolvable on PATH"

  # Export build parallelism for every downstream subprocess (TRELLIS.2 setup.sh,
  # nvdiffrec, cubvh, bpy-renderer, etc.). These are read by cmake/setuptools.
  export MAX_JOBS="${MAX_JOBS:-$(nproc 2>/dev/null || echo 4)}"
  export CMAKE_BUILD_PARALLEL_LEVEL="$MAX_JOBS"
  export CMAKE_GENERATOR="${CMAKE_GENERATOR:-Ninja}"
  export CMAKE_ARGS="-G Ninja -DCMAKE_BUILD_PARALLEL_LEVEL=$MAX_JOBS"
  export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-7.5;8.0;8.6;8.9;9.0+PTX}"
  echo "[INFO] Build parallelism: MAX_JOBS=$MAX_JOBS  CMAKE_GENERATOR=$CMAKE_GENERATOR"
}

install_frontend_deps(){
  section "Installing Frontend Dependencies"
  BUN_INSTALL_DIR="${BUN_INSTALL:-$HOME/.bun}"
  [[ -d "$BUN_INSTALL_DIR/bin" ]] && export PATH="$BUN_INSTALL_DIR/bin:$PATH"

  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile || bun install
    log "Frontend dependencies installed with Bun."
    info "Building Next.js frontend with Bun..."
    bun run build || warn "Frontend build will be performed on start."
  else
    npm ci || npm install
    log "Frontend dependencies installed with npm."
    info "Building Next.js frontend with npm..."
    npm run build || warn "Frontend build will be performed on start."
  fi
}

install_backend(){
  section "Backend Installation"
  log "Delegating Python env creation + backend install to backend/scripts/install.sh..."
  cd "$PROJECT_ROOT/backend"
  local install_flags=()
  if [[ "${AUTO_MODE:-0}" == "1" || "${NONINTERACTIVE:-0}" == "1" ]]; then
    install_flags+=("--auto")
  fi
  if [[ -n "${ENV_MANAGER:-}" ]]; then
    install_flags+=("--env-manager" "$ENV_MANAGER")
  fi
  bash scripts/install.sh "${install_flags[@]}"
  log "Backend dependency installation completed."
}

summary(){
  section "Setup Complete"
  printf "${WHITE}${BOLD}  ForMash 3D is prepared.${NC}\n\n"
  printf "  ${DIM}Frontend:${NC}  http://localhost:3000\n"
  printf "  ${DIM}Backend:${NC}   http://localhost:7842\n"
  printf "  ${DIM}Docs:${NC}      http://localhost:7842/docs\n"
  printf "  ${DIM}Health:${NC}    http://localhost:7842/health\n\n"
  printf "  ${GREEN}Next:${NC} bash scripts/start.sh\n"
  printf "  ${GREEN}Stop:${NC} bash scripts/stop.sh\n"
  printf "  ${GREEN}Manage:${NC} bash manager.sh\n\n"
}

banner
printf "${WHITE}${BOLD}Setup overview${NC}\n"
printf "  This setup prepares the existing project in this order:\n"
printf "  01. Environment check\n"
printf "  02. Create runtime/storage directories\n"
printf "  03. Download prebuilt release wheels\n"
printf "  04. Install frontend dependencies\n"
printf "  05. Run backend/scripts/install.sh\n\n"


require_commands
detect_gpu
_sanitize_apt_cuda_sources
setup_cuda_124
ensure_bun_or_npm
ensure_uv
ensure_redis
create_directories

download_release_wheels
build_deps
install_frontend_deps

install_backend
summary
