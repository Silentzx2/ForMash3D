# ForMash 3D — Changelog

All notable changes, architectural updates, and feature implementations for ForMash 3D are documented in this file.

---

### 🔧 Third-Party Source Code Migration
- **ForMash3D-thirdparty Repository**: Cloned `https://github.com/Silentzx2/ForMash3D-thirdparty` into `backend/thirdparty/`. All third-party model source code (TRELLIS, TRELLIS.2, TripoSF, TripoSG, TripoSR, UltraShape, UniRig, VoxHammer, FastMesh, Hunyuan3D-2.1, Hunyuan3DPart, PartField, PartPacker, PartUV, ardy) is now tracked as part of the main ForMash3D repository. The `wheels/` directory is excluded via `backend/.gitignore`.

## [Unreleased]

### 🐛 Bug Fixes
- **Bug 1 - `text_to_textured_mesh` feature unavailable**: Fixed `get_model_configs_from_settings()` in `backend/core/scheduler/model_factory.py` to handle dict-based model configs from YAML (not just ModelConfig objects). Added fallback to `get_default_model_configs()` in `backend/core/config.py` when `models.yaml` fails to load.
- **Bug 2 - `torch.float8_e8m0fnu` AttributeError**: Added compatibility shim in `backend/core/config.py` that patches `torch.float8_e8m0fnu` and `torch.float8_e5m2` when missing (torch 2.8.0 compatibility). Pinned `transformers==4.43.2` and `diffusers==0.24.0` in `backend/requirements.txt` to avoid FP8 integration errors.
- **Bug 3 - `diffusers`/`transformers` circular import (`PreTrainedModel`)**: Fixed by pinning compatible `transformers` and `diffusers` versions. The `finegrained_fp8.py` integration in newer transformers references `torch.float8_e8m0fnu` which doesn't exist in torch 2.8.0.
- **Bug 4 - `open3d.io.read_triangle_mesh()` PosixPath type error**: Fixed in `backend/thirdparty/TripoSF/inference.py` by converting `mesh_path` to `str()` before passing to `o3d.io.read_triangle_mesh()`. Also fixed in `backend/adapters/triposf_adapter.py` to pass `str(temp_gt_path)`.
- **Bug 5 - Setup Script & Environment Manager Orchestration**: Restored clean architecture where `scripts/setup.sh` does not create or activate Python environments, delegating all environment creation to `backend/scripts/install.sh`. In `install.sh`, `choose_env_manager` now directly prompts the user for Conda vs venv (defaulting to venv) and includes graceful fallback from Conda to venv when Conda environment creation is blocked by the host platform.

### 🚀 Premium SaaS Polish, Three.js Studio Environment Engine & DCC Bridge (2026-09-26)
- **Specular Lighting & Button Shine System**:
  - Implemented `.btn-lighting-shine` with continuous high-fidelity specular sweep keyframes (`btn-specular-sweep`) across all primary call-to-actions: Generate 3D Model, Generate PBR Texture, Run Retopo, Run Segmentation, Generate Motion, Studio Dashboard actions, and Export CTAs.
  - Implemented `.glass-panel` and `.glass-card-interactive` utility classes providing ultra-clean backdrop-blur glassmorphism with subtle 1px specular border rim highlights.
- **Three.js Environment & Lighting Overhaul**:
  - Eliminated conflicting 2D background CSS grid overlay from `app/layout.tsx` that previously bled over UI panels and the WebGL canvas.
  - Resolved `gridHelperRef` collision where animation playback state prematurely overwrote user environment settings.
  - Created an expanded **Studio Environment** panel (`MeshViewer.tsx`):
    - **Backdrop Swatches**: Instant switching between Studio Vignette, Deep Void (`#060606`), Charcoal (`#131418`), Slate (`#1e2025`), Clay Gray (`#32353f`), and Studio Light (`#e8e9ed`).
    - **Atmosphere Presets**: Studio Gold, Dramatic Rim, Clay Sculpt, Golden Hour, Pure Light.
    - **Lighting Tone Selector**: Studio (`0xfff8f0`), Warm Gold (`0xffe8cc`), Cyber Cool (`0xd8e6ff`), and Neutral Studio Light.
    - **Real-time Studio Controls**: Live directional sliders for Key Light, Fill Light, Rim Light, Ambient Light, Camera Exposure, and Contact Shadow Opacity.
    - **Stage Controls**: Interactive toggles for floor grid and 360° turntable auto-rotation.
- **DCC Live Bridge Module (`DccBridgeModal.tsx`)**:
  - Built direct live bridge integration modal for Blender 4.x/5.x, Unreal Engine 5 (Remote Control API), Unity Editor, and Autodesk Maya.
  - Includes connection status polling, host/port customization, pipeline flags (PBR Textures, Rigging/Armature, Auto-focus), and 1-click copyable ingestion scripts.
  - Fully wired and mounted in `WorkspaceShell.tsx` and triggered by `TopHeader.tsx`.
- **Performance & Viewport Snappiness**:
  - Added instant toast confirmation for viewport 3D snapshots.
  - Optimized component re-renders to maintain 60fps interaction during rapid tool and lighting tone switching.

### 🎨 High-Saturation Electric Studio Gold & Viewport Clarity Refinement (2026-09-26)
- **High-Saturation LCD Punch (`#FFCC00` / `48 100% 50%`)**:
  - Re-anchored `--primary`, `--ring`, `--accent`, and `--studio-yellow-1` to `48 100% 50%` (`#FFCC00`). Hue 48 with 100% saturation and 50% lightness completely solves the "dead/murky" appearance on standard sRGB laptop LCD displays while preserving rich electric gold aesthetics.
  - Accent gradient stops refined to `#FFE066` (specular highlight) -> `#FFCC00` (core punch) -> `#E09800` (deep gold baseline).
  - Maintained >12:1 WCAG contrast against `#080808` dark typography.
- **Three.js 3D Viewport Backdrop & Grid Overhaul**:
  - Identified and eliminated the root cause of the foggy blue dishwater look in `/workspace`:
    - Replaced the hardcoded slate-blue radial gradient (`#2c303a 0%, #202229 50%, #131418 100%`) under the transparent Three.js WebGL canvas in `MeshViewer.tsx` with a deep studio black gradient: `radial-gradient(ellipse 75% 65% at 50% 50%, #161616 0%, #0d0d0d 55%, #060606 100%)`.
    - Replaced the neon-blue `THREE.GridHelper(20, 40, 0x3b82f6, 0x1e293b)` with a clean studio grid `THREE.GridHelper(20, 40, 0xFFCC00, 0x222222)`.
    - Changed default `gridColor` from `#3d4252` to `#222222` and Three.js fill light from cold blue (`0xdbeafe`) to neutral studio light (`0xf5f5f7`).
- **Complete Elimination of Residual Murky Hex Codes**:
  - Replaced all legacy slate/blue borders (`#272a34`, `#3d4252`, `#2c303d`, `#1c1e24`, `#262932`) across `MeshViewer.tsx`, `GeneratePanel.tsx`, `SecondaryPanels.tsx`, `RemeshPanel.tsx`, `TexturePanel.tsx`, and `WorkspaceContext.tsx` with semantic `border-white/[0.12]`.
  - Upgraded Generate 3D Model, Run Retopo, Run Segmentation, Generate Texture, and Export CTAs with high-energy gold gradients and crisp specular highlights.

### 🎨 Frontend Visual-System Refinement & Brand Color Unification (2026-09-26)
- **Palette Alignment (`#080808` + Dark Gray + Studio Yellow Accent `#F5C542`)**:
  - Re-anchored global design tokens across `app/globals.css`, `tailwind.config.ts`, and `Docs/UI-DESIGN-SYSTEM.md` to a professional matte black studio hierarchy:
    - Base canvas / backdrop: `hsl(0 0% 3.1%)` (`#080808`)
    - Surface hierarchy: `--surface-1` (`#111111`), `--surface-2` (`#1A1A1A`), `--surface-3` (`#242424`), `--surface-4` (`#333333`)
    - High-contrast border token: `--border` (`#333333`)
    - Studio yellow primary: `--primary` (`hsl(44 89% 61%)` / `#F5C542`), `--color-accent-dark` (`#E0A800`), `--color-accent-light` (`#FFD866`)
    - Typography: `--foreground` calibrated to `hsl(0 0% 96%)` (`#F5F5F5`), `--muted-foreground` calibrated to `hsl(0 0% 63%)` (`#A0A0A0`) for robust legibility on non-OLED laptop LCD screens.
    - Integrated canonical spec gradients from `assets/colors.jpeg`:
      - `BG GRADIENT`: `radial-gradient(120% 80% at 50% -10%, #171717 0%, #0d0d0d 45%, #080808 100%)` for photographic canvas depth.
      - `SURFACE GRADIENT`: `linear-gradient(180deg, #181818 0%, #101010 100%)` for card surface elevation.
      - `YELLOW ACCENT GRADIENT`: `linear-gradient(135deg, #FFD866 0%, #F5C542 50%, #E0A800 100%)` with specular top highlights on buttons and active states.
      - Added overhead studio ambient warm light and card specular top highlights (`inset 0 1px 0 rgba(255,255,255,0.08)`).
- **Accessibility & WCAG AA/AAA Compliance**:
  - Enforced strict dark-text typography (`text-[#080808]` / `text-[hsl(var(--primary-foreground))]`) on all solid yellow buttons (`components/premium/NeonButton.tsx`, Admin action buttons, error page triggers, 404 navigation) guaranteeing > 11:1 contrast ratio against the `#F5C542` background.
  - Ensured all active tab pills and selection states maintain >= 4.5:1 text-to-surface contrast.
- **Elimination of Decorative Neon & Legacy Colors**:
  - Systematically audited and eliminated decorative neon purple, cyan, blue, pink, and saturated rainbow gradients across `features/admin/*`, `components/ActivityLogger.tsx`, `app/layout.tsx`, `app/error.tsx`, `app/not-found.tsx`, `features/settings/*`, and `features/workspace/*`.
  - Replaced hardcoded legacy `#10141d` surfaces with semantic `bg-[hsl(var(--surface-0))]` and `border-border`.
  - Upgraded keyframe animations (`pulse-glow`, `glow-breathe`, `cyber-glitch`, `holo-shimmer`, `icon-glitch`) and mesh gradient overlays to restrained studio lighting.
- **Component Upgrades**:
  - `components/premium/Badge.tsx`: Realigned status variants to studio yellow (`amber`), emerald (`success`), rose (`error`), and sky (`info`).
  - `components/premium/NeonButton.tsx`: Added `solidTextClass` for dark text contrast, mapped default variant to amber yellow.
  - `components/premium/ProgressBar.tsx`: Swapped default violet gradient to yellow-to-gold gradient with gold glow.
  - `components/premium/MetricCard.tsx`: Replaced neon icon colors with studio yellow and neutral gray; updated card borders to standard border tokens.
  - `components/ui/slider.tsx`: Updated slider track fill to solid `bg-primary`.
  - `features/workspace/Viewport/MeshViewer.tsx`: Updated 3D skeleton joints, selection rings, and matcap normal preview indicators.
  - `app/layout.tsx`: Replaced oversized ambient neon purple/cyan blur blobs with a single subtle warm studio ambient glow (`opacity: 0.025`) and clean dark grid lines.
- **Quality & Build Verification**:
  - Full TypeScript validation (`npx tsc --noEmit`): 0 errors.
  - Full Next.js production build (`npx next build`): 13/13 static and dynamic routes compiled successfully.

### 🛡️ Generation Runtime Hardening & Jobs UI Consolidation (2026-09-26)
- **TripoSR Adapter Hardening**: Added path resolution (`backend/pretrained/TripoSR` or `pretrained/TripoSR`), explicit catching of native extension / CUDA mismatch errors (e.g. `torchmcubes` or `libcudart`) with chained root cause preservation (`from e`), fixed texture metadata reporting (`texture_requested`, `texture_bake_succeeded`, `has_texture`), and verified output file existence, size, and valid non-empty mesh topology before returning success.
- **TripoSG Adapter Hardening**: Added deterministic snapshot provenance resolving local weights or downloading snapshot locally to prevent remote mutable diffusers custom code resolution failures; preserved real load exceptions with `from e`; added strict output mesh validation.
- **Scheduler Worker Lifecycle & VRAM Safety**:
  - Implemented worker process initialization handshake via `control_response_queue`, eliminating false worker starts when model loading fails.
  - Replaced endless `"NO_VRAM"` requeue loops on worker startup failure with `"MODEL_LOAD_FAILED"` that immediately marks the job `FAILED` in the job queue with actionable diagnostic details.
  - Added 600s timeout handling in `_handle_job_result`.
  - Added pending future resolution in `_cleanup_dead_workers` with explicit `job_id`-to-`callback_id` tracking, ensuring dead workers immediately resolve pending futures with failure results, clean up tracking dictionaries, and deallocate VRAM safely without raising `InvalidStateError`.
  - Added `proc.is_alive()` validation in `_find_available_worker`.
  - Hardened `JobQueue.fail_job` to look up and mark failed jobs in both `_processing_cache` and `_queue_cache`.
- **Installer Hardening**:
  - Removed masked `|| true` errors on TripoSF, TripoSG, TripoSR, ardy, and required apt system runtime packages (`libsm6`, `libegl-mesa0`, `libgl1-mesa-dev`) in `backend/scripts/install.sh`, halting on failure with clear diagnostics and suppressing false success completion banners.
  - Added comprehensive post-installation runtime environment diagnostics (Python, PyTorch, Torch CUDA, GPU name, capability, NumPy, Diffusers, Transformers, Open3D, MeshLab, Trimesh).
- **Jobs UI Consolidation**:
  - Added authoritative `Jobs` entry to the main workspace left navigation rail (`features/workspace/Navigation/LeftNavigation.tsx`) with hotkey shortcut `⌘3`, linking directly to `/workspace/jobs`.
  - Consolidated Admin `JobsTab.tsx`: eliminated artificial 50% progress bars in favor of truthful status badges, removed non-functional fake "Try Repair" button and toast, added canonical inspector header banner, and preserved deep-linking to `/workspace/jobs?id={id}`.
- **Model Registry Documentation Alignment**: Reconciled documentation in `README.md` to reflect all 23 discrete registered model adapters configured across 15 neural architectures.
- **Wheelhouse & Runtime Updates**: Updated `backend/thirdparty/wheels/` with CUDA 12.4 + PyTorch 2.6 runtime compatibility patches, updated `torchmcubes` wheel, `wheels/manifest.json`, and TripoSR/TripoSG pipeline improvements. Third-party source code is now part of the main repository; wheels are downloaded from the ForMash3D GitHub Release at runtime.
- **Unit & Shell Test Suite**: Added `backend/tests/test_fix_plan_verification.py` verifying TripoSR/TripoSG error handling, output validation, worker liveness, real dead worker future resolution via callback tracking, and immediate failure propagation on model load errors; extended `scripts/test_env_resolution.sh` with automated installer apt-failure verification.

### 🔧 Backend Environment Discovery & Startup Resilience
- **Robust Conda & Venv Resolution**: Rewrote Python 3.10 runtime lookup in `backend/scripts/run_server.sh` to auto-detect Conda installations (`/opt/conda`, `~/miniconda3`, `/content/miniconda3`) and locate the `3daigc-api` environment even within non-interactive subshells.
- **Eliminated Destructive Startup Reinstalls**: Prevented blind creation of empty `.venv` and unconstrained raw PyPI package downloads on startup that previously caused disk-space exhaustion (`No space left on device`) and missing module errors (`yaml`).
- **Configuration Persistence**: Added automatic persistence of `FORMASH3D_ENV_MANAGER` and `PYTHON_EXEC` into `.env` upon environment setup in `backend/scripts/install.sh`.
- **HuggingFace CLI Python Fallback**: Updated `backend/scripts/download_models.sh` to resolve `PYTHON_EXEC` for fallback downloads.
- **Unified Banner Art**: Synchronized ASCII banner art across `manager.sh` and `scripts/setup.sh` to display `FORMASH 3D`.
- **Automated Self-Check**: Added `scripts/test_env_resolution.sh` smoke test to verify non-destructive environment discovery.

### 🏷️ Project Rebrand to ForMash 3D & Repository Migration
- **Project Rebrand**: Executed complete first-party rebrand from AI Studio to **ForMash 3D** (short technical identifier: `ForMash3D`) across UI components, browser titles, metadata, app icons, webmanifest, local caches, storage keys, CLI scripts, and backend FastAPI documentation.
- **Repository Migration**: Updated canonical repository origin to `https://github.com/Silentzx2/ForMash3D.git`. Third-party source code is now included directly in `backend/thirdparty/` as part of the main repository; wheels are stored in `backend/thirdparty/wheels/` and downloaded from the ForMash3D GitHub Release at runtime.
- **Static Asset Migration**: Switched project banner from external hosted image to local static asset `assets/banner.png`.
- **Backward Compatibility**: Preserved fallback support for legacy environment variables (`FORMASH3D_*` with `AI_STUDIO_*` fallback).
- **Attribution & Licensing**: Preserved all upstream third-party attributions, licenses, and model architectures (`3DAIGC-API`, `TripoSR`/`SG`/`SF`, `TRELLIS`, `Hunyuan3D`, `PartField`, `UniRig`, `ARDY`, `PartPacker`, `UltraShape`).

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/).
