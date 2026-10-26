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
