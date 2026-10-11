## 2026-10-11 — [Setup Robustness: Node Locked Runtime Reuse]

- `scripts/setup.sh` `_ensure_node_version()` now reuses an already-installed pinned Node runtime (`$HOME/.formash3d/node/current`) when its version matches the lock, before any download. A transient network failure during re-setup previously aborted the whole setup ("installation failed verification") even though the locked v24.21.0 was present on disk.
- Docs updated: MEMORY, CHANGELOG.

## 2026-10-11 — [Unified Model Dependencies & Multi-Model Conflict Elimination]

- **Centralized Model Baseline in backend/requirements.txt**: Locked authoritative versions for core packages shared across all neural models (`transformers==4.46.3`, `diffusers==0.30.3`, `huggingface_hub==0.25.0`, `torch==2.6.0+cu124`, `torchvision==0.21.0+cu124`, `accelerate>=1.0.0`, `trimesh==4.6.12`, `numpy==1.26.4`, `einops>=0.8.0`, `safetensors>=0.4.4`, `timm>=1.0.0`, `rembg>=2.0.60`, `kornia>=0.6.0`, `omegaconf>=2.3.0`, `xatlas>=0.0.7`, `loguru>=0.7.0`, `imageio>=2.9.0`).
- **Eliminated Third-Party Downgrades**: Sanitized individual model requirements files (`zero123plus`, `FastMesh`, `TripoSF`, `TripoSG`, `TripoSR`, `UniRig`, `Unique3D`, `ardy`, `hunyuan-requirements.txt`, `Paint3D`) removing conflicting legacy pins (`diffusers==0.20.2`, `transformers==4.29.2/5.8.1`, `trimesh==4.5.3/4.2.3`, `einops==0.7.0`) and non-headless opencv packages.
- **Headless Blender Runtime Fallback**: Verified postprocess runtime uses the installed official `bpy==4.0.0` module headlessly when a standalone blender binary is absent.
- Docs updated: MEMORY, CHANGELOG, ARCHITECTURE.

## 2026-10-11 — [Paint3D 1K/2K Integration & Centralized Texture Pipeline]

- **Paint3D model adapter**: Integrated OpenTexture/Paint3D for 1K (1024x1024) and 2K (2048x2048) texture synthesis (`backend/adapters/paint3d_adapter.py`) into Python 3.10 / CUDA 12.4 / PyTorch 2.6.0 runtime without downgrading base environment packages.
- **Two-stage UV generation workflow**: Executes coarse texture synthesis (Stage 1) followed by UV inpainting & seam refinement (Stage 2), conditioning both stages on the original reference image and returning textured GLB/OBJ with extracted PBR albedo map paths.
- **Centralized texture stage (Section 5)**: Routed texture generation directly into post-processing with preset mapping (`1K`->1024, `2K`->2048, `4K`->4096, `8K`->8192; 1K/2K -> Paint3D, 4K/8K -> Hunyuan3D-Paint). Textures are exported separately to `textures/<base_name>_textured.glb` without overwriting the immutable master. Failure leaves raw mesh intact with degraded telemetry. Manifest cache audited for texture-only retry.
- **Post-processing cooperative cancellation (A1)**: `run_postprocess_job()` accepts `cancel_checker: CancelChecker = None` and inserts cancellation checkpoints before/after every major stage (inspect, repair, retopo, remesh, optimize, UV, bake, texture, LODs, QA). If cancel is signaled, post-processing cleanly aborts without corrupting `master/source.glb` or writing false completion to `asset.json`.
- **Auto-rig & cooperative cancel signal in scheduler (A2, A3)**: `_watch_auto_rig()` guards against resurrecting cancelled/failed parents. `cancel_job()` sets thread-safe postprocess cancel events and cooperative Redis signal when no live worker is running. `_handle_job_result()` routes texture into postprocess and handles cooperative cancellations cleanly.
- **Model registration & download manager**: Added `paint3d` to `backend/config/models.yaml`, `backend/core/scheduler/model_factory.py`, and `backend/adapters/__init__.py`. Added official HF weights downloader (`GeorgeQi/Paint3d_UVPos_Control`) in `download_models.sh` and interactive entry `[24]` in `manager.sh`.
- Docs updated: MEMORY, CHANGELOG, DECISIONS, ARCHITECTURE.
