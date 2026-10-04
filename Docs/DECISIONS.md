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

## ADR-040: Canonical Hunyuan Shape→Paint Workflow

**Decision**: Treat Hunyuan3D-Shape-v2-1 as the raw-mesh stage and Hunyuan3D-Paint-v2-1 as the optional texture stage. Do not register a separate direct Shape textured model ID.

**Reason**: Shape and Paint are separate model checkpoints with independent VRAM and lifecycle requirements. The existing scheduler and Workspace already support the two-stage flow, allowing Shape to finish and expose a generated file ID before Paint is scheduled.

**Consequences**:
- `hunyuan3d_shape_v21_image_to_raw_mesh` and `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` are the current Hunyuan shape-generation IDs.
- `hunyuan3d_paint_v21_image_mesh_painting` remains independently callable.
- Workspace texture generation uses the generated job file ID plus the original image input for Shape-v2-1 or Mini Turbo → Paint handoff.
- The removed direct Shape textured ID is not exposed through the model registry or GeneratePanel.

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

**Reason**: Several adapters silently ignored the generic field and used lower defaults: TripoSR (mc_resolution), TripoSF (resolution), PartPacker (grid_resolution), and UltraShape (octree_res).

**Consequences**:
- High/Ultra generation now requests higher model-native extraction resolutions for those adapters.
- PartPacker raw mode uses num_faces=-1 and TRELLIS.2 raw mode disables remeshing/decimation.
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
