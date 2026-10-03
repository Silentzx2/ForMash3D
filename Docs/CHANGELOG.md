## 2026-10-03 — [Stability & Quality Hardening] Job Polling 404 Guard, Hunyuan3D Module Resolution, TripoSF VRAM Cap & Vertex Color Preservation
- Fixed client job polling 404 error on `GET /api/v1/system/jobs/{job_id}`: isolated client-side temporary `localTaskId` with `local_` prefix and `isLocal` flag, preventing the UI from issuing polling requests until bound to real Redis/scheduler job UUIDs.
- Fixed Hunyuan3D-Shape-v2-1 `ModuleNotFoundError: No module named 'hy3dshape.models'`: deleted bogus empty outer `__init__.py`, added automatic detection and `__path__` binding in `hunyuan3d_shape_v21.py` so dynamic submodule loading functions cleanly.
- Fixed TripoSF model weights double-path bug: normalized `model_path` resolution across `backend/adapters/triposf_adapter.py` and `triposg_adapter.py` to prevent redundant `backend/backend/` nested paths when CWD is `backend/`.
- Fixed TripoSF OOM / 5.22 GiB VRAM allocation bug: enabled `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`, added free-memory detection with automatic 409,600 sample points and 256 resolution caps under tight VRAM (<=16GB), and enforced cache cleaning before/after voxelization and inference.
- Fixed detail smoothing and texture/color loss on Tripo models: enhanced `_has_native_textures` to detect vertex colors and preserve them through `repair.py` (`vc[used]`), `simplify.py`, and `pipeline.py` without destructive auto-uv decimation.
- Consolidated duplicate recipe and polycount UI elements in `GeneratePanel.tsx` into a single, unified "Target & Polycount Budget" card.

## 2026-10-03 — [Multi-View, Storage & Physics Engine] Zero123++, Canonical Storage Layout, Real CoACD Physics & Tripo Fixes
- Integrated Zero123++ v1.2 (`backend/thirdparty/zero123plus`) under `image_to_multiview` feature type with complete isolation from general 3D model selectors (`hidden_from_model_selector: true`), interactive 6-view inspection gallery (`MultiViewWorkspace.tsx`), pan/zoom modal, and capability gating.
- Re-architected storage hierarchy: models now reside in dedicated subdirectories under `backend/storage/models/meshes/<image_name>_<job_id>/` with canonical filenames `<image_name>_<job_id>.glb` and `<image_name>_<job_id>.fbx`.
- Streamlined game-ready exports: pre-generate exclusively `glb` and `fbx` (Unity engine standard) in `game_ready/`, with on-demand conversion for `obj`, `stl`, `ply`, and `gltf` upon user download request.
- Fixed physics placeholder issue: enabled default CoACD convex decomposition generating genuine multi-part collision hulls (`collision/collision.glb`) and rigid-body physical properties (`metadata/physics.json`).
- Fixed Tripo model orientation: removed erroneous rotation transform from TripoSG and aligned TripoSF to enforce upright Y-up coordinates in the Three.js viewport.
- Resolved frontend generation completion error (`(h.artifacts.lods || []).slice is not a function`) by normalizing dictionary vs array LOD artifacts. Full contract and unit test suite passes 100% (32/32 tests).

## 2026-10-03 — [Source Fidelity Contract] Maximum-Quality Generation + Downstream Poly Budget
- Fixed the critical generation contract: the UI polycount is strictly a **post-generation production budget**.
- The scheduler strips target_polycount, auto_optimize, LOD, physics, and auto-paint controls before neural adapter inference, preventing adapters such as TripoSG/TRELLIS/PartPacker from pre-decimating the source.
- Image/text generation now requests maximum supported geometry fidelity regardless of visible output-quality/polycount controls; those controls affect texture/output settings only.
- master/source.glb remains byte-for-byte immutable; Native/Raw now uses a stable 0 sentinel.
- Added regression coverage for the scheduler input firewall and frontend max-source contract.

## 2026-10-03 — [Workspace Production UX] Poly Budget, Recipes, Artifact Review & Performance
- Added a real final triangle-budget slider to Remesh/Retopology and wired `target_polycount` through the API into canonical post-processing.
- Added production recipes for Mobile, Game Ready, Cinematic, and Native workflows, applying mesh quality, poly budget, LOD, and physics together.
- Added viewport artifact switching for Source/Game Ready/LOD0–LOD3 plus Auto/Fast/Detail performance modes for heavy meshes.
- Kept FastMesh V1K/V4K model contracts intact; the new budget acts only on the downstream production artifact.
