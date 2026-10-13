## 2026-10-13 — [Hunyuan Loader and Runtime Dependency Fixes]

- Pinned shared Transformers to 4.48.3, satisfying Mini Turbo's upstream `transformers>=4.48.0` requirement and restoring PEFT's `HybridCache` import while retaining the existing Diffusers and PyTorch/CUDA pins.
- Fixed Hunyuan3D-Shape imports to match the vendored `hy3dshape.pipelines` / `hy3dshape.rembg` package layout, removed runtime mutation of vendored files, and made package-root selection deterministic.
- Hardened Mini Turbo load preflight for missing source/checkpoint directories, prioritized the vendored `hy3dgen` package, rejected CPU initialization early, and logged stage-specific failures with chained tracebacks.
- Kept full worker tracebacks in backend logs while returning a concise model-load failure summary to the UI.
- Added source-contract regression tests and updated runtime documentation.
- CUDA/model inference validation is not available through the GitHub execution connection; do not treat static contract checks as a GPU pass.

## 2026-10-11 — [Tripo Catalog and Multi-View Retirement]

- Removed the dedicated Zero123++ Multi-View workspace, API router, model registration, and associated tests.
- Kept TripoSG as the sole selectable Tripo model because it is a self-contained high-fidelity image/scribble generator; removed TripoSR and TripoSF integrations. TripoSF's image path depended on TripoSR coarse-mesh generation, so retaining it while removing TripoSR weights would have left a hidden runtime dependency.
- Removed retired models from scheduler profiles, model manifests, smart presets, UI fallback priorities, manager menu, download/verification script, and install dependency flow. TripoSG/RMBG weight downloads and its requirement installation remain.
- Updated active architecture, product, design, API, and model catalog docs. All `backend/thirdparty/` vendored source directories were left untouched for separate manual cleanup.



## 2026-10-11 — [Full Audit Remediation: Geometry Fidelity, Texture Pipeline, API Lifecycle, DB Admin & UI Contracts]

- **Raw Geometry & Coordinates (RAW-QUALITY-001, BUG-006, BUG-024)**: Removed resolution clamps across TripoSR (`mc_resolution` up to 512), TripoSG (full inference steps and octree depth), and Hunyuan3D shape/mini turbo models when `source_quality == 'max'`. Fixed TripoSF upright Y-up coordinate basis without spurious 90° X rotation. Updated GeneratePanel mesh quality options to reflect downstream polycount rather than unsupported grid estimates.
- **Post-Processing & Texture Pipeline (BUG-001, BUG-008, BUG-009, BUG-017, BUG-019, BUG-020, BUG-026)**: Fixed Stage 7 indentation so game-ready GLB, FBX, and LODs execute regardless of texturing toggle. Designated `textured_model_url` as `active_model_url` on texturing success while preserving immutable `master/source.glb`. Generated downstream FBX and LODs from textured derivatives. Applied Paint3D scene node transforms via `scene_to_mesh()`. Unclamped 8K bake maps and recorded dimensions per map. Propagated bake and collision failures into `artifact_errors` and `degraded_reasons`. Reported truthful `degraded` fallback for quad retopology on native-textured models.
- **API Contracts & Lifecycle (BUG-002, BUG-012, BUG-013, BUG-018, BUG-023)**: Single-pass pop of nested `texture_resolution` with precedence hierarchy. Preserved original `reference_image_path` when image enhancement is used. Tracked all `mesh_gen_*` temporary directories in metadata and cleaned up at job end or scheduling failure. Fixed adapter `get_vram_status()` to report ineligible when CUDA is unavailable and validate assigned `gpu_id`. Validated supported texture resolutions (1K, 2K, 4K, 8K) returning 422 for arbitrary numbers.
- **Database Admin & FileStore Consistency (BUG-003, BUG-004, BUG-005, BUG-014, BUG-015, BUG-016, BUG-025)**: `_delete_tree()` handles files (`unlink()`) and directories (`rmtree()`) with containment guards. `clear_all_files()` enumerates full batches before deletion to report authoritative counts. Distinguish `deleted`, `missing`, and `not_recorded` workspaces in API and UI. Filter Redis keys by `status` and `feature`. Cancel and drain active workers before job deletion. Clean stale FileStore IDs across global and per-type sorted sets. Dynamically derive `_models_root()` from `_storage_root() / "models"`.
- **Frontend UI & Quality Badges (BUG-007, BUG-010, BUG-011, BUG-021, BUG-022, BUG-027)**: Mapped 4K preset to 4096 across all builders. Consumed backend model readiness dynamically from `/system/models`. Disabled unsupported TexturePanel controls (Low VRAM, style presets, PBR toggles) with tooltips. Eradicated literal icon token strings across 6 UI components. Emitted warning toasts with degradation reasons on degraded production status and preserved `productionStatus` on `ModelAsset`.
- **Verification**: All regression suites passing with 100% success (11 passed in `test_api_contracts_lifecycle.py`, 13 passed in `test_database_admin.py`, 15 passed in `test_generation_adapter_regressions.py`, 14 passed in `test_postprocess_texture_pipeline.py`, 16 passed in `test_paint3d_adapter.py` / `test_postprocess_e2e.py`, 6 passed in `test_cancellation_and_quad.py`; `bun run test` / `tsc --noEmit` exited 0).


