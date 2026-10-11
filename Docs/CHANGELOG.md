## 2026-10-11 — [Centralized Texture, Detail Preservation & Cross-Stage Reliability]

- Kept ordinary image-to-3D generation on the raw-geometry path and normalized the optional texture pipeline across legacy request paths. Named 1K/2K/4K/8K presets are normalized at the API boundary.
- Hunyuan3D-Paint keeps RealESRGAN automatic; the embedded base-colour atlas must be observable and match the requested square target before texture generation reports success. The Hunyuan export path no longer requests atlas downsampling.
- Removed the RealESRGAN and micro-detail UI toggles, enabled supported high-to-low bake by default, softened AutoRetopo shell smoothing and preserved already-watertight quad inputs, and made Native/Raw disable frontend auto-decimation.
- Fixed Paint3D Texture Studio routing to the manifest ID, passed original references through multi-view requests, guarded degenerate FastMesh normalization, and fixed stale database-page responses and refresh-error visibility.
- Added focused regression tests for request normalization, scheduler parameter filtering, atlas validation, and FastMesh degenerate inputs.

## 2026-10-11 — [Database Administration Surface & Admin Database Tab]

- **New admin router**: `backend/api/routers/database.py` mounted at `/api/v1/system/database` in both `main_singleworker.py` and `main_multiworker.py`: `GET /stats` (SQLite status counts + db size, Redis keys/used_memory, queue counts, file-metadata count, meshes/uploads disk sizes), `GET /keys` (read-only SCAN-based Redis key inspector, limit 1..1000), `DELETE /jobs` (bulk delete by `job_ids`/`status`/`feature`), `POST /jobs/clear`, and `DELETE /files/clear`. API key required; admin role required when a user is authenticated.
- **Confirm-token safety model**: destructive endpoints require typed confirmation (`{"confirm": true}` for bulk delete; `{"confirm": "CLEAR_ALL_JOBS"}` / `{"confirm": "CLEAR_ALL_FILES"}` for the wipes). Non-terminal jobs are skipped unless `force: true`; each job's canonical asset workspace is removed only after the durable dual-store deletion succeeds (ADR-062). The job-key sweep never touches user/token auth keys, uploads and file metadata survive job clears (SQLite VACUUM afterwards), and job records/assets survive file clears.
- **New DatabaseManager methods**: `delete_all_jobs()` and `get_database_size_bytes()`.
- **Frontend**: admin Database tab (`/admin?tab=database`) with stats cards, paginated jobs table with per-row cancel/delete, checkbox multi-select bulk delete, Redis key inspector, and typed-confirmation danger-zone clear actions.
- Tests: `backend/tests/test_database_admin.py` (7 regression tests).
- Docs updated: MEMORY, CHANGELOG, DECISIONS (ADR-067), ARCHITECTURE, api-documentation, README.

## 2026-10-11 — [Backend Verification, Thread-Safe PyMeshLab LODs & Lazy Adapter Isolation]

- **Thread-Safe LOD Simplification**: Resolved PyMeshLab C++ plugin state data-race segfault by executing LOD level decimation passes sequentially in `backend/postprocess/services/simplify.py:run_lods`.
- **Lazy Adapter Helper Imports**: Converted top-level `utils` imports to lazy in-method imports across `p3sam_adapter`, `partuv_adapter`, `ultrashape_adapter`, and `voxhammer_adapter`, matching the architectural pattern of other adapters and preventing cross-adapter namespace shadowing.
- **Multiview Request Schema**: Added `enhancement_enabled` and `preprocessing_artifact_id` fields to `MultiViewGenerateRequest` in `backend/api/routers/multiview.py`.
- **Pytest Configuration & Contracts**: Added `pythonpath = backend .` in `backend/pytest.ini` and updated path fixtures in `test_phase1_contract.py`, `test_quality_evaluation.py`, and `test_generation_dependency_contract.py`. Full test suite achieves 100% pass (148 passed, 3 skipped, 0 failed).
- Docs updated: MEMORY, CHANGELOG.

