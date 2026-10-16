## 2026-10-16 — Unique3D Model Pipeline Loader & Torchvision Compatibility Fix

- **LOAD-01**: Fixed `NameError: name 'load_pipeline' is not defined` in [`backend/adapters/unique3d_adapter.py`](file:///workspaces/ForMash3D/backend/adapters/unique3d_adapter.py#L132-L145): imported `load_pipeline` from `app.custom_models.utils` directly after `self._ensure_unique3d_in_path()` adds Unique3D directories to `sys.path`.
- **LOAD-02**: Fixed `torchvision_fix not applied: No module named 'utils.torchvision_fix'` warning in [`backend/adapters/unique3d_adapter.py`](file:///workspaces/ForMash3D/backend/adapters/unique3d_adapter.py#L120-L135): resolved `backend/utils/torchvision_fix.py` dynamically via `importlib.util.spec_from_file_location` to prevent namespace collisions with Unique3D's internal `app/utils`.
- **TEST-01**: Verified TypeScript type contracts (`bun run test`), workspace node test suite (24/24 passing), and generation dependency contract suite (`pytest backend/tests/test_generation_dependency_contract.py`).

## 2026-10-16 — Topology Wireframe Crash Fix, Mini Turbo Volume Decoding Acceleration & Immediate Viewport Loading

- **VIEW-06**: Fixed shader switching and topology wireframe renderer crash in `MeshViewer.tsx`. Added `child.userData?.isWireframeOverlay` guard to prevent recursive `group.traverse` duplication and material overwrites. Added full support for `THREE.SkinnedMesh` wireframe overlays (binding `skeleton` and `bindMatrix`) and wrapped the WebGL animation render loop in safe exception handling to prevent any unhandled error boundary crashes.
- **VIEW-07**: Fixed wireframe overlay geometry double-disposal in `MeshViewer.tsx`: scene clearing now disposes only overlay materials while preserving parent mesh geometry.
- **PERF-01**: Accelerated Hunyuan3D-DiT-v2-mini-Turbo volume decoding by ~4–8x: raised `num_chunks` default from 20,000 to 80,000, reducing sequential chunk loop iterations from 2,766 down to ~345 on GPU.
- **GEN-01**: Fixed model ID format mismatch in `features/workspace/utils/buildGenerationParameters.ts` by normalizing IDs (hyphen/underscore agnostic); correctly assigns official `octree_resolution: 380`, `num_inference_steps: 5`, and `num_chunks: 80000`, eliminating backend resolution clamping warnings and generation latency.
- **GEN-02**: Aligned backend scheduler max quality presets in `backend/core/scheduler/multiprocess_scheduler.py` for Mini Turbo (`octree_resolution: 380`, `num_chunks: 80000`) and enhanced `WorkspaceContext.tsx` to immediately select and load generated meshes in the 3D viewport without indefinite loading spinners.

## 2026-10-16 — Instant Mesh Drag-and-Drop Preview, Live Progress HUD & Camera Stability

- **VIEW-01**: Implemented instant optimistic 3D preview on drag-and-drop: dropping a 3D mesh (`GLB`, `GLTF`, `OBJ`, `PLY`, `STL`, `FBX`) in `MeshViewer` immediately generates a local object URL and renders the geometry in milliseconds without waiting for server network upload.
- **VIEW-02**: Added prominent floating live upload progress bar UI overlay in the viewport tracking cloud storage saving from 0% to 100%, completing with an emerald confirmation badge before smooth auto-dismissal.
- **VIEW-03**: Seamless backend asset handoff: upon backend upload completion, canonical asset metadata is merged while preserving `localUrl` and scene references, completely eliminating redundant re-downloads, re-parsing, and viewport flickering.
- **VIEW-04**: Fixed camera direction snapping and forced resetting while orbiting: `frameCamera` now preserves manual user orbit angles (`camera.position - controls.target` vector) rather than forcing direction to `(1, 0.4, 1)`. Added user interaction guards (`start`/`end` OrbitControls listeners) and guarded `animCameraPreset` sync against unsolicited resets.
- **VIEW-05**: Fixed pyrender EGL headless context cleanup error `GLError(err = 12289, baseOperation = eglDestroyContext)` in `backend/core/utils/thumbnail_utils.py` by adding thread synchronization (`_RENDER_LOCK`), safe `try...finally` renderer cleanup, and a reliable 2.5D isometric projected dark studio thumbnail generator that guarantees thumbnail endpoints never fail or return HTTP 404.

