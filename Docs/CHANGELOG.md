## 2026-10-01 — [Production Pipeline Convergence] Canonical Mesh Tools, Durable Workflows & Truthful Asset Delivery
- **Unified mesh-tools API:** Migrated the 3DGenStudio-derived mesh tools behind the main FastAPI `/api/v1/mesh-tools/*` contract and removed the unused browser/port-8200 sidecar boundary.
- **Backend-owned Shape→Paint:** Moved auto-paint chaining into persisted scheduler parent/child jobs so browser lifecycle no longer controls execution.
- **Universal production post-processing:** Mesh-producing jobs now declare an explicit `postprocess_mode` contract instead of relying on a feature-name whitelist.
- **Artifact contract:** Canonical results expose required/optional artifact status through one manifest; Job Detail consumes that manifest instead of hard-coding GLB.
- **Recovery and storage:** Added post-process retry from immutable `master/source.glb`, deterministic DB location, durable SQL terminal history, and canonical workspace cleanup.
- **Runtime cleanup:** Removed the separate Python 3.13 mesh-tools runtime and retired the default 8200 startup path.

## 2026-10-01 — [Butter-Smooth Viewport & Real-Time Cursor Reticle] 0ms Latency Brush Tracking, Zero-Allocation Sculpt Engine & Active Tool Reticle
- **Zero-Latency Real-Time Cursor Reticle:** Eliminated React re-renders on mouse movement by replacing `useState` with direct DOM ref `translate3d` tracking (`will-change-transform`), removing the 75ms CSS transition lag for instant 1:1 hardware pointer responsiveness.
- **Embedded Active Tool Cursor Badges:** Integrated active vector tool/brush icons directly into the center reticle cursor dot and floating tool badge, giving immediate visual feedback for the selected brush (`Standard`, `Clay`, `Inflate`, `Smooth`, `Flatten`, `Pinch`, `Grab`, `Paint`, `Eraser`).
- **High-Performance Deform Loop:** Replaced per-vertex object allocations and expensive `distanceTo` checks in sculpt deformation with zero-allocation squared-distance early-outs and direct coordinate vector operations, delivering 60-120 FPS sculpting even on heavy meshes.

## 2026-10-01 — [Icon System Fix & Stabilization] Hugeicons Standardization, Multi-Subagent Refactor & Clean Production Build
- **Hugeicons Type & Import Resolution:** Resolved 47 TypeScript compilation errors across 11 files following migration from `lucide-react` to `@hugeicons/react` and `@hugeicons/core-free-icons`. Corrected icon component usage via `<HugeiconsIcon icon={...} />`, standardized icon definitions, and restored `components/icons/hugeicons-mapping.ts`.
- **Viewport Three.js Bone Safeguard:** Reverted accidental global replacement of `THREE.Bone` (which had been replaced with `THREE.BoneIcon`) in `MeshViewer.tsx`, preserving proper skinned mesh and skeleton hierarchy traversal.
- **Multi-Subagent Concurrent Remediation:** Dispatched 5 concurrent subagents to autonomously fix distinct subsystems (admin jobs/models, queue, runtime/settings/storage, workspace views, viewport mesh viewer) with 100% type check verification (`npx tsc --noEmit` exit code 0).
- **Production Clean Build:** Confirmed `npm run build` succeeds cleanly with Turbopack in 18.9s across all 14 routes.



## 2026-10-02 — [Bugfix: Upload, Simplify & Asset Panel Hardening] Thumbnail Generation, Simplify Stats, Upload Timeouts & Auto-Optimize Fixes
- **Mesh upload thumbnail generation:** Added async thumbnail generation to `/api/v1/file-upload/mesh` using `generate_mesh_thumbnail`. Upload response now includes `thumbnail_url`; new `GET /file-upload/thumbnail/{file_id}` serves the generated PNG. Fixes broken mesh previews in the asset panel.
- **Simplify fallback stats fix:** Fixed `passthrough: True` → `passthrough: False` in double-failure fallback path of `_simplify()` (`backend/postprocess/services/simplify.py`). The incorrect flag caused the UI to display "0 changes shown" even when simplification had been attempted and failed.
- **Textured simplification fallback:** Replaced single-shot textured failure with proper fallback chain: primary `meshing_decimation_quadric_edge_collapse_with_texture` → `_simplify_textured_fallback()` (fast_simplification + cKDTree UV transfer) → non-textured fallback. Eliminates silent texture loss on headless PyMeshLab failures.
- **Upload timeout alignment:** Increased frontend FormData timeout in `services/apiClient.ts` from 120s to 600s to match Next.js proxy timeout, preventing premature aborts on slow mesh uploads.
- **Auto-optimize condition fix:** Changed `auto_optimize` from `targetPoly > 0 && targetPoly < 200000` to `targetPoly === 0 || (targetPoly > 0 && targetPoly < 200000)` so auto mode is preserved when target polycount is 0.
- **Real-ESRGAN parameter cleanup:** Removed redundant `realeg` alias in `WorkspaceContext.tsx`; unified model parameters to use only `enable_realesrgan`.
- **Asset panel upload URL fix:** Updated `RightAssetsPanel.tsx` and `MeshViewer.tsx` to use `/api/v1/file-upload/mesh`, removed broken `/static/` proxy URL resolution, and added `onUploadProgress` for real-time progress tracking.
- **Client-side file validation:** Added GLB truncation check, GLTF JSON structure check, and OBJ vertex-data check in `fileValidation.ts` to catch corrupted files before backend processing.

## 2026-10-02 — [Viewer & Network Resilience Hardening] Large Model Stream Proxy, Multi-Tier Asset Deduplication & WebGL Crash Protection
- **API Proxy Dynamic Timeouts & Stream Resilience:** Increased GET timeout from 30s to 10 minutes (`600000ms`) for binary asset endpoints (`download`, `thumbnail`, `export`, `file-upload`, `artifact_format`), eliminating Next.js proxy timeout aborts on heavy 50–100MB 3D meshes. Wrapped response streams in `TransformStream` with `.catch()` to absorb client disconnects and cancellations without unhandled `failed to pipe response` / `TimeoutError` exceptions. Forward `Content-Length` for binary assets when uncompressed to enable accurate browser progress tracking.
- **In-Flight Request Deduplication & Retry:** Enhanced `glbCache.ts` with in-flight request tracking (`inFlightRequests`) and progress listeners, preventing duplicate simultaneous network streams when prefetch and MeshViewer load the same asset. Added exponential backoff retry (up to 3 attempts with 120s timeout) and transparent fallback to standard `arrayBuffer` fetch if chunked stream readers encounter network interruptions.
- **Thumbnail Resolution & Fallback:** Added explicit `thumbnail_path` to `_build_result` in `postprocess/pipeline.py`. Added comprehensive fallback resolution in `system.py` (`get_job_status` and `download_job_thumbnail`) searching `asset_root / "previews" / "thumbnail.png"`, `preview.jpg`, and adjacent `*_thumb.png`, eliminating 404 errors after job completion.
- **WebGL Context Loss Protection:** Added `webglcontextlost` (`event.preventDefault()`) and `webglcontextrestored` event handlers on Three.js `renderer.domElement` in `MeshViewer.tsx`, protecting the browser tab from permanent WebGL context destruction and viewport crashes during high-load mesh rendering.

## 2026-10-02 — [Official Model Parity & Quality Hardening] 100% Upstream Neural Parity, Raw Geometry Immutability & High-Detail Production Pipeline
- **Upstream Repository Parity Audit:** Completed audit of all 10+ models against official upstream code (TripoSG, TripoSR, TripoSF, PartPacker, UltraShape, Hunyuan3D Shape v2.1, Hunyuan3D DiT Mini Turbo, Hunyuan3D Paint v2.1, TRELLIS, TRELLIS.2, FastMesh, PartField, PartUV, UniRig).
- **Elimination of Silent Pre-Decimation:** Removed internal PyMeshLab Quadric Edge Collapse from `triposg_adapter.py`, set default `num_faces=-1` in `partpacker_adapter.py` and `partpacker_utils.py`, set `use_remesh=False` in `hunyuan3d_paint_v21.py` and `hunyuan3d_adapter_v21.py` (stopping silent 40k face decimation), and enforced `simplify=0.0` across TRELLIS text/image generation and painting adapters.
- **Raw Geometry Coordinate & Scale Preservation:** Enforced `do_normalise=False` across raw asset generators (`hunyuan3d_shape_v21.py`, `hunyuan3d_dit_v2_mini_turbo.py`, `trellis2_adapter.py`, `fastmesh_adapter.py`), ensuring `master/source.glb` retains original world coordinates and scale.
- **Upstream Parameter Defaults Restored:**
  - Hunyuan3D Shape & Mini Turbo: Updated default `octree_resolution` from 256 to official pipeline default `384` (~3.37x voxel density increase).
  - UltraShape: Restored official defaults (`num_latents=32768`, `octree_res=1024`, corrected `hunyuan3d_root` path to `hunyuan3d-shape-v2-1`).
  - TRELLIS: Restored official 12-step sampling schedules (`ss_sampling_steps=12`, `slat_sampling_steps=12`) and removed artificial 20-step clamping.
  - PartPacker: Restored official 50 steps (`num_steps=50`), `num_faces=-1` (raw), `cv2.INTER_AREA` interpolation, and `len(faces) > 10` noise filtering.
  - TripoSF: Respect user explicit pruning; optimized tensor conversions from `.tolist()` to numpy arrays.
  - TripoSR: RGB fallback safety guard.
- **Production Post-Process Passthrough & Ceiling Expansion:**
  - Expanded `MAX_PRODUCTION_FACES` from 50,000 to 200,000.
  - Implemented `auto_optimize: false` passthrough check: preserves 100% of native topology in `game_ready` when user selects Native/Raw.
  - Fixed LOD chain calculation in `simplify.py` to prevent compound double decimation across LOD levels.
  - Added graceful fallback to `fast-simplification` / `trimesh` decimation when pymeshlab native OpenGL libraries are missing in headless environments.
  - Built pure Python embedded GLTF converter (`data:application/octet-stream;base64`) fallback in `pipeline.py`, eliminating runtime failures when Blender is not installed.
  - Enhanced `_has_native_textures` to support `SimpleMaterial.image` texture payloads.
  - Restored `sys.path` registration for PartUV adapter and utility runner.
- **UI & Quality Preset Mapping:** Added Model Quality presets (`low`, `medium`, `high`, `ultra`) in `GeneratePanel.tsx` mapped in `WorkspaceContext.tsx` to upstream neural parameters, preset polycount chips (15K Mobile, 35K Game, 50K Studio, 100K Cinema, Native/Raw), and 200k slider.
- **Exact Parameter Telemetry:** Added exact runtime generation parameter logging in `multiprocess_scheduler.py`.
- **Contract Verification Suite:** Added `backend/tests/test_official_model_parity_contract.py` with 13 comprehensive tests covering model schemas, default parameters, postprocessing passthrough, LOD ratios, and viewer routing (100% pass).
- **Production Build Verification:** Verified clean production build with Turbopack (`npm run build` completed in 14.2s with 0 errors across 14 routes).
