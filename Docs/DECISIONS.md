# Architecture Decisions — ForMash 3D

> **Version**: 0.1.0
> **Last Updated**: September 2026

---

## ADR-098: CPU Mode Skips Model Dependency Installation by Design (2026-10-23)

**Context:** `scripts/setup.sh` and `backend/scripts/install.sh` unconditionally installed CUDA toolkit components, model adapters (TRELLIS, Hunyuan3D, TripoSG, Unique3D), and their heavy ML dependencies. On hosts without an NVIDIA GPU this wasted time, disk, and network, and could fail the whole setup when CUDA wheels or third-party model source were unavailable.

**Decision:**
1. A shared resolver `scripts/lib/compute_mode.sh` computes `FORMASH3D_COMPUTE` ∈ {auto|cpu|cuda} from `nvidia-smi` presence plus `FORCE_CPU`/`FORCE_CUDA`/`CUDA_FORCE_PRESENT`/`REQUIRE_GPU`/`FORMASH3D_COMPUTE` environment.
2. CPU mode skips: CUDA toolkit setup, `ensure_release_wheels`, model stack installation (`install_model_stacks()`), and Blender runtime. PyTorch is installed from the CPU wheel index (`https://download.pytorch.org/whl/cpu`).
3. CPU mode keeps: frontend + backend API, post-processing tools, quality pipeline, ARDY (optional via `--cpu-extras --with-thirdparty`), tests.
4. `--cpu` / `--gpu` flags force the mode; `--with-thirdparty` initializes third-party submodules even in CPU mode; `--update-thirdparty` enables `--remote --merge` (opt-in only).
5. `REQUIRE_GPU=1` combined with CPU-mode resolution aborts setup with a non-zero exit.
6. Backend `requirements.txt` splits into `requirements-core.txt` (CPU-safe) and `requirements-models.txt` (GPU-only ML packages); `requirements-core.txt` alone is installed in CPU mode.

**Consequences:**
- Setup completes on headless/CPU-only hosts without CUDA wheels or model source.
- CUDA/GPU inference still works on hosts with NVIDIA GPUs when run with `--gpu` or auto-detected CUDA.
- Model adapters are importable at runtime only when their heavy ML dependencies were installed; a GPU-mode adapter used in CPU mode degrades gracefully at inference time rather than breaking setup.
- Verification: `scripts/tests/script_test.sh` resolver tests + static grep test run in Backend Runtime Contract CI; `bash -n` passes on all edited scripts.
