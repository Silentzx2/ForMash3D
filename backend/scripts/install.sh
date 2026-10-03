#!/bin/bash

UV_PIP="uv pip"

# Project root (install.sh lives in backend/scripts/)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WHEEL_DIR="$PROJECT_ROOT/backend/thirdparty/wheels"
THIRDPARTY_DIR="$PROJECT_ROOT/backend/thirdparty"

# Load .env if present
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Parse command line flags
AUTO_MODE=0
ENV_MANAGER="${FORMASH3D_ENV_MANAGER:-${AI_STUDIO_ENV_MANAGER:-conda}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto|-auto|-y|--yes|--non-interactive)
      AUTO_MODE=1
      export NONINTERACTIVE=1
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

# Test whether a wheel file exists and is a valid non-corrupted zip/wheel
_wheel_is_valid() {
    local whl="$1"
    [ -f "$whl" ] || return 1
    if command -v unzip >/dev/null 2>&1; then
        unzip -tqq "$whl" >/dev/null 2>&1
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import zipfile, sys; zipfile.ZipFile(sys.argv[1]).testzip()" "$whl" >/dev/null 2>&1
    else
        [ -s "$whl" ]
    fi
}

# Retry a command up to N times with a delay between attempts.
# Usage: _retry 3 5 <command> [args...]
_retry() {
    local max="${1:-3}"
    local delay="${2:-5}"
    shift 2
    local n=1
    while true; do
        if "$@"; then
            return 0
        fi
        if [ "$n" -ge "$max" ]; then
            return 1
        fi
        echo "[WARN] Command failed (attempt $n/$max). Retrying in ${delay}s..."
        sleep "$delay"
        n=$((n+1))
    done
}

# Normal dependency install: local compatible wheels first, then the
# existing configured package index.
uv_install() {
    if [ -d "$WHEEL_DIR" ]; then
        $UV_PIP install --find-links="$WHEEL_DIR" "$@"
    else
        $UV_PIP install "$@"
    fi
}

# Install one matching local wheel if available and valid.
# Returns 0 if installed, 1 if no valid matching wheel exists.
install_local_wheel() {
    local pattern="$1"
    local label="$2"
    local wheel=""

    if [ -d "$WHEEL_DIR" ]; then
        wheel="$(find "$WHEEL_DIR" -maxdepth 1 -type f -name "$pattern" -print -quit)"
    fi

    if [ -n "$wheel" ]; then
        if ! _wheel_is_valid "$wheel"; then
            echo "[WARN] Local wheel for $label appears corrupted or incomplete: $(basename "$wheel"); skipping."
            return 1
        fi
        echo "[INFO] Using local prebuilt wheel for $label: $(basename "$wheel")"
        if $UV_PIP install "$wheel"; then
            return 0
        fi
        echo "[WARN] Local wheel for $label failed to install; falling back to source build."
    fi

    return 1
}

# Ensure release wheels are available in WHEEL_DIR
ensure_release_wheels() {
    mkdir -p "$WHEEL_DIR"
    echo "[INFO] Downloading release wheels to $WHEEL_DIR..."
    python3 -c '
import urllib.request, json, os, sys
req = urllib.request.Request("https://api.github.com/repos/Silentzx2/ForMash3D/releases/tags/Wheels", headers={"User-Agent": "ForMash3D-Installer"})
try:
    for a in json.loads(urllib.request.urlopen(req, timeout=30).read()).get("assets", []):
        if a["name"].endswith(".whl"):
            p = os.path.join(sys.argv[1], a["name"])
            if not os.path.exists(p): urllib.request.urlretrieve(a["browser_download_url"], p)
except Exception as e:
    print(f"[WARN] Wheel download warning: {e}")
' "$WHEEL_DIR" 2>/dev/null || true
}

# Ensure Blender executable is available for post-processing / blenderproc
ensure_blender() {
    if command -v blender >/dev/null 2>&1; then
        echo "[INFO] Blender already available: $(command -v blender)"
        return 0
    fi

    if [[ "${BLENDER_ENABLED:-true}" != "true" ]]; then
        echo "[WARN] Blender is disabled by BLENDER_ENABLED=false; skipping install."
        return 0
    fi

    if command -v apt-get >/dev/null 2>&1; then
        echo "[INFO] Installing Blender via apt..."
        local sudo_cmd=""
        command -v sudo >/dev/null 2>&1 && sudo_cmd="sudo"
        $sudo_cmd apt-get update -qq 2>/dev/null || true
        $sudo_cmd apt-get install -y --no-install-recommends blender 2>/dev/null || true
    fi

    if ! command -v blender >/dev/null 2>&1; then
        echo "[WARN] Blender is still not available on PATH."
        echo "       Install it manually or set BLENDER_EXECUTABLE=/path/to/blender"
    fi
}

echo "========================================"
echo "Starting Backend-API Installation"
echo "========================================"
echo "The installation may take a while, please wait..."
echo ""

choose_env_manager() {
  local default="${ENV_MANAGER:-conda}"
  local choice=""

  if [[ "${AUTO_MODE:-0}" == "1" || "${NONINTERACTIVE:-0}" == "1" || "${CI:-}" == "true" || -n "${FORMASH3D_ENV_MANAGER:-}" || ! -t 0 ]]; then
    choice="${default}"
    echo "[INFO] Non-interactive / Auto mode: selected environment manager '${choice}'"
  elif [ -e /dev/tty ]; then
    read -r -p "Select environment manager [conda|venv] (default: ${default}): " choice < /dev/tty || choice=""
  else
    read -r -p "Select environment manager [conda|venv] (default: ${default}): " choice || choice=""
  fi

  choice="${choice:-${default}}"
  case "${choice}" in
    conda|Conda|CONDA) ENV_MANAGER="conda" ;;
    venv|Venv|VENV) ENV_MANAGER="venv" ;;
    *)
      echo "[WARN] Invalid choice '${choice}'. Falling back to ${default}."
      ENV_MANAGER="${default}"
      ;;
  esac
  export FORMASH3D_ENV_MANAGER="${ENV_MANAGER}"
  export AI_STUDIO_ENV_MANAGER="${ENV_MANAGER}"
  echo "[INFO] Using environment manager: ${ENV_MANAGER}"
  echo "[INFO] Target environment: 3daigc-api (Python 3.10)"
}

choose_env_manager

# ── Unified Environment Activation (3daigc-api, Python 3.10) ──────────────────
ENV_NAME="3daigc-api"

if [[ "${ENV_MANAGER}" == "conda" ]]; then
  if ! command -v conda >/dev/null 2>&1; then
    for candidate in "$HOME/miniconda3" "/opt/conda" "$HOME/anaconda3" "/root/miniconda3"; do
      if [[ -f "$candidate/etc/profile.d/conda.sh" ]]; then
        # shellcheck disable=SC1091
        source "$candidate/etc/profile.d/conda.sh"
        export PATH="$candidate/bin:$PATH"
        break
      fi
    done
  fi
  if ! command -v conda >/dev/null 2>&1; then
    echo "[INFO] Conda not found. Installing Miniconda..."
    CONDA_HOME="${CONDA_HOME:-$HOME/miniconda3}"
    MINICONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"
    INSTALLER="/tmp/miniconda-installer.sh"
    if curl -fsSL "$MINICONDA_URL" -o "$INSTALLER"; then
      bash "$INSTALLER" -b -u -p "$CONDA_HOME" || true
      rm -f "$INSTALLER"
    else
      echo "[WARN] Could not download Miniconda installer; will fallback to venv."
      rm -f "$INSTALLER"
    fi
    export PATH="$CONDA_HOME/bin:$PATH"
    if [[ -f "$CONDA_HOME/etc/profile.d/conda.sh" ]]; then
      # shellcheck disable=SC1091
      source "$CONDA_HOME/etc/profile.d/conda.sh"
    fi
  fi

  if command -v conda >/dev/null 2>&1; then
    echo "[INFO] Conda: $(conda --version 2>&1)"
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main 2>/dev/null || true
    conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r 2>/dev/null || true
    eval "$(conda shell.bash hook 2>/dev/null || true)"

    if [[ "${CONDA_DEFAULT_ENV:-}" == "$ENV_NAME" ]]; then
      echo "[INFO] Conda environment '$ENV_NAME' is already active."
    elif conda info --envs 2>/dev/null | awk '{print $1}' | grep -qx "$ENV_NAME"; then
      echo "[INFO] Activating existing conda environment '$ENV_NAME'..."
      conda activate "$ENV_NAME" 2>/dev/null || source activate "$ENV_NAME" 2>/dev/null || true
    else
      echo "[INFO] Creating conda env '$ENV_NAME' with Python 3.10..."
      if conda create -n "$ENV_NAME" python=3.10 -y 2>/dev/null; then
        conda activate "$ENV_NAME" 2>/dev/null || source activate "$ENV_NAME" 2>/dev/null || true
      else
        echo "[WARN] Conda env creation is restricted or failed. Falling back to venv..."
        ENV_MANAGER="venv"
      fi
    fi

    # Verify if conda activation succeeded
    if [[ "${ENV_MANAGER}" == "conda" ]]; then
      CONDA_PY_VER="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "")"
      if [[ "$CONDA_PY_VER" != "3.10" && "${CONDA_DEFAULT_ENV:-}" != "$ENV_NAME" ]]; then
        echo "[WARN] Conda environment '$ENV_NAME' not activated (Python version is '$CONDA_PY_VER'). Falling back to venv..."
        ENV_MANAGER="venv"
      fi
    fi
  else
    echo "[WARN] Conda not available. Falling back to venv..."
    ENV_MANAGER="venv"
  fi
fi

if [[ "${ENV_MANAGER}" == "venv" ]]; then
  ENV_DIR="$PROJECT_ROOT/3daigc-api"
  if [[ ! -d "$ENV_DIR" && -d "$PROJECT_ROOT/.venv" && -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
    ENV_DIR="$PROJECT_ROOT/.venv"
  fi
  if [[ ! -d "$ENV_DIR" ]]; then
    echo "[INFO] Creating Python 3.10 virtual environment at $ENV_DIR..."
    if command -v python3.10 >/dev/null 2>&1; then
      python3.10 -m venv "$ENV_DIR" || exit 1
    elif command -v uv >/dev/null 2>&1; then
      uv venv "$ENV_DIR" --python 3.10 --seed 2>/dev/null || uv venv "$ENV_DIR" --python 3.10 || exit 1
    else
      python3 -m venv "$ENV_DIR" || exit 1
    fi
  fi
  # shellcheck disable=SC1090,SC1091
  source "$ENV_DIR/bin/activate" || exit 1
fi

echo "[INFO] Using environment manager: $ENV_MANAGER"
echo "[INFO] Active environment: $(python -c 'import sys; print(sys.executable)')"
ACTIVE_PYTHON="$(python -c 'import sys; print(sys.executable)')"
export UV_PYTHON="$ACTIVE_PYTHON"

# Persist environment manager and Python binary to .env
persist_env_config() {
  local env_file="$PROJECT_ROOT/.env"
  if [[ ! -f "$env_file" && -f "$PROJECT_ROOT/.env.example" ]]; then
    cp "$PROJECT_ROOT/.env.example" "$env_file"
  fi
  if [[ -f "$env_file" ]]; then
    for pair in "FORMASH3D_ENV_MANAGER=${ENV_MANAGER}" "AI_STUDIO_ENV_MANAGER=${ENV_MANAGER}" "PYTHON_EXEC=${ACTIVE_PYTHON}" "UV_PYTHON=${ACTIVE_PYTHON}"; do
      local k="${pair%%=*}"
      local v="${pair#*=}"
      if grep -q "^${k}=" "$env_file"; then
        sed -i "s|^${k}=.*|${k}=${v}|" "$env_file"
      else
        echo "${k}=${v}" >> "$env_file"
      fi
    done
    echo "[INFO] Persisted environment config to $env_file"
  fi
}
persist_env_config

if ! python -c "import uv" >/dev/null 2>&1; then
  echo "[INFO] Installing uv into active environment..."
  python -m pip install --upgrade pip 2>/dev/null || true
  python -m pip install uv 2>/dev/null || $UV_PIP install uv 2>/dev/null || true
fi

echo "[INFO] Installing build toolchain in conda env (scikit-build-core, pybind11, ninja, setuptools, wheel, cython)..."
$UV_PIP install scikit-build-core pybind11 ninja setuptools wheel cython packaging setuptools-scm
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Build toolchain installed in conda env"
else
    echo "[WARN] Build toolchain install had warnings; continuing..."
fi

echo "[INFO] Installing PyTorch with CUDA 12.4 support..."
## install pytorch for specific cuda versions
$UV_PIP install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
if [ $? -eq 0 ]; then
    echo "[SUCCESS] PyTorch installation completed"
else
    echo "[ERROR] Failed to install PyTorch"
    exit 1
fi

# Disable build isolation ─────────────────────────────────────────────────
# flash-attn, nvdiffrec_render, nvdiffrast and friends import torch in their
# setup.py/pyproject at *metadata* time. Under build isolation pip spins up a
# clean env with NO torch, so "Getting requirements to build wheel" dies with
# "No available output" and the whole install aborts. Reusing the active env
# (where torch 2.6.0 + cu124 is already installed) makes those builds work.
export PIP_NO_BUILD_ISOLATION=1
export UV_NO_BUILD_ISOLATION=1
echo "[INFO] Build isolation: disabled (PIP_NO_BUILD_ISOLATION=1)"

ensure_release_wheels

echo ""
echo "========================================"
echo "Installing Project Requirements"
echo "========================================"
ensure_blender

echo "[INFO] Installing backend/requirements.txt..."
$UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/requirements.txt"
if [ $? -eq 0 ]; then
    echo "[SUCCESS] backend/requirements.txt installed"
else
    echo "[ERROR] Failed to install backend/requirements.txt"
    exit 1
fi

echo ""
echo "========================================"
echo "Installing TRELLIS Dependencies"
echo "========================================"
### we startup with the environment of trellis ###
echo "[INFO] Changing directory to thirdparty/TRELLIS..."
cd "$THIRDPARTY_DIR/TRELLIS.2"
echo "[INFO] Running TRELLIS.2 setup script..."
echo "[INFO] Running TRELLIS.2 basic setup..."
# Ensure third-party setup.sh uses uv pip instead of bare pip.
pip() { uv pip "$@"; }
. ./setup.sh --basic
unset -f pip

echo "[INFO] Installing TRELLIS.2 native components with local-wheel preference..."

# flash-attn
if ! install_local_wheel "flash_attn-*.whl" "flash-attn"; then
    echo "[INFO] No local flash-attn wheel; using the existing package/build path..."
    uv_install flash-attn==2.7.3 --no-build-isolation
fi

# nvdiffrast
if ! install_local_wheel "nvdiffrast-*.whl" "nvdiffrast"; then
mkdir -p /tmp/extensions
rm -rf /tmp/extensions/nvdiffrast
_retry 3 5 git clone -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /tmp/extensions/nvdiffrast
    $UV_PIP install /tmp/extensions/nvdiffrast --no-build-isolation
fi

# nvdiffrec
if ! install_local_wheel "nvdiffrec_render-*.whl" "nvdiffrec"; then
mkdir -p /tmp/extensions
rm -rf /tmp/extensions/nvdiffrec
_retry 3 5 git clone -b renderutils https://github.com/JeffreyXiang/nvdiffrec.git /tmp/extensions/nvdiffrec
    $UV_PIP install /tmp/extensions/nvdiffrec --no-build-isolation
fi

# CuMesh
if ! install_local_wheel "cumesh-*.whl" "CuMesh"; then
mkdir -p /tmp/extensions
rm -rf /tmp/extensions/CuMesh
_retry 3 5 git clone https://github.com/JeffreyXiang/CuMesh.git /tmp/extensions/CuMesh --recursive
    $UV_PIP install /tmp/extensions/CuMesh --no-build-isolation
fi

# FlexGEMM (no matching wheel shown in the supplied wheel directory).
# Disabled for now — uncomment when a compatible wheel or stable source build is available.
# if ! install_local_wheel "flexgemm-*.whl" "FlexGEMM"; then
#     mkdir -p /tmp/extensions
#     rm -rf /tmp/extensions/FlexGEMM
#     _retry 3 5 git clone https://github.com/JeffreyXiang/FlexGEMM.git /tmp/extensions/FlexGEMM --recursive
#     $UV_PIP install /tmp/extensions/FlexGEMM --no-build-isolation
# fi

# o-voxel
if ! install_local_wheel "o_voxel-*.whl" "o-voxel"; then
mkdir -p /tmp/extensions
rm -rf /tmp/extensions/o-voxel
cp -r o-voxel /tmp/extensions/o-voxel
    $UV_PIP install /tmp/extensions/o-voxel --no-build-isolation
fi

echo "[SUCCESS] TRELLIS.2 native dependencies installed"
$UV_PIP install --find-links="$WHEEL_DIR" kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.6.0_cu124.html
if [ $? -eq 0 ]; then
    echo "[SUCCESS] TRELLIS setup completed"
else
    echo "[ERROR] TRELLIS setup failed"
    exit 1
fi

echo "[INFO] Installing TRELLIS(v1) requirements on top of TRELLIS.2..."
$UV_PIP install --find-links="$WHEEL_DIR" pymeshfix igraph

# Prefer the validated TRELLIS-compatible Mip-Splatting wheel already cached/downloaded in WHEEL_DIR.
# Fall back to the existing source-build path only when no valid local wheel is available.
if ! install_local_wheel "diff_gaussian_rasterization-*.whl" "TRELLIS diff-gaussian-rasterization"; then
    echo "[INFO] No valid local TRELLIS rasterizer wheel; building Mip-Splatting renderer from source..."
    mkdir -p /tmp/extensions
    rm -rf /tmp/extensions/mip-splatting
    _retry 3 5 git clone https://github.com/autonomousvision/mip-splatting.git /tmp/extensions/mip-splatting
    $UV_PIP install /tmp/extensions/mip-splatting/submodules/diff-gaussian-rasterization/ --no-build-isolation
fi

# for systems with glibc < 2.29 , you may need to build kaolin from source manually
echo "[NOTE] For systems with glibc < 2.29, you may need to build kaolin from source manually"

echo ""
echo "========================================"
echo "Installing PartField Dependencies"
echo "========================================"
# install PartField for mesh segmentation 
echo "[INFO] Changing directory to thirdparty/PartField..."
cd "$THIRDPARTY_DIR/PartField"
echo "[INFO] Installing PartField core dependencies..."
$UV_PIP install --find-links="$WHEEL_DIR" lightning==2.2 h5py yacs trimesh scikit-image loguru boto3
if [ $? -eq 0 ]; then
    echo "[SUCCESS] PartField core dependencies installed"
else
    echo "[ERROR] Failed to install PartField core dependencies"
    exit 1
fi

echo "[INFO] Installing additional PartField dependencies..."
$UV_PIP install --find-links="$WHEEL_DIR" mesh2sdf tetgen pymeshlab plyfile einops libigl polyscope potpourri3d simple_parsing arrgh open3d psutil 
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Additional PartField dependencies installed"
else
    echo "[ERROR] Failed to install additional PartField dependencies"
    exit 1
fi

echo "[INFO] Installing PyTorch Geometric extensions..."
$UV_PIP install --find-links="$WHEEL_DIR" torch-scatter torch_cluster -f https://data.pyg.org/whl/torch-2.6.0+cu124.html
if [ $? -eq 0 ]; then
    echo "[SUCCESS] PyTorch Geometric extensions installed"
else
    echo "[ERROR] Failed to install PyTorch Geometric extensions"
    exit 1
fi
# installation for PartField end 
echo "[SUCCESS] PartField installation completed"


echo ""
echo "========================================"
echo "Installing Hunyuan3D Unified Dependencies"
echo "========================================"
### unified Hunyuan dependencies — installed once for all 3 models ###
echo "[INFO] Installing hunyuan-requirements.txt (shared by Shape v2.1, Paint v2.1, DiT v2 Mini Turbo)..."
cd "$PROJECT_ROOT/backend/thirdparty"
$UV_PIP install --find-links="$WHEEL_DIR" -r hunyuan-requirements.txt --index-strategy unsafe-best-match
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Hunyuan unified dependencies installed"
else
    echo "[ERROR] Failed to install Hunyuan unified dependencies"
    exit 1
fi

echo ""
echo "========================================"
echo "Installing Hunyuan3D-Shape-v2-1 Dependencies"
echo "========================================"
### installation for Hunyuan3D-Shape-v2-1 ###
echo "[INFO] Changing directory to thirdparty/hunyuan3d-shape-v2-1..."
cd "$THIRDPARTY_DIR/hunyuan3d-shape-v2-1"
echo "[INFO] Installing custom rasterizer for Hunyuan3D-Shape-v2-1..."
cd hy3dpaint/custom_rasterizer
if ! install_local_wheel "custom_rasterizer-*.whl" "Hunyuan3D custom_rasterizer"; then
    $UV_PIP install -e . --no-build-isolation
fi
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Hunyuan3D-Shape-v2-1 custom rasterizer installed"
else
    echo "[ERROR] Failed to install Hunyuan3D-Shape-v2-1 custom rasterizer"
    exit 1
fi

echo "[INFO] Building differentiable renderer for Hunyuan3D-Shape-v2-1..."
cd "$THIRDPARTY_DIR/hunyuan3d-shape-v2-1/hy3dpaint/DifferentiableRenderer"
if ! install_local_wheel "hy3d_mesh_inpaint_processor-*.whl" "Hunyuan3D mesh inpaint processor"; then
bash compile_mesh_painter.sh
fi
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Hunyuan3D-Shape-v2-1 differentiable renderer built successfully"
else
    echo "[ERROR] Failed to build Hunyuan3D-Shape-v2-1 differentiable renderer"
    exit 1
fi
cd "$THIRDPARTY_DIR/hunyuan3d-shape-v2-1"
### installation for Hunyuan3D-Shape-v2-1 end ###
echo "[SUCCESS] Hunyuan3D-Shape-v2-1 installation completed"

echo ""
echo "========================================"
echo "Installing Hunyuan3D-Paint-v2-1 Dependencies"
echo "========================================"
### installation for Hunyuan3D-Paint-v2-1 ###
echo "[INFO] Changing directory to thirdparty/hunyuan3d-paint-v2-1..."
cd "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1"
# Download RealESRGAN_x4plus.pth checkpoint
echo "[INFO] Downloading RealESRGAN_x4plus.pth checkpoint..."
mkdir -p "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/ckpt"
if [ ! -f "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth" ]; then
    if curl -fsSL "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" \
        -o "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth"; then
        echo "[SUCCESS] RealESRGAN_x4plus.pth downloaded"
    else
        echo "[ERROR] Failed to download RealESRGAN_x4plus.pth"
        exit 1
    fi
else
    echo "[INFO] RealESRGAN_x4plus.pth already exists"
fi

# Verify RealESRGAN checkpoint is valid (min 50MB)
REALESRGAN_SIZE=$(stat -c%s "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth" 2>/dev/null || echo "0")
if [ "$REALESRGAN_SIZE" -lt 50000000 ]; then
    echo "[ERROR] RealESRGAN_x4plus.pth is too small (${REALESRGAN_SIZE} bytes), expected >50MB"
    exit 1
fi
echo "[SUCCESS] RealESRGAN_x4plus.pth verified (${REALESRGAN_SIZE} bytes)"

# Verify native renderer build
if [ -f "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/DifferentiableRenderer/mesh_inpaint_processor$(python3-config --extension-suffix)" ]; then
    echo "[SUCCESS] DifferentiableRenderer native module verified"
else
    echo "[WARN] DifferentiableRenderer native module not found, attempting rebuild..."
    cd "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/DifferentiableRenderer"
    bash compile_mesh_painter.sh
    if [ $? -eq 0 ]; then
        echo "[SUCCESS] DifferentiableRenderer rebuilt"
    else
        echo "[ERROR] Failed to build DifferentiableRenderer"
        exit 1
    fi
fi

# Build custom rasterizer
echo "[INFO] Building Hunyuan3D custom rasterizer..."
cd "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/custom_rasterizer"
if ! install_local_wheel "custom_rasterizer-*.whl" "Hunyuan3D custom_rasterizer"; then
    $UV_PIP install -e . --no-build-isolation
fi
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Hunyuan3D custom rasterizer built"
else
    echo "[ERROR] Failed to build Hunyuan3D custom rasterizer"
    exit 1
fi

# Build DifferentiableRenderer
echo "[INFO] Building Hunyuan3D DifferentiableRenderer..."
cd "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1/hy3dpaint/DifferentiableRenderer"
if ! install_local_wheel "hy3d_mesh_inpaint_processor-*.whl" "Hunyuan3D mesh inpaint processor"; then
    bash compile_mesh_painter.sh
fi
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Hunyuan3D DifferentiableRenderer built"
else
    echo "[ERROR] Failed to build Hunyuan3D DifferentiableRenderer"
    exit 1
fi

cd "$THIRDPARTY_DIR/hunyuan3d-paint-v2-1"
### installation for Hunyuan3D-Paint-v2-1 end ###
echo "[SUCCESS] Hunyuan3D-Paint-v2-1 installation completed"

echo ""
echo "========================================"
echo "Installing Hunyuan3D-DiT-v2-mini-Turbo Dependencies"
echo "========================================"
### installation for Hunyuan3D-DiT-v2-mini-Turbo ###
echo "[INFO] Changing directory to thirdparty/hunyuan3d-dit-v2-mini-turbo..."
cd "$THIRDPARTY_DIR/hunyuan3d-dit-v2-mini-turbo"
### installation for Hunyuan3D-DiT-v2-mini-Turbo end ###
echo "[SUCCESS] Hunyuan3D-DiT-v2-mini-Turbo uses shared hunyuan-requirements.txt — no additional install needed"
echo "[SUCCESS] Hunyuan3D-DiT-v2-mini-Turbo installation completed"

echo ""
echo "========================================"
echo "Installing UniRig Dependencies"
echo "========================================"
### unirig for auto-rigging  ###
echo "[INFO] Changing directory to thirdparty/UniRig..."
cd "$THIRDPARTY_DIR/UniRig"
echo "[INFO] Installing spconv-cu124 for UniRig..."
$UV_PIP install --find-links="$WHEEL_DIR" spconv-cu124
$UV_PIP install --find-links="$WHEEL_DIR" pyrender fast-simplification python-box timm
if [ $? -eq 0 ]; then
    echo "[SUCCESS] UniRig dependencies installed"
else
    echo "[ERROR] Failed to install UniRig dependencies"
    exit 1
fi

echo ""
echo "========================================"
echo "Installing PartPacker Dependencies"
echo "========================================"
### part packer  ###
echo "[INFO] Changing directory to thirdparty/PartPacker..."
cd "$THIRDPARTY_DIR/PartPacker"
echo "[INFO] Installing PartPacker requirements..."
$UV_PIP install --find-links="$WHEEL_DIR" pybind11==3.0.1
$UV_PIP install --find-links="$WHEEL_DIR" meshiki kiui fpsample pymcubes einops
if [ $? -eq 0 ]; then
    echo "[SUCCESS] PartPacker requirements installed"
else
    echo "[ERROR] Failed to install PartPacker requirements"
    exit 1
fi
### part packer end ###
echo "[SUCCESS] PartPacker installation completed"

### partuv(requires only bpy, partuv) ###
echo "[INFO] Installing partuv requirements..."
$UV_PIP install --find-links="$WHEEL_DIR" seaborn partuv 
if [ $? -eq 0 ]; then
    echo "[SUCCESS] partuv requirements installed"
else
    echo "[ERROR] Failed to install partuv requirements"
    exit 1
fi
$UV_PIP install --find-links="$WHEEL_DIR" blenderproc 
### partuv end ###

### P3-SAM (Hunyuan3D-Part) ###
echo ""
echo "========================================"
echo "Installing P3-SAM Dependencies"
echo "========================================"
if [ -d "$THIRDPARTY_DIR/P3-SAM" ]; then
    cd "$THIRDPARTY_DIR/P3-SAM"
else
    echo "[WARN] P3-SAM source directory not present; installing runtime dependencies from the shared environment."
fi
echo "[INFO] Installing P3-SAM requirements..."
# Install numba for acceleration
$UV_PIP install --find-links="$WHEEL_DIR" numba scikit-learn fpsample
if [ $? -eq 0 ]; then
    echo "[SUCCESS] P3-SAM requirements installed"
else
    echo "[ERROR] Failed to install P3-SAM requirements"
    exit 1
fi
### P3-SAM end ###

### FastMesh ###
cd "$THIRDPARTY_DIR/FastMesh"
echo "[INFO] Installing FastMesh requirements..."
$UV_PIP install --find-links="$WHEEL_DIR" -r requirement_extra.txt
if [ $? -eq 0 ]; then
    echo "[SUCCESS] FastMesh requirements installed"
else
    echo "[ERROR] Failed to install FastMesh requirements"
    exit 1
fi
### FastMesh end ###

### UltraShape ###
echo ""
echo "========================================"
echo "Installing UltraShape Dependencies"
echo "========================================"
cd "$THIRDPARTY_DIR/UltraShape" || echo "[WARN] UltraShape directory not found; continuing..."
echo "[INFO] Installing UltraShape requirements..."
# $UV_PIP install -r requirements.txt
# actually only cubvh is required based besides trellis.2 env  
if ! install_local_wheel "cubvh-*.whl" "cubvh"; then
    _retry 3 5 $UV_PIP install git+https://github.com/ashawkey/cubvh --no-build-isolation
fi
if [ $? -eq 0 ]; then
    echo "[SUCCESS] UltraShape requirements installed"
else
    echo "[ERROR] Failed to install UltraShape requirements"
    exit 1
fi
### UltraShape end ###

### VoxHammer ###
echo ""
echo "========================================"
echo "Installing VoxHammer Dependencies"
echo "========================================"
cd "$THIRDPARTY_DIR/VoxHammer"
echo "[INFO] Installing VoxHammer requirements..."
# $UV_PIP install -r requirements.txt
# only bpy-renderer and pysdf are required besides trellis.2 env  
$UV_PIP install git+https://github.com/huanngzh/bpy-renderer.git
$UV_PIP install --find-links="$WHEEL_DIR" pysdf sentencepiece
if [ $? -eq 0 ]; then
    echo "[SUCCESS] VoxHammer requirements installed"
else
    echo "[ERROR] Failed to install VoxHammer requirements"
    exit 1
fi
echo "[NOTE] VoxHammer uses TRELLIS pipeline which is already installed"
### VoxHammer end ###

### TripoSF, TripoSG, TripoSR, ardy Dependencies ###
echo ""
echo "========================================"
echo "Installing TripoSF, TripoSG, TripoSR, ardy Dependencies"
echo "========================================"
if [ -d "$PROJECT_ROOT/backend/thirdparty/TripoSF" ]; then
    echo "[INFO] Installing TripoSF requirements..."
    if ! $UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/thirdparty/TripoSF/requirements.txt"; then
        echo "[ERROR] Failed to install TripoSF requirements."
        exit 1
    fi
fi
if [ -d "$PROJECT_ROOT/backend/thirdparty/TripoSR" ]; then
    echo "[INFO] Installing TripoSR requirements..."
    if ! install_local_wheel "torchmcubes-*.whl" "torchmcubes"; then
        echo "[INFO] Local torchmcubes wheel not found; installing from git..."
        $UV_PIP install git+https://github.com/tatsy/torchmcubes.git 2>/dev/null || true
    fi
    if ! $UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/thirdparty/TripoSR/requirements.txt"; then
        echo "[WARN] TripoSR requirements install had issues; verifying basic requirements..."
    fi
fi
if [ -d "$PROJECT_ROOT/backend/thirdparty/ardy" ]; then
    echo "[INFO] Installing ardy requirements..."
    if ! $UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/thirdparty/ardy/requirements.txt"; then
        echo "[ERROR] Failed to install ardy requirements."
        exit 1
    fi
fi

### Zero123++ v1.2 Multi-View Dependencies ###
echo ""
echo "========================================"
echo "Installing Zero123++ v1.2 Dependencies"
echo "========================================"
if [ -d "$PROJECT_ROOT/backend/thirdparty/zero123plus" ]; then
    echo "[INFO] Found vendored Zero123++ repository at $PROJECT_ROOT/backend/thirdparty/zero123plus"
fi

if [ -f "$PROJECT_ROOT/backend/thirdparty/zero123plus/requirements.txt" ]; then
    echo "[INFO] Installing Zero123++ runtime dependencies..."
    $UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/thirdparty/zero123plus/requirements.txt" || true
    echo "[SUCCESS] Zero123++ runtime dependencies processed"
fi
### Zero123++ end ###

cd "$PROJECT_ROOT/backend"

echo ""
echo "========================================"
echo "Installing Project Dependencies"
echo "========================================"
### for this project (fastapi / uvicorn relevant etc.)  ###
echo "[INFO] Installing main project requirements..."
$UV_PIP install --find-links="$WHEEL_DIR" -r requirements.txt
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Main project requirements installed"
else
    echo "[ERROR] Failed to install main project requirements"
    exit 1
fi

python "$PROJECT_ROOT/backend/scripts/verify_postprocess_runtime.py"

# Keep TripoSG's declared requirements installed after the shared backend baseline.
# The shared pins satisfy its diffusers, transformers, and huggingface_hub ranges.
if [ -d "$PROJECT_ROOT/backend/thirdparty/TripoSG" ]; then
    echo "[INFO] Re-applying TripoSG model-specific requirements after project baseline..."
    if ! $UV_PIP install --find-links="$WHEEL_DIR" -r "$PROJECT_ROOT/backend/thirdparty/TripoSG/requirements.txt"; then
        echo "[ERROR] Failed to re-apply TripoSG requirements."
        exit 1
    fi
    echo "[SUCCESS] TripoSG model-specific dependency versions restored"
fi

echo "[INFO] Installing test requirements..."
# testing 
$UV_PIP install --find-links="$WHEEL_DIR" -r requirements-test.txt 
if [ $? -eq 0 ]; then
    echo "[SUCCESS] Test requirements installed"
else
    echo "[ERROR] Failed to install test requirements"
    exit 1
fi

echo "[INFO] Installing huggingface_hub for model downloading..."
# Keep the final hub version inside both the backend and TripoSG ranges.
$UV_PIP install --find-links="$WHEEL_DIR" "huggingface_hub>=0.25.0,<0.26.0"
if [ $? -eq 0 ]; then
    echo "[SUCCESS] huggingface_hub installed"
else
    echo "[ERROR] Failed to install huggingface_hub"
    exit 1
fi

echo ""
echo "========================================"
echo "Installing System Runtime Libraries"
echo "========================================"

if command -v apt-get >/dev/null 2>&1 || command -v apt >/dev/null 2>&1; then
    APT_BIN="$(command -v apt-get 2>/dev/null || command -v apt 2>/dev/null)"
    echo "[INFO] Debian/Ubuntu detected. Installing system runtime packages (libsm6, libegl-mesa0, libgl1-mesa-dev)..."
    SUDO_CMD=""
    if [ "$(id -u)" -ne 0 ]; then
        if command -v sudo >/dev/null 2>&1; then
            SUDO_CMD="sudo"
        else
            echo "[ERROR] Root or sudo access required to install system dependencies via apt."
            exit 1
        fi
    fi

    if ! $SUDO_CMD "$APT_BIN" update -qq; then
        echo "[ERROR] Failed to update apt repositories."
        exit 1
    fi

    if ! $SUDO_CMD "$APT_BIN" install -y --no-install-recommends libsm6 libegl-mesa0 libgl1-mesa-dev; then
        echo "[ERROR] Failed to install required system runtime libraries (libsm6, libegl-mesa0, libgl1-mesa-dev) via apt."
        exit 1
    fi
    echo "[SUCCESS] System runtime libraries installed successfully"
else
    echo "[WARN] apt package manager not found. Skipping apt system library installation."
    echo "[WARN] Ensure libsm6, libegl-mesa0, and OpenGL runtime libraries are installed for your platform."
fi

echo ""
echo "========================================"
echo "Validating Runtime Environment"
echo "========================================"

python -c "
import sys
print(f'Python Executable: {sys.executable}')
print(f'Python Version: {sys.version.split()[0]}')

try:
    import torch
    print(f'PyTorch Version: {torch.__version__}')
    print(f'PyTorch CUDA Version: {torch.version.cuda}')
    cuda_avail = torch.cuda.is_available()
    print(f'CUDA Available: {cuda_avail}')
    if cuda_avail:
        print(f'GPU Device Name: {torch.cuda.get_device_name(0)}')
        print(f'GPU Device Capability: {torch.cuda.get_device_capability(0)}')
    else:
        print('GPU Device Name: None (CPU mode)')
except Exception as e:
    print(f'PyTorch/CUDA check error: {e}')

for pkg in ['numpy', 'diffusers', 'transformers', 'pymeshlab', 'open3d', 'trimesh', 'rembg']:
    try:
        mod = __import__(pkg)
        print(f'{pkg}: {getattr(mod, \"__version__\", \"installed\")}')
    except Exception as e:
        print(f'{pkg}: NOT FOUND ({e})')

try:
    import sys
    sys.path.insert(0, '$PROJECT_ROOT/backend')
    from adapters.zero123plus_adapter import Zero123PlusAdapter
    print('[SUCCESS] Zero123PlusAdapter import verified')
except Exception as e:
    print(f'[WARN] Zero123PlusAdapter import check: {e}')
"

persist_env_config 2>/dev/null || true

echo ""
echo "========================================"
echo "Installation Complete!"
echo "========================================"
echo "All installation done successfully!"


