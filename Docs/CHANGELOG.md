## 2026-10-10 — [Restart-Durable Asset Persistence: History URL Backfill, Redis History Fallback & Postprocess Crash Fix]

- **Asset persistence after refresh/restart (UI)**: Job history now returns canonical production artifact URLs for every completed job (`model_url`/`game_ready_url` = game-ready GLB, `source_model_url`/`high_fidelity_url` = `master/source.glb`, `thumbnail_url` = job thumbnail endpoint). The workspace history mapping (`features/workspace/lib/api.ts`, `WorkspaceContext.tsx`, `normalizeModelAsset` in `features/workspace/types.ts`) always populates game-ready (default view) and source artifact URLs plus a thumbnail endpoint fallback, so models and thumbnails load from the backend even after a page refresh or backend restart. The viewer artifact rail fetches `game_ready/*.glb` by default and `master/source.glb` when Source is selected.
- **Job history in Redis (multi-worker) mode**: `get_jobs_history` only consulted SQLite when a `db_manager` existed; with durable jobs living in Redis (empty SQLite) history returned `[]` and the UI lost all assets after refresh. It now falls back to the Redis job listing when the SQLite page is empty. `RedisJobQueue.get_jobs_by_status` now restores each job's real `status`, `progress`, `result`, and `completed_at` from Redis instead of returning reconstructed requests with default status and no result.
- **Production post-processing crash fix**: `postprocess/pipeline.py::_sha256_file` was typed `Path` but received `str` paths from `resolve_server_file_path`, raising `AttributeError: 'str' object has no attribute 'open'` at the first pipeline stage for every mesh job — no canonical workspace (`master/source.glb`, `game_ready/`, thumbnails) was ever written. The shared helper now accepts `Path | str`.
- Docs updated: ARCHITECTURE, api-documentation, MEMORY, CHANGELOG.

## 2026-10-10 — [Full CPU Multi-Core Concurrency, Hunyuan Turbo Acceleration & Strict GPU Enforcement]

- **Full CPU Core Concurrency**: Configured `resource_planner.py` and `multiprocess_scheduler.py` so all scheduler workers and mesh postprocessing threads utilize all available CPU cores (`nproc=8`, `OMP_NUM_THREADS=8`, PyTorch intra-op threads) instead of bottlenecking on a single thread.
- **Hunyuan3D Turbo Speed Optimization**: Optimized `Hunyuan3D-DiT-v2-mini-Turbo` marching cubes reconstruction with configurable `octree_resolution=380` (replacing the hardcoded 512 grid stall), `num_chunks=20000`, and `topk_mode='merge'` for FlashVDM, dropping extraction time from >5 minutes to <35 seconds.
- **Hunyuan3D Shape v2.1 Fast Preset**: Aligned default inference steps to 30 and `octree_resolution=256` for fast raw generation while supporting 50 steps for high fidelity.
- **Strict GPU Inference Enforcement**: Audited and hardened all model adapters (`TRELLIS`, `TripoSR`, `TripoSG`, `TripoSF`, `Zero123++`, `Unique3D`, `UltraShape`, `VoxHammer`) to guarantee execution strictly on CUDA devices (`cuda:0`), raising immediate errors rather than silently falling back to slow CPU inference.
- **TRELLIS Parity & Compatibility**: Added backward-compatible `TrellisTextToTexturedMeshAdapter` alias and matched frontend contract parity schemas.

## 2026-10-09 — [Unified Runtime Logging & Mini Turbo Initialization]

- Fixed Mini Turbo's `NoneType is not callable` failure by passing `device` to `from_pretrained()` instead of chaining the upstream in-place `.to()` method.
- Added regression coverage for the pipeline initialization contract.
- Consolidated project-managed API, scheduler/worker, frontend, launcher, and local Redis output into repository-root `logs/master.log`; removed per-service log targets and rotating siblings.
- Updated the startup scripts, Supervisor, Docker/Compose mounts, manager log viewer, and Admin Logs API/client to use the master log.
- Updated the existing README, architecture, memory and changelog documentation.
