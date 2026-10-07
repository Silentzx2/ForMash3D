## 2026-10-07 — [Unique3D Integration]

- Integrated official AiuniAI/Unique3D (upstream commit `6311af200ee197544e82e0f2557cd890edd60416`) as a first-class single-image → 3D model
- Vendored source at `backend/thirdparty/Unique3D/` (MIT license preserved, `.git` metadata removed)
- Added `download_unique3d()` to `backend/scripts/download_models.sh` with official checkpoint layout: `controlnet-tile/`, `image2normal/`, `img2mvimg/`, `realesrgan-x4.onnx`, `v1-inference.yaml`
- Updated `manager.sh` with Unique3D menu entry `[23]`
- Created `backend/adapters/unique3d_adapter.py` with `Unique3DImageToRawMeshAdapter(ImageToMeshModel)`
- Registered in lazy adapter map (`backend/adapters/__init__.py`), model factory (`backend/core/scheduler/model_factory.py`), and model manifest (`backend/config/models.yaml`)
- Added frontend registry entry in `constants/models.ts` with canonical ID `unique3d_image_to_raw_mesh`
- Wired model-native parameters in `buildGenerationParameters.ts`: `seed`, `input_processing`, `do_refine`, `expansion_weight`, `init_type`
- Updated documentation: `README.md`, `Docs/ARCHITECTURE.md`, `Docs/DECISIONS.md` (ADR-055), `Docs/api-documentation.md`
- VRAM requirement: 10240 MB (placeholder until measured), `max_workers: 1`

## 2026-10-05 — [Mini Turbo & TRELLIS generation fixes]

- Fixed `hunyuan3d_dit_v2_mini_turbo` adapter: pipeline now loads from the correct checkpoint subfolder `hunyuan3d-dit-v2-mini-turbo` inside the downloaded `tencent/Hunyuan3D-2mini` repo (the bundled `from_pretrained` default subfolder `hunyuan3d-dit-v2-0` does not exist there).
- Fixed the bundled `smart_load_model` loaders in `hunyuan3d-dit-v2-mini-turbo` and `hunyuan3d-shape-v2-1` to resolve absolute local weight paths instead of treating them as Hugging Face repo IDs (which produced `HFValidationError` when weights were missing/partial). Missing local weights now raise a clear `FileNotFoundError` with the exact `download_models.sh` command.
- Fixed TRELLIS texture baking (`postprocessing_utils.py`): replaced the in-place `loss += lambda_tv * tv_loss(texture)` with a new-tensor assignment so PyTorch 2.x keeps the grad graph intact during gradient descent texture optimization.

## 2026-10-05 — [Frontend Dependency Version Upgrade]

- Upgraded all frontend dependencies to the latest stable versions verified against the npm registry and peer requirements: next 16.3.8, react/react-dom 19.3.0, three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, @tanstack/react-query 5.104.1, @xyflow/react 12.12.0, all 27 @radix-ui packages to latest 1.x/2.x, tailwindcss 4.3.3 / @tailwindcss/postcss 4.3.3, typescript 7.0.2, @types/node 24.19.1 / @types/react 19.3.0 / @types/react-dom 19.3.0 / @types/three 0.186.0, eslint 9.39.5 / eslint-config-next 16.3.8, zustand 5.0.15, motion 13.4.6, lucide-react 1.52.0, axios 1.20.0, react-hook-form 7.89.0, sonner 2.0.8, input-otp 1.5.0, vaul 1.1.2, cmdk 1.1.1, embla-carousel-react 8.6.0, recharts 3.10.1, clipper-lib 6.4.2, clsx 2.1.1, class-variance-authority 0.7.1, tailwind-merge 3.7.0, tailwindcss-animate 1.0.7, three-mesh-bvh 0.9.15, three-bvh-csg 0.0.18, @dimforge/rapier3d-compat 0.21.0, meshoptimizer 1.3.0, @hugeicons/react 1.1.10, and all @dnd-kit packages to latest. Runtime locked: Node.js 24.21.0 LTS, npm 11.19.0, Bun 1.4.2 (packageManager field, package.json engines, and scripts/setup.sh). All dependencies verified against the current registry and peer requirements; bun.lock regenerated with Bun 1.4.2.
- Pinned react-day-picker 8.10.2 and react-resizable-panels 3.0.6 instead of their newest majors (v10/v9 and v4) because those majors renamed APIs the workspace uses (DayPicker icon component/classname customization; PanelGroup/PanelResizeHandle). Pinned at the latest versions still compatible with the existing codebase, so no out-of-scope app-code changes were introduced.
- `bun run test` (tsc --noEmit) and `bun run build` (Next.js 16.3.8 / Turbopack, 13 static pages) pass. `bun run lint` fails on a pre-existing incompatibility (typescript-eslint all versions <=8.71.0 do not support the TypeScript 7.0.0 API; reproduces identically on HEAD) — recorded as a compatibility issue for the debugging phase, not fixed here.
- Added the frontend runtime version lock to scripts/setup.sh (REQUIRED_NODE_VERSION=24.21.0, REQUIRED_NPM_VERSION=11.19.0, REQUIRED_BUN_VERSION=1.4.2): the toolchain detects a version mismatch and installs/forces the locked versions.
- Removed the stale package-lock.json to keep the lockfile aligned with the Bun toolchain.

## 2026-10-05 — [Smart Generation Closure]

- Closed SG-01 with a real smart-generation submission endpoint, deterministic intent→model execution, one-click intent generation in the workspace when an approved image is ready, and inline explainability.
- Added focused regression coverage for smart presets, preprocessing provenance, and printability reporting.

