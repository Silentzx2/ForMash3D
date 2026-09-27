# ForMash 3D — Setup & Installation Guide

> **Version**: 0.1.0
> **Difficulty**: Intermediate
> **Estimated Time**: 15-30 minutes (runtime only; weights are on-demand)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Hardware Requirements](#hardware-requirements)
3. [Quick Start (Native)](#quick-start-native)
4. [Environment Configuration](#environment-configuration)
5. [GPU Setup](#gpu-setup)
6. [Troubleshooting](#troubleshooting)
7. [Verification](#verification)

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Git** | Latest | Clone repository |
| **Node.js** | 20+ | Frontend development (Bun package manager) |
| **Python** | 3.10 | Backend development (Conda env `3daigc-api`) |
| **Bun** | Latest | Frontend package manager |
| **uv** | Latest | Python package manager |

### Operating System Support

| OS | Status | Notes |
|----|--------|-------|
| **Ubuntu 22.04/24.04** | ✅ Fully Supported | Recommended |
| **Debian 12** | ✅ Supported | May need additional packages |
| **Windows WSL2** | ✅ Supported | Use Ubuntu distro |
| **macOS** | ❌ Not Supported | No NVIDIA GPU support |

---

## Hardware Requirements

### Minimum Specifications

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8+ cores |
| **RAM** | 8 GB | 16 GB |
| **Storage** | 50 GB SSD | 100 GB NVMe SSD |
| **GPU** | NVIDIA GPU with CUDA | NVIDIA GPU with CUDA |

---

## Hardware Requirements

### Minimum Specifications

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8+ cores |
| **RAM** | 8 GB | 16 GB |
| **Storage** | 50 GB SSD | 100 GB NVMe SSD |
| **GPU** | NVIDIA GPU with CUDA | NVIDIA GPU with CUDA |

### GPU VRAM Requirements by Model

| Model | VRAM Required | Quality | Speed |
|-------|---------------|---------|-------|
| **TRELLIS** | 11.5 GB | High quality | ~60 seconds |
| **TRELLIS.2** | 23 GB | Highest quality | ~60 seconds |
| **Hunyuan3D-2.1** | 8 GB (shape) / 16 GB (shape+texture) | High quality | ~90 seconds |
| **TripoSR** | 6 GB | Ultra-fast raw mesh | ~2-5 seconds |
| **TripoSG** | 8 GB | High-fidelity image/scribble | ~10-20 seconds |
| **ARDY** | 8 GB | Motion AI & Animation | ~10-25 seconds |
| **PartPacker** | 10 GB | Fast | ~60 seconds |
| **UltraShape** | 26.6 GB | Highest fidelity | ~30 seconds |
| **PartField** | 4 GB | Segmentation | ~15 seconds |
| **P3-SAM** | 60 GB | High-precision segmentation | ~15 seconds |
| **UniRig** | 9 GB | Auto-rigging | ~20 seconds |
| **FastMesh-V1K** | 16 GB | Retopology | ~30 seconds |
| **FastMesh-V4K** | 24.5 GB | High-res retopology | ~30 seconds |
| **VoxHammer** | 40 GB | Mesh editing | ~20 seconds |

> VRAM figures are the verified normal-footprint requirements. Set `MAX_VRAM_MB=0` in `.env` for auto-detection.

---

## Quick Start (Native)

### Method 1: Using Setup Script (Recommended)

```bash
# Clone the repository
git clone https://github.com/Silentzx2/ForMash3D.git
cd ForMash3D

# Run the full setup (handles wheels, deps, and backend)
./scripts/setup.sh

# Start all services
./manager.sh
```

The setup script (`scripts/setup.sh`) orchestrates the full installation in order:
1. Downloads and installs prebuilt wheels from the ForMash3D GitHub Release (`backend/thirdparty/wheels/`)
2. Installs system dependencies (CUDA 12.4, Redis, Bun)
3. Delegates to `backend/scripts/install.sh` for Python environment and package installation

The `download_and_install_release_wheels()` function inside `scripts/setup.sh` is the single source of truth for wheel installation — it fetches all `.whl` files from the `ForMash3D/releases/tag/Wheels` GitHub Release and installs them into the environment.

Third-party source code is included directly in `backend/thirdparty/` as part of the main repository. Wheels are stored in `backend/thirdparty/wheels/` and downloaded from the ForMash3D GitHub Release at runtime.

### Method 2: Manual Installation

```bash
# 1. Clone and enter project
git clone https://github.com/Silentzx2/ForMash3D.git
cd ForMash3D

# 2. Download prebuilt wheels from GitHub Release
# This is handled automatically by scripts/setup.sh which calls
# download_and_install_release_wheels() — the single source of truth
# for wheel installation from ForMash3D/releases/tag/Wheels

# 3. Install Python dependencies
# Virtual environment (recommended):
python3.10 -m venv ../.venv && source ../.venv/bin/activate
# Or Conda: conda create -n 3daigc-api python=3.10 -y && conda activate 3daigc-api
cd backend
pip install -r requirements.txt

# 3. Install frontend dependencies
cd ..
bun install

# 4. Copy environment file
cp .env.example .env

# 5. Start backend
source .venv/bin/activate  # or conda activate 3daigc-api
cd backend
uvicorn api.main_singleworker:app --reload --port 7842

# 6. Start frontend (new terminal)
bun run dev
```

Third-party source code is included directly in `backend/thirdparty/` as part of the main repository. Wheels are stored in `backend/thirdparty/wheels/` and downloaded from the ForMash3D GitHub Release at runtime. The `download_and_install_release_wheels()` function in `scripts/setup.sh` is the single source of truth for wheel installation.

### Access Points After Startup

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:3000 | Web application |
| **Backend API** | http://localhost:7842 | REST API |
| **API Docs** | http://localhost:7842/docs | Swagger UI |
| **Health Check** | http://localhost:7842/health | Service health |

---

## Environment Configuration

Copy the example configuration file:

```bash
cp .env.example .env
```

### Key Environment Variables

```env
# ===== APPLICATION =====
ENVIRONMENT=development
DEBUG=true
APP_NAME=ForMash 3D API
APP_VERSION=0.1.0

# ===== BACKEND =====
BACKEND_URL=http://localhost:7842
REDIS_URL=redis://localhost:6379/0

# ===== GPU / CUDA =====
CUDA_DEVICE=auto
MAX_VRAM_MB=0        # 0 = auto-detect
VRAM_SAFETY_MARGIN_MB=1024
AUTO_UNLOAD_AFTER_JOB=true

# ===== STORAGE =====
STORAGE_LOCAL_PATH=./backend/storage
DOWNLOAD_CHUNK_SIZE_MB=5
DOWNLOAD_MAX_RETRIES=3

# ===== ENVIRONMENT & RUNTIME =====
FORMASH3D_ENV_MANAGER=conda  # conda (default) or venv
PYTHON_EXEC=                 # auto-discovered or custom Python 3.10 path

# ===== API =====
API_V1_PREFIX=/api/v1
CORS_ORIGINS=["http://localhost:3000"]
P3D_USER_AUTH_ENABLED=false
```

### YAML Configuration Files

- **`backend/config/system.yaml`**: Logging, security, environment, user auth.
- **`backend/config/models.yaml`**: Per-feature model definitions with VRAM requirements, supported inputs/outputs, model paths, and worker counts.

---

## GPU Setup

The setup script automatically detects and installs CUDA 12.4. For manual setup:

```bash
# Verify NVIDIA driver and CUDA
nvidia-smi
nvcc --version
```

### CUDA Toolkit Installation

The setup script handles CUDA 12.4 installation automatically. Key packages:
- `cuda-toolkit-12-4`
- `libcusparse-dev-12-4`
- `libcusolver-dev-12-4`
- `libcufft-dev-12-4`

---

## Post-Installation

### Verify Setup

```bash
# Check health endpoint
curl -s http://localhost:7842/health | jq .

# Check available models
curl -s http://localhost:7842/api/v1/mesh-generation/models | jq .

# Check system info
curl -s http://localhost:7842/api/v1/system/info | jq .
```

### Download Model Weights

Models can be downloaded on-demand via the download script or interactively via `manager.sh`:

```bash
# Download specific models
./backend/scripts/download_models.sh triposr    # Fast feedforward image-to-3D
./backend/scripts/download_models.sh triposg    # High-fidelity image/scribble-to-3D
./backend/scripts/download_models.sh triposf    # SparseFlex high-resolution arbitrary topology
./backend/scripts/download_models.sh ardy       # ARDY Motion AI weights (HuggingFace token required)
./backend/scripts/download_models.sh trellis2   # TRELLIS.2 weights
./backend/scripts/download_models.sh hunyuan21  # Hunyuan3D-2.1 weights

# Or use the interactive manager menu:
./manager.sh  # Select [8] 3D Model Install
```

### Run Tests

The backend exposes a health endpoint for runtime verification:
```bash
curl -s http://localhost:7842/health | jq .
# {"status": "healthy", "timestamp": ..., "version": "0.1.0"}
```

The frontend can be type-checked and built with:
```bash
npx tsc --noEmit
bun run build
```

> **Note**: An automated `backend/tests/test_backend_e2e.py` test script referenced in earlier documentation does not currently exist. The health endpoint and TypeScript compiler provide the available self-check mechanisms.

---

## Troubleshooting

### 1. GPU / CUDA Detection
```bash
nvidia-smi
```

### 2. Port Already in Use (3000, 7842)
```bash
bash scripts/stop.sh
# Or force free specific ports:
lsof -ti :3000 | xargs -r kill -9
lsof -ti :7842 | xargs -r kill -9
```

### 3. Out of Memory (CUDA OOM)
- The VRAM-aware scheduler prevents multi-provider GPU OOM via strict mutual exclusion.
- For low-VRAM GPUs (≤8GB), use lighter models (e.g., TRELLIS at 11.5GB).

### 4. Checking Service Logs
```bash
tail -f logs/app.log
```

### 5. Virtual Environment Issues
```bash
# Recreate the venv if corrupted
cd backend
rm -rf .venv
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

---

## Verification Matrix

The backend exposes a health endpoint for runtime verification:
```bash
curl -s http://localhost:7842/health | jq .
# {"status": "healthy", "timestamp": ..., "version": "0.1.0"}
```

The frontend can be type-checked and built with:
```bash
npx tsc --noEmit
bun run build
```

> **Note**: An automated `backend/tests/test_backend_e2e.py` test script referenced in earlier documentation does not currently exist. The health endpoint and TypeScript compiler provide the available self-check mechanisms.
