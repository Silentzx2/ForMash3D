## 2026-10-20 — Quality Metrics Lib, Parity Scorecard, and Master Immutability Audit (Task 1A)

- Implemented pure trimesh/NumPy `compute_mesh_metrics` in `backend/core/quality/metrics.py` covering 14 metrics: triangles, vertices, watertightness, non-manifold edges/vertices, boundary loops/holes, floater ratio, degenerate faces, aspect-ratio percentiles (p1/p5), UV islands, and feature-edge retention.
- Added `backend/core/quality/parity_scorecard.py` producing `parity_scorecard.json` comparing ForMash3D against Tripo, Meshy, and Hyper3D across sharpness, topology, UVs, textures, speed, and failure rate.
- Added master immutability audit helpers and test in `backend/tests/test_mesh_metrics.py` verifying that working copies protect `master/source.glb` SHA-256 integrity.

## 2026-10-20 — Hunyuan Presets, Hole-Targeted Repair & Seed Scorer (Tasks 1C & 1D)

- Added `backend/config/hunyuan_presets.yaml` declaring config-driven tiers (`fast`: octree 380, 30 steps, guidance 5.0, 8GB VRAM; `balanced`: octree 512, 50 steps, guidance 7.5, 10GB VRAM; `high`: octree 512, 100 steps, guidance 7.5, 14GB VRAM) and hole-repair thresholds (`max_hole_perimeter: 0.5`, `max_hole_vertices: 50`).
- Implemented `repair_holes_targeted` in `backend/postprocess/services/hole_repair.py` using boundary loop extraction from directed boundary edges, triangulating loops `<= max_hole_vertices` with boundary fans while preserving non-hole geometry completely untouched.
- Added `backend/config/seed_scoring.yaml` and pure function scorer `score_seed_candidate` and `select_best_candidate` in `backend/core/scheduler/seed_scorer.py` using fixed reference ranges, inverting negative metrics, supporting sequential early stopping (score >= 0.85), and breaking 2% composite ties by feature edge retention then triangle count.
- Added test suite in `backend/tests/test_hole_repair_and_seeds.py` (8/8 passing).

## 2026-10-20 — Input Image Prep Module (Task 1B)

- Implemented pure Pillow / NumPy image preprocessor `prepare_input_image` in `backend/core/preprocess/image_prep.py` guaranteeing immutability of caller images and source files.
- Added support for background removal/alpha cleanup, tight cropping with configurable margin percentages, aspect-ratio-preserving letterboxing on transparent canvas, and Lanczos upscaling for small inputs.
- Implemented `validate_image_aspect_and_occupancy` reporting foreground occupancy, aspect ratio, bounding box coverage, and edge contact detection.
- Added comprehensive unit tests in `backend/tests/test_image_prep.py` covering immutability, margin-aware cropping, letterboxing, small input upscaling, and occupancy metrics.
