## 2026-10-03 — [Production-Ready SOTA Asset Pipeline & Single All-in-One Docker Engine]
- Implemented High-to-Low micro-detail and normal map baking in `backend/postprocess/pipeline.py`: rays cast from decimated/game-ready mesh UVs onto the immutable high-poly master sculpt (`source.glb`), extracting tangent-space normal maps, ambient occlusion, and ORM channels into `textures/`, and embedding them directly into the game-ready GLB material.
- Added UI Micro-Detail Normal Map Baking toggle to `GeneratePanel.tsx` under the Target & Polycount Budget card, wired through `features/workspace/store/WorkspaceContext.tsx` and protected by `_POSTPROCESS_ONLY_INPUTS` scheduler firewall.
- Designed and implemented Single All-in-One Docker Image (`Dockerfile`, `Dockerfile.runpod`, `supervisord.conf`, `docker-compose.yml`):
  - Bundles CUDA 12.4, headless Blender 4.3+, embedded Redis (port 6380), complete Conda environment (`3daigc-api` with PyTorch 2.6.0+cu124 and all model weights/adapters), FastAPI backend (port 7842), and pre-built Next.js frontend (port 3000) into a single, fully portable, self-contained container.
  - Auto-activates Conda environment on container shell entry (`docker exec -it formash3d bash` / `./manager.sh docker-shell`) for seamless debugging and offline portability (`docker save`).
- Built complete Docker management lifecycle directly into `manager.sh`: interactive menu option `[9] Docker Engine` and CLI commands (`docker`, `docker-build`, `docker-run`, `docker-stop`, `docker-logs`, `docker-shell`, `docker-export`).
- Enhanced test coverage across all modules (63 passed, 3 skipped, 0 failed), passing `npx tsc --noEmit` with 0 errors.

## 2026-10-03 — [Generation Quality, Scene Transforms & Runtime]
- Fixed scene-graph transforms being ignored when multi-part GLBs were flattened; transforms now apply in world space, with explicit errors for unsupported scenes. Added textured multi-part round-trip and end-to-end checks.
- Fixed TripoSR's false texture-success path, TRELLIS.2's missing-voxel untextured fallback, TripoSF's proxy-mesh success fallback, and Hunyuan Paint reference-image aspect distortion.
- Corrected Compose build context, model-weight/storage mounts, and root build-context exclusions. Backend suite: 75 passed, 3 skipped; front-end TypeScript, Compose config, and diff checks pass.

## 2026-10-03 — [Deep Audit & Contract Verification] Multi-View 3D Reconstruction Wiring & Zero-Gap Validation
- Wired frontend Multi-View 3D reconstruction dispatch in `features/workspace/store/WorkspaceContext.tsx`: when a multi-view capable 3D model is active and multi-view views/assets exist, the generation pipeline now dispatches directly to `POST /api/v1/multiview/reconstruct-3d` with full topology, quad mesh, and physics options instead of falling back to single-image endpoints.
- Added manager options for Zero123++ weights and the optional normals ControlNet, and made the model readiness API report Zero123++ checkpoints as downloadable.
- Moved generated/manual Multi-View workspaces under configurable `storage/models/meshes/`, kept legacy asset lookup, and routed view-image URLs through the static proxy.
- Verified complete alignment with `Docs/TASKS.md` across Zero123++ v1.2 vendor isolation, canonical `<image_name>_<job_id>/` storage hierarchy, pre-generated GLB/FBX, capability gating, Tripo orientation & VRAM protection, and job polling 404 guards. Full backend suite: 67 passed, 3 runtime-gated skips; TypeScript check passes.
- Verified TypeScript build (`npx tsc --noEmit`) passes with 0 errors and all 32 backend contract & unit tests pass.

## 2026-10-03 — [Stability & Quality Hardening] Job Polling 404 Guard, Hunyuan3D Module Resolution, TripoSF VRAM Cap & Vertex Color Preservation
- Fixed client job polling 404 error on `GET /api/v1/system/jobs/{job_id}`: isolated client-side temporary `localTaskId` with `local_` prefix and `isLocal` flag, preventing the UI from issuing polling requests until bound to real Redis/scheduler job UUIDs.
- Fixed Hunyuan3D-Shape-v2-1 `ModuleNotFoundError: No module named 'hy3dshape.models'`: deleted bogus empty outer `__init__.py`, added automatic detection and `__path__` binding in `hunyuan3d_shape_v21.py` so dynamic submodule loading functions cleanly.
- Fixed TripoSF model weights double-path bug: normalized `model_path` resolution across `backend/adapters/triposf_adapter.py` and `triposg_adapter.py` to prevent redundant `backend/backend/` nested paths when CWD is `backend/`.
- Fixed TripoSF OOM / 5.22 GiB VRAM allocation bug: enabled `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`, added free-memory detection with automatic 409,600 sample points and 256 resolution caps under tight VRAM (<=16GB), and enforced cache cleaning before/after voxelization and inference.
- Fixed detail smoothing and texture/color loss on Tripo models: enhanced `_has_native_textures` to detect vertex colors and preserve them through `repair.py` (`vc[used]`), `simplify.py`, and `pipeline.py` without destructive auto-uv decimation.
- Consolidated duplicate recipe and polycount UI elements in `GeneratePanel.tsx` into a single, unified "Target & Polycount Budget" card.
