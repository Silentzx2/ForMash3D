# Quad-Dominant Topology & Export Evaluation (Task 3F)

## Executive Summary
This document provides a comprehensive evaluation of **quad-dominant topology and export capabilities** in ForMash3D, benchmarked against commercial cloud solutions such as **Tripo AI (v2.0/v2.5)** and **Deemos Rodin (Gen-2)**.

**Status:** **Report-Only Evaluation** (No disruptive code modifications introduced, in strict compliance with `RULES.md` and task constraints).

### Current status (re-verified against the repository)

The findings below were re-checked against the current code. The quad-dominant path is still implemented as described, with these corrections to the original report:

- The quad conversion entry point is the **AutoRetopo service** (`backend/postprocess/services/auto_retopo.py` → `backend/postprocess/services/autoretopo/`), which the post-processing pipeline calls with `AutoRetopoOptions(quads=True)`. The actual triangle-to-quad conversion is MeshLab's curvature-aware smart triangle pairing in `autoretopo/remesh.py::to_quad_dominant`. `quadriflow_remesh()` exists in the same module but is **never called by the pipeline** — it is an unused optional helper.
- The original report cited the QuadriFlow path as one of two live "quad approaches" and stated that `quadriflow_available()` "evaluates to `False` in standard environments". The function only checks `shutil.which("quadriflow")`; it is environment-dependent, and the quad path does not depend on it. No `quadriflow` binary is bundled in the repository.
- **FastMesh is a separate model adapter, not the pipeline's quad conversion tool.** `backend/adapters/fastmesh_adapter.py` runs learned retopology at fixed V1K/V4K vertex targets; its `poly_type="quad"` branch calls `MeshProcessor.tri2quad()`, which imports the unbundled `meshiki` package. It is not part of the AutoRetopo quad path, and `meshiki` is not in `backend/requirements.txt`, so that branch still raises `ModuleNotFoundError` in a standard install.
- All timings, quad percentages and VRAM figures in the comparative table of the original report were **not** reproducible from the repository and have been replaced with statements of what the code actually does. The repository contains functional unit tests for the quad path (`backend/tests/test_cancellation_and_quad.py`) but no quad-topology quality benchmark or measurement.

### Key Takeaways:
1. **Existing Architecture is Already Well-Designed:** ForMash3D already implements a working quad-dominant generation and export path:
   - Generation requests accept `topology_mode: "quad"` or `quad_topology: true`.
   - The AutoRetopo engine performs curvature-aligned triangle pairing (`remesh.to_quad_dominant`).
   - The optimization stage preserves quad topology via a passthrough guard (`Passthrough: Quad-dominant topology preserved from retopology pass`).
   - The pipeline exports the polygonal face list produced by the quad conversion in Wavefront OBJ format via `_export_quad_obj` (`game_ready/{base_name}.obj` and `game_ready["quad_obj"]`). The list is quad-dominant, not guaranteed to be 100% quads — MeshLab leaves remnant triangles where the topology cannot be paired.
2. **GLB vs. OBJ Specification Divide:** Game engines (Unreal Engine 5, Unity), web runtime viewers (Three.js, Babylon.js), and the official **glTF 2.0 specification strictly require triangle primitives**. Exporting quad polygons in GLB is invalid by specification. Therefore, the architectural separation in ForMash3D—**pure triangles for runtime GLB, polygonal quads for authoring OBJ**—is the industry standard and correct approach.
3. **Gaps Identified in Auxiliary Adapters:** FastMesh's `poly_type="quad"` route relies on an unbundled, uninstalled third-party library (`meshiki`), and `remesh.quadriflow_remesh` shells out to an unbundled `quadriflow` binary on PATH (that helper is not wired into the pipeline at all). Both can be enhanced gracefully without disrupting the core pipeline.

---

## 1. Industry Context & User Expectations

Commercial AI generation platforms (Tripo AI, Rodin, Meshy) prominently feature "Quad Retopology" or "Clean Topology" toggles. Understanding artist expectations vs. runtime realities is critical:

| Use Case | Artist / Studio Expectation | Engine / Hardware Reality |
|---|---|---|
| **Digital Sculpting & Sub-D** | Catmull-Clark subdivision surfaces in Blender, Maya, or ZBrush require 4-sided faces (quads) to avoid pinched vertices, star poles, and smoothing artifacts. | Offline authoring only. |
| **Skeletal Rigging & Skinning** | Edge loops must contour around organic joints (shoulders, elbows, knees, jawlines) to bend without creasing or collapsing volume. | Deformations in game engines execute on triangulated GPU vertex buffers. |
| **Game Engines (UE5, Unity)** | Ingest FBX or GLB assets. | Engines automatically triangulate non-triangle polygons during asset import or shader vertex compilation. |
| **Web 3D & Mobile Viewers** | Fast loading, low memory, direct WebGL/WebGPU rasterization. | Modern GPU rasterizer hardware only operates on triangles (`GL_TRIANGLES`). |

---

## 2. Analysis of Existing ForMash3D Implementation

### 2.1 Post-Processing Pipeline (`backend/postprocess/pipeline.py`)

ForMash3D's post-processing pipeline contains mature infrastructure for quad retopology:

1. **Request Intake:**
   The mesh-generation and smart-generation routers parse `topology_mode` (`"triangle"` | `"quad"`) and boolean `quad_topology` (`backend/api/routers/mesh_generation.py`, `backend/api/routers/smart_generation.py`). The routes are mounted as `POST /api/v1/mesh-generation/image-to-raw-mesh` (plus `/image-to-textured-mesh`, `/generate-mesh-from-image`) and `POST /api/v1/smart-generation/generation`; the original report's `/api/v1/generate/mesh/...` paths do not exist in the current router tree.
2. **AutoRetopo Quad Trigger (`backend/postprocess/pipeline.py:1906`):**
   ```python
   if is_quad_requested:
       repaired, retopo_tool_stats, _ = run_auto_retopo(
           repaired,
           AutoRetopoOptions(
               target_faces=retopo_target,
               quads=True,
               ...
           )
       )
   ```
   `is_quad_requested` is true when either `topology_mode == "quad"` or `quad_topology` is set in the job metadata or the job inputs (`backend/postprocess/pipeline.py:1897`).
3. **Smart Decimation Passthrough (`backend/postprocess/pipeline.py:2052`):**
   A critical design choice in ForMash3D prevents a common pitfall in automated pipelines: running Quadric Error Metric (QEM) decimation *after* quad pairing, which immediately tears quads back into uneven triangles. ForMash3D guards this:
   ```python
   if is_quad_requested and retopo_stats.get("status") == "completed":
       optimized = repaired
       optimize_stats = {"passthrough": True, "reason": "Quad-dominant topology preserved from retopology pass"}
   ```
4. **Polygonal Wavefront OBJ Serialization (`backend/postprocess/pipeline.py:846` and `:2433`):**
   `_export_quad_obj(mesh, quad_faces)` serializes vertex coordinates (`v`), vertex textures (`vt`), and vertex normals (`vn`), followed by polygonal face definitions:
   ```text
   f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 v4/vt4/vn4
   ```
   The `v/vt/vn` index triplets are only emitted when the source mesh actually carries UVs and normals; otherwise the exporter falls back to `v/vt`, `v//vn` or plain `v` indices. The file is saved to `game_ready/{base_name}.obj` and recorded under both the `obj` and `quad_obj` keys in database persistence and file downloads.

### 2.2 AutoRetopo Quad Algorithm (`backend/postprocess/services/autoretopo/remesh.py`)

The AutoRetopo pipeline (`backend/postprocess/services/autoretopo/pipeline.py`) runs ingest → watertight shell → field-adaptive remesh → silhouette projection → optional quad conversion → metrics. The quad stage is:
- **MeshLab Curvature-Aware Smart Triangle Pairing (`to_quad_dominant`):**
  Uses `meshing_edge_flip_by_curvature_optimization` followed by `meshing_tri_to_quad_by_smart_triangle_pairing`. It returns the polygonal face list via `polygonal_face_list()` when MeshLab exposes it. The pairing is expected to leave remnant triangles where the topology cannot be paired, but the code does **not** assert a fixed quad percentage — the run reports the raw `quad_face_count` in the AutoRetopo stats (`backend/postprocess/services/auto_retopo.py`), and no quad-ratio target is configured anywhere in the repository. If the conversion raises, the pipeline logs the failure and keeps the triangle mesh.
- **QuadriFlow Integration (`quadriflow_remesh`):**
  An optional shell-out to an external `quadriflow` binary (`quadriflow -i in.obj -o out.obj -f <target_faces>`).
  - *Current Status:* `quadriflow_available()` only reports whether `quadriflow` is on `PATH`; the binary is not bundled in this repository, and **the function is never called by the AutoRetopo pipeline**. The quad path is entirely served by the MeshLab pairing above.

### 2.3 FastMesh Adapter (`backend/adapters/fastmesh_adapter.py` & `backend/core/mesh_processor.py`)

- FastMesh is a **separate learned-retopology model adapter**, not the pipeline's quad conversion tool. It outputs neural-reconstructed triangle meshes at fixed vertex targets (V1K = 1,000 vertices, V4K = 4,000 vertices).
- When `poly_type == "quad"`, the adapter invokes `self.mesh_processor.tri2quad(output_path)` (`backend/adapters/fastmesh_adapter.py:199`).
- In `backend/core/mesh_processor.py`:
  ```python
  @staticmethod
  def tri2quad(mesh_path: str):
      """Convert triangles to quads in-place."""
      from meshiki import Mesh
      mesh = Mesh.load(mesh_path, verbose=False)
      mesh.quadrangulate()
      mesh.export(mesh_path)
  ```
  - *Current Status:* `meshiki` is not in `backend/requirements.txt` and is not installed in the environment. Attempting to use FastMesh with `poly_type="quad"` results in a `ModuleNotFoundError: No module named 'meshiki'`.

---

## 3. Comparative Evaluation: Pure Tri-Meshes vs. Quad Options

| Evaluation Metric | Option A: Pure Triangles (Current Default) | Option B: Curvature-Paired Quad-Dominant (MeshLab / Current) | Option C: Field-Aligned Pure Quads (QuadriFlow / Instant Meshes) | Option D: Neural Native Quads (FastMesh; TaoFlowForge — disabled) |
|---|---|---|---|---|
| **Mesh Quality & Flow** | Uniform equilateral triangles; isotropic; no natural edge loops. | Quad-dominant; edge loops align to principal curvature; some high-valence poles. | Exceptional regular grid flow; global field alignment; pure quads ($>98\%$). | Learned topology flow; natural contours on common classes; irregular on edge cases. |
| **Animation & Rigging** | Functional with linear blend skinning, but prone to diagonal pinching. | Good; quads deform predictably along curvature directions. | Excellent; industry benchmark for clean character and mechanical articulation. | Good if model was trained on rigged animatable topology. |
| **Subdivision (Catmull-Clark)** | Poor; creates pinch points at every triangle pole. | Good; clean smoothing across quad surfaces; minor artifacts at remnant tris. | Outstanding; smooth subdivision limit surfaces without creasing. | Variable; dependent on boundary manifoldness. |
| **Watertightness & Manifolds** | Watertight when the source surface is watertight; the AutoRetopo shell stage can rebuild a watertight base. | High; pairing preserves boundary manifold structure. | Moderate; prone to non-manifold self-intersections on thin shells or high genus. | Low; frequently produces non-manifold edges, T-junctions, or boundary holes. |
| **glTF 2.0 / GLB Compatibility** | **Native** (Specification compliant). | Requires triangulated derivative for GLB. | Requires triangulated derivative for GLB. | Requires triangulated derivative for GLB. |
| **Execution Speed & Compute** | Decimation only; `fast_simplification` / MeshLab QEC path. | Full AutoRetopo pipeline: voxel shell → adaptive isotropic remesh (with calibration passes) → optional projection → quad pairing. | CPU-bound global optimization in an external binary. | GPU model inference; FastMesh additionally requires the `meshiki` dependency for its quad branch. **No timing figures are asserted — the repository contains no quad-topology benchmark.** |
| **Current Readiness in ForMash3D** | **Production Ready** (Active default). | **Production Ready** (`_export_quad_obj` functional). | **Not integrated** — `quadriflow_remesh` is an unused helper and no `quadriflow` binary is bundled. | **FastMesh: quad branch blocked** by the missing `meshiki` dependency. **TaoFlowForge: disabled by default** (`enabled: false` in `backend/config/models.yaml`), requires a license opt-in, and has never been executed in this repository — no measured result exists. |

### 3.1 Metrics actually produced by the AutoRetopo run

When the quad path runs, `run_auto_retopo()` returns stats containing `metrics`, `timings` and `quad_face_count` (`backend/postprocess/services/auto_retopo.py`). The metric names are fixed by `backend/postprocess/services/autoretopo/metrics.py` and are the ones to quote when evaluating a quad run:

- `fidelity`: `chamfer`, `chamfer_pct_diag`, `hausdorff`, `hausdorff_pct_diag`, `mean_surface_dist`, `mean_dist_pct_diag`, `mean_normal_deviation_deg`, `pct_within_1pct_diag`
- `triangle_quality`: `min_angle_mean_deg`, `min_angle_p05_deg`, `pct_well_shaped` (share of triangles with a minimum angle above 30°), `aspect_ratio_median`, `aspect_ratio_mean`, `aspect_ratio_p95`
- `topology`: `vertices`, `faces`, `watertight`, `winding_consistent`, `components`, `euler_number`, `genus`, `mean_valence`, `valence_std`, `pct_valence_5_to_7`

The separate production topology gate uses `compute_mesh_metrics()` (`backend/core/quality/metrics.py`) and `evaluate_topology_gate()` (`backend/postprocess/services/gate.py`). Its thresholds live in `backend/config/quality.yaml` under `gate`: `max_non_manifold_edges: 0`, `max_non_manifold_vertices: 0`, `max_holes: 0`, `max_floater_ratio: 0.005`, `max_degenerate_faces: 0`, `min_aspect_ratio_p1: 0.05`, `min_aspect_ratio_p5: 0.1`. These are the numbers to compare against — not any percentage or timing quoted elsewhere in this report.

---

## 4. File Format Specifications & Constraints

Understanding the format boundary is essential to prevent user confusion or pipeline regressions:

### 4.1 Wavefront OBJ (`.obj`)
- **Quad Support:** Full native support. Faces can have 3, 4, or $N$ vertices:
  ```text
  f 1/1/1 2/2/2 3/3/3 4/4/4
  ```
- **UV and Normal Support:** Dedicated indices per vertex for positions, texture coordinates (`vt`), and normals (`vn`).
- **ForMash3D Status:** Fully supported via `_export_quad_obj`.

### 4.2 glTF 2.0 / GLB (`.glb`)
- **Quad Support:** **Zero.** The official Khronos glTF 2.0 specification only supports primitive modes:
  - `0`: `POINTS`
  - `1`: `LINES`
  - `2`: `LINE_LOOP`
  - `3`: `LINE_STRIP`
  - `4`: `TRIANGLES`
  - `5`: `TRIANGLE_STRIP`
  - `6`: `TRIANGLE_FAN`
- **Implication:** Attempting to store quads in a GLB violates the glTF 2.0 JSON schema and causes standard loaders (`three/examples/jsm/loaders/GLTFLoader`, Babylon.js, Blender glTF importer) to crash or reject the asset.
- **Rule:** **GLB files generated by ForMash3D MUST always remain triangulated.**

### 4.3 Autodesk FBX (`.fbx`)
- **Quad Support:** Supported. FBX polygons can have arbitrary vertex counts (indicated by negative indices terminating polygon face loops).
- **ForMash3D Status:** Currently, `run_convert_fbx` in `backend/postprocess/services/convert_fbx.py` converts from the `game_ready` GLB (the pipeline passes `game_ready_glb_bytes` at `backend/postprocess/pipeline.py:2448`). Consequently, exported FBX files are triangulated.
- **Enhancement Potential:** If requested by users, `run_convert_fbx` could accept the quad OBJ file as source instead of GLB when `is_quad_requested` is true.

---

## 5. Architectural Recommendations & Action Plan

In strict accordance with `RULES.md` ("The best code is the code never written", YAGNI, and no unrequested abstractions), we recommend the following non-disruptive roadmap:

### Recommendation 1: Maintain Existing Architecture (Zero Code Change)
- ForMash3D **already delivers** what Tripo and Rodin provide: a clean, optional quad-dominant asset delivered as an OBJ file (`game_ready/{base_name}.obj` / `quad_obj`).
- Web preview and game-ready GLB remain triangulated for rock-solid stability and universal engine compatibility.
- No code change required.

### Recommendation 2: Clean up Dead Adapter References (Future Maintenance)
- In `backend/adapters/fastmesh_adapter.py`, remove the uninstalled `meshiki` call in `tri2quad` or replace it with a call to the existing AutoRetopo smart pairing in `backend/postprocess/services/autoretopo/remesh.py::to_quad_dominant` when FastMesh is invoked with `poly_type="quad"`.
- This avoids silent crashes if an API caller specifically invokes FastMesh with `poly_type: "quad"`.

### Recommendation 3: Optional Bundled Field-Aligned Remesher (Pending User Request)
- If users explicitly request **pure field-aligned quads** matching Rodin/Tripo's premium tier:
  - Avoid heavy, fragile Python dependencies.
  - Follow the existing project pattern established by `tools/meshoptimizer/linux/gltfpack`: bundle a statically-compiled, self-contained binary of `quadriflow` or `instant-meshes` in `tools/quadriflow/`.
  - Wire it into `remesh.quadriflow_remesh` (which the pipeline does not call today).
  - Only execute this when explicitly approved by the user.

### Recommendation 4: Do Not Claim Native-Quadrature Results for TaoFlowForge
- The TaoFlowForge native-topology route is a separate model path, not part of the AutoRetopo quad flow. The adapter is implemented and registered, but the model is `enabled: false` in `backend/config/models.yaml`, requires a license opt-in in `backend/config/planner_rules.yaml`, is absent from the preset catalogue in `backend/config/smart_presets.yaml`, and has never been executed here.
- Until it is run on a GPU host and the resulting meshes are measured with the metrics listed in §3.1, no topology or quality claim can be made for it. See `Docs/taoflowforge_spike_report.md`.

---

## 6. Conclusion
The current quad-dominant export workflow in ForMash3D is robust, well-conceived, and correctly respects the boundary between authoring formats (polygonal Wavefront OBJ) and runtime engine formats (triangulated glTF/GLB). No disruptive changes or architectural overhauls are required.
