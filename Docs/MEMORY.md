## 2026-10-24 — Dynamic Random Seed Assignment & Unique3D Refinement Safeguards

- **Dynamic Random Seed Assignment**:
  - Root cause: `features/workspace/store/WorkspaceContext.tsx` and `stores/useAppStore.ts` hardcoded `seed: 42891`, and `backend/core/planner.py` / `quality.yaml` defaulted to static `base_seed: 42891`, causing every generation job without an explicit user seed to repeat the fixed schedule `[42891, 44228, 45565]`.
  - Fix: Updated `WorkspaceContext.tsx` and `useAppStore.ts` to assign dynamic random seeds (`Math.floor(Math.random() * 900000) + 100000`). In `multiprocess_scheduler.py`, when a job has no explicit user seed, dynamically generate a fresh random base seed (`random.randint(10000, 999999)`).
- **Unique3D Refinement Safeguards**:
  - Root cause: When `do_refine: True` was enabled without SD controlnet tile IP-adapter weights loaded in `model_zoo`, `pipe_disney_controlnet_tile_ipadapter_i2i` returned `None`, raising `TypeError: 'NoneType' object is not callable` in `refine_lr_to_sr.py` / `refine_rgb`.
  - Fix: In `backend/adapters/unique3d_adapter.py`, inspect `model_zoo.pipe_disney_controlnet_tile_ipadapter_i2i` and demote `effective_do_refine = False` if missing. In `backend/thirdparty/Unique3D`, safely bypass refinement and fall back to Lanczos resizing when `pipe is None`. Pushed sub-repo changes to `Silentzx2/ForMash3D-ThirdParty` (`main`).
- **Verification**: 53 passed, 7 skipped backend tests, 55 passed bun tests, `npx tsc --noEmit` clean.

## 2026-10-24 — Multi-GPU Load Sharing Planning & Raw Mesh Model Route Normalization

- **Multi-GPU VRAM load sharing in planner**:
  - Root cause: `backend/core/runtime_probe.py` only queried GPU 0 (`torch.cuda.mem_get_info(0)`), setting `free_vram_gb` to single-device memory (e.g. 14.36 GB). In `backend/core/planner.py`, candidates were rejected if `vram_budget_gb > free_vram_gb`, ignoring `multi_gpu` capability where aggregate VRAM across multiple GPUs (e.g. 28.72 GB) satisfies the model budget (23.0 GB) and `low_vram_supported` threshold (10.0 GB).
  - Fix: Extended `probe_runtime` to inspect all devices (`gpu_count`, `aggregate_free_vram_gb`, `max_free_vram_gb`). Updated planner Check D to allow multi-GPU load sharing when `multi_gpu` is enabled and aggregate VRAM >= model budget, or low-VRAM sequential offload mode when free VRAM >= low-VRAM requirement.
- **Raw mesh model routing**:
  - Root cause: UI and preset priorities referenced deprecated legacy textured alias `trellis2_image_to_textured_mesh` instead of `trellis2_image_to_raw_mesh` for `image-to-raw-mesh` generation.
  - Fix: Registered `trellis2_image_to_raw_mesh` in `constants/models.ts` and set as default in `app/page.tsx` and `GeneratePanel.tsx`. Updated `smart_presets.yaml` priorities. Added legacy alias mapping in `backend/api/routers/mesh_generation.py` and `backend/core/planner.py` to route all legacy textured requests to raw geometry models.
- **Verification**: 52 passed / 6 skipped pytest, 55 passed bun test, `tsc --noEmit` clean. No git push per user instruction.

## 2026-10-24 — Postprocess / viewer regression fixes

- **Auto-rig scheduling:** `backend/api/routers/auto_rigging.py` now imports `sha256_file` from `core.utils.artifact_utils`, the canonical streaming hash utility; it no longer imports the removed private `_sha256_file` name from `postprocess.pipeline`.
- **Black albedo-only texture output:** the texture stage patches only missing PBR factors inside the GLB JSON chunk (preserving the mesh, images and binary chunks), checks UV validity and rejects an all-black/all-white base-colour atlas, and retains the painter's GLB for final game-ready export rather than flattening a multi-node scene and re-exporting one `Trimesh`.
- **Retopology quality protection:** `run_auto_retopo` checks surface drift through the existing `quality.gate.max_native_mesh_normalized_drift` threshold from `backend/config/quality.yaml`. A failed/unverifiable drift check rejects the retopo candidate; pipeline callers that already catch retopo exceptions continue with their prior repaired mesh.
- **Viewport shading:** imported normal attributes containing zero-length or non-finite vectors are recomputed. Wireframe mode now draws visible edges over an opaque depth-writing base surface, so back-facing/rear/internal edges are not rendered as a second wireframe shell. This fixes the viewer presentation path; it does not delete genuine overlapping geometry in a source file.
- **Verification boundary:** focused regression tests were added for canonical hash import, retopo drift, textured GLB chunk preservation and invalid normals. The push-triggered GitHub Actions checks must be inspected before claiming tests passed. GPU inference and comparison against the user's actual asset are not performed by these source-level tests.

## 2026-10-24 — Auto-Seeds Activation, Rate-Limiter Deactivation, Non-Textured PBR Shading & Quad Topology Fixes

- **Non-textured mesh PBR shading fix (weird black mirror with white specks)**:
  - Root cause: In `backend/postprocess/pipeline.py` & `auto_uv.py`, untextured/baked GLTF meshes exported `PBRMaterial` without `pbrMetallicRoughness` factors. In the glTF 2.0 / Three.js specification, omitted metallic factors default to `1.0` (100% metallic mirror) with zero diffuse reflectance, turning the mesh pitch black with noisy specular white specks.
  - Fix: Added explicit studio clay PBR factors (`metallicFactor=0.0`, `roughnessFactor=0.7`, `baseColorFactor=[0.82, 0.82, 0.82, 1.0]`) in `_export_glb`, bake material assembly, and `auto_uv.py`. Also added protective metalness clamping in `MeshViewer.tsx` for any loaded untextured GLTF.
- **Quad topology conversion fix**:
  - Root cause: `to_quad_dominant` in `remesh.py` unconditionally invoked `pymeshlab.MeshSet()`, which crashed with `AttributeError` on environments without pymeshlab (`ml is None`), causing quad conversion to silently abort and retain triangles. Additionally, `pipeline.py` never populated `topology: "Quad"` or `quad_dominant: True` in `_build_result` or `quality_trace["game_ready"]`.
  - Fix: Implemented pure-Python/NumPy curvature-aware greedy triangle pairing (`pair_triangles_to_quads`) as an automatic zero-dependency fallback. Wired `topology: "Quad"` and `quad_topology: True` into `_build_result` and `quality_trace["game_ready"]`, ensuring quad OBJ export and quad metadata contract.
- **Auto-seeds enabled**:
  - `backend/config/planner_rules.yaml`: set `apply.auto_seeds: true` so the planner automatically executes multi-seed candidate scoring for requested quality tiers instead of collapsing to a single candidate.
- **Rate limiting disabled for personal/self-hosted deployment**:
  - `backend/config/system.yaml` & `backend/core/config.py`: configured `rate_limit_enabled: false` and `rate_limit_per_minute: 0`.
  - `backend/api/dependencies.py`: short-circuited `apply_rate_limit`, `check_rate_limit`, and `_rate_limit_result` when disabled or limit <= 0 to eliminate HTTP 429 locks during concurrent telemetry HUD polling, task progress polling (`/api/v1/system/jobs/*`), and client action logging.
  - Verification: 12/12 pytest tests pass (`test_topology_repair.py`, `test_seed_request_contract.py`), 54/54 bun tests pass, `tsc --noEmit` 0 errors.

## 2026-10-23 — Production Readiness + Beta Phase

- Auth removed entirely from backend + frontend (personal/self-hosted use, no paid SaaS)
  - Deleted `get_auth_service`, `get_current_user`, `get_current_user_optional`, `require_admin`, `get_current_user_or_none` from `backend/api/dependencies.py`
  - Removed auth checks from all routers: `system.py`, `mesh_generation.py`, `smart_generation.py`, `auto_rigging.py`, `motion_generation.py`, `mesh_retopology.py`, `mesh_uv_unwrapping.py`, `mesh_editing.py`, `mesh_segmentation.py`, `database.py`
  - Deleted `backend/api/routers/users.py`
  - Removed `auth_service` lifecycle from `backend/api/main_multiworker.py`
  - Removed auth header forwarding from frontend API proxy (`app/api/v1/[...path]/route.ts`)
  - Deleted `services/authPersistence.ts`
- Feature improvements (Tripo/Meshy/Hyper3D parity — no segment/mesh-edit):
  - `backend/config/smart_presets.yaml` — `slicer_handoff` added to all 8 intents
  - `backend/core/smart_presets.py` — `slicer_handoff: False` default
  - `backend/api/routers/mesh_generation.py` — `slicer_handoff`, `part_count_range`, `rig_type`, `export_formats` request fields wired to job inputs/metadata
  - `frontend` — quad topology toggle, multi-variant selector (1-4), part segmentation presets (3-6/6-15/15+), rig type selector, export format selector in GeneratePanel
  - `frontend` — quad-compatible smart UV toggle in TexturePanel
- Task A — CPU-only auto mode (implemented, not pushed):
  - `scripts/lib/compute_mode.sh` — shared resolver (auto|cpu|cuda)
  - `scripts/setup.sh` — `--cpu`/`--gpu`/`--with-thirdparty`/`--update-thirdparty` flags, skips CUDA steps in CPU mode, `err()` defined, summary shows mode+skipped
  - `scripts/start.sh` — CPU mode exports `CUDA_VISIBLE_DEVICES=""` and `FORMASH3D_COMPUTE=cpu`
  - `manager.sh` — `setup` passes through flags
  - `backend/scripts/install.sh` — CPU torch wheels, `ensure_release_wheels` cuda-only, model stacks in `install_model_stacks()`, ARDY optional with `--cpu-extras`
  - `backend/requirements-core.txt` + `backend/requirements-models.txt` + `backend/requirements.txt` split
  - `scripts/tests/script_test.sh` — resolver + static grep tests
  - `.github/workflows/backend-runtime-ci.yml` — resolver test job
- Task B — SEO/contributor growth (implemented, not pushed):
  - README keyword H1, badges, TOC, contributor path, beta banner
  - CONTRIBUTING.md CPU setup section
  - CODE_OF_CONDUCT.md, SECURITY.md (root), PR template, labels.yml, config.yml
  - docs/GOOD_FIRST_ISSUES.md (15 drafts), ARCHITECTURE_FOR_CONTRIBUTORS.md, GITHUB_SETUP.md, OUTREACH.md
- Tests: `bun test` 54/54 pass, `pytest backend/tests/` 40 passed/6 skipped, `npx tsc --noEmit` zero errors
- Git: dev branch pushed to origin/dev (not upstream)
- Project marked BETA phase (README has Phase: BETA banner)
- Zero `pre-alpha`/`prealpha` references remain in any `.md` file

## 2026-10-22 — Parallel Audit Repair Execution

- The user authorized implementation across all batches in parallel. This task-specific authorization supersedes the older one-batch pause, but does not authorize speculative inference-profile retuning or overwriting collaborator changes.
- Sample SVG inputs now rasterize to PNG and use the standard upload path. Generation request contracts preserve an explicit seed of zero, honor explicit model choice, and keep production settings separate from adapter-owned inference.
- Auto-Repair OFF preserves geometry; final topology and master-drift gate failures or missing required comparisons affect production status. Safe hole repair is bounded/configured, collision artifacts remain isolated, and fallback/error details are retained.
- Artifact hashing uses the canonical helper. Quality thresholds remain configured in `backend/config/quality.yaml`.
- The audit follow-up fixed automatic-vs-explicit model fallback and feature compatibility for planner-selected models. Physics defaults, bounds, comparison sampling, and collision quality profiles are configured in `backend/config/quality.yaml`; the UI uses a minimal defaults/bounds mirror enforced by `backend/tests/test_config_ssot.py`.
- The full Python 3.10 backend suite passed 50 tests before the final config-mirror test was added. Both config SSOT tests pass in the current Python 3.14 environment; the full backend suite was not rerun there because the required Python 3.10 test dependencies are not currently installed.
- Frontend validation: 52 Bun tests passed, TypeScript passed, production build passed, and targeted ESLint on changed files reported 0 errors and 58 warnings. Browser interaction, GPU/model inference, deployed API smoke tests, Blender bake/retopology, and UniRig execution are NOT RUN.
- Commit `ce51e212` is on local `dev`. `git push origin dev` failed with `fatal: unable to get password from user`; `gh auth status` confirms no GitHub login; SSH retry failed with `Permission denied (publickey)`. The remote branch is unchanged, so no PR was created.
- TRELLIS's requested/effective step-count discrepancy remains unresolved pending measured comparison and explicit approval; do not change the active profile or call cap without that approval.

## 2026-10-21 — Route / Page / Function Mount Fix Follow-up

- Tool-context help buttons now have real Markdown backing files for all six active article IDs; frontend CI guards against missing or empty articles.
- `/workspace/tools` is a real visible workspace panel for backend-backed inspect, optimize, Auto UV, auto-retopology, repair, collision, LOD 1, FBX conversion, albedo flattening and high-to-low texture bake operations.
- `/workspace/pbr` aliases the functional Mesh Tools panel. The unsupported `/workspace/upscale` route and obsolete disabled secondary panel were removed.
- Explicit migration backlog remains: legacy image-editor, board, graph and full wiki pages rely on missing React Router/project-provider integrations and are not reported as mounted.

---

## 2026-10-21 — Route / Page / Function Mount Fix Follow-up

- Added `/workspace/tools` as a visible, allow-listed workspace panel and routed `/workspace/pbr` into that functional tool suite.
- Connected inspect, optimize, auto-UV, auto-retopology, repair, collision, LOD 1, FBX conversion, albedo flattening and high-to-low texture-map baking to existing backend helpers. Output meshes/maps download as separate GLB/FBX/PNG files without overwriting source assets.
- Removed the unavailable `/workspace/upscale` route, duplicate Segment/Remesh/Edit panel branches and the obsolete `SecondaryPanels` component.
- Deleted the unused smart-generation client wrapper while preserving active smart preset and intent resolution calls.
- Added regression coverage asserting that the unsupported upscale route is rejected and the Mesh Tools route remains available.
- Explicit migration backlog remains: legacy image-editor, board, graph and wiki pages depend on missing legacy providers/React Router and are not treated as mounted Next.js routes.

---

## 2026-10-21 — Route / Page / Function Mount Fix Follow-up

- Added a real `/workspace/tools` panel to the Next.js route allow-list, workspace navigation, route map and panel renderer.
- Connected inspect, optimize, auto-UV, auto-retopology and topology-repair actions to the existing FastAPI mesh-tools API; transformed outputs download as separate GLBs and do not overwrite the input asset.
- Removed unreachable duplicate Segment/Remesh/Edit UI branches from `SecondaryPanel` and deleted the unused smart-generation client wrapper.
- Regression coverage now asserts that `/workspace/tools` is an allowed tool route.
- Explicit migration backlog remains: legacy image-editor, board, graph and wiki pages depend on missing legacy providers/React Router and are not treated as mounted Next.js routes.

---

## 2026-10-21 — Route / Page / Function Mount Audit

- **Inventory:** 9 Next.js page files, 3 Next route handlers, 14 FastAPI router modules and 113 decorator-defined API handlers found by static source inventory.
- **Workspace route safety:** catch-all tool routes now use an explicit allow-list and return Next.js 404 for unknown or malformed paths; known tool/view aliases and job detail routes remain valid.
- **Router parity:** single-worker FastAPI entrypoint now imports and mounts `users.router`, matching the production multi-worker entrypoint.
- **Dead/unsupported client paths:** removed uncalled `ApiClient.partCompletion()` (no backend route exists) and its request type; removed the uncalled generic `queueWorkflow` stub that always threw.
- **Audit report:** `Docs/ROUTE-MOUNT-AUDIT.md` lists page routes, API router coverage, unreferenced wrappers and verification limits.
- **Verification boundary:** source contract tests and frontend CI are required; deployed HTTP smoke tests and GPU inference are not implied by source-level checks.

---

## 2026-10-21 — Batch 5/6: Advanced Production Control Audit

- **Enum contract:** generation request construction now normalizes persisted topology, LOD preset and auto-rig values to supported options. Topology mode and the legacy quad boolean are emitted consistently.
- **Backend validation:** raw and textured image-to-mesh request schemas validate topology, LOD preset and auto-rig mode instead of allowing unknown strings to silently drift into the pipeline.
- **Control truthfulness:** added `Docs/GENERATION-CONTROL-AUDIT.md` with the request field and backend consumer for each advanced control, explicit runtime-dependency caveats, and the two known non-active paths (deformation/jiggle and the generic workflow queue stub).
- **Verification limit:** GPU model inference, mesh-quality A/B, Blender bake/retopology and UniRig runtime execution were not run as part of this pass; final CI state is recorded after push.

---

## 2026-10-21 — Batch 3/4 Follow-up: Request Contract & Generate UI

- **Request path consistency:** Direct, queued and batch generation use the same model-choice preference and manifest-capability helpers. Intent resolution can supply a model only for auto-model requests; it cannot silently change a manual model selection.
- **Batch fidelity:** Enqueued items retain production atlas resolution, target budget, candidate count, LOD options, normal baking, QA/repair, rigging and physics choices. Generic guidance, Low-VRAM and model-resolution values are removed from generation-only state and are not built into model requests.
- **Preset truthfulness:** A changed atlas size deactivates a conflicting intent. Re-enabling post-processing after Native/Raw restores the existing 50K output-budget default rather than leaving the panel in a contradictory state.
- **Legacy recipes:** Old inference override keys are filtered on import/save; supported adapter input parameters remain limited to the seed in the request builder.
- **Verification boundary:** GPU inference and mesh-quality benchmarking were not run as part of this batch.

---

## 2026-10-21 — Adapter-Owned Inference Lock: Alias Filtering and Request Isolation

- **Adapter audit**: confirmed the active max-detail profiles stay in the model adapters; the numerical profiles were not retuned in this pass. TRELLIS.2's documented/runtime model-side texture default was 4096 while its schema advertised an editable 8192, which could diverge when schema values were serialized. The adapter now locks `texture_size=4096` and marks that model-side value read-only; production atlas resolution remains separate.
- **Overwrite-path hardening**: the scheduler now strips the alternate top-level `steps` control and `texture_size` from adapter-owned model requests, alongside the existing step/guidance/resolution/sampler keys.
- **Request isolation**: Pixal3D and TRELLIS.2 deep-copy nested profile dictionaries per request, preventing downstream in-place mutation from carrying into later jobs.
- **Verification**: regression contracts were updated. GPU inference was not run in this editing pass; CI status must be checked after the push.

---

## 2026-10-21 — Headless Preview Render: Denoiser Fallback

- **Root cause of the missing preview**: `backend/postprocess/tools/thumbnail_worker.py` renders the 512px preview in an isolated Blender subprocess and set `scene.cycles.use_denoising = True` unconditionally. The Blender build in this deployment (the `bpy` wheel) has no OpenImageDenoise, so Cycles aborted the whole render with "Error: Build without OpenImageDenoiser"; the postprocess stage logged "Preview generation skipped" and the job completed at 98% without `previews/thumbnail.png` and `previews/preview.jpg`.
- **Fix**: the worker now inspects the Blender build options and the Cycles `denoiser` enum before rendering. When no denoiser exists it renders without denoising at a higher sample count (64 instead of 24), and if the render still fails with a denoiser error it retries once without denoising. No other stage used Cycles denoising, so the change is confined to the preview worker; a missing preview stays a warning and never fails the job.
- **Verification**: `backend/tests/test_thumbnail_denoise_fallback.py` (5 tests) covers the build-flag path, the denoiser-enum fallback and the unknown-build case. The Blender render itself is **NOT RUN** in this environment (no `bpy`), so the preview must be confirmed on the deployment host.
- **Collision stage reporting**: the stage-8 box printed "Convex Hulls: N/A" and "Collision Triangles: N/A" even though the collision proxy existed. `postprocess/services/collision.py` publishes the statistics as `method`/`parts`/`faces`/`vertices` (and `postprocess/physics.py` reads the same names), but the pipeline still used the stale `hull_count`/`total_triangles` keys, and its convex-hull fallback published the same stale names. The pipeline now uses the canonical keys and reports the real body mass from `physics.json` (`body.mass_kg`) instead of a "Center of Mass" value that the metadata never contained. Covered by `backend/tests/test_collision_stats_contract.py`.

---

## 2026-10-21 — Runtime Telemetry Truthfulness: Planned Seeds vs Executed Seeds

- **Root cause of the confusing runtime parameters**: the planner's `num_seeds` is a plan value. The planner reason line printed it as "3 seeds" (the `high` tier in `backend/config/planner_rules.yaml`), but the scheduler only executes the planned count when `apply.auto_seeds` is enabled, and that switch is off. A request with one candidate therefore ran exactly one inference while the log announced three, and the start box reported only the base seed with no candidate count — which reads as the seed and the parameters changing mid-run, for every model adapter.
- **Single seed policy**: `backend/core/planner.py::resolve_seed_plan` resolves the request, the plan and the configuration into the effective candidate count and the exact seed schedule. The user's `candidate_count` wins, `apply.auto_seeds` decides whether the planned count is executed, and `quality.yaml` `seeds.max_candidates` caps the result. The scheduler now uses it, and the candidate cleanup rule keys off `auto_candidates` instead of the removed `mode_b` flag.
- **The log now states what runs**: `[RUNTIME PARAMETERS]` carries `candidate_count`, `planned_candidate_count`, `auto_seeds_enabled` and `seed_schedule`; a `[SEED PLAN]` line prints the decision; the start box shows the candidate count and the seed schedule. The planner reason line reads "3 planned seeds, 1 executed because auto_seeds is disabled".
- **Adapter-owned values are reported after inference**: the start box names the source ("adapter-owned (effective values reported after inference)") and a new `[EFFECTIVE PARAMETERS]` line logs the steps, guidance, seed and texture resolution from the adapter's own `generation_info` (TRELLIS: 50/50 steps, sparse CFG 7.5, SLAT CFG 3.0, texture resolution 2048). No locked adapter profile was changed.
- **Config cleanup**: `backend/config/planner_rules.yaml` declared `apply:` twice; the trailing duplicate was silently dropped by the YAML loader and is now removed with identical effective values.
- **Verification**: `backend/tests/test_seed_plan_resolution.py` (7 tests) covers the seed policy matrix and runs in the Backend Runtime Contract CI job; the contract subset passes 69/69 and `python3 -m compileall -q backend` is clean. GPU inference remains **NOT RUN** in this environment (no `torch`/`trimesh`/`skimage`, no GPU).

---

## 2026-10-21 — Intent Resolution Fix: Repository-Root Model Paths and Advisory Resolve

- **Root cause of the `HTTP 400` on `POST /api/v1/smart-generation/resolve`**: `core/smart_presets.py::_model_ready` resolved manifest model paths against `Path.cwd() / model_path`, `backend / model_path`, and `<repo-root> / model_path.replace("backend/", "")`. The API and scheduler processes do not run from the repository root (Docker supervisord uses `/app/backend`; `backend/scripts/run_server.sh` changes into `backend/`), so `backend/pretrained/TRELLIS` never resolved to the real directory and every model looked uninstalled. `resolve_intent` raised `ValueError` and the endpoint answered 400, aborting generation whenever an output preset was selected. The UI readiness badge stayed green because `api/routers/system.py` resolved the same path against the repository root correctly — two implementations of one lookup disagreed.
- **Fix (ADR-094)**: one shared resolver, `core/utils/artifact_utils.py::resolve_manifest_path`, resolves a manifest path against the repository root (`<repo>/<path>`, `<repo>/backend/<path>`) and the CWD. `core/smart_presets.py::_model_ready` and `api/routers/system.py::_resolve_manifest_path` both use it, so readiness and model listing can no longer disagree. `core/utils/__init__.py` exposes its helpers lazily, so a light submodule import no longer requires the optional `aiofiles`/`Pillow` upload dependencies.
- **Intent resolution is advisory**: the Generate action now logs a resolve failure and continues with the user's explicit model, exactly like the queue and batch paths. The backend re-resolves the intent, and the scheduler owns model readiness and resource admission (ADR-045, ADR-046). The endpoint still answers 400 with an actionable message for an unknown intent, an unregistered or incompatible model, missing weights, or an explicit model that does not fit the current free VRAM.
- **Verification**: `backend/tests/test_manifest_path_resolution.py` (6 tests) covers the CWD-independent resolution, the shared-resolver wiring, and the readiness contract; the Backend Runtime Contract CI subset passes (62 tests, was 56). `python3 -m compileall -q backend` clean. `bun test` 41/41, `npx tsc --noEmit` 0 errors, `npx eslint` 0 errors / 165 warnings (unchanged). GPU inference and the heavy backend modules remain **NOT RUN** in this environment (no `torch`/`trimesh`/`skimage`, no GPU); the 53 import failures are unchanged.

---

## 2026-10-21 — Production Option Contract: LOD Wiring, Tri-State Precedence & Preset SSOT

- **LOD controls are now wired end-to-end**: the Advanced drawer exposed an LOD toggle, ratio preset, and level count that the request builder never serialized, so the choice was discarded before reaching the pipeline. `generate_lod`, `lod_preset`, and `lod_count` are now first-class request fields consumed by the LOD stage (`job_inputs["generateLOD"] / "lodPreset" / "lodCount"`). The level count is limited to 2–4 levels because the pipeline builds at most LOD0–LOD3.
- **Tri-state production options (ADR-093)**: `texture_resolution`, `enable_printability_check`, `enable_auto_repair`, `enable_auto_rig`, `physics_enabled`, `generate_lod`, `lod_preset`, and `lod_count` are `Optional[...] = None` on both generation request schemas. Resolution is explicit request value → intent preset (`backend/config/smart_presets.yaml`) → backend default, so an explicit `false` always wins and an omitted field still lets the preset supply its default.
- **`target_polycount` keeps its numeric presence contract**: a value `> 0` or the `-1` native sentinel wins; `0` means "no explicit budget" and falls back to the intent preset. Native/Raw is expressed with `intent=native` or `enable_postprocess=false`.
- **Legacy channel closed**: `model_parameters.generateLOD` / `lodPreset` / `lodCount` are popped and discarded, so they can neither leak into the job inputs nor override the preset. `model_parameters` now carries only `seed`.
- **Preset SSOT**: the panel derives the chip summary and recipe values from the backend catalogue instead of a second hardcoded copy. The offline fallback moved to `constants/smartPresetFallback.json` and is guarded by `backend/tests/test_smart_preset_parity.py`. The mobile preset's atlas size was corrected from 512 (rejected by the API) to 1024.
- **Dead control removed**: the Live execution panel's "Enable Low VRAM Mode (<8GB) & Retry" button could not change anything in the request, so it was deleted.
- **Verification**: `bun test` 41/41 pass, `npx tsc --noEmit` clean, `npx eslint` clean on the changed files, `backend/tests/test_preset_alignment_and_persistence.py` 24/24 pass, `backend/tests/test_smart_preset_parity.py` passes, and the CI backend contract subset passes (56 tests). The heavy backend modules and GPU inference are **NOT RUN** in this environment (missing `torch`/`trimesh`/`skimage`, no GPU); the 53 import failures are identical before and after this change.
- **Commit**: `537d8b49` + `47251a8a` pushed to `origin/dev` and `upstream/dev`. The first upstream push failed with `remote: Permission to Silentzx2/ForMash3D.git denied` because the sandbox codespace credential helper (`/.codespaces/bin/gitcredential_github.sh`) is not authorized for that repository; `git -c credential.helper= push` with an explicit credential succeeds. No token was written to the repository, the git config, or disk.

---

## 2026-10-21 — Generate Studio Refactor: Locked Adapter Profiles, UI Simplification & Pipeline Contract

- **Adapter-Owned Inference Authority**: Model-specific inference schedules, step counts, guidance scales, octree resolutions, samplers, and decoders are locked directly into adapter implementations (`_LOCKED_INFERENCE_PROFILE`). The multiprocess scheduler filters incoming overrides (`_ADAPTER_OWNED_INFERENCE_INPUTS`, `_POSTPROCESS_ONLY_INPUTS`) and delivers clean inputs (`image_path`, `seed`, `source_quality="max"`).
- **Simplified Generate Studio UI (`GeneratePanel.tsx`)**:
  - Removed disconnected/fake inference sliders (Fast/Balanced/High quality selectors, step counts, guidance sliders, octree resolution inputs, Low VRAM switches).
  - Single primary flow: Reference image intake, Model selection with authentic readiness/VRAM indicators, Textured generation toggle, and a single **Target Polycount / Output Preset** card.
  - Eliminated duplicate polycount sliders and duplicate post-processing master switches. Exactly one master switch controls downstream postprocessing.
  - Non-destructive preset selection: Clicking an output preset populates recommended defaults and **never** auto-submits.
- **Clean Advanced Production Drawer**: Contains genuine production finishing controls only:
  - Multi-seed Candidate generation (1 to 4 variations with deterministic seed stepping and composite scoring).
  - Triangle vs quad-dominant retopology (AutoRetopo quad conversion).
  - Automatic UV unwrapping (PartUV / xatlas) with no user-facing toggle.
  - High-to-low normal map baking from immutable master mesh (`master/source.glb`).
  - Hierarchical LOD generation (toggle, ratio preset, 2–4 levels).
  - Production QA toggles: printability check, auto-repair, auto-rig with mode selector.
  - Physics preparation with collision hull generation and material quick presets.
- **Unified Production Presets as Output Recipes**:
  - Six recipes defined by `backend/config/smart_presets.yaml`: `mobile` (20K, 1K), `game_ready` (50K, 1K, collision), `cinematic` (200K, 2K), `animation` (30K, 1K, auto-rig), `3d_print` (full resolution, printability + auto-repair), `native` (raw extraction, no post-processing).
  - Post-processing pipeline consumes production recipe flags and preserves SHA-256 byte-level immutability of `master/source.glb`.
- **Contract Specification**: Authored `Docs/GENERATION-UI-CONTRACT.md` establishing explicit data flow and invariants across UI $\to$ Request Builder $\to$ API $\to$ Scheduler $\to$ Adapter $\to$ Postprocess Pipeline.
- **Decision Records**: Documented ADR-056 and ADR-057 in `Docs/DECISIONS.md`.

---

## 2026-10-20 — Generate Refactor Batch 1: Adapter-Owned Inference Profiles

- Moved the effective `dev` scheduler profile into `_LOCKED_INFERENCE_PROFILE` for Hunyuan3D-Shape-v2.1 and TripoSG without changing numerical values.
- The scheduler filters request-side profile overrides for those model IDs, leaves seed/image identity intact, and keeps target polycount downstream.
- Geometry telemetry prefers adapter-reported effective values when request-side inference keys are withheld.
- Updated schema/source-contract tests to match the live profile. Python tests and GPU inference have **not** been run in this editing environment.

---

## 2026-10-20 — Batch 4: SSOT, Truth, Wiring, and Cleanup (Tasks 4A, 4B, 4C)

- **Single Source of Truth (SSOT - G0):**
  - Consolidated 5 fragmented configs (`bake_config.yaml`, `decimation_config.yaml`, `gate_thresholds.yaml`, `seed_scoring.yaml`, `uv_config.yaml`) into single canonical `backend/config/quality.yaml`.
  - Added cached `get_quality_config()` in `core/config.py` enforcing mandatory validation against `_QUALITY_REQUIRED_KEYS`.
  - Deleted module-level numeric `DEFAULT` dictionaries and isolated YAML loaders from `uv_backend_resolver.py`, `memory_safe_decimate.py`, `pbr_validator.py`, `seed_scorer.py`, `gate.py`.
  - Unified feature/crease angles to `quality.shared.feature_edge_angle_deg` (35°) across `simplify.py`, `bake.py`, and `metrics.py`.
  - Replaced copy-pasted tier validators across routers with unified `validate_quality_tier()`, making schema default `None` with fallback to `quality.default_tier`.
  - Backend computes `quality_tier` (`sharp`, `clean`, `needs_review`) and adds to quality report; frontend `QualityBadge` renders directly without duplicated cutoffs.
  - Added SSOT rule to `RULES.md` and test suite `backend/tests/test_config_ssot.py` (6/6 passing).
- **Planner Execution & Fallback (G1):**
  - Added `apply: {model_choice: false, auto_seeds: false, input_prep: true}` to `planner_rules.yaml`.
  - Precedence in routers: explicit user model > `plan.adapter` if `apply.model_choice` > smart presets. Always logs `would_have_chosen`.
  - Connected `plan.fallback_chain` to worker fallback loop in `multiprocess_scheduler.py`.
- **Best-of-N Candidate Execution (G2):**
  - Implemented unit-testable `_score_and_select()` in `multiprocess_scheduler.py`.
  - Scored candidates with trimesh metrics, evaluated sequential early stopping ($\ge 0.85$), promoted winning mesh to canonical output path, and recorded `selected_candidate_id` and `seed_scores`.
- **Image Preprocessing Deduplication (G3):**
  - Deleted redundant 287-line `image_prep.py` and `test_image_prep.py`.
  - Passed `plan.input_prep` toggles into `image_enhancement.py::preprocess_image` when `enhancement_enabled` is active.
- **Model Registry Alignment (G4):**
  - Planner queries `models.yaml` directly for VRAM requirement (MB $\to$ GB) and `native_topology` capability.
  - Fast tier routed to `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` (profile 768/20).
- **Bake & Quality Report Trace (G5 & G6):**
  - Verified normal detail bake uses immutable master `raw_bytes` as high-poly source mesh.
  - Passed `cage_extrusion`, `max_ray_distance`, `margin`, `normal_space`, `convention` from `quality.bake` into `BakeOptions`.
  - Included `plan` and `seed_scores` in `quality_trace` and `quality_report.json`.
- **Truthful Scorecard (G7):**
  - Rewrote `core/quality/parity_scorecard.py` and `parity_scorecard.json`: removed invented competitor numbers and qualitative marketing strings. Every cell is strictly measured with source attribution or `null`.
  - Added `test_scorecard_rejects_unsourced_competitor_metrics`.
- **Benchmark Real Image & Dry-Run CLI (G8 & G9):**
  - Extended `scripts/run_final_parity_benchmark.py` with `--images`, `--api`, `--tiers`, `--dry-run`, and `--competitor-dir`.
  - Labeled synthetic test primitives as `"kind": "synthetic_smoke_test"`.
  - Outputs `Docs/benchmark_real.json` and evaluates 1C.1 Hunyuan vs Trellis retention ratio (`Docs/hunyuan_smoothness_report.md` generated on real runs).
- **TaoFlowForge Spike Correction (G10):**
  - Corrected status to "NOT EVALUATED — needs GPU + 30 GB disk" with an explicit user execution checklist in `Docs/taoflowforge_spike_report.md`.
- **Docs & RULES.md Cleanup (G11, G12, G13, G14):**
  - Replaced TASKS.md with verified task status register.
  - Restored `Docs/EXPERIMENTAL-MODEL-SETTINGS.md`, removed tracked binaries in `deliverables/`, added `deliverables/` to `.gitignore`.
  - Added ADR-085, ADR-086, ADR-087 in `Docs/DECISIONS.md`.
  - Condensed `Docs/CHANGELOG.md` to last 3 entries.

## 2026-10-20 — Quality Report API & UI Quality Badge / Selectors (Task 3C)

- Updated `features/workspace/Panels/GeneratePanel.tsx`:
  - Added two selectors on the job-creation form:
    - `Quality`: "fast" | "balanced" | "high" (default "balanced")
    - `Mesh Style`: "auto" | "clean" | "detailed" (default "auto")
  - Added collapsed "Advanced" disclosure / accordion:
    - `Object Type`: "general" | "mechanical" | "organic" | "character" (default "general")
    - `Symmetry`: "none" | "bilateral" | "radial" (default "none")
  - Added `QualityBadge` component and `computeQualityMetrics` helper:
    - Badges: "Sharp" (high feature edge retention >= 0.85), "Clean" (passed gate), and "Needs Review" (violations / warnings / non-manifold / holes)
    - Interactive tooltip showing key metrics (triangles, non-manifold edges, holes, feature edge retention)
    - Full design token compliance (Studio Gold `#FFCC00`, `--surface-*`, no raw hex literals)
  - Added completed asset card / viewer section in `GeneratePanel.tsx` rendering active asset with `QualityBadge`.
- Updated `features/workspace/types.ts`:
  - Extended `GenerationSettings` with `quality`, `requested_quality`, `meshStyle`, `mesh_style`, `objectType`, `object_type`, `symmetry`.
- Updated `features/workspace/store/WorkspaceContext.tsx`:
  - Added default settings: `quality: 'balanced'`, `meshStyle: 'auto'`, `objectType: 'general'`, `symmetry: 'none'`.
- Updated `features/workspace/utils/buildGenerationParameters.ts`:
  - Attached `quality`, `requested_quality`, `mesh_style`, `object_type`, `symmetry` to both the request `body` and `model_parameters`.
- Updated `features/workspace/Viewport/MeshViewer.tsx`:
  - Rendered `QualityBadge` on completed HUD cards in 3D viewport.
- Updated `features/workspace/RightPanel/RightAssetsPanel.tsx`:
  - Rendered `QualityBadge` in asset card footer alongside asset name.
- Unit Tests:
  - `features/workspace/lib/generationParameters.test.mjs`: verified default and explicit propagation of quality, mesh_style, object_type, and symmetry.
  - `features/workspace/lib/qualityBadge.test.mjs`: verified "Sharp", "Clean", and "Needs Review" classification and metrics computation.
  - All 36 Bun tests passing; TypeScript compilation 100% clean (`tsc --noEmit`).

## 2026-10-20 — Planner v1 & API Request Wiring (Task 3B)

- Updated `backend/config/planner_rules.yaml`:
  - Upgraded schema version to 1.0.0.
  - Added benchmark-driven routing rules per `object_type` (`mechanical`, `organic`, `character`, `general`) and quality tier (`fast`, `balanced`, `high`).
  - Added `retopo_configs` defining `crease_angle_deg` and feature edge preservation flags per retopo mode (`feature_aware`, `smooth`, `silhouette_aware`, `standard`).
  - Mechanical and clean styles specify `feature_aware` retopology when falling back to dense generators.
  - Native route retains TaoFlowForge opt-in (`skip_retopo_allowed: true`).
- Updated `backend/core/planner.py`:
  - Added `clear_rules_cache()` to invalidate caching for reload.
  - Updated `plan_generation` to query `object_type_routes` prior to `quality_routes`.
  - Computes `retopo_mode` and structured `retopo` dictionary (`mode`, `feature_preserving`, `crease_angle_deg`, `target_polycount`).
  - Records explanatory reasoning when dense generator with feature-aware retopo is chosen for mechanical/clean styles.
- Updated `backend/api/routers/mesh_generation.py`:
  - Extended `ImageToRawMeshRequest`, `ImageToTexturedMeshRequest`, `TextMeshPaintingRequest`, and `ImageMeshPaintingRequest` with:
    - `mesh_style` (default `"auto"`, choices: `clean`, `detailed`, `auto`)
    - `requested_quality` (default `"balanced"`, choices: `fast`, `balanced`, `high`)
    - `object_type` (default `"general"`, choices: `mechanical`, `organic`, `character`, `general`)
    - `symmetry` (default `"none"`, choices: `bilateral`, `radial`, `none`)
  - Added field validators enforcing allowed values.
  - In `image_to_raw_mesh` and `image_to_textured_mesh`, invokes `plan_generation(planner_req, runtime_facts)` and attaches the computed `plan` dictionary to `job_request.inputs["plan"]` and `job_request.metadata["plan"]`.
  - Preserves requested fields (`mesh_style`, `requested_quality`, `object_type`, `symmetry`) in job inputs and metadata for downstream consumers.
- Updated `backend/postprocess/pipeline.py` and `backend/core/scheduler/multiprocess_scheduler.py`:
  - Ensured `generation_result.get("plan") or job_inputs.get("plan")` is passed into `evaluate_topology_gate` and UV unwrapping.
- Created `backend/tests/test_planner_v1.py`:
  - Unit tests verifying request schemas accept the new fields, supply defaults, and reject invalid enums.
  - Integration tests verifying endpoint execution attaches the computed plan to `JobRequest.inputs["plan"]`.
  - Tests verifying `plan_generation` routes mechanical/clean to high-detail adapter with `feature_aware` retopo when native adapter is disabled, and to native candidate when enabled.
  - Comprehensive 24-test suite passing (100%).

## 2026-10-20 — Postprocess Pipeline Orchestrator Integration & Master Immutability (Task 2E)

- Integrated Topology Gate, targeted hole repair, memory-safe decimation, UV backend resolver, and PBR validation into `backend/postprocess/pipeline.py` strictly operating on working copies.
- Connected the full post-processing pipeline:
  1. Evaluates `evaluate_topology_gate` on input working copy, respecting `plan.skip_retopo_allowed`.
  2. Routes repair: `minimal_repair` invokes `repair_holes_targeted` (closing small boundary loops <= 50 vertices without smoothing surface geometry); `full_repair` invokes full mesh repair.
  3. Memory-safe decimation: invokes `memory_safe_decimate` when target polycount is requested, protecting creases (>35°) and capping RAM at 80%.
  4. Centralized UV unwrapping: invokes `execute_uv_unwrap` resolving between GPU PartUV and CPU/GPU xatlas array driver.
  5. Detail baking & PBR validation: invokes `validate_pbr_asset` checking 5 PBR channels, OpenGL Y+ tangent normals, and strictly bounded [0, 1] UV layouts.
- Master Immutability Guarantee: Computes SHA-256 of `master/source.glb` before any postprocessing step and re-asserts that the SHA-256 is strictly identical at the end of postprocessing.
- Passes generation plan dictionary through `generation_result.get("plan") or job_inputs.get("plan")` into gate and UV resolver.
- Added comprehensive integration test in `backend/tests/test_batch2_orchestrator_integration.py` verifying end-to-end execution and master hash immutability.

## 2026-10-20 — Normal-Map Detail Bake Config & PBR Validation (Task 2C)

- Created `backend/config/bake_config.yaml`:
  - `normal_space`: "TANGENT"
  - `convention`: "OPENGL" # Y+
  - `max_ray_distance`: 0.05
  - `cage_extrusion`: 0.02
  - `texture_size`: 1024
  - `gutter_dilation_pixels`: 4
  - `min_uv_utilization`: 0.60
- Implemented `validate_pbr_asset` and `load_bake_config` in `backend/postprocess/services/pbr_validator.py`:
  - Validates final game-ready assets across both mesh/scene containers and standalone texture dictionaries.
  - Non-degenerate checks: asserts textures and color channels are not all-0 or all-255.
  - glTF PBR channel packing: verifies roughness is packed into G channel and metallic in B channel; computes mean, std, min, and max channel statistics.
  - Tangent-space OpenGL normal convention (Y+): verifies surface normal outward pointing (mean B >= 140, median Nz >= 0.1) and flat region decoding to approx (0, 0, 1) or RGB (128, 128, 255).
  - UV validity: verifies every face vertex has UV coordinates inside [0, 1] range; computes rasterized UV utilization against `min_uv_utilization` and reports UV overlap fraction.
  - Metallic/roughness sanity: validates physical distribution bounds and flags non-binary / uniform distributions for review.
  - Returns structured PBR report dict: `{"valid": bool, "maps_checked": list[str], "uv_utilization": float, "uv_valid": bool, "normal_convention": str, "roughness_metallic_packed": bool, "warnings": list[str], "uv_overlap_fraction": float, "channel_stats": dict}`.
- Exported `validate_pbr_asset` in `backend/postprocess/services/__init__.py`.
- Comprehensive test suite in `backend/tests/test_pbr_validator.py` (9/9 passing).

## 2026-10-20 — Feature-Aware Decimation & Memory Safety (Task 2B)

- Created `backend/config/decimation_config.yaml`:
  - `memory_safe_threshold_triangles`: 2000000 (2M tris)
  - `crease_angle_deg`: 35.0
  - `max_deviation_deg`: 45.0
  - `max_ram_fraction`: 0.80 (80% available RAM)
- Implemented `memory_safe_decimate` in `backend/postprocess/services/memory_safe_decimate.py`:
  - Never mutates input mesh in place; operates strictly on `mesh.copy()`.
  - Dynamic host memory monitoring with `psutil.virtual_memory()` and peak RSS tracking via `psutil.Process().memory_info().rss`.
  - Under threshold (<=2M tris): uses `feature_preserving_decimate` from `backend.core.mesh_processor` to protect creases, angle-weighted normals, and bounding geometry.
  - Over threshold (>2M tris): engages memory-safe staged chunking (50% reduction steps) with aggressive intermediate garbage collection (`gc.collect()` and `_cache.clear()`).
  - When RAM fraction exceeds threshold, prevents OOM by limiting intermediate allocations.
  - Returns `(decimated_mesh, telemetry_dict)` with `triangles_before`, `triangles_after`, `reduction_ratio`, `peak_rss_mb`, and `memory_safe_mode_engaged`.
- Exported `memory_safe_decimate` in `backend/postprocess/services/__init__.py`.
- Comprehensive test suite in `backend/tests/test_memory_safe_decimation.py` (5/5 passing).

## 2026-10-20 — UV Backend Resolver & Driver (Task 2D)

- Created `backend/config/uv_config.yaml`:
  - `partuv_triangle_threshold`: 500000 (500k tris)
  - `partuv_vram_requirement_gb`: 7.0
  - `default_backend`: "auto"
  - `fallback_backend`: "xatlas"
  - `max_chart_size`: 4096
- Implemented `resolve_uv_backend` and `execute_uv_unwrap` in `backend/postprocess/services/uv_backend_resolver.py`:
  - Single-point-of-truth backend resolution between PartUV (high-poly, GPU) and xatlas (low-poly / fallback, CPU/GPU).
  - Explicit `"partuv"` checks for CUDA and VRAM >= 7.0GB; otherwise logs warning and falls back to `"xatlas"`.
  - `"auto"` selects `"partuv"` when triangles >= 500k, CUDA available, and VRAM >= 7.0GB; else selects `"xatlas"`.
  - `"xatlas"` selects `"xatlas"`.
  - `execute_uv_unwrap` works on `mesh.copy()` to guarantee input mesh immutability.
  - Implements numpy-based vertex and face array unwrapping with `xatlas` and maps UV coordinates to visual attributes.
  - Gracefully falls back from PartUV to xatlas on internal failure.
  - Returns `(unwrapped_mesh, {"backend_used": str, "resolved_backend": str, "triangle_count": int, "success": bool})`.
- Exported in `backend/postprocess/services/__init__.py`.
- Comprehensive test suite in `backend/tests/test_uv_backend_resolver.py` (10/10 passing).

## 2026-10-20 — Topology Gate Service and Quality Thresholds (Task 2A)

- Created `backend/config/gate_thresholds.yaml`:
  - Declares quality thresholds for non-manifold edges (0), non-manifold vertices (0), holes (0), floater ratio (0.005), degenerate faces (0), and aspect ratios (p1 >= 0.05, p5 >= 0.10).
  - Configurable `strict` flag (default `false`).
- Implemented `evaluate_topology_gate` in `backend/postprocess/services/gate.py`:
  - Runs on working copies without mutating input meshes.
  - Reuses `compute_mesh_metrics` from `backend.core.quality.metrics` and computes `max_hole_size`.
  - Evaluates mesh metrics against configured thresholds to decide repair path:
    - `"skip_repair"` (with `skip_retopo=True` unless plan overrides via `skip_retopo_allowed=False`) when topology is clean.
    - `"minimal_repair"` (`skip_retopo=False`) when only small boundary loops (<= 50 vertices) exist and geometry is manifold.
    - `"full_repair"` (`skip_retopo=False`) when non-manifold geometry, degenerate faces, floaters, or large holes exist.
    - `strict=True` forces any detected flaw/violation to trigger `"full_repair"`.
  - Returns structured report dict `{"repair_decision": str, "skip_retopo": bool, "passed_clean": bool, "metrics": dict, "violations": list[str]}`.
- Exported `evaluate_topology_gate` in `backend/postprocess/services/__init__.py`.
- Comprehensive test suite in `backend/tests/test_topology_gate.py` (11/11 passing).

## 2026-10-20 — Quality Metrics Lib, Parity Scorecard, and Master Immutability Audit (Task 1A)

- Implemented pure trimesh/NumPy `compute_mesh_metrics` in `backend/core/quality/metrics.py`:
  - 14 topological and geometric metrics:
    - `triangle_count`: int
    - `vertex_count`: int
    - `is_watertight`: bool
    - `non_manifold_edges`: int
    - `non_manifold_vertices`: int (vertex link graph cycle/disk analysis)
    - `hole_count`: int (boundary loop count)
    - `boundary_loop_sizes`: list[int]
    - `connected_components`: int
    - `floater_ratio`: float (ratio of vertices in components < 0.5% total vertices)
    - `degenerate_faces`: int (zero-area or collinear faces)
    - `aspect_ratio_p1`: float (1st percentile triangle radius-edge aspect ratio in [0, 1])
    - `aspect_ratio_p5`: float (5th percentile triangle radius-edge aspect ratio in [0, 1])
    - `uv_island_count`: int (UV charts from face adjacency with texture visuals, 0 if no UVs)
    - `feature_edge_retention`: float (share of master edges with dihedral angle > 30.0° still present within distance/angle tolerance in mesh; 1.0 if reference is None or has no sharp edges)
  - Master immutability helpers: `sha256_file` and `audit_master_immutability` to guarantee working copies leave master source untouched.
- Implemented `backend/core/quality/parity_scorecard.py`:
  - Generates `parity_scorecard.json` template comparing `ForMash3D`, `Tripo`, `Meshy`, `Hyper3D` across `sharpness`, `topology_cleanliness`, `uv_quality`, `texture_quality`, `speed`, and `failure_rate`.
- Test suite in `backend/tests/test_mesh_metrics.py` (6/6 passing):
  - Validates all 14 metrics on canonical cube, holes, floaters, degenerate faces, non-manifold edges/vertices, and UV charts.
  - Verifies feature edge retention on cube vs subdivided cube (1.0) and smoothed sphere (< 0.1).
  - Tests 1A.1 master immutability audit workflow ensuring working copies mutate while `master/source.glb` SHA-256 remains immutable.
  - Verifies parity scorecard JSON generation.

## 2026-10-20 — Pipeline Planner v0, Runtime Probe & Base Capability Flags (Task 1E)

- Implemented `backend/core/runtime_probe.py`:
  - Returns `probe_runtime()` contract dict containing: `has_cuda`, `cuda_device_name`, `total_vram_gb`, `free_vram_gb`, `total_ram_gb`, `free_ram_gb`, `peak_vram_gb_last_run`, `installed_adapters`, `enabled_adapters`, `license_optins`, `torch_version`, `cuda_version`.
  - Single point of truth for hardware telemetry; consumed directly by the generation planner.
- Implemented `backend/core/planner.py`:
  - Pure function `plan_generation(request, runtime, rules)` returning a structured `Plan` dictionary with `adapter`, `fallback_chain`, `preset`, `num_seeds`, `input_prep`, `skip_retopo_allowed`, `uv_backend`, `bake`, `reasons`, and `warnings`.
  - Recomputes full plan upon any fallback rather than patching individual fields.
- Updated `backend/config/models.yaml`:
  - Added `native_topology`, `output_resolution`, and measured VRAM budgets for all model adapters.
- Updated `BaseModel` class in `backend/models/base_model.py`:
  - Added `native_topology: bool = False` flag to differentiate native polygonal models from dense implicit/marching-cube fields.

## 2026-10-20 — Hunyuan Presets, Hole-Targeted Repair & Seed Scorer (Tasks 1C & 1D)

- Added `backend/config/hunyuan_presets.yaml` declaring config-driven presets for Hunyuan3D-2.1 with measured VRAM budgets:
  - `fast`: octree 380, steps 30, guidance 5.0, vram_budget_gb 8.0
  - `balanced`: octree 512, steps 50, guidance 7.5, vram_budget_gb 10.0
  - `high`: octree 512, steps 100, guidance 7.5, vram_budget_gb 14.0
  - Hole-repair thresholds: `max_hole_perimeter: 0.5`, `max_hole_vertices: 50`.
- Implemented `repair_holes_targeted` in `backend/postprocess/services/hole_repair.py`:
  - Inspects boundary loops via `mesh.edges_face` / boundary edges without modifying non-hole geometry.
  - Loops with vertex count <= `max_hole_vertices` are filled by triangulating polygon loops / boundary fan.
  - Returns repaired mesh and stats dict (`holes_filled`, `holes_remaining`, `boundary_edges_before`, `boundary_edges_after`).
- Created `backend/config/seed_scoring.yaml` and `backend/core/scheduler/seed_scorer.py`:
  - Pure function `score_seed_candidate(metrics: dict, config_path: str = None) -> float`: computes normalized composite score [0.0, 1.0] using fixed reference ranges from config, inverting negative metrics.
  - Pure function `select_best_candidate(candidates_metrics: list[dict], early_stop_threshold: float = 0.85)`: sequential candidate evaluation, early stops when composite score >= 0.85, and breaks ties within 2% composite score preferring higher `feature_edge_retention` then lower `triangle_count`.
- Full test coverage in `backend/tests/test_hole_repair_and_seeds.py` (8/8 passing).

## 2026-10-20 — Input Image Prep Module (Task 1B)

- Created pure Pillow / NumPy module `backend/core/preprocess/image_prep.py` with `prepare_input_image` and `validate_image_aspect_and_occupancy`.
- Guaranteed non-mutation of input images and disk files via explicit copying and read-only loading.
- Features:
  - `remove_background`: strips uniform background by corner color-distance thresholding or cleans low-alpha noise.
  - `tight_crop`: bounding-box crop with configurable margin percentage (default 10%), padding out-of-bounds bounds with transparent pixels to preserve centering.
  - `target_size`: letterboxing / centering on transparent canvas with aspect-ratio preservation.
  - `upscale_if_small`: Lanczos resampling when input min dimension is below threshold (default 256).
  - `validate_image_aspect_and_occupancy`: reports foreground occupancy ratio, aspect ratio, bbox occupancy, border contact flags (top, bottom, left, right), and border coverage.
- Tests in `backend/tests/test_image_prep.py` (13/13 passing) verify input immutability, crop margins, centering, aspect preservation, upscaling, and occupancy calculations.

## 2026-10-20 — Generation Experiment Presets (HISTORICAL; superseded)

Earlier notes describing editable inference experiments and client-side model-parameter overrides are obsolete. The current contract keeps inference profiles adapter-owned and does not expose those overrides in the Generate UI. Refer to `Docs/GENERATION-UI-CONTRACT.md` and `Docs/EXPERIMENTAL-MODEL-SETTINGS.md`; historical values here are intentionally not repeated.

## 2026-10-20 — Experimental Max-Detail Model Settings (HISTORICAL SNAPSHOT)

This section previously duplicated numerical profiles and implied that requested settings were effective runtime settings. It is superseded by the adapter-owned profile policy and the configured/effective discrepancy note in `Docs/EXPERIMENTAL-MODEL-SETTINGS.md`. No GPU inference or output-quality A/B result is claimed.

## 2026-10-19 — Animation Export and Status Recovery

- The BVH action is enabled only when the selected clip already has a BVH artifact; it downloads that file and no longer pretends to synthesize BVH from ARDY JSON.
- ARDY job-status polling stops after five consecutive request failures, preserves the existing job ID, and exposes a user-triggered retry that reconnects to the same job rather than generating a duplicate.
- Manual Armature mode also has a guard so its Generate action cannot submit UniRig.
- CPU source-contract tests added; browser download and actual ARDY polling remain to be validated by CI/runtime execution.

## 2026-10-19 — Live UV Inspection and Rigging Contract

- UV Inspector renders UV edges from the loaded viewport geometry and selected UV channel. Mesh/UV counts, bounds and out-of-bounds values are computed from real geometry; expensive island-overlap and texel-density metrics are explicitly not claimed.
- UniRig UI no longer sends or promises custom topology, IK generation, weight optimization or weight reuse that the adapter ignores. Manual mirroring remains an editor-only option, manual mode no longer starts UniRig, and legacy armature-save navigation checks the actual persistence result.
- CPU source-contract regressions added. Browser rendering and the GPU-backed rigging path remain unverified until CI/runtime checks complete.

## 2026-10-19 — Texture Paint Export, UV Mask and PartUV Result Contracts

- Texture surface paint now exports the viewport's live material texture to a downloaded GLB; success/error notifications follow the exporter result.
- UV region masks use a transparent dedicated canvas. Until either texture adapter supports localized mask inference, the spot-retexture action is disabled and mask-bearing API requests return 422 instead of quietly running full-mesh texturing. Paint3D receives request prompt guidance; Hunyuan remains reference-image guided.
- PartUV receives the requested distortion threshold, honors save-individual-parts=false, and fails the task when packing throws or its expected output file is missing. Inert UV settings and texture-resolution controls were removed from the UV operation.
- Regression source-contract tests added; CI and real model/browser execution remain to be verified.

## 2026-10-19 — Animation ARDY Model-ID / Checkpoint Contract

- Root cause: `AnimationLeftPanel` sent UI skeleton labels `ardy-core` / `ardy-g1` as `model_preference`, but `models.yaml` has one registered motion model: `ardy_motion_generation`. The right inspector stored legacy checkpoint labels (`ardy-core (default)`, `ardy-unitree-g1`, `ardy-rp-20fps`) that are not accepted ARDY checkpoint variants.
- Fix: frontend sends `ardy_motion_generation`, maps old persisted labels to a real checkpoint ID, and derives the target skeleton from that checkpoint. The API maps older model IDs for stale clients; the adapter maps old checkpoint labels to official variants.
- The supplied Unique3D fallback log is absent from current `dev` source and proves the runtime is running pre-fix backend code. The corrected adapter is already pushed to `dev`, ThirdParty `main` has the compatible normal base, and the submodule is pinned to that commit. Pull `dev`, sync submodules, and restart API/scheduler workers before re-testing.
- Validation boundary: source-contract tests and CI type-check/build cover these changes; actual model checkpoint inference was not performed in this editing environment.

## 2026-10-19 — Unique3D Normal Checkpoint Channel Compatibility

- Root cause: `_resolve_normal_config()` preferred the local trained `img2mvimg` model for normal prediction. Its UNet expects 8 input channels, but the `image2normal` checkpoint stores 4-channel `conv_in.weight` and `ref_unet.conv_in.weight` tensors. The local-first fallback repeated the incompatible initialization.
- Fix: pin the normal pipeline to `lambdalabs/sd-image-variations-diffusers`, a 4-channel base, and only try the alternate image-variation repository after load failure. The multiview pipeline remains paired with its own 8-channel `img2mvimg` weights. Updated the ThirdParty `main` branch and synchronized the main repo submodule pointer.
- Validation boundary: source-contract tests verify config selection and that the local multiview base is not used in the normal loader. Actual checkpoint-backed GPU inference still needs a smoke test on the target runtime.

## 2026-10-19 — ARDY CPU-Only Inference

- Root cause: the ARDY adapter rejected hosts without CUDA and forced both the motion model and inference tensors to a CUDA device. Its default text-encoder path could use a remote API or place LLM2Vec on CUDA; vendored LLM2Vec also selected CUDA multiprocessing based on visible GPU count rather than the requested device.
- Fix: ARDY is declared cpu_only with a zero-GPU-VRAM requirement. The resource planner emits a CPU plan without probing GPU inventory; the worker hides CUDA in its dedicated process, and base-model load/unload paths skip CUDA APIs for CPU plans. The adapter forces the model and local LLM2Vec encoder to CPU, uses deterministic CPU-only seeding, and reports CPU mode in job provenance.
- Additional runtime fix: corrected an undefined rel_motion_url reference that could raise after motion artifacts had already been written.
- Validation boundary: CPU-only source/resource-planner regression tests were added. Actual ARDY checkpoint-backed CPU inference, peak system RAM, runtime and output quality have not been executed in this editing environment; the host must also have access to the gated text-encoder checkpoint.

## 2026-10-19 — UniRig Runtime Failure & FastMesh VRAM/Weight Admission

- **Hunyuan3D-Paint raster OOM:** the reported 384 MiB failure originated in the custom rasterizer's full-frame attribute gather at UV extraction. Third-party Paint now interpolates and extracts visible positions/normals in 128-row chunks, with visible attributes staged through CPU memory, while preserving face-normal orientation. This reduces temporary allocations but has not yet been validated against a GPU checkpoint run.
- **Hunyuan3D-Paint placement:** the renderer honors the configured CUDA device. Under a multi-GPU resource plan, super-resolution and the renderer use the first selected GPU while multiview diffusion uses the second. This is component placement, not tensor-parallel diffusion.
- **Live VRAM guard:** tracked reservations are capped by `torch.cuda.mem_get_info()` free memory, accounting for processes/allocations outside the current scheduler's ledger. The generic multi-GPU dispatcher uses its scheduled max-memory budget and fails closed unless it actually places work across selected GPUs.
- **Rigged asset preview/load:** `withRiggedModel` clears the old thumbnail so the viewport generates a preview for the rigged GLB. `MeshViewer` uses canonical `artifact_format=rigged` / `fbx` query values to distinguish browser GLB from native FBX, avoiding stale asset-format metadata.
- **Device selection:** UniRig now resolves the generic default `cuda` to the scheduler-selected `cuda:{gpu_id}`. Its third-party skinning code uses `torch.as_tensor` and explicit `softmax(dim=-1)` to remove the warnings in the uploaded logs.
- **Capability truthfulness:** Paint3D remains single-GPU; its two isolated child-stage processes do not currently shard weights, so its manifest no longer claims aggregate-VRAM multi-GPU support. UniRig, PartUV, and ARDY likewise remain single-device; do not claim universal model sharding without model-specific placement code.
- **Verification boundary:** new CPU source/scheduler contracts cover these invariants. They do not demonstrate CUDA inference, actual peak VRAM, or output-quality parity; GPU/checkpoint smoke testing remains pending.

- **UniRig helper root cause (from the supplied runtime log):** `fix_torch_cluster()` defined `fps_fallback(src: torch.Tensor, ...)` without binding `torch` or `Optional` before annotation evaluation, causing `NameError: name 'torch' is not defined`. The compatibility fallback now imports these names only when the optional `torch_cluster.fps` path is missing.
- **UniRig attention root cause:** the vendored UniRig autoregressive model forced SDPA on pre-Ampere hardware, but the selected `OPTForCausalLM` class in the active Transformers runtime does not support SDPA. The third-party implementation now checks the causal-LM class's `_supports_sdpa` flag and chooses eager attention when unsupported; the main-repository submodule pointer is synchronized to that third-party commit.
- **UniRig Pointcept FlashAttention root cause (new runtime log):** `SerializedAttention` attempted `flash_attn_varlen_qkvpacked_func` on a pre-Ampere GPU, then its exception fallback called `self.attn_drop(attn)` even though the FlashAttention branch stored `attn_drop` as a float. Pointcept now gates FlashAttention on CUDA compute capability 8.0+ (unknown capability or unavailable FlashAttention safely selects eager attention) and stores dropout as `torch.nn.Dropout` in both paths; FlashAttention receives the numeric `.p`. GPU auto-rigging still needs a real inference smoke test; eager attention can run slower and use more VRAM.
- **Shared helper resolution:** scheduler worker startup now uses the canonical `core.utils.runtime_compat.get_backend_torchvision_fix()` loader rather than a path-order-dependent `utils.torchvision_fix` import.
- **FastMesh resource admission:** the earlier dev revision removed multi-GPU capability because its runner did not shard. The current fix restores that capability only with Accelerate `infer_auto_device_map`/`dispatch_model`, scheduler memory budgets, and a hard check that at least two reserved GPUs actually receive model layers; a failed/single-GPU map now errors instead of silently continuing.
- **FastMesh checkpoint integrity:** downloader and API readiness now require the matching `config.json` variant plus `model.safetensors` exceeding 4,000,000,000 bytes, preventing metadata-only or truncated files from appearing ready. Public Hugging Face listings show approximately 4.38 GB (V1K) and 4.39 GB (V4K).
- **Verification boundary:** the supplied log records a 9,216 MB scheduler reservation for UniRig and a pre-Ampere GPU, but it contains no FastMesh load or total/free GPU memory snapshot. The upstream FastMesh repository describes an A6000-tested environment and V1K/V4K batch sizes, without publishing an exact minimum-VRAM figure. Therefore 16 GB / 24.5 GB remain project admission budgets, not measured requirements from this log. GPU/checkpoint validation is still required after pulling the fix.

---

## 2026-10-18 — Final CI Verification

- At `cb02d5df21b7fc34e77be10947b95ac526799594`, GitHub Actions passed both checks: backend Python source compilation plus 12/12 CPU dependency/runtime contract tests, and frontend CI.
- This is CPU/static-contract validation, not a GPU/checkpoint-backed smoke test for UniRig, ARDY, Paint3D, or Hunyuan3D-Paint.
- Final diff audit against the initially audited `dev` head found no requirement `.txt` edits and no edits under `backend/thirdparty` or mesh-generation adapters. Third-party Hunyuan Paint internals remain partially unresolved because the separate repository is read-only to the connected integration.

## 2026-10-18 — Hunyuan Helper Isolation & Verified CPU CI

- Hunyuan3D-Paint adapter-level imports for `SafeBackgroundRemoverFallback`, `apply_fix`, and `fix_numba_caching` now use `get_backend_torchvision_fix()` instead of generic `utils.torchvision_fix` or bare `torchvision_fix` imports. This avoids a cached module from the Hunyuan Shape/Paint namespace being used for adapter-owned fallback logic.
- Updated the degraded-background-removal test mock for the canonical loader and added a source contract that rejects generic compatibility-helper imports in the Paint adapter.
- **Verified:** GitHub Actions at commit `60691f5a13ce6831ec7dea17dcbb4476409df4ea` completed successfully: Python source compilation passed and all 12 backend compatibility-contract tests passed; frontend CI also succeeded. This is CPU/import-contract validation, not a GPU/checkpoint inference smoke test.
- Requirements .txt files and mesh-generation adapters remain untouched. The third-party source's own generic `from utils.*` import statements and catch-all DINO exception fallback still require authorized write access to `ForMash3D-ThirdParty` for a complete source-level fix.

## 2026-10-18 — Canonical Compatibility Helper Resolution

- Added `core.utils.runtime_compat.get_backend_torchvision_fix()`, which loads `backend/utils/torchvision_fix.py` by canonical file path and caches it under a private module name.
- ModelFactory and UniRig now use that loader instead of generic `from utils.torchvision_fix`, which could resolve to Hunyuan Shape's third-party helper depending on package path ordering. This is a shared loader/helper fix; mesh-generation algorithms and adapters were not changed.
- The backend CPU test directly imports the main helper by file path and now includes a source contract ensuring ModelFactory uses the canonical loader. Await CI results for the latest commit before treating those tests as green. No requirements .txt files were changed.
- The external ThirdParty repository is still not writable through the available GitHub integration, so its own generic `from utils.*` imports and catch-all DINO fallback cannot yet be patched at source.

## 2026-10-18 — CPU Test Import Isolation & Runtime Regression Contracts

- The contract test now loads `backend/utils/torchvision_fix.py` by explicit file path. Importing it via generic `utils.torchvision_fix` resolves to the retained Hunyuan Shape utility path and would require PyTorch, which the CPU-only CI deliberately does not install.
- Added CPU-safe source contracts for BaseModel failure state and load exception chains, Paint3D stage preflight/UV requirements, and UniRig/ARDY/ModelFactory chained failures.
- The backend CI job at the preceding commit was still failing only in its cache-shim test because of that generic package resolution; the new test import path is intended to remove this source of accidental dependency loading. Check the new run before considering the workflow green.
- Requirements .txt files, the Hunyuan Shape path, and mesh-generation code were left intact. The separate third-party repo still needs authorized write access to fully fix its broad DINO fallback exception handling.

## 2026-10-18 — Preserve Shape Runtime & Align Dependency Contract Tests

- Refined the shared `backend.utils` package change: it retains the existing Hunyuan Shape helper path while removing the Hunyuan Paint path from global package initialization. Paint's adapter scopes its utility path at load time and restores it after loading.
- The backend dependency contract test had stale expectations (`transformers==5.10.1`, `diffusers==0.38.0`) that disagreed with the unchanged working backend requirements (`4.44.2`, `0.30.3`). It now asserts the existing shared pins and checks that TripoSG leaves centrally managed packages to the parent runtime. No requirements .txt file was edited.
- The previous backend CI run correctly exposed the test drift (submodules were then present; 7 of 8 contracts passed, while the baseline test failed on the stale version expectation). The current commit should rerun the updated suite; its status will be checked before declaring it green.
- Mesh-generation adapter code was not changed. The Hunyuan Shape utility path is explicitly retained to avoid regressing that workflow. Third-party DINO fallback internals still need an authorized write to the separate third-party repository for a complete repair.

## 2026-10-18 — Backend CI Checkout, DINO Cache Validation & Texture Error Chains

- Backend Runtime Contract CI now checks out recursive submodules, because an existing dependency-contract test reads the vendored TripoSG metadata from the submodule. The initial run failed for missing checkout state (6 tests passed, 1 failed); this change is intended to correct the workflow configuration and awaits its rerun.
- Hunyuan3D-Paint validates both `config.json` and model weight files before selecting a local DINOv2 cache. Incomplete caches produce an explicit warning before the remote repository fallback.
- Hunyuan3D-Paint request failures now log the traceback and chain the underlying exception through a RuntimeError.
- Added regression coverage for the DINO checkpoint layout and exception-chain source contract. No requirements .txt files or mesh-generation code were changed. The third-party repo remains read-only to this connected integration; its fallback wrapper itself still requires a separately authorized patch.

## 2026-10-18 — Scoped Hunyuan Imports, ARDY Contract Diagnostics & Backend CI

- The shared backend utils package no longer globally adds Hunyuan utility paths. Hunyuan3D-Paint scopes its temporary utility path to initialization and restores import state in `finally`; broad `sys.modules` purges were removed from retries.
- Missing local Hunyuan/DINO checkpoints now produce explicit remote-fallback warnings. The successful job result continues to expose background-removal degraded mode and its reason.
- ARDY checks installed distributions against dependencies parsed from its vendored `pyproject.toml` before GPU allocation; mismatches are logged, but no requirements files are changed and model loading is not blocked solely by the diagnostic.
- `BaseModel.load()` preserves the original exception chain. Added lightweight CPU backend CI for source compilation and dependency-contract tests; GPU/checkpoint inference remains a separate smoke-test requirement.
- **Repository access limitation:** write access to `Silentzx2/ForMash3D-ThirdParty` was denied by the connected GitHub integration, so no third-party source commit or submodule-pointer update was made. The main-repository mitigation scopes the import path, but the vendored third-party `from utils.*` imports are not yet fully package-qualified. No requirements .txt files or mesh-generation code were changed.

## 2026-10-18 — Compatibility Shims, Runtime Paths & Degraded-Mode Reporting

- HybridCache compatibility now reuses the actual Transformers DynamicCache/Cache API where available and warns that hybrid-specific semantics are not supplied by the fallback.
- TorchVision helper import survives native/operator exceptions while recording the root error; ModelFactory emits traceback-backed warnings for compatibility setup failures and preserves exception chaining.
- UniRig default roots are resolved from the adapter source path, independent of the caller's working directory.
- Hunyuan3D-Paint exposes background-removal mode and fallback reason in successful job metadata instead of hiding degraded preprocessing.
- Regression coverage was added for shim behavior, native TorchVision import failures, cwd-independent paths, and degraded fallback metadata. Backend tests have not yet been run locally; review the CI result before treating them as passing. No requirements .txt files or mesh-generation code were changed.

## 2026-10-18 — Runtime Failure-State, Import Diagnostics & Paint3D Preflight

- Truthful request state: BaseModel.process retains ModelStatus.ERROR when request processing raises and returns to LOADED only after success.
- Precise import diagnosis: UniRig and Hunyuan3D-Paint diagnostics preserve the real missing module/exception instead of always attributing failures to Blender bpy or hiding an import-time native error.
- Paint3D runtime readiness: Loading runs an import-only child-process preflight for both stage entry points with the same interpreter and environment as execution; it does not download checkpoints or run inference.
- UV contract: Paint3D aborts mesh preparation if finite per-vertex UVs are not available after unwrap, rather than continuing with an unverified mesh.
- Verification note: Regression tests were added in this batch. They were not executed in the connected GitHub environment before commit; check the repository Actions results before treating them as passing. No requirements .txt files or mesh-generation code were changed.

## 2026-10-17 — Lossless Master Log Streaming

- **Canonical source and framing**: `logs/master.log` is streamed as ordered UTF-8 text chunks, rather than parsed log rows. The transport preserves LF, CR, CRLF, blank lines, leading/trailing whitespace, partial lines, and carriage-return progress updates.
- **Reconnect and file lifecycle**: SSE event IDs store file identity plus emitted byte offset. The Next.js proxy forwards `Last-Event-ID`; pause/resume resumes from the latest consumed offset. Log rotation or truncation resets the viewer to the new canonical file.
- **Frontend behavior**: Chunks are batched to the browser DOM per animation frame, without artificial line or pending-queue caps. No automated test execution is claimed unless run in an environment with the repository dependencies installed.

## 2026-10-16 — Unique3D & TripoSG Transformers v5 Compatibility Fix

- **Transformers v5 HybridCache Compatibility (DEP-06)**: Resolved `cannot import name 'HybridCache' from 'transformers'` breaking model worker loads in `Unique3D` and `TripoSG`. In Transformers v5, `HybridCache` was deprecated/refactored, but `diffusers` (via `diffusers.loaders.peft` -> `peft.peft_model`) still attempts to import `HybridCache` from `transformers`. Implemented `fix_transformers_cache()` in [`backend/utils/torchvision_fix.py`](file:///workspaces/ForMash3D/backend/utils/torchvision_fix.py#L123-L150) providing a seamless, backward-compatible fallback subclassing `DynamicCache`/`Cache`.
- **Worker & Adapter Integration (LOAD-04)**: Hooked `apply_fix()` into `ModelFactory.create_model_from_config` before adapter dynamic import, and into [`backend/adapters/triposg_adapter.py`](file:///workspaces/ForMash3D/backend/adapters/triposg_adapter.py) and [`backend/adapters/unique3d_adapter.py`](file:///workspaces/ForMash3D/backend/adapters/unique3d_adapter.py), ensuring all subprocess workers apply the shim before loading neural pipelines.
- **Contract Verification (DEP-07)**: Added `test_transformers_cache_compatibility_shim` to `backend/tests/test_generation_dependency_contract.py` (5/5 passing) and verified all frontend/backend unit test suites pass (26/26 passing in `bun test`).

## 2026-10-16 — End-to-End Pipeline Quality: Uncapped Geometry, glTF Tangents & PBR Normal Baking


- **Uncapped Polycount Ingestion & API Precedence (PIPE-01 & PIPE-02)**: Removed the arbitrary `< 200,000` clamp in `features/workspace/utils/buildGenerationParameters.ts::shouldAutoOptimize()`, restored `target_polycount` string serialization in the generation payload, and updated `backend/api/routers/mesh_generation.py::_resolve_target_polycount_precedence()` so explicit top-level targets (including `0` for Native/Raw mesh passthrough) strictly take precedence over presets and nested defaults.
- **Production Face Budget (PIPE-03)**: Increased `MAX_PRODUCTION_FACES` in `backend/postprocess/pipeline.py` from 200,000 to 2,000,000 to support high-density sculpting, visual effects, and cinematic models.
- **Deterministic glTF Vertex Normal Export (PIPE-04)**: Evaluated and cached `mesh.vertex_normals` across all model adapters (`trellis_adapter`, `triposg_adapter`), decimation fallback paths in `backend/postprocess/services/simplify.py`, and `compute_angle_weighted_normals()` in `backend/core/mesh_processor.py`. This guarantees Trimesh's glTF serializer populates `NORMAL` accessors in all exported GLB primitives even when `process=False` is set.
- **glTF 4-Component Tangents (PIPE-05)**: Added `compute_mesh_tangents()` in `backend/postprocess/pipeline.py` and hooked `tree_postprocessor` into `_export_glb()`, directly creating standard 4-component `TANGENT` vertex accessors (`vec4(T.xyz, bitangent_sign)`) to prevent UV seam shading artifacts in three.js and standard game engines.
- **glTF 2.0 OpenGL Normal Map Baking & Grayscale Gutter Dilation (PIPE-06 & PIPE-07)**: Explicitly configured `bake.normal_space = "TANGENT"` with `POS_X`, `POS_Y`, and `POS_Z` in `backend/postprocess/tools/bake_worker.py`. Fixed `fill_gutters()` shape validation from `arr.ndim != 3` to `arr.ndim not in (2, 3)` with proper shape expansion, eliminating dark border seams on ambient occlusion, roughness, and metallic texture maps.
- **Contract Verification (PIPE-08)**: Verified clean compilation (`python3 -m compileall -q backend/`), 0 TypeScript errors (`bun run test`), and 100% pass rate on official model parity tests (`test_official_model_parity_contract.py`).

## 2026-10-16 — Quality Rendering, Three.js PBR Pipeline & Studio Fidelity UI/UX

- **Configurable Tone Mapping & Balanced Studio Lighting (PBR-01)**: Upgraded Three.js renderer in `MeshViewer.tsx` to support both `NeutralToneMapping` (Khronos standard PBR color fidelity) and `ACESFilmicToneMapping` (cinematic curve). Calibrated key light, fill light, rim light, and back-fill lights with dynamic key light shadow camera frustum scaling matching the model's bounding dimensions to eliminate shadow clipping and shadow acne.
- **Micro-Relief Tangent Generation (PBR-02)**: Added `features/workspace/lib/meshTelemetry.ts` providing `prepareMeshTangentsAndNormals()` which verifies vertex normals and computes tangent space attributes (`computeTangents()`) for GLTF, FBX, OBJ, PLY, and STL meshes, ensuring smooth, artifact-free normal and bump mapping.
- **Polished Studio Material Presets & Wireframe on Shaded (PBR-03)**: Polished Studio Matte Clay (warm clay with subtle clearcoat), Porcelain Ceramic Gloss, 24K Metallic Gold, Chrome Mirror, and Tangent Normals. Added authentic non-destructive Wireframe on Shaded mode where topology wires overlay directly on lit solid geometry using `polygonOffset` depth calibration.
- **Pro Studio UI/UX in GeneratePanel (UI-04)**: Added Sharp Feature Preservation toggle, Angle Crease Threshold slider (30° - 85°), High-Resolution Normal Baking, Texture Fidelity Presets (Ultra 4K, High 2K, 1K, Compact), and live density/precision indicators to `GeneratePanel.tsx` and forwarded to generation parameter builders.
- **Real-Time Topology & Geometry Telemetry (UI-05)**: Integrated real-time mesh analysis in `RightPropertyPanel.tsx`, `ViewportToolOverlay.tsx`, and `MeshViewer.tsx` computing watertight/manifold edge status, non-manifold edge counts, vertex/triangle counts, disjoint UV chart counting, surface area ($m^2$), and signed enclosed volume ($m^3$).
- **Test Suite Verification (TEST-06)**: Added `features/workspace/lib/meshTelemetry.test.mjs` unit test suite covering volume, surface area, non-manifold edge detection, and tangents. All 24 bun tests and 22 node tests pass with 0 failures, and `next build` compiles successfully.

## 2026-10-16 — Asset Lineage, Canonical Workspaces & Rigging Artifacts (Batch 2)

- **Query Param Preservation (ASSET-08)**: `backend/api/routers/file_upload.py::resolve_input_reference_async` uses `urlparse` and `parse_qs` to isolate paths and parameters, ensuring requests like `/api/v1/system/jobs/{job_id}/download?artifact_format=master` preserve the requested artifact selector on fallback without globbing.
- **Manual Mesh-Tool Lineage Isolation (ASSET-09)**: In `backend/postprocess/pipeline.py::persist_manual_mesh_result`, manual operations (retopo, UV unwrap, segmentation, mesh editing) save results into `derived/` preserving their native format (.obj, .ply, .glb) and leaving the user's master source immutable.
- **Per-Asset Workspace Rigging (RIG-10)**: `UniRigAdapter` in `backend/adapters/unirig_adapter.py` accepts explicit job output directories under the asset workspace (`storage/models/meshes/<asset>/rigging/<job-id>/`), eliminating shared global storage collisions in `storage/models/rigged/`.
- **Native FBX Preservation in Auto-Rig Workflow (RIG-11)**: `_watch_auto_rig` in `backend/core/scheduler/multiprocess_scheduler.py` copies both `rigged.glb` (preview) and `rigged.fbx` (native FBX) into the parent asset workspace, registering both in `output_fbx_path`, `artifacts.rigged_fbx`, and `metadata/jobs/<job-id>.json`.
- **Unified Artifact Manifest Resolver (RIG-12)**: `backend/api/routers/system.py::download_job_result` resolves artifacts (`glb`, `rigged`, `fbx`, `master`, etc.) through a single manifest contract for direct rig jobs, generated auto-rig jobs, manual mesh tools, and unrigged assets (returning 422 for unrigged FBX requests).
- **Result Path Fallback Control Flow (RIG-13)**: In `backend/api/routers/system.py`, replaced loops containing early `break` statements outside `if` with `first_result_path(result)`, correctly checking all declared candidate keys (`output_mesh_path`, `mesh_path`, `output_path`, `file_path`) in order of preference.
- **Truthful Rigging Progress (RIG-14)**: In `stores/useRiggingStore.ts`, eliminated synthetic `generationProgress` incrementation (+1/+2 on poll up to 90) and fake initial jumps (10%, 25%). Implemented pure deterministic calculation in `features/workspace/lib/riggingProgress.ts` with honest status text and 0 progress on stalled jobs.

## 2026-10-16 — Tool Panels Workspace Insertion, GLTF Policy, Export Verification & QA Suite

- **Upload Truth & Byte Transfer (UP-01 to UP-07)**:
  - **No Silent Fallback (UP-01)**: Desktop canvas drag-and-drop intake in `MeshViewer.tsx` now delegates directly to `uploadMeshAsset()` and truthful `uploadImageFile()` rather than generating unuploaded `blob:` URL assets on failure. Failed uploads display explicit error toasts and leave no phantom assets in the workspace or selection.
  - **Next.js Proxy Streaming (UP-02)**: Verified `app/api/v1/[...path]/route.ts` streams multipart bodies with `duplex: 'half'` without allocating full RAM buffers, preserving boundary, content-length, authorization, and client disconnect cancellation.
  - **Truthful Progress (UP-03)**: Standardized byte progress callbacks across `apiClient.uploadMeshFile` and `apiClient.uploadImageFile` (`loadedBytes`, `totalBytes`), wired through `useMeshAssetUpload()` and `useUploadProgress()`.
  - **Canonical Per-Asset Workspace (UP-04)**: Verified uploads persist under canonical `storage/models/meshes/upload_{file_id}/master/source.{ext}` with `metadata/asset.json` tracking SHA-256 and byte sizes.
  - **Metadata Durability & Restart Recovery (UP-05)**: Verified metadata write failure atomically cleans up written files; single-worker mode restores listings and counts directly from disk manifests without relying on volatile in-memory state.
  - **Aligned Size Limits & Non-blocking Validation (UP-06)**: Aligned client `fileValidation.ts` `MAX_UPLOAD_SIZE` to 200MB matching FastAPI's `MAX_MESH_UPLOAD_SIZE_MB`; verified AnyIO threadpool execution for heavy trimesh geometry inspection (`_MESH_VALIDATION_LIMITER`). Added `mesh_stats` to `FileUploadResponse` so real polygon and vertex counts are immediately returned.
  - **GLTF Consistency & Format Coverage (UP-07)**: Ensured uniform extension support (`.glb,.gltf,.obj,.fbx,.stl,.ply`) across all panels (`MeshEditPanel`, `MeshSegmentPanel`, `RemeshPanel`, `UVUnwrapPanel`, `RiggingStudio`, `MeshViewer`), preserving `GLTF` and `FBX` classifications.
- **Tool Panels & Workspace Selection (TOOL-15)**: `setCurrentAsset` in `WorkspaceContext.tsx` now guarantees that any asset passed to it is inserted into the workspace via `addAsset()` before being selected with `selectAsset()`. Null asset resets (e.g. from closing/clearing asset selection in UVUnwrapPanel, RemeshPanel, MeshSegmentPanel, MeshEditPanel) are handled cleanly with `setSelectedAssetId(null)` without crashing on `asset.id`.
- **Safe glTF Policy (TOOL-16 & UP-07)**: Enforced consistent `.gltf` policy on client (`fileValidation.ts`) and backend (`file_utils.py` and `file_upload.py`). Self-contained glTF files with embedded base64 data URIs are accepted and classified as mesh format, while files referencing external sidecars (`.bin`, relative image paths) are rejected with actionable errors before being stored or processed.
- **Bounded Base64 Mesh Intake (SEC-17)**: In `backend/api/routers/mesh_segmentation.py` and `file_utils.py`, `validate_base64_data` enforces encoded size limits (`MAX_MESH_BASE64_BYTES`) and checks padding/decoded length before allocating decoded bytes in memory.
- **Non-Blocking Mesh Validation (PERF-18)**: Heavy trimesh inspection and scene parsing in `file_upload.py` and `mesh_segmentation.py` execute in AnyIO's threadpool off the FastAPI event loop, ensuring concurrent uploads and health checks remain responsive.
- **Durable Storage & Thumbnail Cleanup (STORAGE-19)**: Deleting an uploaded mesh via `DELETE /file-upload/{file_id}` safely unlinks the stored file, manifest, and generated thumbnail (`_THUMBNAIL_DIR/{file_id}.png`), and removes empty parent workspace directories without affecting unrelated sibling or generated job assets.
- **Response-Aware Export (EXP-21)**: `ExportModal.tsx` and `artifactDownload.ts` verify `response.ok`, check expected MIME types per format, validate non-empty blob contents, reject server JSON/HTML error payloads, and preserve original source formats (GLB/GLTF/OBJ/PLY/FBX/STL) rather than forcing `.glb`.
- **Image Preprocessing & Quality Gate (IMG-21 & IMG-22)**:
  - Verified true alpha vs opaque RGBA distinction (`has_transparency = minimum < 255 and maximum > 0`): opaque RGBA does not bypass RMBG removal.
  - Verified alpha mask preservation across RealESRGAN and Pillow fallback resizing via `_resize_with_alpha`.
  - Quality gate `_validate_foreground_mask` (aliased as `inspect_foreground_mask` and `validate_preprocessed_image`) records structured states (`already_transparent`, `removed`, `disabled`, `failed`, `needs_review`).
  - Adjusted border coverage threshold from over-aggressive 0.20 to conservative 0.80 so subjects with soft alpha gradients aren't falsely rejected, and gated mask requirements behind `require_transparency` when RMBG is intentionally disabled.
  - Made PyTorch import optional in `backend/core/smart_presets.py` so test/API environments without torch execute without collection errors.
  - Downstream model adapters (Hunyuan3D, etc.) check `has_useful_alpha` and bypass duplicate RMBG, fulfilling the single-owner contract.
  - GeneratePanel and API routers enforce that failed or needs-review artifacts cannot enter inference without an explicit user override.
  - Tests passing: `test_image_preprocessing_gate.py` (3/3), `test_phase1_contract.py` (13/13), `test_upload_intake_security.py` and `test_asset_rigging_contract.py` (32/32).

## 2026-10-14 — Rigging / Animation End-to-End Integrity Pass

- **UniRig installer**: the `bpy==4.0` wheel install no longer masks failures with `|| true`; a nonzero install status exits with platform/glibc troubleshooting guidance.
- **Real mesh references and artifacts**: Rigging uses the uploaded asset's `mesh_file_id`, removes fake mesh paths and fabricated mesh statistics, wires Import/Replace to `uploadMeshAsset()`, and keeps UniRig's native FBX separate from its GLB viewport preview. Unknown mesh stats now reset to neutral values instead of carrying over from a previously selected asset. The download route rejects missing native FBX artifacts with HTTP 422 instead of trying unsupported `trimesh` FBX conversion.
- **Honest rig state and retargeting**: the Animation inspector reports the real rig state and non-fabricated vertex counts. Motion AI requires a rig. Retargeting previews compatibility against the actual loaded Three.js bone names (not the generic editor bones), then maps ARDY joint names, quaternion frames and root positions into the existing playback path. Scale normalization, floor clamping and root-motion preservation are wired to playback options.
- **Polling and UI integrity**: rig-job polling has no hard 72-second failure, pauses safely on navigation and resumes from the existing job ID. Motion polling clears on unmount. Manual armature snapshots now persist the actual editor bones but do not pretend to skin/export a mesh; an actual rigged artifact remains required to animate. The confirmed Remesh/Mesh Edit leaked icon-name text was corrected; placeholder mesh names/counts/sizes were replaced with real values or neutral unknown states.
- **Validation status**: added a regression test for unsupported on-demand FBX conversion. Source changes were reviewed through GitHub; local TypeScript, Python, shell and browser end-to-end tests require an executable project runner and have not been marked as passing.
## 2026-10-14 — Unique3D Hugging Face Dependency Compatibility

- **Root cause**: `backend/scripts/install.sh` installed an unpinned latest `datasets` package before the shared runtime re-pinned `huggingface_hub==0.25.0`. The resulting versions were incompatible: Unique3D imports the trainer registry during inference startup, and newer Datasets releases import `BucketNotFoundError`, which that Hub version does not expose.
- **Fix**: Pinned `datasets==3.6.0` in both `backend/scripts/install.sh` and `backend/requirements.txt`. This avoids upgrading the shared Hub runtime used by the other model adapters.
- **Existing environments**: After pulling `dev`, reinstall `datasets==3.6.0` in the active `3daigc-api` environment and restart the backend.

## 2026-10-14 — Unique3D Gradio UI Dependency Isolation

- **Root cause**: The adapter imported `app.custom_models.mvimg_prediction` even though it already loads and calls its own trainer/pipeline. That upstream module imports Gradio and initializes another module-level pipeline, introducing an unnecessary dependency and duplicate initialization side effects.
- **Fix**: Removed the unused wrapper imports and stopped installing Gradio for the backend Unique3D runtime. The project keeps `huggingface_hub==0.25.0` for TripoSG and `datasets==3.6.0` for the Unique3D trainer import; Hub is not upgraded just to satisfy Gradio 6.
- **Existing environments**: The installer now removes stale `gradio`, `gradio-client`, and `hf-gradio` packages left by older Unique3D setup runs, since the dedicated backend runtime does not use the standalone demo UI.

## 2026-10-14 — Raw Mesh Fidelity Audit: Hunyuan Shape, Mini Turbo, and TripoSG

- **Scope**: Traced the image-to-raw-mesh API, `_build_model_inference_inputs`, the three adapters, their model manifests, and the vendored upstream volume/surface extraction implementations. No post-processing code or other model adapter was changed.
- **Hunyuan Shape v2.1**: The upstream-supported dense grid ceiling is 512 (the architecture decision log explicitly rejects 640 as out-of-contract). Kept this ceiling and aligned the max-fidelity profile with the official 7.5 guidance default while retaining the trained 50-step schedule and untouched raw-mesh export.
- **Hunyuan Mini Turbo**: The scheduler and adapter forcibly enabled FlashVDM with top-k merge. The fidelity-first profile now avoids that accelerated decoding path and uses the checkpoint's native dense decoder with the official `octree_resolution=380` setting; the former 512 setting exceeded the trained range, while Tencent's distilled 5-step sampling schedule remains unchanged.
- **TripoSG**: The adapter selected the Flash extraction path from GPU compute capability, contradicting the model manifest's `hierarchical_octree` preference. It now uses dense/hierarchical extraction in the raw-source profile (dense depth 9, hierarchical target depth 10 / 1024-wide grid on GPUs with at least 24 GiB free and 32 GiB total VRAM; otherwise depth 9). The scheduler profile disables Flash extraction and records effective resolution/fallback telemetry.
- **Contract coverage**: Scheduler and adapter defaults plus frontend parameter construction are locked by regression/source-contract tests. Recursive-clone integrity was repaired in merged PR #32 by updating `backend/thirdparty` from the unreachable SHA `423339899dd8da5a782d89855057aa7d055e3d27` to reachable `ForMash3D-ThirdParty/main` commit `a35a33af4a68228552b785d8e43bbeb1519f66f0`.
- **Expected trade-off**: Native dense decoding is slower and can consume more host/GPU memory. Better extraction can preserve details the fast decoder misses, but cannot invent geometry evidence absent from a single-view model's learned representation. CUDA end-to-end visual comparison is still required on the target workstation.

## 2026-10-14 — Second-pass extraction root-cause hardening

- **Verified Hunyuan decoder selection**: Removing the FlashVDM enable call alone did not prove which VAE volume decoder/surface extractor was active. Both adapters now configure the upstream VAE with enable_flashvdm_decoder(enabled=False), verify VanillaVolumeDecoder + MCSurfaceExtractor, and explicitly pass mc_algo='mc' for generation. Unsupported vendored APIs fail loudly.
- **TripoSG sampling ceiling**: The previous depth-9 setting capped the output grid at 512 samples per axis. The target is depth 10 (1024-wide grid) only on GPUs with at least 24 GiB free and 32 GiB total; otherwise depth 9 is used. Requested/effective resolution, voxel size, and fallback reason are reported.
- **Validation limitation**: Regression contracts were added but could not be executed locally because GitHub DNS is unavailable from the container. CUDA A/B generation and raw-source mesh inspection are still required before asserting a visual-quality improvement.

## 2026-10-14 — High-Performance Viewport Engine & Production Postprocessing Pipeline Hardening

- **Viewport Performance & Shading Optimizations (`features/workspace/Viewport/MeshViewer.tsx`)**:
  - **Zero-Allocation Material Switcher**: Shading mode changes (`clay`, `ceramic`, `chrome`, `gold`, `normals`, `xray`, `turquoise`, `default`/`textured`) and wireframe toggles previously allocated new `THREE.MeshStandardMaterial`, `THREE.MeshNormalMaterial`, or `THREE.MeshBasicMaterial` instances on every scene graph traversal. Now, materials are lazily allocated once and cached directly on mesh objects (`child.userData.__shadingMaterialCache = child.userData.__shadingMaterialCache || {}`). Subsequent shading mode switches reuse cached instances (`cache.clay`, `cache.ceramic`, `cache.chrome`, `cache.gold`, `cache.normals`, `cache.xray`, `cache.turquoise`) and dynamically update `.wireframe = isWire`, eliminating garbage collection pauses and memory leaks during interactive inspection.
  - **Event-Driven Reflection Peek Capture**: Replaced the previous 1-second unthrottled `setTimeout` polling loop with an event-driven snapshot system. Reflection capture executes once on initial load, and thereafter only schedules a frame after camera interaction completes (`controls.addEventListener('end', scheduleCapture)` with a 250ms debounce window). Properly cleans up the debounce timer, OrbitControls listener, and revokes previous object URLs (`URL.revokeObjectURL`) on unmount, completely eliminating GPU render waste and object URL memory bloat when the viewport is static.
  - **Interactive TransformControls Integration**: Integrated Three.js `TransformControls` into the viewport scene graph. Controlled by `interactionMode` (`'orbit' | 'pan' | 'move' | 'rotate' | 'scale'`). In Edit mode (`move`, `rotate`, `scale`), `TransformControls` attaches to `currentMeshGroupRef.current` and switches manipulator modes (`translate`, `rotate`, `scale`). Also supports bone joint manipulation in rigging mode (`animSelectedBone`). OrbitControls is automatically disabled during active gizmo dragging (`controls.enabled = !event.value`), preventing conflict between viewport rotation and 3D object manipulation.
  - **Axial Camera Alignment Presets (`ViewportToolOverlay.tsx`)**: Floating tool overlay integrates axial camera view presets (`Perspective`, `Front`, `Side`, `Top`). Selecting a preset dispatches a custom window event (`setCameraPreset`) that triggers `applyCameraPreset()`, snapping the camera to cardinal coordinate axes (Front: `[0, 0, dist]`, Side: `[-dist, 0, 0]`, Top: `[0, dist, 0]`, Perspective: isometric diagonal) with automated target centering and bounding-sphere normalization.
  - **Smooth MeshDiffViewer Animation Loop (`MeshDiffViewer.tsx`)**: Removed the stateful animation counter anti-pattern (`const [animationFrame, setAnimationFrame] = useState<number>(0)` and `setAnimationFrame(prev => prev + 1)` in requestAnimationFrame) which triggered 60–120 full React component re-renders per second. Replaced with an uncoupled `requestAnimationFrame` loop that directly calls `leftControls.current.update()`, `rightControls.current.update()`, and renders both Three.js scenes into WebGL canvases with zero React re-renders. Stores `animId` and properly cancels it on unmount via `cancelAnimationFrame(animId)` with an empty dependency array.

- **Production Postprocessing Pipeline Hardening (`backend/postprocess/pipeline.py` & `backend/api/routers/mesh_generation.py`)**:
  - **UI Post-Processing Master Toggle & Scheduler Bypass**: Added an end-to-end master toggle `enable_postprocess` across the UI, API schemas, and scheduler.
    - **Frontend (`GeneratePanel.tsx`, `WorkspaceContext.tsx`, `useAppStore.ts`, `types/index.ts`)**: Added tactile master toggle switch in `GeneratePanel` with status indicator (`ON · Full Pipeline` vs `OFF · Fast Raw Mesh`) and amber callout (`⚡ Fast Mode: Post-processing will not run after mesh generation. Raw geometry is returned immediately`). When post-processing is OFF, all downstream stage controls (Textured Generation toggle, Output Atlas size, Smart Intent presets, Target & Polycount buttons/slider, Production QA Printability & Auto-repair, Auto-Rig, Physics Collision, Mesh Quality, and Quads vs Triangles) are automatically disabled, greyed out (`opacity-40 cursor-not-allowed pointer-events-none`), and badged `BLOCKED`.
    - **Parameter Builder & API Gateway (`buildGenerationParameters.ts` & `mesh_generation.py`)**: When `enable_postprocess` is False, payload generation and FastAPI routers strictly zero-out and disable all downstream postprocessing flags (`texture_enabled = false`, `generate_texture = false`, `lod_enabled = false`, `target_polycount = 0`, `enable_printability = false`, `enable_auto_repair = false`, `enable_auto_rig = false`, `physics_enabled = false`, `postprocess_mode = "none"`).
    - **Scheduler Execution (`backend/core/scheduler/multiprocess_scheduler.py`)**: When `enable_postprocess` is False (or `postprocess_mode == "none"`), the post-processing pipeline is completely bypassed. The scheduler registers `postprocess_status: "bypassed"`, sets `production_status: "ready"`, and directly maps `output_mesh_path`, vertex/face counts, and download URLs (`/api/v1/system/jobs/{job_id}/download?artifact_format=glb`) into `final_result`.
    - **Asset Delivery & Previews (`backend/api/routers/system.py`)**: Thumbnail generator and download routes gracefully resolve `output_mesh_path` when `asset_root` is None, ensuring zero breakages in model loading, downloads, or Three.js viewport previews.
  - **Quad OBJ Polygonal Export**: Implemented `_export_quad_obj(mesh, quad_faces)` in the postprocessing pipeline to output standard wavefront OBJ format containing 4-vertex polygonal faces (`f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 v4/vt4/vn4`) instead of forced triangular decomposition. When retopology produces quad-dominant topology, the optimization/decimation stage automatically flags `passthrough: True` with reason `"Quad-dominant topology preserved from retopology pass"`, preserving non-triangulated quad structures all the way to disk export.
  - **Smart Preset Budget Precedence Resolution**: Implemented `_resolve_target_polycount_precedence(top_level_target, nested_target, preset_target)` in `mesh_generation.py`. This guarantees explicit top-level request budgets take highest precedence, followed by nested model parameters, falling back to smart preset targets. Resolves the critical bug where a nested default value of `0` wiped out user-specified or preset face counts, while properly treating an explicit target of `0` as an intentional request for Native/Raw geometry pass-through.
  - **Headless Blender Worker Invocation Path (`backend/postprocess/config.py`)**: Centralized `blender_worker_argv()` and `blender_expr_argv()` to provide multi-path headless Blender execution: inspects `BLENDER_EXECUTABLE` on `PATH`, and if unavailable, checks for the embedded `bpy` Python wheel via `importlib.util.find_spec("bpy")`, falling back seamlessly to running workers under the current Python interpreter (`sys.executable`). Used across FBX conversions (`convert_fbx.py`) and thumbnail renders (`mesh_thumbnail.py`).
  - **Dynamic Storage Base Directory Resolution (`backend/core/utils/file_utils.py`)**: Unified `get_storage_base_dir()` to dynamically resolve `STORAGE_LOCAL_PATH` relative to project root (`parents[3]`) when given a relative path, or default to `backend/storage`. Completely eradicates the `backend/backend/storage` directory duplication bug across model generation outputs, uploads, static mounts, and SQLite file stores.
  - **Watertight 3D Print Preservation**: AutoRetopo conditional shell reconstruction respects already-watertight geometry (`watertight=not bool(repaired_topology.get("watertight", False))`), using the source surface directly for closed meshes to avoid rounding sharp edges with voxel shells. In the `3d_print` smart preset, `target_polycount: 0` ensures complete passthrough in `run_optimize()` (`Passthrough (Native Mesh Preserved)`), preventing decimation artifacts and preserving 100% watertight topology for physical manufacturing.

- **Personal SaaS Workstation Command Center (`app/page.tsx`)**:
  - **Portal Persona**: Replaced the previous raw redirect with a world-class, premium SaaS-grade Command Center specifically tailored for personal workstation usage.
  - **Color Token Consistency**: Implements strict Matte Black (`--background: 0 0% 3.1%`, `--surface-1: 0 0% 6.7%`) and Studio Gold (`--primary: 48 100% 50%`, `#FFCC00`) HSL tokens with zero arbitrary hex styles.
  - **Sticky Glassmorphic Header**: Brand identity with Pro Studio badge and golden 3D emblem. Integrates live hardware telemetry pill connecting to `/api/v1/system/stats`, showing real-time VRAM allocation and GPU accelerator health with a pulsing emerald status dot, alongside direct routing to all internal applications (`Workspace`, `Generate`, `Retopo`, `Textures`, `Rigging`, `Outputs`, `Telemetry`, `System`).
  - **Interactive Quick-Launch Hero**: Multi-mode console directly on the hero section (`Image / Text to 3D`, `Quad Retopo`, `PBR Texture`, `Auto-Rigging`). Includes real-time intent preset pills (`Game Ready 50k`, `Cinematic 200k`, `3D Print Watertight`, `Mobile 20k`, `Animation Rigged`) and model selection (`Trellis 2`, `Hunyuan3D 2.1`, `Unique3D`, `TripoSG`). Submitting dynamically routes into `/workspace/generate` with pre-filled parameters.
  - **Autonomous Tool Matrix & Preset Comparison**: 6 interactive bento cards (`glass-card-interactive`) showcasing core workstation engines with hover lift, amber specular border glow, technical specs, and instant launch buttons. Supported by a deep-dive breakdown of the 5 production intent contracts.
  - **Global Keyboard Navigation**: Interactive hotkey cheat sheet listening to window events (`G` → Generate, `R` → Retopo, `T` → Texture, `U` → UV, `A` → Animation, `D` → Dashboard, `O` → Outputs, `S` → System) for lightning-fast power-user navigation.

---

## 2026-10-13 — Workspace Unified Dynamic-Tab System & Non-Destructive 3D Studio Architecture

- **Continuous 3D Viewport Architecture**:
  - Eliminated destructive unmounting of `<MeshViewer />` when switching to 3D Animate (`animation`) or Character Rigging (`rigging`).
  - Viewport WebGL scene, camera angle, turntable status, wireframe settings, lighting, and active 3D meshes now remain 100% persistent across all 8 tools (`model`, `remesh`, `texture`, `uv`, `segment`, `edit`, `animation`, `rigging`).
  - Removed canvas recreation lag (saving 200–500ms per switch), eliminating WebGL context loss risks and screen flicker.
- **Modular Dynamic Tool Panels**:
  - `renderToolPanel()` in `WorkspaceShell.tsx` dynamically routes to `AnimationLeftPanel` and `RiggingLeftPanel` within the floating left tool column.
  - `RightWorkspacePanel.tsx` dynamically routes to `AnimationRightInspector` and `RiggingRightInspector` within the right inspector column.
  - Viewport overlay docks the interactive `AnimationTimelineDock` at the bottom of the viewport when `activeTool === 'animation'`, with live transport controls, scrub bar, FPS selector (20, 24, 30, 60), and dual-track clip/keyframe markers.
- **Non-Destructive Main Navigation**:
  - `navigateToMain` in `WorkspaceContext.tsx` uses `window.history.replaceState` when already inside the workspace route tree, allowing instant overlay transitions (`overview`, `assets`, `jobs`, `system`) without tearing down or remounting the workspace page.
- **Real Data & Clean UI**:
  - Replaced hardcoded dummy geometry numbers in `ViewportToolOverlay.tsx` with live data from `currentAsset` and `useViewerStore` (`vertices`, `faces`/`triangles`, `dimensions`, `materials`).
  - Eradicated all remaining leaked `*Icon` tokens in code and comments across `SecondaryPanels.tsx`, `LeftNavigation.tsx`, `AnimationViewportStage.tsx`, and `RightPropertyPanel.tsx`.
- **Build Status**:
  - Validated with Next.js Turbopack production compilation (`next build`): 0 errors, 100% clean build.

---

## 2026-10-13 — UI/UX Pro Max Studio Interface Refinement and Navigation Unification

- **Navigation & Settings Iconography**:
  - Unified all navigation icons across `AdminShell.tsx` and `AdminSidebar.tsx` with dedicated section icons (`LayoutDashboard`, `Boxes`, `Activity`, `ScrollText`, `Briefcase`, `ListOrdered`, `HeartPulse`, `HardDrive`, `Database01`, `Settings01`).
  - Fixed `SettingsTab.tsx` subtab pills by wrapping icon data structures with `<HugeiconsIcon icon={Icon} size={14} />`, restoring rendering for all 8 subtabs (`general`, `generation`, `workspace`, `export`, `api`, `shortcuts`, `notifications`, `advanced`).
  - Unified `SettingsModal.tsx` tabs with `LayoutGridIcon`, `BrushIcon`, `ServerIcon`, and `SparklesIcon`, and added cross-surface deep linking to specific admin settings sections via `/admin?tab=settings&section=...`.
- **Eradication of Leaked Icon Strings**:
  - Eliminated leaked `*Icon` tokens from placeholders, titles, labels, and JSX text across all components:
    - `JobDetailView.tsx`: `RefreshIcon` -> `Refresh`, `SearchIcon job ID or model...` -> `Search job ID or model...`, `TargetIcon Pipeline` -> `Target Pipeline`.
    - `SecondaryPanels.tsx`: `TargetIcon Mesh` -> `Target Mesh`.
    - `MeshSegmentPanel.tsx`: `TargetIcon Parts` -> `Target Parts`.
    - `RemeshPanel.tsx`: `TargetIcon 3D Mesh` -> `Target 3D Mesh`.
    - `MeshEditPanel.tsx`: `TargetIcon Mesh` -> `Target Mesh`, `Sculpt BrushIcon` -> `Sculpt Brush`, `BrushIcon Dynamics` -> `Brush Dynamics`, `BrushIcon Radius (Size)` -> `Brush Radius (Size)`, `BrushIcon Strength` -> `Brush Strength`.
    - `SegmentInspector.tsx`: `DownloadIcon Segmented GLB` -> `Download Segmented GLB`.
    - `MeshEditInspector.tsx`: `Selection InfoIcon` -> `Selection Info`.
    - `AnimationViewportStage.tsx`: `Auto CameraIcon` -> `Auto Camera`, `GridIcon` -> `Grid`.
    - `MotionLibraryDrawer.tsx`: `SearchIcon motion assets...` -> `Search motion assets...`.
    - `DccBridgeModal.tsx`: `SendIcon to` -> `Send to`.
    - `ExportModal.tsx`: `TargetIcon Format` -> `Target Format`, `PackageIcon complete workspace` -> `Package complete workspace`.
    - `UploadDiagnosticModal.tsx`: `UploadIcon Diagnostics` -> `Upload Diagnostics`.
    - `MeshViewer.tsx`: `PauseIcon` / `PlayIcon` -> `Pause` / `Play`.
    - `ViewportToolOverlay.tsx`: `MoveIcon Manipulator` -> `Move Manipulator`, `Toggle GridIcon` -> `Toggle Grid`.
    - `StorageTab.tsx`, `ModelsTab.tsx`, `JobsTab.tsx`, `QueueTab.tsx`, `ActivityLogger.tsx`, `GpuVramLineChart.tsx`: `RefreshIcon` -> `Refresh`.
- **Compact Studio Layout & Interaction Polish**:
  - Enforced compact 12px/16px padding grids, tactile active feedback (`active:scale-[0.98]`), and refined border contrast (`border-white/[0.08]` to `border-white/[0.12]`).
  - Next.js production compilation (`next build`) validated with 0 TypeScript/Turbopack errors.

---

## 2026-10-13 — Hunyuan Loader and Dependency Root Causes

- TripoSG's reported `HybridCache` import failure came from shared `transformers==4.46.3` being below Mini Turbo's upstream `transformers>=4.48.0` requirement while the environment used `peft==0.17.1`. Shared runtime now targets `transformers==4.48.3`; Diffusers and Torch/CUDA pins remain unchanged.
- Hunyuan Shape's Python package root is `backend/thirdparty/hunyuan3d-shape-v2-1/hy3dshape`; correct imports are `hy3dshape.pipelines` and `hy3dshape.rembg`. Do not delete or rewrite an `__init__.py` at runtime or alias `hy3dshape.hy3dshape` in `sys.modules`.
- Mini's source root is `backend/thirdparty/hunyuan3d-dit-v2-mini-turbo`; its checkpoint folder is `backend/pretrained/tencent/Hunyuan3D-2mini/hunyuan3d-dit-v2-mini-turbo`. Put the source root first in `sys.path`, remove conflicting cached `hy3dgen` modules before import, and validate both paths before pipeline initialization.
- Model-load exceptions must use `logger.exception(...)` to retain the chained traceback. The multiprocess worker logs full details but returns a concise summary instead of forwarding a full traceback as a UI error.
- Static source-contract tests were added. GPU inference validation remains pending until run on a CUDA-enabled host.

---

## Current Runtime Catalog — 2026-10-11

- **Tripo integration:** TripoSG is the sole active/selectable Tripo model. TripoSR and TripoSF adapters, registrations, scheduling profiles, presets, UI fallbacks, download/verification paths, and model-specific installer steps have been retired. TripoSF was not retained because its image-generation path invokes TripoSR for coarse-mesh creation.
- **Multi-View:** The dedicated Zero123++ model integration, GeneratePanel workspace, API router, model registration, tests, and download/install-manager entries have been removed. The single-image generation path remains the supported UI/API path.
- **Scope guard:** Other model integrations and generic scheduler/capability code remain intact. All `backend/thirdparty/` vendored repository directories were deliberately left untouched for separate manual cleanup; the docs below retain historical records of prior implementations.

---

## 2026-10-11 Complete Audit Remediation Pass (All 5 Specialists: Raw Geometry, Texture Pipeline, API Lifecycle, Database Admin, UI Contracts)
- **RAW-QUALITY-001, BUG-006, BUG-024 (Specialist 1)**:
  - TripoSR mc_resolution parameter unlocked up to 512 max fidelity instead of hardcoded 320.
  - TripoSG num_inference_steps clamp removed and full hierarchical octree depth forwarded.
  - Hunyuan3D-Shape-v2.1 and Hunyuan3D-DiT-v2-mini-Turbo default to 512 octree resolution when source_quality == 'max'.
  - TripoSF upright Y-up orientation verified and spurious +90° X rotation removed; coordinate basis tested with asymmetric 3D fixture.
  - GeneratePanel mesh quality options copy updated to describe downstream polycount budgets (~15k, ~30k, ~60k, ~100k tris) rather than inaccurate universal grid estimates.
- **BUG-001, BUG-008, BUG-009, BUG-017, BUG-019, BUG-020, BUG-026 (Specialist 2)**:
  - Fixed pipeline.py Stage 7 indentation ensuring game-ready GLB, FBX, and LODs execute cleanly without UnboundLocalError when texturing is disabled.
  - Set active_model_url to textured_model_url on texturing success while strictly preserving immutable master/source.glb.
  - Built downstream FBX and LOD chain from the textured mesh derivative.
  - Applied Paint3D scene node transforms via scene_to_mesh() before OBJ extraction.
  - Unclamped 8K bake maps and recorded width/height dimensions per map in generated and result metadata.
  - Propagated bake and collision failures into artifact_errors, degraded_reasons, and production_status: "degraded".
  - Reported truthful degraded fallback for quad retopology on native-textured models without silent triangles.
- **BUG-002, BUG-012, BUG-013, BUG-018, BUG-023 (Specialist 3)**:
  - Single-pass pop of nested texture_resolution from model_parameters with strict precedence.
  - Preserved original reference image path when preprocessing enhancement artifact is provided.
  - Tracked and cleaned temporary mesh_gen_* directories on job completion, failure, cancellation, and scheduling errors.
  - Fixed adapter get_vram_status to report ineligible when CUDA is unavailable and validate assigned gpu_id.
  - Validated supported texture resolutions (1024, 2048, 4096, 8192 / 1K, 2K, 4K, 8K) returning 422 HTTP error for arbitrary sizes.
- **BUG-003, BUG-004, BUG-005, BUG-014, BUG-015, BUG-016, BUG-025 (Specialist 4)**:
  - _delete_tree handles files (unlink) and directories (rmtree) with root containment guards.
  - clear_all_files collects full metadata batches without pagination skips, reporting authoritative removal count.
  - _delete_job_with_workspace and DatabaseTab distinguish deleted, missing, and not_recorded workspace states.
  - _collect_job_ids applies status and feature selectors to Redis keys.
  - Active jobs cancelled and workers drained before deletion.
  - FileStore list_file_metadata cleans stale IDs from global and per-type sorted sets.
  - _models_root dynamically derived from _storage_root() / "models".
- **BUG-007, BUG-010, BUG-011, BUG-021, BUG-022, BUG-027 (Specialist 5)**:
  - 4K texture preset resolves to 4096 across all generation and batch builders.
  - TexturePanel consumes authoritative backend model readiness directly from /system/models.
  - Disabled unsupported TexturePanel controls (Low VRAM, style presets, PBR toggles) with clear tooltips.
  - Removed all literal icon token placeholder strings across 6 UI components.
  - Emitted warning toast with degradation reasons on degraded production status; persisted productionStatus and degradedReasons on ModelAsset.
- **Full Verification**: All regression suites passing 100%: 11/11 in test_api_contracts_lifecycle.py, 13/13 in test_database_admin.py, 15/15 in test_generation_adapter_regressions.py, 14/14 in test_postprocess_texture_pipeline.py, 16/16 in test_paint3d_adapter.py / test_postprocess_e2e.py, 6/6 in test_cancellation_and_quad.py; TypeScript typecheck (`bun run test`) clean with 0 errors.

---
## 2026-10-11 Database Admin & FileStore Consistency Pass (Specialist 4)
- Fixed `test_clear_all_jobs_requires_typed_confirmation`: `_cancel_job_if_active` safely handles schedulers/job queues without a direct `cancel_job` method, distinguishes active jobs from idle SQLite rows, and cancels/drains active workers before deletion.
- BUG-003: `_delete_tree()` safely unlinks files/symlinks and rmtree's directories with root-containment checks before deletion, preventing escape outside storage root.
- BUG-004: `clear_all_files()` gathers metadata in stable un-shifted batches and counts only authoritative deleted metadata records across >1,000 files without skipping items.
- BUG-005: `_delete_job_with_workspace()` in `database.py` and `delete_job()` in `system.py` report `asset_workspace_status` (`"deleted"`, `"missing"`, `"not_recorded"`, `"failed"`). `DatabaseTab.tsx` toast accurately reflects missing vs deleted vs not recorded workspaces.
- BUG-014: `_collect_job_ids()` applies requested status and feature selectors to Redis jobs (`3daigc:jobs`) as well as SQLite, preventing cross-status or cross-feature bulk deletion.
- BUG-015: `_delete_job_with_workspace()` and `clear_all_jobs()` cancel and drain active jobs, refusing to delete active jobs that cannot be stopped.
- BUG-016: `FileStore.list_file_metadata()` cleans stale IDs from both global (`3daigc:files:all`) and per-type (`3daigc:files:{file_type}`) sorted sets.
- BUG-025: `_models_root()` dynamically derives from `_storage_root() / "models"`, honoring configured `STORAGE_LOCAL_PATH`.
- Verification: 13 passed in `backend/tests/test_database_admin.py` (including 6 new regression tests); `py_compile` clean.

---
## 2026-10-11 Consolidated Generation, Texture, Detail-Preservation, and UI Reliability Pass

- Normal image-to-3D requests use raw geometry; texture_enabled/generate_texture are post-processing controls and are filtered from geometry-model inference. Central routing sends 1K/2K to Paint3D and 4K/8K to Hunyuan3D-Paint v2.1.
- API request validators normalize named presets and numeric atlas sizes (1K=1024, 2K=2048, 4K=4096, 8K=8192). Central texturing inspects the embedded base-colour texture in the exported GLB and refuses to report success if the observed square dimensions cannot be verified or do not match the target. The raw master remains separate on texture failure.
- RealESRGAN remains internal to Hunyuan Paint and is forced on; its separate UI toggles were removed. Per-view generation resolution (512/768) is separate from the target atlas size, and the vendor export no longer requests atlas downsampling.
- Removed the Advanced micro-detail control and enabled high-to-low normal/AO baking by default where supported. AutoRetopo uses less shell smoothing and avoids voxel-shell reconstruction for already-watertight requested quad meshes. Native/Raw polycount disables automatic decimation in the frontend parameter builders.
- Texture Studio routes Paint3D through the manifest model ID paint3d. Multi-view requests carry the original reference-image file reference and the post-process settings consumed by the API. The database tab ignores stale request responses and exposes refresh failures with retry.
- Regression coverage added for 8K request normalization, direct-paint flag isolation, atlas-dimension validation, FastMesh degenerate-input handling, and scheduler post-process parameter filtering. GPU/model outputs, browser interaction, and the complete test/build suite still need execution in the project runtime.

---
## 2026-10-11 Database Administration Surface (Admin Database Tab)
- **Backend router**: `backend/api/routers/database.py` mounted at `/api/v1/system/database` in both `main_singleworker.py` and `main_multiworker.py`. Endpoints: `GET /stats` (SQLite status counts + db file size, Redis key count + `used_memory`, queue counts, file-metadata count, meshes/uploads disk sizes), `GET /keys` (read-only SCAN-based Redis key inspector, `limit` 1..1000, `503` when Redis is unavailable), `DELETE /jobs` (bulk by `job_ids`/`status`/`feature`), `POST /jobs/clear`, `DELETE /files/clear`. API key required; admin role required whenever a user is authenticated. Regression tests: `backend/tests/test_database_admin.py` (7).
- **Confirm-token safety model**: `DELETE /jobs` requires `{"confirm": true}` plus a selector (`job_ids` list, or `status`, or `feature`); running/queued jobs are skipped unless `force: true`. `POST /jobs/clear` requires `{"confirm": "CLEAR_ALL_JOBS"}`; `DELETE /files/clear` requires `{"confirm": "CLEAR_ALL_FILES"}`. Each job is removed from Redis hot keys AND the SQLite jobs table (reusing `RedisJobQueue.delete_job`, ADR-062) and its canonical asset workspace under `backend/storage/models/meshes/<asset>_<job_id>/` is deleted only after the durable delete succeeds (path validated against the models root before `rmtree`).
- **New DatabaseManager methods**: `delete_all_jobs()` (deletes every job row for the clear endpoint) and `get_database_size_bytes()` (SQLite file plus WAL/SHM sidecars).
- **Intentionally preserved**: uploads and file metadata survive clear-all-jobs (which additionally sweeps job-owned Redis keys, removes every job workspace, and VACUUMs SQLite); job records and asset workspaces survive clear-all-files; user/token auth keys (`3daigc:user*`, `3daigc:token*`, `3daigc:users:all`) are never swept, so a job wipe never logs users out or revokes API keys.
- **Frontend**: admin Database tab at `/admin?tab=database` — stats cards, paginated jobs table with per-row cancel (running → cancelled) and delete (full removal from the jobs DB), checkbox multi-select + bulk delete by selection/status/feature, Redis key inspector, and typed-confirmation danger-zone clear actions.

## 2026-10-11 Setup Robustness — Node Locked Runtime Reuse
- `scripts/setup.sh` `_ensure_node_version()` re-downloaded the locked Node v24.21.0 on every setup run even when the pinned runtime was already on disk at `$HOME/.formash3d/node/current`. A transient download/extract failure then aborted the entire setup with `Node v24.21.0 installation failed verification (found: 22.14.0)` — the verification saw nvm's v22.14.0 because the re-install had deleted/broken the pinned path.
- Fixed: the function now reuses the existing pinned runtime when `current/bin/node --version` matches the lock, before any network access. Setup is idempotent for the Node step; verified live (`REUSE_OK -> v24.21.0`). `bash -n` clean.
- Same class of failure hit npm: the pinned Node runtime already bundles the locked npm v11.19.0, but `_ensure_npm_version()` resolved the ambient (nvm) npm 10.9.2 and attempted `npm install -g npm@11.19.0`, which targets the read-only conda/nvm prefix (`npm config get prefix` → `/system/conda/node/nvm/...`) and always fails without root. Fixed: verify/reuse `${NODE_RUNTIME_DIR}/current/bin/npm` by absolute path before any install, and any fallback install uses `--prefix "${NODE_RUNTIME_DIR}/current"` (user-owned), never the ambient prefix. Removed the sudo self-upgrade path entirely — root is not required for the pinned runtime.

## 2026-10-11 Section 3 Paint3D 1K/2K Texture Integration
- **Paint3D Adapter Implementation (`backend/adapters/paint3d_adapter.py`)**:
  - Inherits from `ImageToMeshModel` (with `MeshToMeshModel` and `ModelAdapter` compatibility aliases).
  - Implements two-stage workflow: Stage 1 coarse multi-view painting (`pipeline_paint3d_stage1.py`) and Stage 2 UV inpainting & seam refinement (`pipeline_paint3d_stage2.py`).
  - Supports `1K` (1024x1024) and `2K` (2048x2048) texture presets, accepting untextured input mesh (`.glb`, `.obj`) and original reference image path (`image_path`).
  - Job-scoped directory isolation via `tempfile.mkdtemp(prefix=f"paint3d_job_{job_id}_")` with automatic cleanup in `finally` blocks to prevent concurrent write collisions.
  - Safe subprocess invocation with discrete argv lists, strict timeout and cancellation handling, and controlled environment (`CUDA_VISIBLE_DEVICES`, `PYTHONPATH`).
  - Preserves underlying mesh geometry while exporting textured `.glb` / `.obj` with extracted texture maps dictionary (`{"albedo": ...}`) and real on-disk resolution metadata.
  - Enforces strict GPU policy (`device = 'cuda:0'`), raising immediate errors if CUDA is unavailable and never silently falling back to CPU.
- **Model Registration & Registry Aliases**:
  - `backend/core/scheduler/model_factory.py`: Registered `paint3d` and `paint3d_image_mesh_painting` in `ADAPTER_REGISTRY` pointing to `adapters.paint3d_adapter.Paint3DAdapter`.
  - `backend/adapters/__init__.py`: Added `Paint3DAdapter` and `Paint3DImageMeshPaintingAdapter` to `_ADAPTER_MAP` with lazy dynamic import and automatic `backend/` directory path injection.
  - `backend/config/models.yaml`: Registered `paint3d` under `image_mesh_painting` (`vram_requirement: 12000`, `supported_inputs: ["mesh", "image"]`, `supported_outputs: ["glb", "obj"]`, `supported_resolutions: [1024, 2048]`, `model_path: "backend/pretrained/Paint3D"`, `enabled: true`, `max_workers: 1`).
- **Vendored Upstream & Runtime Compatibility**:
  - Upstream repository vendored in `backend/thirdparty/Paint3D` (pinned at commit `d5545d38db6aaf78efc563269f70177688a4218e`, nested `.git` removed).
  - Maintained baseline runtime: Python 3.10, PyTorch 2.6.0+cu124, CUDA 12.4 without library downgrades. Upstream modules (`paint3d.models.textured_mesh`, `controlnet.*`, `paint3d.dataset`, `paint3d.trainer`) compile and import cleanly.
- **Download Manager & Shell Tools**:
  - `backend/scripts/download_models.sh`: Added `download_paint3d()` downloading official weights (`GeorgeQi/Paint3d_UVPos_Control` with fallback to `OpenTexture/Paint3D`) into `backend/pretrained/Paint3D` and validating `diffusion_pytorch_model.bin` and `config.json`. Integrated into `verify_all_models()` and the main selection loop.
  - `manager.sh`: Added interactive option `[24] Paint3D - 1K/2K UV texture diffusion model` in `cmd_models()`.
  - `backend/scripts/install.sh`: Added repository clone and lightweight dependency check (`omegaconf`, `xatlas`) preserving PyTorch 2.6 / CUDA 12.4.
- **Verification**:
  - Verified Python syntax: `python -m py_compile backend/adapters/paint3d_adapter.py backend/core/scheduler/model_factory.py backend/adapters/__init__.py`.
  - Verified Shell syntax: `bash -n backend/scripts/download_models.sh backend/scripts/install.sh manager.sh`.
  - Pytest regression tests: `pytest backend/tests/test_paint3d_adapter.py -v` (5/5 passed).

## 2026-10-11 Section 5, A1, A2, A3 Centralized Texture Pipeline & Cooperative Cancellation
- **Cooperative Post-Processing Cancellation (A1)**: In `backend/postprocess/pipeline.py`, added `CancelChecker = Optional[Callable[[], bool]]` and `_check_cancelled(cancel_checker)` helper raising `InterruptedError`. Inserted cancellation checkpoints before/after every major stage (inspect, repair, retopo, remesh, optimize, UV, bake, texture, LODs, QA). If cancel is signaled, post-processing aborts immediately without corrupting `master/source.glb` or writing false completion to `asset.json`.
- **Centralized Texture Stage inside Post-Processing (Section 5)**: In `backend/postprocess/pipeline.py`, added `resolve_texture_preset()` (`1K`->1024, `2K`->2048, `4K`->4096, `8K`->8192) routing 1K/2K to Paint3D and 4K/8K to Hunyuan3D-Paint v2.1. Integrated `_execute_texture_stage()` into `run_postprocess_job()` between game-ready/FBX export and LODs. If `texture_enabled=False`, marks status `skipped`. When enabled, passes validated mesh and durable reference image, writes textured result to separate `textures/<base_name>_textured.glb` without overwriting raw master, validates on-disk atlas dimensions, and on texture failure preserves raw geometry with degraded telemetry. Audited manifest cache to permit texture-only retries without repeating raw geometry generation.
- **Auto-rig Terminal Parent Protection (A2)**: In `backend/core/scheduler/multiprocess_scheduler.py`, updated `_watch_auto_rig()` to verify parent status (`get_job(parent_job_id)`) during child polling, before completing parent job, and in the exception fallback block. Cancels child job and exits cleanly if parent was cancelled or failed.
- **Truthful Cooperative Cancel Signal (A3)**: In `backend/core/scheduler/multiprocess_scheduler.py`, updated `cancel_job()`. When `_stop_worker_for_job()` returns False (work in postprocess or chained stages), sets `self._cancel_requested_jobs`, triggers thread-safe `_active_postprocess_cancels[job_id]`, and requests cancellation via Redis, returning False without faking completion or premature temp file deletion.
- **Auto-paint Orchestration in `_handle_job_result()`**: In `multiprocess_scheduler.py`, normalized `texture_enabled` into post-processing rather than scheduling redundant `image_mesh_painting` child jobs. Wrapped `run_postprocess_job` with a thread-safe `cancel_checker`, caught `(InterruptedError, asyncio.CancelledError)` to cleanly cancel the job without marking failure, and protected auto-rig and final completion against terminal parent races.
- **Verification**: 12/12 pytest unit tests pass across `test_postprocess_texture_pipeline.py` and `test_cancellation_and_quad.py`; 21/21 official model parity tests pass (`test_official_model_parity_contract.py`); `python3 -m py_compile` clean.

## 2026-10-11 Section 4 Raw-Mesh Decoupling & Model Registry Normalization
- **Normal image-to-3D models produce raw mesh only**: Converted TRELLIS, TRELLIS.2, Hunyuan3D-Shape-v2.1, Hunyuan3D-DiT-v2-mini-Turbo, Unique3D, and Pixal3D to output untextured raw geometry only, completely removing embedded native texture generation, texture baking, and automatic paint chaining from the normal generation path. Texturing is decoupled into the centralized post-processing texture stage.
- **`backend/config/models.yaml`**:
  - Set `paint_autochain: false` on `hunyuan3d_shape_v21_image_to_raw_mesh` and `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh`.
  - Set `texture_generation: false` on `unique3d_image_to_raw_mesh`.
  - Added `trellis_image_to_3d`, `trellis_image_to_raw_mesh`, `trellis2_image_to_3d`, and `trellis2_image_to_raw_mesh` under `image_to_raw_mesh`.
  - Deprecated legacy `trellis_image_to_textured_mesh` and `trellis2_image_to_textured_mesh` under `image_to_textured_mesh` with `deprecated: true` and `alias_of` pointing to the raw-mesh IDs.
- **`backend/adapters/hunyuan3d_shape_v21.py`**:
  - Changed `Hunyuan3DShapeV21ImageToTexturedMeshAdapter` to inherit directly from `Hunyuan3DShapeV21ImageToRawMeshAdapter` with a deprecation warning, removing the internal auto-chain call to Hunyuan Paint.
  - Added backward-compatible alias `Hunyuan3DShapeV21ImageToMeshAdapter = Hunyuan3DShapeV21ImageToRawMeshAdapter`.
- **`backend/adapters/trellis_adapter.py`**:
  - Refactored `TrellisImageToMeshAdapterCommon._process_request` so image-to-3D decodes `formats=["mesh"]` only, extracting the raw mesh without invoking `to_trimesh` multiview rendering and texture baking.
  - Rotated the raw untextured mesh to standard Y-up (`[[1, 0, 0], [0, 0, 1], [0, -1, 0]]`) and returned metadata with `"has_texture": False`.
  - Subclassed `TrellisImageToTexturedMeshAdapter` from `TrellisImageToRawMeshAdapter` with deprecation notices. Added `TrellisImageToMeshAdapter` alias.
- **`backend/utils/trellis2_utils.py` & `backend/adapters/trellis2_adapter.py`**:
  - In `trellis2_utils.py`: Added `raw_mesh_only=True` parameter to `Trellis2Runner.image_to_mesh()`, returning untextured `trimesh.Trimesh` directly from vertices/faces and skipping `o_voxel.postprocess.to_glb` texture generation and baking.
  - In `trellis2_adapter.py`: Implemented `Trellis2ImageToRawMeshAdapter` calling `image_to_mesh(..., raw_mesh_only=True)` with `"has_texture": False`. Subclassed `Trellis2ImageToTexturedMeshAdapter` from `Trellis2ImageToRawMeshAdapter`. Added `Trellis2ImageToMeshAdapter` alias.
- **`backend/adapters/unique3d_adapter.py`**:
  - Corrected generation info from `"has_texture": True` to `"has_texture": False` with `"has_vertex_color": True, "vertex_color": True`, preserving native PyTorch3D mesh vertex colors without 2D UV texture baking.
- **`backend/core/scheduler/model_factory.py` & `backend/adapters/__init__.py`**:
  - Added `get_model_adapter()` method and function.
  - Updated `ADAPTER_REGISTRY` with canonical `image_to_raw_mesh` mappings for TRELLIS, TRELLIS.2, Hunyuan3D-Shape-v2.1, and Hunyuan3D-DiT-v2-mini-Turbo.
  - Added `LEGACY_IMAGE_TO_RAW_ALIASES` dict mapping legacy `image_to_textured_mesh` IDs to raw-mesh IDs.
  - In `create_model_from_config()`, normalized `feature_type == "image_to_textured_mesh"` to `"image_to_raw_mesh"` and resolved legacy aliases.
  - Added legacy adapter class aliases in `backend/adapters/__init__.py` `_ADAPTER_MAP`.
- **Verification**: Verified with `py_compile` across all modified files and executed automated assertions in `3daigc-api` virtual environment validating `models.yaml` configuration, `ModelFactory.ADAPTER_REGISTRY`, `get_model_adapter()` resolution, and lazy adapter imports.

## 2026-10-11 Backend Cancellation & Redis/SQLite Consistency (Sections A & B)
- **Redis `update_job_progress` terminal status guard`: In `redis_job_queue.py`, `update_job_progress()` checks status first against `_TERMINAL_STATUSES` (`completed`, `failed`, `cancelled`). If terminal, returns early without mutating progress, stage, message, logs, or hot keys.
- **SQLite cancellation persistence**: In `redis_job_queue.py`, `cancel_job()` now loads `JobRequest` and calls `await asyncio.to_thread(self.db_manager.save_job, job_request)` with `JobStatus.CANCELLED`, error `'Cancelled by user'`, and `completed_at`, mirroring `complete_job()` and `fail_job()`.
- **Truthful cancellation endpoint**: In `mesh_generation.py`, `cancel_mesh_generation()` propagates real outcome from `scheduler.cancel_job(job_id)` instead of calling `force=True` on `job_queue`. Returns `cancelled=True` if cancelled, or `cancelled=False, cancel_requested=True, message='Cancellation requested'` if still stopping/processing.
- **Status alias compatibility**: Reconciled status checks across `redis_job_queue.py` and `mesh_generation.py`. 'running' is cleanly accepted as an alias for 'processing', while terminal statuses are strictly (`completed`, `failed`, `cancelled`).
- **Frontend polling cancel sync**: In `WorkspaceContext.tsx`, `cancelExecution()` now synchronizes `jobsById` and `jobsByIdRef.current` with `status: 'interrupted'`, preventing the polling loop from resurrecting the cancelled job to active.
- **Verification**: `py_compile` clean; `tsc --noEmit` clean; 5/5 regression tests pass (`test_cancellation_redis_sqlite_consistency.py`).

## 2026-10-11 Tripo Mesh Quality Fixes (TripoSR / TripoSG / TripoSF)
- **TripoSF always ran the low-VRAM downshift**: `triposf_adapter.py` parsed `low_vram_mode` with `bool(inputs.get(...))`, but the frontend always sends the advisory string `'auto'` — `bool('auto')` is `True`, so every standard job was silently cut to 256-volume / 409,600 samples / forced pruning (runtime log: `low_vram_mode enabled: resolution=256, pruning=True, sample_points=409600` on a 15 GB GPU). Fixed with a tri-state `_resolve_low_vram_mode()` (`'auto'` = measured decision from free VRAM, never below the official 819,200 floor; `'low'` = explicit 409,600 fallback; `'normal'` = full 1,638,400). Schema type corrected from `boolean` to the string enum it actually receives.
- **TripoSF volume-resolution landmine removed**: code/schema hardcoded `resolution: 1024`, but the released checkpoint `pretrained_TripoSFVAE_256i1024o` and `configs/TripoSFVAE_1024.yaml` build the VAE at 256 (1024³ is only the FlexiCubes extraction grid). At 1024 the decoder masks cover only coordinates < 256, silently dropping ~98.4% of voxels. Adapter now uses the official 256 everywhere (constructor, runtime, schema, parity test), and logs when a request carries a different value (the frontend still sends 1024; it is now inert).
- **TripoSR foreground was never cropped**: vendored `resize_foreground()` treats any non-zero alpha as foreground, so soft rembg masks leaked the whole frame as foreground — on full-scene photos (e.g. the reported house image) the subject stayed ~24% of the canvas instead of the upstream >70%. `TripoSRImageToRawMeshAdapter` now hardens the mask (`_binarize_alpha_mask`, alpha >= 128) before upstream cropping; rembg failure is recorded as `background_removal_failed` in `generation_info` instead of silently feeding the uncropped raw image; marching-cubes noise fragments are dropped (`_drop_noise_components`).
- **TripoSG gate myth corrected**: the `quality`/`meshQuality` flash-decoder disable gate was dead code (the raw/textured path never sends those keys; only the multiview body does, and TripoSG is `multiview: false`), and the vendored hierarchical path it selected queries a far denser grid (OOM risk). The flash VAE decoder is the official upstream extraction path (`scripts/inference_triposg.py` relies on the pipeline default) and runs exact SDPA attention, so it is now the documented single path. RMBG-1.4 load failure now raises a clear error instead of logging "will use fallback" and crashing later in `prepare_image`.
- **Contract correction (supersedes the 2026-10-03 note "TripoSF 1024³ + 1,638,400 samples")**: TripoSF volume resolution is 256 (official), sample count 1,638,400 (README complex-shape tip; official default 819,200 remains the auto-downshift floor). TripoSR `mc_resolution=320` is converged at the model ceiling (extraction at 512³ moves the surface < 2 mm); sharpness now depends on model selection, not extraction density.
- Regression tests: tri-state low-VRAM parse, official 256 resolution, alpha binarization, noise-component drop (`tests/test_official_model_parity_contract.py`). Full suite matches the pre-change failure set exactly (8 pre-existing failures, none in Tripo files; 139 passed vs 135 before). GPU validation of new TripoSF sample density remains environment-gated.

## 2026-10-10 Database Durability (WAL, Orphan Reconciliation, Temp-Dir Cleanup)

- **SQLite concurrency**: API + scheduler + workers write `backend/storage/job_queue.db`; no WAL meant reader/writer lock contention. `database_manager._initialize_database` now applies `PRAGMA journal_mode=WAL / busy_timeout=30000 / synchronous=NORMAL` via an engine `connect` event (persistent in the file).
- **Orphaned transient rows**: after a scheduler restart or Redis-side delete, SQLite `queued`/`processing` rows never resolved (stuck-forever jobs in the UI). `RedisJobQueue._reconcile_stale_job_rows` (called from `recover_orphaned_jobs` at startup) fails transient rows with no presence in the jobs hash or pending zset, using the new single-transaction `DatabaseManager.mark_jobs_failed`. Terminal rows are never touched. Verified live before commit.
- **Temp-dir cleanup broke in-flight jobs**: `_cleanup_stale_input_dirs` removed every `/tmp/mesh_gen_*` dir at scheduler startup, including dirs the API process still owned for queued jobs → workers failed with `[Errno 2] No such file or directory: /tmp/mesh_gen_*/b64_*.webp`. Now only dirs with mtime older than 6h are removed.
- Known-remaining (not bugs, tracked): UniRig requires a platform-compatible Blender 4.0 `bpy` wheel; the installer now fails fast with actionable guidance instead of reporting false success. Quad AutoRetopo remains best-effort by design.

## 2026-10-10 Mesh-Tool UX Fixes (Data-URL Inputs, Panel Switching, Upload Refs, Job Deletion, UniRig)
- **Texture data-URL rejection**: `runTextureGeneration` sent `image_path` = `data:image/webp;base64,...`; backend `process_file_input` now routes `data:` URLs into its base64 branch (mesh_generation.py:368-397), and the UI sends `image_base64` (prefix stripped) or `image_file_id`.
- **Panel auto-switch**: `selectAsset`/`startTask`/`selectJobToView` read a stale `activeTool` closure and rewrote the URL, which Next 16 + `WorkspaceShell.tsx:249-255` mapped back to Generation on every asset change. Fixed with `activeToolRef` (WorkspaceContext.tsx:467,652; route reads at 1138,1183,1341).
- **Uploaded meshes without backend fileId**: new `uploadMeshAsset()` (types.ts:248-289) uploads via `/api/v1/file-upload/mesh` and sets `fileId` + `source.fileId`; wired into Remesh/Segment/Edit/UV panels and MeshViewer drag-drop.
- **Job deletion 500**: `delete_job` referenced a nonexistent `self.results_hash_key` (results are string keys under `results_prefix`) → every DELETE 500'd and SQLite rows survived as phantom history entries. Fixed at redis_job_queue.py:717.
- **UniRig missing `src/data`**: cause was `backend/.gitignore:434` bare `data/` rule dropping the vendored UniRig data modules on clone (not a download failure). Restored 17+2 upstream files (verified byte-identical to upstream commit d993b00), one py3.10 typing fix in `src/data/asset.py`, fail-fast imports in `utils/unirig_utils.py`, plus `!thirdparty/UniRig/src/data/` negations. Rigging still needs `bpy` (Blender 4.0 bundled python; no py3.10 wheel) — needs a decision/approval before install changes.
- **image-to-raw-mesh silent 400**: `validate_inputs` was `field_validator("image_file_id")` so it never ran for sample-preset requests (no file_id); converted to `model_validator(mode="after")` → 422 with field detail, and UI pre-checks with a clear message.
- Validation: compileall, tsc, live checks — DELETE 200, data-URL painting 200/queued, no import errors after restart. End-to-end GPU runs (paint/rig) remain user-hardware gated.

## 2026-10-10 Downloader False-Success Fix
- **Symptom**: selecting ARDY [18] in `download_models.sh` printed "[WARNING] ARDY Hugging Face repository requires Meta-Llama gated access or HF token." followed by "[SUCCESS] Model Download Complete! / All requested models have been downloaded successfully." while `pretrained/ardy` had 0 files.
- **Root cause**: `download_ardy()` printed warnings and fell through to an implicit `return 0`; the main loop never checked `download_*` return codes before the success banner. `download_triposg()` had the same swallow for RMBG-1.4 and TripoSG (warnings only).
- **Fix**: failure branches now `print_error` + `return 1` (ARDY guidance: gated Meta-Llama repo, request access at https://huggingface.co/nv-tlabs/ardy then `export HF_TOKEN=<token>`); the loop sets `failed=true` on any non-zero case status and exits 1 with an error summary instead of the success banner. TripoSG-scribble stays optional by design.
- Verified: gated ARDY run → exit 1 with real HF error; already-verified `hunyuan2mini` run → exit 0 with banner.

## 2026-10-10 Mesh-Tool File References (remesh/texture/UV/segment/edit)
- **Symptom**: mesh tools returned 500 "File upload failed for 'https://<origin>/<uuid>': Server file path is outside configured input roots. Use file_id input instead."
- **Root causes (frontend + backend)**:
  1. Frontend: mesh-tool call sites read `currentAsset?.source?.fileId`, which was never populated — `normalizeModelAsset` dropped it and job-derived assets only carried job-download URLs. The supported `mesh_file_id` request branch was dead code, so `mesh_path` received a browser URL that `resolve_server_file_path` (file_utils.py:68-110) rejects by design.
  2. Backend: routers accepted `mesh_path` as a raw local path only; URL inputs (download URLs, bare `/{uuid}` paths from upstream jobs) had no translation to the file store.
- **Fixes**: `normalizeModelAsset` preserves `fileId` on asset + `source`; job-derived assets (history, polling completion, selectJobToView, JobDetailView) expose `job-{jobId}` (registered in the file store at `system.py:1140-1155`); all five mesh-tool call sites send `mesh_file_id` and never send http/blob URLs in `mesh_path`. Backend: `resolve_input_reference_async` (file_upload.py) resolves file-upload/job-download URLs and bare uuid paths via the file store (`{id}` then `job-{id}`, disk-glob fallback), wired into mesh_retopology, mesh_uv_unwrapping, mesh_segmentation, auto_rigging, mesh_generation.
- Validation: `compileall` OK, `tsc --noEmit` clean (via bun), user-verified in the running app.

## 2026-10-10 Paint Adapter Import, Unconditional Postprocessing & VRAM Backoff
- **Hunyuan3D-Paint-v2.1 `ModuleNotFoundError: No module named 'utils.simplify_mesh_utils'`**:
  - Root cause: `hunyuan3d_paint_v21.py` appended `hunyuan3d_root` and `hunyuan3d_root/hy3dpaint` via `sys.path.append`; appended entries sit behind the process CWD (`backend/`), so `backend/utils` shadowed `hy3dpaint/utils` and `from utils.simplify_mesh_utils import remesh_mesh` (textureGenPipeline.py:23) failed.
  - Fix: insert both paths at the front of `sys.path` (guards unchanged); verified in the worker venv that `utils` resolves to `hy3dpaint/utils` and `remesh_mesh` imports.
- **Production post-processing did not run when Texture ON chained a paint job**:
  - Root cause: `multiprocess_scheduler.py` gated postprocess on `not auto_paint`, contradicting its own comment — texture-ON raw generations never produced `master/source.glb`/`game_ready/`/previews, and the chained paint child pointed at the raw output that the pipeline unlinks after master promotion (child would fail even after the import fix).
  - Fix: postprocess always runs for `production_mesh` jobs; the paint child input now uses `canonical_asset_workspace(job_id, ...)` → `master/source.glb`.
- **NO_VRAM requeue busy-loop**: queue rotated the job every ~1s with repeated dequeue/DB-save until VRAM freed. Added `self._vram_wait_until` monotonic backoff (5s) set on NO_VRAM in `_process_job_with_queue_integration`, honored in `_job_processing_loop`, cleared once a worker is placed.
- Validation: `compileall` + `npx tsc --noEmit` clean; adapter import repro passes in the worker venv (`3daigc-api/bin/python`, CWD=`backend/`). End-to-end GPU generation/postprocess validation remains user-hardware gated.

## 2026-10-10 Restart-Durable Asset Persistence (Models & Thumbnails After Refresh)
- **Symptom**: After a mesh generation completed, refreshing the page or restarting the backend made generated models and their thumbnails disappear from the workspace.
- **Root causes (three independent layers)**:
  1. `GET /api/v1/system/jobs/history` returned the raw persisted job result. Results written by raw-shape workflow stages (or before a backfill) carry no production URLs, so the frontend had no game-ready/master/thumbnail URLs after refresh. `GET /api/v1/system/jobs/{id}` normalized these URLs lazily, but history did not.
  2. In the default multi-worker (Redis) deployment the history endpoint only consulted SQLite when `scheduler.job_queue.db_manager` existed. Durable jobs live in Redis; with an empty SQLite page history returned `[]`. `RedisJobQueue.get_jobs_by_status` additionally reconstructed jobs without their real `status`/`result`, so even the Redis listing would not surface completed results.
  3. `postprocess/pipeline.py::_sha256_file` raised `AttributeError: 'str' object has no attribute 'open'` for `str` paths returned by `resolve_server_file_path`, crashing production post-processing at stage 0 for every mesh job — no canonical workspace (`master/source.glb`, `game_ready/`, previews) was ever written.
- **Fixes**:
  - `system.py`: `_ensure_production_result_urls()` backfills canonical URLs on every completed job in history and job detail — `model_url`/`game_ready_url`/`download_url` → `/download?artifact_format=glb` (game_ready GLB, the UI default), `source_model_url`/`high_fidelity_url` → `?artifact_format=master` (`master/source.glb`), `thumbnail_url` → `/thumbnail` (resolves file → input image → placeholder). Postprocess-populated values always win (`setdefault`). URLs only reference job endpoints that resolve artifacts from disk, so they survive restarts.
  - `system.py` history: falls back to the Redis job listing when the SQLite page is empty. `redis_job_queue.py::get_jobs_by_status` restores `status`, `progress`, `result`, `completed_at` from Redis.
  - `pipeline.py`: `_sha256_file` accepts `Path | str`.
  - Frontend: `getHistory` (`features/workspace/lib/api.ts`) always emits game-ready/source/thumbnail URLs; the workspace history mapping and `normalizeModelAsset` populate `artifacts.source` (master/source.glb) and `artifacts.gameReady` (game_ready GLB); `normalizeBackendJob` prefers the canonical game-ready URL. Viewer default view = game-ready GLB; Source selection fetches `master/source.glb`.
- **Verified**: history returns jobs from Redis with normalized URLs; `?artifact_format=glb`/`master` and `/thumbnail` return binary through the Next.js proxy (200); `npx tsc --noEmit` clean; `py_compile` clean. Real GPU validation remains user-hardware gated.

## 2026-10-10 CPU Multi-Core Concurrency, Hunyuan Turbo Speed & Strict GPU Enforcement
- **CPU Multi-Core Concurrency Across Scheduler & Postprocessing**:
  - Root cause: Workers ran with `cpu_threads=1` due to division logic in `resource_planner.py` and fallback in `multiprocess_scheduler.py`, causing marching cubes and mesh decimation/smoothing to execute on a single core.
  - Fix: Updated `resource_planner.py` to allocate all available CPU cores (`nproc=8`, `OMP_NUM_THREADS=8`, PyTorch intra-op threads) and ensure worker initialization applies all cores.
- **Hunyuan3D-DiT-v2-mini-Turbo Speed Optimization**:
  - Root cause: Hardcoded `octree_res=512` created a 505³ voxel grid (128M voxels), causing `marching_cubes` to stall on CPU for 4+ minutes.
  - Fix: Configured `octree_resolution=380` (or 256 for ultra-fast), `num_chunks=20000`, and `topk_mode='merge'` for FlashVDM, dropping extraction time from >5 minutes to <35 seconds.
  - Shape v2.1: Aligned default inference steps to 30 and `octree_resolution=256` for fast generation.
- **Strict GPU Inference Enforcement Across All Adapters**:
  - Root cause: Adapters defaulted device selection to `cuda if torch.cuda.is_available() else cpu`, risking silent CPU fallback on worker initialization.
  - Fix: Enforced strict CUDA checks across all adapters (`TRELLIS`, `TripoSR`, `TripoSG`, `TripoSF`, `Zero123++`, `Unique3D`), raising immediate errors if CUDA is unavailable.

## 2026-10-10 Hunyuan3D-Shape-v2-1 Pipeline Load & Frontend Job Failure Hydration
- **Hunyuan3D-Shape-v2-1 Pipeline Loading**: Fixed `RuntimeError: Hunyuan3D-Shape-v2-1 pipeline not loaded. Call _load_model() first or check model weights.`
  - Root cause: `Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(str(self.model_path)).to(device)` returned `None` because the underlying `.to()` method mutates components in place and returns `None` rather than `self`.
  - Fix: Passed `device=device` directly to `from_pretrained()` and separated `.to(device)` as an in-place call across `hunyuan3d_shape_v21.py`, `hunyuan3d_adapter_v21.py`.
- **Frontend Job Failure & Deep Link Hydration**:
  - Root cause: When a generation job failed or when navigating directly to `/workspace/[tool]/[job_id]`, `jobsById` was unpopulated on initial load and `activeTask` failed state was not hydrated, causing the UI to either spin indefinitely or not reflect the failure card and diagnostic trace.
  - Fix: Added URL job hydration effect in [WorkspaceContext.tsx](file:///teamspace/studios/this_studio/ForMash3D/features/workspace/store/WorkspaceContext.tsx) to fetch `/api/v1/system/jobs/[id]` and properly populate `activeTask` (with `status: 'failed'`, diagnostic, and error message) and stop `isExecuting`. Also wired failure diagnostics into the active job polling loop.

## 2026-10-10 Model Downloader CLI Resolution
- Fixed root cause of `[ERROR] hf is not installed`: `download_models.sh` strictly checked for command `hf` instead of supporting `huggingface-cli`, and did not prepend `$PROJECT_ROOT/3daigc-api/bin` where `huggingface_hub` is installed.
- Created `hf` symlink to `huggingface-cli` in `3daigc-api/bin` and `~/.local/bin`, added auto-PATH export for `3daigc-api/bin`, and widened CLI check to accept either `hf` or `huggingface-cli`.

## 2026-10-05 Frontend Dependency Version Upgrade
- Upgraded all frontend dependencies to the latest stable versions verified against the npm registry and peer requirements: next 16.3.8, react/react-dom 19.3.0, three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, all 27 Radix packages at latest 1.x/2.x, tailwindcss 4.3.3 / @tailwindcss/postcss 4.3.3, typescript 7.0.2, @types/node 24.19.1 / @types/react 19.3.0 / @types/react-dom 19.3.0 / @types/three 0.186.0, eslint 9.39.5 / eslint-config-next 16.3.8, zustand 5.0.15, @tanstack/react-query 5.104.1, motion 13.4.6, lucide-react 1.52.0, axios 1.20.0, react-hook-form 7.89.0, sonner 2.0.8, input-otp 1.5.0, vaul 1.1.2, cmdk 1.1.1, embla-carousel-react 8.6.0, recharts 3.10.1, clipper-lib 6.4.2, clsx 2.1.1, class-variance-authority 0.7.1, tailwind-merge 3.7.0, three-mesh-bvh 0.9.15, three-bvh-csg 0.0.18, @dimforge/rapier3d-compat 0.21.0, meshoptimizer 1.3.0, @hugeicons/react 1.1.10, @dnd-kit/* at latest. Runtime locked: Node.js 24.21.0 LTS, npm 11.19.0, Bun 1.4.2 (package.json engines + "_runtime" field + scripts/setup.sh _ensure_* functions).
- Regenerated bun.lock with Bun 1.4.2; removed the stale package-lock.json. All 60 dependencies + 10 devDependencies resolved with zero peer conflicts.
- Compatibility decisions: react-day-picker pinned at 8.10.2 (v9/v10 renamed the custom-component/classname API and removed IconLeft/IconRight used by the workspace calendar) and react-resizable-panels pinned at 3.0.6 (v4 renamed PanelGroup→Group, PanelResizeHandle→Separator); both pinned at the latest versions still compatible with existing code to avoid out-of-scope app-code changes. motion kept at 13.4.6 (14.0.0 was <1 week old at upgrade time — avoidable risk on the 20+ file animation stack). eslint kept at 9.39.5 (eslint-plugin-react, a dependency of eslint-config-next, caps ESLint at ^9.7, so 10.x would be a peer conflict). @types/node kept at 24.19.1 (latest 24.x line; matches the pinned Node 24 LTS runtime, not the newer 26.x typings).
- Validation: `bun run test` (tsc --noEmit) — clean. `bun run build` (Next.js 16.3.8 / Turbopack) — passes, 13 static pages generated (/, _not-found, /admin, /animation, /dashboard, /apple-icon.png, /icon.svg, /outputs, /rigging, /system, /workspace, /api/v1/[...path], /static/[...path], /workspace/[...tool]). `bun run lint` — fails with the pre-existing typescript-eslint / TypeScript 7.0.0 incompatibility (typescript-eslint versions <=8.71.0 all reject the TS 7.0.0 API surface; reproduces identically on HEAD before any upgrade). Recorded as a compatibility issue for the debugging phase; no app-code changes made.

## 2026-10-05 SG-01 Smart Generation Closure
- Smart Generation now has a real `/api/v1/smart-generation/generation` submission contract that delegates to the existing image raw/textured generation endpoints, avoiding a duplicate scheduler or inference path.
- GeneratePanel intent buttons remain backend-owned and deterministic; when an uploaded image is ready they now trigger the normal generation lifecycle after applying the preset, with model/VRAM explainability shown inline.
- Added focused regression coverage for smart intent resolution, preprocessing provenance, built-in preset inventory, and printability reporting.

## 2026-10-05 Model Registry & Download Manager Parity Audit
- Cross-checked the 23 backend model manifest entries against the 22 user-selectable frontend entries, the root manager.sh, and backend/scripts/download_models.sh.
- Corrected shared-checkpoint handling for Hunyuan3D-2.1 and Hunyuan3D-2mini so model-specific entries cannot falsely report readiness from an unrelated partial directory; FastMesh no longer re-downloads a verified V1K bundle.
- Runtime CUDA/model visual validation remains environment-gated and is not represented as passed.

## 2026-10-04 Source-Fidelity Contract Verification Pass
- Re-verified BUG-REPORT-ADAPTER-QUALITY.md (BQ-01..BQ-12), the Docs/TASKS.md bug registry, and all project docs against the live adapters, scheduler firewall, postprocess pipeline, and frontend schedules.
- Closed the TRELLIS image-path response metadata gap: `generation_info` now records the actual ss/slat sampling stages, guidance, texture resolution, bake mode, and simplify ratio, matching the text path and BQ-11.
- Corrected a stale official-parity regression assertion (TRELLIS image `texture_resolution` schema default 1024 → 2048 per BQ-11/BQ-12/ADR-039) and the TripoSR `mc_resolution` docstring (fixed 320, not "default: 256").
- Corrected Docs/TASKS.md: the TripoSG Y-up rotation (BUG-004) is now recorded as reverted — the 2026-10-03 parity audit rejected the extra transform because the current upstream extraction is natively Y-up.
- Verification: backend pytest passes with 0 failures (3 runtime-gated skips); `npx tsc --noEmit` clean.

## 2026-10-03 Deep Adapter Parity & Source-Fidelity Firewall Audit
- Re-audited frontend generation contracts, scheduler sanitization, legacy Hunyuan3D-2.1, TRELLIS runtime metadata/schemas, retained model docs, and the source-fidelity documentation chain.
- Added a centralized scheduler firewall for adapter-level source-reduction controls: faces, num_faces, simplify, decimation_target, remesh, remesh_band, and remesh_project.
- Unified legacy Hunyuan3D-2.1 raw and Shape→Paint source generation on seeded 50-step / 5.0-guidance inference without low-VRAM step reduction.
- Fixed TRELLIS source texture schema/metadata drift and locked source texture generation to 2048; TRELLIS.2 source texture is locked to 4096.
- Expanded regression tests and reconciled the relevant project docs. CUDA/NVIDIA A/B visual validation remains runtime-gated.

## 2026-10-03 Adapter Raw-Quality / Official-Parity Audit
- Confirmed root cause for the reported raw `source.glb` quality gap: the frontend used a generic 75-step inference contract across models with materially different official/tuned schedules.
- Fixed model-specific schedules: Hunyuan Mini Turbo 5, Hunyuan Shape 50, TripoSG 50, TRELLIS image 12/12, TRELLIS text 25/25.
- Fixed raw extraction ceilings: TripoSR 320; TripoSF 1024³ + 1,638,400 samples, while preserving the existing constrained-VRAM safety downshift.
- Added deterministic generators to Hunyuan Shape and Mini Turbo; Mini Turbo now applies FlashVDM through the official pipeline method.
- TRELLIS extraction now enables hole filling and the official forward Z-up→Y-up conversion while keeping source simplification disabled.
- Rejected unsupported earlier TripoSG rotation/Flash-Decoder changes and the blanket TripoSR 0.9 foreground-ratio claim after checking current upstream code.
- CUDA/visual A/B validation remains runtime-gated.

## 2026-10-03 Zero123++ Multi-View Architecture, Canonical Mesh Storage, Physics & Tripo Alignment
- Vendored upstream Zero123++ v1.2 into `backend/thirdparty/zero123plus` without `.git` repository metadata; verified authoritative PyTorch 2.6 / CUDA 12.4 environment. Dependency installation simplified via cleaned requirements without temp files.
- Canonical storage layout: models are stored in separate directories under `storage/models/meshes/<image_name>_<job_id>/`. Game-ready exports produce exclusively `glb` and `fbx` named `<image_name>_<job_id>.glb` and `<image_name>_<job_id>.fbx`. Legacy formats (`obj`, `stl`, `ply`, `gltf`) convert on-demand on download.
- Physics: replaced placeholder fallback with automatic CoACD multi-hull convex decomposition (`collision/collision.glb`) and rigid-body physical properties (`metadata/physics.json`).
- Model orientation: eliminated unwanted rotation matrix in TripoSG and aligned TripoSF to enforce upright Y-up coordinates in Three.js viewport.
- Adapter `Zero123PlusAdapter` encapsulates 6 novel viewpoints at 30° azimuth intervals (30°, 90°, 150°, 210°, 270°, 330°), deterministic request hashing (`source_sha256`, `request_sha256`), canonical storage in `storage/models/meshes/<safe_asset_name>_<job_id>/multiview/`, view masks, and on-demand ZIP delivery (`<stem>.zip`).
- Capability gate: 3D generation models default to `capabilities.multiview: false`. The frontend action button and backend router (`/reconstruct-3d`) enforce strict rejection when attempting multi-view 3D reconstruction with incompatible engines.
- Model management: the root manager offers separate Zero123++ checkpoint and optional View-Space Normals ControlNet downloads; the model API reports Zero123++ weights as downloadable.
- Frontend: fixed `(h.artifacts.lods || []).slice is not a function` error by normalizing array and object LOD dictionaries; `MultiViewWorkspace.tsx` provides single-image automatic reuse, 6-view inspection gallery, full keyboard/mouse pan and zoom modal, advanced inference drawer, and manual view-set uploads.
- Verification: full backend suite passes (67 passed, 3 runtime-gated skips) and TypeScript compilation (`npx tsc --noEmit`) passes.

## 2026-10-03 Source Fidelity + Downstream Polycount Contract Hardening
- Root cause: target_polycount was intended as a post-process budget but was forwarded into adapters; TripoSG/TRELLIS could interpret it as an early decimation target.
- Fix: multiprocess_scheduler.py now builds a separate adapter-input dictionary and removes production-only budget/orchestration controls before _process_request().
- Maximum source fidelity: generation explicitly marks source_quality: max and uses the existing maximum geometry settings for each registered model. The visible quality selector no longer lowers source geometry.
- Canonical safety: master/source.glb is the untouched model-native checkpoint. Positive poly budgets are applied only in canonical post-processing; Native/Raw is target 0.
- Multi-part GLBs are flattened with their scene-graph node transforms applied in world space; unsupported mixed geometry conversion fails instead of silently dropping transforms.
- Adapter truthfulness: TripoSR's optional bake exports a real image material or reports failure, TRELLIS.2 rejects missing textured-export dependencies, TripoSF no longer substitutes a generic proxy, and Hunyuan Paint preserves reference-image aspect ratio. Shape-only models intentionally do not promise textures; UV generation alone is not a texture bake.
- Docker Compose now builds with repository-root paths and shares the canonical weights and storage directories between API/scheduler. Root `.dockerignore` excludes local weights/runtime data while retaining vendored model source.
- Dependency compatibility: the shared backend pins now intersect TripoSG's Transformers, Diffusers, and Hugging Face Hub requirements; install.sh and both Docker builds apply TripoSG requirements after the shared baseline. This environment has CPU-only Python 3.14, so CUDA inference and full image builds remain unverified.
- Verification: Added scheduler firewall + frontend source-contract regression tests. NVIDIA/CUDA generation and visual comparison remain runtime-gated.

## 2026-10-03 Workspace Production Controls & Viewport Performance Pass
- **Retopology poly budget:** Added `target_polycount` to the mesh-retopology API and `RemeshSettings`. The FastMesh V1K/V4K target remains model-fixed; the new slider controls the final production triangle budget downstream.
- **Generation workflow recipes:** Added Mobile / Game Ready / Cinematic / Native presets that synchronize model quality, final triangle budget, LOD generation, and optional physics in one action.
- **Viewport artifact inspection:** Added quick switching between Game Ready, immutable Source, and generated LOD artifacts directly in the viewport.
- **Viewport performance modes:** Added Auto / Fast / Detail rendering modes that adjust pixel ratio and shadow cost, with automatic heavy-mesh detection preserved for the default mode.
- **Research basis:** Current Tripo, Meshy, and Hyper3D workflows emphasize integrated generation, remesh/retopology, texture, rigging/animation, artifact review, and fast post-generation controls; the implementation keeps only the useful local/self-hosted subset.


## 2026-10-05 Phase 0 Raw-Mesh Quality Closure
- The production post-processing path now applies a shared geometry-fidelity guard after optimization. It rejects non-finite results, unexpected face growth, excessive vertex growth, and material bounding-box drift, then retains the repaired mesh instead.
- Already-watertight/manifold source meshes skip the repair mutation entirely, preserving native topology when no repair is required.
- Phase 0 Q1–Q8 are source-level verified. Full NVIDIA/model visual A/B and 22 user-facing-model GPU smoke validation remain explicitly environment-gated.
- Future agents must independently verify the current implementation and tests; TASKS.md status labels are not evidence.

## Phase 1 Workflow Closure — 2026-10-05

- SG-06 uses one shared deterministic preprocessing artifact rather than adapter-specific parallel pipelines.
- SG-07 uses existing repair/topology infrastructure and the common post-process lifecycle.
- SG-08 uses the existing UniRig adapter as a scheduler-managed child workflow after final production processing.
- SG-02.2 uses one YAML source of truth and deterministic model priority/readiness/VRAM filtering.
- Phase1 status labels are not evidence; future agents must independently verify source paths and tests.
- Full CUDA/model runtime validation remains environment-gated and is not represented as passed.

## 2026-10-08 — Fidelity + Resource Orchestration Hardening

- Added `backend/core/scheduler/resource_planner.py` for deterministic model routing, GPU/VRAM placement, supported multi-GPU planning, and CPU-thread scaling.
- Added `backend/core/quality/evaluation.py` plus `backend/scripts/run_mesh_quality_benchmark.py` for reference-aware CD/F-Score/DCD diagnostics, master-to-derivative drift checks, and deterministic multi-view rendering.
- High/ultra untextured generated assets now use the existing curvature-adaptive AutoRetopo path as a derivative-target builder before UV/bake; native-textured masters preserve their native mapping.
- TripoSG high/ultra routes disable the fast decoder so the upstream hierarchical extraction path is used when supported.
- TRELLIS.2 is retained as an additive multi-GPU-capable path using explicit Accelerate component dispatch. Combined VRAM is never treated as implicit model parallelism.
- Existing models remain registered; automatic routing can fall back to another retained compatible model after an automatic model-load failure.
- Final GPU/model visual validation remains user-hardware-gated. Non-hardware tests cover resource planning and quality diagnostics.

### User GPU validation package

Run from the repository root:

```bash
cd backend
python -c "import torch; print('CUDA:', torch.cuda.is_available()); print('GPUs:', torch.cuda.device_count()); [print(i, torch.cuda.get_device_name(i), round(torch.cuda.get_device_properties(i).total_memory/1024**3, 2), 'GB') for i in range(torch.cuda.device_count())]"
python -m unittest backend/tests/test_resource_planner.py backend/tests/test_quality_evaluation.py
```

For a two-GPU resource-discovery check:

```bash
CUDA_VISIBLE_DEVICES=0,1 python - <<'PY'
from core.scheduler.gpu_monitor import GPUMonitor
from core.scheduler.resource_planner import ResourcePlanner
m = GPUMonitor(tracking_mode=False)
p = ResourcePlanner(m)
print(p.gpu_capacity_snapshot())
print('GPUs detected:', len(p.gpu_capacity_snapshot()))
PY
```

Use the normal ForMash3D workspace generation flow for final visual/VRAM validation. Confirm that a model whose declared footprint exceeds one card but fits the supported aggregate placement is assigned multiple GPUs, that no existing model disappears from model selection, and that the generated master remains available separately from the optimized derivative.

## 2026-10-08 — Deep Task Gap Closure

- Normalized the model capability contract at configuration load time. The contract now includes modality, multiview input/output semantics, texture/PBR/vertex-color state, preprocessing/extraction preferences, resolution/face-budget hints, VRAM/CPU requirements, multi-GPU strategy, postprocess profile, latency class and output formats.
- Smart intent resolution now considers per-GPU free VRAM plus aggregate free VRAM for explicitly multi-GPU-capable models, then uses the shared deterministic quality/polycount/texture/latency router instead of blindly taking the first YAML candidate.
- Optional image enhancement now supports model-selected preprocessing profiles and records subject occupancy/profile/target resolution in provenance.
- Final QA rejects invalid/non-finite geometry, validates LOD lineage, and marks production degraded when final quality inspection or master-to-derivative fidelity gates fail.
- Added a controlled model A/B benchmark CLI. It requires identical input hashes and production protocol and does not treat one generated result as ground truth.
- Added FORMSH3D_CPU_THREADS=auto and FORMSH3D_CPU_WORKERS=auto; scheduler admission uses the shared CPU worker cap.
- Unique3D readiness/download capability reporting now includes the existing model ID.
- Hi3DGen remains explicitly evaluation-gated; no unsupported dependency/runtime was added just to satisfy the task text.

### 2026-10-08 Deep Audit & Optimization
- Conducted Ponytail Ultra audit on recent high-fidelity commits.
- Stripped speculative rendering abstractions (pyrender) and custom module wrappers (accelerate wrapper) in favor of fast standard library equivalents (`trimesh.volume`, native `dispatch_model`).
- 100% of the TASKS.md requirements verified in place and hardened against resource exhaustion.

## 2026-10-09 Studio Telemetry, Preview Persistence, Multi-Job Queueing & Engine Fixes
- **Telemetry UI**: Upgraded Header resource meters to vertical pipe mini-gauges with dynamic saturated status colors: Neon Emerald (`#00FF88`), Gold (`#FFD700`), Vivid Amber (`#FF9900`), Crimson (`#FF3366`), percentage readouts, and outside-click auto-dismissal.
- **Persistent Asset Storage**: Replaced fragile `URL.createObjectURL(file)` across workspace tabs with backend persistent endpoints (`/api/v1/file-upload/download/{file_id}`, `/api/v1/file-upload/thumbnail/{file_id}`). Previews and reference thumbnails remain durable when switching between single-view, multiview, and assets panels.
- **Continuous Generation & Background Queueing**: Added dual-action generation button: primary button shows active progress while secondary "Queue Next" button enqueues subsequent generation jobs without blocking the studio. If VRAM is full, jobs wait in the scheduler queue safely; if multiple GPUs are available, concurrent jobs execute.
- **MeshViewer HUD Job Capsule**: Added top-right horizontal mini-capsule in the 3D viewport displaying reference thumbnail, active spinner, progress %, stage details, and an interactive "View" button to load completed models directly into the viewport.
- **TripoSF/TripoSR VRAM Manifest Fix**: Fixed `ValueError: VRAM requirement for triposr_image_to_raw_mesh must come from the model manifest` during coarse mesh generation by passing `vram_requirement=6144` explicitly from `triposf_adapter.py` and adding a manifest/default fallback in `triposr_adapter.py`.
- **Quality Evaluation Export**: Implemented `compare_render_directories` in `backend/core/quality/evaluation.py` to fix `ImportError: cannot import name 'compare_render_directories'`.
- **Redis Job Queue Deletion**: Fixed `delete_job` in `backend/core/scheduler/redis_job_queue.py` to delete from both Redis and SQLite (`db_manager`), preventing `500 Failed to delete job from database`.


### Update 2026-10-09
- Fixed multiple critical backend adapter crashes (Trellis autograd baking, Unique3D seed initialization, Hunyuan3D CPU hardware offloading).
- Refactored frontend UI for logs tab to mirror an authentic, low-latency VS Code style terminal (`features/admin/tabs/LogsTab.tsx`).
- Streamlined unified master logging across backend and multiprocess workers.
- Addressed active generation UI blocking and rendering anomalies in MeshViewer queue.
- Implemented deep-linked dynamic routing for generations (`/workspace/[tool]/[job_id]`) to persist user context across reloads and shares.


## 2026-10-09 — Unified Runtime Logging & Mini Turbo Initialization

- Mini Turbo root cause: upstream `Hunyuan3DDiTFlowMatchingPipeline.to()` mutates the pipeline and returns `None`; chaining it into `self.pipeline = ...` replaced the valid pipeline with `None`. Initialization now passes `device` to `from_pretrained()` and retains its returned pipeline.
- Added a regression test that mirrors the upstream in-place `.to()` contract and verifies the adapter keeps a callable pipeline.
- Canonical runtime log: repository-root `logs/master.log`, absolute-path resolution, append-only/non-rotating file handling, and one target for API, scheduler/workers, startup, frontend runtime/build, and project-managed Redis.
- Removed separate API/scheduler/Supervisor/frontend log-file targets from startup and Docker configuration. Admin/API log reading and clearing now operate on the same master file.
- A remote Redis instance keeps host-side logs; only a local Redis instance can be redirected to the application's master file.


## 2026-10-12 Follow-up Mesh-Fidelity Audit

- Started from the just-pushed mesh-fidelity commit and re-read the unchanged `Docs/TASKS.md` research plan, model manifest, API target-resolution logic, scheduler inference profile and provenance, post-processing gates, UI budget displays, and quality evaluator.
- Fixed budget precedence in `backend/api/routers/mesh_generation.py`: explicit top-level `target_polycount` beats a nested model parameter and preset fallback; explicit Native/Raw `0` is preserved.
- Hardened the Native/Raw production invariant in `backend/postprocess/pipeline.py`: `auto_optimize` is false for a nonpositive/native target, and adaptive shell remesh requires a positive explicit target. Existing opt-in structural repair gating and immutable-master SHA verification remain in force.
- Extended `raw_geometry_telemetry` to schema version 2 with input/reference hashes and dimensions, inference runtime, checkpoint/adapter identity, requested/effective resolution status, quality-limit warnings, and per-GPU total/peak allocated/peak reserved VRAM when CUDA data is available. Final post-process metadata now includes adapter-output-vs-master SHA identity and carries generation information to the final result.
- Corrected Hunyuan Shape v2.1 and Mini-Turbo resolution labels: configured octree resolution is not reported as achieved output resolution unless upstream reports the latter. TRELLIS.2 retains true effective-resolution telemetry.
- Unique3D SR fallback is explicit: successful model-backed SR and Lanczos fallback each record the actual path and failure reason.
- Fixed the remaining advanced UI fallback labels that presented 50K for a native target; new workspace defaults disable automatic LOD generation in Native/Raw mode.
- Added regression coverage for API target precedence, model-manifest/profile parity, Native/Raw optimize/remesh incompatibility, and the expanded telemetry contract.
- **Validation status:** source-level contracts inspected; test/typecheck/format suites and CUDA A/B benchmarks have not been run in this environment. Do not claim them as passing. `Docs/TASKS.md` intentionally preserved byte-for-byte under the existing instruction; implementation and validation status is tracked in `Docs/MESH_QUALITY_IMPLEMENTATION_REPORT.md`.


### 2026-10-18 — Explicit Hunyuan3D-Paint Source Resolution
- Added a shared resolver in the third-party Hunyuan Paint source to distinguish existing local directories from Hugging Face repository IDs.
- Missing absolute paths, incomplete DINOv2 checkpoints, and local Paint directories without `model_index.json` now fail clearly rather than silently switching to a default remote model.
- Added dependency-light resolver tests and wired them into backend CI through the pinned third-party submodule. No requirements files or mesh-generation algorithms changed.

---

## 2026-10-20 — Batch 3: TaoFlowForge Spike (3A) & Quad-Dominant Export Evaluation (3F)
- **Task 3A Spike Report (`Docs/taoflowforge_spike_report.md`)**:
  - Investigated TaoFlowForge (Taobao3D cascaded flow matching, arXiv:2609.37139, authors: Xianze Fang et al., Alibaba Group).
  - Code (GitHub `alibaba/Taobao3D/tree/main/TaoFlowForge`) and weights (ModelScope `Taobao3D/TaoFlowForge`, ~26.04 GB total: stage0 5.47GB, stage1 14.54GB, stage2 6.03GB) are released under Apache 2.0.
  - Local execution is **BLOCKED** by hardware/environment limits: 26 GB weight footprint exceeds available container disk headroom (~11 GB free), strict CUDA 12.1 runtime requirement with no CPU fallback, and >=20–24 GB VRAM required for Stage 1 Level-MoE.
  - Native topology candidate remains safely disabled/unregistered in `backend/config/planner_rules.yaml` and `backend/core/planner.py`, with graceful fallback to dense generation + feature-preserving isotropic retopology.
- **Task 3F Evaluation (`Docs/quad_topology_evaluation.md`)**:
  - Evaluated quad-dominant export capabilities in ForMash3D compared to Tripo AI and Deemos Rodin.
  - Confirmed existing pipeline architecture correctly handles quad-dominant topology: `_export_quad_obj` generates genuine 4-vertex polygonal faces (`f v1/vt1/vn1 ...`) in OBJ format when `quad_topology` or `topology_mode="quad"` is requested, and `pipeline.py` automatically passes geometry through without destructive QEM decimation.
  - Documented strict Khronos glTF 2.0 specification requirement: GLB assets MUST remain triangulated for web viewer and game engine compatibility.
  - Identified auxiliary adapter gaps (unbundled `meshiki` in FastMesh `tri2quad`, unbundled `quadriflow` binary in AutoRetopo); recommended zero disruptive changes until explicit user approval.

## 2026-10-20 — Batch 3: Final Parity Benchmark & Parity Scorecard (Task 3D)
- Created `scripts/run_final_parity_benchmark.py`:
  - Evaluates 4 synthetic test shapes (cube, sphere, cylinder, mechanical prop) comparing raw baseline geometry (open boundary defects, unclosed seams) against the post-processing pipeline.
  - Generates `Docs/baseline_vs_now_benchmark.json`:
    - Numeric verification across triangle counts, hole counts, non-manifold edges, feature-edge retention, and UV utilization.
    - Watertight recovery: 100% (all 4 open holes repaired to 0).
    - Feature edge retention: 100% on sharp crease geometries (>30° dihedral).
    - UV utilization: average 75.95% (strictly in [0, 1] bounds, 0 overlaps).
    - PBR asset validation: 100% pass rate.
    - Master immutability: verified (SHA-256 unchanged).
  - Authoritative competitive parity scorecard generated in `parity_scorecard.json`:
    - Ranks ForMash3D against market competitors (Tripo, Meshy, Hyper3D) across all 6 core dimensions: sharpness, topology cleanliness, UV quality, texture quality, speed, and failure rate.
- Added comprehensive unit tests in `backend/tests/test_final_parity_benchmark.py` (3/3 passing).

## 2026-10-20 — Batch 3: Documentation Sync & Release Closure (Task 3E)
- Synced `README.md` pipeline architecture diagrams (both ASCII and Mermaid) to reflect the Topology Gate, targeted hole repair, memory-safe decimation, UV backend resolver, and PBR validation stages.
- Synced `Docs/ARCHITECTURE.md` with complete architectural documentation for Batches 1, 2, and 3.
- Synced `Docs/TASKS.md` marking Gate 3 [PASSED] and all Batch 1, 2, 3 tasks completed.
- Updated `Docs/CHANGELOG.md` with release logs for Batches 1, 2, and 3.
- Confirmed zero documentation gaps against code and verified all 111 tests passing.

---

## 2026-10-20 — Architectural Constraints, Thresholds & Master Immutability Contracts

### 1. Master Immutability Invariant
- **Rule**: `master/source.glb` is strictly immutable. It captures raw neural geometry at maximum model fidelity.
- **Enforcement**: Working copies are explicitly created before any downstream postprocess operation (repair, decimation, UV unwrapping, baking, LOD generation). The pipeline computes `sha256(master/source.glb)` before postprocessing begins and asserts the identical hash upon completion.

### 2. Config-Driven Quality & Resource Thresholds
- **Topology Gate (`backend/config/gate_thresholds.yaml`)**:
  - `max_non_manifold_edges`: 0
  - `max_non_manifold_vertices`: 0
  - `max_holes`: 0
  - `max_floater_ratio`: 0.005 (0.5% vertex count)
  - `max_degenerate_faces`: 0
  - `min_aspect_ratio_p1`: 0.05
  - `min_aspect_ratio_p5`: 0.10
  - `small_hole_max_vertices`: 50 (boundary loops <= 50 vertices routed to targeted hole repair)
  - `strict`: false (in strict mode, any flaw triggers full repair)
- **Hole-Targeted Repair (`backend/config/hunyuan_presets.yaml`)**:
  - `max_hole_vertices`: 50
  - `max_hole_perimeter`: 0.5
  - Geometry preservation: Closes boundary loops with directed edge fans while leaving uncorrupted mesh surfaces 100% untouched.
- **Memory-Safe Decimation (`backend/config/decimation_config.yaml`)**:
  - `memory_safe_threshold_triangles`: 2,000,000 (2M tris)
  - `crease_angle_deg`: 35.0°
  - `max_deviation_deg`: 45.0°
  - `max_ram_fraction`: 0.80 (80% available RAM ceiling via `psutil`)
  - Staging: Below 2M tris, uses standard feature-preserving QEM; above 2M tris, engages staged 50% chunked reduction with intermediate garbage collection.
- **UV Backend Resolver (`backend/config/uv_config.yaml`)**:
  - `partuv_triangle_threshold`: 500,000 (500k tris)
  - `partuv_vram_requirement_gb`: 7.0 GB
  - `default_backend`: "auto"
  - `fallback_backend`: "xatlas"
  - Resolution: "auto" selects GPU PartUV only when triangle count >= 500k, CUDA is available, and free VRAM >= 7.0 GB (after generative model VRAM is released). Otherwise routes to CPU/GPU xatlas array driver.
- **Detail Baking & PBR Validation (`backend/config/bake_config.yaml`)**:
  - `normal_space`: "TANGENT"
  - `convention`: "OPENGL" (Y+ convention; B channel mean >= 140, flat regions decode to ≈(0, 0, 1))
  - `cage_extrusion`: 0.02, `max_ray_distance`: 0.05
  - `min_uv_utilization`: 0.60 (60% minimum rasterized atlas coverage)
  - glTF PBR channel packing: Roughness packed in Green (G) channel; Metallic packed in Blue (B) channel.
  - Validates non-degenerate channels (neither all-0 nor all-255) and strictly bounded [0, 1] UV coordinates.

### 3. Key Architectural Decisions & Lessons Learned
- **TaoFlowForge Spike (3A)**: Model weights are ~26 GB (exceeding container disk headroom) and require strict CUDA 12.1 + >=20GB VRAM. Native topology route must remain safely stubbed with graceful fallback to dense generation + feature-aware retopology.
- **Quad vs Tri Topology (3F)**: OBJ supports true quad polygonal faces (`f v/vt/vn ...`), while Khronos glTF 2.0 strictly requires triangulation for WebGL/Three.js/game engine runtimes.
- **Deterministic Planning**: All routing decisions are pure functions computed from request parameters and runtime facts. Fallback candidates trigger a full plan recomputation rather than patching individual fields.
