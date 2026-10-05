# ForMash3D — Agent-Executable Engineering Task Plan

**Status:** Active implementation roadmap — rewritten from the current \`Dev\` codebase audit and the latest product discussion/screenshots  
**Date:** 2026-10-05  
**Branch:** \`Dev\`  
**Authoritative task file:** \`Docs/TASKS.md\`

> There is no root \`TASK.md\`. This file is the single authoritative engineering task ledger referenced by the repository rules.

---

## 0. Mission

ForMash3D is an **Image → 3D, self-hosted production asset pipeline**.

The immediate goal is **not** to add every possible research feature. The immediate goal is to:

1. Fix the remaining raw-mesh quality regressions first.
2. Add the low-risk, high-value quality improvements that already have the required infrastructure.
3. Add the seven user-facing workflow features that materially improve the product experience.
4. Build a simple, deterministic smart-generation layer instead of an unnecessarily complex model-scoring system.
5. Keep real-time streaming and speculative research work behind explicit hold/defer gates until the base pipeline is stable.

The engineering principle is:

\`\`\`
INPUT IMAGE
   ↓
optional preprocessing + user preview
   ↓
capability-aware model selection
   ↓
maximum-fidelity native inference
   ↓
immutable master/source.glb
   ↓
repair / conditional retopo / texture preservation
   ↓
target polycount + UV + LOD + collision
   ↓
optional rigging
   ↓
quality QA + provenance
   ↓
gallery / comparison / diff
   ↓
engine-ready export
\`\`\`

### Non-negotiable product contract

- **3D generation input is Image → 3D.**
- Text input remains valid for mesh painting/editing and motion workflows, but **Text → 3D is not an active generation path**.
- The immutable model-native master remains the highest-fidelity checkpoint.
- Production budgets such as target polycount must remain **downstream constraints**, not hidden neural-generation limits.
- Existing adapters, scheduler, post-process services, history, export tools, and UI patterns must be reused before creating new abstractions.
- No new dependency is allowed when an existing implementation can satisfy the requirement.
- No research feature should be promoted to production merely because a cloud service advertises an analogous feature.

---

# 1. Engineering Rules For Every Task

These rules are mandatory and are derived from the repository engineering rules.

## 1.1 Root-cause first

Before changing code:

1. Read the task and every file in the execution path.
2. Trace the request from UI → API → scheduler → adapter → storage → post-process → artifact delivery.
3. Search every caller of any function being changed.
4. Identify the actual cause rather than patching the visible symptom.
5. Reuse an existing function, utility, endpoint, store, schema, or service whenever possible.
6. Implement the smallest correct change.
7. Run targeted tests first, then broader verification.
8. Update all relevant documentation before declaring the task complete.

## 1.2 No duplicate systems

Do not create:

- a second history database when job history already exists;
- a second batch scheduler when the existing scheduler can queue jobs;
- a second exporter when \`meshExport.js\` and \`ExportMeshDialog.jsx\` already provide export primitives;
- a second rigging service when \`unirig_auto_rig\` already exists;
- a second repair engine when \`backend/postprocess/services/repair.py\` exists;
- a second image editor when the existing Image Editor already supports manual crop/filter operations;
- a new WebSocket abstraction until the actual backend transport exists.

## 1.3 Resource safety

Any feature that can create multiple generation jobs must be resource-admission aware.

Rules:

- Never submit N GPU jobs blindly from the browser with \`Promise.all\`.
- The scheduler is the source of truth for concurrency.
- The UI may request concurrency, but the scheduler must decide whether a job runs immediately or remains queued.
- If the selected model cannot fit the available VRAM/RAM budget, the job must remain queued or be rejected with a clear reason; it must never be started merely because the browser clicked “Generate”.
- Comparison and batch workflows must degrade to sequential execution when concurrent execution would exceed the available resource budget.
- User-visible status must distinguish **queued because of resources** from **failed**.

## 1.4 Failure honesty

A partial artifact must never be presented as fully production-ready.

Examples:

- Auto-rig failure must not leave a “rigged” status.
- Texture loss in a textured production artifact must be surfaced.
- Export conversion failure must be explicit.
- Printability check failure must remain visible.
- A preview transport that is not implemented must not be simulated as a live WebSocket.

## 1.5 Documentation

After every meaningful implementation task, update the relevant existing docs:

- \`Docs/TASKS.md\`
- \`Docs/ARCHITECTURE.md\`
- \`Docs/PRD.md\`
- \`Docs/DESIGN.md\`
- \`Docs/MEMORY.md\`
- \`Docs/api-documentation.md\`
- \`Docs/DECISIONS.md\` when a durable architecture decision is made
- \`Docs/CHANGELOG.md\` according to the repository's “last three changes” policy
- \`README.md\` when a public capability or workflow changes
- \`CONTRIBUTING.md\` when contributor-facing conventions change

Do not create duplicate documentation files merely to satisfy a task.

---

# 2. Current Repository Baseline

The current \`Dev\` branch already contains substantial infrastructure. The following must be treated as the baseline rather than rebuilt.

## 2.1 Existing generation pipeline

Current contract:

\`\`\`
image upload
→ model capability routing
→ native inference
→ immutable source/master asset
→ production post-process
→ QA
→ artifact delivery
\`\`\`

Already present:

- capability-aware image-to-raw / image-to-textured routing;
- multi-view related infrastructure;
- scheduler with VRAM-aware execution;
- source/master asset preservation;
- repair;
- auto-retopo;
- UV processing;
- LOD generation;
- collision/physics preparation;
- history endpoints;
- mesh export utilities;
- UniRig adapter;
- image-editor utilities;
- generation settings persistence.

## 2.2 Existing Asset History is partial, not absent

Current code already has:

- \`features/workspace/Dashboard/OutputsPage.tsx\`
- \`features/workspace/store/WorkspaceContext.tsx\`
- \`features/workspace/lib/api.ts\`
- \`stores/useAppStore.ts\`
- \`/api/v1/system/jobs/history\`
- thumbnail metadata;
- polygon/vertex/material/topology metadata;
- post-process status;
- delete-history support.

Therefore **Asset History must be upgraded, not rebuilt**.

## 2.3 Existing batch infrastructure is partial

Current code already has:

- \`batchGenerationEnabled\`
- \`batchQueue\`
- batch queue actions in \`stores/useAppStore.ts\`
- \`BatchQueueItem\`

However, the current queue is still prompt-centric in places, while the active product contract is Image → 3D.

The batch task must therefore **retrofit the existing queue to image inputs** instead of introducing a separate queue system.

## 2.4 Existing export infrastructure is substantial

Current code already has:

- \`features/utils/meshExport.js\`
- \`features/mesh-extras/ExportMeshDialog.jsx\`
- GLB/OBJ/PLY/STL export;
- Unity FBX preset;
- Unreal FBX preset;
- generic FBX;
- collision merging;
- LOD exports;
- batch export;
- folder browsing;
- texture handling.

The one-click engine export task must package and expose these capabilities cleanly rather than duplicate exporters.

## 2.5 Existing rigging infrastructure is present

Current code already has:

- \`backend/adapters/unirig_adapter.py\`
- \`unirig_auto_rig\` model registration;
- \`backend/api/routers/auto_rigging.py\`;
- frontend auto-rig helpers;
- \`autoRig\` generation state.

What is missing is the **generation-pipeline wiring for an explicit \`enable_auto_rig\` contract**.

## 2.6 Existing printability/repair infrastructure is present

Current code already has:

- \`backend/postprocess/services/repair.py\`;
- topology counts;
- boundary-edge detection;
- non-manifold detection;
- watertight status;
- UV-preserving repair;
- auto-retopo watertight processing;
- segmentation tools.

Therefore SG-07 should expose and orchestrate what already exists before considering a new geometry library.

## 2.7 Existing image preprocessing pieces are distributed

Current code already contains background-removal and preprocessing logic in several model integrations, including:

- RealESRGAN support;
- RMBG-based paths;
- adapter-level background removal;
- image-editor crop/filter functionality.

The problem is that these capabilities are **distributed rather than exposed as one shared pre-generation experience**.

The SG-06 task must consolidate the orchestration layer while reusing the existing model-specific implementations wherever technically safe.

## 2.8 Existing generation settings persistence is partial

\`stores/useAppStore.ts\` already persists lightweight generation preferences.

Therefore named user presets should extend that persistence rather than introduce an unrelated settings store.

## 2.9 Current WebSocket reality

The current frontend explicitly treats backend job state as REST-driven and the current workspace API's WebSocket methods are placeholders/no-ops.

Therefore SG-11 remains a **hold item**. Do not implement fake streaming or invent a protocol until the actual backend transport exists.

---

# 3. Priority Ladder

### P0 — Raw Mesh Quality Closure

**Status: DONE — source-level implementation and regression verification completed.**

> **IMPORTANT FOR FUTURE AGENTS:** Do **not** trust the DONE/VERIFIED status in this file. Treat this ledger as a checklist, not as proof. Every agent must independently inspect the current `Dev` code, trace the live execution path, and rerun the relevant tests before accepting this phase as complete. If the implementation or tests drift, reopen the item even if this document says DONE.

Phase 0 is a **shared quality contract**, not a separate generation pipeline. Every normal Image → 3D generation job uses the same production post-processing path.

#### Q1 — No destructive pre-decimation in model inference
**DONE / VERIFIED BY SOURCE AUDIT**

- Raw model adapters must not silently decimate model-native geometry.
- PartPacker raw output remains `num_faces=-1`.
- TRELLIS raw/image/painting paths keep `simplify=0.0`.
- Hunyuan Paint keeps remeshing disabled in the model path.
- Model-native extraction controls remain upstream-compatible.

#### Q2 — Production budgets remain downstream-only
**DONE / VERIFIED BY SOURCE + CONTRACT TESTS**

- `target_polycount`, LOD settings, collision settings, bake settings, and optimization controls are stripped from model inference inputs.
- A user target polycount must never reduce the neural model's native source output.
- The immutable `master/source.glb` remains the source of all downstream processing.

#### Q3 — Maximum-fidelity extraction parameters are preserved
**DONE / VERIFIED BY SOURCE + PARITY TESTS**

- TripoSR extraction uses the verified 320 contract.
- TripoSF supports the verified 1024 / 1,638,400 quality contract.
- Hunyuan/UltraShape/PartPacker/TRELLIS/TRELLIS.2 defaults remain aligned with their current official parity tests.
- Quality presets may select supported model parameters, but must not silently introduce destructive source limits.

#### Q4 — Model-specific inference schedules are preserved
**DONE / VERIFIED BY SOURCE + PARITY TESTS**

- TRELLIS image sampling uses the verified 12/12 schedule.
- Hunyuan shape paths use the verified 50-step seeded contract.
- Mini Turbo keeps its model-specific 5-step contract.
- The scheduler does not globally force one sampling schedule onto every adapter.

#### Q5 — Source coordinates, scale, and provenance remain immutable
**DONE / VERIFIED BY SOURCE + REGRESSION TESTS**

- Raw model saves preserve native coordinate/scale contracts.
- `master/source.glb` is byte-for-byte protected from post-processing.
- Source hashes and quality snapshots remain part of the artifact metadata.

#### Q6 — Native textures/materials/UVs cannot be silently destroyed
**DONE / VERIFIED BY SOURCE + REGRESSION TESTS**

- Native texture detection requires actual payloads, not UV presence alone.
- Texture-aware optimization restores wedge UV/material information.
- If texture preservation fails, the pipeline reverts/fails explicitly instead of silently shipping an untextured asset.
- Native textured assets are not routed through structural retopology that would destroy their mapping.

#### Q7 — LOD/repair/optimization cannot silently compound quality loss
**DONE / VERIFIED BY SOURCE + REGRESSION TESTS**

- LOD levels are generated independently from the production mesh, not chained.
- Healthy manifold source meshes skip unnecessary repair.
- Optimization uses texture-aware decimation for textured assets.
- The common pipeline applies a geometry-fidelity guard to optimization results and reverts to the repaired mesh when the candidate has non-finite geometry, unexpected face growth, excessive vertex growth, or material bounds drift.

#### Q8 — Normal generation uses the same quality-safe post-processing path
**DONE / VERIFIED**

- There is no separate “quality pipeline” for smart generation versus normal generation.
- `run_postprocess_job()` is the common production path.
- The repair skip and optimization quality guard therefore apply to ordinary Image → 3D generation as well as future smart generation.
- Existing repair, AutoRetopo, UV, texture, LOD, collision, QA, and artifact contracts remain in this shared path.

### Phase 0 acceptance

- [x] Q1–Q8 implementation contracts verified in current source.
- [x] Common post-processing quality guard implemented.
- [x] Healthy meshes no longer receive unnecessary repair mutations.
- [x] Regression tests added for repair no-op and geometry-envelope protection.
- [x] No separate quality pipeline introduced.
- [x] Documentation explicitly warns agents to independently verify implementation rather than trusting status labels.
- [ ] Full GPU/model visual A/B verification — **NOT RUN: requires production NVIDIA/model runtime.**
- [ ] Full 22-model GPU smoke suite — **NOT RUN: requires model weights + CUDA runtime.**
- [ ] 4×A100 concurrency/load test — **NOT RUN: no matching environment available.**

**Phase 0 is source-level DONE, but runtime GPU visual verification remains environment-gated and must not be represented as passed.**

# 4. P1 — High-value / Low-effort Features

**Status: DONE — SG-06, SG-07, SG-08, and SG-02.2 are implemented and cross-wired through the existing generation, scheduler, post-processing, and artifact-delivery paths.**

> Verification rule: this is a source-level implementation marker, not proof of CUDA/model-runtime success. Future agents must independently inspect the current Dev code, trace the live execution path, and rerun relevant tests.

---

## SG-06 — Image Enhancement / Auto-Fix + Preview

**Review: DONE — Shared preview/preprocessing artifact, adaptive fallback behavior, provenance, approved-input reuse, and normal Image → 3D integration are implemented.**

**Priority:** HIGH  
**Timing:** Immediately after P0  
**Goal:** Improve the quality of the image entering the 3D generator without changing the neural model itself.

### Problem

Poor input images cause:

- weak silhouette extraction;
- incorrect subject/background separation;
- low detail;
- unnecessary background geometry;
- poor framing;
- avoidable generation artifacts.

The repository already has RealESRGAN/RMBG capabilities, but they are not exposed as one coherent pre-generation pipeline.

### What to build

Add one shared pre-generation enhancement flow:

\`\`\`
uploaded image
  ↓
input inspection
  ↓
RMBG preview / subject isolation
  ↓
auto crop + center subject
  ↓
resolution inspection
  ↓
RealESRGAN only when useful
  ↓
optional denoise/sharpen
  ↓
approved preprocessed image
  ↓
generation scheduler
\`\`\`

### User flow

1. User uploads image.
2. UI immediately shows the original and “Generation Preview”.
3. Preview shows the background-removed/normalized subject.
4. User can:
   - Accept;
   - regenerate preprocessing;
   - open the existing manual image editor;
   - disable enhancement.
5. Once accepted, the exact approved image becomes the generation input.
6. Generation stores provenance linking the generated asset to the approved preprocessing artifact.

### Required preprocessing policy

Default behavior must be **adaptive**, not destructive.

- Low-resolution input → upscale using existing RealESRGAN capability.
- Already-high-resolution input → do not blindly upscale.
- Existing alpha/mask → preserve it and avoid unnecessary second matting.
- Background removal → preview first whenever possible.
- Auto-crop → only crop to the detected subject with a configurable safety margin.
- Centering → preserve the subject's relative orientation and proportions.
- Noise reduction/sharpening → conservative defaults; avoid hallucinating texture.
- Enhancement failure → preserve the original input and show a clear warning rather than silently changing the source.

### Reuse requirements

Inspect and reuse:

- existing RealESRGAN checkpoint/path resolution;
- existing RMBG/model-specific wrappers;
- existing image-editor crop/filter functionality;
- existing upload/proxy APIs;
- existing workspace generation settings.

Do not duplicate every adapter's background-removal implementation.

### Integration point

Preferred architecture:

\`\`\`
Upload
  ↓
Enhancement/Preview service
  ↓
approved image artifact
  ↓
scheduler job input
  ↓
adapter
\`\`\`

The enhancer should run once at job preparation level when the selected model can consume the shared result.

Model-specific adapters may retain their own required preprocessing when it is an intrinsic part of the upstream model contract, but the shared layer must avoid double-processing.

### Data/provenance

Record:

- original image ID;
- enhanced image ID;
- preprocessing operations;
- RealESRGAN used/not used;
- RMBG used/not used;
- crop rectangle;
- final dimensions;
- content hash.

### Acceptance criteria

- Enhancement preview appears before generation.
- “Looks wrong? Edit manually” uses the existing Image Editor rather than a duplicate editor.
- Same approved image artifact is used by the final generation job.
- Low-resolution inputs receive useful upscaling.
- Good high-resolution inputs are not unnecessarily degraded.
- Existing alpha is not destroyed.
- Enhancement failure does not produce a false-success generation.
- The generated history entry shows that enhancement was used.
- Existing direct generation still works with enhancement disabled.

### Tests

- RGB input.
- RGBA input.
- low-resolution input.
- already-high-resolution input.
- subject on complex background.
- subject already isolated.
- enhancement disabled.
- RealESRGAN unavailable.
- RMBG unavailable.
- malformed image.
- crop bounds regression.
- identical approved-input hash reused by job.

---

## SG-07 — Printability Check + Auto-Repair

**Review: DONE — Deterministic topology QA, explicit repair control, final recheck, and degraded-state reporting are implemented in the common post-processing path.**

**Priority:** HIGH  
**Timing:** P1  
**Goal:** Make print-readiness an explicit, deterministic production check.

### Phase A — Implement now

Expose existing topology analysis as a first-class production flag.

Recommended flags:

- \`enable_printability_check\`
- \`enable_auto_repair\`

Defaults:

- normal generation → off unless user/preset enables;
- \`3d_print\` intent → on by preset.

### Existing implementation to reuse

Use:

- \`backend/postprocess/services/repair.py\`
- existing watertight/non-manifold/boundary checks;
- existing repair pipeline;
- existing quality-report infrastructure.

### Decision flow

\`\`\`
mesh
 ↓
printability analysis
 ↓
PASS → continue
FAIL + auto_repair=false → keep failure/warning visible
FAIL + auto_repair=true
 ↓
repair
 ↓
recheck
 ↓
PASS → continue
FAIL → explicit degraded/failed printability state
\`\`\`

### Metrics

At minimum record:

- watertight;
- boundary edges;
- non-manifold edges;
- face/vertex counts;
- connected components;
- repair attempted;
- repair result;
- number of removed/filled/detached faces where available.

### Phase B — Auto-split, only if justified

Do not build a new splitter immediately.

If \`enable_auto_split\` is later activated:

1. Reuse existing segmentation/splitting primitives.
2. Validate that splitting actually improves printability.
3. Process each part independently.
4. Preserve transforms.
5. Run repair/recheck per part.
6. Record part count and per-part QA.
7. Never split merely because a mesh is large.

### Acceptance criteria

- Existing \`repair.py\` logic is reused.
- Printability status is exposed in production metadata.
- Auto-repair is explicit and reproducible.
- A failed repair is visible.
- Textures/UVs are preserved where the existing UV-preserving repair path supports them.
- Print intent presets turn the appropriate flags on automatically.

### Tests

- watertight mesh;
- single-hole mesh;
- non-manifold edge mesh;
- repair-success mesh;
- repair-failure mesh;
- textured repair regression;
- printability metadata schema test.

---

## SG-08 — Auto-Rigging Wiring

**Review: DONE — Canonical enable_auto_rig scheduling, final-production-mesh UniRig execution, durable rigged artifact delivery, and explicit failure propagation are implemented.**

**Priority:** HIGH  
**Timing:** P1 after SG-07  
**Goal:** Make the existing UniRig capability available as a generation pipeline option.

### Current state

The project already has:

- UniRig adapter;
- scheduler model registration;
- auto-rigging API;
- frontend auto-rig utility;
- \`autoRig\` settings state.

The missing part is a single generation-pipeline contract.

### Required flag

Use one canonical job-level flag:

\`\`\`
enable_auto_rig: boolean
\`\`\`

Do not keep multiple aliases.

### Execution flow

\`\`\`
native generation
 ↓
production post-process
 ↓
canonical game-ready.glb
 ↓
if enable_auto_rig
 ↓
UniRig
 ↓
rigged game-ready artifact
 ↓
QA
 ↓
history/export
\`\`\`

### Rules

- Auto-rig must run on the final production mesh, not on the immutable raw master.
- Preserve the immutable source.
- Do not claim success until the rigged asset is actually durable.
- Preserve materials/UVs where the rigging path permits.
- If UniRig fails, publish an explicit rigging failure/degraded artifact state.
- Do not silently replace a production result with an unrigged result while reporting “rigged”.
- Keep the existing manual rigging workflow intact.

### Animation presets

The repository contains ARDY/animation infrastructure, but **do not invent native embedded animation behavior**.

Initial SG-08 scope:

- auto-rig wiring only.

Future animation-preset application can be a separate task after the rigged artifact contract is verified.

### Acceptance criteria

- UI toggle maps to \`enable_auto_rig\`.
- Job payload contains exactly one canonical rigging flag.
- Scheduler/post-process invokes existing UniRig path.
- Rigging is capability-aware.
- Rigged result exposes skeleton/rig metadata.
- Failure is explicit.
- Manual rigging remains functional.

### Tests

- auto-rig off → no UniRig call;
- auto-rig on + valid model;
- auto-rig unavailable;
- UniRig failure;
- rigged artifact history entry;
- export preserves rig/animation clips where existing exporter supports them.

---

## SG-02.2 — Intent Presets

**Review: DONE — Versioned YAML presets, deterministic capability/readiness/VRAM filtering, and explicit model override semantics are implemented.**

**Priority:** HIGH  
**Timing:** P1  
**Goal:** Provide deterministic one-click production recipes without a complex scoring system.

### Critical simplification

Do **not** implement the previous six-dimensional weighted model-scoring algorithm as the first smart-generation layer.

For a self-hosted project, the first useful abstraction is:

\`\`\`
intent → preset → capability-aware model choice → generation → game-ready
\`\`\`

### Preset storage

Use a versioned YAML config, preferably:

\`\`\`
backend/config/smart_presets.yaml
\`\`\`

Do not duplicate the same values across frontend and backend.

### Initial built-in presets

#### game_ready

- target polycount: 50,000
- texture resolution: 1024
- LOD: enabled
- collision: enabled
- production QA: enabled
- auto UV: enabled where needed
- auto rig: optional / user-selected

#### cinematic

- target polycount: 200,000
- texture resolution: 2048
- LOD: enabled
- collision: off by default
- preserve maximum source fidelity

#### animation

- target polycount: 30,000
- texture resolution: 1024
- LOD: enabled
- quad/retopo preference as supported
- auto-rig: enabled or prominently suggested

#### 3d_print

- preserve source detail where possible
- texture output not required unless user requests it
- printability check: enabled
- auto-repair: enabled
- collision: optional
- no unnecessary texture baking

#### mobile

- target polycount: 20,000
- texture resolution: 512
- LOD: enabled
- collision: optional
- resource-efficient model preference

### Model choice policy

Do not score six independent dimensions.

Instead:

1. Filter to models compatible with Image → 3D.
2. Filter to models that satisfy the intent's minimum capability.
3. Filter by readiness/installation state.
4. Filter by VRAM constraints.
5. Use a deterministic priority order for the remaining models.
6. Return the chosen model and the exact applied preset.

### User override rule

Preset values are defaults.

Explicit user values win.

\`\`\`
preset defaults
   ↓
model capability constraints
   ↓
user explicit overrides
   ↓
scheduler safety clamps
\`\`\`

### Acceptance criteria

- One YAML source of truth.
- Five intents available.
- No weighted scoring engine.
- Model selection is deterministic.
- User overrides are respected.
- Scheduler still clamps for VRAM.
- Applied preset and chosen model are stored in job metadata.

---

### P1 Closure Verification

- [x] SG-06 implemented end-to-end on the normal Image → 3D path.
- [x] SG-07 implemented in the common post-processing path; no duplicate repair pipeline.
- [x] SG-08 implemented after durable production processing using the existing UniRig adapter.
- [x] SG-02.2 implemented from one YAML source of truth.
- [x] Original Phase 1 plan preserved; only status/review annotations were added.
- [x] Future-agent verification rule preserved.
- [ ] CUDA/model-weight visual A/B and full production load validation — NOT RUN in this environment.

# 5. Seven New Product Features From The Latest Product Review

These seven features are required in the next product roadmap. Existing partial implementations must be extended rather than duplicated.

---

## UX-01 — Asset History / Generations Gallery

**Priority:** HIGH  
**Current state:** IMPLEMENTED — Asset card enhanced to show generation intent, texture maps, LOD levels, and other metadata.

### Why

Users need to return to previously generated assets across sessions, inspect what was generated, reopen it, compare versions, and export it later.

### Current code to reuse

- \`features/workspace/Dashboard/OutputsPage.tsx\`
- \`features/workspace/store/WorkspaceContext.tsx\`
- \`features/workspace/lib/api.ts\`
- \`stores/useAppStore.ts\`
- \`/api/v1/system/jobs/history\`

### Required result

Upgrade the current gallery into a durable “My Assets” experience.

### Asset card must show

- thumbnail;
- asset name;
- created time;
- model;
- generation intent/preset;
- source type;
- poly/vertex count;
- texture resolution/material state;
- post-process status;
- printability status where available;
- rigged/unrigged status;
- LOD availability;
- production-ready/degraded/failed state.

### Interaction

Click asset → reopen exact artifact in workspace.

Actions:

- Open;
- Duplicate/Regenerate;
- Compare;
- Diff;
- Export;
- Delete;
- Favorite.

### Filtering

Support at least:

- all;
- completed;
- degraded;
- failed;
- rigged;
- textured;
- game-ready;
- 3d-print;
- cinematic;
- mobile.

### Search

Search by:

- asset name;
- job ID;
- model;
- intent/preset.

### Persistence

Use the existing backend job history and artifact metadata.

Do not introduce a second asset database.

### Acceptance criteria

- Gallery survives page reload.
- Existing history remains compatible.
- Thumbnails use existing fallback logic.
- Deleted jobs disappear from the gallery.
- Reopening restores the correct artifact.
- No duplicate history entry is created merely by reopening.

---

## UX-02 — Side-by-Side Model Comparison

**Priority:** HIGH
**Current state:** IMPLEMENTED — Model comparison viewer added with side-by-side viewing, stats, and difference metrics; model selector allows choosing assets to compare.

### Why

Users need an objective way to compare model output quality before selecting the final asset.

### User flow

1. Upload one source image.
2. Select 2–3 compatible models.
3. Keep common generation settings synchronized.
4. Submit the jobs as one comparison group.
5. Scheduler decides whether they run concurrently or sequentially.
6. Show results in synchronized viewers.
7. User can compare and keep one/all.

### Required comparison metadata

For each candidate:

- model name;
- generation time;
- VRAM peak if available;
- vertex count;
- triangle count;
- dimensions;
- UV state;
- texture state;
- watertight status;
- post-process status;
- error/degraded state.

### Resource behavior

Never start three heavyweight models blindly.

Decision:

\`\`\`
requested 3 models
 ↓
estimate/admit resource needs
 ↓
fits concurrency?
 ├─ yes → concurrent
 └─ no → scheduler queues/sequences
\`\`\`

### Reuse

- existing generation endpoint;
- existing scheduler;
- existing job tracking;
- existing MeshViewer;
- existing Outputs/Asset History.

Do not create a parallel model execution engine.

### UI acceptance

- same source image visible for all candidates;
- synchronized orbit/zoom;
- identical camera framing when possible;
- model-specific errors do not hide successful candidates;
- user can save selected candidate(s) to history.

### Tests

- 2 compatible models;
- 3 compatible models;
- one model unavailable;
- insufficient VRAM;
- one job failure;
- sequential fallback;
- history persistence.

---

## UX-03 — Batch Generation From Multiple Images

**Priority:** HIGH
**Current state:** IMPLEMENTED — Batch queue adapted to image inputs, resource-aware admission, UI controls for batch processing.

### Why

Studios and power users need to process many references without manually repeating Generate.

### Required behavior

User can:

- upload multiple images;
- optionally choose one shared preset/model/quality;
- enqueue all inputs;
- start once.

Each image becomes one independent generation job.

### Important correction to current implementation

The current \`BatchQueueItem\` is prompt-centric in places.

The active product contract requires:

\`\`\`
BatchQueueItem
  input image
  preprocessing recipe
  model/preset
  status
  progress
  result
  error
\`\`\`

Do not keep prompt-only generation as the active 3D batch path.

### Resource-aware admission

This is mandatory.

The browser must not launch all jobs simultaneously.

Required UI states:

- Ready;
- Queued;
- Running;
- Resource-wait;
- Completed;
- Failed;
- Cancelled.

The scheduler decides actual concurrency.

### Example

For ten images:

\`\`\`
10 inputs
 ↓
10 queued jobs
 ↓
scheduler admits 1–N based on VRAM
 ↓
completed jobs free capacity
 ↓
next queued jobs start
\`\`\`

### Batch summary

Show:

- total;
- completed;
- failed;
- queued;
- average generation time;
- total elapsed time;
- resource-wait time.

### Acceptance criteria

- Multiple images can be uploaded in one action.
- All jobs can be submitted without browser-side OOM.
- Scheduler controls concurrency.
- Batch can be cancelled.
- Failed items can be retried individually.
- Completed items appear in Asset History automatically.
- Batch export can reuse existing export dialog.

### Tests

- 2 images;
- 10+ images;
- mixed resolutions;
- duplicate filenames;
- one corrupt image;
- insufficient VRAM;
- cancellation;
- retry;
- partial failures;
- page reload while jobs are running.

---

## UX-04 — Generation Presets Save / Load

**Priority:** HIGH
**Current state:** IMPLEMENTED — Named presets save/load implemented in GenerationSection.tsx with localStorage persistence.

### Why

Artists repeatedly use recipes such as:

- Game Ready 50K;
- Cinematic 200K;
- Mobile 20K;
- 3D Print;
- Animation Rig.

### Separate two concepts

#### Built-in intent presets

Backend-owned and versioned:

- \`smart_presets.yaml\`

#### User presets

User-owned named settings.

Initial implementation should use the existing persisted frontend settings mechanism unless a cross-device persistence requirement is later established.

### Preset fields

At minimum:

- model;
- intent;
- quality;
- target polycount;
- texture resolution;
- LOD settings;
- collision;
- printability;
- auto repair;
- auto rig;
- enhancement;
- seed;
- relevant model-specific generation parameters.

Do not save transient runtime fields.

### UX

- Save current settings as preset.
- Load preset.
- Duplicate preset.
- Rename.
- Delete user preset.
- Restore built-in default.
- Show “built-in” vs “custom”.

### Override behavior

Loading a preset applies its values, but a later explicit user change overrides the preset.

### Acceptance criteria

- Named presets survive page reload.
- Built-in presets remain versioned from YAML.
- User presets cannot overwrite built-in definitions.
- Invalid/stale fields are safely migrated.
- Preset loading does not accidentally restore stale runtime job state.

---

## UX-05 — Mesh Diff Viewer

**Priority:** HIGH
**Current state:** IMPLEMENTED — MeshDiffViewer component created and integrated into RightPropertyPanel.

### Why

The user currently cannot easily answer:

> “What exactly did post-processing change?”

This feature must make source → production differences visible.

### Source of truth

Use existing immutable:

\`\`\`
master/source.glb
\`\`\`

and existing production artifacts/quality metadata.

Do not regenerate the source mesh just to compare it.

### Required views

Two synchronized panes:

- Source / Native;
- Game Ready / Final.

Optional stage picker:

- Source;
- Repaired;
- Retopologized;
- LOD0;
- LOD1;
- LOD2;
- collision.

### Metrics

At minimum:

- vertices;
- triangles/faces;
- dimensions;
- bounding box;
- scale;
- material count;
- texture count;
- texture resolution;
- UV coverage;
- UV overlap status;
- watertight;
- boundary edges;
- non-manifold edges;
- connected components;
- LOD count;
- file size;
- post-process status.

### Delta presentation

Example:

\`\`\`
Triangles     612,400 → 50,120   -91.8%
Vertices      318,000 → 27,100   -91.5%
Watertight    false   → true
UV coverage  71%     → 96%
Textures      0       → 4
LOD levels    0       → 3
\`\`\`

### Stage attribution

Use existing quality-trace information so the UI can say:

- “repair changed topology”;
- “decimation reduced face count”;
- “UV step added charts”;
- “texture bake created material maps”.

Do not perform expensive duplicate processing just to generate these labels.

### Acceptance criteria

- Source bytes remain unchanged.
- Final artifact is accurately represented.
- Stats match stored QA metadata.
- Viewer camera can be synchronized.
- Deltas are deterministic.
- Missing optional metrics are shown as “Unavailable”, not guessed.

---

## UX-06 — One-Click Engine Export

**Priority:** HIGH
**Current state:** IMPLEMENTED — Existing exporter primitives reused; ExportMeshDialog provides one-click engine export.

### Why

“Export” should mean “ready for the selected engine”, not merely “download GLB”.

### Existing code to reuse

- \`features/utils/meshExport.js\`
- \`features/mesh-extras/ExportMeshDialog.jsx\`
- existing FBX presets;
- existing collision merging;
- existing LOD naming;
- existing texture export;
- existing batch export.

### Targets

#### Unreal Engine 5

Default package:

\`\`\`
Unreal/
  <AssetName>/
    Mesh/
      <AssetName>.fbx
    Textures/
      ...
    LODs/
      ...
    Collision/
      UCX_<AssetName>_01...
    manifest.json
    IMPORT.md
\`\`\`

Requirements:

- centimeters/scale contract documented;
- skeleton/animations preserved when present;
- UCX collision naming maintained;
- LOD naming explicit;
- texture paths deterministic.

#### Unity

Default package:

\`\`\`
Unity/
  <AssetName>/
    Models/
      <AssetName>.fbx
    Textures/
      ...
    LODs/
      ...
    Materials/
      ...
    manifest.json
    IMPORT.md
\`\`\`

Requirements:

- Unity-ready FBX;
- deterministic texture references;
- optional material metadata/setup instructions;
- rig/import hints;
- LOD mapping.

Do not generate fake proprietary Unity assets unless Unity tooling is actually available. A folder package plus import metadata is the default cross-platform contract.

#### Godot

Default package:

\`\`\`
Godot/
  <AssetName>/
    <AssetName>.glb
    Textures/
      ...
    LODs/
      ...
    Materials/
      ...
    manifest.json
    IMPORT.md
\`\`\`

Use GLB/glTF as the default Godot delivery format unless an explicit tested FBX workflow is requested.

### General package contract

Every engine export should contain:

- canonical mesh;
- textures;
- LODs when enabled;
- collision when enabled;
- rig/animation data when present;
- deterministic naming;
- target engine metadata;
- manifest;
- human-readable import instructions.

Zip is optional delivery, but the output must first be a valid structured package.

### Acceptance criteria

- One click selects target engine.
- Existing exporter functions are reused.
- Package structure is deterministic.
- No broken relative texture paths.
- Collision naming is valid for the target.
- LOD files are consistently named.
- Manifest lists every generated artifact.
- Failed optional conversions are clearly marked.

### Tests

- Unreal package;
- Unity package;
- Godot package;
- textured mesh;
- untextured mesh;
- rigged mesh;
- LOD asset;
- collision asset;
- batch engine export;
- missing optional FBX converter.

---

## UX-07 — Smart Background Removal Preview

**Priority:** HIGH
**Current state:** IMPLEMENTED — Background removal preview integrated into generation panel with original vs preview view, approve/edit/manual options.

### Why

Background removal is one of the earliest quality gates.

Users should see what the generator will actually receive before spending GPU time.

### User flow

\`\`\`
upload image
 ↓
RMBG preview
 ↓
show before/after
 ↓
user accepts
    OR
opens existing image editor
    OR
disables background removal
 ↓
generation
\`\`\`

### UI

Show:

- Original;
- Processed;
- transparent checkerboard/background;
- subject bounds;
- “Accept”;
- “Edit Manually”;
- “Use Original”;
- “Re-run”.

### Reuse

- existing RMBG model paths;
- SG-06 preprocessing utility;
- existing Image Editor for manual edits.

Do not build a second image editing application.

### Acceptance criteria

- preview renders before GPU generation;
- approved preview becomes the exact generation input;
- user can reject it;
- manual edit returns to the same generation flow;
- original remains available;
- preprocessing provenance is stored.

---

# 6. Simplified Smart Selector — SG-01

**Priority:** MEDIUM/HIGH  
**Quarter target:** Q4 2026 planning target  
**Status:** Planned after P0/P1 stabilization.

### Product promise

One click:

\`\`\`
intent
 → preset
 → compatible model
 → generation
 → production post-process
 → game-ready result
\`\`\`

### Important scope reduction

Do not implement the old six-weight model-scoring system initially.

### API

Preferred endpoint:

\`\`\`
POST /api/v1/smart/generation
\`\`\`

Input:

- image upload;
- intent;
- optional preset override fields;
- optional enhancement setting;
- optional auto-rig setting.

No Text → 3D prompt mode.

### Internals

1. Validate image.
2. Resolve intent.
3. Load preset from \`smart_presets.yaml\`.
4. Filter models by:
   - Image → 3D support;
   - readiness;
   - minimum capability;
   - VRAM fit.
5. Choose a deterministic model priority.
6. Merge preset + explicit user overrides.
7. Submit through existing generation scheduler.
8. Return job ID, selected model, applied preset, and effective config summary.

### Explainability

Show the user:

- selected model;
- selected preset;
- why it was eligible;
- which settings were applied;
- which values were clamped for safety.

### Acceptance criteria

- no scoring engine required;
- deterministic;
- image-only;
- uses existing scheduler;
- user overrides win;
- VRAM guard remains authoritative;
- final result appears in Asset History.

---

# 7. Hold — SG-11 Real-Time Generation Preview

**Priority:** HIGH future UX, but HOLD until the base pipeline is stable.

### Why it is on hold

Current backend does not expose a real job-preview WebSocket transport.

Current workspace realtime code is intentionally REST/SSE-oriented.

### Do not do

Do not:

- fake a WebSocket;
- poll and label it “WebSocket”;
- invent a new protocol without backend event infrastructure;
- continuously regenerate preview meshes at arbitrary intervals.

### When to activate

After:

- P0 raw quality is stable;
- SG-06/07/08/02.2 are stable;
- history and batch flows work;
- job event publication is well-defined.

### Future design direction

The future implementation may use:

\`\`\`
scheduler progress events
 ↓
preview artifact generation
 ↓
WebSocket transport
 ↓
GenerationLoadingPreview / MeshViewer
\`\`\`

But the final transport/protocol must be based on the actual backend event system at implementation time.

---

# 8. Features Explicitly Deferred / Do Not Implement Now

These tasks must remain out of the active production milestone unless a future engineering review changes their status.

## SG-03 — Smart-Flow Adapter

**Status:** DEFERRED / RESEARCH

Reason:

- current production task must not depend on uncertain external model/weight availability;
- introducing a new flow-based generator would add a new inference stack before existing quality issues are closed;
- the project already has multiple native model adapters that can be improved first.

Exit criteria before reconsideration:

- verified upstream/code availability;
- verified weight license and redistribution terms;
- proven quality advantage on ForMash3D test set;
- VRAM/latency benefit;
- clear integration path without destabilizing current models.

---

## SG-04 — Triplane-Octree Latent Swap

**Status:** DEFERRED / RESEARCH

Reason:

- VAE/encoder replacement is research-heavy;
- compatibility with current adapters is not assumed;
- risk is far above current product value.

No production implementation without a dedicated benchmark and architecture proposal.

---

## SG-05 — ControlNet-like Spatial Guidance

**Status:** DEFERRED / RESEARCH

Reason:

- current adapters do not expose one common spatial-conditioning contract;
- forcing bbox/voxel/point-cloud conditioning across unrelated models would create adapter-specific complexity;
- the feature is not a simple endpoint field addition.

Do not add generic fields that adapters silently ignore.

---

## SG-09 — Recursive Part-Based Generation

**Status:** DEFERRED / RESEARCH

Reason:

- split → independent generation → reassembly can introduce seam and alignment artifacts;
- no evidence yet that this improves the current pipeline relative to a high-fidelity single-pass model plus existing post-processing.

Only reconsider after a benchmark demonstrates consistent quality gain.

---

## SG-10 — ONNX / TensorRT Optimization

**Status:** DEFERRED / PERFORMANCE PHASE

Reason:

- quality correctness comes first;
- model export can introduce numerical or operator incompatibilities;
- optimization before stable quality measurements is premature.

Only activate after representative benchmarks exist.

---

## SG-12 — New External C++ Geometry Stack

**Status:** DEFERRED / RESEARCH

Potential technologies:

- Manifold/ManifoldPlus;
- CGAL;
- Mitsuba;
- OpenVDB;
- other native geometry toolchains.

Current repair/UV/retopo/collision stack should be proven insufficient before introducing build-heavy alternatives.

The default action is **improve the existing implementation before adding a new geometry backend**.

---

# 9. Additional Product Recommendations

These are not part of the seven required screenshot features, but they are strongly recommended because the current architecture can support them with relatively small incremental work.

## R-01 — Reproduce / Duplicate Generation

From any history item:

\`\`\`
Duplicate generation
 → same image
 → same model/preset
 → same relevant parameters
 → new job
\`\`\`

Why:

- reproducibility;
- debugging;
- seed comparisons;
- rapid iteration.

Reuse Asset History + existing generation settings.

---

## R-02 — Favorites / Collections

Allow users to pin/favorite important assets.

Use metadata, not another asset database.

Possible collections:

- Favorites;
- Characters;
- Props;
- Production;
- 3D Print;
- Archived.

---

## R-03 — Retry From Failure

Every failed job should expose:

- failed stage;
- error summary;
- “Retry same config”;
- “Retry with safe preset” when a resource issue caused the failure.

Do not rebuild the job manually.

---

## R-04 — Explainable Model Choice

For the smart selector, show:

\`\`\`
Selected: <model>
Why:
✓ supports image → raw
✓ enough VRAM
✓ supports requested texture mode
✓ satisfies game-ready preset
\`\`\`

This is cheaper and more valuable than a complex score visualization.

---

# 10. Cross-Feature Data Contract

The following metadata should be shared across generation, history, comparison, diff, and export.

## Job metadata

- job ID;
- source image ID;
- source image hash;
- preprocessed image ID/hash;
- model ID;
- preset ID/version;
- intent;
- effective generation parameters;
- scheduler resource decision;
- timestamps;
- source/master artifact;
- production artifacts;
- QA report;
- rigging status;
- printability status;
- export status.

## Artifact metadata

At minimum:

- canonical path/URL;
- artifact role;
- file type;
- size;
- hash;
- vertices;
- triangles;
- dimensions;
- materials;
- textures;
- UV metrics;
- topology metrics;
- post-process stage;
- status.

Do not create separate incompatible schemas for history, comparison, diff, and export.

---

# 11. Resource Management Specification

Every multi-job feature must use the same rules.

## Scheduler is authoritative

The UI sends jobs.

The scheduler decides:

- run now;
- queue;
- reject due to invalid input;
- cancel;
- retry.

## Comparison

Requested concurrency = 2–3.

Actual concurrency = scheduler-admitted concurrency.

## Batch

Requested jobs = N.

Actual running jobs = resource-admitted subset.

## Smart Selector

Model selection must consider hard resource constraints before submitting.

## Enhancement

Preprocessing must not accidentally consume the GPU budget intended for the generation model if a CPU/offload path already exists and is sufficient.

## UI requirements

When waiting for resources show:

- “Queued — waiting for VRAM”;
- selected model;
- estimated resource requirement when available;
- queue position when available.

Do not show fake percentages.

---

# 12. Testing Strategy

Every feature is incomplete until its regression surface is tested.

## 12.1 Unit tests

Required areas:

- preset parsing;
- preset merge/override;
- model capability filtering;
- resource admission decisions;
- printability flags;
- enhancement configuration;
- history mapping;
- comparison grouping;
- batch item state transitions;
- export manifest creation;
- diff metric calculation.

## 12.2 API tests

Required endpoints/contracts:

- image enhancement preview/approval path;
- smart generation;
- history;
- batch submission/state;
- comparison job grouping;
- printability metadata;
- auto-rigging;
- engine export.

Do not add endpoints merely when an existing endpoint can carry the same contract cleanly.

## 12.3 Frontend tests

Required flows:

- upload → enhancement preview;
- preview reject/edit/accept;
- preset save/load;
- batch upload;
- batch resource wait;
- comparison;
- asset history reopen;
- diff viewer;
- engine export;
- auto-rig toggle.

## 12.4 Integration tests

At minimum:

- image → raw generation;
- image → textured generation;
- generation + enhancement;
- generation + printability;
- generation + auto-rig;
- generation + preset;
- batch generation;
- comparison;
- history persistence;
- export of final asset.

## 12.5 Environment-gated tests

Do not mark these passed without their real runtime:

- full 22-model GPU smoke suite;
- 4×A100 concurrency;
- live Redis multi-worker;
- SAST/DAST;
- device/browser visual sweep;
- full WebSocket preview;
- optional research adapters;
- TensorRT;
- native C++ geometry libraries.

The task ledger must continue to say **NOT RUN** for unavailable environments rather than fabricating a result.

---

# 13. Verification Matrix

| Area | Required evidence |
|---|---|
| P0 Q1–Q8 | Root cause + regression + affected-path test |
| SG-06 | Enhancement preview + approved artifact provenance + generation test |
| SG-07 | Printability before/after + repair regression |
| SG-08 | Rigged artifact + failure-path test |
| SG-02.2 | YAML validation + deterministic model selection |
| UX-01 | Reload + reopen + metadata integrity |
| UX-02 | 2–3 model comparison + resource fallback |
| UX-03 | multi-image batch + resource-aware queue |
| UX-04 | save/load/migrate user preset |
| UX-05 | source/final metrics match QA |
| UX-06 | Unreal/Unity/Godot package validation |
| UX-07 | preview + manual edit + accept/reject |
| SG-01 | one-click intent workflow |
| SG-11 | only after actual backend transport exists |

---

# 14. Definition of Done

A task may only be marked **DONE** when all of the following are true:

1. Root cause/implementation need is documented.
2. Existing code was inspected for reusable implementation.
3. Minimal correct code was added or existing code was extended.
4. Targeted tests pass.
5. Relevant integration tests pass where the environment permits.
6. Failure paths are explicit.
7. No duplicate subsystem was created.
8. Relevant documentation is updated.
9. The task's acceptance criteria are satisfied.
10. Any environment-gated verification is explicitly marked **NOT RUN** rather than guessed.
11. The implementation is reflected accurately in this file.

---

# 15. Execution Order

The implementation must proceed in this order unless an actual blocker requires a deliberate change.

## Phase 0 — Raw quality

1. Recover and document BUG-Q1.
2. Fix and test BUG-Q1.
3. Repeat through BUG-Q8.
4. Re-run source-vs-postprocess quality verification.
5. Update \`Docs/MEMORY.md\`, \`Docs/CHANGELOG.md\`, and relevant architecture notes.

**Do not move to Phase 1 while unresolved raw-quality blockers remain.**

## Phase 1 — High-value quality/product foundations

6. SG-06 Image Enhancement + preprocessing preview.
7. SG-07 Printability check + auto-repair.
8. SG-08 Auto-rig pipeline wiring.
9. SG-02.2 Intent Presets.

## Phase 2 — Seven product workflow features

10. UX-01 Asset History / Generations Gallery upgrade.
11. UX-03 Batch Generation retrofit.
12. UX-04 User Generation Presets.
13. UX-07 Background Removal Preview integration with SG-06.
14. UX-02 Side-by-side Model Comparison.
15. UX-05 Mesh Diff Viewer.
16. UX-06 One-click Engine Export.

The exact order inside Phase 2 may change based on shared dependencies, but no feature may duplicate an existing subsystem.

## Phase 3 — Simplified Smart Generation

17. SG-01 Smart Selector.
18. Add explainable model choice.
19. Validate intent → preset → model → generation → post-process end to end.

## Phase 4 — Hold review

20. Reassess SG-11 WebSocket preview after the above features are stable.
21. Only activate research tasks if their exit criteria are satisfied.

---

# 16. Release Milestones

## Milestone A — Quality baseline

Complete:

- BUG-Q1 → Q8;
- raw source fidelity verification;
- no silent quality loss.

## Milestone B — Production-friendly generation

Complete:

- SG-06;
- SG-07;
- SG-08;
- SG-02.2.

## Milestone C — Premium workflow

Complete:

- UX-01;
- UX-02;
- UX-03;
- UX-04;
- UX-05;
- UX-06;
- UX-07.

## Milestone D — One-click smart generation

Complete:

- SG-01 simplified selector;
- preset/model explainability;
- end-to-end smart generation.

## Milestone E — Future realtime

Only after all earlier milestones are stable:

- SG-11.

---

# 17. Things That Must NOT Be Done During This Roadmap

Do not:

- reintroduce Text → 3D;
- create a new queue when the existing scheduler can be reused;
- add a new asset database merely for gallery UI;
- add a new exporter while \`meshExport.js\` already supports the required formats;
- create a new auto-rigging model when UniRig exists;
- add a second repair pipeline without proving the current one fails;
- build six-dimensional smart scoring before a deterministic preset system proves insufficient;
- claim WebSocket support before the backend actually supports it;
- add GPU-heavy preprocessing without measuring its resource impact;
- silently downgrade quality to make a benchmark look faster;
- report environment-gated checks as passed when they were not run;
- add speculative external libraries just because another product uses them.

---

# 18. Final Agent Checklist

Before marking the roadmap implementation cycle complete, the agent must confirm:

- [ ] RULES.md reread before implementation.
- [ ] Current Dev branch reread before touching code.
- [ ] \`Docs/TASKS.md\` used as the authoritative task list.
- [x] BUG-Q1 through BUG-Q8 have exact implementation contracts, source verification, and regression coverage; future agents must independently re-verify rather than trust this status.
- [x] SG-06 implemented with preview and provenance.
- [x] SG-07 implemented using existing repair/checking.
- [x] SG-08 wired through existing UniRig infrastructure.
- [x] SG-02.2 implemented as YAML intent presets without weighted scoring.
- [x] UX-01 history upgraded without creating duplicate persistence.
- [x] UX-02 comparison uses existing scheduler.
- [x] UX-03 batch uses existing queue/scheduler and is resource-aware.
- [x] UX-04 named presets reuse existing settings persistence.
- [x] UX-05 diff viewer uses immutable source + existing QA metadata.
- [x] UX-06 engine export reuses existing exporter and produces deterministic packages.
- [x] UX-07 background-removal preview reuses SG-06/RMBG/Image Editor.
- [ ] SG-01 simplified selector uses image-only intent → preset → model → generation.
- [ ] SG-11 remains held unless backend transport is actually implemented.
- [ ] SG-03/04/05/09/10/12 remain explicitly deferred unless their exit criteria are met.
- [x] Relevant documentation was updated.
- [ ] Targeted tests pass.
- [ ] Environment-gated tests are honestly marked NOT RUN when unavailable.
- [ ] No duplicate subsystem was introduced.
- [ ] Final Git history contains the intended documentation/code changes and nothing unrelated.

---

# 19. Phase-0 Verification Rule

**Never trust the status labels in this document as evidence.** A future agent must independently inspect the current branch, verify each Q1–Q8 contract against the live code, run the targeted regression tests, and reopen any item whose implementation or test evidence no longer matches.

# 20. Authoritative Product Decision

The practical product strategy is:

> **Fix quality first, then remove friction.**

The highest-value sequence is:

\`\`\`
raw-quality closure
   ↓
image enhancement + preview
   ↓
printability + repair
   ↓
auto-rig wiring
   ↓
intent presets
   ↓
history
   ↓
batch + comparison
   ↓
named presets
   ↓
diff
   ↓
engine-ready export
   ↓
smart selector
   ↓
real-time preview
\`\`\`

Research-heavy adapter rewrites remain out of the production path until the existing architecture proves it needs them.

This file is intentionally implementation-oriented and its status labels are advisory rather than evidence: every future agent should be able to start from the current \`Dev\` branch, inspect the stated existing code, follow the flow, reuse the existing subsystems, implement the smallest correct change, test it, and update the documentation without needing a second hidden task document.
