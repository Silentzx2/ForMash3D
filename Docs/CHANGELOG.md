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

## 2026-10-26 — Raw mesh fidelity preservation, scheduler timeouts and geometry repairs

- **Raw mesh detail preservation across AI models**:
  - `MeshProcessor.save_mesh`: Set default `crease_angle_deg=None` so raw GLB export preserves native sharp geometric normals rather than overwriting vertices with angle-weighted smoothed clusters.
  - Hunyuan3D-2.1 (`hunyuan3d_decoder_profile.py`, `hunyuan3d_shape_v21.py`, `hunyuan3d_dit_v2_mini_turbo.py`): Restored `FlashVDM` decoder support with dynamic `dmc` (Dual Marching Cubes via `diso`) / `mc` fallback; disabled automatic normal smoothing.
  - Unique3D (`scripts/multiview_inference.py`): Disabled `apply_smooth` (Laplacian smoothing) and `apply_sub_divide` (Loop subdivision) in `simple_clean_mesh` to prevent melting hard features.
  - Pixal3D (`pixal3d_adapter.py`): Set `remesh=False` in raw GLB export to avoid surface relaxation.
  - TRELLIS.2 (`trellis2_adapter.py`, `trellis2_utils.py`): Enforced `max_num_tokens=524288` to prevent cascade resolution from silently falling back from 1536 to 512.
- **TRELLIS 1 geometry repair and subtle smoothing**:
  - `trellis_adapter.py`: Added automatic topological hole filling (`trimesh.repair.fill_holes`, winding, normal fixes) and two iterations of volume-preserving Taubin smoothing (`filter_taubin(lamb=0.3, nu=-0.34, iterations=2)`) to eliminate sparse-voxel needle spikes and boundary cracks while keeping sharp details intact.
- **Worker initialization timeout extension**:
  - `multiprocess_scheduler.py`: Increased `max_load_timeout` default from 600s to 1800s (30m) for heavy models (`trellis`, `hunyuan`, `unique3d`, `pixal`, `taoflow`) to prevent premature worker SIGKILL during large weight downloads and Kaggle/cloud disk initialization.

## 2026-10-24 — Postprocess texture, retopo fidelity and viewer shading guards

- Auto-rig job scheduling now uses the canonical streaming SHA-256 helper instead of importing a deleted private pipeline symbol.
- Textured GLBs receive safe metallic/roughness defaults only when omitted for albedo-only materials; UVs and degenerate base-colour atlases are checked before the texture stage is marked complete. Final game-ready export preserves the painter's original GLB scene/material bindings instead of flattening and re-exporting it.
- Auto-retopology now rejects candidates that exceed the configured normalized surface-drift gate, allowing pipeline callers to retain the previous valid derivative. Invalid imported vertex normals are recomputed, and wireframe shading uses a depth-writing surface so rear edges do not masquerade as internal duplicate geometry.
- Regression tests cover the hash import contract, retopo drift rejection, GLB JSON chunk preservation, and invalid viewport normals. Tests are added; runtime/CI results must be checked separately.

## 2026-10-23 — Production readiness verification

- All test gates green: backend `pytest` 40 passed / 6 skipped, Bun frontend 54 passed / 0 failed, `npx tsc --noEmit` zero errors; no mock data is served by production API paths.
- Auth removed entirely from backend + frontend (personal/self-hosted use, no paid SaaS).
- Feature improvements: quad topology, multi-variant candidates (1-4), part segmentation presets (3-6/6-15/15+), rig types, export formats, 3D print slicer handoff, quad-compatible smart UV.
- `dev` verified ahead of `upstream/dev` and pushed to `origin/dev`.

## 2026-10-22 — Quality, topology and artifact contracts

- Final topology and master-drift checks now affect production status; missing required comparisons do not silently pass. Auto-Repair OFF preserves geometry, safe hole repair uses configured limits, and remaining defects are reported.
- Collision decomposition failures preserve render geometry and expose the convex-hull fallback method/reason. Artifact hashing uses the canonical streaming helper.
- Added regression coverage for topology, quality gates, collision artifact isolation, configured limits and artifact hashes.

## 2026-10-22 — Generation request and adapter ownership

- Sample SVGs now rasterize to PNG and use the existing upload path. Explicit model choice is retained, seed zero is preserved, and production controls remain separate from adapter-owned inference profiles.
- Adapter profile filtering/schema alignment and request-isolation tests were added without retuning active inference schedules. The unresolved TRELLIS requested/effective step mismatch remains approval-gated.
- Removed the disconnected jiggle/deformation control; documentation now distinguishes collision preparation from live simulation.
