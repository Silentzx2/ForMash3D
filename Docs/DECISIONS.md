# Architecture Decisions — ForMesh 3D

> **Version**: 0.1.0
> **Last Updated**: October 2026

---

## ADR-100: Logs — SSE-Only, Tail-First Start (2026-10-26)

**Context:** The Admin Logs page replayed the full, non-rotating `master.log` from byte zero on each fresh open, attempted a WebSocket transport that could not upgrade through the Next.js catch-all route, raced SSE against a polling overwrite, allowed the DOM to grow without bound, and did not retry after an `EventSource.CLOSED` failure.

**Decision:**
1. Fresh SSE connections seek backward to the configured last N lines; `tail=0` starts at EOF. A strict `file` basename allowlist prevents paths from escaping the repository `logs/` directory.
2. Preserve `identity:offset` event IDs, `Last-Event-ID` resume, UTF-8-safe chunks and `reset` events. One SSE transport replaces the dead WebSocket attempt and the redundant poll/overwrite path.
3. Adapt idle polling using stream settings in `backend/config/system.yaml`; retain the configured heartbeat and avoid new dependencies or startup changes.
4. Bound terminal history, reconnect closed streams with capped backoff, and keep the existing Clear operation on the canonical log.

**Consequences:** History before the initial tail is not auto-replayed when the Logs tab opens; the query `tail` can request a larger configured window, and the existing log-file endpoint remains available for recent parsed entries. `master.log` still has no automatic rotation: multiple Uvicorn workers append to the same file and Clear truncates it in place. If disk growth becomes a concern, upgrade to external `copytruncate` rotation or a multi-process-safe handler.

## ADR-099: Raw Mesh Fidelity Preservation and Worker Load Timeout Extension (2026-10-26)

**Context:** Raw 3D meshes exported by AI model adapters exhibited melted/soft surfaces, lost high-frequency features (faces, hard surfaces, weapons), and suffered from 600s worker timeouts during large checkpoint initialization on cloud/Kaggle environments. Furthermore, TRELLIS 1 raw meshes exhibited jagged needle spikes and boundary holes.

**Decision:**
1. In `MeshProcessor.save_mesh`, make `crease_angle_deg=None` default so raw geometric normals are preserved without forced angle-weighted normal clustering.
2. In Hunyuan3D-2.1 adapters and `hunyuan3d_decoder_profile.py`, enable `FlashVDM` decoder and support dynamic `dmc` (Dual Marching Cubes) when `diso` is present, with graceful `mc` fallback.
3. In Unique3D `simple_clean_mesh`, disable Laplacian smoothing and Loop subdivision for raw geometry generation.
4. In Pixal3D adapter, set `remesh=False` in `to_glb`.
5. In TRELLIS.2 adapter, enforce `max_num_tokens=524288` to prevent automatic cascade resolution degradation.
6. In TRELLIS 1 adapter, apply topological hole filling (`fill_holes`, winding, normal repairs) and gentle volume-preserving Taubin smoothing (`filter_taubin(lamb=0.3, nu=-0.34, iterations=2)`).
7. In `multiprocess_scheduler.py`, extend default `max_load_timeout` for heavy models from 600s to 1800s.

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


## ADR-101: Separate Model Registration from Runtime and Output Readiness (2026-10-30)

**Context:** The model manifest and `GET /system/models` expose enabled/registered model IDs, but deployments can still encounter missing or incompatible runtime dependencies, incomplete checkpoints, GPU/resource incompatibility, pipeline initialization failures, or invalid generated geometry.

**Decision:**
1. Treat catalog registration, checkpoint availability, pipeline initialization, successful inference, and mesh-quality validation as separate lifecycle states.
2. Do not describe every enabled model as production-ready unless a supported-host load/inference smoke test and output-quality review are recorded for that model.
3. Preserve initialization tracebacks in backend logs and expose actionable job/API error states; do not translate load failures into successful/empty mesh results.
4. Track model-specific evidence and unresolved reports in `Docs/MODEL-STATUS.md`.

**Consequences:** The available-model catalog remains a capability/manifest listing. Production readiness requires model-specific runtime and geometry evidence; CPU-only CI is not sufficient.
