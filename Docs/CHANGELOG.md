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

## 2026-10-16 — Quality Rendering, Three.js PBR Pipeline & Pro Studio UI/UX

- **PBR-01**: Enhanced Three.js PBR rendering pipeline with configurable tone mapping (Khronos Neutral for color fidelity & ACES Filmic for high-contrast film curves), balanced exposure calibration, studio three-point lighting, and dynamic key light shadow camera frustum scaling for crisp 2048x2048 contact shadows.
- **PBR-02**: Integrated automatic tangent space computation (`computeTangents()`) and vertex normal verification in `meshTelemetry.ts` for all GLTF, FBX, OBJ, PLY, and STL assets, ensuring artifact-free micro-relief normal and bump mapping.
- **PBR-03**: Polished studio material shading presets (Studio Matte Clay with clearcoat, Porcelain Ceramic Gloss, 24K Metallic Gold, Chrome Mirror, High-Contrast Tangent Normals) and introduced authentic non-destructive Wireframe on Shaded overlay with polygonOffset depth calibration.
- **UI-04**: Added Pro Studio Fidelity & Crease Preservation controls to `GeneratePanel.tsx`: Sharp Feature Preservation toggle, Angle Crease Threshold slider (30° - 85°), High-Resolution Normal Baking, Texture Fidelity Presets (Ultra 4K to Compact 512), and live density/precision indicators.
- **UI-05**: Built real-time geometry & topology telemetry into `RightPropertyPanel.tsx`, `ViewportToolOverlay.tsx`, and `MeshViewer.tsx`: manifold edge verification (watertight vs non-manifold edge counts), vertex/polygon counts, disjoint UV chart counting, surface area ($m^2$), and signed enclosed volume ($m^3$).
- **TEST-06**: Added unit test suite `features/workspace/lib/meshTelemetry.test.mjs` verifying surface area, volume, non-manifold edge detection, and tangent generation across 24 passing tests.

