# Changelog — ForMash3D

## Generate UI simplification and adapter-owned inference profiles (2026-10-21)

- Locked model-specific inference schedules, step counts, guidance scales, octree resolutions, and samplers into model adapters (`_LOCKED_INFERENCE_PROFILE`), removing fake UI sliders and duplicate scheduler profile tables (ADR-056, ADR-057).
- Simplified `GeneratePanel.tsx` into a single beginner-friendly flow: reference image intake, model selection with live hardware readiness badges, universal textured generation toggle, and a single Target Polycount / Output Preset card (`mobile`, `game_ready`, `cinematic`, `animation`, `3d_print`, `native`).
- Standardized the Advanced production drawer around genuine post-processing options: candidate variation count (1 to 4 with deterministic seeds and composite scoring), triangle vs quad-dominant retopology, UV unwrapping, high-to-low normal baking, multi-tier LODs, topology repair, and CoACD physics colliders.
- Consolidated presets as production recipes applied downstream on immutable `master/source.glb`; fixed auto-submission bug so selecting presets configures parameters non-destructively without triggering generation.
- Established authoritative contract specification in `Docs/GENERATION-UI-CONTRACT.md` detailing the UI $\to$ Request Builder $\to$ API $\to$ Scheduler $\to$ Adapter $\to$ Postprocess Pipeline lifecycle.

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
