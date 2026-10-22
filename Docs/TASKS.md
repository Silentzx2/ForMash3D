# ForMash3D — Dev Codebase Cleanup & Wiring Tasks

Repository: Silentzx2/ForMash3D
Target branch: dev
Scope: backend, core, quality, API, model adapters, post-processing, frontend/features, shared components, configuration, tests, scripts, tooling, deployment, assets, plugins, and documentation.

This file replaces the former task index with an actionable cleanup/wiring plan. The previous file is preserved in Docs/TASKS_BEFORE_CODEBASE_CLEANUP_2026-10-21.md. The consolidated repair context remains in Docs/MASTER_AUDIT_AND_REPAIR_PLAN.md.

## Current execution status — 2026-10-22

The user authorized all audit batches in parallel. The graph-helper boundary, request/seed routing, adapter profile ownership, topology repair, quality-gate status, collision isolation, artifact hashing, and sample-image request path have source changes and regression coverage. Backend CPU contracts pass in a clean Python 3.10 environment. GPU/model inference, deployed API smoke tests, Blender/UniRig execution, browser validation, and a production build are not implied by these results; see the master audit for the final verification matrix and remaining limits.

## Rules before changing code

- Do not delete a file only because a simple text search did not find an import. Check dynamic imports, reflection, registries, CLI entry points, Next.js conventions, plugin loading, tests, deployment scripts, and the backend/thirdparty Git submodule.
- Every removal must include the file's reverse-dependency check, its replacement/consumer decision, and tests proving that no supported workflow regressed.
- Every visible control and every API field must either reach a real downstream consumer or be removed/deprecated at the boundary. No fake success, mock capability claims, or fields that are accepted but ignored without explanation.
- Keep one source of truth for each model registry, production preset, quality threshold, and runtime artifact/hash contract.
- Do not retune model inference numbers during cleanup. Adapter-owned runtime profiles are out of scope unless a separate measured regression justifies a change.
- Preserve raw/native mesh output, immutable master/source.glb lineage, user-selected models, and current artifact contracts.
- Treat all findings below as static-audit candidates until the relevant checks are run on the latest dev HEAD. No source-code deletion or runtime test success is implied by this plan.

## P0 — Fix confirmed wiring problems first

### P0-1. Repair the graph helper import boundary

File: features/graph/utils/graphHelpers.js

- [x] Replace the duplicated implementation with a compatibility re-export from features/utils/graphHelpers.js. The root helper is the canonical implementation.
- [x] The current copied file uses relative imports such as ./workflowFileInputs and ./ids, but those sibling files are absent from features/graph/utils in the tracked tree. The duplicate therefore points at missing modules.
- [x] Keep the nested path as a re-export shim because GraphPage imports through that path; do not remove the path before updating all imports.
- [x] Confirm root utility exports cover every symbol imported by GraphPage and graph node components.
- [ ] Run the frontend typecheck, lint, and production build; add a small route/import contract test if the build does not cover this import boundary.

### P0-2. Make the quality gate outcome real and observable

Files: backend/core/quality/evaluation.py, backend/core/quality/metrics.py, backend/postprocess/pipeline.py, backend/core/scheduler/multiprocess_scheduler.py

- [x] Trace the production quality report from master mesh comparison to the final result/status. pipeline.py calls compare_meshes and quality_gate; verify whether a failed gate changes the result, blocks an unsafe promotion, or is merely recorded as metadata.
- [x] Define and test the actual policy for pass, warning, fail, skipped, and missing metrics. Do not silently turn missing metrics into a pass.
- [x] Ensure the quality decision applies to derived output only and never mutates master/source.glb.
- [x] Reuse quality.yaml thresholds; do not add another hard-coded threshold table.
- [x] Keep diagnostics honest: a diagnostic comparison without ground truth must not be described as competitive parity or proof of visual superiority.

### P0-3. Verify the graph/UI integration and test coverage

- [ ] Run a full frontend typecheck, ESLint, and production build against dev after P0-1.
- [ ] Check actual route mounts and navigation entry points before deleting pages/panels. Keep Next.js conventional files such as app/icon.svg and app/apple-icon.png unless metadata and public references prove they are redundant.
- [ ] Keep root/shared UI components until a complete import graph and build prove they are unused; tiny files are not automatically dead code.
- [ ] Add any missing lightweight import/route contracts to CI so future dangling relative imports fail before merge.

## P1 — Remove high-confidence dead-code candidates after the mandatory reference check

Before deleting each item, search all tracked source plus the initialized submodule for imports, dynamic paths, symbol references, tests, and docs. Exclude the definition itself from the usage count. If a reference exists, migrate it first and leave a compatibility shim when external imports may be supported.

### P1-1. Frontend utilities with an apparently unused duplicate copy

- [ ] Remove features/hooks/useImageEditorHistory.js if latest-dev reverse-reference scanning confirms there are no callers. The active Image Editor page imports features/image-editor/hooks/useImageEditorHistory.js.
- [ ] Remove features/image-editor/hooks/usePasteImageFiles.js if no caller exists. The shared features/hooks/usePasteImageFiles.js is used by features/graph/pages/GraphPage.jsx and must be retained.
- [ ] Remove features/utils/shadowRemoverGPU.js if no caller exists. features/image-editor/pages/ImageEditorPage.jsx uses features/image-editor/utils/shadowRemoverGPU.js.
- [ ] Remove features/mesh-extras/ids.js if no caller exists. Keep features/utils/ids.js, which is used by shared graph/kanban/mesh-texturing helpers.
- [ ] Remove features/mesh-extras/meshFlatten.js if no caller exists. The current export dialog imports the canonical features/utils/meshFlatten.js implementation.
- [ ] Remove features/mesh-extras/meshExport.js and features/mesh-extras/meshTools.js if they have no callers. They are shallow re-export wrappers; preserve the canonical features/utils/meshExport.js and features/utils/meshTools.js used by current panels.
- [ ] Decide the ZIP utility explicitly: features/utils/zipArchive.js and features/mesh-extras/zipArchive.js have identical implementations, and no in-tree createZip call was found in this audit. If ZIP download is not a product requirement, remove both. If ZIP batch export is required, keep one canonical implementation under features/utils, wire it to an actual user action, test it, and make the other path a compatibility re-export or remove it.
- [ ] Do not remove features/hooks/usePasteImageFiles.js, features/image-editor/hooks/useImageEditorHistory.js, features/image-editor/utils/shadowRemoverGPU.js, or features/utils/ids.js merely because they have duplicate-looking counterparts. Their known consumers must continue to work.

### P1-2. Consolidate exact duplicate shared utilities without breaking import paths

- [ ] Convert features/graph/utils/graphHelpers.js into the re-export shim described in P0-1.
- [ ] Consolidate the identical features/utils/imageEditorCanvas.js and features/image-editor/utils/imageEditorCanvas.js implementations. Keep the root shared implementation as canonical if its exported API covers both callers; make the Image Editor path a re-export shim because ImageEditorPage imports it.
- [ ] Consolidate the identical features/utils/seamlessTexture.js and features/image-editor/utils/seamlessTexture.js implementations. Keep both import paths operational because different Image Editor components currently resolve the two paths.
- [ ] Review repeated helpers in features/mesh-extras and features/utils. Prefer a single implementation with small path-compatibility exports rather than duplicated business logic.
- [ ] Preserve features/board/config.js, features/graph/config.js, features/image-editor/config.js, features/mesh-extras/config.js, and features/wiki/config.js while their feature modules rely on those path shims. Remove a shim only after updating and testing its callers.
- [ ] Do not collapse app/apple-icon.png with public/icons/icon-180.png or app/icon.svg with public/icons/icon.svg based only on identical bytes. Verify framework conventions, metadata, and external/public URL consumers first.

### P1-3. Backend placeholder and wrapper candidates

- [ ] Review backend/core/preprocess/hi3dgen_bridging.py. No in-repository caller was found, and its function is a passthrough placeholder. Remove it if no vendor, script, or supported external import requires it; otherwise wire it into one canonical provider interface and add real contract tests.
- [ ] Review the separate _hi3dgen_normal_bridging implementation in backend/core/preprocess/image_enhancement.py. It explicitly labels itself as a mock and returns provider hi3dgen_mock. Keep the experimental profile only if its mock nature is clearly exposed and it cannot be mistaken for real normal conditioning. Otherwise disable the profile or replace the mock with a verified real provider. Do not claim actual geometry-quality improvement from the edge-filter blend.
- [ ] Review backend/postprocess/services/rigging.py. No internal caller for run_rigging_export/is_rigging_available was found. Choose one canonical route: wire the facade into the current auto-rigging/export flow if it adds needed behavior, or remove the unused facade after checking external imports. Keep backend/api/routers/auto_rigging.py and backend/postprocess/services/convert_fbx.py as long as their actual API/pipeline paths remain active.
- [ ] Review backend/postprocess/services/baking.py. It only re-exports from .bake and no internal caller was found. Remove this compatibility alias if vendor/submodule/external compatibility checks confirm it is unnecessary. Keep backend/postprocess/services/bake.py; backend/postprocess/pipeline.py imports and invokes run_bake.
- [ ] Search all package-qualified and dynamically assembled imports before removing compatibility aliases. Record the search result in the commit.

### P1-4. Consolidate duplicate SHA-256 logic; do not weaken master immutability

Locations to review: backend/core/quality/metrics.py, backend/core/utils/artifact_utils.py, backend/postprocess/pipeline.py, backend/core/scheduler/multiprocess_scheduler.py.

- [ ] Select one canonical streaming SHA-256 implementation and route runtime callers to it where import layering permits.
- [ ] Keep compatibility exports for sha256_file where tests or callers use the current public import.
- [ ] Decide whether audit_master_immutability should become the production helper used by the post-process/master lifecycle or remain a test utility. Do not remove it just because current tests are its obvious caller.
- [ ] Remove backend/core/utils/artifact_utils.py's duplicate sha256_file definition only after all callers are migrated and tests prove the exported hash contract is preserved. Keep artifact_utils.py itself: resolve_manifest_path is used to align model-readiness and smart-preset path resolution.
- [ ] Test source/master hashes before and after post-processing, cancellation, failure, retries, export, and auto-rigging. Master bytes must remain unchanged.

## P1 — Wire real behavior end-to-end or remove dead controls/fields

### P1-5. Generation UI, request builder, API, scheduler, and presets

Files to trace: features/workspace/Panels/GeneratePanel.tsx, features/workspace/Modals/GenerationPresetDrawer.tsx, features/workspace/types.ts, features/workspace/store/WorkspaceContext.tsx, features/workspace/utils/buildGenerationParameters.ts, backend/api/routers/mesh_generation.py, backend/api/routers/smart_generation.py, backend/core/smart_presets.py, backend/core/planner.py, backend/core/scheduler/multiprocess_scheduler.py.

- [ ] For every visible control, document UI state → request-builder field → API schema/handler → scheduler/post-process consumer → observable artifact/diagnostic.
- [ ] Remove controls, stale state, constants, and handlers that have no real consumer. A request field existing in Pydantic is not evidence of implementation.
- [ ] Keep adapter-specific steps, guidance, sampler, decoder/extraction resolution, and inference flags inside the adapter-owned locked profile. Do not restore a second frontend/scheduler profile table.
- [ ] Remove inference-only modelParameterOverrides from the normal request path. Safely accept old saved preset files where required, but ignore legacy inference overrides and test that they never reach an adapter.
- [ ] Keep only the canonical production preset source. Align mobile, game_ready, cinematic, animation, 3d_print and native/raw identifiers across backend presets and the frontend fallback; the native sentinel is not automatically a YAML preset entry.
- [ ] Preserve explicit request value > intent preset > backend default precedence for supported production options. Omitted tri-state values must remain distinguishable from explicit false.
- [ ] Verify target_polycount, texture_resolution, candidate_count, enable_postprocess, generate_lod/lod_preset/lod_count, UV, topology, printability, repair, rigging, physics/collision, and preprocessing artifact/review fields individually.
- [ ] Ensure Native/Raw actually avoids incompatible downstream production operations and budget overrides; it must not merely change the selected card styling.
- [ ] Ensure selecting a preset never submits a generation job. Generation must remain a deliberate user action.
- [ ] Preserve user model choice. A preset may not silently replace an explicitly selected model.
- [ ] Reconcile candidate_count, planned seed count, auto-seeds feature flags, best-candidate scoring, and the runtime telemetry. Logs and UI must report what actually executes, not just a plan value.
- [ ] For deprecated fields such as requested_quality, mesh_style, object_type, and symmetry, either prove a supported consumer or remove them from the normal generation surface while keeping only intentional backwards-compatibility handling.
- [ ] Update request-builder, preset-parity, API lifecycle, adapter regression, and seed-plan tests after every field/control migration.

### P1-6. Model registry, adapters, and runtime entry points

- [ ] Keep backend/core/scheduler/model_factory.py and backend/adapters/__init__.py registry entries aligned with backend/config/models.yaml, enabled model IDs, legacy aliases, and the model manifests. These registries use dynamic imports and cannot be audited by static import count alone.
- [ ] Do not delete legacy Hunyuan/TRELLIS aliases or adapter modules until current config, persisted jobs/assets, tests, and public API compatibility have been checked and a migration is documented.
- [ ] Keep backend/api/main_multiworker.py and backend/scripts/scheduler_service.py: Docker/Supervisor starts this multi-worker API plus a separate scheduler service.
- [ ] Keep backend/api/main_singleworker.py as the documented alternate deployment until product docs and deployment requirements explicitly retire single-worker mode.
- [ ] Keep Dockerfile, Dockerfile.runpod, docker-compose.yml, supervisord.conf, backend/scripts/run_server.sh, backend/scripts/install.sh, and model download/setup scripts while their respective deployment paths exist. Review drift between deployment variants rather than deleting one because it looks similar.
- [ ] Check backend/core/runtime_probe.py, backend/core/config.py, backend/core/smart_presets.py, backend/core/planner.py, scheduler factories, resource planner, Redis queue and database managers as runtime-connected infrastructure before any removal.

### P1-7. Third-party proxy and compatibility modules — submodule scan required

Files requiring explicit review include backend/utils/image_super_utils.py, multiview_utils.py, pipeline_utils.py, simplify_mesh_utils.py, uvwrap_utils.py, torchvision_fix.py, dinov3_vit.py, flex_gemm_fallback.py, fastmesh_utils.py, partuv_utils.py, trellis2_utils.py, and unirig_utils.py.

- [ ] Initialize and scan the recursive submodule at backend/thirdparty (repository Silentzx2/ForMash3D-ThirdParty) before deciding these files are unused.
- [ ] Trace package imports, sys.path changes, lazy imports, importlib, and model-specific paths in the Hunyuan/TRELLIS/PartUV/UniRig code.
- [ ] Keep the proxy modules needed to prevent vendor package shadowing or preserve upstream import paths. Remove only wrappers proven unused after the submodule and runtime startup paths are checked.
- [ ] Do not merge model-specific compatibility implementations into a global helper if doing so changes package resolution or makes one model select another model's vendored utility.

## P1 — Core backend and quality system: keep, wire, then optimize

### P1-8. Quality code that must be retained

The following code is not a deletion target based on this audit:

- backend/core/quality/metrics.py: mesh topology/geometry metrics and sha256_file are used by scheduler quality/candidate paths; tests cover mesh metrics and master immutability.
- backend/core/scheduler/seed_scorer.py: score_seed_candidate and select_best_candidate are imported by the multi-process scheduler for multi-candidate scoring.
- backend/core/quality/evaluation.py: compare_meshes and quality_gate are connected to post-process evaluation; compare_model_runs and render_multi_view support benchmark tooling; compare_render_directories has test coverage.
- backend/core/quality/parity_scorecard.py and root parity_scorecard.json: scorecard schema/source-attribution contracts are checked by tests and the module has an explicit CLI entry point.
- backend/config/quality.yaml: canonical quality/seed/hole-repair/decimation/bake/UV thresholds are loaded and validated by backend/core/config.py.
- backend/core/utils/artifact_utils.py: resolve_manifest_path is used to keep readiness and smart-preset path resolution consistent.
- backend/core/preprocess/image_enhancement.py: active preprocessing path that creates approved artifacts; the separate hi3dgen mock must be treated honestly.
- backend/core/mesh_processor.py, backend/postprocess/pipeline.py, backend/postprocess/services/gate.py, hole_repair.py, memory_safe_decimate.py, uv_backend_resolver.py, pbr_validator.py, bake.py, collision.py, repair.py, simplify.py, auto_uv.py and auto_retopo.py: retain while the production pipeline and API endpoints call these services.

Tasks:

- [ ] Audit every metric and gate output: identify which ones block, warn, or report only. Wire missing critical production checks; explicitly label optional diagnostics and benchmark-only helpers.
- [ ] Verify the multi-candidate path calls the scorer only when candidates actually exist and that selected output metadata is persisted correctly.
- [ ] Verify quality.yaml is the sole authoritative thresholds file. Remove duplicate hard-coded threshold values only after tests prove the central config supplies them.
- [ ] Decide whether compare_render_directories should remain a developer/test helper or be wired into the A/B benchmark command. Do not add a production dependency on headless rendering solely to eliminate an unused-reference warning.
- [ ] Keep parity scorecard values source-attributed measured values or null; no invented competitor metrics.
- [ ] Add CPU-only CI tests for the quality contracts where dependencies are available, separately from GPU/checkpoint runtime smoke tests.
- [ ] Keep backend/core/animation/ardy_converter.py: it is called by the ARDY adapter and the integration verification script.
- [ ] Keep backend/core/utils/mesh_utils.py while adapters import its MeshProcessor and shared mesh operations.

### P1-9. API routers and backend services

- [ ] Confirm every router in backend/api/routers/__init__.py is mounted by both intended app entry points and its UI/API client callers still exist.
- [ ] Keep routes used by services/apiClient.ts, features/workspace/lib/api.ts and the Next runtime proxy app/api/v1/[...path]/route.ts.
- [ ] For each endpoint, decide whether it is part of the supported product, maintenance/admin surface, or compatibility-only. Remove a route only with the frontend/client/docs/tests migrated.
- [ ] Audit file upload IDs, path validation, auth, rate limiting, cancellation, polling/SSE, job cleanup and download artifact routes as contracts—not merely references.
- [ ] Remove stale endpoint wrappers only after tracing client aliases and saved URLs; update route-contract tests in the same change.
- [ ] Check whether backend/postprocess/services/rigging.py and baking.py add any real behavior beyond existing route/pipeline services; follow P1-3.

## P2 — Repository-wide duplicate, stale-code, and dependency pass

### P2-1. Import graph and dead-code proof

- [ ] Build a report of tracked source files and exportable symbols by reverse references. Treat Python dynamic imports, React lazy imports, config-selected components, and string-selected model IDs separately.
- [ ] Search for unused exports, unused imports, unreferenced functions/classes, stale constants, duplicate utilities, unreachable branches, dead feature flags, unconsumed configuration keys, and obsolete request aliases.
- [ ] For JavaScript/TypeScript, combine imports with Next routes, dynamic imports, JSX references, CSS imports, tests, and package exports. Do not count public assets only by source imports.
- [ ] For Python, combine AST/import analysis with string-based registries, module __getattr__, importlib, command-line entry points, worker subprocess scripts and submodule imports.
- [ ] For YAML/JSON/env configuration, map every key to the loader and consumer. Remove a key only after proving no reflective lookup, environment override, alternate deployment, or test contract uses it.
- [ ] For scripts/tools, trace package scripts, CI jobs, Docker/Supervisor commands, documentation commands, release/packaging workflows and external plugin calls before removal.
- [ ] For files with no internal callers but clear operator/benchmark use, classify them as developer tooling, not dead code. Keep a short README or package-script entry for intentionally supported tools.

### P2-2. Dependency and packaging hygiene

- [ ] Audit package.json and bun.lock dependencies against imports, Next build plugins, postinstall scripts, dynamic imports and optional tooling. Do not remove a package used only by a rare feature without exercising that feature.
- [ ] Audit backend/requirements.txt and backend/requirements-test.txt against runtime imports, subprocess workers, optional model adapters and deployment/install scripts. Shared baseline dependencies must remain consistent with adapter dependency contracts.
- [ ] Verify tools/check-generated-db.mjs, check-packaged-modules.mjs, check-unity-plugin.mjs, gen-db-names.mjs, gen-pg-schema.mjs, migrate-sqlite-to-postgres.mjs, pack-unity-plugin.mjs and view-asset-e2e.mjs are connected to a workflow or explicitly document them as manual tools.
- [ ] Audit plugins/unreal, plugins/unity, assets, tools/meshoptimizer and public files with the corresponding build/packaging workflows before considering any binary or data removal.
- [ ] Treat the Git submodule as a separately versioned dependency; do not duplicate vendor code into this repository as a cleanup shortcut.
- [ ] Compare Dockerfile and Dockerfile.runpod dependency/runtime contracts. Consolidate shared fragments only if both targets retain their GPU, model-download and deployment requirements.

### P2-3. Tests, CI, and truthful status reporting

- [ ] Run backend Python source compilation and all applicable lightweight CPU-only tests.
- [ ] Run backend runtime-contract, security-boundary, file-upload, quality, model-registry, API lifecycle, resource planner, preset parity, seed-plan, UV resolver, PBR, and post-process regression tests as their dependencies permit.
- [ ] Run frontend TypeScript checking, ESLint, workspace/route/request-builder tests, and production build.
- [ ] Update .github/workflows/backend-runtime-ci.yml and frontend-ci.yml only after determining which extra tests are deterministic and CPU-only. Do not put checkpoint/GPU inference tests in a lightweight CI job that cannot support them.
- [ ] Keep a separate explicitly labelled GPU/model smoke-test matrix for installed checkpoints, actual inference, actual peak VRAM, UV/PBR output, and preview rendering. Do not claim CPU contract CI proves these things.
- [ ] Report every check as PASS, FAIL, BLOCKED, or NOT RUN with the actual command and relevant output. Do not mark a task complete from static inspection alone.
- [ ] Add regression tests for every deleted symbol/path where there was a previously supported import or endpoint.

## P2 — Directories and files to preserve unless an explicit migration proves otherwise

- backend/adapters: registry/dynamic loading and model-specific inference contracts.
- backend/core/auth, config, models, preprocess, quality, scheduler, utils: core runtime, validated config and service contracts.
- backend/postprocess: pipeline, schemas, geometry operations, workers, licensing/attribution, and output artifact production.
- backend/tests and frontend *.test.mjs files: executable contracts and regression evidence; low reference counts do not make tests dead.
- app, features, components, hooks, lib, services, stores, types: routes, user flows, shared state, API contracts and utility surfaces; audit by dependency graph.
- constants, backend/config, .env.example, package.json, bun.lock, requirements files: configuration/dependency sources that must stay synchronized with loaders and tests.
- scripts, tools, Dockerfiles, docker-compose.yml, supervisord.conf, .github/workflows: deployment, packaging, developer operations and CI entry points.
- Docs, README.md, RULES.md, CONTRIBUTING.md, LICENSE, CITATION.cff: policy, design, user/setup instructions, third-party obligations and public project metadata.
- public, assets, plugins, native tools and backend/thirdparty: assets, plugin packages, binaries, vendored runtime code and separately versioned dependencies. Inspect packaging/use before deleting.
- features/workspace/lib/uploadProgress.ts, uploadResponse.ts, workspaceRouteContract.ts and the respective tests: these small modules are used by workspace upload and route contracts.
- constants/smartPresetFallback.json and constants/smartPresets.ts: preserve frontend offline fallback/parity with backend production presets.
- app/api/v1/[...path]/route.ts and app/static/[...path]/route.ts: preserve runtime proxy/static path behavior unless routes are replaced with tested equivalents.

## Required execution order

1. [ ] Update/confirm dev HEAD and clean working tree; initialize the recursive submodule.
2. [ ] Fix P0 graph import boundary and prove frontend build.
3. [ ] Add or update reverse-reference inventory and classify each candidate as REMOVE, WIRE, CONSOLIDATE, KEEP, or DEFER.
4. [ ] Remove only the P1 high-confidence candidates in a small isolated commit after their reference checks; no mass deletion.
5. [ ] Consolidate duplicate utilities via re-export shims where current paths are active.
6. [ ] Wire quality gates, generation controls, request fields, presets, artifact hashes and service wrappers to real consumers; delete controls/aliases that cannot be supported.
7. [ ] Run backend and frontend tests, plus the correct smoke tests for any affected route/model/post-process path.
8. [ ] Update docs and CI, scan for removed names and stale imports, review the complete diff.
9. [ ] Commit the task implementation with the exact tests/results in the message or report. Do not claim push or runtime success unless the tool output confirms it.

## Verification commands

Run from the current repository checkout; adapt environment activation and available dependencies to the deployment image.

    git status --short
    git rev-parse HEAD
    git submodule update --init --recursive
    git grep -n -E 'hi3dgen_bridging|run_rigging_export|is_rigging_available|createZip|useImageEditorHistory|usePasteImageFiles|shadowRemoverGPU|mesh-extras/meshFlatten|mesh-extras/meshExport|mesh-extras/meshTools' -- .
    cd backend && python -m compileall -q .
    cd .. && bun run test
    bun run lint
    bun run build

A successful grep is not by itself proof of use or lack of use: inspect import direction, definition-only matches, config-driven paths, submodule/vendor imports, and the resulting build/test output.

## Definition of done

- [ ] Every removal has a confirmed no-consumer result, replacement decision, and passing regression/build tests.
- [ ] Every retained feature control has a proven path to a real consumer or is explicitly labelled experimental/unavailable.
- [ ] The graph relative-import issue is fixed, and frontend typecheck/build proves it.
- [ ] Quality/seed/master hash contracts remain active, honest, config-backed, and regression-tested.
- [ ] Model adapters, dynamic registries, runtime proxies, API routes, tests, third-party assets and deployment entry points were not accidentally deleted.
- [ ] The repository can identify REMOVE, WIRE, CONSOLIDATE, KEEP and DEFER decisions for each candidate; unresolved vendor/external compatibility questions remain marked DEFER.
- [ ] Final report distinguishes static findings, passing tests, blocked tests, and GPU/runtime behavior that was not tested.
