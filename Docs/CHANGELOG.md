## 2026-10-11 — [Paint3D 1K/2K Integration & Centralized Texture Pipeline]

- **Paint3D model adapter**: Integrated OpenTexture/Paint3D for 1K (1024x1024) and 2K (2048x2048) texture synthesis (`backend/adapters/paint3d_adapter.py`) into Python 3.10 / CUDA 12.4 / PyTorch 2.6.0 runtime without downgrading base environment packages.
- **Two-stage UV generation workflow**: Executes coarse texture synthesis (Stage 1) followed by UV inpainting & seam refinement (Stage 2), conditioning both stages on the original reference image and returning textured GLB/OBJ with extracted PBR albedo map paths.
- **Centralized texture stage (Section 5)**: Routed texture generation directly into post-processing with preset mapping (`1K`->1024, `2K`->2048, `4K`->4096, `8K`->8192; 1K/2K -> Paint3D, 4K/8K -> Hunyuan3D-Paint). Textures are exported separately to `textures/<base_name>_textured.glb` without overwriting the immutable master. Failure leaves raw mesh intact with degraded telemetry. Manifest cache audited for texture-only retry.
- **Post-processing cooperative cancellation (A1)**: `run_postprocess_job()` accepts `cancel_checker: CancelChecker = None` and inserts cancellation checkpoints before/after every major stage (inspect, repair, retopo, remesh, optimize, UV, bake, texture, LODs, QA). If cancel is signaled, post-processing cleanly aborts without corrupting `master/source.glb` or writing false completion to `asset.json`.
- **Auto-rig & cooperative cancel signal in scheduler (A2, A3)**: `_watch_auto_rig()` guards against resurrecting cancelled/failed parents. `cancel_job()` sets thread-safe postprocess cancel events and cooperative Redis signal when no live worker is running. `_handle_job_result()` routes texture into postprocess and handles cooperative cancellations cleanly.
- **Model registration & download manager**: Added `paint3d` to `backend/config/models.yaml`, `backend/core/scheduler/model_factory.py`, and `backend/adapters/__init__.py`. Added official HF weights downloader (`GeorgeQi/Paint3d_UVPos_Control`) in `download_models.sh` and interactive entry `[24]` in `manager.sh`.
- Docs updated: MEMORY, CHANGELOG, DECISIONS, ARCHITECTURE.

## 2026-10-11 — [Raw Mesh Decoupling for Image-to-3D Models & Registry Alias Resolution]

- **Normal image-to-3D generation converted to raw mesh only**: TRELLIS, TRELLIS.2, Hunyuan3D-Shape-v2.1, and Hunyuan3D-DiT-v2-mini-Turbo output untextured geometry only without embedded texture baking or automatic paint chaining. Texturing is decoupled into the centralized texture stage.
- **TRELLIS & TRELLIS.2 raw mesh pipeline**: `TrellisImageToRawMeshAdapter` extracts slat decoder raw mesh (`formats=['mesh']`) and rotates to Y-up without multiview texture baking; `Trellis2ImageToRawMeshAdapter` bypasses `o_voxel` texture baking in `Trellis2Runner.image_to_mesh(..., raw_mesh_only=True)`.
- **Hunyuan3D paint autochain removal**: Disabled `paint_autochain: false` in `models.yaml`. `Hunyuan3DShapeV21ImageToTexturedMeshAdapter` now subclasses raw adapter with a deprecation warning.
- **Unique3D vertex colors preserved**: Set `texture_generation: false` and updated metadata to `has_texture: False, vertex_color: True`, preserving native PyTorch3D vertex colors without 2D texture baking.
- **ModelFactory & alias resolution**: Added `get_model_adapter()`, registered raw adapters under `image_to_raw_mesh`, and normalized legacy `image_to_textured_mesh` requests to raw geometry via `LEGACY_IMAGE_TO_RAW_ALIASES`.
- Docs updated: MEMORY, CHANGELOG, DECISIONS, ARCHITECTURE.

## 2026-10-11 — [Backend Cancellation & Redis/SQLite Consistency]

- **Redis update_job_progress terminal status guard**: `update_job_progress` now checks job status first; if already terminal (`completed`, `failed`, `cancelled`), progress, stage, message, and logs are preserved without mutation.
- **SQLite cancellation persistence**: `cancel_job` now durably persists confirmed cancellation to SQLite via `db_manager.save_job` mirroring `complete_job` and `fail_job`.
- **Truthful cancellation response**: `cancel_mesh_generation` propagates real scheduler outcomes instead of forcing queue cancellation (`force=True`); accurately reports `cancelled=True` or `cancelled=False` with `cancel_requested=True`.
- **Frontend polling cancel sync**: `cancelExecution` updates `jobsById` and `jobsByIdRef.current` with `status: 'interrupted'`, preventing the polling loop from reactivating cancelled jobs.
- Docs updated: MEMORY, CHANGELOG.


