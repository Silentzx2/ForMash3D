## 2026-10-29 — Model checkpoint verification and active resolutions

- Pixal3D download validation checks all eight model configs and safetensors listed by the custom pipeline JSON, not only the sparse-structure checkpoint.
- Hi3D download validation checks every artifact required by the custom Sparc3D loader and fails if DINOv2/CLIP encoder downloads are incomplete.
- Model metadata reports the active Hi3D 512 profile and Pixal3D 1536 cascade target; Pixal3D can downshift to 1024 when its token budget requires it.

## 2026-10-29 — Pixal3D camera and Hi3D cache runtime corrections

- Camera estimation now uses the custom Pixal3D-preprocessed image, matching the vendored inference flow; temporary camera images and empty working directories are cleaned up.
- Pixal3D camera helper imports use a private module name to avoid collisions with other adapters' generic inference modules.
- When Hi3D's main checkpoint is local but DINOv2/CLIP are missing, their Hub downloads now use the writable pretrained tree instead of relying on the default home cache.
- Regression tests cover the camera crop passed to MoGe and import isolation for the custom Pixal3D tree.

## 2026-10-29 — Pixal3D custom pipeline contract correction

- Removed the unsupported resolution keyword from the custom pipeline run call; the vendored pipeline selects actual resolution through pipeline_type and its token budget.
- GLB attribute postprocessing now derives grid_size from the returned MeshWithVoxel voxel_size, preventing the input-profile value from being mistaken for the achieved output resolution.
- The response reports the effective geometry resolution, and regression tests enforce the custom run signature and postprocessing grid size.

## 2026-10-29 — Hi3D and Pixal3D inference hardening

- Pixal3D reuses the custom vendored pipeline preprocessor and normalizes input to a centered 512×512 RGBA canvas; camera estimation still reads the original image.
- Pixal3D handles sequence and singleton mesh outputs and fails clearly when the pipeline returns an empty sequence.
- Hi3D generates default output paths through the existing output path generator instead of a missing method.
- Hi3D applies its FP16 profile after loading, preserves the custom transformer's native mixed-precision path, and covers the deferred 1024 transformer without eager loading.
- Hi3D multi-GPU scheduling metadata is disabled until the custom adapter implements real component placement.
- Regression coverage was added for Pixal3D preprocessing/output extraction, Hi3D generated paths/FP16 loading, and the Hi3D single-GPU manifest contract.
- GPU-backed model smoke tests remain to be run in a compatible runtime.

## 2026-10-27 — Hi3D experimental model integration

- **Explicit User Authorization:** Integrated Hi3D v1.0 as an experimental model following explicit owner approval.
- **Vendored Upstream Source:** Pinned `https://github.com/hi3d-official/Hi3Dv1.0` at reviewed commit `13657ad09afaa92e350b461a1cd66399e44a59c4` in `backend/thirdparty/Hi3D`, stripping upstream `.git` metadata cleanly while preserving `LICENSE`, `NOTICE`, and attribution.
- **Hi3D Adapter (`backend/adapters/hi3d_adapter.py`):**
  - Inherits from `BaseAdapter` / `ImageToMeshModel`.
  - Supports `hi3d_image_to_raw_mesh` (raw geometry refinement) and `hi3d_image_to_textured_mesh` (alias).
  - Explicitly marked with `experimental: true`.
  - Enforces `_LOCKED_INFERENCE_PROFILE` (resolution=1024, num_inference_steps=25, seed=42, sequential_cpu_offload=False, fp16=True, apply_texture=False).
  - Graceful hardware validation requiring NVIDIA GPU with CUDA compute capability >= 8.0 (Ampere+), reporting clear diagnostics when unavailable.
  - Lazy loading of pretrained weights from `backend/pretrained/Hi3D` with FP16 and sequential CPU offload support.
  - Clean untextured raw mesh export when `apply_texture=False`.
- **Model Registry & Routing:**
  - Registered in `backend/core/scheduler/model_factory.py`, `backend/adapters/__init__.py`, `backend/core/planner.py`, and `backend/core/scheduler/multiprocess_scheduler.py`.
  - Added catalog entries in `backend/config/models.yaml` with 16 GB VRAM reservation, license `LicenseRef-Hi3D-1.0`, and `experimental: true`.
  - Added UI model entries with `[Experimental]` badges in `constants/models.ts`, `GeneratePanel.tsx`, and `app/page.tsx`.
- **Verification:**
  - Added comprehensive test suite `backend/tests/test_hi3d_adapter.py`.
  - Verified with pytest regression suite and TypeScript/Next.js builds.

## 2026-10-27 — Adapter-owned resource controls and contract documentation

- Removed disconnected Low-VRAM controls from active generation and texture panels.
- Stopped serializing legacy `low_vram` request overrides and added scheduler-side filtering before adapter execution; automatic resource plans remain authoritative.
- Restored the five first-party documentation guides referenced by the project architecture and rules.
- Verification: focused frontend and backend contract tests, TypeScript, Python compilation, and shell checks passed; GPU/model/browser validation remains not run.

## 2026-10-26 — Real-time log tail: SSE-only, tail-first and bounded display

- Fresh Admin Logs connections seek to the configured recent lines before following new writes; resume retains byte offsets, file identity and reset events.
- Removed the dead WebSocket attempt and duplicate polling path, bounded terminal history, added capped reconnect backoff, and corrected proxy cancellation lifetime.
- Added focused tests for tail offsets, filename confinement, config requirements and frontend/backend tail-window parity. Runtime timing and full application startup remain unverified in this source-only environment.

## 2026-10-26 — Unique3D max geometric detail push and untextured raw output

- **Unique3D maximum geometry resolution & detail preservation**:
  - Pushed raw geometry polycount from 60k to max model capacity (~250k–450k polygons) by reducing `end_edge_len` from 0.005 to 0.0022 in `run_mesh_refine` and `0.01` in stage 1, allowing the gradient optimizer to capture intricate cloth folds, limbs, weapons, and facial curves.
  - Upgraded `fast_geo` coarse reconstruction to preserve full 512x512 normal map resolution (up from 192x192) and Poisson surface depth to 8 (256³ grid) without decimation (`simplification=0`), eliminating potato/blob artifacts.
- **Unique3D geometry stabilization and untextured raw output**:
  - `unique3d_adapter.py`: Bypassed multiview color projection for raw mesh generation (`apply_texture=False`), outputting clean untextured raw geometry (`has_texture: false`, `has_vertex_color: false`). Fixed coordinate transformation to prevent double axis negation (`[0, 2] = -[0, 2]`). Added trimesh component filtering to automatically prune isolated flying debris and shards.
  - Submodule `backend/thirdparty/Unique3D`:
    - `mesh_init.py`: Clamped depth aspect ratio `calc_w_over_h` to `[0.25, 0.85]` to prevent thin-profile meshes from collapsing into a 3cm wafer. Normalized depth heights safely in `build_mesh`.
    - `utils.py`: Re-enabled non-manifold vertex/edge repairs, added component diameter filtering to eliminate detached fragments, and restored 1-step Laplacian smoothing to remove high-frequency gradient optimization spikes. Supported exporting clean untextured raw GLB without vertex colors when `include_vertex_color=False`.
    - `multiview_inference.py`: Made multiview color projection optional so raw mesh inference skips texture baking and returns clean geometry.

## 2026-10-26 — Unique3D gradient enable under scheduler and VRAM planner eviction

- **Unique3D autograd under scheduler `torch.no_grad`**:
  - `unique3d_adapter.py`: Wrapped `_run_geo_reconstruct` and mesh reconstruction inference within `torch.enable_grad()` and ensured mesh vertices have `requires_grad_(True)` so `loss.backward()` during iterative geometry deformation does not fail with `RuntimeError: element 0 of tensors does not require grad`.
  - Submodule `backend/thirdparty/Unique3D`: Enabled autograd in `reconstruct_stage1`, `recon.py`, and `refine.py`.
- **VRAM planner awareness & idle worker LRU eviction**:
  - `mesh_generation.py`: Added `_augment_runtime_facts_with_freeable_vram` so API route validation counts VRAM held by idle workers as reclaimable capacity before calling `plan_generation`. Prevents HTTP 400 Bad Request rejection when switching models.
  - `planner.py`: Updated candidate evaluation to acknowledge freeable VRAM when idle workers can be evicted.
  - `multiprocess_scheduler.py`: Added `get_idle_workers_vram_by_gpu()` and `get_freeable_vram_by_gpu()`. Eviction logic now properly unloads idle workers across single- and multi-GPU configurations, strips unnecessary idle time gates, and destroys corrupt workers on fatal CUDA errors.
- **Hunyuan3D decoder profile typing**:
  - `hunyuan3d_decoder_profile.py`: Added missing `Optional` import to fix `NameError: name 'Optional' is not defined`.
