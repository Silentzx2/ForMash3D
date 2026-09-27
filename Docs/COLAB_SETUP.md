# Google Colab Setup & Deployment Guide

> **Version**: 0.1.0
> **Target GPUs**: Google Colab Free (T4 15GB), Pro/Pro+ (V100 16GB, L4 24GB, A100 40GB/80GB)
> **Estimated Setup Time**: ~3-5 minutes

---

## Overview

ForMash 3D provides support for Google Colab environments. The Colab scripts automate environment bootstrapping, dependency installation, service orchestration (FastAPI + Next.js), and secure Cloudflare public tunneling.

> **Note**: Google Colab notebooks (`colab.ipynb`, `AI_Studio_Colab.ipynb`) are not included in this repository. The Colab workflow is handled via shell scripts that can be adapted for notebook cells.

> **Note**: Only `scripts/colab.sh` currently exists in the repository. The orchestration scripts (`colab_start.sh`, `colab_stop.sh`, `colab_restart.sh`, `colab_status.sh`, `colab_watch.sh`, `colab_keepalive_js.py`) referenced in earlier documentation do not currently exist.

---

## Quickstart Steps

1. Open [Google Colab](https://colab.research.google.com).
2. Create a new notebook with GPU runtime (Runtime → Change runtime type → GPU).
3. Run the setup commands below in notebook cells.

### Cell 1: Environment Setup
```python
!git clone https://github.com/Silentzx2/ForMash3D.git /content/ForMash3D
%cd /content/ForMash3D
!bash backend/scripts/install.sh --no-start
```

Third-party source code is included directly in `backend/thirdparty/` as part of the main repository. Wheels are stored in `backend/thirdparty/wheels/` and downloaded from the ForMash3D GitHub Release at runtime.

### Cell 2: Start Services
```python
!cd /content/ForMash3D && bash scripts/start.sh &
```

### Cell 3: Access URLs
```python
print("Frontend: http://localhost:3000")
print("Backend API: http://localhost:7842")
print("API Docs: http://localhost:7842/docs")
print("Health Check: http://localhost:7842/health")
```

---

## Colab Service Scripts

| Script | Purpose |
|---|---|
| `scripts/colab.sh` | Full Colab bootstrap (setup + start) — **currently exists** |

> **Note**: The following scripts referenced in earlier documentation do not currently exist in the repository: `colab_start.sh`, `colab_stop.sh`, `colab_restart.sh`, `colab_status.sh`, `colab_watch.sh`, `colab_keepalive_js.py`.

---

## Features & Resilience

- **8GB Swapfile Safety Net**: Colab free-tier instances provide limited RAM. The bootstrap script allocates an 8GB `/swapfile` to prevent OOM kills during heavy tensor operations.
- **CUDA 12.4 Runtime**: Enforces PyTorch 2.6.0 with CUDA 12.4 across GPU hosts. Auto-links CUDA dev headers (`cusparse.h`, `cusolverDn.h`, `cufft.h`) from venv into system CUDA include path.
- **Python 3.10**: Uses Conda environment `3daigc-api` with Python 3.10 (or venv if selected). Automatically discovered across non-interactive subshells and persisted in `.env` as `PYTHON_EXEC`. Server startup uses the existing environment without re-downloading packages.

---

## Hardware Requirements

| GPU | VRAM | Status | Notes |
|-----|------|--------|-------|
| T4 | 15 GB | ✅ Supported | Recommended minimum |
| V100 | 16 GB | ✅ Supported | Full model support |
| L4 | 24 GB | ✅ Supported | Optimal for most models |
| A100 | 40/80 GB | ✅ Supported | Maximum quality |
| CPU | N/A | ⚠️ Limited | Only lightweight models |

---

## Troubleshooting

### GPU Not Detected
```bash
nvidia-smi
# If empty, ensure GPU runtime is selected in Colab
```

### Service Not Responding
```python
# Check service status via health endpoint
!curl -s http://localhost:7842/health

# View logs
!tail -f /content/ForMash3D/backend/logs/api.log
```

### Free Up Memory
```bash
# Restart services to clear GPU memory
!bash /content/ForMash3D/scripts/restart.sh
```
