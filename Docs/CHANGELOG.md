## 2026-10-03 — [Deep Adapter Parity & Source-Fidelity Closure]
- Centralized raw-source fidelity in the scheduler by stripping adapter-level extraction, decimation, and remesh controls before model inference.
- Closed legacy Hunyuan3D-2.1 parity gaps: seeded 50-step / 5.0-guidance source generation is shared by raw and Shape→Paint paths.
- Fixed TRELLIS source texture/metadata contracts and fixed maximum source texture profiles for TRELLIS/TRELLIS.2.
- Expanded regression coverage and reconciled relevant documentation; CUDA/NVIDIA visual A/B remains runtime-gated.

## 2026-10-03 — [Adapter Raw-Quality / Official-Parity Fix]
- Fixed raw `source.glb` quality drift caused by a global 75-step inference contract; generation now follows model-specific upstream/tuned schedules.
- Corrected TripoSR raw extraction to 320 and TripoSF to 1024³ + 1,638,400 samples, with the existing VRAM safety cap retained.
- Added Hunyuan seeded generators, connected Mini Turbo FlashVDM to its official pipeline method, and restored TRELLIS hole filling + Z-up→Y-up extraction parity.
- Added the adapter quality bug report, replaced `Docs/TASKS.md`, and expanded official-parity regression coverage.

## 2026-10-03 — [Production-Ready SOTA Asset Pipeline & Single All-in-One Docker Engine]
- Implemented High-to-Low micro-detail and normal map baking in `backend/postprocess/pipeline.py`: rays cast from decimated/game-ready mesh UVs onto the immutable high-poly master sculpt (`source.glb`), extracting tangent-space normal maps, ambient occlusion, and ORM channels into `textures/`, and embedding them directly into the game-ready GLB material.
- Added UI Micro-Detail Normal Map Baking toggle to `GeneratePanel.tsx` under the Target & Polycount Budget card, wired through `features/workspace/store/WorkspaceContext.tsx` and protected by `_POSTPROCESS_ONLY_INPUTS` scheduler firewall.
- Designed and implemented Single All-in-One Docker Image (`Dockerfile`, `Dockerfile.runpod`, `supervisord.conf`, `docker-compose.yml`):
  - Bundles CUDA 12.4, headless Blender 4.3+, embedded Redis (port 6380), complete Conda environment (`3daigc-api` with PyTorch 2.6.0+cu124 and all model weights/adapters), FastAPI backend (port 7842), and pre-built Next.js frontend (port 3000) into a single, fully portable, self-contained container.
  - Auto-activates Conda environment on container shell entry (`docker exec -it formash3d bash` / `./manager.sh docker-shell`) for seamless debugging and offline portability (`docker save`).
  - Container build delegates directly to native repository automation (`scripts/setup.sh --auto --skip-cuda --conda`), eliminating redundant scattered commands and automatically building the complete frontend, backend, wheels, Conda environment, and model dependencies without interactive prompts.
- Built complete Docker management lifecycle directly into `manager.sh`: interactive menu option `[9] Docker Engine` and CLI commands (`docker`, `docker-build`, `docker-run`, `docker-stop`, `docker-logs`, `docker-shell`, `docker-export`).
- Added non-interactive and modular flags to `scripts/setup.sh` and `backend/scripts/install.sh`: `--auto` (skips interactive prompts), `--skip-cuda` (reuses container/system CUDA without apt interference), and `--conda` / `--venv` / `--env-manager`.
- Fixed model visibility and weight readiness detection in `backend/api/routers/system.py` and `GeneratePanel.tsx`:
  - Resolved model weight detection bug where `_is_model_weights_available` strictly required both a descriptor (`config.json`/`model_index.json`) AND a checkpoint, which incorrectly marked standalone weights (Hunyuan3D Shape/DiT, TripoSF, UltraShape, PartPacker, PartField) as `"weights_missing"`.
  - Added known model signature detection (`triposf`, `mp_rank`, `hunyuan`, `partpacker`, `ultrashape`, etc.) and multi-candidate relative path resolution across repo root and `backend/`.
  - Updated `GeneratePanel.tsx` to prioritize ready engines at the top of the selector without hiding uninstalled/download-pending models, adding readiness badges (`PBR Texture`, `Raw Mesh`, `Weights Missing`, `GPU Req`) so all 3D engines remain accessible and transparent.
- Enhanced test coverage across all modules (63 passed, 3 skipped, 0 failed), passing `npx tsc --noEmit` with 0 errors.
