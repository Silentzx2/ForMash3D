## 2026-10-29 — Restore Hi3D high-fidelity production inference settings

- Restored Hi3D production inference profile to high resolution `1024` and `25` flow steps following successful hardware pipeline verification.
- Updated `backend/config/models.yaml` and single-source-of-truth contract tests to active `1024` geometry resolution.

## 2026-10-29 — TRELLIS.2 FlexGEMM Triton 3.x neighbor map pointer fix

- Fixed `ValueError: Unsupported ptr type <[16, 16], int32> in tl.store` during TRELLIS.2 `sample_shape_slat_cascade` upsampling.
- In `backend/utils/torchvision_fix.py`, patched `str_to_ty` so `pointer_type` and `tensor` map to true pointer types (`tl.pointer_type`) rather than `int32`, ensuring destination addresses in `_hashmap_find_store_neighbor_map_inline` remain valid pointers.
- Enhanced disk-level `_patch_flex_gemm_sources()` to strip legacy non-constexpr parameter type annotations (`: tl.tensor`, `: tl.pointer_type`, `: tl.modifier_type`) from flex_gemm Triton kernels, allowing Triton 3.x to dynamically specialize pointer arguments from runtime PyTorch tensors.
- Added defensive `_fix_triton_store()` and Triton JIT disk cache eviction on source modification.

## 2026-10-29 — Hi3D VAE precision and Pixal3D regression test fix

- Hi3D FP16 profile leaves the custom VAE in float32. Autoencoder blocks decorated with `@force_fp32` require float32 weights, avoiding `RuntimeError: expected scalar type Float but found Half` during refinement decode.
- Added runtime self-healing and vendored autoencoder guards ensuring `LayerNormFP32` and `PointBatchNorm` dynamically align parameter dtypes to the input tensor.
- Updated AST regression test suite to match Pixal3D's direct run contract.

## 2026-10-29 — Pixal3D model cache hardening

- DINOv3 feature weights now use an explicit Hugging Face cache under the project pretrained tree, and Torch Hub cache writes (including NAF/MoGe helpers) are redirected to a writable project cache.
- Cache directories are write-probed at model load and fail with an actionable permission error rather than failing later in NAF/model downloads under a read-only home directory.
- Added contract coverage for the custom encoder cache API and main-adapter wiring.

## 2026-10-29 — Pixal3D multi-GPU conditioning fix

- Updated the custom third-party Pixal3D encoders to put image tensors on the encoder's actual device instead of implicit `cuda:current_device`.
- Projection/camera tensors and sparse coordinate indexing now follow each conditioner’s device; the adapter co-locates each conditioner with its corresponding flow stage after component dispatch.
- Required NAF upsampler failures now stop model loading with a clear error instead of being swallowed and reappearing during mesh inference.
- Added CPU-safe contract tests covering the main adapter ↔ custom third-party device-placement boundary.

## 2026-10-29 — Preserve Hi3D image transparency

- Hi3D no longer converts the reference image to RGB before SPARC3D image preparation. The custom conditioner uses alpha to find and frame the subject, so the adapter now preserves the uploaded image mode/alpha and closes source files promptly.
- Added a mocked inference regression test for transparent PNG input.

## 2026-10-29 — Partial-checkpoint loading guards

- Hi3D only selects local DINOv2/CLIP directories when a complete single-file or sharded Transformers weight set exists; config-only or incomplete downloads now fall back to the Hub using the writable cache.
- Pixal3D fails early with an actionable checkpoint message when an absolute local model directory lacks pipeline.json, instead of letting the custom loader interpret that filesystem path as a Hub repository ID.
- Added tests for config-only and partially downloaded sharded vision-encoder directories.

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
