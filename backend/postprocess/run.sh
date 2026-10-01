#!/usr/bin/env bash
# Start the 3D Gen Studio Python mesh-processing service (Linux / macOS).
#
# On first run: uses `uv` to provision a pinned standalone Python (see
# .python-version), create a local virtual environment, install the base (CPU)
# requirements, then auto-detect an NVIDIA GPU and install matching GPU
# acceleration (Warp + the correct cupy-cudaXXx wheel). macOS has no NVIDIA GPU,
# so it always does a CPU-only install.
#
# uv is auto-downloaded if not already present. Override host/port via env
# (e.g. MESHTOOLS_PORT=8200).
set -euo pipefail
cd "$(dirname "$0")"
PYVER=3.13

# --- Ensure uv is available -------------------------------------------------
if command -v uv >/dev/null 2>&1; then
  UV="uv"
elif [ -x "$HOME/.local/bin/uv" ]; then
  UV="$HOME/.local/bin/uv"
else
  echo "Installing uv (Python toolchain manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  UV="$HOME/.local/bin/uv"
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Provisioning Python $PYVER via uv..."
  "$UV" python install "$PYVER"
  echo "Creating virtual environment (Python $PYVER)..."
  "$UV" venv .venv --python "$PYVER"
  # shellcheck disable=SC1091
  source .venv/bin/activate

  echo
  echo "Installing base (CPU) requirements..."
  "$UV" pip install -r requirements.txt

  # --- Optional NVIDIA GPU acceleration -------------------------------------
  echo
  if [ -n "${MESHTOOLS_SKIP_GPU:-}" ]; then
    echo "MESHTOOLS_SKIP_GPU set -- skipping GPU acceleration (CPU-only install)."
  else
    echo "Detecting NVIDIA GPU / CUDA version..."
    CUPY_PKG="$(python detect_cuda.py || true)"
    if [ -n "$CUPY_PKG" ]; then
      echo "NVIDIA GPU detected -- installing GPU acceleration: $CUPY_PKG + Warp"
      "$UV" pip install -r requirements-nvidia.txt
      "$UV" pip install "$CUPY_PKG"
      echo "GPU acceleration installed."
    else
      echo "No NVIDIA GPU detected -- CPU-only install. Auto Retopo will run on the CPU."
    fi
  fi
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

python main.py
