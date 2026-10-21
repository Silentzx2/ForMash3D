# Changelog — ForMash3D

## Intent resolution fix for mesh generation (2026-10-21)

- Fixed `HTTP 400` on `POST /api/v1/smart-generation/resolve`, which failed mesh generation whenever an output preset was selected. Manifest model paths (for example `backend/pretrained/TRELLIS`) were resolved against the wrong roots, so every model looked uninstalled to the intent resolver: the API and scheduler processes do not run from the repository root (Docker supervisord uses `/app/backend`, `backend/scripts/run_server.sh` changes into `backend/`). A single repository-root-relative resolver (`core/utils/artifact_utils.py::resolve_manifest_path`) now backs both the resolver and the model-readiness badge, so the two can no longer disagree (ADR-094).
- Made the intent → model resolve advisory in the Generate action: a resolve failure is logged and generation continues with the user's explicit model, matching the queue and batch paths. Readiness and resource admission stay with the scheduler (ADR-045, ADR-046); the endpoint still answers 400 with an actionable message for an unknown intent, an unregistered or incompatible model, missing weights, or a model that cannot fit the current free VRAM.
- `core/utils/__init__.py` now exposes its helpers lazily, so importing a light submodule no longer requires the optional `aiofiles`/`Pillow` upload dependencies.
- Added `backend/tests/test_manifest_path_resolution.py` (6 tests) covering the CWD-independent path resolution, the shared-resolver wiring, and the readiness contract, and included it in the Backend Runtime Contract CI job.

## Generate UI simplification and adapter-owned inference profiles (2026-10-21)

- Locked model-specific inference schedules, step counts, guidance scales, octree resolutions, and samplers into model adapters (`_LOCKED_INFERENCE_PROFILE`), removing fake UI sliders and duplicate scheduler profile tables (ADR-056, ADR-057).
- Simplified `GeneratePanel.tsx` into a single beginner-friendly flow: reference image intake, model selection with live hardware readiness badges, universal textured generation toggle, and a single Target Polycount / Output Preset card (`mobile`, `game_ready`, `cinematic`, `animation`, `3d_print`, `native`).
- Standardized the Advanced production drawer around genuine post-processing options: candidate variation count (1 to 4 with deterministic seeds and composite scoring), triangle vs quad-dominant retopology, automatic UV unwrapping, high-to-low normal baking, multi-tier LODs, topology repair, auto-rig, and physics colliders.
- Consolidated presets as production recipes applied downstream on immutable `master/source.glb`; fixed auto-submission bug so selecting presets configures parameters non-destructively without triggering generation.
- Established authoritative contract specification in `Docs/GENERATION-UI-CONTRACT.md` detailing the UI $\to$ Request Builder $\to$ API $\to$ Scheduler $\to$ Adapter $\to$ Postprocess Pipeline lifecycle.
- Wired the previously disconnected LOD controls end-to-end: `generate_lod`, `lod_preset`, and `lod_count` are first-class request fields, the level count is limited to the four levels the pipeline can build, and the legacy `model_parameters` LOD keys are explicitly ignored (ADR-093).
- Replaced the boolean-default masking of preset-owned options with a tri-state request contract (`texture_resolution`, `enable_printability_check`, `enable_auto_repair`, `enable_auto_rig`, `physics_enabled`, `generate_lod`, `lod_preset`, `lod_count`): explicit request value > intent preset > backend default, with `target_polycount` keeping its numeric presence contract.
- Made the backend preset catalogue the single source of truth for the panel: preset chip summaries and recipe values now come from `backend/config/smart_presets.yaml`, the offline fallback table is `constants/smartPresetFallback.json` guarded by a parity test, the mobile atlas size was corrected to a value the API accepts, and the dead "Enable Low VRAM Mode and retry" action was removed.
- Added regression coverage for the new contract: 12 frontend request-builder rules, 10 backend precedence tests, and the frontend/backend preset parity test; synchronized the architecture, design, PRD, API, security, and experiment documentation with the verified implementation.

## 4C: Documentation and repository cleanup (2026-10-20)

- Restored `Docs/EXPERIMENTAL-MODEL-SETTINGS.md` and added ADR-085 (Targeted hole repair), ADR-086 (Memory-safe decimation), and ADR-087 (UV backend auto-resolver) to `Docs/DECISIONS.md`.
- Removed tracked binaries in `deliverables/`, added `deliverables/` to `.gitignore`, and condensed changelog to exactly 3 entries.
- Replaced `Docs/TASKS.md` with verified status register; synchronized `Docs/MEMORY.md`, `Docs/ARCHITECTURE.md` (SSOT Configuration Map), and `README.md`.
- Added `pytest.importorskip("xatlas")` test guards for clean execution in environments where C-extensions are omitted.
