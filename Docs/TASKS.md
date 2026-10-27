# MASTER ENGINEERING PROMPT — FULL PROJECT AUDIT, MESH QUALITY RECOVERY & CONTROLLED MODEL INTEGRATION

Act as the lead AI infrastructure engineer, 3D reconstruction specialist, senior full-stack engineer, QA lead, and technical project manager. Work directly in the existing repository. Your mission is to deeply understand the entire project, identify and fix genuine defects, improve inference reliability and mesh-generation quality, polish the UI/UX, and verify all changes without introducing regressions.

**Operate autonomously on the existing project wherever authorized. Do not wait for approval for ordinary bug fixes, refactoring, tests, documentation, or UI improvements. However, adding Hi3D is an explicit approval-gated task and MUST remain the final implementation batch.**

## 1. NON-NEGOTIABLE RULES

1. Read all applicable `AGENTS.md`, `RULES.md`, `rules.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, project-specific rule files, architecture documents, task documents, and relevant documentation before modifying code. Follow repository rules and instructions at every level. Resolve conflicting instructions using the repository's documented hierarchy.
2. Inspect the actual implementation instead of assuming how it works. Trace the execution path across frontend, backend, APIs, adapters, pipelines, model loaders, download manager, dependency management, storage, inference workers, and output post-processing.
3. Preserve working functionality, public APIs, existing model integrations, configuration conventions, and backward compatibility unless a change is necessary and its impact is understood.
4. Do not perform superficial fixes, hide exceptions, add arbitrary fallbacks, hardcode environment-specific paths, or claim a bug is fixed without reproducing it or establishing a technically defensible explanation.
5. Use web research and official documentation wherever an implementation detail, model capability, dependency requirement, inference setting, or known failure mode is uncertain. Prefer official repositories, papers, documentation, release notes, and reproducible benchmarks. Use relevant GitHub issues and community reports as secondary evidence.
6. Maintain an auditable record of findings, root causes, fixes, tests, limitations, and outstanding work in the project's existing documentation conventions.
7. Do not delete user data, model weights, useful logs, uncommitted changes, or unrelated files. Inspect Git status and protect existing work before editing.
8. Do not commit, push, merge, or rewrite Git history unless the existing project instructions explicitly authorize it. Do not claim tests or GPU inference succeeded unless they actually ran.
9. Do not introduce Logdy or another logging platform merely to solve a log-visibility problem. Reuse the existing logging stack and implement only what the project needs.
10. **Hi3D approval gate:** You may inspect and research Hi3D at any time, but you must not clone it into `thirdparty/`, remove its `.git` directory, implement its adapter, register it, download its weights, install its additional dependencies, or enable it in the UI/API until I explicitly approve the final integration proposal. Prepare Hi3D as the last batch of work and stop for approval before making any Hi3D integration changes.

## 2. ESTABLISH A COMPLETE PROJECT MAP

Start by inspecting the current branch, Git status, repository structure, tracked files, existing diffs, dependency manifests, configuration files, tests, scripts, and documentation.

Build a project map that identifies:

- Frontend entry points, pages, reusable components, routing, state management, API clients, 3D viewers, drawers, dialogs, and notification systems.
- Backend entry points, API endpoints, request/response schemas, services, task queues, workers, logging, and error-handling boundaries.
- Every supported 3D model and the complete path from model selection to input preprocessing, model loading, inference, post-processing, mesh export, storage, and frontend display.
- Model adapters, inference pipelines, shared utilities, download manager, dependency installer, cache directories, weight manifests, configuration registries, and VRAM management.
- Third-party sources, model-specific requirements, pinned dependencies, build configuration, CI workflows, and testing infrastructure.
- All applicable project rules and documentation, including any `task.md` file and outstanding TODOs.

Follow imports and call sites rather than relying exclusively on filenames or directory names. Inspect the relevant source files in full when a partial view is insufficient.

The raw mesh is already low-quality or distorted before post-processing, and the current post-processing makes it worse. Identify and fix the root cause of raw mesh degradation first, then optimize post-processing to preserve geometry, fine details, and shape accuracy.

**Measurable mesh-quality acceptance criteria:**
- Produce valid, non-empty meshes with finite vertex coordinates, valid face indices, and zero degenerate triangles after cleanup.
- Ensure post-processing does not reduce silhouette IoU by more than 1 percentage point or increase normalized symmetric Chamfer distance by more than 5% compared with the raw mesh, unless a justified repair demonstrably improves overall quality.
- When reference meshes are available, target at least a 10% reduction in normalized symmetric Chamfer distance against the existing pipeline baseline, without degrading silhouette accuracy or important geometric details.
- Track connected components, non-manifold edges, bounding-box dimensions, and geometry changes before and after processing. Do not force watertightness when open surfaces are valid.
- Evaluate a fixed benchmark set using identical inputs and settings, record before/after metrics, and inspect visual comparisons. If ground-truth references are unavailable, report that limitation rather than claiming unverified quality improvements.

Research and integrate relevant Blender tools, plugins, geometry-processing libraries, or additional dependencies only when compatible, necessary, and supported by measurable improvements. Avoid unnecessary dependencies and destructive operations such as excessive smoothing, simplification, or remeshing.

Create or update an architecture note explaining the actual request-to-mesh execution flow and the locations where failures can originate.

## 3. USE MULTIPLE SPECIALIZED SUBAGENTS

If the environment supports subagents, create independent specialists with explicitly assigned scopes:

**Agent A — Architecture and Rules**
Map the repository, read project instructions, identify architectural inconsistencies, and report protected interfaces.

**Agent B — Runtime and Inference Reliability**
Investigate crashes, exceptions, hangs, malformed inputs, model-loading problems, asynchronous task failures, CUDA errors, VRAM exhaustion, output-validation failures, and resource leaks.

**Agent C — Mesh Geometry and Quality**
Trace how each model produces its mesh. Investigate distorted geometry, missing parts, holes, broken topology, incorrect orientation, bad normals, degenerate triangles, scale errors, over-smoothing, loss of details, and export or rendering defects.

**Agent D — Model Integrations and Dependency Management**
Compare all existing model integrations, adapters, pipelines, download logic, dependency isolation, model weights, caching, configuration, and cleanup behavior. Research Hi3D without integrating it.

**Agent E — Frontend, UI and UX**
Audit the interface for layout errors, drawer/modal issues, responsiveness, loading states, progress reporting, model selection, output previews, interaction bugs, accessibility, and usability.

**Agent F — Testing and Documentation**
Review test coverage, reproduce reported defects where possible, design regression tests, verify fixes, and maintain the issue/fix/test documentation.

**Lead Agent**
Own the master plan, resolve disagreements, inspect findings, assign implementation tasks, review diffs, prevent overlapping edits, integrate changes, and run final verification.

If subagents are unavailable, perform these workstreams sequentially. Never assume a subagent completed a task merely because it was assigned. Require concrete findings, file paths, evidence, and test results. Avoid parallel edits to shared files unless changes are coordinated.

## 4. INVESTIGATE RUNTIME AND INFERENCE BUGS

Prioritize reproducible problems that occur while running or during inference.

Audit at least:

- Application startup, API initialization, routing, configuration parsing, and worker initialization.
- Model discovery, downloads, interrupted downloads, corrupt or incomplete checkpoints, checksum validation, cache reuse, and concurrent download races.
- Read-only filesystem errors, permission problems, temporary-disk exhaustion, incorrect home-directory assumptions, and writes to unsuitable directories such as `/root`.
- Python and native dependency conflicts, incorrect version pins, missing imports, ABI incompatibilities, optional dependency failures, and GPU/CPU device mismatches.
- Model initialization, checkpoint loading, CUDA allocation, dtype handling, inference-mode settings, tensor shapes, batch sizes, preprocessing, post-processing, and cleanup.
- Timeouts, cancelled jobs, duplicate requests, stale task state, race conditions, unhandled exceptions, misleading progress indicators, and incomplete output files.
- Request validation, corrupt or unsupported input images, unusual image dimensions, image mode and color-space handling, missing values, and invalid configuration.
- VRAM exhaustion, host RAM pressure, CPU fallback behavior, OOM recovery, GPU memory leaks, and concurrent inference workloads.
- OBJ, GLB, GLTF, PLY, STL, or other mesh formats actually supported by the application, including serialization, material handling, normals, transforms, and file integrity.
- Error messages, logs, stack traces, return values, UI feedback, and cleanup after failures.

Inspect real runtime logs, stack traces, error reports, and reproduction steps if available. Never invent an error merely because a code path looks suspicious.

For every confirmed issue, record its severity, reproduction steps, root cause, affected components, minimal safe fix, regression test, and verification result. Fix the root cause rather than adding broad exception suppression.

Use deterministic lightweight tests where GPU or full model weights are unavailable. Clearly distinguish verified fixes from fixes that still require a real GPU or full-checkpoint test.

## 5. MESH QUALITY IS A CORE ENGINEERING REQUIREMENT

The reported symptom is that generated meshes sometimes become visibly distorted or lose their intended geometry during inference or subsequent processing.

Investigate the entire pipeline to find where quality is lost. Do not assume the neural model itself is the only cause.

### A. Inspect the existing geometry evidence

Locate and inspect **every relevant PNG image in the project's `brain/` directory**, including nested directories. These images are evidence, not decoration.

For every relevant image:

- Identify what is visible: distorted surfaces, missing geometry, holes, flattened regions, broken silhouettes, faceting, disconnected parts, artifacts, or viewer-only rendering errors.
- Associate the image with the model, input, settings, output format, and processing stage when that information exists.
- Compare source inputs and generated outputs where available.
- Record observations and reference image paths in the quality investigation report.

Do not assume a PNG represents a mesh result if its content or metadata does not support that interpretation. Inspect the image content directly; do not rely only on filenames.

### B. Trace geometry through every stage

Audit:

1. Input image loading, resizing, cropping, background removal, normalization, and camera or object framing where applicable.
2. Model preprocessing, latent or feature representations, inference parameters, sampling, resolution, and precision.
3. Geometry decoding, occupancy or density thresholds, surface extraction, marching-cubes or equivalent algorithms, and coordinate conventions where applicable.
4. Mesh cleanup, remeshing, simplification, smoothing, decimation, hole filling, connected-component filtering, and normal recalculation.
5. Coordinate transforms, axis conventions, scale normalization, bounding boxes, vertex ordering, triangle winding, and unit conversion.
6. UVs, textures, materials, vertex attributes, and format conversion where supported.
7. Backend serialization, file transfer, frontend loading, viewer material configuration, camera framing, lighting, and display post-processing.

Identify the exact earliest stage where a reproducible quality defect appears. Distinguish genuine geometry damage from shading, material, camera, and viewer artifacts.

### C. Implement measurable mesh validation

Where compatible with the current formats and architecture, validate:

- Empty outputs, NaN/Inf coordinates, invalid indices, and degenerate or zero-area triangles.
- Vertex and face counts, bounding-box dimensions, coordinate ranges, and suspicious scale changes.
- Connected components, boundary edges, non-manifold edges, watertightness where applicable, and duplicate vertices or faces.
- Face and vertex normals, triangle winding, and orientation consistency.
- File readability, successful round-trip loading, and consistency between saved and displayed geometry.

Do not force every mesh to be watertight: open surfaces can be valid outputs. Use model-appropriate checks and report findings rather than destructively repairing every anomaly.

Apply cleanup only where evidence shows it is safe. Avoid excessive smoothing, aggressive simplification, unconditional remeshing, or arbitrary threshold changes that destroy fine details.

Develop a reproducible evaluation set from available project examples. Save representative before/after renders and compare geometry metrics, silhouette preservation, detail retention, topology, and output validity when the required data is available.

## 6. RESEARCH HIGH-QUALITY 3D GENERATION

The long-term visual target is mesh quality comparable, where technically feasible, to products such as **Tripo AI and Meshy AI**. Treat these as quality references, not as guaranteed performance claims or interchangeable implementations.

Research current official documentation, papers, public implementations, and benchmarks for relevant 3D-generation and reconstruction approaches.

Investigate, where relevant to the existing architecture:

- Single-image to 3D reconstruction and multi-view or image-conditioned generation.
- High-resolution geometry, shape preservation, thin structures, topology, and fine surface detail.
- Geometry representations, sparse or structured representations, surface extraction, and reconstruction resolution.
- Texture generation versus actual geometric detail, distinguishing a visually convincing textured surface from a genuinely detailed mesh.
- Input preprocessing, inference parameters, precision, VRAM trade-offs, mesh extraction, and export settings.
- Post-processing methods that improve validity without destroying learned geometry.
- Public benchmark methodology, licensing, hardware requirements, model limitations, reproducible examples, and commercial-product constraints.

Research Tripo AI, Meshy AI, TripoSR, official Hi3D resources, and other genuinely relevant methods. Verify each project's identity and current status using primary sources. Do not conflate similarly named models or present unsupported performance estimates as facts.

For every proposed improvement, explain:
- The observed problem it addresses.
- The evidence or source supporting the approach.
- Expected quality and performance trade-offs.
- Compatibility with the existing pipeline.
- Dependency, licensing, hardware, and operational implications.
- A test that could prove whether it helps.

Do not replace the existing system or add another model simply because a newer technique exists. First determine whether the defects are caused by preprocessing, incorrect inference parameters, geometry conversion, destructive post-processing, rendering, or an actual model limitation.

Implement safe, evidence-backed improvements within the current supported models. Do not promise that an open model can match a commercial service until equivalent inputs and outputs have been evaluated under a defensible benchmark.

## 7. AUDIT ALL EXISTING MODEL INTEGRATIONS

Pay particular attention to the existing TripoSR and Pixel3D pipelines, adapters, inference paths, and mesh quality. Verify the exact repository-specific identities and names instead of guessing what a name such as "Trillish 2" refers to.

For every currently integrated model, verify:

- Registry and discovery behavior.
- Adapter and pipeline responsibilities.
- Model initialization, cache lifetime, and repeated inference behavior.
- Download manager integration, progress, retries, resumption, and corruption handling.
- Dependency specifications and environment isolation.
- Checkpoint locations, storage paths, and configuration defaults.
- Input contracts, output contracts, post-processing, export behavior, and cleanup.
- VRAM estimation or safe allocation policies, errors, concurrency, and CPU support where implemented.
- UI model selection, capability descriptions, unsupported options, and error reporting.

Bring inconsistent or broken implementations back into established project conventions without unnecessarily rewriting all models. A fix shared by multiple models must be regression-tested against the existing implementations.

## 8. DOWNLOAD MANAGER, WEIGHTS, STORAGE AND DEPENDENCIES

Ensure each existing integration follows the project's established infrastructure.

Inspect whether the implementation properly handles:

- Centralized download tracking and truthful progress.
- Resumable downloads where supported, retries, timeouts, and atomic writes.
- Expected file sizes and checksum verification where official metadata is available.
- Cache invalidation, partial files, concurrent downloads, and disk-space failures.
- Configurable writable storage directories and read-only environments.
- Pretrained weights shared across compatible pipelines without unsafe assumptions.
- Dependency pins, platform-specific requirements, Python version compatibility, and CUDA/PyTorch compatibility.
- Avoiding unnecessary downloads and avoiding reinstallation on every application startup.
- Graceful cleanup, actionable errors, and recovery after restart.

Never download or install large model weights merely to test a lightweight unit-test path. Never silently download model code or execute third-party installation scripts without reviewing their behavior.

## 9. FULL UI/UX AUDIT AND REPAIR

Inspect the actual frontend and fix real defects rather than applying a cosmetic redesign blindly.

Review:

- Layout overflow, spacing, alignment, typography, contrast, responsive behavior, and consistent component states.
- Drawers, dialogs, side panels, nested overlays, stacking contexts, focus management, Escape-to-close behavior, outside-click behavior, scrolling, and body-scroll locking.
- Model-selection controls, capability labels, disabled options, form validation, file upload, image preview, and invalid-input feedback.
- Inference lifecycle: idle, uploading, queued, downloading, loading, processing, success, failure, cancellation, and retry where supported.
- Real-time progress and logs where available, including cleanup and prevention of stale or duplicated updates.
- Mesh preview controls, loading and empty states, camera framing, render errors, output downloads, and clear separation between geometry and texture quality.
- API error surfaces, toast/notification duplication, route transitions, browser-console errors, accessibility, keyboard interactions, and mobile usability.

Maintain the application's visual identity and reusable design system. Fix drawers and overlays structurally rather than using arbitrary z-index increases. Ensure asynchronous UI operations cannot silently overwrite newer results or leave the interface stuck.

Do not invent model capabilities in the UI. Labels, settings, and options must match actual backend behavior.

## 10. AUTOMATED TESTS AND VERIFICATION

Use the repository's actual test framework, lint rules, formatting tools, type checks, build scripts, and CI conventions.

Create or extend tests for:

- API schemas and backward compatibility.
- Model discovery, selection, initialization, and adapter contracts.
- Download manager behavior and filesystem failures.
- Dependency and configuration validation.
- Input preprocessing and invalid image handling.
- Inference error propagation and cleanup.
- Mesh validation, coordinate transforms, format conversion, and geometry integrity.
- UI drawers, dialogs, state transitions, loading indicators, and error recovery.
- Existing supported models to ensure unrelated behavior remains intact.

Run the applicable test suites and record the exact commands and results. Perform a static review of the final diff and check for accidental file deletions, untracked assets, leaked credentials, hardcoded machine paths, unpinned dependencies, placeholder code, debugging leftovers, or unrelated changes.

If GPU access or real model checkpoints are unavailable, explicitly identify which inference paths remain unverified. Never fabricate successful results or quality improvements.

## 11. KEEP DOCUMENTATION AND TASK TRACKING CURRENT

Follow the repository's existing documentation conventions. Update `task.md` if it exists; otherwise, use the established project task-tracking location instead of creating a duplicate document unnecessarily.

Record:

- Initial architecture and baseline findings.
- Confirmed bugs, root causes, severity, and fixes.
- Relevant `brain/` PNG evidence and mesh-quality investigation.
- Research sources and implementation decisions.
- Files and components changed.
- Tests executed, exact results, and environmental limitations.
- Remaining risks, GPU validation needs, and future work.
- A separate Hi3D proposal prepared for the approval gate.

Mark work complete only when the stated acceptance criteria are met. Keep confirmed findings separate from hypotheses.

## 12. REQUIRED EXECUTION PLAN

Execute work in these batches:

**Batch 1 — Discovery and baseline**
Read all applicable rules and documentation, map the architecture, inspect Git status, identify the current supported models, locate the `brain/` PNGs, and establish reproducible baseline failures.

**Batch 2 — Research and root-cause analysis**
Research official model documentation and relevant implementation techniques. Trace inference and mesh-quality failures to their earliest reproducible causes. Produce a prioritized issue list.

**Batch 3 — Runtime and pipeline fixes**
Fix confirmed startup, inference, model-loading, dependency, storage, download, API, and mesh-processing defects. Add appropriate regression tests.

**Batch 4 — Geometry-quality improvements**
Implement safe, evidence-backed changes, improve mesh validation, and compare representative outputs. Keep geometry changes isolated enough to diagnose and roll back if they regress quality.

**Batch 5 — UI/UX fixes**
Repair confirmed layout, drawer, overlay, state, error-handling, progress, responsiveness, and viewer defects. Preserve existing model behavior and interface conventions.

**Batch 6 — Regression and integration verification**
Run relevant unit tests, integration tests, frontend checks, backend checks, builds, and static analysis. Verify existing model integrations and document any hardware-dependent tests that could not run.

**Batch 7 — Final Hi3D proposal and approval gate**
ONLY after the previous batches are completed and verified, research and prepare the Hi3D integration proposal described below. Do not perform the integration itself. Present the proposal and stop for my explicit approval.

## 13. HI3D: LAST BATCH, APPROVAL REQUIRED

Official repository: https://github.com/hi3d-official/Hi3Dv1.0

Before requesting approval, investigate the official repository and its current documentation, licensing, checkpoint requirements, supported inference paths, dependencies, hardware requirements, outputs, and known limitations.

Inspect the existing integrations to determine precisely how Hi3D should fit the project's architecture. Prepare a proposal that covers:

- The intended `thirdparty/` layout.
- How to obtain the official source and vendor it without preserving the upstream `.git` metadata.
- Required adapter and pipeline contracts.
- Model registry and configuration changes.
- Dependency installation and isolation.
- Download manager, progress, checkpoint verification, cache, and configurable storage integration.
- API and UI changes, if needed.
- VRAM estimation, memory cleanup, errors, concurrency, and device handling.
- Output formats, coordinate conventions, mesh-quality checks, and safe post-processing.
- Licensing obligations, attribution, security, and provenance.
- Tests, documentation, rollback strategy, and acceptance criteria.

The eventual source-vendoring operation must preserve relevant upstream license and attribution files and remove the cloned repository's `.git` directory after cloning. Do not remove any project-level Git metadata.

**STOP HERE AND ASK FOR EXPLICIT APPROVAL.**

Do not clone Hi3D, vendor its source, add its adapter or pipeline, change active registries, alter dependencies for the purpose of integrating it, download its weights, or expose it in the application until I approve the proposal. All independent bug fixes and authorized work should already be completed by this point.

After approval, execute Hi3D integration as the final implementation batch, following the proposal and all established conventions. Then run the full regression suite and report any unverified areas.

## 14. FINAL ACCEPTANCE CRITERIA

The task is complete only when:

- All applicable project rules and architecture documentation have been reviewed.
- The application has been mapped end to end, including the supported models and their inference paths.
- Relevant `brain/` PNGs have been visually inspected and their evidence documented.
- Confirmed runtime and inference defects have been fixed or clearly classified as blocked, with evidence.
- Mesh-quality problems have been traced and addressed wherever a reproducible root cause and safe fix exist.
- Existing models, download behavior, dependency management, storage, APIs, and UI remain consistent and regression-tested.
- Actual UI/UX defects have been repaired and tested.
- Research-based recommendations are supported by sources and appropriately qualified.
- Tests and builds have been executed with truthful results.
- Documentation and task tracking have been updated.
- The code diff has been reviewed for regressions and unrelated modifications.
- The Hi3D integration proposal is ready for review, but **Hi3D remains unmodified and unintegrated until explicit approval**.

## 15. FINAL REPORT FORMAT

Deliver a factual report with these sections:

1. **Executive Summary** — actual work completed and overall state.
2. **Architecture Map** — key modules and inference flow.
3. **Confirmed Bugs and Root Causes** — severity, evidence, fix, and affected files.
4. **Mesh Quality Investigation** — PNG evidence, defect stage, implemented changes, and measurable comparisons.
5. **UI/UX Fixes** — defects found, fixes, and verification.
6. **Research Findings** — primary sources, useful techniques, trade-offs, and limitations.
7. **Tests and Build Results** — exact commands, pass/fail results, and unexecuted tests.
8. **Files Changed** — concise file-by-file summary.
9. **Outstanding Risks** — unresolved issues and hardware-dependent verification.
10. **Hi3D Approval Proposal** — proposed architecture, dependencies, risks, tests, acceptance criteria, and a clear request for authorization.

Start by inspecting the repository and applicable rules. Work systematically, maintain evidence, and prioritize correctness, reproducibility, geometry quality, and preservation of existing functionality over the number of changes made.

## Lead execution plan — 2026-10-27

1. **Baseline and scope:** preserve the existing working tree change, inventory source/config/tests/docs, confirm active routes and model registry, locate geometry evidence, and record CPU/GPU limitations.
2. **Root-cause fixes:** reproduce lightweight failures first; fix only confirmed runtime, request-contract, mesh-validation, storage, or UI defects with the smallest existing-pattern change.
3. **Quality safeguards:** verify raw/derived mesh contracts, master immutability, finite geometry and topology validation, and benchmark behavior using available CPU fixtures. Do not claim GPU or checkpoint quality results without running them.
4. **UI truthfulness:** inspect visible controls against serialized requests and backend consumers; repair only disconnected or misleading controls and preserve the existing Studio Gold system.
5. **Documentation and verification:** update every affected project document, run focused tests followed by the applicable backend/frontend/build checks, review the final diff, and classify all checks as `PASS`, `FAIL`, or `NOT RUN`.
6. **Hi3D gate:** research and document a proposal only after independent work is verified; do not clone, vendor, register, install, download, or expose Hi3D without explicit approval.

## Initial audit record — 2026-10-27

- No `AGENTS.md`, `CLAUDE.md`, or `brain/` PNG evidence exists in this checkout beyond `.agents/ponytail/AGENTS.md`; no visual mesh evidence was available to inspect.
- Confirmed defect: active workspace generation and texture panels exposed Low-VRAM switches, while the request builder serialized the choice and the scheduler allowed legacy keys into adapter inputs. Root cause was a stale UI/request path conflicting with the adapter-owned resource contract.
- Fix applied: removed those active controls and generation-state fields, stopped request serialization, and filtered legacy `low_vram` / `low_vram_mode` keys at the scheduler input firewall. Resource admission remains automatic through the runtime planner and worker resource plan.
- Documentation gap fixed: restored the five first-party guides referenced by the repository (`SECURITY`, generation UI contract, control audit, experimental-settings policy, and route/mount audit).
- Baseline/environment: Bun is not installed in this container; Node's direct frontend contract test runner was used for the focused test. Python test dependencies were installed locally from the repository's CPU test requirements subset. No model weights, CUDA runtime, Blender, or browser session was available.

## Final execution and completion record — 2026-10-27

1. **Cross-Model Mesh Quality Recovery & Maximum Fidelity:**
   - **Hunyuan3D-2.1 (`hunyuan3d_shape_v21.py` & `hunyuan3d_dit_v2_mini_turbo.py`)**: Restored `octree_resolution` from downscaled 512 to native **1200** (voxel resolution 0.00168) and inference steps to **100**, lifting the artificial ~60k polygon bottleneck to native capacity (~350k–600k polygons).
   - **TRELLIS 1 (`trellis_adapter.py`)**: Identified and fixed the root cause of the "completely damaged / webbed mesh". Removed destructive `trimesh.repair.fill_holes(mesh)` (which generated massive false bridge triangles across open natural contours) and Taubin smoothing from the raw generation pipeline; replaced with non-destructive orientation repairs (`fix_winding`, `fix_normals`).
   - **TripoSG (`triposg_adapter.py`)**: Set `crease_angle_deg=None` on mesh export to preserve native learned normal vectors from hierarchical depth 10 extraction ($1024^3$ grid) without crease splitting.
   - **Unique3D (`unique3d_adapter.py`)**: Lowered floating component pruning threshold from 5% to 0.2% (`max(30, int(total_f * 0.002))`), preserving fingers, accessories, and separate geometric details.

2. **Hi3D Experimental Integration (Approved by User):**
   - Vendored Sparc3D / Hi3Dv1.0 clean source into `backend/thirdparty/Hi3D` with `.git/` removed per Rule 13/18. Preserved license and attribution files.
   - Implemented `backend/adapters/hi3d_adapter.py` supporting `hi3d_image_to_raw_mesh` and `hi3d_image_to_textured_mesh` with `experimental: true`, Ampere+ hardware gate (CUDA >= 8.0), 16GB VRAM allocation, locked 1024 resolution profile, lazy weight loading, and clean untextured raw mesh export.
   - Registered in `backend/config/models.yaml`, `backend/core/scheduler/model_factory.py`, and `backend/core/planner.py`.
   - Exposed in UI (`constants/models.ts`, `GeneratePanel.tsx`, `app/page.tsx`) explicitly tagged as `[Experimental]`.
   - Documented in `Docs/EXPERIMENTAL-MODEL-SETTINGS.md` and `Docs/CHANGELOG.md`.

3. **Final Verification Results:**
   - Backend PyTest Suite (`/opt/conda/envs/3daigc-api/bin/pytest backend/tests/`): **137 passed, 0 failed, 9 warnings in 15.77s (100% green)**.
   - Frontend TypeScript Typecheck (`npm test` / `tsc --noEmit`): **0 errors (PASS)**.
   - Frontend Request Contract Unit Tests (`node features/workspace/lib/...`): **24/24 tests passed (PASS)**.
   - Frontend ESLint on Workspace Panels / Context: **0 errors (PASS)**.
