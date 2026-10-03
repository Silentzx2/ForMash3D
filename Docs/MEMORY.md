## 2026-10-03 Zero123++ Multi-View Architecture, Canonical Mesh Storage, Physics & Tripo Alignment
- Vendored upstream Zero123++ v1.2 into `backend/thirdparty/zero123plus` without `.git` repository metadata; verified authoritative PyTorch 2.6 / CUDA 12.4 environment. Dependency installation simplified via cleaned requirements without temp files.
- Canonical storage layout: models are stored in separate directories under `storage/models/meshes/<image_name>_<job_id>/`. Game-ready exports produce exclusively `glb` and `fbx` named `<image_name>_<job_id>.glb` and `<image_name>_<job_id>.fbx`. Legacy formats (`obj`, `stl`, `ply`, `gltf`) convert on-demand on download.
- Physics: replaced placeholder fallback with automatic CoACD multi-hull convex decomposition (`collision/collision.glb`) and rigid-body physical properties (`metadata/physics.json`).
- Model orientation: eliminated unwanted rotation matrix in TripoSG and aligned TripoSF to enforce upright Y-up coordinates in Three.js viewport.
- Adapter `Zero123PlusAdapter` encapsulates 6 novel viewpoints at 30° azimuth intervals (30°, 90°, 150°, 210°, 270°, 330°), deterministic request hashing (`source_sha256`, `request_sha256`), canonical storage in `storage/models/meshes/<safe_asset_name>_<job_id>/multiview/`, view masks, and on-demand ZIP delivery (`<stem>.zip`).
- Capability gate: 3D generation models default to `capabilities.multiview: false`. The frontend action button and backend router (`/reconstruct-3d`) enforce strict rejection when attempting multi-view 3D reconstruction with incompatible engines.
- Frontend: fixed `(h.artifacts.lods || []).slice is not a function` error by normalizing array and object LOD dictionaries; `MultiViewWorkspace.tsx` provides single-image automatic reuse, 6-view inspection gallery, full keyboard/mouse pan and zoom modal, advanced inference drawer, and manual view-set uploads.
- Verification: 32/32 tests passing 100% across test suite and clean TypeScript compilation (`npx tsc --noEmit` exit 0).

## 2026-10-03 Source Fidelity + Downstream Polycount Contract Hardening
- Root cause: target_polycount was intended as a post-process budget but was forwarded into adapters; TripoSG/TRELLIS/PartPacker could interpret it as an early decimation target.
- Fix: multiprocess_scheduler.py now builds a separate adapter-input dictionary and removes production-only budget/orchestration controls before _process_request().
- Maximum source fidelity: generation explicitly marks source_quality: max and uses the existing maximum geometry settings for each registered model. The visible quality selector no longer lowers source geometry.
- Canonical safety: master/source.glb is the untouched model-native checkpoint. Positive poly budgets are applied only in canonical post-processing; Native/Raw is target 0.
- Verification: Added scheduler firewall + frontend source-contract regression tests. NVIDIA/CUDA generation and visual comparison remain runtime-gated.

## 2026-10-03 Workspace Production Controls & Viewport Performance Pass
- **Retopology poly budget:** Added `target_polycount` to the mesh-retopology API and `RemeshSettings`. The FastMesh V1K/V4K target remains model-fixed; the new slider controls the final production triangle budget downstream.
- **Generation workflow recipes:** Added Mobile / Game Ready / Cinematic / Native presets that synchronize model quality, final triangle budget, LOD generation, and optional physics in one action.
- **Viewport artifact inspection:** Added quick switching between Game Ready, immutable Source, and generated LOD artifacts directly in the viewport.
- **Viewport performance modes:** Added Auto / Fast / Detail rendering modes that adjust pixel ratio and shadow cost, with automatic heavy-mesh detection preserved for the default mode.
- **Research basis:** Current Tripo, Meshy, and Hyper3D workflows emphasize integrated generation, remesh/retopology, texture, rigging/animation, artifact review, and fast post-generation controls; the implementation keeps only the useful local/self-hosted subset.
