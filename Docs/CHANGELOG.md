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

## 2026-10-16 — End-to-End Pipeline Quality: Uncapped Geometry, glTF Tangents & PBR Normal Baking

- **PIPE-01**: Eliminated artificial `< 200,000` face clamp in `buildGenerationParameters.ts::shouldAutoOptimize()` and restored contract string `target_polycount`, enabling high-fidelity production budgets without silently disabling auto-optimize or falling back to preset defaults.
- **PIPE-02**: Corrected `_resolve_target_polycount_precedence()` in `mesh_generation.py` to give top-level explicit polycount targets (including `0` for Native/Raw) strict precedence over preset defaults.
- **PIPE-03**: Raised `MAX_PRODUCTION_FACES` in `postprocess/pipeline.py` to 2,000,000 faces, supporting high-density sculpting, VFX, and cinematic assets.
- **PIPE-04**: Ensured deterministic `NORMAL` attribute export in glTF GLBs by evaluating and caching `mesh.vertex_normals` across all model adapters (`trellis_adapter`, `triposg_adapter`), `simplify.py`, and `compute_angle_weighted_normals()` when `process=False` is used.
- **PIPE-05**: Added standard glTF 4-component tangent space generation (`compute_mesh_tangents`) and wired `TANGENT` vertex accessors into `_export_glb` via `tree_postprocessor` to eliminate UV seam shading artifacts in standard PBR viewers.
- **PIPE-06**: Explicitly configured OpenGL tangent space (`POS_X`, `POS_Y`, `POS_Z`) for normal map baking in `bake_worker.py` matching glTF 2.0 specifications.
- **PIPE-07**: Fixed UV gutter dilation bug in `bake_worker.py::fill_gutters()` for 2D grayscale textures (ambient occlusion, roughness, metallic), eliminating dark boundary seams around UV islands.
- **PIPE-08**: Verified 100% pass rate across TypeScript type checks (`bun run test`) and official model parity contracts (`pytest`).

