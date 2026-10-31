# MESH QUALITY PLAN — Post-Processing Pipeline + Raw Mesh Size Limits (Option A)

## Goal
Raw AI mesh (TRELLIS, TRELLIS.2, Hunyuan3D-Shape/Paint/DiT, TripoSG, Unique3D, Pixal3D, Hi3D) ko Tripo AI level quality tak lana — **sirf post-processing ke zariye**, koi adapter inference profile change nahi, koi SDF implement nahi.

Raw mesh pehle adapter se generate hota hai (full quality, immutable), phir post-processing pipeline usko clean karta hai:
- Holes fill karna
- Jagged sharp edges ko smooth karna (Taubin smoothing, 4 iterations)
- Non-manifold / winding fix
- Curvature-aware decimation (crease protect >35°)
- Quad-dominant retopology
- Normal map baking (master → game_ready)

master/source.glb hamesha immutable rehta hai — kabhi mutate nahi hota.

Raw mesh ka vertex/face count 500k se zyada nahi hona chahiye taaki server OOM na ho. Ye limit quality.yaml aur models.yaml mein mesh.limits ke zariye enforce hoti hai.

## Scope (In Scope)
- Post-processing pipeline: hole filling (`fill_holes`), winding fix (`fix_winding`), normal repair (`fix_normals`), Taubin smoothing (`lamb=0.3, nu=-0.34, iterations=4`)
- Curvature-aware decimation: protect crease angles >35°, more polys on curved surfaces
- Quad-dominant retopology (AutoRetopo), target polycount from smart_presets.yaml
- Normal map baking: high-poly master → low-poly game_ready (OpenGL Y+ tangent space)
- Frontend QualityBadge: Sharp / Clean / Needs Review
- Frontend telemetry: triangle count, non-manifold edges, holes, UV utilization
- Presets derived from backend smart_presets.yaml only (no hardcoded UI values)
- Raw mesh size limits: `mesh.limits` in quality.yaml + `mesh_limits` per model in models.yaml
- Code snippets and implementation guides for every fix — all wired code, no placeholders/mocks

## Scope (Out of Scope)
- Adapter inference profiles — NOT CHANGED (_LOCKED_INFERENCE_PROFILE stays exactly as-is)
- SDF implementation — TripoSG's internal code, not ForMash3D's
- Scheduler pre-flight validation — NOT IN THIS PLAN (limits enforced post-extraction, not pre-inference)
- Multi-view image input — removed
- Cloud, payment, mobile app, real-time collaboration — out of scope

## Model-Wise Quality Gaps & Post-Processing Fixes

### TRELLIS / TRELLIS.2
**Issues:** Holes in mesh (dress/skirt gaps), jagged sharp edges, sparse voxel artifacts
**Root cause:** `fill_holes = simplify != 0.0` meant holes never filled at default `simplify=0.0`. No repair after `to_trimesh()`.
**Fix done (commit df6b01c4):** Unconditional `fill_holes`, `fix_winding`, `fix_normals`, Taubin smoothing (4 iterations) on textured + raw paths.
**No adapter profile changes needed.**

### Hunyuan3D-Shape-v2.1
**Issues:** Non-manifold geometry, over-smoothed surfaces
**Fix:** Same post-processing repair (hole fill, winding fix, normals, Taubin smoothing) applied after extraction — same as TRELLIS.
**No adapter profile changes needed.**

### Hunyuan3D-DiT-v2-mini-Turbo
**Issues:** Low-poly output, face reducer caps
**Fix:** Post-processing repair applied after extraction.
**No adapter profile changes needed.**

### Hunyuan3D-Paint-v2.1
**Issues:** Texture over-baked, low quality texture guide
**Fix:** Separate mesh generation from texture stage; normal bake from high-poly master → low-poly game_ready.
**No adapter profile changes needed.**

### TripoSG
**Issues:** Deviates from reference image, works bad with low-res/pixel-art, raw mesh can be ~3.4M vertices
**Fix:** Post-processing repair only — no adapter changes. Raw mesh vertex cap at 500K via models.yaml mesh_limits.
**No adapter profile changes needed.**

### Unique3D
**Issues:** Fragmented wisps, holes, collapsed surface (normal orientation, Poisson depth)
**Fix done (commit a90561f):** Per-face normal flip + depth-8 Screened Poisson in `fast_geo()`. Post-processing repair applied on top.
**No adapter profile changes needed.**

### Pixal3D
**Issues:** Messy topology, spiral lines, bad poly distribution
**Fix:** Post-processing repair + retopology integration.
**No adapter profile changes needed.**

### Hi3D (Experimental)
**Issues:** Needs coarse mesh input, dummy icosphere fallback causes collapse
**Fix done:** Refinement route with `coarse_mesh_path`, `_legacy.glb` archival. Post-processing repair applies after refinement.
**No adapter profile changes needed.**

## Raw Mesh Size Limits — backend/config/quality.yaml

Add a `mesh.limits` section. These are the SINGLE SOURCE OF TRUTH for all model vertex/face caps:

```yaml
quality:
  mesh:
    # Hard caps to prevent server OOM from runaway raw mesh generation.
    # Raw mesh from any adapter must not exceed these limits.
    max_vertices_per_mesh: 500000      # 500K vertices absolute ceiling for ANY model
    max_faces_per_mesh: 1000000        # 1M faces absolute ceiling for ANY model
    max_triangles_per_mesh: 1000000    # 1M triangles absolute ceiling for ANY model

    # Per-model default targets (not hard caps, recommended defaults)
    default_target_vertices: 200000
    default_target_faces: 400000

    # Decimation trigger: if raw output exceeds this, auto-decimate BEFORE
    # saving to master/source.glb. Master stays immutable after this point.
    decimation_trigger_vertices: 300000
    decimation_trigger_faces: 600000

    # Crease angle for edge-preserving decimation (shared SSOT)
    shared:
      feature_edge_angle_deg: 35.0

    # Immutable raw mesh protection
    immutable_master: true
    master_path: "master/source.glb"
    never_mutate_master: true
```

## Per-Model Vertex/Face Caps — backend/config/models.yaml

Add `mesh_limits` to each model entry. These are HARD CAPS — raw mesh from adapter will not exceed these:

```yaml
image_to_raw_mesh:
  triposg_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 500000      # TripoSG was producing 3,434,000 — hard cap at 500K
      max_faces: 1000000
    vram_requirement: 8192

  trellis2_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 500000
      max_faces: 1000000
    vram_requirement: 23552

  trellis_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 400000
      max_faces: 800000
    vram_requirement: 11776

  hunyuan3d_shape_v21_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 400000
      max_faces: 800000
    vram_requirement: 10240

  hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 200000
      max_faces: 400000
    vram_requirement: 6144

  unique3d_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 300000
      max_faces: 600000
    vram_requirement: 10240

  pixal3d_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 400000
      max_faces: 800000
    vram_requirement: 18432

  hi3d_image_to_raw_mesh:
    mesh_limits:
      max_vertices: 300000
      max_faces: 600000
    vram_requirement: 16384

image_mesh_painting:
  trellis_image_mesh_painting:
    mesh_limits:
      max_vertices: 500000
      max_faces: 1000000
    vram_requirement: 11776

  trellis2_image_mesh_painting:
    mesh_limits:
      max_vertices: 500000
      max_faces: 1000000
    vram_requirement: 23552

  hunyuan3d_paint_v21_image_mesh_painting:
    mesh_limits:
      max_vertices: 300000
      max_faces: 600000
    vram_requirement: 12000

  paint3d:
    mesh_limits:
      max_vertices: 400000
      max_faces: 800000
    vram_requirement: 12000
```

## Phase-Wise Execution Plan

### Phase 1: Post-Processing Hardening
1. Unconditional `trimesh.repair.fill_holes()` after every mesh extraction — DONE for TRELLIS
2. `fix_winding()` + `fix_normals()` unconditionally — DONE for TRELLIS
3. Taubin smoothing `lamb=0.3, nu=-0.34, iterations=4` — DONE for TRELLIS (was 2, too gentle)
4. Apply same repair to Hunyuan-Shape, Hunyuan-DiT, Hunyuan-Paint, TripoSG, Unique3D, Pixal3D, Hi3D adapters

### Phase 2: Decimation & Retopology
1. Curvature-aware decimation: protect crease angles (>35°), more polys on curved surfaces
2. Target polycount presets: mobile 20K, game_ready 50K, cinematic 200K (from smart_presets.yaml)
3. Quad-dominant retopology (AutoRetopo) with target face count
4. Edge-preserving smoothing — protect sharp features while smoothing flat areas

### Phase 3: Normal Map Baking
1. High-poly → low-poly normal map bake (OpenGL Y+ tangent space)
2. Cage/ray distance from quality.yaml (`cage_extrusion=0.02`, `max_ray_distance=0.05`)
3. UV atlas utilization >= 60% (from quality.yaml)
4. Packed RMA channels: roughness=G, metallic=B
5. Flat face normal decode verification (~(0,0,1))

### Phase 4: Frontend Quality UX
1. QualityBadge: Sharp (feature edge retention >= 0.85), Clean (gate pass), Needs Review
2. Telemetry: triangle count, non-manifold edges, holes, UV utilization
3. Presets derived from backend smart_presets.yaml only (no hardcoded UI values)
4. No inference sliders — adapter-owned
5. No low-VRAM toggle — scheduler decides

## Single Source of Truth (SSOT)
- `backend/config/quality.yaml`: hole repair, decimation, gate thresholds, UV, bake, seeds, mesh.limits
- `backend/config/smart_presets.yaml`: intent presets (mobile/game_ready/cinematic/animation/3d_print/native)
- `backend/config/models.yaml`: VRAM, capabilities, model facts, mesh_limits per model
- Frontend mirrors only via `constants/smartPresetFallback.json` guarded by parity test

## Verification (Honest Reporting)
- `bun tsc --noEmit`: frontend typecheck — NOT RUN YET
- `python3 -m compileall backend/`: Python syntax — NOT RUN YET
- `pytest backend/tests/`: backend contract tests — NOT RUN (no torch/GPU)
- GPU inference / visual quality vs Tripo: NOT RUN (requires CUDA host + checkpoints)
- Report as `NOT RUN`, never assume passing

## What is NOT in this plan
- Adapter inference profile changes — _LOCKED_INFERENCE_PROFILE stays as-is
- SDF implementation — TripoSG's internal code
- Scheduler pre-flight validation — not in Option A (limits enforced post-extraction)
- Multi-view / Zero123++ — removed
- Cloud, payment, mobile, social — out of scope

## Current Dev Status — 2026-10-30

- The shared post-processing path now includes the mesh-repair and raw-mesh-limit work recorded in the current `dev` history. The configured global guard is 500K vertices / 1M faces; it is applied after model extraction and before the immutable master is written.
- **Important limitation:** a post-extraction cap is not a scheduler pre-flight budget. It cannot prevent every memory spike or OOM that occurs while a model is producing its raw mesh.
- Hi3D is experimental. Its adapter profile is pinned to resolution `1024` and `25` inference steps. The caller seed remains configurable; request-side resolution and step overrides are ignored.
- Model registration and checkpoint presence are not production-readiness proof. Some model pipelines are reported to fail during initialization/loading, while some others may complete with broken or unusable geometry. These reports are not yet mapped to a reproducible per-model failure matrix.
- Hardware-backed inference, checkpoint loading, real peak VRAM, and visual quality verification must be recorded as `NOT RUN` until performed on the target CUDA environment.

### Follow-up validation tasks

1. Build a per-model startup matrix: dependency import, checkpoint completeness, pipeline initialization, target GPU, VRAM reservation, and failure traceback.
2. Run representative image-to-mesh smoke tests for each enabled model and record whether the raw GLB loads, has finite vertices, valid face indices, connected components, holes, and non-manifold counts.
3. Test post-processing separately from raw inference so adapter failures are not confused with pipeline failures.
4. Save representative broken outputs and logs as regression fixtures where licensing and storage permit; add CPU-safe contract tests for each reproduced failure.
5. Record GPU device/driver/CUDA/PyTorch versions, cold-load time, peak VRAM, inference time, and visual review before marking a model production-ready.

See [MODEL-STATUS.md](MODEL-STATUS.md) for readiness definitions, current limitations, and the triage procedure.
