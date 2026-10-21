# ForMash3D — Generate Panel Refactor & Sub-Agent Enforcement Spec

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
| **G-01** | Generate panel has one Target Polycount / Output Preset card and no duplicate target UI | Code Audit (`GeneratePanel.tsx`) | **PASS** | One output-preset card with the six canonical chips and a single 5K–200K polycount slider. |
| **G-02** | Inference-quality selector and unbacked inference toggles removed from UI | Static Grep & Code Audit | **PASS** | `MESH_QUALITY_OPTIONS` and `applyModelSpecificQuality` are gone; no inference controls remain in the panel. |
| **G-03** | Presets consolidated as production recipes; no auto-submit on preset click | Code Audit (`selectOutputPreset`) | **PASS** | `selectOutputPreset` only updates settings state; the only `pendingGenerateRef` write is the explicit Generate action. |
| **G-04** | Explicit model choice and explicit Advanced settings have deterministic precedence | Test Suite (`test_preset_alignment_and_persistence.py`, `generationParameters.test.mjs`) | **PASS** | Explicit request value > intent preset > backend default, with a tri-state request contract (ADR-093). |
| **G-05** | Request builder no longer duplicates adapter-owned numeric inference profiles | Static Grep & Code Audit | **PASS** | The builder forwards `seed` only; no numeric inference schedule is present in the frontend. |
| **G-06** | Former scheduler-profile entries audited and migrated | Adapter & Scheduler Audit | **PASS** | Hunyuan3D-DiT-v2-mini-turbo, Trellis, Trellis2, Pixal3D, Unique3D, TaoFlowForge, Hunyuan3D-Shape-v2.1, and TripoSG fully migrated to adapter-owned locked inference profiles. All entries removed from `_RAW_MESH_MAX_QUALITY_PARAMETERS`. |
| **G-07** | Real production controls wired end-to-end; no mock controls | Pipeline & Router Audit | **PASS** | Candidates 1-4 (`_score_and_select`), Quad retopo, PartUV, normal baking, LODs, repair, CoACD verified in pipeline. The LOD controls were found **disconnected** (the builder never serialized them) and are now wired: `generate_lod` / `lod_preset` / `lod_count` request fields feed the pipeline's LOD stage. The dead "Enable Low VRAM Mode and retry" action was removed. |
| **G-08** | All generation pathways (main, batch, re-run, preset) follow same contract | Contract Audit | **PASS** | Canonical contract defined in `Docs/GENERATION-UI-CONTRACT.md`. |
| **G-09** | Frontend regression tests cover removed override paths and candidate controls | Node Test Runner (`bun test`) | **PASS** | `bun test` ran 41 tests across 7 files, 41 passed, 0 failed; `features/workspace/lib/generationParameters.test.mjs` covers 12 rules including the LOD request contract. |
| **G-10** | Backend regression tests cover adapter contracts | Pytest | **PARTIAL / NOT RUN (GPU + heavy deps)** | `backend/tests/test_preset_alignment_and_persistence.py` (24 tests) and `backend/tests/test_smart_preset_parity.py` pass, and the CI contract subset passes (56 tests). The remaining backend modules need `torch`, `trimesh`, `skimage`, `psutil` and a GPU; in this environment 53 tests fail on missing imports both before and after this change (unchanged baseline). GPU inference tests `NOT RUN` (no GPU). |
| **G-11** | Documentation synchronized without contradictions | Full Doc Sync Audit | **PASS** | `README.md`, `RULES.md`, `CONTRIBUTING.md`, `Docs/ARCHITECTURE.md`, `Docs/DESIGN.md`, `Docs/PRD.md`, `Docs/SYSTEM-BLUEPRINT.md`, `Docs/api-documentation.md`, `Docs/DECISIONS.md`, `Docs/CHANGELOG.md`, `Docs/MEMORY.md`, `Docs/GENERATION-UI-CONTRACT.md`, `Docs/EXPERIMENTAL-MODEL-SETTINGS.md`, `Docs/quad_topology_evaluation.md`, `Docs/taoflowforge_spike_report.md`, `Docs/SECURITY.md` updated. |
| **G-12** | TypeScript and syntax checks clean | TypeScript Compiler (`tsc`) | **PASS** | `npx tsc --noEmit` completed with 0 errors; `npx eslint` on the changed files reports 0 errors. |
| **G-13** | Review final diff and clean commit history | Git Status & Diff Audit | **PASS** | Only documented and authorized files modified; no destructive alterations. |

---

## 11. Static Acceptance Search Findings

1. `MESH_QUALITY_OPTIONS`:
   - Absent from the repository. The Generate panel exposes no inference-quality selector.
2. `requested_quality` / `meshQuality`:
   - Still present in the router schemas (`mesh_generation.py`) as deprecated fields, and stripped by the scheduler in `_ADAPTER_OWNED_INFERENCE_INPUTS`.
   - The scheduler properly strips these from reaching adapter-owned models; the API only uses them for planner routing.
3. `modelParameterOverrides`:
   - Handled cleanly in `buildGenerationParameters.ts` and `GenerationPresetDrawer.tsx` with finite JSON validation and prototype pollution guards.
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

- [x] Changes have been committed and pushed to `dev`. Commits `537d8b49` and `47251a8a` are pushed to `origin/dev` (`tanushreesindur0-rgb/ForMash3D`) and to `upstream/dev` (`Silentzx2/ForMash3D`); the upstream push required an explicit credential because the sandbox codespace credential helper is not authorized for that repository.
- [x] The final response distinguishes verified tests from checks not run and includes the commit/PR reference where applicable.

**Do not declare success if any required gate was silently skipped.** If a gate cannot be completed, state the blocker, complete the remaining work, and leave the task explicitly partially verified rather than inventing a pass.
