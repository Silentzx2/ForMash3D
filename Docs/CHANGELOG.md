## 2026-10-16 — Instant Mesh Drag-and-Drop Preview, Live Progress HUD & Camera Stability

- **VIEW-01**: Implemented instant optimistic 3D preview on drag-and-drop: dropping a 3D mesh (`GLB`, `GLTF`, `OBJ`, `PLY`, `STL`, `FBX`) in `MeshViewer` immediately generates a local object URL and renders the geometry in milliseconds without waiting for server network upload.
- **VIEW-02**: Added prominent floating live upload progress bar UI overlay in the viewport tracking cloud storage saving from 0% to 100%, completing with an emerald confirmation badge before smooth auto-dismissal.
- **VIEW-03**: Seamless backend asset handoff: upon backend upload completion, canonical asset metadata is merged while preserving `localUrl` and scene references, completely eliminating redundant re-downloads, re-parsing, and viewport flickering.
- **VIEW-04**: Fixed camera direction snapping and forced resetting while orbiting: `frameCamera` now preserves manual user orbit angles (`camera.position - controls.target` vector) rather than forcing direction to `(1, 0.4, 1)`. Added user interaction guards (`start`/`end` OrbitControls listeners) and guarded `animCameraPreset` sync against unsolicited resets.
- **VIEW-05**: Fixed pyrender EGL headless context cleanup error `GLError(err = 12289, baseOperation = eglDestroyContext)` in `backend/core/utils/thumbnail_utils.py` by adding thread synchronization (`_RENDER_LOCK`), safe `try...finally` renderer cleanup, and a reliable 2.5D isometric projected dark studio thumbnail generator that guarantees thumbnail endpoints never fail or return HTTP 404.

## 2026-10-16 — Unified Dependency Architecture & Model Downgrade Prevention

- **DEP-01**: Centrally locked unified baseline in `backend/requirements.txt`: `transformers==5.10.1`, `diffusers==0.38.0`, `huggingface_hub>=1.5.0,<2.0`, `datasets==3.6.0`, `fastapi>=0.109.0`, and `uvicorn[standard]>=0.27.0`.
- **DEP-02**: Removed conflicting standalone `huggingface_hub` installation block from `backend/scripts/install.sh`, allowing `backend/requirements.txt` to act as the authoritative single source of truth.
- **DEP-03**: Cleaned thirdparty requirement files across `Unique3D`, `hunyuan3d-shape-v2-1`, `hunyuan3d-paint-v2-1`, `hunyuan-requirements.txt`, and `Pixal3D` in `Silentzx2/ForMash3D-ThirdParty` to eliminate conflicting downgrade pins (`transformers`, `fastapi`, `gradio`, `datasets==2.14.5`).
- **DEP-04**: Fixed syntax & flow bugs in `backend/scripts/install.sh`: closed missing `fi` on TripoSG block, corrected natten wheel installation check, and fixed relative `requirements.txt` path at line 744.
- **DEP-05**: Updated `backend/tests/test_generation_dependency_contract.py` to assert new unified baseline versions; 100% test pass rate achieved across all 50 pytest tests.

## 2026-10-16 — Raw Mesh Quality, Nelson Max Crease Splitting & High-to-Low Normal Baking

- **RAW-01**: Implemented Nelson Max (1999) corner-angle-weighted vertex normal computation and dihedral crease splitting (`compute_angle_weighted_normals`, `apply_angle_weighted_normals`) across `core/mesh_processor.py`, `postprocess/meshio.py`, and extraction adapters (`triposg_adapter.py`, `trellis_adapter.py`). Dihedral angles > 35° split vertices to guarantee crisp orthogonal shading across sharp edges, while continuous curved surfaces (spheres, cylinder mantles) remain smooth.
- **RAW-02**: Enforced non-destructive mesh loading with `process=False` across `MeshProcessor.load_mesh`, `file_utils.validate_mesh_file`, `postprocess/pipeline.py`, and `trellis_adapter.py`, stopping silent automatic welding of coincident vertices across sharp edges.
- **RAW-03**: Implemented feature-preserving decimation (`feature_preserving_decimate`) with boundary edge quadric penalties, crease plane preservation, and normal deviation protection (<= 45°), wired as the primary fallback simplification engine in `postprocess/services/simplify.py`.
- **RAW-04**: Upgraded `backend/core/utils/file_utils.py` with `MAX_MESH_VERTICES` and `MAX_MESH_FACES` raised to 10,000,000 (configurable via `FORMASH_MAX_MESH_VERTICES` / `FORMASH_MAX_MESH_FACES`), preventing validation rejection of ultra-high-resolution raw extractions.
- **RAW-05**: High-to-low normal map baking upgrades:
  - In `bake_worker.py`: enforced tangent space (`POS_X`, `POS_Y`, `POS_Z`), MikkTSpace tangents (`low.data.calc_tangents()`), bounded `max_ray_distance = max(0.001, cage * 2.5)`, and neutral normal fallback `(128, 128, 255)` on unhit pixels with fully dilated gutters.
  - In `bake.py`: implemented `bake_high_to_low_pure_python` fallback using UV rasterization, MikkTSpace-compatible tangent basis generation, cKDTree high-poly surface projection, and Euclidean distance transform gutter dilation when headless Blender is unavailable.
- **RAW-06**: Implemented non-destructive raw native passthrough in `backend/postprocess/pipeline.py`: when `resolved_target_polycount == 0` and not `auto_optimize`, master raw GLB bytes are preserved byte-for-byte with optimal normals, bypassing destructive re-tessellation.
- **RAW-07**: Added comprehensive test suite `backend/tests/test_raw_mesh_quality_preservation.py` verifying cube and cylinder crease splitting, feature-preserving decimation, MikkTSpace normal baking, and raw byte-for-byte passthrough.

