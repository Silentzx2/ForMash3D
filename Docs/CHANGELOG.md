## Route/page/function mount fixes — 2026-10-21 follow-up

- Fixed the tool-context help API's missing-data failure: added the six Markdown files expected by the active contextual-help mappings (mesh generation, texturing, Auto UV, auto-retopology, auto-rigging, segmentation).
- Added frontend CI contract coverage to assert every active contextual-help ID maps to a non-empty article.
- Previous route/wiring fixes in this pass added the `/workspace/tools` backend-backed panel, routed `/workspace/pbr` into the real tool suite, removed disabled `/workspace/upscale`, deleted unreachable secondary panels and removed the unused smart-generation client wrapper.

---

## Route/page/function mount fixes — 2026-10-21 follow-up

- Added `/workspace/tools` to the route contract, navigation, tool route map and `WorkspaceShell` render switch.
- Wired active backend mesh operations for inspection, optimization, auto-UV, retopology, repair, collision geometry, one derived LOD, FBX conversion, albedo flattening and high-to-low texture-map baking. Mesh transformations download separate GLB/FBX files; generated maps download as PNG. Source assets are never overwritten.
- Routed the legacy `/workspace/pbr` path to the real Mesh Tools panel and removed `/workspace/upscale`, which only presented disabled controls and has no 3D-upscale backend.
- Removed duplicate, unreachable Segment/Remesh/Edit panel branches and deleted the obsolete `SecondaryPanels` component.
- Removed the unused `ApiClient.generateSmartGeneration()` wrapper; the active Generate intent flow continues to use preset and intent-resolution endpoints.
- Documented the legacy React-Router feature pages that still require deliberate migration instead of claiming they are mounted.

---

## Route/page/function mount fixes — 2026-10-21 follow-up

- Added `/workspace/tools` to the route contract, navigation, tool route map and `WorkspaceShell` render switch.
- Wired the new Mesh Tools panel to the existing backend-backed mesh inspection, optimization, auto-UV, auto-retopology and repair helpers. Derived mesh outputs download as new GLBs and never overwrite the selected source asset.
- Removed duplicate, unreachable Segment/Remesh/Edit panel branches from `SecondaryPanel`; their dedicated panels were already mounted in `WorkspaceShell`.
- Removed the unused `ApiClient.generateSmartGeneration()` wrapper; the active Generate intent flow continues to use the preset and intent-resolution endpoints.
- Documented the legacy React-Router feature pages that still require migration instead of claiming they are mounted.

---

## Route/page/function mount audit (2026-10-21)

- Added explicit validation for the Next.js workspace catch-all route so unknown tool paths return 404 instead of silently rendering Generate.
- Mounted the users router in the single-worker FastAPI entrypoint to keep route coverage aligned with the production multi-worker entrypoint.
- Removed the unused `partCompletion()` client method and request type because its target endpoint is absent from the backend; removed the uncalled generic `queueWorkflow` stub that always failed.
- Added route-contract and router-parity regression tests and documented the source-level inventory in `Docs/ROUTE-MOUNT-AUDIT.md`.
- Live deployment smoke tests and GPU inference were not performed by this source audit.

---

## Advanced production control validation (2026-10-21)

- Hardened the generation request builder against stale/legacy production-setting values: unsupported topology values fall back to a valid tri/quad choice, unsupported LOD presets fall back to High, and unsupported auto-rig modes fall back to Full.
- Made triangle/quad request fields consistent from one canonical topology selection.
- Added matching API validators for topology, LOD preset and auto-rig mode on raw and textured image-to-mesh requests.
- Added generation contract tests and `Docs/GENERATION-CONTROL-AUDIT.md`, which distinguishes backend-wired controls from capability-gated or unsupported paths.
- CI validates request construction, types/build and backend source contracts. GPU inference, Blender bake/retopology and UniRig runtime execution were not performed in this pass.

---

## Generation request paths & Generate UI cleanup (2026-10-21)

- Primary Generate, background queue and batch image-to-3D submission now share model-choice and capability resolvers. Intent resolution is advisory: a manually selected model is never silently replaced by a preset suggestion.
- Batch queue snapshots preserve the selected atlas size, target budget, candidate count, LOD, topology, normal baking, QA/repair, rigging and physics settings. Generation-only guidance, Low-VRAM and model-resolution state are removed from request construction.
- A manual atlas-size change deactivates conflicting output intent. Re-enabling post-processing from Native/Raw restores a visible production budget so panel state and request semantics stay aligned.
- Legacy saved output recipes safely discard removed inference keys. Adapter-owned numerical profiles are unchanged.
- GPU inference and mesh-quality benchmarking were not run for this source-contract cleanup; automated checks must be read from the implementation commit's CI runs.

---

## Adapter-owned inference lock: alias filtering and request isolation (2026-10-21)

- Locked TRELLIS.2's model-side `texture_size` at the documented 4096 value and marked it read-only in the adapter schema; production atlas resolution remains a separate post-processing option.
- Hardened the scheduler firewall against the alternate top-level `steps` control and `texture_size`; nested Pixal3D and TRELLIS.2 sampler profiles are copied per request.
- Updated regression contracts for attempted request overrides, profile ownership and schema parity. No other numerical profiles were retuned; GPU inference requires deployment-hardware verification.

## Headless preview render: denoiser fallback (2026-10-21)

- Fixed the missing asset preview. The postprocess preview stage renders a 512px PNG in an isolated Blender subprocess and unconditionally enabled Cycles denoising; a Blender build without OpenImageDenoise (the `bpy` wheel used here) aborts the whole render with "Error: Build without OpenImageDenoiser", so the stage was skipped and the job shipped without `previews/thumbnail.png` and `previews/preview.jpg`.
- The worker now reads the Blender build flag and the Cycles denoiser enum before rendering, renders without denoising at a higher sample count when no denoiser exists, and retries without denoising if the render still fails. A missing preview remains a warning, never a failed job.
- Added `backend/tests/test_thumbnail_denoise_fallback.py` (5 tests) to the Backend Runtime Contract CI job.
- Fixed the physics stage report: the collision statistics are published as `parts`/`faces` by the collision service, but the pipeline still read the stale `hull_count`/`total_triangles` keys, so every run reported "Convex Hulls: N/A" and "Collision Triangles: N/A" despite a valid proxy. The pipeline now uses the canonical keys, its convex-hull fallback publishes the same keys, and the report shows the real body mass instead of a center-of-mass value the metadata never contained (`backend/tests/test_collision_stats_contract.py`).

## Runtime telemetry truthfulness: planned seeds vs executed seeds (2026-10-21)

- The runtime log no longer announces a seed count that no execution honors. The planner's `num_seeds` is a plan value, executed only when `planner_rules.yaml` sets `apply.auto_seeds: true` (it is off), so a request with one candidate ran one inference while the log said "3 seeds" — for every model adapter. `backend/core/planner.py::resolve_seed_plan` is now the single seed policy: the user's `candidate_count` wins, `apply.auto_seeds` decides whether the planned count runs, and `quality.yaml` `seeds.max_candidates` caps the result (ADR-095).
- The worker reports what actually runs: `[RUNTIME PARAMETERS]` carries `candidate_count`, `planned_candidate_count`, `auto_seeds_enabled` and `seed_schedule`, a `[SEED PLAN]` line states the decision, and the start box shows the candidate count and the seed schedule instead of the base seed alone. The planner reason line reads "3 planned seeds, 1 executed because auto_seeds is disabled".
- Adapter-owned inference values are reported after inference: the start box names the source, and a new `[EFFECTIVE PARAMETERS]` line logs the steps, guidance, seed and texture resolution the adapter actually used (TRELLIS: 50/50 steps, sparse CFG 7.5, SLAT CFG 3.0). No locked adapter profile was changed.
- Removed the duplicated `apply:` block in `backend/config/planner_rules.yaml`; the effective values are unchanged. Added `backend/tests/test_seed_plan_resolution.py` (7 tests) to the Backend Runtime Contract CI job.

## Intent resolution fix for mesh generation (2026-10-21)

- Fixed `HTTP 400` on `POST /api/v1/smart-generation/resolve`, which failed mesh generation whenever an output preset was selected. Manifest model paths (for example `backend/pretrained/TRELLIS`) were resolved against the wrong roots, so every model looked uninstalled to the intent resolver: the API and scheduler processes do not run from the repository root (Docker supervisord uses `/app/backend`, `backend/scripts/run_server.sh` changes into `backend/`). A single repository-root-relative resolver (`core/utils/artifact_utils.py::resolve_manifest_path`) now backs both the resolver and the model-readiness badge, so the two can no longer disagree (ADR-094).
- Made the intent → model resolve advisory in the Generate action: a resolve failure is logged and generation continues with the user's explicit model, matching the queue and batch paths. Readiness and resource admission stay with the scheduler (ADR-045, ADR-046); the endpoint still answers 400 with an actionable message for an unknown intent, an unregistered or incompatible model, missing weights, or a model that cannot fit the current free VRAM.
- `core/utils/__init__.py` now exposes its helpers lazily, so importing a light submodule no longer requires the optional `aiofiles`/`Pillow` upload dependencies.
- Added `backend/tests/test_manifest_path_resolution.py` (6 tests) covering the CWD-independent path resolution, the shared-resolver wiring, and the readiness contract, and included it in the Backend Runtime Contract CI job.
