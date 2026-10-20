# Changelog — ForMash3D

## [batch-3-pass] 2026-10-20 — Batch 3: Parity Benchmark, Scorecard, and Documentation Sync (Tasks 3D & 3E)

- Implemented `scripts/run_final_parity_benchmark.py` evaluating 4 canonical synthetic test shapes (cube, sphere, cylinder, mechanical prop) comparing raw baseline defects vs the post-processing pipeline.
- Generated `Docs/baseline_vs_now_benchmark.json` confirming 100% watertight recovery, 0 non-manifold edges, 100% feature edge retention on crease geometries, and 75.95% average UV utilization.
- Updated `parity_scorecard.json` with authoritative comparisons across ForMash3D, Tripo, Meshy, and Hyper3D across all 6 competitive dimensions.
- Updated pipeline diagrams in `README.md` (ASCII and Mermaid) and synced `Docs/ARCHITECTURE.md`, `Docs/TASKS.md`, `Docs/CHANGELOG.md`, and `Docs/MEMORY.md`.
- Added unit tests in `backend/tests/test_final_parity_benchmark.py` (3/3 passing).

## [batch-3-pass] 2026-10-20 — Batch 3: Planner v1 Tuning & Quality Badging (Tasks 3B & 3C)

- Updated `backend/config/planner_rules.yaml` with benchmark-driven routes per object type (`mechanical`, `organic`, `character`, `general`) and quality tier (`fast`, `balanced`, `high`).
- Enhanced `backend/core/planner.py` to route clean mesh styles and mechanical props to feature-aware retopology when native topology generators are unavailable.
- Exposed `mesh_style`, `requested_quality`, `object_type`, and `symmetry` on generation API request schemas in `backend/api/routers/mesh_generation.py`.
- Integrated workspace Settings Modal controls for quality and mesh-style presets.
- Added UI QualityBadge component and quality/mesh style selectors in `features/workspace/Panels/GeneratePanel.tsx`.

## [batch-3-pass] 2026-10-20 — Batch 3: TaoFlowForge Spike & Quad-Dominant Export Evaluation (Tasks 3A & 3F)

- Documented TaoFlowForge spike in `Docs/taoflowforge_spike_report.md` (Apache 2.0 code and 26GB weights released on ModelScope; local execution blocked by 26GB disk footprint and strict CUDA 12.1 requirement; native route kept safely disabled).
- Evaluated quad-dominant export option in `Docs/quad_topology_evaluation.md` confirming OBJ quad support and identifying glTF triangulation constraints.

## [batch-2-pass] 2026-10-20 — Batch 2: Postprocess Integration & Orchestration (Task 2E)

- Integrated Topology Gate, targeted hole repair, memory-safe decimation, UV backend resolver, and PBR validation into `backend/postprocess/pipeline.py`.
- Verified master immutability: `master/source.glb` SHA-256 is strictly preserved before and after postprocessing operations.
- Added comprehensive end-to-end integration test in `backend/tests/test_batch2_orchestrator_integration.py`.

## [batch-2-pass] 2026-10-20 — Batch 2: UV Backend Resolver & Driver (Task 2D)

- Added `backend/config/uv_config.yaml` declaring PartUV triangle threshold (500k), VRAM budget (7.0 GB), default backend (`auto`), and fallback (`xatlas`).
- Implemented `resolve_uv_backend` and `execute_uv_unwrap` in `backend/postprocess/services/uv_backend_resolver.py` operating on mesh copies.
- Added test suite in `backend/tests/test_uv_backend_resolver.py` (10/10 passing).

## [batch-2-pass] 2026-10-20 — Batch 2: Normal Detail Bake Config & PBR Validation (Task 2C)

- Created `backend/config/bake_config.yaml` for tangent-space OpenGL (Y+) normal baking, cage/ray parameters, and min UV utilization (60%).
- Implemented `validate_pbr_asset` in `backend/postprocess/services/pbr_validator.py` verifying non-degenerate channels, packed roughness/metallic, tangent normals, and UV containment.
- Added test suite in `backend/tests/test_pbr_validator.py` (9/9 passing).

## [batch-2-pass] 2026-10-20 — Batch 2: Feature-Aware Decimation & Memory Safety (Task 2B)

- Created `backend/config/decimation_config.yaml` declaring 2M triangle threshold, 35° crease angle, and 80% RAM cap.
- Implemented `memory_safe_decimate` in `backend/postprocess/services/memory_safe_decimate.py` with psutil memory tracking and staged chunk reduction.
- Added test suite in `backend/tests/test_memory_safe_decimation.py` (5/5 passing).

## [batch-2-pass] 2026-10-20 — Batch 2: Topology Gate Service (Task 2A)

- Created `backend/config/gate_thresholds.yaml` defining quality thresholds for non-manifold geometry, boundary holes, floater ratio, and aspect ratios.
- Implemented `evaluate_topology_gate` in `backend/postprocess/services/gate.py` returning repair decisions and bypass flags.
- Added test suite in `backend/tests/test_topology_gate.py` (11/11 passing).

## [batch-1-pass] 2026-10-20 — Batch 1: Quality Metrics Lib, Parity Scorecard, and Master Immutability Audit (Task 1A)

- Implemented pure trimesh/NumPy `compute_mesh_metrics` in `backend/core/quality/metrics.py` covering 14 metrics: triangles, vertices, watertightness, non-manifold edges/vertices, boundary loops/holes, floater ratio, degenerate faces, aspect-ratio percentiles (p1/p5), UV islands, and feature-edge retention.
- Added `backend/core/quality/parity_scorecard.py` producing `parity_scorecard.json` comparing ForMash3D against Tripo, Meshy, and Hyper3D across sharpness, topology, UVs, textures, speed, and failure rate.
- Added master immutability audit helpers and test in `backend/tests/test_mesh_metrics.py` verifying that working copies protect `master/source.glb` SHA-256 integrity.

## [batch-1-pass] 2026-10-20 — Batch 1: Planner v0, Runtime Probe & Capability Flags (Task 1E)

- Implemented `backend/core/runtime_probe.py` returning hardware facts (`probe_runtime()`) including live VRAM (`torch.cuda.mem_get_info`), peak allocated memory, host RAM (`psutil`), installed adapter classes, enabled models, and license opt-in state.
- Implemented deterministic rule-based planner `plan_generation` in `backend/core/planner.py` with full-plan recomputation upon fallback.
- Added `native_topology` attribute on `BaseModel` to differentiate native topology generation from dense marching cubes geometry.
- Added measured VRAM, `native_topology`, and `output_resolution` fields across models in `backend/config/models.yaml`.

## [batch-1-pass] 2026-10-20 — Batch 1: Hunyuan Presets, Hole-Targeted Repair & Seed Scorer (Tasks 1C & 1D)

- Added `backend/config/hunyuan_presets.yaml` declaring config-driven tiers (`fast`: octree 380, 30 steps, guidance 5.0, 8GB VRAM; `balanced`: octree 512, 50 steps, guidance 7.5, 10GB VRAM; `high`: octree 512, 100 steps, guidance 7.5, 14GB VRAM) and hole-repair thresholds (`max_hole_perimeter: 0.5`, `max_hole_vertices: 50`).
- Implemented `repair_holes_targeted` in `backend/postprocess/services/hole_repair.py` using boundary loop extraction from directed boundary edges, triangulating loops `<= max_hole_vertices` with boundary fans while preserving non-hole geometry completely untouched.
- Added `backend/config/seed_scoring.yaml` and pure function scorer `score_seed_candidate` and `select_best_candidate` in `backend/core/scheduler/seed_scorer.py` using fixed reference ranges, inverting negative metrics, supporting sequential early stopping (score >= 0.85), and breaking 2% composite ties by feature edge retention then triangle count.
- Added test suite in `backend/tests/test_hole_repair_and_seeds.py` (8/8 passing).

## [batch-1-pass] 2026-10-20 — Batch 1: Input Image Prep Module (Task 1B)

- Implemented pure Pillow / NumPy image preprocessor `prepare_input_image` in `backend/core/preprocess/image_prep.py` guaranteeing immutability of caller images and source files.
- Added support for background removal/alpha cleanup, tight cropping with configurable margin percentages, aspect-ratio-preserving letterboxing on transparent canvas, and Lanczos upscaling for small inputs.
- Implemented `validate_image_aspect_and_occupancy` reporting foreground occupancy, aspect ratio, bounding box coverage, and edge contact detection.
- Added comprehensive unit tests in `backend/tests/test_image_prep.py` covering immutability, margin-aware cropping, letterboxing, small input upscaling, and occupancy metrics.
