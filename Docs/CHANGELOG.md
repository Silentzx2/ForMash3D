# Changelog — ForMash3D

## 4C: Documentation and repository cleanup (2026-10-20)

- Restored `Docs/EXPERIMENTAL-MODEL-SETTINGS.md` and added ADR-085 (Targeted hole repair), ADR-086 (Memory-safe decimation), and ADR-087 (UV backend auto-resolver) to `Docs/DECISIONS.md`.
- Removed tracked binaries in `deliverables/`, added `deliverables/` to `.gitignore`, and condensed changelog to exactly 3 entries.
- Replaced `Docs/TASKS.md` with verified status register; synchronized `Docs/MEMORY.md`, `Docs/ARCHITECTURE.md` (SSOT Configuration Map), and `README.md`.
- Added `pytest.importorskip("xatlas")` test guards for clean execution in environments where C-extensions are omitted.

## 4B: Parity scorecard truth and benchmark tooling (2026-10-20)

- Rewrote `parity_scorecard.json` and generator `backend/core/quality/parity_scorecard.py` to enforce strict source attribution; competitor cells without user-supplied GLBs are `null`, and qualitative marketing claims were removed.
- Extended `scripts/run_final_parity_benchmark.py` with real image benchmark CLI (`--images`, `--api`, `--tiers`, `--dry-run`, `--competitor-dir`), outputting `Docs/benchmark_real.json` and generating `Docs/hunyuan_smoothness_report.md` on real GPU runs.
- Labeled synthetic benchmark `Docs/baseline_vs_now_benchmark.json` as `"kind": "synthetic_smoke_test"`.
- Corrected `Docs/taoflowforge_spike_report.md` status to "NOT EVALUATED — needs GPU + 30 GB disk" with an explicit user evaluation checklist.

## 4A: Single source of truth configuration (quality.yaml) (2026-10-20)

- Consolidated 5 fragmented YAML configurations (`bake_config.yaml`, `decimation_config.yaml`, `gate_thresholds.yaml`, `seed_scoring.yaml`, `uv_config.yaml`) into single canonical `backend/config/quality.yaml`.
- Removed module-level numeric `DEFAULT` dictionaries and isolated loaders across services; all services now query cached `get_quality_config()`.
- Unified feature/crease angles to `quality.shared.feature_edge_angle_deg` (35°) and hole limits to `quality.holes.*`.
- Replaced duplicate tier validation logic in `backend/api/routers/mesh_generation.py` with `validate_quality_tier()` and configured schema default to `None` with fallback to `quality.default_tier`.
- Wired planner execution switches (`apply.model_choice`, `apply.auto_seeds`, `apply.input_prep`) in `backend/config/planner_rules.yaml` and connected fallback chains to scheduler inputs.
- Implemented `_score_and_select()` candidate evaluation in `backend/core/scheduler/multiprocess_scheduler.py` supporting early stopping and canonical winner promotion.
- Deduplicated preprocessing by deleting unused `image_prep.py` and routing `plan.input_prep` into `image_enhancement.py::preprocess_image`.
- Synced planner capability flags and VRAM requirements directly to `backend/config/models.yaml` as single source of truth.
- Wired normal detail bake options to `quality.bake.*` and added `plan`, `seed_scores`, and `quality_tier` into `quality_trace` and `quality_report.json`.
