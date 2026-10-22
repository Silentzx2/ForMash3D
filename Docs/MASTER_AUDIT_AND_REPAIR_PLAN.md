# ForMash3D — Master Audit, Bug Fix & Quality Improvement Plan

**Repository:** Silentzx2/ForMash3D  
**Target branch:** dev  
**Purpose:** One complete, enforceable source of truth for Generate UI cleanup, adapter-owned inference, request routing, mesh post-process, physics/collision, PBR/textures, validation and documentation.  
**Status:** Implementation authorized across all batches for the current execution; source-level verification is complete, while runtime-only validation remains explicitly tracked below.
**Authorization model:** For this execution, the user explicitly authorized all batches to be implemented in parallel. This supersedes the historical one-batch-at-a-time pause for this task only.

## Read first — non-negotiable execution contract

1. Read current root RULES.md fully before touching code, and re-read relevant contracts/docs at the start of each batch. RULES.md is mandatory: root-cause-first, YAGNI, single-source-of-truth, doc sync, honest tests and no fake controls apply to every sub-agent.
2. This document consolidates the earlier Generate-panel/UI cleanup and adapter-locked-inference task with the newer bug list for generated holes, mesh distortion after post-process, physics/collision, PBR/materials, routing/mounts, tests and documentation.
3. **Execution authorization:** the user authorized all batches in this plan for the current task. Continue through the requested scope without pausing after each batch; still stop and ask before any profile retune that requires approval or any action that risks overwriting collaborator work.
4. At batch start, inspect the latest dev HEAD and current diff. Do not rely on stale local state or assume older findings are unchanged. Preserve user work; never force-reset, force-push or overwrite unknown changes.
5. Trace every real setting/control end-to-end: UI → request builder → API schema/router → job fields/metadata → scheduler → adapter or post-process consumer → artifact/result route. A label, field, helper, mock or historic test result is not evidence of working end-to-end behavior.
6. Classify every required check as PASS, FAIL or NOT RUN. Explain blockers such as unavailable GPU, weights, runtime dependencies, browser, fixture or repository permission. Static source inspection is not proof of visual/model quality.
7. Keep the canonical model-native source immutable at master/source.glb. Diagnose the first destructive stage rather than replacing the source, blanket-smoothing the surface or applying global remesh as a symptom fix.
8. Do not retune inference profiles by guesswork. Adapter-owned locked profiles are the intended numerical authority. Remove hidden overrides/clamps only after tracing actual pipeline kwargs and respecting the approval/change-control rule in Docs/EXPERIMENTAL-MODEL-SETTINGS.md. If reconciliation materially changes active numerical settings and requires approval, report the exact conflict and wait.
9. Reuse current helpers/config/tests before introducing new abstractions. Do not duplicate thresholds, limits, preset numbers or profile dictionaries. Quality pipeline values belong in backend/config/quality.yaml; model facts belong in backend/config/models.yaml; output recipes belong in backend/config/smart_presets.yaml. Missing mandatory config should fail loudly.
10. Every visible control must have a verified consumer. Wire it properly or remove/disable it honestly. Never leave a mock switch that reports success.
11. At the end of each authorized batch, review the diff, run available batch tests, update affected docs, inspect the resulting commit and report changed files, tests, risks and exact SHA. Publish to dev only when the batch is coherent/safe and repository permissions allow it; use non-force operations. If blocked, state the exact reason.
12. Sub-agents may investigate in parallel only with non-conflicting ownership. Each must return file/function evidence, reproduction steps, test coverage and unanswered questions. The coordinator owns integration and must reject unsupported PASS claims.
13. The inherited Generate-panel specification below includes a historical verification matrix. Its earlier PASS labels are not proof that the current dev HEAD still satisfies the requirement. Batch 1 must re-check current source and re-run the relevant checks.

## Master execution order

| Batch | Focus | Required output | Completion evidence |
|---|---|---|---|
| 1 | Baseline audit and reproduce mesh-quality failure | Current code map, route/mount map, UI control inventory and stage-by-stage reproduction report | Source findings recorded; runtime reproduction limits explicit |
| 2 | Locked adapter inference profiles | Effective model kwargs match each authoritative locked profile | Profile/request-isolation tests; any configured/effective mismatch documented |
| 3 | Seed, candidates and request-routing contract | Seed 0 preserved; candidates and production-only settings reach correct consumers | Planner/scheduler/router regression tests |
| 4 | Generate UI and Advanced controls | Beginner-friendly UI with only verified settings; remove fake inference controls/dead state | Frontend/backend consumer tests |
| 5 | Topology gate and hole repair | Safely handle persistent holes; report unrepaired defects honestly | Hole-repair fixtures and quality metrics |
| 6 | Retopology, remesh, decimation and geometry guards | Locate/revert destructive steps without damaging healthy meshes | Geometry-preservation tests; runtime comparison where available |
| 7 | UV, normals, PBR, textures and export artifacts | Verify material integrity and correct render artifact | Asset-integrity tests; runtime-dependent bake status recorded |
| 8 | Physics/collision isolation | Collision output never replaces or corrupts render geometry | Artifact-isolation and failure tests; runtime A/B status recorded |
| 9 | Routes, mounts, service wiring and controls inventory | No dead/hidden/mis-mounted paths; factual working/broken/unverified report | Route/consumer matrix and source-contract tests |
| 10 | Regression suite and real-model validation | Automated evidence and real output comparisons if environment permits | PASS/FAIL/NOT RUN matrix; do not infer runtime success |
| 11 | Documentation, final review, commit/publish | Synced docs, scoped diff, final handoff | Publish only if checks/permissions permit |

If a batch uncovers a dependency on a later batch, record it. The user has authorized the full batch scope for this execution; do not make unapproved numerical inference-profile changes or overwrite collaborator work.

## Unified bug and improvement register

These are source-audit findings or hypotheses, not all runtime-confirmed defects. Static inspection can confirm mismatched code paths; only suitable runtime/reproduction evidence establishes visual impact.

### I-01 — TRELLIS locked profile requests 100 steps, runtime clamps effective steps to 50

**Evidence to re-check:** backend/adapters/trellis_adapter.py. The inspected locked profile declares num_inference_steps=100, ss_sampling_steps=100 and slat_sampling_steps=100. The request path then applies max(1, min(50, value)) to both sparse and SLAT steps. This is a source-confirmed requested-versus-effective mismatch; its visual/GPU impact has not been measured here.

**Required action in Batch 2:** trace every TRELLIS feature alias and the actual sparse/SLAT pipeline call kwargs; capture those kwargs in regression tests. Make the locked profile and actual-call contract agree. Do not silently retune 100 to 50 or remove a safety cap without following the profile-change approval rule. Record any required decision explicitly.

### I-02 — Explicit user seed zero may be replaced by configured base seed

**Evidence to re-check:** backend/core/planner.py, resolve_seed_plan(). The inspected expression is equivalent to int(model_inputs.get("seed") or seeds_cfg.get("base_seed") or 0), so seed=0 behaves like a missing seed. The frontend builder accepts non-negative safe-integer seeds, including zero.

**Required action in Batch 3:** distinguish absent seed from seed value zero. Verify exact planned and actual seed for each candidate, stored metadata and the selected result. Test missing seed, zero, positive seed, candidate_count=1 and >1, seed_step and max_candidates.

### I-03 — A full-repair gate decision does not guarantee the mesh was repaired

**Evidence to re-check:** backend/postprocess/services/gate.py and backend/postprocess/pipeline.py. The gate can return full_repair for large holes/non-manifold defects. The pipeline’s structural run_repair call also depends on the Auto-Repair/printability-auto-repair flag. With the flag off, the pipeline can retain a copy of the defective source. Small-hole minimal repair is a separate path.

**Required action in Batch 5:** establish the intended Auto-Repair OFF contract. If the user disables repair, preserve source geometry when required but show residual defects and a degraded/needs-review state. When repair is enabled, run safe repair and validate the output. Never confuse “defect detected” with “defect fixed”.

### I-04 — Configured hole-perimeter limit may not reach production targeted repair

**Evidence to re-check:** backend/config/quality.yaml defines holes.max_hole_perimeter, and backend/postprocess/services/hole_repair.py accepts max_hole_perimeter; the inspected production call in backend/postprocess/pipeline.py passes max_hole_vertices but appears not to pass the perimeter value.

**Required action in Batch 5:** audit all callers and intended semantics. If this is a required safety bound, forward the canonical configured value. Add tests on each side of the vertex/perimeter boundary. Never add a second hardcoded threshold.

### I-05 — Fan triangulation may produce a closed but geometrically bad hole cap

**Evidence to re-check:** backend/postprocess/services/hole_repair.py uses fan-like triangulation for larger loops. Concave, non-planar, skinny or ambiguous loops may violate the simple-cap assumption.

**Required action in Batch 5:** test convex/concave, planar/non-planar, skinny, multi-loop, large-perimeter and ambiguous boundaries. Validate orientation, degeneracy, manifoldness and local surface deviation where available. Edge-count reduction alone is not proof of a safe repair. If a hole cannot be safely filled, report it instead of closing it destructively.

### I-06 — Optimization guard is narrower than the full surface-fidelity problem

**Evidence to re-check:** backend/postprocess/pipeline.py, _quality_guard(). The inspected guard checks finite vertices, face count, bounding-box drift and vertex growth and is applied after optimization. backend/core/quality/evaluation.py contains compare_meshes() and quality_gate() diagnostics. Determine which source-to-derivative checks actually revert geometry and which only populate reports/status.

**Required action in Batch 6:** measure topology and geometric fidelity at each mutation boundary. Separate expected polygon-count reduction from unintended silhouette/detail drift. Reuse current geometry metrics; any additional scale-normalized thresholds must live in canonical quality config and be validated on clean and broken fixtures. Revert rejected candidates to the last safe input where the contract supports it.

### I-07 — Retopo/remesh/shell/decimation may be the first stage to damage geometry

**Evidence to re-check:** backend/postprocess/pipeline.py; backend/postprocess/services/autoretopo/shell.py; backend/postprocess/services/autoretopo/remesh.py; backend/postprocess/services/memory_safe_decimate.py; backend/postprocess/services/simplify.py. The inspected pipeline contains repair, conditional AutoRetopo, high/ultra feature-remesh, optimization and downstream LOD construction. Shell reconstruction includes voxelization, distance fields, smoothing, marching cubes and Taubin smoothing.

**Required action in Batches 1 and 6:** compare stage inputs/outputs from the same immutable source. Test raw/native passthrough, modest reduction and aggressive target-polycount paths separately. Do not switch off all remesh or raise all face budgets until evidence identifies the specific destructive operator and model feature path.

### I-08 — Physics/collision must be proven isolated from render output

**Evidence to re-check:** backend/postprocess/pipeline.py passes the finalized game-ready mesh to run_collision() and writes collision.glb plus physics metadata. A convex-hull fallback is used if collision decomposition fails.

**Required action in Batch 8:** verify flag defaults/tri-state, failure/fallback behavior, manifest, viewer and download paths. Run same-source A/B with physics ON/OFF. Render mesh must not change solely because collision generation was requested; the simplified proxy must not appear as the main render model.

### I-09 — Texture resolution needs an end-to-end consumer audit, not a blanket scheduler change

**Evidence to re-check:** backend/core/scheduler/multiprocess_scheduler.py categorizes texture_resolution as post-process-only for ordinary geometry inference. The image-to-textured router separately records atlas resolution in job metadata, and the postprocess pipeline consumes those fields. Dedicated Paint/painting paths may have different requirements.

**Required action in Batches 3 and 7:** prove the user’s 1K/2K/4K/8K atlas choice reaches the correct atlas/painting consumer on every supported model/feature path while not leaking into unrelated locked geometry inference. Do not remove this filter merely because the UI has a texture slider.

### I-10 — Inference profile authority requires a full adapter/alias/call-kwargs audit

**Evidence to re-check:** the inspected dev scheduler’s _RAW_MESH_MAX_QUALITY_PARAMETERS mapping is empty, while numeric profiles are in adapter modules. Historic docs/search excerpts may reflect stale code.

**Required action in Batch 2:** enumerate current registered adapters and aliases. For each feature path, inspect locked profile, schema defaults/readOnly flags, merge order, request filtering, _process_request branches, conditional resource guards/clamps and actual third-party pipeline kwargs. Keep scheduler free of duplicate numerical profile dictionaries. Do not trust comments or schemas alone.

### I-11 — Automatic seed candidates differ from user-requested candidate count

**Evidence to re-check:** backend/core/planner.py. Planner-proposed candidate_count only activates when active planner config enables auto_seeds and planned seed count exceeds one. User candidate_count>1 follows a separate path. Verify the actual deployed config instead of assuming fallback defaults describe it.

**Required action in Batch 3:** test config and actual scheduler launch together. Either enable/document intended automatic candidates or keep disabled intentionally. Report candidate counts requested/launched/failed/selected and exact seeds. Do not mix seed count with inference step count.

### I-12 — PBR/UV/material/normal validation may be reporting-only instead of an enforcement gate

**Evidence to re-check:** production stages include UV preservation/generation, optional baking, texture generation, PBR validation and final inspection. UV seam splitting can change vertex counts without changing the underlying surface. Validator error/warning paths and quality status must be read in the current source.

**Required action in Batch 7:** verify real GLB material channels, texture payloads, UVs, atlas dimensions, normals/tangent convention, baking and PBR validation output. Determine whether invalid/warn/error states degrade final status or can be defaulted as valid. Do not fabricate semantic PBR maps for an untextured source and claim success.

### I-13 — Visible and hidden routes/mounts/functions can be disconnected

**Evidence to collect:** all FastAPI mounts/prefixes, UI route/fetch/download references, generation/painting/batch/rerun routes, manual mesh tools, scheduler worker dispatch, service consumers and final artifact routes.

**Required action in Batches 1, 4 and 9:** construct a route/control consumer matrix: UI source, request field, endpoint, router, metadata field, scheduler handler, service, output artifact/error path and test evidence. Verify hidden/internal endpoints as well as visible panels. Find unreachable, duplicate, shadowed, stale, cosmetic and incorrectly mounted routes. Preserve non-generation consumers when simplifying the Generate panel.

### I-14 — Historical test status must be re-established on current dev

Older Docs/TASKS.md entries mention earlier test passes and GPU/heavy-dependency checks that were not run. These are historical claims, not proof for the current checkout. Batch 1 and Batch 10 must establish current status. Unit tests alone do not validate model inference or visual quality.

## Detailed batch contracts

### Batch 1 — Baseline and failure localization

**Goal:** identify whether holes/quality loss originate in model output, repair, retopology, remesh, optimization, UV/texturing, export or artifact selection.

- Read RULES.md and relevant docs: Docs/ARCHITECTURE.md, Docs/GENERATION-UI-CONTRACT.md, Docs/EXPERIMENTAL-MODEL-SETTINGS.md, Docs/TASKS.md, Docs/DECISIONS.md and postprocess README/third-party requirements.
- Inventory every adapter/profile, UI control, request-builder field, route/mount, scheduler input filter, job metadata field, postprocess stage, physics/PBR/texture artifact and existing test.
- Reuse quality_trace, raw geometry telemetry, topology metrics, compare_meshes/quality_gate and master hash protection before adding diagnostics or abstractions.
- With a representative generated asset, compare the same master/source.glb input to stage outputs after repair, AutoRetopo, feature remesh, optimization/decimation, UV, texture stage and final game-ready export.
- Record input/output hashes, face/vertex counts, boundary loops/edges, watertightness, non-manifold/degenerate data, component/floater counts, normals, bounds, volume where meaningful, UV/material/PBR data, stage decisions/errors and status.
- Reproduce post-process ON/OFF and controlled setting variants; change one setting at a time. Verify whether preview/download displays game-ready render geometry or collision proxy.
- Build initial working/broken/mock/unverified control inventory. If real outputs/weights/GPU are unavailable, mark runtime/visual checks NOT RUN and state exact blockers. Do not tune profiles in this batch.
- **Acceptance:** baseline code/path map and defect localization if reproducible, or exact blockers and unanswered questions. Report and wait for proceed.

### Batch 2 — Locked adapter inference single source of truth

- Audit every supported adapter and alias in the current registry, not just named models.
- Map model ID → adapter class → locked profile → profile merge → actual model-library kwargs → output telemetry for raw, textured and painting paths.
- Ensure supported schedules, steps, guidance, sampler dictionaries, extraction/octree/decoder settings and low-VRAM/quality overrides have one authoritative adapter owner. Remove numerical duplicates from UI, request presets and scheduler.
- Verify client override attempts cannot change locked settings and that model aliases use the right profile. Document intentional mode-specific branches and resource/official-library bounds.
- Reconcile TRELLIS profile versus effective 50-step cap without silently changing profile values. If removal/alteration of the cap changes effective settings and approvals are required, surface the exact choice and wait.
- Confirm exposed schema defaults/readOnly flags mirror the actual profile where relevant; do not add unused copies.
- **Acceptance:** effective-kwargs regression tests prove client overrides cannot change locked inputs and changing the selected lock changes values passed to the model. Report and wait.

### Batch 3 — Seeds, candidate scheduling, API and scheduler contract

- Correct seed 0 handling. Verify planned seed schedule and actual per-candidate seed across adapters and saved metadata.
- Test candidate_count 1–4, max candidate cap, scoring/early stop, duplicate outputs and failure recovery. Test auto_seeds independently from explicit user candidate_count.
- Trace generation request end-to-end through buildGenerationParameters.ts, API schemas/routes, job inputs/metadata, _build_model_inference_inputs(), adapters and postprocess.
- Ensure production-only fields reach their consumer while being removed from inference kwargs where appropriate: target polycount, LOD, UV, physics, repair, topology, atlas resolution, bake, rigging and printability.
- Verify explicit false/zero/null semantics and precedence, especially physics, auto-repair, printability, texture resolution and postprocess master toggle.
- Verify raw/postprocess-off requests do not unexpectedly call texture, LOD, collision, repair, bake, rigging or mutating geometry stages.
- **Acceptance:** request-to-consumer map plus planner/scheduler/router tests. Report and wait.

### Batch 4 — Beginner-friendly Generate UI and real Advanced controls

Carry forward the full previous detailed UI specification below; recheck the current dev implementation before editing.

- One clear Target Polycount/output preset surface. No duplicate target/polycount cards, duplicate functions or repeated advanced controls. Beginner flow must not be overloaded with technical inference settings.
- Remove exposed model inference quality/steps/guidance/octree/sampler choices. Adapter profiles are backend-owned and not user sliders.
- Audit the Smart/smart-intent UI, target-polycount card and Advanced settings. Move only real behavior to the canonical flow; remove/hide nonworking Smart or mocked controls rather than renaming them.
- Keep only verified production controls: texture generation/atlas, target polycount, triangle/quad topology, UV, normal/PBR bake, LOD, printability, auto-repair, rigging and physics/collision when the selected feature actually supports them.
- Audit GeneratePanel.tsx, GenerationPresetDrawer.tsx, workspace types/store, builder, callbacks, stale hooks/imports, “build parameters” and every caller. Keep single, batch, rerun and preset contracts consistent.
- Preset selection changes settings only; it must not silently launch a job or override explicit model choice. Explain incompatible model/preset combinations.
- **Acceptance:** visible-control → API field → backend consumer evidence; dead controls removed/disabled; beginner-friendly labels; relevant docs/tests updated. Report and wait.

### Batch 5 — Topology gate and safe hole repair

- Trace skip_repair, minimal_repair and full_repair behavior for Auto-Repair OFF/ON, printability check only, strict mode, native-textured input, quad mode and large open defects.
- Wire canonical vertex/perimeter thresholds from backend/config/quality.yaml to all consumers after auditing all callers.
- Add fixtures for one/many holes, open seams, tubes, concave/non-planar/skinnny boundaries, large perimeter, non-manifold edges/vertices, degenerate faces, floaters and UV preservation.
- Validate actual repair output: remaining holes/boundaries, watertightness, non-manifold and degenerate counts, local surface deviation and texture/material integrity.
- Revert or mark degraded when repair removes meaningful geometry or introduces defects. Keep Auto-Repair OFF non-mutating where that contract is intended.
- **Acceptance:** safe defects repaired, unsafe holes reported, no false “fixed” status. Report and wait.

### Batch 6 — Retopology, remesh, decimation, LOD and fidelity guards

- Trace shell/voxelization/SDF/marching cubes, smoothing, feature remesh, projection, quad/triangle retopology, decimation, memory-safe reduction and LOD operations.
- Compare stage outputs with immediate inputs and master source. Account for expected target-face reduction and UV seam splits separately from unwanted silhouette/feature drift.
- Reuse compare_meshes(), quality_gate() and topology metrics. Add or extend per-stage accept/revert gates only where evidence shows damage. Keep scale-normalized thresholds in canonical quality configuration and test configuration single-source-of-truth.
- Do not run voxel shell reconstruction over healthy watertight geometry unless selected workflow requires it. Protect sharp edges, thin parts, multipart attachments and silhouette; explicitly log fallback when backend/dependency unavailable.
- Verify each LOD is a derivative of the correct render mesh and validation checks geometry, UV and material fidelity.
- **Acceptance:** bad candidates cannot silently replace last safe inputs; raw/native path stays non-destructive; intended simplification is distinguished from destruction. Report and wait.

### Batch 7 — UV, PBR, normals, textures, export and render artifact

- Verify native UV/material preservation versus generated UVs, seam-split vertex counts, normals/crease preservation, tangent convention, normal/AO bake, PBR channels, atlas resolution and texture-stage model choice.
- Do not rebuild a native-textured mesh into a topology with no usable bake source. Distinguish per-view inference resolution from final atlas output resolution.
- Verify Hunyuan Paint/Paint3D supported paths and resolutions separately. Confirm 1K/2K/4K/8K reaches the right consumer; do not blindly pass texture values into every adapter.
- Check whether PBR validator warning/error/exception changes status or is only recorded. Missing maps and failed baking/texturing must be reported honestly; don't synthesize fake semantic maps and claim success.
- Inspect GLB/OBJ/FBX, manifest, thumbnail, viewer and downloads for transforms, geometry, UV/material and artifact identity.
- **Acceptance:** correct game-ready render artifact with real geometry/material status and truthful errors. Report and wait.

### Batch 8 — Physics/collision isolation

- Trace UI flag through builder, request schema, router, scheduler, job metadata, postprocess and result manifest. Verify omitted versus explicit false behavior.
- Validate fast/balanced/precise collision options, decomposition limits, convex-hull fallback, cancellation and artifact errors.
- Run same-source A/B with physics ON/OFF. Render source/final mesh hashes and geometry metrics must not change solely because collision was requested; collision metadata/proxy may change.
- Verify viewer and normal downloads use render assets; only physics/collision inspection routes use collision.glb.
- Physics failure must not corrupt the render mesh or erase an otherwise valid rendered asset.
- **Acceptance:** render and collision outputs remain independent; status and fallback errors are accurate. Report and wait.

### Batch 9 — API routes, hidden mounts and all feature/control wiring

- Inspect FastAPI router registration/prefixes, auth/dependencies, route order/conflicts, direct fetch/download helpers, generation, textured/painting, batch/rerun and manual mesh-tool routes.
- Check repair, remesh/retopo, UV, segmentation, bake, LOD, rigging, physics, PBR, QA, thumbnail, artifact manifest and download paths, including hidden/internal mounts.
- For every visible control/function, classify WORKING (evidence-backed), BROKEN/DISCONNECTED, PLACEHOLDER/MOCKED, CAPABILITY-CONDITIONAL or NOT VERIFIED. Name its API field, actual consumer, output and test evidence.
- Preserve endpoints still used by other pages/tools; don't delete non-generation uses during UI cleanup.
- **Acceptance:** accurate route/control inventory, dead/duplicated/mis-mounted paths identified, each deletion includes a caller audit. Report and wait.

### Batch 10 — Regression tests and representative real-model validation

- Audit and extend existing tests before creating helpers: backend/tests/test_config_ssot.py, test_generation_adapter_regressions.py, test_official_model_parity_contract.py, test_mesh_metrics.py, test_topology_gate.py, test_hole_repair_and_seeds.py, test_postprocess_e2e.py and frontend generationParameters tests/current equivalents.
- Cover seed 0, actual locked kwargs, client override removal, TRELLIS effective steps, small/multiple/concave holes, Auto-Repair OFF/ON, raw passthrough, target reduction, retopology, UV/PBR, textures, physics ON/OFF and correct download artifacts.
- Use at least one representative saved real model output; include native-textured sample if available. Run GPU/model inference and A/B visual quality only when checkpoint/runtime/hardware exist.
- Report every check PASS/FAIL/NOT RUN with exact blocker. Unit tests alone do not prove visual quality or real inference correctness.
- **Acceptance:** complete evidence matrix, hashes/settings for real-output comparisons where available, honest risks. Report and wait.

### Batch 11 — Docs, review, commit and publish

- Sync Docs/TASKS.md, Docs/ARCHITECTURE.md, Docs/DECISIONS.md, Docs/MEMORY.md, Docs/GENERATION-UI-CONTRACT.md, Docs/EXPERIMENTAL-MODEL-SETTINGS.md, Docs/api-documentation.md, Docs/PRD.md, Docs/SYSTEM-BLUEPRINT.md, Docs/CHANGELOG.md, README.md and directly affected adapter/postprocess docs.
- Replace stale historical PASS statements with current evidence. Keep CHANGELOG within repository policy and no duplicated config numbers in docs.
- Re-run config SSOT tests after config changes plus relevant type/lint/syntax/unit/integration tests. Inspect full diff for unrelated files, generated artifacts, secrets, model weights and caches.
- Report remaining broken/mocked/unverified controls, untested hardware paths, commit SHA and push outcome. Push safely to dev only if permitted; never force-push.
- **Acceptance:** scoped reviewed diff, synchronized docs, accurate final report. Stop after handoff.

## Mandatory batch report format

For the completed parallel execution, report: (1) batch and goal; (2) exact files/functions inspected/changed; (3) root cause confirmed vs hypothesis vs not reproduced; (4) reproduction steps and relevant artifact hashes; (5) tests as PASS/FAIL/NOT RUN with reasons; (6) controls/routes status if in scope; (7) commit/branch/SHA and publish status; (8) remaining risks. Stop after the requested work, and request approval for any unapproved numerical inference-profile change.

## Global definition of done

- Each adapter’s locked inference profile is the single numeric source of truth and its effective values match the actual model call, except explicit, documented and user-approved constraints.
- Generate UI is beginner-friendly and contains no fake inference settings; every visible control has a verified API and backend consumer.
- Single generation, batch, preset, rerun and painting paths have deterministic field precedence and consistent contracts.
- master/source.glb stays immutable and remains available independently from production derivatives.
- Holes are repaired safely or reported; a bad cap cannot be called success.
- Retopo/remesh/decimation preserve geometry within validated, mode-appropriate limits or revert/mark degraded.
- UV/PBR/textures/normals, file exports and final artifact identity are checked and truthful.
- Physics/collision cannot replace or damage render geometry.
- Routes/mounts/visible controls are traced end-to-end, including hidden/manual tools.
- Tests/docs represent current behavior; GPU/weights/runtime checks are never fabricated.
- The user authorized all batches for this execution. Numerical inference-profile changes remain separately approval-gated; unrun GPU/runtime validation is not a passing result.

---

## Inherited detailed task specification — preserved for call-site and sub-agent detail

The following content is carried forward from the existing Docs/TASKS.md so the previous Generate Panel cleanup, adapter profile contract, request builder, preset precedence, backend wiring, sub-agent roles, tests, documentation and acceptance requirements remain available inside this single master document. Treat historical PASS statuses as claims to re-verify on the current dev HEAD.

**Purpose:** Mandatory implementation specification for cleaning the Generate panel, removing fake/duplicate controls, making adapter-owned inference settings authoritative, wiring production presets end-to-end, synchronizing docs/tests, and pushing verified changes to `dev`.

**Repository:** `Silentzx2/ForMash3D`  
**Target branch:** `dev`  
**Primary reference:** current `dev` HEAD. Re-fetch and inspect it before editing; line numbers and existing implementation may have changed.

> **MANDATORY EXECUTION DIRECTIVE**  
> This is an implementation task, not a request for advice. Do not stop after analysis, a plan, a diff proposal, or a report. Inspect the live repository, implement the changes, run applicable checks, update documentation, review the final diff, and push to `dev` if repository permissions and branch rules permit. Never claim that tests, builds, or a push succeeded unless their results prove it.

---

## 0. Non-negotiable product decisions

1. **Inference settings live in model adapters.** The owner will tune model-specific steps, guidance, samplers, decoder/extraction resolution, pipeline mode, and model-specific inference flags directly in adapter code. Do not expose duplicate UI controls for them.
2. **Do not retune numerical profiles during this cleanup.** When relocating profile ownership, preserve the *effective values currently used at runtime* for each model and feature path. Resolve scheduler-vs-adapter disagreements by tracing the actual execution path and existing tests—not by guessing.
3. **A visible control must have a real consumer.** Every remaining button/toggle/slider must affect the actual API request and a verified backend consumer, or it must be removed/disabled and clearly labelled as unavailable.
4. **The beginner flow must be simple.** The main panel should focus on image input, model choice/status, genuine texture-output choice, one output-preset/target-polycount section, and Generate. Do not expose inference jargon.
5. **Smart preset logic must be consolidated—not lost.** Move genuinely useful Smart Intent behaviour into the Target Polycount/Output Preset flow and backend preset/planner. Delete redundant Smart UI and dead code only after migrating useful behaviour.
6. **Selecting a preset never starts generation.** It configures the job. The user must deliberately press Generate.
7. **No duplicate Target Polycount or Post-Processing master switch.** One source of truth per setting.
8. **Docs, tests, and implementation must agree.** Do not mark tasks complete or report success if relevant checks have not been run.

---

## 1. Mandatory sub-agent orchestration

The coordinating agent MUST delegate parallel work when sub-agents are supported. If sub-agents are unavailable in the environment, explicitly execute the same workstreams sequentially; do not falsely claim delegation.

### Agent A — Frontend/UI ownership

**Own these areas:**
- `features/workspace/Panels/GeneratePanel.tsx`
- `features/workspace/Modals/GenerationPresetDrawer.tsx`
- `features/workspace/types.ts`
- frontend call sites/state in `features/workspace/store/WorkspaceContext.tsx`
- frontend request-builder tests

**Deliverables:** simplified panel, one target/preset section, clean Advanced section, no exposed inference controls or dead state, preset selection does not auto-submit, and a summary of remaining visible controls with their API field names.

### Agent B — Backend/API/adapter ownership

**Own these areas:**
- `backend/api/routers/mesh_generation.py`
- Smart preset/planner modules and their configuration
- `backend/core/scheduler/multiprocess_scheduler.py`
- all adapters affected by the current scheduler-owned inference profile table
- relevant backend tests

**Deliverables:** traceable API-to-consumer wiring, adapter-owned locked inference profiles, valid preset precedence, rejection/ignoring of unsupported frontend inference overrides, and regression tests.

### Agent C — Tests/docs/quality audit

**Own these areas:**
- audit the existing test layout and documented commands
- `README.md`, `RULES.md`, and relevant `Docs/*.md`
- test execution/reporting and final changed-file coverage matrix

**Deliverables:** docs synced to the final implementation, test plan/results, a list of claims that are proven vs. not runtime-verified, and a check for leftover references to removed controls.

### Coordinator / integrator — mandatory duties

- Inspect the current `dev` HEAD and existing branch state first.
- Give agents disjoint write ownership. Do not allow two agents to independently overwrite the same file.
- Require evidence from each agent: modified paths, exact consumer path, test names/commands, actual results, and unresolved issues.
- Integrate and review the combined diff. Do not accept “looks wired” or “should work” without tracing the value to a consumer.
- Run a repository-wide search for removed names, stale imports, unused types, stale comments, request aliases, and duplicate UI sections.
- Do not let an agent push independently. The coordinator performs the final commit and push after verification.
- If a sub-agent is unavailable, do that workstream yourself. A blocked sub-agent is not permission to omit the work.

---

## 2. Frontend files: precise removal/migration instructions

### A. `features/workspace/Panels/GeneratePanel.tsx`

Inspect the current equivalents of the following symbols/sections before editing; do not rely on line numbers from a previous checkout:

- `MeshQualityPreset`
- `MESH_QUALITY_OPTIONS`
- the `Job Generation Settings: Quality, Mesh Style & Advanced Options` section
- Smart Intent / intent buttons and their handler (previously `applyIntentPreset`)
- `T-06: Candidate Variations (Pick-Best-of-N)`
- `Post-Processing Pipeline Master Toggle`
- `Unified Production Target & Polycount Budget`
- `Object Type & Symmetry`
- `Streamlined Mesh Settings Card (Target Polycount + Triangle / Quad Topology ONLY)`
- `Engine Feature Toggles: PBR Texture & Low VRAM`
- FlashVDM and Low VRAM UI controls
- Advanced crease threshold, texture-fidelity, and model-quality controls

#### Remove from the user-facing generation UI

- The Fast/Balanced/High inference-quality selector and any separate Low/Medium/High/Ultra control that changes or claims to change model inference quality.
- Duplicate target-polycount inputs/cards. Keep exactly one user-facing target/polycount control in the main panel.
- Duplicate post-processing master switches. Keep exactly one master switch; every dependent production control must respect it.
- Mesh-style, object-type, and symmetry settings if no verified generation/post-process consumer exists. Do not retain them just because request fields exist.
- Low VRAM, FlashVDM, inference-step, guidance, extraction-resolution, sampler, crease-threshold, or texture-fidelity controls when they bypass the adapter-owned profile or have no supported end-to-end implementation.
- Any state, constants, imports, helper functions, labels, explanatory text, or event handlers made unused by those removals.

#### Move/retain in the simplified main panel

- Image upload/selection, genuine generation preview/manual-edit flow, model selection and honest availability/loading status.
- Textured Generation and texture-atlas selection **only after** proving they reach the proper texture-generation or post-processing consumer for each supported model path. Preserve compatibility differences between raw-mesh models and models that natively produce textured geometry.
- One compact **Target Polycount / Output Preset** card.
- Generate and genuine queue behaviour (for example Queue Next), with clear disabled/loading/error states.

#### Consolidate presets inside the Target Polycount card

Use the existing backend preset IDs/configuration if supported, such as:

- `mobile`
- `game_ready`
- `cinematic`
- `animation`
- `3d_print`
- `native` / raw geometry

Keep the existing canonical IDs if the backend uses different names; do not invent IDs without updating both sides.

The card should show a compact preset grid plus one optional polycount control. Show the effective target value. The native/raw selection must actually remove downstream budget/production overrides and request a raw/native path; it must not merely change its selected styling.

On selecting a production preset:

1. Resolve/validate its backend intent using the existing API/preset definitions.
2. Set or submit only the production choices the preset actually owns: target budget, texture defaults, LOD, UV, collision/physics, QA, repair, and rigging as applicable.
3. Preserve the user's explicit model choice. Do not silently swap the selected model without a clear product rule and visible explanation. If a preset needs a capability the selected model lacks, show a clear incompatibility/error or use backend auto-selection only when the model is explicitly in auto mode.
4. Do not automatically call `generate3DModel`, `queueGenerationJob`, or another submission handler from a preset click.
5. Let the user press Generate to submit.
6. A manual polycount or manual texture-atlas change must clear/deactivate the incompatible preset intent, or explicitly update the preset state so the UI and request cannot disagree.
7. Ensure selecting Native/Raw disables or clears incompatible texture, LOD, collision, QA, repair, rigging, and target-budget options.

Do not duplicate an existing working backend recipe table in the UI as a second source of truth. If preset details already come from the API, render those values. If a fallback is necessary, keep it minimal, documented, and covered by a parity test against backend presets.

#### Advanced Generation — keep only proven production settings

Move only genuine production features into Advanced, and make their relationship to the master post-processing toggle obvious. Candidate options to audit include:

- Candidate variations (1–4), if candidate scheduling, seed stepping, result tracking and candidate selection work end-to-end.
- Triangle / quad topology, only if the actual retopology/geometry pipeline consumes it.
- UV processing, if there is a real consumer.
- Normal-map baking, if it reaches a real bake step.
- Printability checks, auto-repair, auto-rig, and physics/collision setup when each has a real backend consumer.
- LOD creation, LOD preset and LOD count if they reach the production pipeline.

Avoid a complicated wall of fields. Use plain names and short explanations. Put highly technical options in a separate professional/experimental tool if they are genuinely useful but do not belong in a beginner generation workflow.

For each retained UI control, record this chain in the change summary:

`UI state → request builder field → API schema/handler → scheduler/post-process consumer → observable result/artifact/diagnostic`.

If a link is missing, either implement and test the link or remove the control. Do not fake a successful state.

### B. `features/workspace/Modals/GenerationPresetDrawer.tsx`

Audit this drawer for the model parameter schema editor and the following kinds of UI:

- inference steps
- guidance scale
- model-specific inference parameter fields
- advanced model-parameter JSON
- save/load/import/export of model-inference overrides

Remove inference parameter editing from the ordinary Generate workflow. If the drawer remains useful, turn it into a simple output-recipe manager (output settings and seed/reproducibility only), or remove it from the Generate workflow if it is not used and has no clear product value.

Legacy saved JSON compatibility rules:

- Do not crash when importing an older preset that includes `modelParameters` or `modelParameterOverrides`.
- Safely ignore legacy inference override values; never merge them into the generation request.
- Do not silently corrupt valid output-preset data while dropping inference-only fields.
- Keep import-size, validation, and storage-error handling if the drawer remains.

Remove unused imports/state/hooks/schema requests after removing the editors. Do not leave hidden controls or dead handlers behind.

### C. `features/workspace/types.ts`

Remove generation-only fields that no longer have a legitimate consumer, after searching all references:

- `quality` / `requested_quality`
- `meshStyle` / `mesh_style`
- `objectType` / `object_type`
- generation `symmetry`
- `modelParameterOverrides`
- `sharpFeaturePreservation`
- `angleCreaseThreshold`
- `textureFidelityPreset`

Keep similarly named settings used by other tools (for example sculpt symmetry or texture-tool Low VRAM) if they are independent, active features. This is not a repository-wide blind string deletion; scope changes to the generation flow being refactored.

### D. `features/workspace/store/WorkspaceContext.tsx`

Inspect every call site of `buildGenerationParameters`, not just the main Generate button. The code has previously used model-parameter defaults/schema state in the normal generation and batch-generation paths.

- Remove the generation-only model-parameter defaults fetch/cache/state if it exists solely to populate the deleted inference UI or inject inference overrides.
- Remove the corresponding builder arguments and stale `useEffect`/`useCallback` dependencies.
- Update primary generation, batch generation, retry/re-run, comparison, and saved-preset paths so they all use the same adapter-owned inference contract.
- Ensure that image/file IDs, approved preprocessing artifact IDs, candidate count, target output budget, texture flags and production options are not accidentally lost.
- Do not alter unrelated model tools or other features using the same context.
- Type-check every call site after editing.

---

## 3. Request builder — mandatory audit and simplification

**File:** `features/workspace/utils/buildGenerationParameters.ts`

Treat this file as a high-risk integration boundary. Audit the existing function and every caller before changing it.

### Required responsibility

The builder serializes user-approved generation/output intent. It must not maintain or merge a second model inference profile.

Keep fields that are proven necessary, typically:

- image identity (`image_file_id` or validated image payload)
- explicit model preference, when selected
- seed, if supported by the adapter contract
- candidate count as a scheduler-level control, not a model sampler override
- target polycount as a downstream production budget
- texture-generation settings and resolution when supported by the API/pipeline
- post-processing enable/disable
- LOD/UV/topology/QA/repair/rigging/physics settings when proven to have real consumers
- approved preprocessing artifact and explicit review override
- asset/input names and output format

### Remove from inference request construction

- Frontend quality tiers and aliases used to manipulate inference quality
- Generic model parameter defaults merged with user overrides
- `modelParameterOverrides` as an inference override mechanism
- arbitrary UI sampler/resolution/step/guidance/Low-VRAM fields
- model-style/object-type/symmetry fields without real consumers
- stale aliases and duplicate fields that cause different parts of the backend to read different values

Keep `parseModelParameterOverrides` only if there is a legitimate compatibility/validation use elsewhere. It must not be used to sneak removed model parameters into image-to-3D inference.

### Builder contract tests

Add/repair tests in `features/workspace/lib/generationParameters.test.mjs` (or the repository's current corresponding test file) covering at least:

1. UI-provided `quality`, `meshQuality`, `requested_quality`, `num_inference_steps`, `guidance_scale`, `octree_resolution`, sampler dictionaries and Low-VRAM overrides do not reach model inference.
2. The request sends only supported runtime inputs (including a supported seed) as adapter inputs.
3. `candidate_count` is bounded by the API-supported range and stays a scheduler control.
4. `target_polycount` is independent of inference parameters and goes to the production path.
5. A selected intent/preset is sent as the expected backend field without auto-submitting from the preset click.
6. Explicit production choices and defaults have predictable precedence.
7. Raw/post-processing-off mode does not accidentally invoke texture, LOD, collision, repair, printability, normal baking, or rigging.
8. Missing/invalid image input produces a clear failure before submission.
9. Legacy saved presets containing old inference override keys cannot reintroduce those values.
10. Primary Generate, batch, retry and saved-preset call sites produce compatible request shapes.

Avoid broad `any` casts to silence failures. Fix type errors at the boundary.

---

## 4. Backend API, Smart preset and planner wiring

Inspect the live versions of:

- `backend/api/routers/mesh_generation.py`
- the Smart preset/intent resolver and preset configuration
- `backend/core/planner.py` and associated planner rules, where applicable
- `backend/core/scheduler/multiprocess_scheduler.py`
- `backend/postprocess/pipeline.py` and any downstream retopology/UV/texture/LOD/QA/physics modules

### A. Prove the consumer chain

For every retained field, trace it from API schema to the actual consumer. A field being present in a Pydantic schema or metadata dictionary is not proof that it works.

Specifically audit:

- `intent` / Smart preset ID
- `model_preference`
- `target_polycount`
- `candidate_count`
- texture enabled/resolution and normal-map baking
- `enable_postprocess`
- LOD and UV options
- triangle/quad topology
- printability, repair, rigging and physics
- any old `requested_quality`, `mesh_style`, `object_type`, or `symmetry` fields

### B. Preset/default precedence

Implement a deterministic contract:

1. The backend resolves a recognized intent using its canonical preset definition.
2. The preset supplies defaults for production choices not explicitly supplied by the caller.
3. Explicit, supported Advanced settings override the preset values.
4. A manual target or texture change must not leave a contradictory active intent in the request.
5. If the selected model is explicit, respect it or return a clear capability error; do not silently replace it with a preset recommendation.
6. If model selection is intentionally automatic, the backend may choose a compatible model from preset/capability rules.
7. Selecting Native/Raw means no downstream production budget or output stages are accidentally applied.

Beware of boolean defaults. A plain `False` default can make it impossible to distinguish “the user explicitly turned this off” from “the caller omitted the field, so use the preset default.” Use an appropriate explicit tri-state/field-presence contract where necessary, and test it. Do not convert a preset's `true` to `false` merely because the UI's generic state was initialized to false.

### C. Remove fake request fields

Delete unused API request fields and validators for `requested_quality`, `mesh_style`, `object_type`, and `symmetry` only after a repository-wide search proves they have no supported non-generation consumers. If internal planner fields remain useful, keep them internal and derive them server-side rather than pretending the UI directly controls them.

Keep backwards compatibility for external clients where required, but do not let removed fields override locked inference values. If a deprecated field is retained temporarily, explicitly ignore it or return a documented validation/deprecation behaviour; add a regression test.

### D. Candidate variations

Verify that candidate count causes actual scheduler jobs/seed variations, that candidates are tracked, and that preview/promote endpoints receive working IDs. If ranking/scoring is not genuinely performed, do not claim “AI best-of-N scoring”; either wire real ranking or label it accurately as “generate N variations”.

### E. Raw output budget isolation

A target polygon/triangle count is an output-production budget. Confirm it affects only the downstream production derivative and does not reduce the raw source mesh inference profile. Keep a regression test that would fail if target-polycount leaks into adapter inference.

---

## 5. Adapter inference profile migration — do not miss models

Inspect the current scheduler table, previously named `_RAW_MESH_MAX_QUALITY_PARAMETERS`, and every entry in it. It has previously included multiple aliases/feature paths for Hunyuan3D Shape, Hunyuan3D DiT Mini Turbo, TripoSG, Pixal3D, Unique3D, TRELLIS, TRELLIS.2 and TaoFlowForge.

Do not remove the scheduler table until every profile entry has been accounted for.

For every entry, produce a temporary mapping during implementation:

| Model/feature ID | Current effective runtime values | Current adapter defaults/call arguments | New adapter-owned source | Test proving parity |
|---|---|---|---|---|
| Each current table entry | Explicit values | Actual call-site values | Specific adapter method | Named regression test |

The mapping must include aliases and raw/textured/painting differences. One adapter class can contain separate methods and model IDs; do not assume all operations share the same profile.

### Required method

1. Read the scheduler's current effective profile.
2. Follow `_build_model_inference_inputs` and the worker path to the actual adapter invocation.
3. Check the adapter schema defaults and actual `_process_request` reads/call arguments; schemas may not match the effective forced profile.
4. Move only the intended fixed inference values to the adapter implementation or a single adapter-owned constant used only by that adapter.
5. Remove the scheduler's duplicate numerical profile for that entry.
6. Make the scheduler filter production/planner controls and reject/ignore UI inference overrides without overwriting adapter-owned constants.
7. Assert the adapter is called with the intended locked values. Keep profile values stable in this refactor.
8. Run relevant tests for each affected adapter and compare the old effective profile against the new adapter call.

**Important known audit targets from an earlier inspection (re-verify on current HEAD):**

- `backend/core/scheduler/multiprocess_scheduler.py`: scheduler-owned profile table and `_build_model_inference_inputs`.
- `backend/adapters/hunyuan3d_shape_v21.py`: earlier scheduler profile forced a different `num_chunks` than the adapter fallback.
- `backend/adapters/triposg_adapter.py`: earlier scheduler profile and adapter fallback differed for decoder-depth inputs.
- `backend/adapters/pixal3d_adapter.py`: earlier scheduler profile overrode resolution, sampler dictionary, and low-VRAM state.
- `backend/adapters/trellis2_adapter.py`: earlier scheduler profile overrode token budget and stage sampler dictionaries.
- `backend/adapters/trellis_adapter.py`, Hunyuan DiT/Shape, Unique3D and TaoFlowForge: inspect every corresponding entry and call path, not just the examples above.

These are audit leads, not permission to assume the current values. Verify the checked-out code and tests first.

### Scheduler filtering

The scheduler must continue to pass legitimate shared inputs such as image paths, a supported seed, output format and any explicitly approved runtime fields. It must keep target polycount, texture requests, candidate scheduling, QA, LOD and other downstream options separated from model inference. Avoid a blanket “allow only seed and image” rewrite unless every adapter's legitimate contract has been proven; image-to-3D and mesh-painting feature paths may differ.

---

## 6. Keep Advanced settings real and beginner-friendly

The Advanced section should contain only meaningful production options that are not needed on every basic generation job.

For every retained option, define:

- visible label and default
- enabled/disabled condition
- exact request field
- API field and default semantics
- downstream consumer
- expected artifact/result/diagnostic
- automated test

Audit whether the backend truly supports the setting in the currently selected mode. Examples:

- “Quads” must execute a real quad-dominant retopology step—not just toggle `quad_topology` in JSON.
- “Bake normal maps” must reach a real normal-map baking stage—not merely set a metadata flag.
- “Physics Ready” must produce/attach appropriate physics/collision data—not just label the asset.
- “Auto-Rig” must invoke the supported rigging stage and surface an actual result or actionable failure.
- “Printability” and “Auto-Repair” must call the intended QA/repair stages with distinct check-only vs mutation semantics.
- “LOD” must result in the expected LOD artifacts and not merely store LOD settings in metadata.
- “Textured Generation” must trigger a supported texture path and produce a textured asset or clearly report unsupported capability.

If a control is only partially supported, either complete its wiring and test it or remove it from this panel. Do not paper over missing implementation with a disabled visual that looks interactive.

Keep UI copy concise. Avoid exposing sampler keys, octree depths, arbitrary JSON, model schema fields, or other implementation details in the normal Generate flow.

---

## 7. Test and verification requirements

Discover the repo's actual scripts and environment first. Do not invent package scripts or Python commands. Use the actual `package.json`, lockfile, `pyproject.toml`, `pytest.ini`, and existing CI workflow.

### Frontend

- Run the repository's applicable TypeScript/type check.
- Run relevant unit tests for the request builder and Generate panel if present.
- Run the frontend production build if dependencies/environment permit.
- Verify no broken JSX/TSX, stale imports, unused references, accidental duplicate controls, or invalid settings types.
- Verify Smart preset clicks do not submit generation jobs.
- Verify at runtime or component tests that a preset's visible selected state matches the serialized request.

### Backend

- Run focused API/request-schema, planner, scheduler and adapter regression tests.
- Run the broader documented backend test suite if practical.
- Assert that incoming inference override values cannot beat adapter constants.
- Assert effective profile parity for all migrated scheduler table entries/aliases.
- Assert target polycount does not reach adapter inference and does reach the downstream production budget.
- Assert omitted preset fields receive the intended defaults and explicit false/zero values still override preset defaults where the UI supports them.
- Assert unsupported model/preset combinations fail clearly rather than silently routing or pretending success.

### Static search/acceptance checks

Search for remaining generation references to:

- `MESH_QUALITY_OPTIONS`
- `requested_quality`
- `mesh_style`
- `object_type`
- generation `symmetry`
- `modelParameterOverrides`
- `num_inference_steps` and `guidance_scale` in user-facing generation controls
- duplicate Target Polycount labels/sections
- duplicate post-processing master toggles
- stale imports/hooks for deleted UI controls
- scheduler `_RAW_MESH_MAX_QUALITY_PARAMETERS` after migration

Some terms may legitimately remain in adapters, internal diagnostics, schemas needed for external APIs, tests, docs, sculpt tools, or other non-generation workflows. Audit each match by context; do not blindly delete unrelated uses.

### Report verification accurately

Classify each check as `PASS`, `FAIL`, or `NOT RUN`, and state why. If no GPU/model weights are available, mark real inference/quality benchmarking as `NOT RUN`; do not infer it from unit tests.

---

## 8. Documentation synchronization — mandatory

All documentation targets have been synchronized to reflect the actual architecture and contracts:

- `README.md` — Updated user-facing generation options (clean studio, output recipes `mobile`, `game_ready`, `cinematic`, `animation`, `3d_print`, `native`), and clarified the immutable `master/source.glb` vs derived production mesh distinction.
- `RULES.md` — Codified the adapter-owned inference contract, the "no control without a verified consumer" rule, and mandatory honest test/verification classification.
- `Docs/ARCHITECTURE.md` — Documented the 6-tier pipeline responsibility boundaries (Presentation UI $\to$ Request Builder $\to$ API Gateway $\to$ Multiprocess Scheduler $\to$ Model Adapters $\to$ Production Pipeline) with Mermaid workflow and exact data flow boundaries.
- `Docs/DESIGN.md` — Documented the simplified Generate studio panel layout (primary image + model + recipe flow) and the clean Advanced production drawer (candidate count 1–4, quad/tri, UV, normal baking, LODs, repair, physics colliders).
- `Docs/api-documentation.md` — Documented actual supported request fields, preset precedence rules, stripped/ignored inference override fields, and production artifact trees.
- `Docs/DECISIONS.md` — Recorded ADR-056 (initial adapter-owned profiles) and ADR-057 (adapter profile migration completion and Generate studio UI simplification).
- `Docs/CHANGELOG.md` — Documented the implementation summary under the 3-entry changelog window.
- `Docs/TASKS.md` — Status and checklist updated with verified evidence and accurate test classifications.
- `Docs/MEMORY.md` — Added comprehensive handoff note capturing verified contracts, UI changes, and invariants.
- `Docs/GENERATION-UI-CONTRACT.md` — Canonical specification detailing the end-to-end contract from UI to production pipeline.

---

## 9. Git workflow and push requirements

1. Fetch/inspect the latest `dev` branch head before editing.
2. Confirm there are no unreviewed user changes to overwrite. Never force-reset, force-push, or rewrite shared history as a shortcut.
3. Implement changes in a branch/worktree or on the task branch according to the available environment.
4. Review the final diff and confirm only relevant files changed.
5. Run tests/checks and document any unavailable checks honestly.
6. Commit with a descriptive message such as `refactor: simplify generation UI and lock adapter inference profiles`.
7. Push to `dev` only if the repository access and branch rules permit it. Use non-force push. If direct push is rejected, open a PR or report the exact permission/branch-protection blocker; do not claim it was pushed.
8. Report commit SHA, branch, changed files, test results, and remaining risks.

---

## 10. Definition of Done & Quality Audit Verification Matrix

### Verification Status by Gate

| Gate | Requirement | Verification Method | Result | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **G-01** | Generate panel has one canonical output-intent/budget surface | Source audit and frontend contracts | **PASS (source-level)** | Current panel/request behavior was inspected; no visual browser verification was run. |
| **G-02** | No unbacked inference-quality selector or deformation control | Source audit and frontend contracts | **PASS (source-level)** | Adapter-owned inference remains separate; disconnected jiggle/deformation UI was removed. |
| **G-03** | Preset selection does not auto-submit | Source audit | **PASS (source-level)** | Preset selection updates settings; submission remains an explicit Generate action. |
| **G-04** | Explicit model, seed and production settings retain their intended precedence | Frontend/backend contract tests | **PASS** | Request and seed regression coverage; explicit seed zero and explicit model choice are covered. |
| **G-05** | Request builder does not duplicate adapter-owned inference profiles | Adapter and scheduler regression tests | **PASS (source-level)** | Adapter profiles remain authoritative and request-side overrides are filtered. |
| **G-06** | Adapter profile ownership and call-site constraints are documented honestly | Profile regression tests and source audit | **PARTIAL** | Tests cover ownership/isolation. The TRELLIS configured/effective step discrepancy remains unresolved pending approval; GPU behavior is NOT RUN. |
| **G-07** | Production controls and quality outcomes have verified consumers | Backend and frontend contract tests | **PASS (source-level)** | Coverage includes topology repair, quality outcome, collision isolation, hash contract, seed and request behavior; optional stages are runtime-conditional. |
| **G-08** | Main/sample request paths preserve the generation contract | Frontend request-builder tests and source audit | **PASS (source-level)** | Sample SVGs use the image upload path; queue/batch runtime behavior was not exercised in a deployed environment. |
| **G-09** | Frontend regression tests cover request and import contracts | Bun tests | **PASS** | `bun test` ran 52 tests across 10 files; all passed, including request builder, route, contextual-help and graph re-export contracts. |
| **G-10** | Backend CPU regression tests cover the changed contracts | Python 3.10 full suite plus targeted config SSOT tests | **PARTIAL** | The Python 3.10 full run passed 50 tests with one existing SQLAlchemy deprecation warning before the final UI-config parity assertion was added. Both config SSOT tests pass under Python 3.14; the full suite was not rerun there because its Python 3.10 test dependencies are absent. GPU inference and model-output benchmarking are NOT RUN. |
| **G-11** | Directly affected documentation matches source behavior | Doc review | **PASS (scoped)** | README, CONTRIBUTING, API, architecture, PRD, system blueprint, task/master audit, memory, decisions, changelog, generation contracts and postprocess README updated. |
| **G-12** | Frontend type, lint and production-build checks | TypeScript / ESLint / build | **PASS (with warnings)** | `bun run test`, `next build`, and targeted ESLint on changed frontend files passed; ESLint reported 0 errors and 58 warnings. Browser interaction is NOT RUN. |
| **G-13** | Final diff review, commit and publication | Git status/diff and remote operations | **NOT RUN** | Changes remain uncommitted at this checkpoint; commit/push/PR are pending. |

---

## 11. Static Acceptance Search Findings

1. `MESH_QUALITY_OPTIONS`:
   - Absent from the repository. The Generate panel exposes no inference-quality selector.
2. `requested_quality` / `meshQuality`:
   - Still present in the router schemas (`mesh_generation.py`) as deprecated fields, and stripped by the scheduler in `_ADAPTER_OWNED_INFERENCE_INPUTS`.
   - The scheduler properly strips these from reaching adapter-owned models; the API only uses them for planner routing.
3. Legacy inference overrides:
   - They are not supported by the active Generate request contract. The request builder forwards the runtime seed, and adapter-owned inference values are not user-editable overrides.
4. Auto-submit on Preset Click:
   - Absent. `selectOutputPreset` only updates the settings state; the only `pendingGenerateRef` write belongs to the explicit Generate action.
5. LOD controls (new finding, 2026-10-21):
   - The Advanced drawer exposed an LOD toggle, ratio preset, and level count that the request builder never serialized, so the user's LOD choice was discarded before reaching the pipeline.
   - Fixed by ADR-093: `generate_lod` / `lod_preset` / `lod_count` are first-class request fields, the level count is clamped to the four levels the pipeline can build, and the legacy `model_parameters` LOD keys are explicitly ignored.
6. Boolean-default masking (new finding, 2026-10-21):
   - `enable_auto_repair`, `enable_printability_check`, `enable_auto_rig`, `physics_enabled`, and `texture_resolution` were resolved with `request_value or preset_value`, so an explicit `false` could not disable a preset-enabled stage, and the preset's atlas size could never apply.
   - Fixed by ADR-093: those fields are tri-state (`None` = not supplied) and resolved as explicit value > intent preset > backend default.
7. Preset budget duplication (new finding, 2026-10-21):
   - The panel hardcoded a second copy of the preset budgets and the mobile preset declared an atlas size the API rejects.
   - Fixed: the panel derives the chip summary from the backend catalogue, the offline fallback table is `constants/smartPresetFallback.json` (parity-tested by `backend/tests/test_smart_preset_parity.py`), and the mobile atlas size is 1024.

Historical publication notes from earlier 2026-10-21 work do not describe this execution. Current changes remain uncommitted until final review and safe publication.

**Do not declare success if any required gate was silently skipped.** If a gate cannot be completed, state the blocker, complete the remaining work, and leave the task explicitly partially verified rather than inventing a pass.


---

## 12. Deferred P0 Task Plan — Postprocess Mesh Integrity, Hole Repair & Physics

**Status: Source fixes and CPU regression tests are implemented under the current all-batches authorization; runtime reproduction remains unverified.**
**Current verification status: CPU tests are recorded in the final matrix; real-model/physics A/B and deployment validation remain NOT RUN.**
**Execution rule: all batches are authorized for this execution; report source evidence and runtime limitations without claiming an unobserved visual-quality result.**

### Reported failure to reproduce

- Model-generation output may already contain many visible/open holes.
- The generated mesh reportedly becomes substantially worse after production post-processing, potentially appearing nearly destroyed.
- Determine the exact first stage where holes remain, new holes appear, surface details disappear, the silhouette changes, or topology degrades.
- Determine whether the visible asset is the actual game-ready render mesh or an incorrect preview/download of the physics collision proxy.
- Preserve the immutable master/source.glb; never overwrite it to hide a bad derivative.

### Source-audit leads — hypotheses to verify, not runtime-confirmed diagnoses

1. **A failed topology gate does not guarantee full repair.** In backend/postprocess/pipeline.py, full_repair reaches structural run_repair(...) only when _should_run_structural_repair(...) accepts the auto-repair flag. Otherwise the pipeline can continue with a copy of the defective source. Establish the intended product contract for explicit Auto-Repair OFF and make the resulting state honest (repaired, deliberately preserved with a warning, or degraded/failing); never silently claim that a rejected mesh was fixed.
2. **The configured hole-perimeter limit may not be enforced by the production call.** backend/config/quality.yaml defines holes.max_hole_perimeter, and repair_holes_targeted(...) accepts max_hole_perimeter, but the call in pipeline.py supplies only max_hole_vertices. Trace the call chain and config source of truth; do not hardcode a second numeric threshold.
3. **Hole-fill triangulation needs adversarial geometry coverage.** backend/postprocess/services/hole_repair.py uses a fan-style triangulation for larger loops. Verify concave, highly non-planar, skinny, self-intersecting/ambiguous and large-perimeter loops. Do not assume a closed boundary means the fill is geometrically valid.
4. **The current optimization guard is too narrow to prove surface fidelity.** _quality_guard(...) checks finite vertices, face count, bounding-box drift and vertex growth. It is applied after optimization, not as a general acceptance gate after topology repair, AutoRetopo or the high/ultra feature-remesh path. Reuse backend/core/quality/evaluation.py (compare_meshes, quality_gate) and existing mesh metrics where practical, and verify whether final source-to-derivative checks reject or merely report damage.
5. **Retopology/remesh can be a destructive stage.** Trace the actual calls and options into backend/postprocess/services/autoretopo/, especially shell reconstruction, smoothing, projection and decimation. Compare stage outputs with their immediate inputs and the immutable master instead of diagnosing from the final file only.
6. **Physics/collision appears to produce a separate artifact.** The production pipeline loads the game-ready render mesh, passes it into run_collision(...), and writes collision.glb plus physics metadata. Verify artifact routing end-to-end: physics processing must not replace the render asset, and preview/download must not mistake the collision proxy for the model. Also verify the physics flag defaults when request fields are absent.
7. **Existing unit tests are not a substitute for reproducing this report.** Mesh-metric and topology-gate tests use synthetic fixtures, while the full postprocess runtime test is opt-in. Review their actual coverage and record real generated-model checks as NOT RUN until executed with suitable assets/dependencies.

### Batch 1 — Reproduce and pinpoint the first destructive stage

**Scope:** instrumentation/reproduction plan and minimal diagnostic harness only; no speculative quality retuning.

- Use the same immutable raw source for every comparison. Record model ID, input hash, seed, requested target polycount, output preset/quality mode, topology mode, auto-repair, texture/UV/bake, LOD and physics flags.
- Record per-stage mesh counts and topology metrics: vertices, faces, boundary edges/loops and loop sizes, watertightness, non-manifold edges/vertices, degenerate faces, connected components/floater ratio, normals, bounds and volume where meaningful.
- Compare master/source.glb against the post-repair, retopo, feature-remesh, optimize/decimate, UV, textured and final game-ready meshes. Reuse existing quality_trace and quality metrics before adding instrumentation.
- Save stage summaries/hashes and enough diagnostics to identify the first stage that introduces or preserves damage. Do not use the collision proxy as the render-mesh comparison target.
- Reproduce with post-process ON/OFF and the relevant combinations of target polycount, Auto-Repair, quad retopology, texture/UV and physics. Keep all other inputs fixed during each A/B comparison.
- **Batch 1 acceptance:** identify a reproducible stage/path for holes and quality loss, or document exactly why reproduction is blocked. No cause may be labelled confirmed without evidence.

**Stop after Batch 1** and report findings, files/metrics inspected, PASS/FAIL/NOT RUN status and the proposed smallest root-cause fix. Wait for the user's explicit proceed before Batch 2.

### Batch 2 — Hole detection, repair routing and safe fill

- Trace topology metrics -> gate decision -> minimal repair/full repair -> downstream remesh, including the behavior when Auto-Repair is explicitly disabled.
- Make configured hole thresholds flow from backend/config/quality.yaml to every relevant consumer; remove/avoid duplicated numeric defaults only after auditing all callers.
- Pass and test the perimeter limit if the audit confirms it is intended to constrain production hole filling.
- Add tests for one hole, many holes, concave loops, non-planar loops, loops above the vertex/perimeter threshold, non-manifold input, disconnected floaters and UV/native-texture preservation.
- Verify holes_filled, holes_remaining, boundary-edge counts and actual mesh validity agree. If a hole cannot safely be filled, retain the evidence and report a degraded result rather than adding a damaging cap.
- Preserve original geometry wherever repair is unnecessary. Any structural rebuild must be an explicit, measured decision, not a blanket operation.

### Batch 3 — Retopology, remesh, decimation and geometry-fidelity guards

- Trace every mutating operation in backend/postprocess/pipeline.py and backend/postprocess/services/autoretopo/, including voxel/shell reconstruction, Taubin smoothing, projection, isotropic remesh and decimation.
- Compare each candidate against its immediate input and canonical source using existing compare_meshes(...) / quality_gate(...) where appropriate, plus topology checks. Confirm whether these checks currently reject a result or only populate metadata.
- Add an acceptance/revert policy for a stage only after selecting defensible, scale-normalized thresholds and covering clean and defective fixtures. Store thresholds in the canonical quality configuration, not new scattered literals.
- Ensure no post-process stage is allowed to erase critical silhouette/detail or materially degrade topology while still reporting success. Record intentional target-polycount loss separately from unintended surface drift.
- Validate that UV seam splitting, normals, native materials and PBR data remain consistent and are not misdiagnosed as geometry changes.

### Batch 4 — Physics/collision isolation and artifact correctness

- Confirm physics_enabled tri-state/default behavior from UI request builder through API, scheduler and pipeline; omitted and explicit false must have documented, deterministic semantics.
- Verify collision decomposition (fast / balanced / precise) and convex-hull fallback consume the finalized render mesh but write only physics artifacts and metadata.
- Compare render game_ready/*.glb hashes and geometry metrics for physics ON vs OFF with every other setting fixed. They must not change solely because collision generation was requested.
- Verify viewer, preview, download URLs and manifest entries use the render asset for normal model display and use collision.glb only for explicit physics/collision inspection.
- Test collision failure/fallback separately from render-mesh success; physics failure must not corrupt or replace the render mesh.

### Batch 5 — Regression tests, actual-model validation and docs

- Review and extend existing coverage before adding helpers: backend/tests/test_mesh_metrics.py, backend/tests/test_topology_gate.py, backend/tests/test_hole_repair_and_seeds.py, backend/tests/test_postprocess_e2e.py, and the existing post-process quality tests.
- Include synthetic regression fixtures and at least one representative real model output when it is available. Test raw/native passthrough, a modest target reduction, a low target reduction, defective topology, Auto-Repair OFF/ON, quad remesh, UV/texturing and physics ON/OFF.
- Run the applicable test commands and report each as PASS, FAIL or NOT RUN with exact dependency/GPU/fixture blockers. Do not claim visual or model-level quality passed based on unit tests alone.
- Sync Docs/ARCHITECTURE.md, Docs/DECISIONS.md, Docs/MEMORY.md, Docs/TASKS.md, and user-facing post-process/physics docs to the verified behavior. Update backend/tests/test_config_ssot.py coverage if canonical config changes.
- Review the final diff; do not push implementation fixes until the user has approved each batch and the required verification is complete.

### Deferred task acceptance criteria

- The original master/source.glb remains immutable and independently downloadable.
- Every stage reports its mesh input/output and enough quality evidence to locate regressions.
- Open holes are either safely repaired or explicitly reported; they are not silently hidden behind a successful status.
- The final render mesh passes topology and surface-fidelity checks appropriate to its selected output mode, or is honestly marked degraded.
- Physics/collision artifacts remain separate from the render mesh and do not degrade it.
- Batch boundaries are strict: one authorized batch per user proceed; stop and report after each batch.




---

## Additional implementation detail — source map and validation artifacts

### Important source files to read before editing

| Area | Primary paths (expand by searching all callers) |
|---|---|
| Contract/docs | RULES.md; Docs/ARCHITECTURE.md; Docs/GENERATION-UI-CONTRACT.md; Docs/EXPERIMENTAL-MODEL-SETTINGS.md |
| Generate UI/state | features/workspace/Panels/GeneratePanel.tsx; features/workspace/Modals/GenerationPresetDrawer.tsx; features/workspace/types.ts; features/workspace/store/WorkspaceContext.tsx |
| Request building | features/workspace/utils/buildGenerationParameters.ts; frontend generationParameters test file and every caller |
| API/routing | backend/api/routers/mesh_generation.py; backend/api/routers/system.py; main FastAPI app/router mount source; UI fetch/download references |
| Scheduler/planner | backend/core/scheduler/multiprocess_scheduler.py; backend/core/planner.py; active planner rules YAML; registry/manifest/capability configuration |
| Adapter profiles | backend/adapters/*.py for each registered model/alias; specifically backend/adapters/trellis_adapter.py; tests for generation adapter regressions and official-model contract |
| Quality/topology | backend/config/quality.yaml; backend/core/quality/metrics.py; backend/core/quality/evaluation.py; backend/postprocess/services/gate.py; hole_repair.py; repair.py |
| Postprocess | backend/postprocess/pipeline.py; services/autoretopo/shell.py; services/autoretopo/remesh.py; services/memory_safe_decimate.py; services/simplify.py |
| UV/PBR/texture/physics | backend/postprocess/services/autouv/*; bake/PBR validation modules; backend/postprocess/physics.py; backend/postprocess/services/collision.py; texture-stage helpers and Paint3D/Hunyuan Paint adapters |
| Tests/docs | backend/tests/test_config_ssot.py; test_generation_adapter_regressions.py; test_official_model_parity_contract.py; test_mesh_metrics.py; test_topology_gate.py; test_hole_repair_and_seeds.py; test_postprocess_e2e.py; Docs/TASKS.md; Docs/MEMORY.md; Docs/DECISIONS.md |

Paths can change. Inspect the latest dev tree and confirm current paths before editing; this table is a starting map, not authorization to create duplicate modules.

### Current source-audit facts to re-check

- TRELLIS locked profile requests 100 sparse/SLAT steps, while effective runtime code caps the two stage steps to 50. Verify exact call kwargs and compatibility before reconciliation.
- The planner’s inspected expression treats seed zero as falsey while the frontend accepts non-negative safe-integer seeds.
- A full-repair gate decision and actual structural-repair execution are separate; the latter depends on repair/printability flag routing.
- The inspected production targeted-hole-repair call passed the vertex limit but appeared not to pass the canonical perimeter limit.
- _quality_guard is narrower than the overall surface fidelity requirement. The pipeline also has master-to-derivative diagnostics; test whether bad reports block/revert output or only affect metadata/status.
- Texture resolution is intentionally filtered out of normal geometry inference. Verify it remains in the right job metadata and reaches atlas/painting consumers.
- Physics/collision is implemented as a separate artifact path in the inspected pipeline; verify render artifact selection and absent/false flag semantics end-to-end.
- Synthetic topology/metrics tests do not reproduce the user’s generated model quality complaint.
- Existing docs describe immutable master, topology gate, targeted repair and quality guards. These are contracts to verify, not proof they pass.

### Required diagnostic report artifacts during implementation

Keep reproduction output outside the project root or use existing fixture/storage conventions. Do not commit large generated meshes, checkpoint weights, screenshots, caches, secrets or environment-specific artifacts. The audit report should record model/feature/settings; source/output hashes; per-stage topology/fidelity metrics; stage decisions/warnings/errors; actual route and consumer; reproduction commands summarized; PASS/FAIL/NOT RUN; and no-GPU/no-weights limitations.
