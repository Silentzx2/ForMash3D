# Architecture Decisions — ForMash 3D

> **Version**: 0.1.0
> **Last Updated**: September 2026

---

## ADR-001: Lazy Adapter Loading

**Decision**: All model adapters use lazy imports inside `_load_model()` to prevent cascading import failures.

**Reason**: Optional heavy packages (`accelerate`, `cv2`, `yacs`, `box`) should not prevent other models from loading. When a model's dependencies are missing, only that model should fail, not the entire system.

**Consequences**:
- Adapters import cleanly even when optional dependencies are missing
- `__getattr__` in `backend/adapters/__init__.py` handles lazy loading
- System remains functional with partial model availability

---

## ADR-002: VRAM-Aware Scheduling

**Decision**: Strict GPU mutual exclusion with 1GB safety margin (`VRAM_SAFETY_MARGIN_MB=1024`).

**Reason**: Prevents OOM crashes during concurrent inference on shared GPUs. The scheduler tracks VRAM usage and enforces mutual exclusion so only one job uses the GPU at a time.

**Consequences**:
- No concurrent GPU inference
- Jobs queue when GPU is busy
- 1GB free margin prevents OOM kills
- `AUTO_UNLOAD_AFTER_JOB=true` frees VRAM between jobs

---

## ADR-003: Source Asset Immutability

**Decision**: `source.glb` is preserved byte-for-byte as an untouched master archive.

**Reason**: Enables reproducibility and rollback to original geometry. All downstream processing (decimation, LOD, collision) operates on copies, never the original.

**Consequences**:
- `source.glb` is never modified after generation
- All derived assets reference `source.glb` as the origin
- Users can always regenerate from the original mesh

---

## ADR-004: Local-First Architecture

**Decision**: All processing runs locally; no cloud dependencies.

**Reason**: Privacy, offline capability, and cost control. Users retain full ownership of their 3D assets and data.

**Consequences**:
- No API keys or cloud services required
- All models run on local GPU/CPU
- Data never leaves the user's machine
- Optional Redis for multi-worker queue (still local)

---

## ADR-005: Zustand for Client State

**Decision**: Zustand stores for global client state instead of Redux or Context API.

**Reason**: Minimal boilerplate, fast selectors, easy middleware integration. Zustand's lightweight API fits the project's needs without the overhead of Redux.

**Consequences**:
- `useAppStore.ts`, `useViewerStore.ts`, `useAnimationStore.ts`, `useRiggingStore.ts`, `useUIStore.ts`
- Easy to add new state properties
- TanStack Query handles server state separately

---

## ADR-006: Next.js App Router

**Decision**: Next.js 16 App Router with server components.

**Reason**: Built-in data fetching, layouts, and API proxy routes. The App Router provides a cleaner file-based routing system compared to Pages Router.

**Consequences**:
- `app/` directory structure with `page.tsx`, `layout.tsx`
- Server components for static content
- Client components for interactive UI
- API proxy routes in `app/api/`

---

## ADR-007: Bun as Frontend Package Manager

**Decision**: Bun as authoritative frontend package manager.

**Reason**: Faster than npm/yarn, compatible with npm ecosystem. Bun's built-in test runner, bundler, and package manager reduce toolchain complexity.

**Consequences**:
- `bun install` instead of `npm install`
- `bun run dev` instead of `npm run dev`
- `bun run build` instead of `npm run build`
- `bun run lint` instead of `npm run lint`

---

## ADR-008: Conda for Python Environment

**Decision**: Conda env `3daigc-api` for Python 3.10 + PyTorch 2.6.0 + CUDA 12.4.

**Reason**: Reproducible GPU environment, easy dependency management. Conda handles CUDA toolkit dependencies better than pip alone.

**Consequences**:
- `conda activate 3daigc-api` required for backend
- Python 3.10 pinned for PyTorch 2.6.0 compatibility
- CUDA 12.4 wheels installed from PyTorch index
- `backend/requirements.txt` for project dependencies

---

## ADR-009: FastAPI for Backend

**Decision**: FastAPI as the backend framework.

**Reason**: Async support, automatic OpenAPI docs, Pydantic V2 validation, high throughput. FastAPI's async capabilities are essential for the VRAM-aware scheduler.

**Consequences**:
- Pydantic V2 for request/response models
- Automatic Swagger UI at `/docs`
- Async endpoints for non-blocking I/O
- SSE streaming for generation progress

---

## ADR-010: Redis for Multi-Worker Queue

**Decision**: Redis 7 as optional message broker for multi-worker mode.

**Reason**: Enables distributed job processing across multiple workers. Redis provides fast pub/sub and queue operations.

**Consequences**:
- Single-worker mode: embedded scheduler, no Redis needed
- Multi-worker mode: Redis-backed `RedisJobQueue`
- Redis FileStore for cross-worker metadata sharing
- Bounded 20-connection pool for Redis

---

## ADR-011: meshoptimizer for Decimation

**Decision**: Use meshoptimizer library for SIMD-accelerated mesh decimation.

**Reason**: High-performance, well-maintained library with SIMD optimizations. Supports target polycount reduction while preserving topology.

**Consequences**:
- `meshoptimizer` dependency in `backend/requirements.txt`
- SIMD-accelerated decimation for fast processing
- Target polycount control (15K, 35K, 60K, 100K)

---

## ADR-012: xatlas for UV Unwrapping

**Decision**: Use xatlas library for conformal UV unwrapping.

**Reason**: High-quality conformal parameterization, fast, well-maintained. Produces minimal UV distortion.

**Consequences**:
- `xatlas` dependency
- Conformal UV mapping with minimal distortion
- PartUV adapter wraps xatlas functionality

---

## ADR-013: Three.js + React Three Fiber for 3D Viewport

**Decision**: Three.js with React Three Fiber (R3F) for the 3D viewport.

**Reason**: R3F provides React integration for Three.js, enabling declarative 3D scene construction. Combined with Drei for helpers, it provides a complete 3D visualization solution.

**Consequences**:
- `@react-three/fiber` and `@react-three/drei` dependencies
- `MeshViewer.tsx` as the main 3D viewport component
- Orbit controls, wireframe mode, matcap shading
- Studio environment controls (lighting, backdrop, grid)

---

## ADR-014: Tailwind CSS v4 for Styling

**Decision**: Tailwind CSS v4 with HSL design tokens.

**Reason**: Utility-first CSS framework with excellent developer experience. v4 provides new features and better performance. HSL tokens enable consistent theming.

**Consequences**:
- `tailwind.config.ts` with custom theme extensions
- CSS variables in `app/globals.css` for all design tokens
- No direct hex color literals in UI code
- Studio gold (`#FFCC00`) as primary accent

---

## ADR-015: Hunyuan3D-Paint-v2-1 Pipeline

**Decision**: Integrate Hunyuan3D-Paint-v2-1 with RealESRGAN x4+ and DifferentiableRenderer.

**Reason**: Official Tencent pipeline for high-quality PBR texture synthesis. RealESRGAN provides super-resolution, DifferentiableRenderer validates PBR materials.

**Consequences**:
- `backend/adapters/hunyuan3d_paint_v21.py` adapter
- Shape→Paint automatic chaining
- Configurable texture resolution (512/768), max views (6-12)
- VRAM-aware scheduling (~21GB requirement)
- Dockerfile includes Paint DifferentiableRenderer build

---

## ADR-016: ORJSON for Fast Serialization

**Decision**: Use `orjson` for JSON serialization with graceful fallback to standard `JSONResponse`.

**Reason**: `orjson` is 10-20x faster than the standard `json` module. Critical for high-throughput API responses.

**Consequences**:
- `ORJSONResponse` used in `main_singleworker.py` and `main_multiworker.py`
- Fallback to `JSONResponse` when `orjson` is not installed
- `orjson>=3.9.0` in `backend/requirements.txt`

---

## ADR-017: SSE for Generation Progress

**Decision**: Use Server-Sent Events (SSE) for real-time generation progress streaming.

**Reason**: SSE provides efficient one-way streaming from server to client. Better than polling for real-time updates.

**Consequences**:
- Frontend subscribes to `/api/v1/mesh-generation/status/{job_id}`
- Event types: `queued`, `processing`, `progress`, `completed`, `failed`, `cancelled`
- Progress values from 0.0 to 1.0
- Stage text updates (loading_model, generating, completed)

---

## ADR-018: Model IDs with Version Suffixes

**Decision**: Use explicit versioned model IDs (`hunyuan3d_shape_v21_*`, `hunyuan3d_paint_v21_*`, `hunyuan3d_dit_v2_mini_turbo_*`).

**Reason**: Clear identification of model versions, prevents confusion between legacy and current models. Enables smooth migration paths.

**Consequences**:
- `hunyuan3d_shape_v21_image_to_raw_mesh`
- `hunyuan3d_shape_v21_image_to_textured_mesh`
- `hunyuan3d_paint_v21_image_mesh_painting`
- `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh`
- Legacy IDs (`hunyuan3dv21_*`) still registered but deprecated

---

## ADR-019: Paint-v2-1 Pipeline Architecture

**Decision**: Integrate Hunyuan3D-Paint-v2-1 with RealESRGAN x4+ and DifferentiableRenderer as a separate pipeline from Shape generation.

**Reason**: The Paint-v2-1 pipeline requires a different set of dependencies (RealESRGAN_x4plus.pth, DifferentiableRenderer native modules) and VRAM budget (~21GB) compared to shape generation. Separating it allows independent configuration and scheduling.

**Consequences**:
- `backend/adapters/hunyuan3d_paint_v21.py` adapter with `_resolve_realesrgan_path()`, `get_vram_status()`, `_verify_pbr_output()`
- Shape→Paint automatic chaining support
- Configurable texture resolution (512/768), max views (6-12)
- VRAM-aware scheduling with ~21GB requirement
- Dockerfile needs separate Paint DifferentiableRenderer build step

---

## ADR-020: Third-Party Source Code in Main Repository

**Decision**: All third-party model source code is tracked as part of the main ForMash3D repository in `backend/thirdparty/`.

**Reason**: Simplifies deployment and eliminates external dependencies. The `wheels/` directory is excluded via `.gitignore` to keep the repository size manageable.

**Consequences**:
- `backend/thirdparty/` contains all model source code
- `backend/thirdparty/wheels/` excluded via `.gitignore`
- `backend/scripts/download_models.sh` handles wheel downloads
- 1080+ third-party Python files scanned for bare `except:` clauses
- Upstream code should not be modified

---

## ADR-021: Documentation in `Docs/` Directory

**Decision**: All project documentation lives in `Docs/` (uppercase) directory.

**Reason**: Consistent naming convention across the project. The `docs/` (lowercase) directory was removed to avoid confusion. All references updated to `Docs/`.

**Consequences**:
- `Docs/PRD.md`, `Docs/ARCHITECTURE.md`, `Docs/DESIGN.md`, etc.
- `Docs/CHANGELOG.md` keeps only last 3 changes
- `Docs/TASKS.md` with clear completed/future format
- `Docs/RULES.md` with mandatory doc update policy
- After every code change, all relevant .md files must be updated

---

## ADR-022: Studio Gold Design System

**Decision**: Use Studio Gold (`#FFCC00`, `48 100% 50%`) as the primary accent color on Matte Black (`#080808`) backdrop.

**Reason**: High-contrast, visually distinctive, and professional. Studio Gold provides excellent readability and brand identity. All colors use HSL CSS variables, no hex literals in code.

**Consequences**:
- `app/globals.css` with HSL design tokens
- `--primary: 48 100% 50%` as Studio Gold
- `--surface-0` through `--surface-4` for surface hierarchy
- `next/font/google` for font optimization
- `motion/react` for consistent animations

---

## ADR-023: Bun as Frontend Package Manager

**Decision**: Bun is the authoritative frontend package manager.

**Reason**: Faster than npm/yarn, compatible with npm ecosystem. Bun's built-in test runner, bundler, and package manager reduce toolchain complexity.

**Consequences**:
- `bun install` instead of `npm install`
- `bun run dev` instead of `npm run dev`
- `bun run build` instead of `npm run build`
- `bun run lint` instead of `npm run lint`
- `bun run tsc` for TypeScript checking

---

## ADR-024: VRAM Safety Margin

**Decision**: `VRAM_SAFETY_MARGIN_MB=1024` keeps 1GB free margin on GPU.

**Reason**: Prevents OOM crashes during inference. The scheduler tracks VRAM usage and enforces mutual exclusion so only one job uses the GPU at a time.

**Consequences**:
- 1GB free margin after each job
- `AUTO_UNLOAD_AFTER_JOB=true` frees VRAM between jobs
- GPU mutual exclusion prevents concurrent inference
- `MAX_VRAM_MB=0` enables auto-detection
- Hunyuan3D-Paint-v2-1 requires ~21GB VRAM
- Hunyuan3D-Shape-v2-1 requires 10-29GB VRAM
- Hunyuan3D-DiT-v2-mini-Turbo requires ~6GB VRAM


---

## ADR-021: Canonical Hunyuan Shape→Paint Workflow

**Decision**: Treat Hunyuan3D-Shape-v2-1 as the raw-mesh stage and Hunyuan3D-Paint-v2-1 as the optional texture stage. Do not register a separate direct Shape textured model ID.

**Reason**: Shape and Paint are separate model checkpoints with independent VRAM and lifecycle requirements. The existing scheduler and Workspace already support the two-stage flow, allowing Shape to finish and expose a generated file ID before Paint is scheduled.

**Consequences**:
- `hunyuan3d_shape_v21_image_to_raw_mesh` and `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` are the current Hunyuan shape-generation IDs.
- `hunyuan3d_paint_v21_image_mesh_painting` remains independently callable.
- Workspace texture generation uses the generated job file ID plus the original image input for Shape-v2-1 or Mini Turbo → Paint handoff.
- The removed direct Shape textured ID is not exposed through the model registry or GeneratePanel.

## ADR-014: Explicit SDPA Fallback for Pre-Ampere Sparse Attention

**Decision**: When an adapter selects SDPA for a pre-Ampere GPU, bundled TRELLIS and TripoSF sparse attention execute PyTorch scaled-dot-product attention directly.

**Reason**: The adapter selected SDPA, but bundled sparse modules did not consistently implement that backend, causing runtime failures.

**Consequences**:
- Full, serialized, and windowed sparse attention have an explicit SDPA implementation where required.
- No new runtime dependency is introduced.
- FlashAttention remains the explicit path on supported GPUs.

## ADR-015: Model-Specific Dependency Overrides After the Global Baseline

**Decision**: Re-apply model-specific requirements after the global backend baseline when a model pins different compatible versions.

**Reason**: TripoSG requires diffusers 0.30.3 while the global baseline pins 0.24.0; installation order previously overwrote the model requirement.

**Consequences**:
- The global dependency baseline remains unchanged.
- TripoSG's declared compatibility is restored deterministically by the installer.

## ADR-028: TripoSR Output Axis for ForMash3D

**Decision**: Convert TripoSR's upstream output to Y-up after its existing display-orientation transform.

**Reason**: TripoSR's bundled orientation helper targets its Gradio display coordinate system, while the ForMash3D Three.js viewport uses Y-up. The supplied output dimensions showed the generated asset's Z extent exceeding Y, matching the observed side-lying presentation.

**Consequences**:
- TripoSR outputs are exported in the viewport's Y-up convention.
- No automatic orientation heuristic is added for unrelated models.

## ADR-029: Pin TRELLIS to the Mip-Splatting Rasterizer Implementation

**Decision**: Do not allow a generic local `diff_gaussian_rasterization` wheel to override TRELLIS's bundled mip-splatting renderer.

**Reason**: TRELLIS passes `kernel_size` and `subpixel_offset` to `GaussianRasterizationSettings`; the runtime supplied a renderer without those fields, causing postprocessing to fail.

**Consequences**:
- The installer prefers a valid prebuilt `diff_gaussian_rasterization` wheel from `backend/thirdparty/wheels/`.
- The installer falls back to the expected Mip-Splatting submodule source build only when no usable local wheel is available.
- The application code remains aligned with the renderer API it was written for.


## ADR-030: Deterministic Model Unload and Headless Thumbnail Rendering

**Decision**: Honor `AUTO_UNLOAD_AFTER_JOB` at the worker model lifecycle boundary and prefer EGL for pyrender thumbnails in headless Linux/Colab runtimes.

**Reason**: Colab validation showed generation succeeding before headless thumbnail creation failed, while long-lived workers could retain GPU model allocations between jobs. The shared lifecycle boundary already owns load/unload behavior, so the fix stays centralized.

**Consequences**:
- Model load, inference, and unload timing/memory are logged through `BaseModel`.
- Successful and failed jobs unload their model when `AUTO_UNLOAD_AFTER_JOB` is enabled.
- Pyrender prefers EGL when `PYOPENGL_PLATFORM` is unset, and thumbnail failure remains non-fatal to generation.


## ADR-031: Raw Geometry First, Optimization Later

**Decision**: Generation endpoints preserve model-native geometry by default. Polycount reduction, visibility cleanup, and quad retopology are post-processing operations rather than part of the raw generation stage.

**Reason**: The workspace was sending a target polycount with optimization enabled, and model adapters such as TRELLIS and TripoSG were reducing the generated mesh before downstream processing. This conflicts with the product requirement to retain as much native geometry and detail as possible before optimization.

**Consequences**:
- Workspace generation requests set `auto_optimize=false` for raw generation.
- TRELLIS skips simplification and invisible-face removal in raw mode.
- TripoSG skips target-face decimation in raw mode.
- The existing topology selector is treated as a post-processing target; raw AI outputs may remain triangles because mesh extraction is triangle-based.
- Quad conversion should remain in the existing retopology/post-processing path rather than adding another generation model.
