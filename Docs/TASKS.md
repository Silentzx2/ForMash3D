# Implementation Task: Integrate Pixal3D into ForMash3D

> **Execution mode:** Implement the integration in the existing repository; this file is not asking for a proposal-only response. Use multiple sub-agents when the environment supports them. Do not claim success for work that was not implemented or tested.
>
> **Target repository:** `Silentzx2/ForMash3D`  
> **Target branch:** `Dev`  
> **Upstream model:** `https://github.com/TencentARC/Pixal3D`  
> **Primary official documentation:** upstream README, inference entrypoints, dependency list, license and NOTICE.

## 1. Mission

Add Pixal3D as a first-class, maintainable **single-image 3D generation model** in ForMash3D. The task includes vendored upstream source, weights/checkpoint management, unified-environment dependencies, a dedicated adapter and model-factory connection, backend manifest/readiness wiring, frontend selection/settings/routing, raw-master preservation, tests, and accurate documentation.

This must be a real end-to-end integration, not just a display name in a selector. Follow the current ForMash3D implementation patterns wherever they are correct. Keep the diff as small as possible after understanding the full call chain.

## 2. Mandatory repository rules and preflight

1. **Read `RULES.md` first and follow it throughout.** Treat its root-cause-first, reuse-first, no-unneeded-dependencies, minimal-diff, and documentation requirements as mandatory.
2. Before editing code, read the **complete contents of every Markdown document in `Docs/`**, plus root `README.md`, `CONTRIBUTING.md`, and any relevant root or nested agent/rules files discovered in the repository. This includes, at minimum, `Docs/PRD.md`, `Docs/ARCHITECTURE.md`, `Docs/DESIGN.md`, `Docs/DECISIONS.md`, `Docs/MEMORY.md`, `Docs/SECURITY.md`, `Docs/SYSTEM-BLUEPRINT.md`, `Docs/CHANGELOG.md`, `Docs/api-documentation.md`, `Docs/PHASE_0.md`, and `Docs/TASKS.md`. Do not skim over large documents: retrieve and review them in manageable sections and build a concise internal architecture/decision map.
3. **Do not edit `Docs/TASKS.md`.** Read it for context only; the user has not authorized changes to that file. Update the other documents that are actually affected by the implementation.
4. Inspect the current `Dev` HEAD and working tree before edits. Do not assume previously remembered SHAs or file contents are still current. Protect unrelated in-progress changes; never discard user changes.
5. Inspect actual caller-to-output flows rather than assuming a model's feature based on its name. Trace registry → API/model manifest → factory → adapter → scheduler → master artifact → postprocessing → UI and readiness/download routes.
6. Do not change unrelated model defaults, existing adapters, model behavior, or UX as part of this task. Do not rewrite an entire subsystem to add one model.

## 3. Required multi-agent workflow

Use sub-agents in parallel **if sub-agent capability is available**. They must audit and report findings before the integrating agent changes shared files. If sub-agents are unavailable, execute the same workstreams sequentially and say so accurately in the final report.

Suggested workstreams:

- **Agent A — Repository architecture and rules:** Read the docs/rules and map the existing model lifecycle, raw-master contract, feature routing, and documentation obligations.
- **Agent B — Pixal3D upstream audit:** Inspect the current official default branch and exact code paths for loading, single-view inference, shape-vs-texture stages, GLB export, supported resolutions, low-VRAM behavior, dependencies, checkpoint files, license and NOTICE. Return file/line evidence; do not infer from the README alone.
- **Agent C — Installer and weights lifecycle:** Trace `backend/scripts/install.sh`, `backend/scripts/download_models.sh`, root `manager.sh`, model path conventions, weight verification/readiness, local wheel handling, Docker/setup flows, and `.gitignore`/`.dockerignore` behavior.
- **Agent D — Adapter/UI/tests:** Map `backend/adapters/`, `backend/core/scheduler/model_factory.py`, `backend/config/models.yaml`, scheduler raw-mesh defaults, `constants/models.ts`, generation parameter construction, `GeneratePanel`, model readiness UI, and current adapter regression tests.

The primary agent owns integration decisions. Sub-agents should not independently edit overlapping files or commit partial implementation. Ask them for specific findings, conflict risks, and recommended tests; consolidate the report before making changes. Do not merely run sub-agents and accept unverified claims.

## 4. Scope boundaries — do not violate these

### 4.1 Single-view only; no Multi-View connection

Integrate **only the single-image Pixal3D pipeline**. Do not connect Pixal3D to the Multi-View workspace or any existing image-to-multiview feature. Do not register `multiview: true`, do not route to `inference_mv.py`, do not download `_mv` checkpoints/configs, and do not modify `features/workspace/Panels/MultiViewWorkspace.tsx`, Zero123++ behavior, the multi-view API, or Multi-View model selection to make Pixal3D work. The upstream source checkout may contain its multiview file, but ForMash3D must never invoke or expose that path in this task.

In the weight downloader, exclude Pixal3D multi-view-only artifacts (including files matching the upstream multi-view checkpoint/config naming such as `*_mv` and `pipeline_mv.json`, after verifying the current upstream file list). Download only files actually required by the single-view integration.

### 4.2 Future Pixal3D painting/texturing adapter is out of scope

Do **not** register or expose a Pixal3D painting adapter in this task. Do not connect Pixal3D's texture-generation cascade to ForMash3D's centralized texture/post-processing stage, and do not claim that Pixal3D texture generation is already a mesh-painting adapter.

Investigate how upstream separates shape generation from texture generation. Implement the single-view geometry adapter so it uses the most appropriate supported shape-only API/stage and preserves genuine geometry. Keep the code boundaries and documentation clear so a **separate Pixal3D painting adapter can be added later** without mixing its model loading, weights, settings, routes, or UI with this generation adapter. Do not modify upstream source files to force a misleading interface; wrap or call upstream APIs from the ForMash3D adapter/helper layer.

If the upstream API unexpectedly cannot provide a true shape-only output, do not silently label a fully textured output as “raw/untextured,” do not run a duplicate texture pass, and do not fake `has_texture: false`. Exhaustively inspect supported pipeline stages first. If a truthful shape-only route is genuinely infeasible without invasive/brittle changes, preserve repository correctness and report the exact upstream blocker, affected functions, options evaluated, and smallest defensible alternative instead of claiming a completed raw-mesh integration.

### 4.3 Raw-master fidelity firewall

The user's required geometry flow is:

**Pixal3D maximum supported source-generation settings → immutable high-fidelity master artifact → optional downstream production copy/decimation.**

- The target polycount, LOD settings, “low/medium/high” production preset, retopology, texture resolution, and other downstream production budgets must not lower the geometry-generation resolution or early-simplify the source.
- Keep Pixal3D's native source geometry at the maximum supported source settings and highest faithful extraction/export path. Inspect upstream GLB conversion arguments carefully. If upstream exporter defaults use `decimation_target` or `remesh`, check whether a supported lossless/native source export is possible; do not blindly copy a default that could simplify the master. If a cap is inherent in the supported pipeline, document the concrete cap and why it cannot safely be removed.
- Store the source master through the existing canonical master-artifact flow (for example, `master/source.glb` or the current project equivalent). Downstream optimization must operate on a copy and must never overwrite the source master.
- Do not copy TRELLIS.2 settings blindly. Pixal3D has its own trained pipeline, resolution, sampler defaults, token budget, and stage-specific conditioning.
- Make the scheduler's model-specific source-quality profile explicit and testable. Remove production-only controls before passing inference arguments to the adapter, following the current scheduler contract.
- Runtime logs/metadata should report the actual Pixal3D configuration used (resolution, sampler settings, low-VRAM mode, output/source quality and relevant extractor/export settings), not merely the requested values.

## 5. Upstream Pixal3D research — required before choosing parameters

Use the live official repository and its actual current default branch. Verify whether the active branch is named `main`, `master`, or something else; do not assume. Prefer the maintained implementation, not the historical `paper` branch unless current upstream documentation explicitly requires otherwise.

Read at least:

- Official `README.md`, `inference.py`, pipeline modules/classes called by that entrypoint, any relevant configuration files, `requirements.txt`, license, `NOTICE`, and the code that exports GLB.
- How `Pixal3DImageTo3DPipeline.from_pretrained(...)` resolves model files.
- Where it loads any image-conditioning encoders, camera-estimation model, NAF upsampler or other required supporting weights.
- Exactly which pipeline stage produces shape geometry versus PBR/texturing latents/attributes, and whether the shape-only path can bypass texturing without forking upstream code.
- The active command/API parameters and their **actual defaults** for single-image generation, supported resolutions, sampler steps per stage, token budget, camera/FOV estimation, mesh conversion, texture size, remesh, decimation and seed.
- Which files are single-view required and which are multi-view-only. Do not use the Hugging Face demo requirements as the truth for this CUDA/architecture, because demo-specific dependencies can be incompatible with non-H GPUs.

Use upstream's documented max-fidelity single-view configuration as the initial default. The official single-view CLI has documented a 1536-resolution normal path and 1024 default under low-VRAM mode; verify that against the live upstream code before implementing. Do not imply that 1536 resolution will fit into the same 10–12 GB claimed for the low-VRAM 1024 path unless you actually measure it. Upstream has described low-VRAM loading as lowering peak memory by moving models between CPU/GPU at a slower inference speed; validate current details in code/docs.

Do not increase step counts beyond official supported quality settings just because other ForMash3D models use more steps. Only use parameter values that Pixal3D's own pipeline supports. Record the exact defaults and the rationale in the model-specific parameter schema/tests/docs.

## 6. Vendored source layout and upstream integrity

- Add the official Pixal3D source to the existing third-party vendor area: expected convention is `backend/thirdparty/Pixal3D/`. Verify the repo's existing layout and naming before finalizing.
- Clone the official Pixal3D repository at the verified maintained branch/commit. Record the upstream commit SHA in a small provenance file or the relevant documentation so the integration is reproducible.
- After cloning, **remove the nested `.git` metadata** from the vendored checkout (`.git` may be a directory or file; inspect before removal). Ensure Pixal3D is a normal tracked source directory, not a nested repository or accidental submodule. Do not remove upstream source files, license, NOTICE, or required attribution.
- Respect ForMash3D's convention that upstream source files are not edited. If an upstream defect or compatibility workaround is required, implement it in the ForMash3D adapter/helper/installer layer and document why.
- Keep large weights, caches, downloaded archives and generated artifacts out of the source tree and Git. Use the repository's established pretrained/weights location and update `.gitignore` / `.dockerignore` only when required and verified.
- Check the Pixal3D license and NOTICE and all new dependencies' licenses. Preserve third-party attribution and do not imply Pixal3D or its weights are licensed identically to ForMash3D. Report any checkpoint/model-card access or license restrictions accurately.

## 7. Weight download manager and readiness

Integrate Pixal3D into the **existing** model download lifecycle; do not create a parallel download manager unless the current architecture demonstrably cannot support the feature.

Inspect and update as needed:

- `backend/scripts/download_models.sh`
- root `manager.sh` (menu/help/model aliases/parity)
- model-weight readiness logic and API payloads in `backend/api/routers/system.py` and their frontend types/consumers
- the authoritative model path in `backend/config/models.yaml`
- ignore rules and any install/container documentation.

Requirements:

1. Add a clear CLI model key (for example `pixal3d`; use the naming convention discovered in the existing script), help text, list output and `all` integration, unless there is a documented reason to keep it optional. Make single-model download, verify-only, force-download and failure reporting consistent with existing behavior.
2. Verify actual required Pixal3D files before reporting ready. A partial directory, config-only cache, unrelated checkpoint, or empty file must not pass readiness. Use a model-specific file manifest / meaningful minimum required files as needed, consistent with the existing readiness mechanism.
3. Include supporting single-view weights only when required by the selected shape-only execution path. Audit whether camera-estimation, DINOv3 conditioning and NAF files are downloaded locally or implicitly fetched by model initialization. Generation should use the known local/cache roots deterministically; do not unexpectedly download huge weights in a GPU job after the UI already said the model was ready.
4. Use the repository's current Hugging Face download tool/path and token/error-handling patterns. Verify exact filter/ignore syntax against the installed CLI/library version; do not guess argument syntax.
5. Never download Pixal3D Multi-View checkpoints/configs for this feature. Make source-weight and optional future painting-weight separation explicit in code/docs.
6. On download failure, exit non-zero with actionable errors and do not print a success banner. Preserve the project's existing false-success safeguards. Handle interrupted and repeated downloads idempotently, verify artifacts after download, and avoid destructive deletion of a valid cache on a failed forced download.
7. Report exact disk requirements only if verifiable. Do not fabricate the total checkpoint size.

## 8. Unified dependency installation

Integrate compatible required dependencies into the existing installer, especially `backend/scripts/install.sh`, **in the existing unified environment**. Do not create a second Python environment just for Pixal3D unless the audit proves an unavoidable dependency conflict and documents why isolation is the only stable solution.

- Read the Pixal3D `requirements.txt` and installation docs line by line and compare against `backend/requirements.txt`, TRELLIS.2's installed stack, local wheel flow, pinned PyTorch/CUDA and currently installed packages.
- Add only missing compatible requirements, with pins where native/CUDA compatibility needs them. Do not blindly `pip install -r` an upstream requirements file on top of the shared environment if it would downgrade/replace PyTorch, CUDA-dependent packages, NumPy, transformers, `natten`, attention implementations, or other shared libraries.
- The upstream docs have mentioned `natten==0.21.0`, a specific `utils3d` wheel, native/CUDA architecture build concerns, and an `ATTN_BACKEND=sdpa` alternative when FlashAttention is unavailable. Verify each against current upstream code and the repo's CUDA/PyTorch versions before changing anything.
- Reuse `uv pip`, local compatible wheel preference, build isolation settings and retry/error conventions already present in `backend/scripts/install.sh`. Keep environment resolution consistent with `scripts/setup.sh` and Docker/RunPod installations.
- Add a clearly separated Pixal3D dependency section at the correct point in install order after shared base dependencies. Do not silently swallow required dependency failures. Test installer branch/flags with mocks or a safe test harness; do not run a destructive full CUDA/system package installation just to test the script.
- Only expose environment overrides such as `ATTN_BACKEND=sdpa` when the upstream code supports them; avoid global environment changes that alter other adapters.

## 9. Backend adapter and registry integration

Follow the simplest correct existing adapter pattern. Likely touchpoints include:

- `backend/adapters/` — dedicated Pixal3D adapter/helper using lazy imports for the heavy GPU-specific modules.
- `backend/core/scheduler/model_factory.py` — register the canonical model ID and adapter class using the current factory convention.
- `backend/config/models.yaml` — canonical feature, model path, VRAM estimate, supported inputs/outputs, readiness metadata and truthful capabilities.
- `backend/core/scheduler/multiprocess_scheduler.py` — add model-specific max-fidelity source defaults only after validating the supported upstream parameters; preserve scheduler stripping of target polycount and production controls.
- current model base classes, path helpers, artifact naming, logging, exception handling, unload behavior, cancellation and worker lifecycle.

Implementation requirements:

1. The adapter accepts one input image (not a `transforms.json` or view directory), applies current standard preprocessing conventions only when compatible with Pixal3D, and returns the correct geometry artifact metadata.
2. Use canonical repo-relative paths for vendored source and weights. Do not rely on process CWD, absolute personal paths, or an implicit Hugging Face network lookup.
3. Do not import Pixal3D, CUDA extension modules, DINOv3, MoGe, or heavy native components at module import time. Adapter listing, API startup, model discovery, readiness checks and basic tests must continue to work without a GPU and without optional model dependencies installed.
4. Load the model lazily inside the worker's `load()` path; implement clean unload/release paths consistent with current adapters. Handle missing source, missing weights, CUDA unavailable, unsupported GPU architecture, dependency/import failure, and inference failure with actionable messages. Do not falsely convert model-load failure into a placeholder mesh.
5. Ensure output paths, mesh coordinate/rotation convention, GLB export, normals/faces and transforms are compatible with the existing canonical artifact/postprocess pipeline. Avoid arbitrary lossy remesh/decimation before the master artifact is persisted.
6. Expose the correct model ID consistently in registry, manifest, factory, logs, download manager and tests. Do not add unnecessary aliases unless the existing routing pattern requires them.
7. Explicitly declare single-image capability and `multiview: false`. Declare texture capability based on the implemented path, not on Pixal3D's name or potential future adapter.
8. If the existing API's `image_to_raw_mesh` route selects adapters based on manifest capabilities, connect the new model to that same path. Do not build a parallel request route for one adapter unless existing architecture requires it.

## 10. Low-VRAM and max-quality behavior

Provide both modes if the upstream code supports them; make the trade-off explicit and testable.

- **Default / Max Quality:** select Pixal3D's highest supported single-view resolution/path (verify the upstream default, expected to be the 1536 cascade), normal non-offloaded inference unless the official implementation establishes a better supported default. Use official max-fidelity sampler settings and output/export settings for the model's geometry path. Do not let the UI's target polycount reduce source generation quality.
- **Low VRAM:** expose an explicit per-model low-VRAM option only if it can be passed through the current settings mechanism cleanly. Use the official model-staging/CPU-offload approach. The upstream default may pick 1024 when low-VRAM is true; **do not silently downshift resolution** when the user explicitly selected max quality or 1536. If the user requests low-VRAM and 1536 together, pass that requested combination only if upstream supports it, report/handle memory failure clearly, and do not silently retry at 1024. Show/help-text the speed and memory trade-off in the UI.
- Defaults must be model-specific and distinct from TRELLIS.2. Do not let shared `quality`, `target_polycount`, `auto_optimize`, `low_vram_mode`, `low_vram`, or stale parameter defaults override Pixal3D's verified settings accidentally.
- Ensure inference options are whitelisted/validated. Never pass UI-only downstream controls (target polycount, LOD, texture-resolution preset, paint preferences) into the geometry model unless the upstream inference API explicitly supports them.
- Add tests proving (a) default resolution remains max-quality, (b) explicit low-VRAM mode is passed through, (c) low-VRAM does not implicitly change an explicit max-resolution request, and (d) target polycount and production quality selectors do not modify Pixal3D source-generation settings.

## 11. Frontend model selection and control wiring

Follow the current design system and avoid a Pixal3D-specific UI silo. Inspect existing patterns before editing. Relevant files likely include:

- `constants/models.ts` — canonical user-selectable model registry/feature routing.
- `features/workspace/utils/buildGenerationParameters.ts` — per-model parameter defaults and request payload construction.
- `features/workspace/Panels/GeneratePanel.tsx` — model selection, readiness feedback and settings controls.
- `features/admin/tabs/ModelsTab.tsx` and existing model-status/download UI where applicable.
- `types/api.ts`, client/API type definitions and other consumers of readiness/model capabilities.

Requirements:

1. Add Pixal3D to the correct single-image geometry-generation category and normal model picker. Show the correct display name, concise truthful description, supported input/output formats, estimated VRAM and explicit low-VRAM availability based on source evidence.
2. Make backend `models.yaml`, model factory/API availability, frontend model registry, settings builder, admin model inventory/readiness and download manager agree on the same canonical ID. Avoid hardcoded duplicates where existing metadata-driven wiring is available.
3. Include a Pixal3D-specific low-VRAM control only if the current settings architecture supports per-model flags; keep it separate from generic global settings. Make the default max-quality mode clear, and explain that low-VRAM can be slower and may use a lower default resolution unless a resolution is explicitly selected.
4. Do not show controls for multiview, extra views or view-count on the Pixal3D single-image selection. Do not add it to `MultiViewWorkspace` or display it as an image-to-multiview model.
5. Do not expose a Pixal3D painting/texturing adapter in the UI now. Do not route Pixal3D into a paint-autochain or centralized texture stage. Keep the future painting adapter out of the current model list and document that it is intentionally deferred.
6. When weights are absent, show the same accurate model-readiness/download guidance the existing UI uses. Avoid saying the model is ready just because the vendor source code was cloned.
7. Use existing Studio Gold design tokens/components from `Docs/DESIGN.md`; do not add hardcoded colors or unrelated UI redesign.

## 12. Tests and verification matrix

Add focused regression tests that do not require downloading real weights or a physical GPU. Use dependency/module monkeypatching consistent with existing tests, and run integration smoke tests only when the environment makes them feasible.

At minimum cover:

### Source/factory/manifest
- Adapter imports without importing heavy Pixal3D/CUDA dependencies.
- Factory resolves the canonical Pixal3D model ID to the correct class.
- Manifest paths and declared single-view capabilities are correct.
- Missing third-party source, missing/partial weights and missing required dependencies produce clear readiness/load failure, not false readiness or placeholder geometry.

### Downloader/installer
- Pixal3D is discoverable by downloader `--list`/help and can be selected individually and by the `all`/bundle path as appropriate.
- Verify-only returns correct state for valid, partial and missing weights; multi-view-only weights do not count toward ready state.
- Network/HF failure exits non-zero and never emits a false success message.
- Shell syntax checks pass (`bash -n`) and safe mocked/unit tests cover the new branches. Confirm repeated download is idempotent and force-download does not destroy a valid cache on failure.
- Install script includes only the intended unified-environment dependencies and does not unexpectedly downgrade/replace pinned shared libraries.

### Inference/fidelity/outputs
- Mocked call verifies exact supported Pixal3D parameters and 1536 max-quality default (or the live upstream default after verification).
- Low-VRAM and explicit resolution behavior is preserved exactly.
- The raw geometry path does not call the future painting adapter or centralized texture stage; metadata accurately reports whether output contains texture.
- Output path and GLB/artifact metadata match current pipeline expectations.
- Target polycount and LOD/production settings cannot reach inference or change source settings.
- The source master is persisted before downstream postprocessing and is not overwritten by decimation/retopology/texture stages.

### UI/API/parity
- Frontend TypeScript/tests/build pass for model selector, capabilities and parameter building.
- Model status/readiness is consistent from backend manifest through the UI.
- Pixal3D remains absent from all Multi-View routing/selection code paths.
- Add or extend parity tests so the backend manifest, model factory, frontend registry and downloader agree on IDs and intended capabilities.

Run the most relevant existing suite as well, including at minimum relevant subsets of `backend/tests/test_adapter_imports.py`, `backend/tests/test_generation_adapter_regressions.py`, `backend/tests/test_model_readiness.py`, `backend/tests/test_official_model_parity_contract.py`, and any relevant frontend/unit tests. Run shell syntax checks, Python lint/type checks, frontend lint/type/build checks available in the repo. Do not claim a suite passed unless the command actually ran and returned success. Clearly separate tests run, skipped and blocked by missing CUDA/weights/system dependencies.

## 13. Documentation obligations

After implementation, update only documents that are now affected and keep them consistent with the real code. At minimum review whether updates are necessary for:

- `README.md` — model inventory, supported workflow, low-VRAM/max-quality caveat and install/download usage.
- `Docs/ARCHITECTURE.md` and `Docs/SYSTEM-BLUEPRINT.md` — model adapter/data/weight flow and the shape-vs-future-painting separation.
- `Docs/DECISIONS.md` — add a concise decision record only if a non-obvious architecture decision needs a durable rationale.
- `Docs/MEMORY.md` and `Docs/CHANGELOG.md` — record the actual completed change and verified behavior using project conventions; keep changelog format/length policy from `RULES.md`.
- `Docs/api-documentation.md` — only if public request/response behavior, model capabilities or readiness payloads change.
- upstream provenance/license/NOTICE details if the repository's convention requires them.

**Do not update `Docs/TASKS.md`.** Do not say the painting adapter is implemented; it is intentionally future work. Do not document unverified VRAM requirements, speed claims, quality gains, or runtime tests as facts.

## 14. Final acceptance criteria

Do not mark the integration complete until all applicable criteria below are satisfied:

- [ ] Pixal3D source is vendored under the repository's third-party convention, its nested `.git` is gone, upstream provenance/license/NOTICE are retained, and no checkpoints/cache artifacts are committed.
- [ ] Single-view required model/support weights can be downloaded, verified, listed and managed from the existing download manager; no Multi-View weights are fetched.
- [ ] Required Pixal3D dependencies are installed using the current unified environment without unreviewed global dependency downgrades.
- [ ] Dedicated single-view adapter is connected through factory, model manifest, readiness, API and scheduler.
- [ ] Model appears in the appropriate frontend selector/status surface, and explicit low-VRAM/max-quality controls behave as designed.
- [ ] The future painting/texturing adapter is not registered or connected; no Multi-View path is modified.
- [ ] The source-master fidelity firewall is preserved; production target polycount and texture/LOD controls do not lower or overwrite source geometry.
- [ ] Tests exercise the model's registry, weights readiness, parameter contract, output behavior and non-Multi-View boundary.
- [ ] All relevant documentation except `Docs/TASKS.md` is accurately updated where needed.
- [ ] Final branch diff has been reviewed for unrelated changes, vendored `.git`, large weights, accidental multiview wiring, silent fallbacks, and undocumented dependencies.

If remote write access is available and the normal workflow expects publication, use a new commit on `Dev` only after reviewing the diff and tests. Fetch the latest branch head immediately before publishing; use a non-force update and protect against concurrent branch movement. Never force-push. If publishing is not available or is not authorized, leave the working tree ready and report that limitation plainly.

## 15. Required final report from the implementing agent

Return a concise but evidence-based report with:

1. **What was implemented** and the canonical Pixal3D model ID.
2. **Important source findings:** whether a true shape-only path exists; exactly how its source master is preserved; upstream commit SHA; the selected max-resolution defaults and actual low-VRAM trade-off.
3. **Files changed** grouped by source vendor, dependencies/installer, downloader/readiness, backend adapter/manifest/scheduler, frontend/UI, tests and docs.
4. **Weight handling:** single-view files fetched, Multi-View files explicitly excluded, readiness checks and approximate disk footprint only if verified.
5. **Verification:** exact commands run and pass/fail/skip results. Explicitly state if real GPU/weight inference was not run.
6. **Known limitations/blockers** with evidence. Do not hide incomplete work or call a partial integration fully complete.
7. **Git status:** commit SHA and branch head if published; otherwise explain why it was not pushed.

**Success means the full single-view integration works end-to-end and respects the boundaries above. A registry entry or a download script alone is not completion.**
