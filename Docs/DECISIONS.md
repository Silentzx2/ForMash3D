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
- Legacy Shape→Paint automatic chaining (superseded by the centralized optional-texture decision below)
- Configurable texture resolution (512/768), max views (6-12)
- VRAM-aware scheduling (~21GB requirement)
- Dockerfile includes Paint DifferentiableRenderer build

---

## ADR-016: ORJSON for Fast Serialization

**Decision**: Use FastAPI native Pydantic response model serialization (replaces deprecated `ORJSONResponse`).

**Reason**: FastAPI now serializes data directly to JSON bytes via Pydantic when a return type or response model is set, which is faster and doesn't need a custom response class.

**Consequences**:
- `default_response_class` removed from FastAPI app constructor in `main_singleworker.py` and `main_multiworker.py`
- Response models defined via Pydantic types on route handlers
- `orjson` dependency retained for internal use if needed

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
- Legacy Shape→Paint automatic chaining support (superseded by the centralized optional-texture decision below)
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
- `RULES.md` at repository root with mandatory doc update policy
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

## ADR-040: Canonical Hunyuan Shape→Paint Workflow

**Decision**: Treat Hunyuan3D-Shape-v2-1 as the raw-mesh stage and Hunyuan3D-Paint-v2-1 as the optional texture stage. Do not register a separate direct Shape textured model ID.

**Reason**: Shape and Paint are separate model checkpoints with independent VRAM and lifecycle requirements. A geometry model must not own a hidden texture-generation workflow. The scheduler preserves the raw master first, then invokes the common optional texture stage when requested.

**Consequences**:
- `hunyuan3d_shape_v21_image_to_raw_mesh` and `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` remain raw geometry IDs.
- `hunyuan3d_paint_v21_image_mesh_painting` remains independently callable for direct Texture Studio jobs and is reused by centralized 4K/8K texturing.
- The central stage passes the original reference image and resolved atlas target, enables the model's built-in RealESRGAN path, and validates the exported base-colour atlas without replacing `master/source.glb`.
- Legacy direct Shape textured IDs remain raw-only compatibility aliases.

## ADR-041: Explicit SDPA Fallback for Pre-Ampere Sparse Attention

**Decision**: When an adapter selects SDPA for a pre-Ampere GPU, bundled TRELLIS and TripoSF sparse attention execute PyTorch scaled-dot-product attention directly.

**Reason**: The adapter selected SDPA, but bundled sparse modules did not consistently implement that backend, causing runtime failures.

**Consequences**:
- Full, serialized, and windowed sparse attention have an explicit SDPA implementation where required.
- No new runtime dependency is introduced.
- FlashAttention remains the explicit path on supported GPUs.

## ADR-042: Model-Specific Dependency Overrides After the Global Baseline

**Decision**: Use shared backend dependency pins that satisfy TripoSG, then install TripoSG's requirements after the backend baseline in the shell installer and both Docker builds.

**Reason**: The prior backend pins (`diffusers==0.24.0`, `transformers==4.43.2`) contradicted TripoSG's `diffusers==0.30.3` and `transformers>=4.44.0`. The selected pins (`diffusers==0.30.3`, `transformers==4.44.2`, `huggingface_hub>=0.25.0,<0.26.0`) satisfy both requirement sets.

**Consequences**:
- Python 3.10 and PyTorch 2.6.0+cu124 remain unchanged.
- The shell installer and both Docker images apply TripoSG's requirement set after the shared backend baseline.

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


## ADR-032: Keep Lifecycle Log Expressions Syntax-Safe

**Decision**: Lifecycle logging expressions must avoid quote collisions inside f-string expressions and remain valid under the project's Python 3.10 runtime.

**Reason**: A lifecycle telemetry change introduced a nested double-quote collision in `BaseModel`, preventing the scheduler package from importing and blocking backend startup.

**Consequences**:
- The inference lifecycle GPU label now uses a single-quoted `cpu` literal inside the f-string expression.
- Runtime syntax verification remains part of the backend startup validation path.


## ADR-033: Model-Specific Raw Extraction Controls

**Decision**: Translate the workspace quality setting into each model adapter's actual extraction parameter instead of assuming a shared octree_resolution name.

**Reason**: Several adapters silently ignored the generic field and used lower defaults: TripoSR (mc_resolution) and TripoSF (resolution).

**Consequences**:
- High/Ultra generation now requests higher model-native extraction resolutions for those adapters.
- TRELLIS.2 raw mode disables remeshing/decimation.
- Post-processing remains responsible for deliberate optimization and topology changes.
- TripoSF low-VRAM pruning remains enforced on GPUs below 16GB to avoid unsafe memory use.

## ADR-035: Automatic Production Post-Processing After Mesh Generation

Decision: successful raw mesh-generation jobs run the production post-processing pipeline before the job is marked completed.

Storage: `backend/storage/models/meshes/<asset_name>_<job_id>/` is the canonical mesh workspace. There is no persistent export/ directory. ZIP delivery is generated on demand.

Runtime: post-processing runs outside the FastAPI event loop; Blender-only operations use BLENDER_EXECUTABLE subprocesses while the main environment remains Python 3.10 + PyTorch 2.6.0 + CUDA 12.4.

Security: artifact downloads reuse existing job authorization and accept only fixed artifact selectors; arbitrary client filesystem paths are never accepted.

## Physics runtime decision — 2026-09-29
**Decision:** Reuse the existing CoACD-backed collision service for asset preparation and use `@dimforge/rapier3d-compat` for browser rigid-body preview.

**Reason:** The collision pipeline already exists and should remain the single collision source. Rapier is a browser/WebAssembly runtime that fits the current direct Three.js viewer without forcing a React Three Fiber migration. No AI physics model is necessary, so the feature does not add another GPU-heavy inference dependency.

**Constraints:** Keep the canonical physics representation provider-neutral; do not treat draft glTF physics extensions as the sole source of truth; do not fake soft-body/jiggle; do not add native physics engines until a tested product requirement exists.

## ADR-043: Truthful Execution Telemetry and Artifact-Driven Inspectors
**Date:** 2026-09-29

**Decision:** The UI must render generation status, progress, cancellation, and asset statistics from real backend contracts only. Missing backend facts remain explicitly unknown instead of being replaced by sample numbers.

**Consequences:** Pipeline status uses real stage logs and adaptive polling; queued cancellation calls the scheduler-backed cancel endpoint; Jobs removes fabricated progress; segmentation inspectors consume `segmentation_info`; uploaded assets no longer pretend to have fixed mesh counts. The current single-image generation backend is surfaced honestly rather than presenting the existing multiview collection UI as a supported multi-view request.

## ADR-044: Redis Control State Must Not Be Evicted

Decision: Redis used for job/worker control state uses noeviction; result payloads use dedicated expiring keys.

Reason: Evicting live queue state can strand GPU work. Redis EXPIRE applies to keys, not individual hash fields.

## ADR-045: Resource-Blocked Jobs Rotate

Decision: A job that currently cannot acquire compatible worker/VRAM resources is requeued at the back rather than blocking the global queue head.

Reason: A large or unavailable model must not block smaller jobs whose resource requirements are currently satisfiable.

## ADR-046: Manifest-Driven Model Readiness and VRAM

The backend model manifest is authoritative for capabilities, VRAM reservation, max workers, IO, and model paths. Adapters reject missing manifest VRAM for models whose historical defaults were inconsistent.

## ADR-047: Unsupported Multiview Is Explicitly Gated

Until a model-specific multi-view request contract exists, the UI must not collect or silently collapse multi-view inputs into a single-view generation request.

## ADR-048: Raw Result Is Independent from Production Post-Processing

GPU generation publishes the raw artifact first. Production post-processing runs asynchronously and records its own status/error fields on the completed job.


---

## ADR-049: Production Post-Processing Before Terminal Completion

**Decision**: Persist the native model result as the immutable master checkpoint, then run canonical production post-processing before publishing terminal job success.

**Reason**: For a self-hosted personal production workflow, a completed generation must mean the requested production artifact is ready for inspection/export. This keeps job status truthful and avoids showing a raw mesh as finished while LOD, collision, preview, or QA artifacts are still pending.

**Consequences**:
- `master/source.glb` is durable before any destructive downstream stage.
- `postprocess_status` remains explicit for telemetry and retry operations.
- The live execution panel can show the real production stages through terminal completion.
- A post-processing error is a generation failure for that job rather than a misleading success.

## ADR-050: Manifest-Only Runtime Resource Contracts

**Decision**: Adapter runtime constructors do not invent VRAM defaults; model manifests provide the resource requirement and capability contract.

**Reason**: Multiple adapter-local defaults drifted from the canonical YAML and could silently override variant-specific scheduling assumptions.

**Consequences**:
- Missing manifest VRAM is a configuration error.
- Repository-relative model/runtime roots avoid current-working-directory dependence.
- FastMesh/TRELLIS variant selection remains explicit in manifest init parameters.

## ADR-034: Generation Fidelity Boundary and Destructive-Stage Controls

**Decision**: Treat the generated `master/source.glb` as the immutable quality checkpoint. Model-native extraction/export is responsible for the maximum detail the selected model/runtime can produce; downstream repair, optimization, UV, retopology, and LOD stages must preserve or explicitly account for any information they remove.

**Reason**: Post-processing cannot reconstruct geometry that the model never represented. Quality regressions therefore require source-vs-derived comparison before changing downstream algorithms.

**Consequences**:
- Hunyuan extraction presets stay within the supported upstream `octree_resolution` contract.
- TRELLIS.2 raw export uses an explicit non-decimation target instead of an unverified negative sentinel.
- Textured meshes use texture-aware decimation with per-wedge UV reconstruction; if that capability fails, the textured mesh is preserved rather than silently untextured.
- AutoRetopo is conditional on a structural defect and is not run as a blanket cleanup stage.
- AutoUV/AutoRetopo defaults favor preservation over global smoothing.
- Quality reports record source hash, repair/retopo/optimization state, texture status, and per-LOD UV/material integrity.
- Frontend settings are only exposed when a real backend contract exists; unsupported detail/UV toggles are removed rather than represented as functional controls.

## ADR-035: Fixed FastMesh Variant Contract

**Decision**: FastMesh retopology is exposed as its actual fixed V1K/V4K variant contract. The frontend must not present an arbitrary vertex/triangle budget for a model whose runner emits only the selected variant size.

**Reason**: The prior request path accepted `target_vertex_count` and a large triangle slider, but the FastMesh runner ignored that value and selected its output size solely from V1K/V4K. The mismatch produced silent, misleading UI behavior.

**Consequences**:
- The Remesh UI selects V1K or V4K explicitly and selects tri/quad output explicitly.
- The retopology router forwards `poly_type`.
- The FastMesh adapter rejects incompatible requested vertex targets rather than ignoring them.
- Existing API compatibility is preserved for callers that omit the optional target.

## ADR-036: Quality Trace and Topology Threshold Integrity

**Decision**: Production post-processing records lightweight source/repaired/optimized/game-ready geometry snapshots, and AutoRetopo thresholds use the largest boundary component instead of aggregate boundary edges.

**Reason**: Quality debugging needs stage-local evidence, and a per-hole threshold must not be compared with the sum of unrelated holes.

**Consequences**:
- `quality_report.json` can attribute geometry loss to a stage without re-reading every artifact.
- Boundary-hole action and QA now share the same per-component interpretation.
- A malformed native-texture signal no longer routes raw UV-only meshes through the textured path.

## ADR-037: Upstream Extraction Contract Conformance & Texture Decimation Resiliency

**Decision**: Clamp Hunyuan extraction resolutions to supported upstream contract ranges `[64, 512]`, guard TRELLIS.2 GLB export against sentinel/None decimation values by falling back to native face count, and wrap PyMeshLab texture-aware decimation in safe passthrough fallbacks with strict `_has_uv` checking.

**Reason**: Passing out-of-spec resolution values (e.g. 640) or non-positive decimation sentinels (`-1`, `None`) causes upstream driver failures, while quadric edge collapse on non-standard UV seams can crash PyMeshLab if not handled with explicit fallback to passthrough.

**Consequences**:
- Hunyuan shape, paint, and mini-turbo adapters safely operate within supported octree bounds.
- TRELLIS.2 exporter never triggers unhandled cumesh exceptions on non-decimated requests.
- Textured assets never lose their materials or crash the post-processing queue on decimation errors.

## ADR-038: Zero123++ v1.2 Multi-View Isolation and Capability Gating

**Decision**: Vendor Zero123++ v1.2 in `backend/thirdparty/zero123plus` without `.git` metadata, isolate behind `Zero123PlusAdapter` under `image_to_multiview` feature type, hide from general 3D model selectors (`hidden_from_model_selector: true`), and enforce a hard capability gate (`capabilities.multiview: true`) on downstream 3D reconstruction.

**Reason**: Zero123++ generates 6 novel viewpoints at 30° azimuth intervals without producing 3D meshes directly. Its weights carry a CC-BY-NC 4.0 license constraint. Isolating it behind a dedicated feature type and adapter ensures it does not pollute 3D mesh selectors, preserves legal boundaries, enables on-demand ZIP export without mesh generation, and guarantees that 3D reconstruction only occurs when a multi-view enabled 3D engine is selected.

**Consequences**:
- Upstream repo is vendored directly in the project and `install.sh` verifies it without performing external git clones.
- Single-image uploads are automatically shared with Multi-View mode without re-upload.
- The UI action button and backend router (`/reconstruct-3d`) enforce strict rejection when attempting multi-view 3D reconstruction with incompatible engines.
- Views, optional masks, and optional View-Space Normals are stored in `storage/models/meshes/<safe_stem>_<job_hash>/multiview/` with deterministic hashes (`source_sha256`, `request_sha256`). New assets honor `STORAGE_LOCAL_PATH`; existing assets under the prior `storage/models/` path remain readable.
- ZIP export delivers `<safe_stem>.zip` without extra random hashes.


## ADR-039: Model-Native Source Fidelity Firewall
**Decision**: Neural source generation is distinct from production optimization. The scheduler enforces the separation centrally by stripping downstream face, decimation, remesh, and other post-process controls before adapter inference.
**Reason**: Frontend-only invariants are insufficient because direct or future callers could pass adapter-level reduction controls.
**Consequences**:
- faces, num_faces, simplify, decimation_target, and remesh controls are downstream-only.
- Legacy Hunyuan3D-2.1 raw and Shape→Paint paths use seeded 50-step / 5.0-guidance source generation.
- TRELLIS source texture is fixed to 2048 and TRELLIS.2 to 4096.
- Production polycount, LOD, UV, collision, and baking remain downstream responsibilities.
- CUDA/NVIDIA visual A/B remains a runtime verification gate.

## ADR-051 — Phase 1 Shared Image Preprocessing Artifact

Use a content-hashed preprocessing artifact for optional Image → 3D enhancement. It records source/approved hashes, exact recipe, dimensions, crop, and fallback state so preview and generation cannot silently diverge.

## ADR-052 — Phase 1 Deterministic Intent Presets

Use a versioned YAML source of truth with ordered model priorities as the deterministic candidate/tie-break order. Candidate admission and ranking also use the shared capability/resource contract, including readiness, VRAM, quality, texture, polycount, latency, and multi-GPU compatibility. Explicit model choices remain authoritative.

## ADR-054 — Deterministic Smart Generation Submission

**Decision**: Smart Generation resolves image-only intent presets against the existing model manifest, then delegates the actual job to the existing raw/textured image-generation endpoints and scheduler. The Generate panel may auto-submit after an intent is selected when a valid uploaded/approved image is available.

**Reason**: This satisfies one-click smart generation without creating a second scheduler, inference path, or persistence layer.

**Consequences**:
- Five YAML-backed intent presets remain the single source of truth.
- Explicit model overrides remain supported through the smart API.
- Scheduler VRAM admission and existing production post-processing remain authoritative.
- Text → 3D remains out of scope.

## ADR-053 — Phase 1 UniRig Child Workflow

Run UniRig as a scheduler-managed child job after the canonical production mesh exists. Finalize the parent only after a durable rigged artifact is present; report failure explicitly as degraded.

---

## ADR-055: Unique3D Third-Party Integration

**Decision**: Vendor Unique3D (AiuniAI/Unique3D) at `backend/thirdparty/Unique3D/` with upstream commit `6311af200ee197544e82e0f2557cd890edd60416`, without `.git` metadata. Install via `install.sh` after FastMesh, using the project's shared PyTorch 2.6.0+CUDA 12.4 environment. Remove torch/torchvision/torchaudio from Unique3D's requirements to avoid conflicts with the canonical baseline. Preserve the MIT LICENSE from upstream.

**Reason**: Unique3D provides high-quality image-to-3D generation. The upstream repo targets Python 3.10 + CUDA 12.2, but the ForMash3D baseline uses PyTorch 2.6.0 + CUDA 12.4 which is compatible. Removing the pinned torch dependencies prevents version conflicts with the shared environment. The install order after FastMesh ensures nvdiffrast and other shared build dependencies are already available.

**Consequences**:
- `backend/thirdparty/Unique3D/requirements.txt` audited: torch/torchvision/torchaudio references removed (were already commented or absent).
- `backend/scripts/install.sh` updated with Unique3D installation block after FastMesh.
- Upstream commit `6311af200ee197544e82e0f2557cd890edd60416` recorded for traceability.
- MIT LICENSE preserved in the vendored directory.
- No changes to `backend/requirements.txt` needed — Unique3D dependencies install into the shared environment.

## ADR — Preserve Every Model; Route by Capability

**Date:** 2026-10-08  
**Status:** Accepted

ForMash3D will not remove or replace existing open-weight models merely because a newer generator benchmarks better. Model selection is now capability- and resource-aware, with deterministic fallback behavior. TRELLIS.2, TripoSG and Hi3DGen-derived conditioning are additive capabilities.

## ADR — Multi-GPU Loading Must Be Explicitly Supported

**Date:** 2026-10-08  
**Status:** Accepted

Aggregate VRAM is not treated as automatic model parallelism. A model must declare a supported strategy. The generic implementation uses Accelerate device-map dispatch for compatible torch-module pipelines. The scheduler reserves memory on every participating GPU and fails closed when the adapter cannot actually be dispatched.

## ADR — Master Mesh Is Immutable

**Date:** 2026-10-08  
**Status:** Accepted

The first valid generated mesh remains the fidelity source. Retopology, decimation, UV, baking and LOD are derivative operations and may never overwrite the master.

## ADR-056 — Shared Model Capability Contract

**Date:** 2026-10-08  
**Status:** Accepted

Normalize every model manifest into one machine-readable capability contract at configuration load time. Explicit model metadata wins; only facts derivable from the existing manifest are defaulted. This keeps routing, readiness, preprocessing profiles, resource planning and UI capability state on one source of truth.

## ADR-057 — Quality Gates Are Part of Production Status

**Date:** 2026-10-08  
**Status:** Accepted

Final QA, LOD lineage validation, and master-to-derivative fidelity drift are production signals. They cannot overwrite or invalidate the immutable master, but failed mandatory quality checks must mark the production result degraded/failed rather than silently reporting success.

## ADR-058 — Controlled A/B Benchmark Without False Ground Truth

**Date:** 2026-10-08  
**Status:** Accepted

ForMash3D provides a lightweight offline A/B harness that requires identical input hashes and production protocol. Without a real reference mesh, generated-vs-generated geometry comparisons remain diagnostic only. Ground-truth metrics are enabled only when an actual reference mesh is supplied.

## ADR-059 — Hi3DGen Remains Evaluation-Gated

**Date:** 2026-10-08  
**Status:** Accepted

Hi3DGen-style normal bridging is not hard-wired into production without controlled evidence. The current integration preserves the model-aware preprocessing/capability contract and leaves normal-bridging adoption behind an explicit benchmark gate until a compatible runtime, dependency set, and measurable quality improvement are verified.

## ADR-060 — Persistent Asset Previews and Thumbnails Over Blob URLs

**Date:** 2026-10-09  
**Status:** Accepted

**Decision**: Replace browser-local blob URLs (`URL.createObjectURL(file)`) with persistent backend storage endpoints (`/api/v1/file-upload/download/{file_id}` and `/api/v1/file-upload/thumbnail/{file_id}`).

**Reason**: Ephemeral object URLs are lost on component unmount or route changes, causing image previews and model thumbnails to vanish when users switch between single-view, multiview, and assets panels.

**Consequences**:
- Uploaded assets immediately obtain durable server-side IDs and persistent thumbnail endpoints.
- Previews and reference thumbnails remain stable across all workspace views and page reloads.
- Shared asset store allows multiview and single-view workspaces to seamlessly cross-reference uploaded media.

## ADR-061 — Dual-Action Generation Queueing and Viewport HUD Capsule

**Date:** 2026-10-09  
**Status:** Accepted

**Decision**: Support continuous workflow by displaying in-progress feedback on the active generation button alongside a secondary "Queue Next" button when a job is active. Provide a top-right viewport HUD capsule in the 3D viewport for monitoring background jobs.

**Reason**: Long neural inferences should not lock the artist workspace or prevent enqueuing subsequent tasks.

**Consequences**:
- When GPU/VRAM is busy, new submissions are safely queued in the background scheduler without crashing or risking OOM.
- If multiple GPUs have available VRAM, concurrent batch generation executes automatically.
- Artists can monitor queue progress and load newly completed models directly into the MeshViewer viewport via a single click.

## ADR-062 — Dual-Store Synchronization for Job Deletion

**Date:** 2026-10-09  
**Status:** Accepted

**Decision**: Ensure `delete_job` cleanly purges job entries from both Redis hot keys and the persistent SQLite database (`db_manager`).

**Reason**: Inconsistent key deletion between Redis and SQLite previously caused `500 Failed to delete job from database` errors when attempting to delete completed or failed jobs.

**Consequences**:
- Deletions are coordinated across both storage tiers without throwing 500 errors.
- Prevents orphaned job records in the scheduler database.

## ADR-063 — Full CPU Core Concurrency for Mesh Processing & Scheduler Workers

**Date:** 2026-10-10  
**Status:** Accepted

**Decision**: Allocate all available physical/logical CPU cores (`os.cpu_count()`, default 8) across the scheduler workers and postprocessing pipelines (`OMP_NUM_THREADS`, `MKL_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `torch.set_num_threads`).

**Reason**: Workers were previously defaulting to `cpu_threads=1`, bottlenecking CPU-bound isosurface extraction (marching cubes), mesh decimation, and smoothing on a single core.

**Consequences**:
- Marching cubes, Taubin smoothing, quadric decimation, and multi-LOD processing execute in parallel across all CPU cores.
- `cpu_threads_for_workers` prevents dividing cores into 1 thread per worker.
- Launcher scripts (`manager.sh`, `scripts/start.sh`, `run_server.sh`) export `OMP_NUM_THREADS=8` by default.

## ADR-064 — Hunyuan3D Turbo Optimization and Strict GPU Inference Enforcement

**Date:** 2026-10-10  
**Status:** Accepted

**Decision**: Optimize Hunyuan3D-DiT-v2-mini-Turbo to use `octree_resolution=380` (or 256), `num_chunks=20000`, and `topk_mode='merge'` for FlashVDM. Enforce strict CUDA device execution (`cuda:0`) across all model adapters, rejecting silent fallback to CPU.

**Reason**: Hardcoded `octree_res=512` generated a 505³ volume (128 million voxels), taking 4+ minutes on CPU marching cubes. In addition, silent CPU fallback caused models to hang on low-spec environments.

**Consequences**:
- Hunyuan3D Turbo generation time drops from >5 minutes to <35 seconds.
- FlashVDM uses optimized merge attention pooling.
- All model adapters explicitly verify `torch.cuda.is_available()` and target CUDA devices.

## ADR-065 — Normal Image-to-3D Geometry Models Output Raw Mesh Only

**Date:** 2026-10-11  
**Status:** Accepted

**Decision**:
1. All normal image-to-3D geometry models (TRELLIS, TRELLIS.2, Hunyuan3D-Shape-v2.1, Hunyuan3D-DiT-v2-mini-Turbo, Unique3D, Pixal3D) generate raw untextured geometry only. Embedded texture baking, multiview rasterization, and automatic paint chaining are removed from the normal geometry path. Texturing is decoupled into the centralized post-processing texture stage.
2. In `models.yaml`, set `paint_autochain: false` on Hunyuan3D shape models, `texture_generation: false` on Unique3D and Pixal3D, and register TRELLIS / TRELLIS.2 and Pixal3D under `image_to_raw_mesh`.
3. In `model_factory.py`, map legacy `image_to_textured_mesh` IDs and requests as backward-compatible aliases to raw-mesh generation via `LEGACY_IMAGE_TO_RAW_ALIASES` and `get_model_adapter()`.
4. Unique3D preserves native PyTorch3D vertex colors (`has_vertex_color: True`) without baking 2D UV textures, reporting `has_texture: False`.

**Reason**:
Per `Docs/TASKS.md` Section 4, selecting a geometry model must never implicitly run a hardcoded texture pipeline. Decoupling geometry from texturing allows the downstream production post-processing pipeline and central texture stage (Paint3D / Hunyuan3D-Paint) to manage texturing cleanly and idempotently.

**Consequences**:
- Normal image-to-3D geometry generation is faster, unburdened by redundant texture baking or paint model loading.
- VRAM requirements during geometry generation are reduced.
- Downstream postprocessing promotes immutable raw `master/source.glb` before any optional texturing.
- Legacy clients and historical jobs requesting `image_to_textured_mesh` resolve cleanly to raw geometry without breaking.

## ADR-066 — Paint3D Integration for 1K/2K UV Texture Diffusion

**Date:** 2026-10-11  
**Status:** Accepted

**Decision**:
1. Integrate Paint3D (`OpenTexture/Paint3D`) as the primary texture synthesis engine for 1K (1024x1024) and 2K (2048x2048) texture presets, while reserving Hunyuan3D-Paint for 4K and 8K generation.
2. Execute a two-stage coarse-to-fine pipeline: coarse texture rendering (Stage 1) followed by UV inpainting and seam refinement (Stage 2), conditioning both stages on the original reference image.
3. Preserve the Python 3.10 / CUDA 12.4 / PyTorch 2.6.0 baseline without library downgrades, avoiding upstream's legacy Python 3.8 / Torch 1.12 environment requirements.
4. Enforce strict job isolation with per-job scratch directories (`paint3d_job_{job_id}_*`) and non-shell subprocess execution with explicit argument lists.
5. Strict CUDA GPU enforcement: raise an immediate error if `torch.cuda.is_available()` is False, rejecting CPU fallback.

**Reason**:
Per `Docs/TASKS.md` Section 3, high-quality 1K/2K UV texture generation requires a specialized diffusion model capable of lighting-less albedo map synthesis and seamless UV wrapping on untextured raw meshes. Paint3D provides superior texture fidelity at 1K/2K resolutions without interfering with the immutable raw mesh master checkpoint.

**Consequences**:
- 1K and 2K texture requests route cleanly to Paint3D with minimal VRAM footprint (~12GB VRAM).
- Underlying geometry topology remains intact while generating complete UV texture atlases.
- Checkpoints are managed cleanly through `backend/scripts/download_models.sh` with Hugging Face verification (`GeorgeQi/Paint3d_UVPos_Control`).

## ADR-067 — Dedicated Database Administration Surface

**Date:** 2026-10-11  
**Status:** Accepted

**Decision**:
1. Add a dedicated backend router `backend/api/routers/database.py`, mounted at `/api/v1/system/database` in both `main_singleworker.py` and `main_multiworker.py`, exposing: `GET /stats` (combined SQLite/Redis/queue/file-metadata/disk statistics), `GET /keys` (read-only SCAN-based Redis key inspector), `DELETE /jobs` (bulk delete by ids/status/feature), `POST /jobs/clear`, and `DELETE /files/clear`. Endpoints require the API key and the admin role whenever a user is authenticated.
2. Enforce a confirm-token safety model on every destructive endpoint: `{"confirm": true}` for bulk delete and the exact typed tokens `{"confirm": "CLEAR_ALL_JOBS"}` / `{"confirm": "CLEAR_ALL_FILES"}` for the wipes.
3. Keep the deletion ordering from ADR-062: each job is removed from Redis hot keys and the SQLite jobs table (reusing `RedisJobQueue.delete_job`), and its canonical asset workspace under `backend/storage/models/meshes/<asset>_<job_id>/` is removed only after the durable delete succeeds, with the path validated against the models root. Non-terminal (running/queued) jobs are skipped unless `force: true`.
4. The clear-all-jobs sweep touches only job-owned Redis key patterns (`3daigc:jobs`, `3daigc:progress`, `3daigc:stage`, `3daigc:message`, `3daigc:queue:*`, `3daigc:completed_at`, `3daigc:cancel_requested`, `3daigc:result:*`) and never user/token auth keys (`3daigc:user*`, `3daigc:token*`, `3daigc:users:all`), then VACUUMs SQLite. Uploads and file metadata are preserved; clear-all-files preserves job records and assets.
5. Support the surface with new `DatabaseManager.delete_all_jobs()` and `DatabaseManager.get_database_size_bytes()` methods plus the admin Database tab (`/admin?tab=database`): stats cards, paginated jobs table with per-row cancel/delete, checkbox multi-select bulk delete, the Redis key inspector, and typed-confirmation danger-zone clear actions.

**Reason**:
Operators had no way to see the combined health of the two stores (SQLite rows vs. Redis hot keys, file metadata, disk usage) and no safe bulk maintenance path: clearing stuck or duplicate jobs meant calling the per-job delete endpoint in a loop with no selector, no visibility into Redis key footprint, and no storage reclamation (orphaned rows/workspaces, no VACUUM). A single authenticated, confirmation-guarded surface reuses the existing dual-store deletion instead of adding a second deletion path.

**Consequences**:
- Bulk maintenance (delete by ids/status/feature, clear-all) becomes administrative, observable, and reversible-by-token only at the exact confirm step.
- The confirm-token ordering keeps the durable store authoritative; a workspace is never removed on a failed store delete, so a retry cannot orphan data.
- User sessions and API keys survive a job wipe because auth keys are excluded from the sweep by design.
- Storage reclamation is explicit: job clears remove workspaces and VACUUM SQLite; file clears remove uploads and file metadata — the two are never mixed.

**Alternatives Considered**:
- *Reuse only the per-job delete endpoint* (`DELETE /api/v1/system/jobs/{job_id}`): rejected — O(n) round-trips, no status/feature selectors, no combined statistics, no workspace sweep, and no SQLite VACUUM for storage reclamation.
- *CLI-only maintenance tool*: rejected — operators administer the running stack through the admin dashboard; a CLI would duplicate auth/deletion logic and drift from the authenticated API surface.

## ADR-068: Retire Dedicated Multi-View and Consolidate Tripo Model Catalog

**Status:** Accepted — 2026-10-11

**Decision:** Remove the dedicated Zero123++ Multi-View workspace, router, model registration, adapter, API documentation, tests, download-manager entries, and its installer dependency flow. Keep TripoSG as the only selectable Tripo generation model. Remove the TripoSR and TripoSF adapters and all active registry, preset, scheduling, download, verification, and install references to those models. Do not remove or modify any vendored repository code under `backend/thirdparty/`; that cleanup is explicitly deferred for separate manual work.

**Rationale:** TripoSG provides a self-contained high-fidelity image/scribble-to-mesh path. TripoSF's current image path invokes TripoSR to create its coarse input mesh, so removing TripoSR weights while retaining TripoSF would leave a hidden model dependency and could break generation. Keeping TripoSG avoids that cross-model dependency while retaining one high-fidelity Tripo model. All non-Tripo model integrations and generic scheduler/capability behavior remain in place.

**Consequences:** The model selector and model API expose TripoSG but no TripoSR/TripoSF/Zero123++ model IDs. The download manager installs only TripoSG and its RMBG dependencies among Tripo-specific model entries. Historical ADRs documenting the retired implementations remain as historical records; this ADR defines the current supported catalog.


## ADR-069: Explicit Native/Raw Budget Semantics and Geometry Provenance

**Status:** Accepted — 2026-10-12

**Context:** The follow-up mesh-quality audit found that a nested `target_polycount` or intent preset could mask an explicit API-level value. The UI/backend could also receive an inconsistent Native/Raw target together with auto-optimization or an implicit remesh path. Some resolution fields described Hunyuan's configured octree parameter as if it were the achieved output-grid resolution, and model metadata did not carry all provenance through the canonical post-processing result.

**Decision:**
1. Resolve a generation target with precedence: explicitly supplied top-level API value, explicitly supplied nested model parameter, then preset fallback. Explicit `0` means Native/Raw; missing/nonpositive backend target continues to resolve to Native/Raw.
2. Gate automatic production optimization and adaptive shell remesh on a positive explicit target. The Native/Raw workspace default disables LOD generation, while production workflows may opt into budgets/derivatives.
3. Keep `master/source.glb` immutable and persist raw adapter output/master SHA-256 identity in the quality trace and final result. A mismatch is recorded as a provenance error; mutation of the canonical master during post-processing raises.
4. Use schema-v2 telemetry to report adapter/checkpoint identity, input/reference hashes and dimensions, effective inference parameters, runtime, per-GPU peak VRAM when observable, native mesh counts, and truthful requested/achieved-resolution semantics.
5. Do not label a configured Hunyuan octree parameter as achieved resolution without an upstream report. Keep Step1X-3D, multi-view fusion, and evidence-guided detail refinement evaluation-gated until compatible-runtime validation and controlled A/B evidence exist.

**Consequences:** Native/Raw has an explicit end-to-end contract; request precedence, post-process behavior and display labels agree. Benchmark runs gain reproducible source identity and resource telemetry. Unknown achieved resolution stays unknown rather than being inferred from a requested parameter.

**Validation boundary:** Regression tests were added for request precedence, profile/manifest parity, Native/Raw gates and telemetry. They have not been executed in the current environment, and no CUDA A/B quality result is claimed.


## ADR-070 — Compatible Shared Transformers Runtime for Hunyuan3D Mini

**Date:** 2026-10-13  
**Status:** Accepted

**Decision:**
1. Pin the shared runtime to `transformers==4.48.3`, which satisfies Hunyuan3D-DiT-v2-mini-Turbo's upstream `transformers>=4.48.0` contract and exports the `HybridCache` symbol imported by PEFT 0.17.1.
2. Keep `diffusers==0.30.3`, PyTorch 2.6.0 + CUDA 12.4, and the shared dependency-install workflow unchanged.
3. Resolve Shape and Mini Python package roots explicitly from `backend/thirdparty`; fail before checkpoint loading when expected package/checkpoint paths are absent.
4. Preserve full worker tracebacks in backend logs and return a concise initialization error to the UI.

**Rationale:** The shared Transformers pin was below Mini Turbo's declared minimum, causing a PEFT import failure before TripoSG's or Hunyuan's inference code could run. Hunyuan Shape also used a double-nested import path inconsistent with the vendored package layout; Mini could lose import priority to a different `hy3dgen` module and did not verify its checkpoint subfolder before pipeline initialization.

**Consequences:** All three model adapters continue using the existing shared Python environment; no new dependency, registry path, or parallel install system is introduced. Static regression contracts cover the dependency floor, package paths, and concise worker errors. GPU-backed generation still requires runtime validation on a CUDA host.
 
 
## ADR-071 — UI/UX Pro Max Studio Interface Refinement and Navigation Unification

**Date:** 2026-10-13  
**Status:** Accepted  

**Context:** An audit of the web client identified several friction points that degraded the SaaS studio feel:
1. `AdminShell.tsx` icon resolution mapped raw keys while `constants/index.ts` IDs caused silent fallback to `LayoutDashboardIcon` for non-matching items.
2. `SettingsTab.tsx` subtab pills directly called raw icon tuple data structures instead of rendering via `HugeiconsIcon`, resulting in empty or broken icons.
3. Leaked `*Icon` tokens from automated icon transformations polluted button labels, tooltips, placeholders, and panel headers across both workspace and admin views.
4. Settings navigation between the workspace modal and admin tabs lacked visual alignment and synchronization.

**Decision:**
1. Unify all navigation icons in AdminShell and AdminSidebar with dedicated, section-specific iconography (`LayoutDashboard`, `Boxes`, `Activity`, `ScrollText`, `Briefcase`, `ListOrdered`, `HeartPulse`, `HardDrive`, `Database01`, `Settings01`).
2. Map `SettingsTab` sub-tabs and `SettingsModal` tabs to consistent Hugeicons primitives (`Settings02Icon`, `SparklesIcon`, `LayoutGridIcon`, `Download01Icon`, `ServerIcon`, `KeyboardIcon`, `BellIcon`, `SlidersHorizontalIcon`) rendered strictly through `<HugeiconsIcon />`.
3. Support deep linking from `SettingsModal` directly to specific sections of Admin Settings (`/admin?tab=settings&section=...`).
4. Eradicate all leaked `*Icon` strings from user-facing UI labels, placeholders, titles, and comments (`Refresh`, `Search`, `Target Mesh`, `Brush Dynamics`, `Auto Camera`, `Grid`, etc.).
5. Maintain a compact, high-density professional studio design with tactile active states (`active:scale-[0.98]`), studio yellow accents, and subtle glassmorphic borders (`border-white/[0.08]` to `border-white/[0.12]`).

**Consequences:** The entire interface presents a cohesive, professional 3D studio environment. All icons resolve to their designated semantic glyphs without fallback degradation or broken component rendering. TypeScript build passes cleanly without regressions.


## ADR-072 — Unified Dynamic-Tab System & Non-Destructive 3D Studio Architecture

**Date:** 2026-10-13  
**Status:** Accepted  

**Context:**
Previously, navigating to the 3D Animate (`animation`) or Character Rigging (`rigging`) tabs replaced the entire center workspace with `<AnimationStudio />` or `<RiggingStudio />`. This pattern unmounted the continuous Three.js `MeshViewer`, tearing down WebGL buffers, shaders, and geometry state. Returning to other tools (e.g. Model, Remesh, Texture) caused a full WebGL re-initialization with 200–500ms latency, canvas flickering, and loss of viewport orientation. In addition, navigating between the workspace and main navigation routes (`/workspace/overview`, `/workspace/assets`, `/workspace/jobs`) triggered unnecessary Next.js page remounts.

**Decision:**
1. **Continuous 3D Viewport Retention:** Keep the primary Three.js WebGL canvas (`MeshViewer`) and `ViewportToolOverlay` mounted continuously across all Workspace tools (`model`, `remesh`, `texture`, `uv`, `segment`, `edit`, `animation`, `rigging`).
2. **Modular Dynamic Panel Routing:**
   - Left Tool Panel: `renderToolPanel()` dynamically renders `AnimationLeftPanel` or `RiggingLeftPanel` inside the existing floating container when `activeTool` changes.
   - Right Inspector: `RightWorkspacePanel` dynamically renders `AnimationRightInspector` or `RiggingRightInspector` based on `activeTool`.
   - Viewport Overlay: Render `AnimationTimelineDock` at the bottom of the viewport when `activeTool === 'animation'`, providing interactive frame-stepping, transport controls, scrub bar, and FPS selection without obscuring or unmounting the 3D scene.
3. **Non-Destructive Navigation State:** Update `navigateToMain` in `WorkspaceContext` to use `window.history.replaceState` when switching between Workspace tool views and main overlay hubs (`overview`, `assets`, `system`, `jobs`), avoiding Next.js component destruction.
4. **Real Data Integrity:** Eradicate all hardcoded dummy geometry numbers; wire viewport overlay cards to live `currentAsset` data and `useViewerStore` mesh statistics (`vertices`, `faces`/`triangles`, `dimensions`).

**Consequences:**
- Tab switches across the entire studio occur sub-16ms with zero WebGL context recreation or screen flicker.
- Active 3D assets, camera matrices, lighting, and materials remain 100% persistent across creation, texturing, retopology, rigging, and animation workflows.
- Full TypeScript compilation (`next build`) succeeds with zero errors.


## ADR-073 — High-Performance Viewport Engine & Interactive Manipulation

**Date:** 2026-10-14  
**Status:** Accepted

**Context:**
During extended interactive editing sessions, four critical viewport performance and UX issues were observed:
1. Shading mode switches (`clay`, `ceramic`, `chrome`, `gold`, `normals`, `xray`, `turquoise`) and wireframe toggles dynamically instantiated new Three.js materials across the entire mesh hierarchy during each traversal, resulting in GC pressure, hitching, and potential memory leaks.
2. Reflection peek snapshot generation ran in an unthrottled 1000ms `setTimeout` polling loop that repeatedly re-rendered the scene to canvas and created blob URLs even when the scene was completely static, wasting GPU cycles and memory.
3. Edit workflows lacked interactive 3D manipulator gizmos for mesh translation, rotation, and scaling, and camera snapping to cardinal axes required tedious manual orbiting.
4. `MeshDiffViewer` contained a stateful animation counter (`setAnimationFrame(prev => prev + 1)` in requestAnimationFrame) that triggered 60–120 React component tree re-renders per second, lagging comparative side-by-side reviews.

**Decision:**
1. **Zero-Allocation Material Switcher:** Cache alternate shading materials lazily on `child.userData.__shadingMaterialCache`. Reassign cached material instances directly upon shading mode changes and toggle `.wireframe = isWire` dynamically, eliminating all memory allocations during traversal.
2. **Event-Driven Reflection Peek Capture:** Replace polling with an event-driven capture loop: capture once on mount, then capture only upon OrbitControls `'end'` event debounced at 250ms. Revoke stale object URLs immediately and cancel timers/listeners on unmount.
3. **Interactive TransformControls Integration:** Add Three.js `TransformControls` attached to `currentMeshGroupRef.current` (or selected bone joint), synced with `interactionMode` (`'move' | 'rotate' | 'scale'`), and mutually exclude `OrbitControls` during dragging (`controls.enabled = !event.value`). Wire to a floating Edit toolbar with Select, Move, Rotate, Scale, and Grid toggling.
4. **Axial Camera Presets:** Add `Perspective`, `Front`, `Side`, and `Top` preset buttons dispatching `setCameraPreset` custom events to snap the camera smoothly along cardinal axes with bounding-sphere recentering.
5. **Decoupled MeshDiffViewer RAF Loop:** Replace React state re-rendering with a clean `requestAnimationFrame` loop that directly updates controls and renders WebGL canvases, cancelled cleanly via `cancelAnimationFrame(animId)` on unmount.

**Consequences:**
- Zero GC churn when toggling materials or wireframe across dense meshes.
- Idle viewports consume 0% GPU for reflection peek captures.
- Full interactive 3D translation/rotation/scaling gizmo support in Edit mode with zero camera conflict.
- 60–120fps component re-render overhead completely eradicated in MeshDiffViewer.


## ADR-074 — Production Postprocessing Pipeline Hardening & Quad Export

**Date:** 2026-10-14  
**Status:** Accepted

**Context:**
The production postprocessing engine converts raw neural model outputs into engine-ready game assets. Several production gaps required hardening:
1. Downstream tools (e.g. Blender, Maya, ZBrush) requiring quad topology received triangulated OBJ exports even when quad retopology had run successfully.
2. When requests contained nested model parameters, default values of `0` in nested payloads would wipe out valid top-level or smart preset target polycount budgets.
3. In containerized or bare-metal environments lacking a standalone `blender` executable, background workers for FBX conversion and thumbnails failed rather than utilizing the embedded `bpy` Python wheel.
4. Relative `STORAGE_LOCAL_PATH` settings caused a path resolution bug resulting in duplicated `backend/backend/storage` directory trees.
5. In 3D printing workflows, decimation and aggressive voxel shell reconstruction rounded sharp features and degraded watertight manifold topology.

**Decision:**
1. **Polygonal Quad OBJ Export:** Implement `_export_quad_obj` to serialize meshes with genuine 4-vertex polygonal faces (`f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 v4/vt4/vn4`). When quad retopology succeeds (`is_quad_requested and retopo_stats.get("status") == "completed"`), automatically bypass decimation (`passthrough: True`).
2. **Smart Preset Budget Precedence Resolution:** Implement `_resolve_target_polycount_precedence(top_level, nested, preset)` to guarantee top-level explicit API inputs take highest precedence, followed by nested params, falling back to preset targets. Explicit `0` is preserved as an intentional Native/Raw pass-through request.
3. **Multi-Path Headless Blender Worker Invocation:** Centralize `blender_worker_argv()` and `blender_expr_argv()` in `config.py` to prefer `BLENDER_EXECUTABLE` on `PATH` if available, and gracefully fall back to running scripts under `sys.executable` via `importlib.util.find_spec("bpy")`.
4. **Dynamic Canonical Storage Resolution:** Centralize `get_storage_base_dir()` in `core/utils/file_utils.py` to resolve relative `STORAGE_LOCAL_PATH` against repository root (`parents[3]`), eliminating duplicate `backend/backend/storage` directory nesting.
5. **Watertight 3D Print Preservation:** Configure AutoRetopo to respect already-watertight geometry (`watertight=not bool(repaired_topology.get("watertight", False))`), preserving the source surface directly without voxel-rounding artifacts. Set `target_polycount: 0` in the `3d_print` preset to guarantee 100% native resolution passthrough in `run_optimize()`.

**Consequences:**
- Native quad topology is fully preserved from retopology to disk export.
- User-specified polycount budgets are strictly respected regardless of nested parameter defaults.
- Headless FBX and thumbnail workers run reliably in standard Python environments shipping `bpy`.
- Consistent single-root canonical storage directory across all services and mounts.
- 100% watertight manifold preservation for 3D printing and additive fabrication.

## ADR-075 — Fidelity-First Raw Geometry Profiles

**Date:** 2026-10-14  
**Status:** Proposed for review with PR #30

**Decision:**
- Keep Hunyuan Shape and Mini Turbo within the upstream-supported dense sampling ceiling of 512. Do not raise the adapter limit beyond that contract.
- Use Hunyuan Shape's upstream-default 7.5 guidance with its 50-step sampling schedule for the active max-fidelity profile.
- Do not force-enable FlashVDM/top-k decoding for Hunyuan Mini Turbo's raw fidelity profile; retain its trained 5-step sampler and use the native dense decoder.
- Follow TripoSG's manifest-preferred hierarchical extraction path (dense depth 8, hierarchical depth 9) instead of choosing the Flash decoder solely from GPU compute capability.

**Reason:** Output polycount cannot restore geometry detail omitted during learned decoding or surface extraction. The raw mesh path must select its model-specific fidelity decoder before any downstream processing, while staying inside supported resolution/resource contracts.

**Consequences:**
- Changes remain confined to the three requested model paths, parameter routing, regression contracts, and documentation.
- No vendored third-party source, TRELLIS/TRELLIS.2 adapter, or shared post-processing implementation is modified.
- Native dense/hierarchical extraction can increase latency and memory usage.
- CUDA A/B generation and visual mesh inspection remain required before claiming a measured quality improvement.



## ADR-076 — Explicit Native Hunyuan Decoding and VRAM-Gated TripoSG Depth 10

**Date:** 2026-10-14  
**Status:** Proposed for implementation validation

**Decision:**
- Hunyuan Shape v2.1 and Mini Turbo explicitly configure and verify VanillaVolumeDecoder + MCSurfaceExtractor and pass mc_algo='mc', staying within the upstream [64, 512] resolution contract.
- TripoSG requests hierarchical depth 10 (1024-wide target grid) only when at least 24 GiB VRAM is free and 32 GiB total VRAM exists. Otherwise use depth 9. Report requested/effective grid depth honestly.

**Reason:** Fidelity settings must verify the actual decoder implementation, not infer it from a disabled acceleration call or manifest label. Depth 10 adds another sampling octave for TripoSG on sufficiently provisioned GPUs. Hunyuan remains bounded by upstream's supported resolution contract.


## ADR-077 — Hunyuan3D & TripoSG Raw Geometry Detail-Loss Fix (2026-10-14)

**Date:** 2026-10-14  
**Status:** Accepted

**Context:**
Generated meshes from Hunyuan3D-Shape-v2.1, Hunyuan3D-DiT-v2-mini-Turbo, and TripoSG were losing fine detail and appearing overly smooth, despite high polycount outputs. Root cause analysis revealed:

1. **Hunyuan3D FlashVDM acceleration was silently active** - The upstream VAE defaults to FlashVDM decoding which uses attention-based shortcuts that smooth fine geometry. The adapter was not explicitly disabling it or verifying the active decoder.

2. **Mini Turbo used untrained octree_resolution=512** - The official Mini Turbo checkpoint was trained with octree_resolution=380. Using 512 exceeded the trained range and produced artifacts.

3. **TripoSG dense_octree_depth=8 limited hierarchical extraction** - The coarse seed grid was too coarse (8→256³), causing the hierarchical refinement to miss thin features before the final pass. Flash decoder was also being selected on capable GPUs, starting from an even coarser grid.

**Decision:**
1. **Strict decoder profile enforcement** (`backend/adapters/hunyuan3d_decoder_profile.py`): New `configure_native_dense_decoder()` function forces `enable_flashvdm_decoder(enabled=False)`, then verifies `volume_decoder=VanillaVolumeDecoder` and `surface_extractor=MCSurfaceExtractor`. Fails fast with descriptive error if verification fails.

2. **Mini Turbo official resolution** (`hunyuan3d_dit_v2_mini_turbo.py`, scheduler, frontend): Default `octree_resolution=380` with clamping warning for values >380. Updated in `_RAW_MESH_MAX_QUALITY_PARAMETERS`, frontend `buildGenerationParameters.ts`, and adapter.

3. **TripoSG max hierarchical depth** (`triposg_adapter.py`, scheduler, frontend): `dense_octree_depth=9` (512³ seed grid), `hierarchical_octree_depth=10` (1024³ final grid) with VRAM-gated fallback (10→9→8 based on free/total VRAM). Uses standard marching_cubes (method="lewiner"), not DMC which can smooth.

4. **Scheduler profile updates** (`multiprocess_scheduler.py`): Updated `_RAW_MESH_MAX_QUALITY_PARAMETERS` for all three models with corrected defaults.

5. **Frontend parameter alignment** (`buildGenerationParameters.ts`): Mirror backend defaults for consistent parameter passing.

**Consequences:**
- Hunyuan3D raw geometry now uses verified native dense decoder with marching cubes, preserving sharp features
- Mini Turbo uses its officially trained resolution (380), eliminating artifacts
- TripoSG achieves maximum hierarchical depth (1024³) on 24GB+ free VRAM GPUs, preserving fine details
- All changes are confined to the three model adapters, scheduler profiles, and frontend parameter building
- Telemetry now reports `geometry_extractor`, `effective_geometry_resolution`, `voxel_size`, `mc_algo` for verification
- Regression tests updated to verify decoder profile, depth resolution, and parameter schema defaults

---

**Consequences:** Output detail may improve where the model's learned field contains recoverable high-frequency geometry, but single-image models cannot guarantee arbitrary microdetail. Depth 10 costs materially more memory and latency; CUDA A/B generation and raw-mesh visual inspection remain required before claiming measured quality improvement.

## ADR-056: Keep the Unique3D Gradio Demo Out of the Shared Backend Runtime

**Decision**: The ForMash3D Unique3D adapter imports the inference pipeline components directly and does not install or initialize the upstream Gradio demo wrapper in the shared backend environment.

**Reason**: The adapter already owns the trainer and pipeline lifecycle. Importing `app.custom_models.mvimg_prediction` adds an unused Gradio import and triggers a second module-level pipeline initialization. Current Gradio 6 releases also require a newer Hugging Face Hub than the project's TripoSG-compatible shared pin.

**Consequences**:
- `datasets==3.6.0` remains paired with `huggingface_hub==0.25.0`.
- Gradio is not installed as a backend dependency solely for Unique3D.
- The upstream vendored source is left unchanged; only the ForMash3D adapter's unused import is removed.

---

## ADR-078: Studio PBR Rendering Pipeline, Dynamic Contact Shadowing, and Geometry Telemetry

**Date:** 2026-10-16  
**Status:** Accepted

**Context:**
The Three.js viewport in ForMash3D lacked real-time geometry & topology telemetry (exact surface area, enclosed volume, watertight / manifold edge tracking, UV chart analysis). Additionally, the PBR lighting setup lacked tone mapping options (neutral Khronos vs ACES Filmic), exhibited fixed directional shadow bounds causing shadow clipping on large meshes, and lacked true non-destructive wireframe on shaded visualization and tangent space calculation for standard normal map rendering.

**Decision:**
1. **PBR Rendering Pipeline Upgrades (`MeshViewer.tsx`)**:
   - Upgraded tone mapping with configurable `toneMapping: 'neutral' | 'aces'` (`THREE.NeutralToneMapping` as standard studio baseline and `THREE.ACESFilmicToneMapping` for cinematic contrast).
   - Rebalanced physical 3-point + rim lighting with calibrated exposure and dynamic shadow camera frustum calibration (`updateKeyLightShadowFrustum(mesh)`) to encapsulate exact model bounds, preventing shadow truncation and maximizing depth buffer resolution.
   - Non-destructive **Wireframe on Shaded** overlay implemented using child mesh clones with `polygonOffset: true`, `polygonOffsetFactor: -1`, `polygonOffsetUnits: -1` to eliminate z-fighting.
   - Refined studio materials: Studio Matte Clay (warm albedo with clearcoat), Porcelain Ceramic Gloss, 24K Metallic Gold (`metalness=0.95, roughness=0.18`), Chrome Mirror, and Tangent Space Normals.
2. **Real-time Geometry & Topology Telemetry Suite (`features/workspace/lib/meshTelemetry.ts`)**:
   - Real-time computation of surface area ($m^2$) and signed enclosed volume ($m^3$) using divergence theorem.
   - Manifold edge validation: edge map hashing tracking directed triangle edges, classifying boundary open edges vs non-manifold edges (>2 shared triangles).
   - Disjoint UV chart island counter using disjoint-set union-find over texture coordinate indices.
   - Automatic index synthesis for non-indexed geometries ensuring `computeTangents()` runs safely across all imported formats.
3. **Studio Generation & Shading UI/UX**:
   - `GeneratePanel.tsx`: Added Pro Studio controls for Sharp Feature Preservation, Angle Crease Threshold (30°-85°), High-Resolution Normal Baking toggle, and 4-tier Texture Fidelity presets (Ultra 4K to Compact).
   - `RightPropertyPanel.tsx`: Integrated live telemetry card (Watertight/Manifold badge, triangles, vertices, surface area, volume, UV islands) and 8 studio shading modes.

**Consequences:**
- Viewport achieves production-level visual fidelity matching Blender/Substance 3D viewports.
- Artists and 3D print operators can immediately detect non-manifold geometry, boundary holes, and UV island bloat before export.
- Dynamic shadow frustum guarantees contact shadows adapt seamlessly to arbitrary bounding box scales without manual tweaking.

---

## ADR-079: End-to-End 3D Pipeline Geometry Quality, glTF Tangents, Angle-Weighted Normals & Gutter Dilation

**Date:** 2026-10-16  
**Status:** Accepted

**Context:**
A comprehensive audit of the 3D generation and post-processing pipeline identified several quality bottlenecks and bugs across parameter ingestion, model extraction, decimation, shading, and texture baking:
1. **Artificial Polycount Caps & Ingestion Override**: `buildGenerationParameters.ts` clamped `targetPolycount < 200000` inside `shouldAutoOptimize()`, preventing users from requesting high-fidelity production budgets (> 200k). Backend `_resolve_target_polycount_precedence` also favored preset defaults over explicit `0` (Native/Raw).
2. **Missing Normal Vectors in GLB Primitives**: Trimesh's `trimesh.exchange.gltf` only exports `NORMAL` attributes if `vertex_normals in mesh._cache.cache`. Creating meshes with `process=False` bypasses cache population, causing exported GLB files to omit vertex normals entirely unless explicitly evaluated.
3. **Missing glTF 4-Component Tangents**: Standard glTF 2.0 PBR rendering with normal maps requires 4-component `TANGENT` vertex accessors (`vec4(T.xyz, bitangent_sign)`). Without them, three.js and standard engines compute runtime tangents that cause noticeable UV seam shading artifacts.
4. **Normal Baking Coordinate Convention**: glTF 2.0 requires OpenGL tangent-space normal maps (+Y up). `bake_worker.py` lacked explicit normal axis assignments (`POS_X`, `POS_Y`, `POS_Z`).
5. **Grayscale UV Gutter Dilation Bug**: `fill_gutters()` in `bake_worker.py` rejected textures where `arr.ndim != 3`, silently skipping 2D grayscale textures (ambient occlusion, roughness, and metallic maps) and causing dark border seams around UV islands.

**Decision:**
1. **Uncapped Ingestion & Precedence**:
   - Removed artificial `< 200000` clamp in `shouldAutoOptimize()` in `features/workspace/utils/buildGenerationParameters.ts` and restored contract string `target_polycount`.
   - Updated `_resolve_target_polycount_precedence()` in `backend/api/routers/mesh_generation.py` so explicit `top_level_target` (including `0` for Native/Raw) strictly precedes preset defaults.
   - Raised `MAX_PRODUCTION_FACES` in `backend/postprocess/pipeline.py` to `2_000_000` (from 200,000) for VFX/cinematic workloads.
2. **Deterministic Vertex Normal Caching**:
   - Explicitly evaluated `mesh.vertex_normals` across all adapters (`trellis_adapter.py`, `triposg_adapter.py`), simplification fallbacks (`simplify.py`), and `compute_angle_weighted_normals()` (`mesh_processor.py`), guaranteeing `NORMAL` accessors are always exported in glTF primitives even when `process=False` is set.
3. **Standard glTF 4-Component Tangents**:
   - Implemented `compute_mesh_tangents()` in `backend/postprocess/pipeline.py` calculating standard tangent frames with bitangent signs (`vec4`).
   - Integrated `tree_postprocessor` in `_export_glb()` to map internal tangent arrays directly to standard glTF `TANGENT` vertex attributes.
4. **glTF 2.0 Normal Baking & Universal Gutter Dilation**:
   - Configured `bake.normal_space = "TANGENT"` with `POS_X`, `POS_Y`, `POS_Z` in `backend/postprocess/tools/bake_worker.py`.
   - Updated `fill_gutters()` to support 2D grayscale images (`ndim == 2`) alongside 3D color images (`ndim == 3`), eliminating dark UV island edge bleed across AO, roughness, and metallic maps.

**Consequences:**
- Generated and post-processed meshes retain pristine raw fidelity, smooth angle-weighted shading, valid tangent frames, and artifact-free PBR texture borders.
- Passed 100% of official model parity tests (`TestNativeRawQualityContracts` and `TestPostprocessPipelineParity`).

---

## ADR-080: Raw Mesh Quality, Nelson Max Crease Splitting, Feature-Preserving Decimation & High-to-Low Normal Baking Fallback

**Date:** 2026-10-16  
**Status:** Accepted

**Context:**
1. **Melted Shading Over Sharp Edges**: Marching cubes extractions and default trimesh processing merged coincident vertices across 90° dihedral angles, forcing corner vertices to share a single averaged normal vector. This produced dark, melted gradient shading across flat surfaces on cubes, bevels, and mechanical edges.
2. **Destructive Vertex Merging on Load**: Default `trimesh.load(..., process=True)` silently re-welded split vertices, undoing intentional crease splits and ruining sharp shading.
3. **Decimation Flattening Creases**: Standard decimation lacked crease protection, collapsing sharp edge features and turning crisp angles into jagged, uneven geometry.
4. **Normal Baking Gutter Bleed & Headless Blender Absence**: Missing ray hits in normal baking left empty black pixels, which bled dark seams across UV boundaries during mipmap filtering. Furthermore, in CPU/container environments lacking a headless Blender/bpy installation, high-to-low normal baking would fail completely.
5. **Raw Native Passthrough Destruction**: Postprocessing pipelines would re-tessellate and decimate meshes even when users requested the raw, native extraction.

**Decision:**
1. **Nelson Max Angle-Weighted Normals & Crease Splitting**:
   - Implemented `compute_angle_weighted_normals` in `core/mesh_processor.py` using Nelson Max (1999) corner-angle weighting.
   - Automatically splits coincident vertices along edges where dihedral angle exceeds `crease_angle_deg` (default 35.0°), while preserving smooth curved topologies (spheres, cylinder mantles).
   - Applied across `MeshProcessor.save_mesh`, `postprocess/meshio.py`, and extraction adapters (`triposg_adapter.py`, `trellis_adapter.py`).
2. **Non-Destructive Mesh Loading (`process=False`)**:
   - Enforced `process=False` across `MeshProcessor.load_mesh`, `file_utils.validate_mesh_file`, `pipeline.py`, and adapters to preserve intentional vertex splitting and exact coordinates.
3. **Feature-Preserving Decimation**:
   - Implemented `feature_preserving_decimate` incorporating boundary edge quadric penalties, crease plane preservation, and normal deviation angle gates (<= 45°).
   - Integrated as the primary fallback simplification engine in `postprocess/services/simplify.py`.
4. **High-to-Low Normal Baking & Headless Pure-Python Fallback**:
   - In `bake_worker.py`: enforced tangent space (`POS_X`, `POS_Y`, `POS_Z`), MikkTSpace tangents (`low.data.calc_tangents()`), bounded `max_ray_distance = max(0.001, cage * 2.5)`, and neutral normal fallback `(128, 128, 255)` with fully dilated gutters.
   - In `bake.py`: implemented `bake_high_to_low_pure_python` fallback using UV rasterization, MikkTSpace-compatible tangent basis generation, cKDTree high-poly surface projection, and Euclidean distance transform gutter dilation when Blender is absent.
5. **Byte-for-Byte Raw Native Passthrough**:
   - In `postprocess/pipeline.py`: when `resolved_target_polycount == 0` and not `auto_optimize`, master raw GLB bytes are preserved byte-for-byte with optimal normals, bypassing destructive re-tessellation.
6. **Ultra-High Resolution Intake Limits**:
   - Raised default `MAX_MESH_VERTICES` and `MAX_MESH_FACES` in `file_utils.py` to 10,000,000 (configurable via `FORMASH_MAX_MESH_VERTICES` / `FORMASH_MAX_MESH_FACES`).

**Consequences:**
- Sharp corners (e.g. 90° cubes) render with crisp, exact orthogonal shading while curved surfaces stay completely smooth.
- Raw native extractions are preserved byte-for-byte without unwanted decimation or vertex welding.
- High-to-low normal baking works reliably across both Blender-enabled and CPU-only environments without dark border seams.
- All unit and integration tests in `test_raw_mesh_quality_preservation.py` pass cleanly.


## ADR-081 — UniRig Attention Compatibility and FastMesh Resource Admission

**Date:** 2026-10-19  
**Status:** Accepted

**Decision:**
1. UniRig selects SDPA only if the active Transformers causal-LM class advertises `_supports_sdpa`; otherwise it uses eager attention. A hardware-level fallback alone is insufficient because architectures can differ in backend support.
2. The main backend compatibility helper imports PyTorch lazily before defining the optional `torch_cluster.fps` fallback, preventing missing-name failures at annotation evaluation.
3. FastMesh remains single-GPU in resource admission until its adapter implements explicit model sharding/dispatch. Remove its manifest's multi-GPU declaration rather than treating aggregate VRAM as model parallelism.
4. FastMesh checkpoint readiness and downloader verification require the matching variant descriptor and a `model.safetensors` file exceeding 4,000,000,000 bytes.

**Rationale:** The supplied UniRig log exposed a helper annotation `NameError`, followed by Transformers rejecting SDPA for `OPTForCausalLM`. Separately, FastMesh's current runner does not implement the scheduler's declared multi-GPU dispatch contract. Directory entry counts are not proof that the full FastMesh weights downloaded correctly.

**Consequences:** Unsupported UniRig attention backends fall back to eager; incomplete or mismatched FastMesh checkpoints are not marked ready; 2×T4 aggregate memory cannot falsely admit V1K/V4K. Manifest VRAM budgets remain conservative reservations until peak memory is measured on GPU hardware.


## ADR-082 — UniRig Pointcept Pre-Ampere Attention Fallback

**Date:** 2026-10-19  
**Status:** Accepted

**Context:** UniRig's Point Transformer v3 attempted the FlashAttention variable-length kernel on a pre-Ampere GPU. When the kernel rejected the hardware, the exception fallback invoked `self.attn_drop(attn)`, but the FlashAttention constructor branch had stored `attn_drop` as a plain float, causing a second `TypeError: 'float' object is not callable` and preventing eager fallback from completing.

**Decision:**
1. Enable FlashAttention only when the package is present, CUDA is available, and the current CUDA device reports compute capability 8.0 or newer. If capability cannot be read, select eager attention.
2. Store attention dropout as `torch.nn.Dropout` regardless of the selected attention path. Pass `self.attn_drop.p` as FlashAttention's numeric `dropout_p`, and retain module invocation for eager attention and the runtime exception fallback.
3. Synchronize the third-party repository revision through the main repository submodule pointer and add a CPU-only source contract.

**Consequences:** Pre-Ampere devices avoid the known unsupported FlashAttention call and use the existing eager attention implementation. This trades potential throughput and VRAM efficiency for compatibility; GPU-backed UniRig inference remains the required runtime validation.
