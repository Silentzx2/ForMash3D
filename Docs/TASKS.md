# ForMash3D — Centralized Raw-Mesh Generation, Texture Studio, Paint3D/Hunyuan Texture Routing, and Runtime Bug Fixes

> **Target repository:** `https://github.com/Silentzx2/ForMash3D`
>
> **Target branch:** `Dev`
>
> **Task artifact:** This file is an implementation brief for a coding agent. It is not a request to edit or push this file to GitHub. Do not assume any repository changes have already been made.
>
> **Execution mode:** Autonomous, implementation-first, root-cause-first. Continue through all independent workstreams even if one item is genuinely blocked. Report blockers precisely rather than claiming completion.

## 0. Main Objective and Final Product Decision

Implement one consistent architecture in which **every normal image-to-3D generation model produces raw geometry only**, while texture generation is a separate, optional stage managed by Post-Processing and the Texture Studio UI. Integrate Paint3D for 1K/2K texture outputs, and reuse the existing Hunyuan3D-Paint-v2.1 adapter for 4K/8K high-quality presets, subject to code-level validation of the requested resolutions and actual exported atlas sizes.

Also investigate and fix the independent cancellation, Redis/SQLite, frontend state-sync, and dead-UI issues documented in the uploaded source file `ForMash3D Fix Plan Test.md`. The uploaded file is part of this task and none of its A/B/C/D findings may be silently dropped. Re-verify each reported bug against the current `Dev` branch before editing; code may have changed since the source audit.

### Locked architectural decisions

1. Keep all existing **geometry models** available. Do not remove a geometry model or break its raw-mesh capability.
2. Remove/disable embedded texture generation and model-specific Shape→Paint auto-chaining from normal image-to-3D generation paths. Geometry-generation adapters return raw meshes; they do not decide whether to texture.
3. Use a centralized texture-generation path with two model choices selected **automatically from the user-visible output resolution**:
   - `1K` or `2K` → Paint3D.
   - `4K` or `8K` → Hunyuan3D-Paint v2.1.
4. Reuse the existing Hunyuan3D-Paint adapter after separating it from generation auto-chaining. Add one Paint3D texture adapter. Do **not** add one duplicate adapter for Texture Studio and another duplicate adapter for Post-Processing. The same two texture adapters must be callable from both places.
5. A single user-facing Textured Generation toggle must work for every supported image-to-3D geometry model, regardless of whether the selected geometry model natively used to produce textures.
6. Store the original reference image as a durable file/file-store reference associated with the generation job. When texturing is enabled, hand the exact same reference image to the selected texture adapter together with the generated raw mesh and resolved texture settings.
7. Preserve existing public API endpoint paths and compatible request/response contracts. Refactor their internal execution path rather than breaking existing clients. Backward-compatible model-ID aliases may be necessary; if so, route aliases to the new raw-geometry + optional centralized-texture workflow rather than reactivating legacy texture generation.
8. Provide separately downloadable raw mesh/source, individual texture map files that genuinely exist, combined textured GLB, and a complete project ZIP.
9. Texture failure must not delete, corrupt, or replace the raw mesh. Allow independent retry of the texture stage from the persisted mesh and reference image.
10. User-visible controls stay simple: resolution preset and the optional texture toggle. Do not expose internal sampling steps, render sizes, view counts, guidance, or model-specific parameters in the ordinary UI. Resolve and persist these automatically in the backend.
11. 4K/8K must display a clear notice that generation can take longer and needs more GPU memory. Never silently downgrade a selected size or claim unsupported native 8K generation. Validate the actual atlas written to disk.
12. Existing endpoints, storage conventions, scheduler/job lifecycle, authentication and authorization, source-fidelity rules, model-specific geometry settings, and unrelated features must remain intact.

### Preset parameter intent — validate before locking implementation

| User-visible preset | Required texture adapter | Intended internal generation setting | Required final atlas target |
|---|---|---:|---:|
| 1K | Paint3D | Backend-selected supported config | 1024 × 1024 |
| 2K | Paint3D | Backend-selected supported config | 2048 × 2048 |
| 4K | Hunyuan3D-Paint v2.1 | `resolution=512` is the requested starting mapping | 4096 × 4096 |
| 8K | Hunyuan3D-Paint v2.1 | `resolution=768` is the requested starting mapping; verify it is actually accepted and stable | 8192 × 8192 |

**Important distinction:** internal render/generation resolution and exported UV texture-atlas dimensions are different controls. Before implementing the mapping, inspect the actual upstream and vendored code. Hunyuan’s documented common configuration uses 512/768; do not assume 700 works just because the configuration accepts an integer. If 700 is rejected or causes incorrect dimensions, use the closest supported setting only after documenting that exact mismatch and the selected compatibility solution. Do not silently claim 8K is natively generated by the model; verify/implement the final atlas bake or enhancement/export path and truthfully record whether the result is generated at 8K or resized/upscaled to an 8K atlas.

Do not claim a specific VRAM minimum is proven by the app’s current config alone. The upstream Hunyuan3D-2.1 documentation reports about 21 GB VRAM for its standard texture path; the current project config has a lower value/comment. Reconcile this discrepancy through code and real measurements if available, and use a conservative, truthful resource estimate until validated.

## 1. Current-Branch Audit: Mandatory Before Editing

The user explicitly requested a deep review of the latest `Dev` branch before planning or implementation. Do not rely on stale line numbers from this file or the uploaded bug report.

### 1.1 Record current repository state

1. Fetch/clone the current `Dev` branch and record its current HEAD SHA and working-tree status.
2. Confirm the active branch really is `Dev`. Do not reset, clean, overwrite, or discard uncommitted user work.
3. The initial GitHub inspection found `RULES.md` on `Dev` and did **not** find a root `agent.md` (`404`). Re-check this on the actual working copy. If `agent.md` still does not exist, inspect for `AGENTS.md`, `.github` instructions, `CONTRIBUTING.md`, `Docs/developer-guide.md`, or another applicable agent guide; record that the named file is absent instead of pretending to have read it.
4. Read `RULES.md`, `README.md`, `CONTRIBUTING.md`, the relevant project Markdown docs, the full current `Docs/TASKS.md`, and the entire uploaded `ForMash3D Fix Plan Test.md`. Read the relevant docs in full, including at minimum:
   - `Docs/ARCHITECTURE.md`
   - `Docs/MEMORY.md`
   - `Docs/TASKS.md`
   - `Docs/DECISIONS.md`
   - `Docs/PRD.md`
   - `Docs/DESIGN.md`
   - `Docs/SECURITY.md`
   - `Docs/SYSTEM-BLUEPRINT.md`
   - `Docs/CHANGELOG.md`
   - `Docs/api-documentation.md` if present
   - any active developer guide or model/adapter documentation found in the repository
5. Do not indiscriminately dump/read the entire 300+ source-file tree. Use docs, targeted search/ripgrep, the model registry, and caller/reference searches to create a focused code-path map. Expand inspection whenever a shared function’s callers or registration path require it.
6. Inspect how `manager.sh`, `docker-compose.yml`, `supervisord.conf`, `Dockerfile`, `scripts/setup.sh`, and `backend/scripts/install.sh` start and configure the services. Preserve the existing working cold-start sequence. Do not alter `.env.example`, Docker entrypoints, service ports, or startup order unless a verified Paint3D/runtime issue strictly requires it and the change is explained.
7. Inspect tests before changing code; add or extend focused tests alongside the code changes.
8. Before edits, make a non-destructive safety checkpoint (branch/HEAD record and diff/status capture; stash only if necessary and only without losing work).

### 1.2 Explicit current-code areas already identified during the initial branch review

Use these as starting points, not as an exhaustive list:

- Model registry/configuration: `backend/core/scheduler/model_factory.py`, `backend/config/models.yaml`, `backend/api/dependencies.py`, `backend/api/routers/system.py`, `constants/models.ts`, and any shared model/capability metadata.
- Geometry/texturing adapters: `backend/adapters/trellis_adapter.py`, `backend/adapters/trellis2_adapter.py`, `backend/adapters/hunyuan3d_shape_v21.py`, `backend/adapters/hunyuan3d_paint_v21.py`, `backend/adapters/unique3d_adapter.py`, plus every other image-to-3D adapter and all relevant registry aliases.
- Generation and job flow: `backend/api/routers/mesh_generation.py`, `backend/core/scheduler/multiprocess_scheduler.py`, `backend/core/scheduler/redis_job_queue.py`, `backend/core/scheduler/job_queue.py`, `backend/postprocess/pipeline.py`, storage/artifact helpers, and file-upload/reference resolution helpers.
- Frontend: `features/workspace/Panels/GeneratePanel.tsx`, `features/workspace/Panels/TexturePanel.tsx`, `features/workspace/store/WorkspaceContext.tsx`, `features/workspace/types.ts`, `features/workspace/lib/api.ts`, `features/workspace/utils/buildGenerationParameters.ts`, `constants/models.ts`, and the shared job/history/persistence mapping code.
- Installer and model manager: `backend/requirements.txt`, `backend/scripts/install.sh`, `backend/scripts/download_models.sh`, `scripts/setup.sh`, `manager.sh`, the current `backend/thirdparty/wheels` mechanism, and existing model weights/manifest conventions.
- Existing tests under `backend/tests/`, test scripts under `scripts/`, and available frontend test/type/build scripts.

### 1.3 Mandatory pre-change flow map

Trace and document the current flow before code changes:

`user image + selected geometry model + controls -> request/schema -> API endpoint -> job input/metadata persistence -> scheduler dispatch -> geometry adapter -> raw/native output -> master asset promotion -> post-processing stages -> optional rig chain -> result/job persistence -> frontend job state -> viewer/history/download/ZIP`

Also trace the current separate Texture Studio flow:

`current asset + original/uploaded image -> TexturePanel -> runTextureGeneration -> API endpoint -> texture-only adapter -> output path -> job completion -> asset refresh/viewer/export`

Find every textured-generation call site through search. Do not assume a single adapter is responsible. Initial branch evidence showed:

- TRELLIS adapters include `image_to_textured_mesh` as well as dedicated painting variants.
- TRELLIS.2 has an image-to-textured-mesh adapter and a separate image-mesh-painting adapter.
- Hunyuan Shape has a `Hunyuan3DShapeV21ImageToTexturedMeshAdapter` wrapper and uses Hunyuan Paint for the separate painting path.
- Unique3D metadata declares texture capability/vertex color; verify whether it actually exports material/texture/vertex colors and implement the correct raw-geometry contract without corrupting geometry.
- `backend/config/models.yaml` has `paint_autochain` flags, textured generation registrations and texture-only registrations.
- `features/workspace/Panels/GeneratePanel.tsx` currently gates the PBR texture toggle based on the selected geometry model’s texture capability. This must change so the toggle is common to all supported raw geometry models.
- `backend/core/scheduler/multiprocess_scheduler.py` contains `auto_paint` and production post-processing orchestration. It needs to become one optional stage, not a second independent generation workflow.

Search all code/docs/manifests for variants of `image_to_textured_mesh`, `textured_mesh`, `auto_paint`, `paint_autochain`, `paint_model_preference`, `paint_resolution`, `generateTexture`, `texture_generation`, `texture_resolution`, `image_mesh_painting`, `TexturePanel`, and old model IDs. Update every live caller and relevant documentation; do not just patch the files listed above.

## 2. Mandatory Engineering Rules

`RULES.md` is binding. Follow Ponytail/lazy-senior-dev discipline:

- Establish root cause before fixing symptoms.
- Inspect existing helpers, interfaces, dependencies, paths, and all callers before adding a new abstraction.
- Prefer reuse, deletion, and the fewest correct file changes; do not create duplicate registries, schedulers, queues, services, adapters, or status systems.
- Add no avoidable dependency and do not add boilerplate.
- Preserve security, boundary validation, data-loss safety, accessibility, model-native fidelity, and user-visible requirements.
- Validate input paths and file IDs at the existing trust boundary; do not accept arbitrary user filesystem paths or shell-interpolated paths.
- Do not add text-to-3D; project shape-generation input remains image-based. Do not remove text-to-motion, rigging, editing, or unrelated capabilities.
- Do not change model weights or train/fine-tune any model.
- Keep lazy adapter imports so importing the API does not load heavy GPU models.
- For UI verification use `agent-browser` CLI when available. Do not save screenshots/test images to the project root; use `/tmp/agent-browser-screenshots/` or another scratch directory.
- After every meaningful change, update the relevant existing Markdown docs. Do not add extra documentation files when existing docs can be extended.
- Any deliberate simplification that cuts a real corner must include a `ponytail:` comment naming the limitation and the condition for upgrading it.

### Repository-level task conflict to handle carefully

The current `Docs/TASKS.md` contains an existing hard invariant to retain existing models/adapters. This task does **not** authorize deleting geometry models. It does authorize removing embedded texture-generation behavior from the *normal geometry generation path*. Keep raw geometry adapters and unrelated standalone functions. Centralize normal UI texture generation on Paint3D/Hunyuan Paint. Keep legacy IDs/endpoints compatible where needed, but deprecate/hide legacy geometry+texture routes from the normal model picker and redirect old IDs to the centralized route rather than deleting a model family blindly.

## 3. Paint3D Integration into Python 3.10 / CUDA 12.4 / PyTorch 2.6

### 3.1 Upstream compatibility research is required before installing anything

Official Paint3D repository: https://github.com/OpenTexture/Paint3D

- Paint3D is designed to create high-resolution, lighting-less UV textures for an existing untextured mesh, conditioned on text or an image.
- Its upstream README documents a **two-stage** workflow: coarse texture generation (`pipeline_paint3d_stage1.py`) followed by UV texture refinement (`pipeline_paint3d_stage2.py`). With image conditioning, both stages take the same `--ip_adapter_image_path` reference input; stage 2 also takes stage 1’s albedo/texture output.
- Upstream `environment.yaml` is old: Python 3.8.5, PyTorch 1.12.1, torchvision 0.13.1, CUDA toolkit 11.3, and legacy pinned dependencies. Its README says tested on PyTorch 1.12.1/CUDA 11.6 and uses Kaolin 0.13.0. Do not blindly install this environment or requirements in the project environment.
- Current ForMash3D baseline documented by its Docker/install files is Python 3.10, CUDA 12.4, PyTorch 2.6.0+cu124 (with matching torchvision). Preserve this common runtime.
- Paint3D’s dependencies include CUDA/native components or libraries with strict Torch/CUDA compatibility requirements (including its mesh rendering dependencies and Kaolin/PyTorch3D-related paths). Do not assume a simple `pip install -r` is sufficient.
- Upstream code license is Apache-2.0; preserve upstream license/attribution and independently check licenses/compatibility of weight files, ControlNet/IP-Adapter/diffusion checkpoints, PyTorch3D, Kaolin, and every new dependency.

### 3.2 Integration requirements

1. Inspect `environment.yaml`, source imports, render configs, ControlNet/IP-Adapter configs, model/checkpoint paths, native extensions, and the full two-stage image-conditioned invocation on the upstream main branch. Pin a reviewed upstream revision/commit for reproducibility.
2. Integrate through a thin ForMash3D adapter using the existing adapter base, lazy loading, `model_factory.py`, `models.yaml`, resource planner, output-path generator, scheduler, and file-resolution conventions. Avoid a second infrastructure path.
3. Configure it to receive:
   - an existing raw mesh path from canonical job storage;
   - the exact original reference image path resolved from a persistent, authorized file reference;
   - backend-generated internal parameters chosen from the `1K` or `2K` preset;
   - job-scoped output paths.
4. Execute the intended coarse-to-fine workflow (stage 1 then stage 2). Ensure the reference image is passed to both stages when the chosen official pipeline requires it. Do not make the user manually upload the same image again if the asset already stores a valid original reference image.
5. Confirm the output mesh retains the same geometry and only adds a valid UV texture/material, unless upstream necessarily changes topology. If the upstream code changes topology, record the change and retain the untextured input mesh separately.
6. Return a standard result compatible with existing asset registration/download handling, including the real output file path, texture map paths, output atlas dimensions, geometry/material metadata, timings, model/version, and resolved settings.
7. Keep all GPU inference on CUDA under the project’s existing strict-GPU policy. Do not silently fall back to CPU. Do not lower quality invisibly to fit VRAM.
8. Do not invoke upstream commands through shell string interpolation. Use safe direct imports or subprocess arguments as separate argv items with validated inputs, controlled working directory, timeout/cancellation behavior and scoped environment.
9. Prevent concurrent Paint3D jobs from writing into the same output directory. Reuse existing scheduler exclusivity and job-scoped storage.
10. Do not commit model weights/checkpoints. Implement the appropriate download/verification entries using the existing download manager and Hugging Face/cache conventions. A download marked successful must have the expected files and pass the existing verification check.

### 3.3 Python/Torch/CUDA compatibility policy

The target is the **existing** Python 3.10 + CUDA 12.4 + PyTorch 2.6.0 environment.

- Do not downgrade global Torch, torchvision, CUDA, Python, diffusers, or other shared model dependencies just to satisfy Paint3D.
- Do not run Paint3D’s environment file wholesale in the shared environment.
- Reuse already-installed compatible dependencies when possible.
- Adapt the minimum required upstream Python code/configs to compatible current dependencies and build only required native extensions against the actual target Torch/CUDA version, using existing project build/wheel mechanisms when available.
- Inspect and test the import graph. Avoid generic import names (for example, a vendored `utils` package) shadowing ForMash3D modules. Follow the project’s verified `sys.path` insertion pattern when the upstream code requires an isolated import root.
- Check PyTorch3D and Kaolin availability and exact ABI compatibility; do not claim support merely because installation completed. If a compatible existing ForMash3D wheel is available, validate its Torch/CUDA tags before reuse.
- Add a smoke check proving `torch.__version__`, CUDA availability/runtime, key Paint3D imports/native extensions, checkpoint discovery, input mesh loading, and a small real inference if hardware allows. If actual GPU inference cannot be performed, report it as hardware-blocked and provide exact validation commands.
- If Paint3D cannot be made compatible without downgrading shared packages or causing widespread regressions, do not secretly create a second environment or rewrite unrelated setup. Isolate the exact blocker, attempt a minimal compatibility patch, and document the smallest alternative for explicit review.

### 3.4 Paint3D model manager and setup integration

- Add Paint3D to the existing `backend/core/scheduler/model_factory.py` adapter registry and `backend/config/models.yaml` using its dedicated texture feature, `supported_inputs: [mesh, image]`, real checkpoint path, and a conservative/verified VRAM requirement.
- Register it with `backend/api/dependencies.py`/frontend model metadata only via existing discovery conventions. Do not invent a second source of truth.
- Add download and verification logic to `backend/scripts/download_models.sh`; make it sequential, idempotent, and fail non-zero if any mandatory weight/checkpoint is missing or inaccessible. Respect existing authentication/token handling and do not print secrets.
- Add only the minimal installation/build section in `backend/scripts/install.sh` and the relevant existing setup path. Do not touch Docker entrypoints or service startup ordering unless the verified build sequence cannot work without it.
- Update `manager.sh` model menu/mapping where appropriate, but do not mark Paint3D ready merely because its repository directory exists. Verify all required checkpoints and native components.
- Keep model weights out of Git, VENV directories and source-only wheels release unless that is the existing project policy for such artifacts. Preserve upstream notices.

## 4. Convert Normal Image-to-3D Generation to Raw Mesh Only

### 4.1 Exact required behavior

For every selectable image-to-3D geometry model:

`reference image + selected geometry model -> geometry inference -> raw/untextured mesh -> canonical master/source.glb -> production post-processing -> optional centralized texture stage`

Selecting a geometry model must never implicitly choose or run its own texture pipeline. The geometry model’s own valid geometry inference settings, extraction, topology and source fidelity must remain model-specific. Only embedded texture calls, texture bake/material output and automatic model-specific paint chains are to be removed from the normal geometry generation path.

### 4.2 Adapter/registry audit

1. Enumerate every adapter under the registry by actual feature IDs and trace the inference output—not only the class name or YAML capability flag.
2. Change normal generation modes that currently return `image_to_textured_mesh` to their raw-mesh counterpart. Preserve model-specific raw geometry inference behavior and output format.
3. Remove or disable embedded native texture generation in ordinary TRELLIS and TRELLIS.2 image-to-3D calls; leave their geometry generation and any unrelated representation requirements working.
4. Remove the `Hunyuan3DShapeV21ImageToTexturedMeshAdapter` chain/wrapper from normal model selection. Shape-v2.1 and DiT-v2-mini-Turbo must stop automatically dispatching to the paint adapter.
5. Remove `paint_autochain`/`auto_paint` activation from normal geometry-model capability/default/parameter paths. Ensure scheduler sanitization strips obsolete texture-only fields from the geometry adapter inputs as appropriate.
6. Audit Unique3D and every other adapter with `texture_generation: true`, native PBR, texture resolution, material, or vertex-color behavior. Return raw geometry with no baked image texture in the common path. Preserve required vertex colors only if they are intrinsic to its native geometry representation; record the decision and test viewer/output behavior instead of blindly stripping data necessary to decode its mesh.
7. Do not delete an entire geometry adapter or model registration merely because its old generation path was textured. Preserve existing models, raw capabilities, lazy loading, source-fidelity rules, official output orientation, extraction schedules and model IDs where practical.
8. Ensure output path/response metadata reports raw output and that frontend state/history does not mislabel it as textured.
9. Search for old `image_to_textured_mesh` IDs and behavior in model factory, config, endpoint defaults, UI selector, generation parameter builders, tests, documentation, and downloader. Keep legacy endpoint/model ID compatibility as aliases where needed, but hide legacy textured geometry modes from the normal generation model picker and route them into the raw-mesh + optional central texture flow. Do not leave dead registrations that still run a legacy textured path.
10. If an old ID must remain registered to avoid breaking persisted historical jobs or public API clients, make its alias/deprecation semantics explicit and test that it no longer bypasses the central texture policy.

### 4.3 Capability contract after the refactor

- Geometry adapter capability must describe geometry support (image-to-3D, raw mesh, multiview, native geometry characteristics, VRAM, and other true geometry capabilities), not dictate whether the user can texture the result.
- Texturing availability becomes a shared downstream/UI capability, not a condition that hides the global texture toggle for raw models.
- Multiview support, rigging, editing, animation/text-to-motion, segmentation, remeshing, UV tools, and unrelated model functionality must not be removed.
- No text-to-3D feature may be accidentally reintroduced.

## 5. Centralized Texture Pipeline and Post-Processing Handoff

### 5.1 One path reused by two entry points

Implement a single texture execution path using the dedicated adapters:

- **Post-Processing path:** raw generation result, immutable master/source, original reference image and captured settings -> geometry/post-processing stages -> optional texture stage -> final artifact manifest/export.
- **Texture Studio path:** an existing selected/uploaded mesh plus the linked original reference image or an explicit uploaded reference -> the same shared texture execution path -> independent textured asset/texture maps -> refresh selected asset and download options.

Do not duplicate model selection logic, settings resolution, input validation, texture output conversion or asset packaging between the two entry points. Reuse the existing adapter registry, input-resolution and scheduler/job mechanisms.

### 5.2 Job request/persistence contract

Capture the texture choice at job submission time and persist it with the job so a later UI change cannot alter a running job. The stored job must include enough data to resume/retry after worker or server restart:

- `texture_enabled` (or one canonical equivalent; normalize the project’s legacy `generateTexture` / `auto_paint` keys at the boundary);
- requested atlas resolution preset: `1K`, `2K`, `4K`, or `8K`;
- durable reference-image `file_id` / controlled server-side artifact reference, never only a browser blob URL or ephemeral data URL;
- raw mesh/canonical asset identity;
- job-scoped resolved adapter/model ID and validated internal settings;
- texture output paths/artifact manifest and retry state;
- enough model/revision metadata to reproduce/debug the operation.

Avoid introducing redundant conflicting flags. Prefer one internal canonical representation and backward-compatible normalization for existing payload names. Do not persist giant base64 image strings unnecessarily when the existing persistent file-store can retain the reference image.

### 5.3 Required stage order and safety

1. Geometry inference produces a raw mesh file.
2. The scheduler persists/promotes an immutable copy at the existing canonical master path (`master/source.glb`, without destructive optimization or texturing replacing it).
3. Existing production post-processing runs according to the currently documented pipeline and requested options. Inspect the real stage order and choose the validated mesh artifact that the texture model is expected to paint; do not accidentally feed a deleted temp path or an invalid postprocessed mesh.
4. At the texture stage, check the persisted `texture_enabled` value:
   - `false`: skip texture inference completely; keep the raw mesh and continue finalization/export.
   - `true`: hand the selected texture adapter the validated mesh artifact, original reference image, requested atlas target, and backend-resolved model-specific parameters.
5. Paint3D is selected for 1K/2K. Hunyuan3D-Paint is selected for 4K/8K. UI does not ask the user to select raw internal model parameters.
6. Save the textured result separately from the immutable raw master. A valid texture output must not overwrite `master/source.glb`.
7. Keep job progress/stage telemetry honest: raw generation, mesh processing, texturing, baking/export, and final QA should be distinguishable. Skipped texture is a real skipped stage, not a false successful texture result.
8. Preserve the original reference image and its safe server-side file reference until all relevant post-processing/retry work is complete. The existing stale-temp-input cleanup must not delete it while a queued/running job still needs it.
9. Texturing failure leaves the raw mesh/master and any already-valid processed derivative intact. Record a failed texture stage with a precise message; permit a texture-only retry without repeating geometry generation.
10. Cancellation must be checked during the new texture stage just as for repair/decimation/UV/bake/LOD stages.
11. Make the pipeline idempotent. A repeated poll/retry/recovery must not double-run texture generation, corrupt a complete manifest, or return early before requested texturing has run.
12. Audit any early-return/cached `asset.json` path in `run_postprocess_job()`: a completed existing geometry asset must not cause requested texture processing to be silently skipped, and a completed texture artifact should not be needlessly regenerated.

### 5.4 Output contract

Use the existing canonical workspace/storage conventions rather than creating a parallel storage system. At minimum expose these independently:

- immutable untextured source/raw mesh;
- validated/processed untextured mesh when separately available;
- real individual texture maps generated by the chosen model (e.g. albedo/base-color and PBR maps only if they genuinely exist);
- combined textured GLB with valid UVs/material references;
- existing game-ready mesh/LODs/collision/QA artifacts where the selected post-processing profile creates them;
- a complete project ZIP containing the relevant source, separate texture maps, combined output and metadata/manifest.

Do not fabricate normal/roughness/metallic/AO maps for a model that only generates albedo. Use truthful material defaults only when valid, explicit and documented. Ensure texture file references are relative/portable when possible and survive reloading the GLB outside ForMash3D.

### 5.5 Post-processing resolution mapping

- Add or reuse one resolution mapping function/config under the existing central model/settings configuration. Do not duplicate lookup tables in UI, adapter and scheduler.
- The UI sends the requested atlas preset. The backend maps it to the selected texture adapter’s supported internal settings and target baking/export size.
- Paint3D upstream’s published target is 2K UV textures; for the 1K preset, downsample/rebake the generated result to a real 1K atlas if required.
- For Hunyuan, inspect the actual code’s view-render resolution, RealESRGAN stage, UV baking and material atlas output. Set the 4K/8K output size explicitly at the proper step. Confirm the final saved atlas dimension from the actual file, not merely the request metadata.
- For 8K, clearly distinguish true model-generated detail from supersampled/upscaled output. If 8K baking/resolution needs a controlled extension, implement and test it without claiming that upscaling creates new semantic detail.
- Unsupported combinations must fail validation with a useful, actionable error or be routed through an explicitly defined supported path. Never silently return a lower-res atlas than requested.

### 5.6 VRAM-aware scheduling and user warnings

- Use existing VRAM-aware scheduler/resource planner and truthful model registry fields. Do not add a second resource manager.
- Populate Paint3D and Hunyuan estimates from upstream requirements plus measured behavior; distinguish `minimum`, `recommended`, resolution-specific estimates and `unknown` if the project schema supports it. Do not invent low-VRAM support based on a boolean alone.
- Warn before submitting 4K/8K that they require more time and VRAM. For insufficient memory, use the existing queue/resource-blocking behavior or return an honest resource error; do not silently switch to a smaller atlas.
- Do not overlap heavy geometry and texture inference in GPU memory unless the current scheduler explicitly admits and controls it. Unload/cache models using the existing lifecycle policy.

## 6. Frontend and Texture Studio Requirements

### 6.1 Generation UI

- Preserve the current GeneratePanel design system and existing selected geometry model control.
- Show a common Textured Generation ON/OFF toggle for every supported image-to-3D geometry model. The toggle is not conditioned on `activeModelObj.supports_texture` because geometry model capability is no longer the texture routing decision.
- When the toggle is OFF, do not enqueue or load any texture model.
- When ON, show only a simple output atlas size selector: `1K`, `2K`, `4K`, `8K`. Do not show internal `512`, `700`, view counts or inference parameters as user controls.
- Preserve the project’s current user default where it is deliberate and documented. Do not silently force textures on just because a model supports them; if no deliberate default exists, choose a safe compute-aware default and document it.
- Display clear time/VRAM notice for 4K/8K. Do not describe 8K as natively supported until code and file verification prove it.
- Maintain existing polycount semantics: polycount is downstream-only and must not reduce or overwrite the immutable raw master.
- Preserve the uploaded image/reference association and pass it through the same persistent file path used by current upload APIs. Do not use a browser blob/data URL as the only post-processing input.

### 6.2 Texture Studio / texture-generation page

- Keep the existing TexturePanel/workspace experience and endpoint contract. Refactor it to use the shared texture resolver/execution path.
- Its normal texture-model routing should be automatic by requested size: Paint3D for 1K/2K, Hunyuan Paint for 4K/8K. Do not expose old TRELLIS geometry-generation textured variants as texture choices in the standard flow.
- User can select an existing mesh asset or upload a mesh, and use its stored original source image when available. If no linked original image exists, offer/require a reference image upload rather than passing an invalid URL.
- Keep useful existing mesh tools/manual painting only if they are truly separate and called; do not regress brush editing, UV, segmentation, remesh, rigging, or other tools while simplifying the AI-generated texture route.
- On completion, refresh the selected asset and show texture status/downloads without forcing panel navigation to Generation.
- Surface distinct queued/loading/running/completed/failed/cancelled states and show useful errors.

### 6.3 Types, schemas and client contract

- Update TypeScript request/response types and Pydantic models together.
- Preserve existing REST paths and response fields. Add optional metadata where needed, but do not rename/remove current endpoints.
- Keep API boundary validation for resolution values, file IDs, mesh references, authenticated ownership and allowed storage roots.
- Update task persistence/history normalization so the raw mesh, textured mesh and texture map paths remain accessible after reload/restart.
- Audit all shared state consumers if changing `WorkspaceContext`, `jobsById` or asset state; fix the common state source rather than patching each panel separately.

## 7. Uploaded Bug Plan — All Findings Must Be Re-Verified and Addressed

The following requirements originate in the uploaded `ForMash3D Fix Plan Test.md`. It was written from a previous direct Dev-branch audit. Every item remains a mandatory check, but the agent must verify current behavior and skip implementation only when an already-present fix is proven by code and a regression test.

### Section A — Cancellation across worker, post-processing and auto-rig

#### A1. `backend/postprocess/pipeline.py` — cooperative cancellation during post-processing

The prior report found that `run_postprocess_job()` is synchronous and called through `asyncio.to_thread(...)`, and has no cancellation awareness. Confirm this against current source.

Required:
- Add cancellation checkpoints before/after major existing stages, including mesh repair, remesh/decimation, UV, bake, LOD, QA/export, plus the new optional texture stage.
- Use the existing progress/callback/job mechanism where possible; do not duplicate stage orchestration.
- The synchronous worker thread must not attempt to `await` an async Redis call or use an event loop incorrectly. If a cancel checker must cross from scheduler async code to the thread, use a safe thread-to-loop bridge / thread-safe event / existing supported state mechanism with timeouts and bounded behavior.
- Stop between stages cooperatively and preserve the last valid artifact. Do not leave `master/source.glb` deleted/rewritten or leave a manifest claiming a cancelled/partial stage completed.
- Ensure cancellation of a post-processing texture generation stage does not cause a second GPU inference or delete the reference input before the cancellation is acknowledged.

#### A2. `multiprocess_scheduler.py` — `_watch_auto_rig()` must not resurrect a terminal parent

The previous report found that the child rig status is polled, but the parent’s own status is not rechecked before unconditional parent completion. Re-verify both success and failure branches and the exception/fallback branch.

Required:
- Re-fetch parent job status before every parent `complete_job()` / terminal finalization.
- If parent is already `cancelled` or `failed`, do not mark it completed or write a late result; perform safe child/artifact/temp cleanup only.
- Cover the `except` fallback path too; it must not resurrect a cancelled/failed parent.
- Search all auto-rig/other chained child workflow finalizers for the same parent-state race and fix shared patterns where found.

#### A3. `multiprocess_scheduler.py` — do not fake-cancel jobs without a live worker

The prior report found `cancel_job()` forced the Redis job to cancelled if `_stop_worker_for_job()` returned false, even when post-processing/auto-rig had no live worker to terminate. Re-verify.

Required:
- Use the existing Redis `cancel_request_key` / `request_cancel()` cooperative signal for active work that is no longer owned by a live GPU worker.
- For queued jobs, cancel immediately only when the job is actually removed/stopped; for processing jobs, request cancellation and allow the active thread/stage to acknowledge it.
- Do not report confirmed cancellation before the task has stopped. Keep a truthful in-progress/cancel-requested response/state if the bounded wait ends before confirmation.
- Only mark terminal `cancelled` once the worker/process or post-processing stage has actually stopped or a safe existing contract confirms termination.
- Cleanup temporary inputs and release resources only when no stage still needs them.

#### A4. `redis_job_queue.py` — ignore progress writes after terminal status

The previous report found `update_job_progress()` mutates progress/stage/message even after a terminal status. Re-verify.

Required:
- Return/no-op if the job is already `completed`, `failed` or `cancelled`.
- Guard status races robustly enough that a progress update cannot overwrite terminal job display state after completion/cancellation. Use the smallest reliable existing Redis pattern; add atomicity only if the normal read/write sequence demonstrably races.
- Add tests for progress update after every terminal state and concurrent terminal/progress behavior where feasible.

#### A5. `backend/api/routers/mesh_generation.py` — truthful cancel response

The prior report found `cancel_mesh_generation()` hardcodes `cancelled=True` / `status=cancelled`, and calls forced cancellation as fallback. Re-verify.

Required:
- Propagate real scheduler outcome: confirmed cancellation versus cancellation requested but still processing, versus not cancellable/not found.
- Preserve existing response keys for clients; add compatible fields (for example `cancel_requested`) only when needed.
- Remove force-cancel fallback that makes a false claim. Keep permission checks and job-owner validation intact.
- Frontend toast/state must reflect the server’s actual response.

#### A6. Remove the dead `running` terminal-check branch only after verification

The prior report claimed the valid statuses are `queued`, `processing`, `completed`, `failed`, `cancelled`, with `running` never emitted by the backend.

Required:
- Grep for all backend emitters and status coercion/legacy aliases before removing `running` from the cancellable set.
- If `running` is a documented legacy wire alias, normalize it deliberately instead of deleting a compatibility path blindly.

### Section B — Redis/SQLite consistency

#### B1. Persist cancellation to the durable SQLite store

The prior report found `RedisJobQueue.cancel_job()` only updated Redis, unlike `complete_job()` and `fail_job()`, leaving SQLite job-history rows stale. Confirm current implementation.

Required:
- Mirror the existing durable-store sync pattern used by `complete_job()` / `fail_job()` after a confirmed cancellation: `_load_job_request_for_persistence(job_id)` and `await asyncio.to_thread(self.db_manager.save_job, job_request)` or the verified current equivalent.
- Follow the actual durable store schema; do not invent a new schema or migrations unless required.
- Make the transition idempotent and preserve terminal jobs. Check failure handling if DB persistence fails after Redis status changes, and keep the error visible.
- Reconcile status, error, progress, stage, message, completed timestamp, result and user metadata as existing queue patterns require.

#### B2. Audit every other state mutation

Inspect `requeue_job`, retries, cancel requests, orphan recovery, post-processing retry, job deletion and any other method that changes status in Redis or SQLite. Fix the shared persistence pattern where required without introducing a generic layer unnecessarily. Verify SQLite WAL/concurrency and `_reconcile_stale_job_rows()` / `recover_orphaned_jobs()` still work on a cold start.

### Section C — Frontend state sync after cancel

#### C1. `features/workspace/store/WorkspaceContext.tsx` — `cancelExecution()` and `jobsById`

The prior report found cancellation updates `isExecuting`, progress and `activeTask` but does not update the `jobsById` entry used by the polling loop. Verify current code.

Required:
- Update the cancelled/interrupted job entry in `jobsById` and any authoritative ref (`jobsByIdRef`) in the same logical cancellation path, consistent with the real state architecture.
- Ensure the polling loop cannot mark the cancelled job active again on the next tick.
- Use the existing batch cancel state shape as a reference; do not add a separate status system.
- Do not optimistically claim backend cancellation if only a request was sent. Show pending/requested state as appropriate; only terminalize locally when the backend response/contract supports it.

#### C2. Batch cancellation

Re-verify `cancelBatchProcessing()` and preserve its per-item semantics. Do not regress batch queue cancellation while fixing single-job cancellation.

#### C3. Shared UI blast radius

Search all consumers of `isExecuting`, `activeTask`, `jobsById`, generation polling and cancellation. Fix the common state source rather than adding bespoke patches to GeneratePanel, UV, Rigging, TexturePanel or other individual consumers.

### Section D — Orphan/dead mesh-extras UI and JSX defects

#### D1. Investigate before deleting or routing anything

The uploaded report said `features/mesh-extras/` contained an unreachable parallel implementation and explicitly marked the decision unresolved. **Do not silently delete the directory or wire an entire untested second UI surface.**

Required:
1. Check whether the directory still exists in the latest branch.
2. Search imports, dynamic/lazy routes, `app/` routes, CSS/assets, docs, recent git history, `Docs/DECISIONS.md` and `Docs/TASKS.md` for a deliberate standalone Mesh Editor decision.
3. If it is already removed/resolved, record that and do not recreate it.
4. If evidence clearly establishes it as dead code and a prior decision authorizes deletion, follow that documented decision and add focused verification.
5. If still genuinely ambiguous, isolate D1 as `BLOCKED — user decision required` and continue all other work. Ask whether to delete or wire it only in the final handoff; do not block unrelated deliverables.

#### D2. Duplicate `className` properties

If D1’s decision is to retain/wire `features/mesh-extras/AutoRetopoToolsPanel.jsx`, verify the two reported duplicate `className` JSX attributes and merge them into single expressions preserving both classes. If the file is absent/dead and no keep decision exists, do not add a speculative fix to unused code.

## 8. Multi-Agent Implementation Plan

Use sub-agents/workers if the coding runtime supports them. The existing `Docs/TASKS.md` also specifies 6 concurrent workers, or at least 4 if the runtime cannot sustain 6.

- Launch **6 workers** when supported. If not, launch at least **4** and record the runtime limitation. If no sub-agent facility exists, execute the workstreams sequentially and explicitly state that platform limitation.
- Every worker must read `RULES.md`, this entire `task.md`, the uploaded bug plan, `README.md`, `Docs/TASKS.md`, and the docs relevant to its work before touching code.
- Lead agent coordinates shared files, interfaces, tests and ownership. Workers must not assume another worker has completed a dependency.
- Keep assignments isolated to reduce merge conflicts. Do not parallel-edit one shared file without an explicit owner and merge plan.

### Workstreams / ownership suggestion

**Worker A — Branch/doc audit and baseline (read-only initially)**
- Verify branch/head, worktree, actual instructions (`RULES.md`, root `agent.md` absent/present, `AGENTS.md`, contributor docs).
- Map current geometry/texturing routes, endpoint compatibility, adapter registrations, startup order, cancellation and DB persistence.
- Confirm or refute every item from the uploaded bug audit and flag stale findings.
- Report precise code references and test baseline before other workers edit.

**Worker B — Paint3D adapter + upstream runtime compatibility + model manager**
- Integrate Paint3D in the existing Python 3.10 / Torch 2.6 / CUDA 12.4 environment.
- Implement/test the Paint3D adapter, image-conditioned 2-stage flow, native extension/import compatibility, downloader and verifier, requirements/setup/manager changes.
- Do not change registry or UI except coordinated small interfaces; report adapter class/model ID/capabilities/input-output contract to the lead.

**Worker C — Geometry adapter raw-only contract + registries**
- Remove embedded textured generation from normal geometry paths while preserving raw geometry and all model families.
- Own `model_factory.py`, `models.yaml`, adapter capability wiring and related raw geometry adapters (coordinate ownership of files with Worker B).
- Remove obsolete auto-paint settings from geometry capability/routing; preserve legacy IDs as compatibility aliases where necessary.
- Test every registered image-to-3D adapter’s output contract.

**Worker D — Post-Processing shared texture stage + scheduler cancellation gates**
- Own `backend/postprocess/pipeline.py` and the relevant `multiprocess_scheduler.py` orchestration. Integrate optional texture generation after the correct processing stage, persist artifacts, keep raw master immutable, support retry/idempotency and stage cancellation.
- Fix A1/A2/A3 and inspect any auto-rig finalization race in the same scheduler file.
- Coordinate the Paint3D/Hunyuan adapter contract with Workers B/C before implementation.

**Worker E — Frontend Texture Studio/generation UI/state**
- Own GeneratePanel, TexturePanel, workspace texture action/settings, TypeScript contracts and frontend API call sites.
- Make the toggle independent of geometry adapter capabilities; expose only 1K/2K/4K/8K, use stored reference image, show truthful warnings and route output sizes automatically.
- Fix C1/C2/C3 using the common workspace state and server truth. Coordinate `WorkspaceContext.tsx` ownership with the lead.

**Worker F — Redis/SQLite/API cancellation, focused regressions and D audit**
- Own `redis_job_queue.py`, cancellation API implementation where not owned by Worker D, targeted queue/API tests, B1/B2/A4/A5/A6 verification, and D1/D2 research/decision reporting.
- Do not touch Worker D’s scheduler file without coordination. Report D1 separately if no clear decision exists.

**Lead agent (not counted as a worker)**
- Integrate interface decisions before parallel code edits; resolve overlaps; run full cross-phase verification.
- Independently verify each worker’s code rather than trusting reports.
- Re-read the task and touched Markdown docs after changes, close stale references, and produce a requirement-to-code-to-test matrix.

Each worker report must include: inspected files, root cause/evidence, modified files, tests/commands run and result, unresolved blockers, and interfaces the lead must verify.

## 9. Required Implementation Order

Do not implement the entire feature in one blind rewrite. Complete each phase with checks before moving forward.

### Phase 0 — Baseline and source-of-truth map

- Read docs/rules and establish current branch state.
- Run baseline non-destructive tests/compile/type/build checks that are available.
- Verify API startup/Redis/SQLite initialization and cold-start recovery behavior.
- Complete the flow map and enumerate geometry adapters/texture call sites.
- Record the current tests that cover cancellation, persistence, generation, texture panel, model registry and output packaging.

### Phase 1 — Cancel/DB race corrections (uploaded sections A, B and C)

- Fix A1 through A6 and B1/B2 with focused regression tests; fix C1/C2/C3 in the shared state path.
- Respect order `A -> B -> C`; after each section run relevant existing `backend/tests/` checks before advancing.
- Coordinate A1 with Worker D because it shares `pipeline.py` and the new texture stage. Add cancellation checkpoints to the final integrated stage order once both are connected.

### Phase 2 — Model-native geometry becomes raw-only

- Implement Section 4 without deleting existing geometry models.
- Ensure every selected model returns a valid raw mesh and source-fidelity settings are preserved.
- Remove standard UI generation options that imply model-native textured output; preserve endpoint/model-ID compatibility.
- Add adapter/registry tests proving no generation model triggers texture inference when the toggle is OFF.

### Phase 3 — Paint3D compatibility/integration

- Verify current upstream dependency and license details.
- Adapt the minimum compatible dependencies/extensions to the common Python3.10/Torch2.6/cu124 stack.
- Integrate model weights via the existing download manager without committing weights.
- Run import/config/checkpoint tests and, where actual GPU is available, a small real mesh+reference inference.

### Phase 4 — One shared texture execution contract and Hunyuan reuse

- Normalize resolution/texture config once in the backend.
- Register Paint3D and re-use Hunyuan Paint as the only two normal AI texture engines.
- Move all optional texture invocation into the centralized post-processing stage and use the same texture dispatcher from Texture Studio.
- Implement persisted reference-image handoff, failure-safe retries and independently stored output assets.
- Validate atlas resolution on disk for each preset. Verify 4K and 8K paths specifically, not just config values.

### Phase 5 — Frontend and API compatibility

- Update common toggle, size selector, high-resolution notices, direct Texture Studio and durable asset state.
- Keep endpoint URLs and old response fields functioning.
- Update job history/asset normalization and export controls for raw, textures, combined GLB and project ZIP.
- Verify the UI is connected to actual API/backend changes (no dead controls or hard-coded demo behavior).

### Phase 6 — Orphan/dead UI D, documentation sync and full regression

- Investigate D1; do not silently delete or wire the orphan UI.
- Fix D2 only if appropriate based on D1.
- Reconcile all architecture docs/diagrams/registries and changelog.
- Run full validation and the final completion matrix.

## 10. Tests and Acceptance Criteria

The task is not complete merely because code files or adapters exist. All criteria must be `PASS`, or explicitly `BLOCKED` with the exact reason, command and user-side validation procedure.

### 10.1 Geometry generation/raw output

- Every selectable image-to-3D geometry adapter is still registered/usable and produces a raw geometry artifact with no embedded generated texture/material unless a model’s intrinsic representation requires a documented exception (for example necessary vertex colors).
- No standard generation path invokes Paint3D, Hunyuan Paint, TRELLIS paint or old embedded geometry+texture methods when the user toggle is OFF.
- With the toggle ON, geometry generation still runs first and raw source is promoted/preserved before texture generation.
- Legacy endpoints and request formats still resolve; a legacy “image-to-textured” request routes into raw generation plus centralized texture processing without restoring a bypass path.
- All existing geometry-specific inference parameters, axis/normalization conventions, model-native extraction limits, multiview gates and strict-CUDA behavior remain unchanged unless a verified requirement demands an explicit adjustment.

### 10.2 Texture models and settings

- `1K` and `2K` route to Paint3D; `4K` and `8K` route to Hunyuan Paint.
- Only the backend sets model-specific view count, generation resolution, refinement settings, upscaling and atlas baking configuration.
- Paint3D uses the same original reference image in every required stage and textures the supplied mesh, not a newly regenerated shape.
- Hunyuan Paint receives the same original reference image and correct raw/processed mesh input.
- Actual output maps/GLB atlas dimensions are checked from the files on disk and match the requested preset.
- `700` for Hunyuan’s 8K preset is verified from code/runtime; if not supported, compatibility choice/deviation is recorded, never hidden.
- Hunyuan/4K/8K memory estimates/warnings are truthful. No false claim of 12 GB fit or of 8K-native detail.
- Texture jobs are resource-aware; insufficient VRAM never leads to silent lower-resolution output.
- A failed/cancelled texturing job preserves raw geometry and can be retried without rerunning the geometry model.

### 10.3 Assets and exports

- Raw mesh and canonical `master/source.glb` are immutable and downloadable after texturing.
- Individual texture map downloads exist only for maps actually produced.
- Combined textured GLB contains valid UVs and loadable material/texture references.
- Project ZIP includes the agreed source, processed, maps, combined asset and useful manifest/metadata. No absolute temp paths or invalid URLs are required to consume it.
- Refresh/restart/history navigation still resolves correct source, game-ready, textured and thumbnail URLs.
- UVs, materials and texture references survive GLB reload and export.

### 10.4 UI and API

- Every geometry model shows the common texture toggle.
- Toggle OFF skips texture model loading/inference entirely.
- Texture toggle/resolution are captured into the submitted job and cannot be changed mid-run by later UI state changes.
- User sees only simple presets and useful warnings; internal parameters stay backend-managed.
- Texture Studio uses the same texture adapter/routing and can use the asset’s original image or a new reference upload.
- Endpoints/response fields remain backward compatible and authentication/path-root checks still apply.
- Cancelled jobs do not become active again on the next poll; status/toast reflects actual cancellation.

### 10.5 Cancellation, storage and startup

- Cancellation is cooperative during every long postprocessing stage, including texture generation and auto-rig chaining.
- `_watch_auto_rig()` or its replacement cannot complete a terminal parent job in success, failure or exception path.
- No-live-worker cancellation does not force-fake terminal success.
- Redis progress/stage/message updates do not mutate terminal jobs.
- Redis cancellation is persisted to SQLite through the established durable-store pattern; every other status-mutating operation has been audited.
- Stale/orphan reconciliation, WAL/busy timeout, restart recovery and cold startup continue to work.
- API response is honest when cancellation was requested but not yet confirmed.
- No source image/temp input is deleted while any queued/active stage needs it.

### 10.6 Paint3D runtime compatibility

At minimum, execute and record:

```bash
python --version
python -c "import torch, torchvision; print('torch', torch.__version__); print('torchvision', torchvision.__version__); print('cuda_available', torch.cuda.is_available()); print('torch_cuda', torch.version.cuda)"
python -m compileall -q backend
```

Also run targeted checks for Paint3D imports, ControlNet/IP-Adapter dependency/config availability, Kaolin/PyTorch3D/native-extension compatibility, model weight presence, input mesh/reference image validation and output dimensions. Use the actual configured `3daigc-api` Python executable/environment when available. Do not report GPU runtime validation as passed unless inference actually ran on a GPU.

### 10.7 Full project verification

Run all relevant available checks, including:

- targeted backend unit/regression tests for queue cancellation and post-process/texturing;
- model registry/config validation for every previously supported geometry model and the two texture models;
- Python compile/import checks;
- frontend TypeScript (`bun run test` or repository-defined equivalent) and production build (`bun run build`) if available;
- lint if configured, reporting known baseline incompatibilities separately;
- shell syntax (`bash -n`) for touched setup/download/manager scripts;
- YAML/config parsing;
- endpoint/schema smoke tests for existing routes;
- model downloader “verify existing” behavior and failure propagation;
- `agent-browser` UI smoke checks when available;
- source-vs-output artifact integrity checks and ZIP/GLB load checks.

Search for stale references to native textured generation, old `auto_paint` routing, outdated UI labels, duplicated settings maps, dead code, swallowed failures, incorrect model IDs, wrong texture atlas dimensions and stale documentation.

## 11. Dead UI Decision Boundary

The uploaded bug plan deliberately left `features/mesh-extras/` unresolved because the correct choice could be either delete dead code or wire a route. The present task does not make that decision automatically.

- Investigate current directory/routes/imports/docs/git history.
- Do not delete a large UI surface or expose untested duplicate tools based only on a grep result.
- If clear documentation already settles it, follow the recorded decision.
- If no decision exists, finish the rest of the task and leave only D1/D2 marked `BLOCKED — user decision`, with the evidence and the two options. Do not use this uncertainty to stop the entire implementation.

## 12. Documentation Reconciliation (Mandatory)

After code changes, update the project’s existing documentation where the new behavior changes a documented contract. At a minimum audit and update as needed:

- `README.md`: supported models, generation behavior, texture presets and exports;
- `Docs/ARCHITECTURE.md`: geometry vs. centralized texture stages, adapter/registry mapping, scheduler/postprocess, storage and cancellation/persistence behavior;
- `Docs/PRD.md`: user-facing texture toggle/page/resolution contract;
- `Docs/DESIGN.md`: simplified UI and texture-stage flow diagram;
- `Docs/TASKS.md`: mark only verified work complete; preserve unrelated pending tasks;
- `Docs/DECISIONS.md`: add an ADR for geometry raw-only plus shared Paint3D/Hunyuan routing and record any superseded Shape→Paint decision precisely;
- `Docs/MEMORY.md`: concise verified bug fixes, current limitations and validation results;
- `Docs/CHANGELOG.md`: follow existing convention and keep only the last 3 entries;
- `Docs/api-documentation.md`, setup instructions, model catalogue, developer guide or model/licensing docs wherever impacted.

Do not bulk-rewrite unrelated content. Reconcile conflicting existing statements, including any claims that TRELLIS/TRELLIS.2 shape generation natively produces the app’s selected final textured output, Hunyuan Paint is automatically chained from shape adapters, or the old model-level `supports_texture` controls generation UI availability.

Re-read every touched Markdown file from bottom to top once at the end, as required by `RULES.md`, and search for stale flow diagrams and settings. Do not add a new docs file in the repository just to explain behavior when existing docs are the project convention. This deliverable (`task.md`) is for the user’s local handoff and must not be pushed by the assistant that authored it.

## 13. Git and Safety Contract

- Do not push this plan file to GitHub.
- For code implementation, do not force-push, reset, clean the tree, discard unrelated changes or rewrite shared history.
- Do not commit model weights/checkpoints or user assets.
- Work in the branch/working copy explicitly requested by the user and follow any existing project safety workflow. If a change would require a destructive schema migration, breaking endpoint change, broad dependency downgrade, or large unrequested UI deletion, stop that single risky action, record the evidence, and continue safe independent tasks.
- Prefer at most one or two coherent commits if the user’s implementation workflow calls for commits; do not create commits merely to claim progress. If the user has not authorized pushing, do not push.

## 14. Final Agent Report / Handoff Contract

At completion, the lead agent must:

1. Re-read this entire task and the relevant repository rules/docs after implementation.
2. Independently inspect the final code and each worker’s report.
3. Provide a compact but concrete change inventory with exact file paths and root causes addressed.
4. Include the test/command matrix and actual results; distinguish passing tests from skipped/hardware-blocked tests.
5. Include a final matrix in the form:

   `Requirement -> Implementation file/path -> Verification command/test -> PASS / FAIL / BLOCKED`

6. Explicitly report Paint3D compatibility in Python 3.10 / Torch 2.6 / CUDA 12.4, the tested GPU VRAM, the true atlas sizes written, and any unsupported presets.
7. Explicitly report whether original-image persistence, raw-master preservation, texture-only retry, raw/textured/ZIP export and cancellation during texturing were tested.
8. List any remaining blocker with exact cause, affected capability, implemented work, fallback, and exact user-side command to finish validation.
9. Report D1 separately if user choice remains required; do not pretend the unresolved mesh-extras decision was made.
10. Never report “all done”, “GPU verified”, “8K supported”, or “12 GB compatible” unless the corresponding evidence exists.

## 15. Authoritative Upstream References

- Paint3D official repository / usage / license: https://github.com/OpenTexture/Paint3D
- Paint3D official environment file (inspect; do not install wholesale): https://github.com/OpenTexture/Paint3D/blob/main/environment.yaml
- Hunyuan3D-2.1 official repository and texture requirements: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1
- ForMash3D repository: https://github.com/Silentzx2/ForMash3D
- Existing model/agent rules and docs in the actual checked-out `Dev` branch remain authoritative over stale online summaries. Verify current upstream code/commit, dependency requirements, model paths, output behavior and license before integration.

---

## Definition of Done

This task is done only when normal image-to-3D generation is raw-only for all supported geometry models; Paint3D runs for 1K/2K and Hunyuan Paint for 4K/8K through the same centralized texture contract from Post-Processing and Texture Studio; original reference images and selected presets survive jobs/restarts; raw source remains immutable; actual exported atlas dimensions are verified; all relevant cancel/Redis-SQLite/frontend bugs are fixed or proven already fixed with tests; existing API routes and unrelated capabilities continue to work; documentation is truthful and synchronized; and every requirement has evidence in the final PASS/FAIL/BLOCKED matrix.
