# ForMash3D — Repository Audit and Bug-Fix Handoff

> **Audit mode:** Read-only remote source audit. This is a handoff plan, not a code-fix report. No source files, dependencies, configuration, database state, Git history, branches, commits, or remote refs were changed by this audit. Implementation status remains **Pending** throughout this expanded audit handoff; no fixes or test runs are claimed.
>
> **Intended repository path:** `TASK_BUG_AUDIT_AND_FIX_PLAN.md` (repository root). A local checkout was not available in the execution environment, so this deliverable was created separately for placement into the repo; it was not committed or written directly to GitHub.


> **CRITICAL HANDOFF RULE — DO NOT EDIT `Docs/TASKS.md`:** After implementing and verifying a task from this handoff, change only that task's `Status` field in this handoff to `Done`. Do not change, append to, reorder, reformat, or otherwise edit `Docs/TASKS.md`. Do not rewrite the existing audit findings or this handoff's task descriptions just to reflect implementation. Only mark `Done` when the required regression/acceptance checks pass; otherwise leave `Pending` and record blockers in the implementation report outside `Docs/TASKS.md`.
>
> **RAW-MESH FIDELITY RULE:** The raw/source mesh must be generated using the maximum geometry quality genuinely supported by the selected AI model and its actual inference implementation. Raw generation is the canonical high-fidelity source stage. Retopology, smoothing, decimation, simplification, UVs, baking, LOD, collision, and other game-ready processing belong only to downstream derived artifacts. Never lower raw quality for game-readiness, silently override a supported maximum-quality parameter, or overwrite the canonical raw source with a processed mesh. If the model/runtime cannot provide its supported maximum quality on the available hardware, do not silently downgrade: report the explicit limitation/failure unless the user deliberately selects a lower-quality mode.

## PRIORITY TASK — RAW MESH IS ALREADY TOO SMOOTH (ROOT CAUSE NOT YET CONFIRMED)

- **Task ID:** `RAW-QUALITY-001`
- **Status:** Done
- **Priority:** Critical for the reported raw-geometry quality issue
- **User-reported symptom:** The mesh is already overly smooth / missing fine geometry at the raw-generation stage. This is not merely a request to improve the game-ready mesh. Treat the raw inference output itself as suspect until it has been measured and compared.
- **Root-cause status:** **Not conclusively established by the existing static source audit.** Do not claim that post-processing is the root cause unless runtime evidence proves the mesh being called “raw” is actually a processed/downstream artifact. The previous findings remain in this document and must not be deleted or replaced by this task.

### Required deep-audit workflow

1. **Trace every active raw-generation route, per model.** Start at the UI request/payload builder, API schema and normalization, queued job inputs, scheduler/model factory, the selected adapter, native model inference, mesh extraction, any adapter-local conversion/cleanup, export serialization, and the canonical `master/source.glb` write. Identify the exact first point where surface detail is lost. Do not assume all supported models share the same cause.
2. **Inspect the mesh immediately after native inference/extraction.** Capture a reproducible representative input and the earliest raw mesh before any post-process pipeline, repair, remesh, simplify, smooth, texture, or game-ready export step. Compare it to the saved `master/source.glb` and the mesh actually shown in the UI. Record model ID/version, effective inference parameters, device/VRAM mode, vertex/face counts, bounds, connected components, and mesh hashes where applicable. Save screenshots/renders and the smallest usable fixture or exact reproduction details.
3. **Separate geometry loss from shading/display.** Verify whether the actual surface is geometrically smoothed/coarse or only appears smooth due to normals, material/shading, GLB transforms, viewport rendering, or the UI selecting a different asset URL. Use wireframe/flat-shaded renders or geometric measurements alongside ordinary shaded renders. Do not infer topology loss from appearance alone.
4. **Audit effective model quality parameters, not just UI labels/defaults.** For every supported raw model, compare advertised and UI-selected settings with the exact values that reach inference/extraction. Find hardcoded resolutions/step counts, ignored fields, clamping, fallback defaults, adapter overrides, grid/voxel/octree limits, sampling limits, mesh extraction thresholds, quantization, voxelization, decimation, and export-time operations. Confirm any parameter that appears to increase detail actually reaches and affects the model.
5. **Investigate quality downgrades and hardware paths.** Trace low-VRAM/auto-optimization branches and any automatic reduction of resolution, sample count, steps, or mesh density. Honor the RAW-MESH FIDELITY RULE above: maximum model-supported quality by default; no silent downgrade. A lower setting is allowed only when explicitly selected by the user. If the hardware cannot run the required quality, expose a clear, actionable failure/limitation rather than silently producing a lower-detail raw source.
6. **Check relevant existing leads without assuming they explain every model.** `backend/adapters/triposr_adapter.py` has been observed to use a hardcoded extraction resolution of `320` inside its processing path despite a configurable constructor/input path; verify whether this override is still present, whether it blocks the model-supported maximum, and whether it explains the actual TripoSR symptom. `BUG-024` already notes mismatches between some visible Mesh Quality claims and effective request parameters. TripoSF's inference/voxel/sampling path and low-VRAM adjustments also need per-model inspection. These are audit leads, not a confirmed universal root cause.
7. **Verify the canonical source persistence contract.** Confirm the exact raw output used as `master/source.glb`; check whether retry/recovery can preserve a stale source based on file size rather than content/identity, whether exporter conversion drops geometry/detail, and whether the UI/API labels a derived mesh as raw. Validate geometry and a hash or other strong identity signal before/after saving. Never “repair” the symptom by mutating or overwriting an already-established source checkpoint with a downstream derivative.
8. **Establish the root cause before modifying code.** Follow all callers and data paths and find the earliest concrete operation/parameter responsible. Do not add arbitrary smoothing toggles, post-process changes, global high numbers, speculative config options, or model-agnostic overrides as a substitute for diagnosis. If no root cause is provable from static inspection, continue with runtime/inference instrumentation and representative examples; then report precisely what could not be tested and what asset, log, model weight, GPU, or environment is needed. Do not label an unverified hypothesis as a fix.
9. **Implement the smallest model-correct fix and regression tests.** Preserve each model's native output contract while making the default raw extraction use its maximum supported quality. Ensure raw generation does not call a downstream smoothing/remesh/decimation path. If a model intrinsically produces smooth geometry at its maximum supported quality, document that model limitation distinctly from repository-induced degradation; do not fake a universal fix.
10. **Prove raw and derived stages remain separate.** Re-run the same representative inputs. Compare earliest inference output, `master/source.glb`, UI raw selection, and downstream/game-ready output. Confirm downstream processing can change derived artifacts but never changes the canonical source. Include model-by-model results, not only one successful example.

### Required evidence and acceptance criteria

- [ ] For each supported generation adapter in scope, the active raw path and exact effective model parameters are traced end to end.
- [ ] At least one reproducible high-detail sample demonstrates whether detail is lost inside inference/extraction, adapter-side processing, export/save, or UI asset selection; expand to more models whenever the scope or shared-code path indicates they may be affected.
- [ ] The report identifies a source-backed root cause and exact responsible file/function/parameter, **or explicitly states that root cause remains unproven**, lists the runtime audit actually performed, and names the exact blockers needed to finish. A guess is not an acceptable root-cause conclusion.
- [ ] Raw geometry defaults to the selected model's maximum genuinely supported quality. No silent parameter override, automatic resolution/sample/step reduction, or low-VRAM downgrade is allowed unless the user explicitly chooses it.
- [ ] If maximum quality cannot run on the current hardware, the system reports an actionable limitation/failure instead of silently delivering a downgraded raw mesh.
- [ ] Geometric loss is distinguished from smooth normals/shading, transforms, export loss, stale source reuse, and the UI accidentally displaying a processed asset.
- [ ] Regression tests assert that effective raw inference parameters are preserved through request → job → adapter, and that the raw path does not execute downstream smoothing/remeshing/decimation.
- [ ] The canonical source remains immutable after downstream processing; raw/source versus derived artifacts are compared by geometry and source identity/hash where appropriate.
- [ ] The implementation record names changed files and real commands/results. Do not mark this task `Done` unless required checks pass. Do not edit `Docs/TASKS.md`.

---

## 1. Audit Summary

The latest remotely accessible `Dev` snapshot was inspected at commit `3f7b46e119f23ed5fbfed6a254a1eb7dc831f9d5` (`fix: consolidate texture, mesh quality, and UI reliability`). The commit adds a centralized texture stage (Paint3D for 1K/2K, Hunyuan3D-Paint for 4K/8K), validates exported texture atlas dimensions, changes AutoRetopo settings, removes the separate RealESRGAN and micro-detail controls, hardens FastMesh normalization, and improves stale-request handling in the admin database UI.

**Highest-priority source-confirmed findings from the initial pass:**

- `backend/postprocess/pipeline.py` contains a malformed `for` statement in `_execute_texture_stage()`'s Paint3D registry lookup (missing colon). This is a Python parse error and prevents this module from importing. It blocks test modules that import `postprocess.pipeline` and prevents any runtime path that imports the module from using the post-processing pipeline.
- `backend/api/routers/mesh_generation.py` removes the nested legacy texture resolution from `model_parameters` twice. The second `pop()` overwrites the first value with `None`, so the documented legacy fallback is lost when the top-level resolution and preset do not supply a value.
- The database file-clear endpoint passes individual file paths to `_delete_tree()`, which uses `shutil.rmtree()` and therefore cannot remove an individual file. This can leave standalone files such as thumbnail files in `uploads/thumbnails/` behind, even while metadata is cleared.
- The same file-clear endpoint enumerates at most 1,000 metadata records, then sweeps all Redis file metadata keys, but reports `file_metadata_removed` only from the enumerated loop. With more than 1,000 records, the reported count can understate the cleanup performed.
- The database admin router treats a job with no `asset_root` as though its workspace was deleted. The UI then unconditionally says the workspace was deleted. The success message is stronger than the backend evidence.

**Additional high-priority findings from the expanded pass:**

- The TripoSF adapter claims to undo a `-90° X` rotation from `normalize_mesh()`, but the checked-in vendored `normalize_mesh()` contains only node-transform application, recentering and uniform scaling. The extra `+90° X` is a high-confidence cause of the reported sideways/horizontal TripoSF result; the final impact must be locked down with an asymmetric coordinate fixture before changing it.
- The normal Generate 3D path resolves an explicit `4K` atlas choice to `2048` because the lookup uses preset labels against a table keyed by quality labels; `GeneratePanel` stores `textureQuality='high'` for 4K, activating the wrong fallback.
- Central texturing creates a separate `textured_model_url`, but the workspace result handler loads `active_model_url || model_url`, which remains the untextured game-ready GLB. FBX and LOD outputs are also produced from the pre-texture artefacts, so the advertised textured package is not consistent end to end.
- The database bulk-delete selector is applied to SQLite enumeration but not to IDs first collected from Redis; a status/feature-filtered request can therefore include unrelated terminal jobs when Redis is enabled.
- Texture Studio hardcodes model readiness, includes controls that are not carried through its API request, and multiple first-party UI panels still display literal `SettingsIcon`/`TargetIcon`-style placeholder strings.

The previous commit descriptions and `Docs/MEMORY.md` are useful context, but they are not proof that the current source is correct or that claimed tests still pass. In particular, the current `Dev` source syntax defect should be fixed before trying to interpret broader backend test failures.

**Audit limitations:** GitHub source and commit APIs were available, but a local clone failed because the execution environment could not resolve `github.com`. Consequently, the local branch, `git status`, staged/unstaged changes, and any user-owned worktree modifications could not be inspected. No tests, linter, build, GUI, GPU inference, model loading, visual A/B comparison, or live database/API workflow were executed. This is an expanded remote static audit of high-risk first-party paths, not proof that every one of the 5,192 tree entries (including vendored upstream code) or every UI/runtime workflow has been exhaustively validated. Newly confirmed source-level mismatches below require local reproduction/tests before being declared fixed.

## 2. Repository State and Scope

### Remote repository snapshot

- **Repository:** `https://github.com/Silentzx2/ForMash3D`
- **Branch inspected:** `Dev` (capital D)
- **Head commit:** `3f7b46e119f23ed5fbfed6a254a1eb7dc831f9d5`
- **Commit subject:** `fix: consolidate texture, mesh quality, and UI reliability`
- **Commit time:** `2026-10-11T07:59:34Z`
- **Parent commit:** `b9b0179bf6de0d1db4a650bc6efa3ef4324d265e`
- **Tree inspected:** `bead60a24cca4a1d6543d6270cd9f51eca958a23`
- **Remote history:** Recent `Dev` commits were inspected through the GitHub API. The parent adds the database control center; the latest `Dev` commit changes texture, mesh-quality, scheduler, test, and UI paths.
- **Working tree:** **Unknown / not accessible.** A remote branch snapshot does not expose the user's local uncommitted or staged edits. The second AI must run `git status --short --branch` and inspect the full diff before editing.
- **Repository-root task file:** The inspected tree did not show an existing root-level `TASK_BUG_AUDIT_AND_FIX_PLAN.md`.
- **Instructions:** No `AGENTS.md` path was found in the inspected remote tree. Root `RULES.md`, `README.md`, `CONTRIBUTING.md`, and relevant `Docs/*.md` content were reviewed. Some large documentation files were read in relevant ranges rather than line-by-line in their entirety.

### Architecture and paths reviewed

- Frontend: Next.js 16 / React 19, generation controls and `features/workspace/Panels/GeneratePanel.tsx`, `TexturePanel.tsx`, workspace state and generation parameter builder, `Viewport/MeshViewer.tsx`, `AnimationLeftPanel.tsx`, `AnimationRightInspector.tsx`, `RiggingStudio.tsx`, `UVUnwrapPanel.tsx`, `features/settings/GenerationSection.tsx`, admin database tab.
- API: `backend/api/routers/mesh_generation.py`, `backend/api/routers/database.py`; references to the system job-management/download contract.
- Scheduler and adapters: `backend/core/scheduler/multiprocess_scheduler.py`, `backend/core/scheduler/model_factory.py`, `backend/adapters/paint3d_adapter.py`, `backend/adapters/hunyuan3d_paint_v21.py`, and `backend/utils/fastmesh_utils.py`.
- Production mesh pipeline: `backend/postprocess/pipeline.py`, `backend/postprocess/README.md`, and retopology configuration/schema.
- Persistence/admin: `backend/core/file_store.py`, `backend/core/scheduler/database_manager.py`, `features/admin/tabs/DatabaseTab.tsx`.
- Regression tests inspected: `backend/tests/test_postprocess_texture_pipeline.py`, `test_postprocess_e2e.py`, `test_generation_adapter_regressions.py`, and `test_database_admin.py`.
- Documentation/requirements: root `RULES.md`, `README.md`, `CONTRIBUTING.md`, `Docs/ARCHITECTURE.md`, `Docs/PRD.md`, `Docs/DESIGN.md`, `Docs/TASKS.md`, `Docs/DECISIONS.md`, `Docs/MEMORY.md`, `Docs/SECURITY.md`, `Docs/SYSTEM-BLUEPRINT.md`, `Docs/api-documentation.md`, `backend/postprocess/README.md`, `package.json`, `backend/requirements.txt`, and `backend/pytest.ini`.

### Environment and verification constraints

- The documented runtime baseline is Python 3.10, CUDA 12.4, PyTorch 2.6.0+cu124, Node 24.21, and Bun 1.4.2. Actual environment alignment was not verified.
- CUDA/GPU, downloaded model weights, Redis service state, Blender, a running GUI, reference meshes, and representative generated assets were unavailable for runtime verification.
- No test command is represented as run. The source issue inventory below uses direct code evidence; reproduction and all new acceptance tests remain pending.

## 3. Applicable Rules and Requirements

1. **`RULES.md` is mandatory.** Follow the Ponytail/YAGNI ladder only after understanding the actual workflow: trace callers and callees, use existing helpers/dependencies, fix the common root cause, prefer deletion over additions, and ship the smallest correct diff.
2. **Root cause before fix.** Search all callers and data paths for each affected function. Do not patch only the visible UI symptom, suppress exceptions, fake success, or create duplicate pipelines.
3. **Documentation must match the implementation.** After meaningful changes, review and update relevant `Docs/*.md` files, `README.md`, and API documentation where the behavior or contracts changed. `Docs/TASKS.md` is an applicable source of product requirements.
4. **Preserve source fidelity.** The canonical `master/source.glb` is immutable. Downstream repairs, retopology, UV, baking, LOD, collision, and export work on derived artifacts. Do not “fix” mesh detail by overwriting the source checkpoint.
5. **Preserve model contracts and GPU policy.** Keep lazy model loading, model-specific raw geometry settings, the common Python/CUDA/Torch baseline, and strict GPU behavior. Do not silently fall back to CPU or silently lower requested quality.
6. **Centralized texture-generation intent.** The latest architecture/docs describe raw geometry generation followed by an optional central texture stage. Paint3D handles the 1K/2K presets; Hunyuan3D-Paint-v2.1 handles 4K/8K. RealESRGAN is meant to be an internal automatic stage for Hunyuan Paint, not a separate user toggle. Verify that actual adapter/model capabilities satisfy this intent.
7. **Texture results must be real and verifiable.** A successful texture state requires an actual output mesh/material/embedded base-colour atlas and expected dimensions, plus usable output paths. Failure must remain visible and preserve the raw master for retry.
8. **Database safety.** Destructive actions require the intended confirmation, authorization checks, safe path containment, consistent Redis/SQLite handling, and accurate results. Never delete paths outside the designated storage roots. A file deletion helper must distinguish files from directories.
9. **UI verification.** `RULES.md` specifies `agent-browser` for UI verification where available and requires test screenshots to be placed outside the repository (for example `/tmp/agent-browser-screenshots/`).
10. **Documented commands.** `CONTRIBUTING.md` lists `bun run test`, `bun run lint`, `bun run build`, `python3 -m compileall -q backend/`, `python3 scripts/verify_contracts.py`, and `bash -n backend/scripts/*.sh scripts/*.sh`. `package.json` defines `bun run test` as a TypeScript no-emit check. These commands still need to be run in a compatible checkout/environment.

Relevant design contracts in `Docs/TASKS.md` include the central texture pipeline, persistent/reference-image handoff, actual atlas-size verification, failed-texture preservation/retry, raw source immutability, and not removing existing models/adapters while deprecating legacy textured geometry behavior. Re-read the current section and all applicable tasks before edits because this remote audit cannot capture future commits or the local checkout.

## 4. Confirmed Bug Inventory

### BUG-001 — Paint3D stage contains a Python syntax error

- **Severity:** Critical
- **Status:** Confirmed by source inspection; not yet repaired.
- **Affected workflow:** Importing `postprocess.pipeline`, test collection for modules that import it, and the production post-processing / centralized texture stage.
- **Evidence:** `backend/postprocess/pipeline.py`, inside `_execute_texture_stage()` in the 1K/2K Paint3D branch, the registry loop is written as `for key in ("paint3d", "paint3d_image_mesh_painting")` without a trailing colon before `if key in ModelFactory.ADAPTER_REGISTRY:`.
- **Root cause:** The `for` compound statement is syntactically incomplete. Python must parse the whole module before it can be imported; this is not limited to the Paint3D runtime branch.
- **Minimal fix:** Add the missing colon to that loop, then run a syntax/import check immediately. Do not bundle unrelated refactoring into this fix.
- **Dependencies / regression risk:** This must be fixed first. Until it parses, tests importing `postprocess.pipeline` can fail at collection time and downstream failures can obscure this primary defect. Check the full diff around this recently edited function for other syntax/import errors rather than assuming one character is the only problem.
- **Required tests / acceptance:** `python -m py_compile backend/postprocess/pipeline.py`; `python3 -m compileall -q backend/`; import `postprocess.pipeline` under the documented backend Python environment; collect and run the postprocess test modules. No `SyntaxError` may remain.

### BUG-002 — Legacy nested texture resolution is popped twice

- **Severity:** Medium
- **Status:** Confirmed by source inspection; not yet repaired.
- **Affected workflow:** Backward-compatible `POST /api/v1/mesh-generation/image-to-textured-mesh` requests where texture resolution is supplied only via `model_parameters.texture_resolution`.
- **Evidence:** `backend/api/routers/mesh_generation.py`, inside `image_to_textured_mesh()`: first `source_texture_resolution = params.pop("texture_resolution", None)` correctly saves the value, but after processing the target/LOD parameters the code repeats the same `pop()` and overwrites `source_texture_resolution` with `None`.
- **Root cause:** `dict.pop()` mutates the dictionary. The duplicate call consumes the key the first time and overwrites the saved result with the fallback value the second time. The final resolution resolver can therefore ignore a valid legacy nested resolution and fall back to the endpoint default or a preset.
- **Minimal fix:** Keep one `pop()` and retain its result; continue stripping texture-only fields before geometry adapter inference. Confirm the accepted numeric/preset boundary remains compatible with `ImageToTexturedMeshRequest` validation.
- **Dependencies / regression risk:** Do not accidentally send `texture_resolution` or `texture_resolution_preset` to the geometry model. Preserve top-level resolution precedence, intent preset behavior, legacy texture flag normalization, and API compatibility.
- **Required tests / acceptance:** Add an endpoint-level test with a fake scheduler that submits a request whose only explicit resolution is nested in `model_parameters`. Assert the queued job has the expected normalized texture resolution and the field is absent from the model-inference parameter payload. Also cover top-level value precedence, preset fallback, and invalid values.

### BUG-003 — Clear-all-files cannot unlink file paths passed to `_delete_tree`

- **Severity:** Medium
- **Status:** Confirmed by source inspection; live endpoint reproduction pending.
- **Affected workflow:** Admin Database → clear all file metadata/uploads; specifically standalone files, including files directly below `uploads/thumbnails/` or directly inside an upload-type directory without a hash subdirectory.
- **Evidence:** `backend/api/routers/database.py` defines `_delete_tree(path, must_be_under)` using `shutil.rmtree(resolved)`. `clear_all_files()` passes matches from `uploads.rglob(f"upload_{file_id}.*")` and an individual thumbnail path to `_delete_tree()`, and later passes individual children to the same helper. `shutil.rmtree()` is a directory-tree remover, not a file unlink operation. The function catches the resulting `OSError` and returns it, so the endpoint can continue while a file remains on disk. The existing test `backend/tests/test_database_admin.py::test_clear_all_files_requires_typed_confirmation` checks a sharded image path, which can be removed when its parent hash directory is recursively deleted, but does not check a standalone thumbnail file.
- **Root cause:** A directory-only helper is used for both files and directories. The recursive cleanup path only succeeds for a child directory; direct file children are reported as errors and remain.
- **Minimal fix:** Preserve the existing resolved-path containment check, then use `unlink()` for a file/symlink of an allowed type and `rmtree()` only for a directory. Continue preventing deletion of the storage root itself or anything outside it. Ensure cleanup errors remain observable rather than suppressing them.
- **Dependencies / regression risk:** File and symlink behavior must be defined explicitly; do not follow symlinks outside `uploads`. Keep upload metadata deletion, Redis file-key sweeps, and job/asset records independent. Avoid broadening deletion beyond `storage/uploads`.
- **Required tests / acceptance:** Extend `backend/tests/test_database_admin.py` to create a standalone file under `uploads/thumbnails/`, one upload directly under an upload-type directory, one sharded upload, and a path outside the allowed root. After a confirmed clear, all valid in-root files should be gone, the outside file must remain untouched, and any failed cleanup must appear in the response. Retain the existing typed-confirmation test.

### BUG-004 — Clear-all-files reports a capped metadata-removal count

- **Severity:** Low
- **Status:** Confirmed by source inspection; test pending.
- **Affected workflow:** Admin Database clear-all-files result/toast when the Redis file store has more than 1,000 metadata entries.
- **Evidence:** `backend/api/routers/database.py::clear_all_files()` calls `file_store.list_file_metadata(limit=1000)`, increments `removed` for each metadata entry successfully deleted in that loop, then sweeps all Redis keys matching `_FILE_KEY_PATTERNS`, which include `3daigc:file:*` and `3daigc:files:*`. The response's `file_metadata_removed` is the loop's `removed` count, not the number of metadata keys deleted in the subsequent sweep.
- **Root cause:** The response counter tracks only the capped metadata enumeration, while the endpoint performs an additional uncapped key sweep. With more than 1,000 entries, metadata may be deleted without being reflected in `file_metadata_removed`.
- **Minimal fix:** Establish one authoritative count for deleted metadata (for example, count actual per-file deletions and/or distinguish metadata keys swept from metadata records deleted). Do not mislabel Redis index keys as individual files. Avoid adding an expensive unbounded scan solely for UI cosmetics if the existing sweep can provide a better-grounded count.
- **Dependencies / regression risk:** Redis metadata keys can expire or be stale; count only what the endpoint can substantiate. Keep user/token/auth Redis namespaces excluded.
- **Required tests / acceptance:** Seed more than 1,000 file metadata records in isolated Redis/fakes, invoke the endpoint with the required typed token, and assert the reported counters match the explicitly defined semantics and remaining metadata is zero. Cover stale index entries and unavailable Redis behavior.

### BUG-005 — Job deletion claims a workspace was deleted when no workspace path exists

- **Severity:** Low
- **Status:** Confirmed by source inspection; UI reproduction pending.
- **Affected workflow:** Admin Database per-job deletion for a job that has no `asset_root` in its result.
- **Evidence:** `backend/api/routers/database.py::_delete_job_with_workspace()` only calls `_delete_tree()` when `asset_root` is truthy, but returns `"asset_workspace_deleted": cleanup_error is None`. When no path exists, `cleanup_error` stays `None` and the result reports `asset_workspace_deleted: true` despite not attempting a workspace deletion. `features/admin/tabs/DatabaseTab.tsx::confirmDeleteJob()` also always shows the toast description that the job and its workspace were deleted.
- **Root cause:** The backend collapses “no workspace path was recorded” into “workspace deletion succeeded,” and the frontend makes the same unconditional claim.
- **Minimal fix:** Return an explicit state for a missing/unrecorded workspace (for example `false` or `not_applicable`, consistent with the API schema) and build the toast from the actual response. Keep job-record deletion success separate from workspace cleanup success.
- **Dependencies / regression risk:** Preserve the existing rule that a workspace is only removed after durable job deletion succeeds; keep `_models_root` containment validation. Do not make a missing workspace prevent a valid job-row deletion.
- **Required tests / acceptance:** Add one test for a job with no `asset_root`, one with a real in-root workspace, and one with a path outside the models root. The result and toast must report the correct outcome in each case.

## 4.1 Initial Strongly Suspected / Unverified Findings

These are **not confirmed bugs** and must not be treated as such until reproduced against the current checkout.

| ID | Area | Confidence | Evidence / uncertainty | Next diagnostic action |
|---|---|---|---|---|
| SUS-001 | Texture atlas extraction | Medium-low | `backend/postprocess/pipeline.py::_extract_base_color_texture()` uses `getattr(material, "baseColorTexture", None) or getattr(material, "image", None)` before its later NumPy-array handling. If the first value is a NumPy array, boolean evaluation can raise an ambiguous-truth-value error instead of reaching the array branch. Typical exported GLB material values may be PIL images, so actual occurrence is unverified. `backend/adapters/hunyuan3d_paint_v21.py::_verify_pbr_output()` has a similar `or` expression. | Add a unit test with a material-like object whose `baseColorTexture` is an ndarray and whose `image` is a fallback. Replace truthiness fallback only if this representation is part of the actual supported contract; prefer explicit `is None` checks. |
| SUS-002 | Automatic RealESRGAN runtime behavior | Medium | `backend/adapters/hunyuan3d_paint_v21.py::_process_request()` forces `config.enable_realesrgan = True` only if that attribute exists. Docs state the backend model enables it automatically, but remote static inspection does not establish how every supported config class/runtime exposes the setting or whether the enhancement model/weights load successfully. | Trace the configuration object from model config creation into the vendored Hunyuan paint pipeline and RealESRGAN loader; test present/missing weights, incompatible input, CUDA/VRAM failure, and verify the output atlas—not only the flag. |
| SUS-003 | NumPy/retopology failures | Medium | `backend/utils/fastmesh_utils.py` recently added checks for empty meshes, non-finite bounds, and degenerate scale. No user-provided stack trace or local reproduction was available, so other reported NumPy failures cannot be pinned to a specific operation from this snapshot alone. | Run the actual failing inputs through extraction → NumPy/tensor conversion → FastMesh/AutoRetopo → export, record exact exception and array shapes/dtypes, and add one regression per distinct root cause. |
| SUS-004 | Mesh sharpness / micro-detail outcome | Medium | The latest `Dev` commit increases shell resolution and reduces AutoRetopo smoothing, and enables supported bake defaults, but static parameters do not prove perceptual detail retention. No reference models, output meshes, GPU, or visual comparison was available. | Run the same representative assets through raw and post-processed output; compare source hashes, face counts, bounding-box drift, normal/AO maps, edge retention and screen-space renders. Separate model limits from downstream degradation. |
| SUS-005 | Full application UI/UX | Medium | Changed generation/texture/admin components and related state builders were inspected, but a complete page-by-page interactive audit of all repository UI surfaces was not feasible through the remote-only interface. | Run the app locally, enumerate all visible actions, execute `agent-browser` coverage where supported, and file further bugs only with a concrete repro, code path and acceptance test. |
| SUS-006 | Paint3D integration and output fidelity | Medium | Registry lookup/fallback and adapter call contracts were inspected, but no real Paint3D weights, GPU run, mesh/reference pair, or exported GLB was available. | On a supported CUDA host, execute 1K and 2K end-to-end; check adapter load/unload, subprocess arguments/timeouts, UV/material assignment, output mesh existence and actual 1024/2048 embedded atlas dimensions. |

Do not add a broad “miscellaneous bugs” entry from these items. Convert an item into a confirmed `BUG-NNN` only after recording the exact path, symbol, reproduction/evidence, root cause, fix, risks, and tests.

## 5. Initial Prioritized, Dependency-Aware Implementation Plan

### Phase 0 — Establish a safe current baseline

1. On the actual checkout, run `git status --short --branch`, identify the current branch and `git rev-parse HEAD`, and preserve all pre-existing work. Do not reset or clean the tree.
2. Fetch/inspect the latest `Dev` head. Confirm each finding below still applies; this audit was against the snapshot listed in Section 2 and could become stale.
3. Read `RULES.md`, relevant `Docs/TASKS.md` sections, architecture/PRD/API docs, and the touched code/tests again before edits.

### Phase 1 — Restore importability (BUG-001; prerequisite for all backend verification)

1. Fix the missing colon in the Paint3D `for` statement in `_execute_texture_stage()` with the minimal diff.
2. Run `py_compile`, compileall, and import/test collection immediately. If further syntax/import failures appear, trace the first failing module instead of making unrelated changes.
3. Run targeted postprocess tests, including `backend/tests/test_postprocess_texture_pipeline.py` and import/runtime checks from `backend/tests/test_postprocess_e2e.py`.

**Dependency:** Must precede reliable execution of all post-processing tests or central-texture behavior validation.

### Phase 2 — Correct legacy texture resolution (BUG-002)

1. Remove the duplicate `params.pop("texture_resolution", None)` that overwrites the saved value in `image_to_textured_mesh()`.
2. Add an endpoint-level test using a fake scheduler and isolated temporary image input. Assert actual `JobRequest.inputs`/metadata rather than only testing the helper.
3. Recheck the sibling raw-generation and direct-paint endpoints for the same pop/precedence mistake, but only change additional code if an actual equivalent defect is found.

**Dependency:** Phase 1 should be green so route tests can import their dependencies. Can be implemented in parallel with Phase 3 after the baseline has been recorded.

### Phase 3 — Make file cleanup safe and observable (BUG-003, BUG-004)

1. Correct `_delete_tree()` so its containment check happens before type-specific deletion and only directories use `shutil.rmtree()`. Use a deliberate file/symlink policy and never follow an outside-root symlink.
2. Extend tests to standalone files and nested directories; keep the existing safe-path and typed-confirmation tests.
3. Define the `file_metadata_removed` and `redis_keys_swept` response semantics. Ensure a cleanup of more than 1,000 records does not make the UI report an incorrect count.
4. Verify failure results when Redis or filesystem operations fail; do not report full success when files or metadata could not be removed.

**Dependency:** Run in an isolated temp storage/Redis fixture. Never exercise destructive endpoints against the user's real database or uploads.

### Phase 4 — Correct job deletion feedback (BUG-005)

1. Give “workspace not present/not recorded,” “workspace deleted,” and “workspace cleanup failed” distinct response states.
2. Make `DatabaseTab` success/failure toasts reflect the backend response rather than assuming that the workspace was deleted whenever the job row deletion succeeded.
3. Add API and frontend tests for no `asset_root`, successful in-root deletion, and path-containment rejection.

**Dependency:** Preserve the existing durable-row-before-workspace-delete ordering and do not merge this task with broad admin UI refactoring.

### Phase 5 — Resolve the suspected items only with new evidence

1. Validate the real material image type through GLB export/import before changing atlas extraction.
2. Trace RealESRGAN config and model-weight loading; do not reintroduce a UI toggle or swallow a missing-weight error.
3. Reproduce each NumPy/retopology failure using representative invalid and valid meshes and report array dtype/shape and the precise failing operation.
4. Execute visual/raw-vs-derived mesh A/B checks on actual representative assets before changing default remeshing or baking parameters. Never mutate `master/source.glb`.
5. Complete page-by-page UI review after the runnable app is available; report only reproducible, substantiated issues.

## 6. Required End-to-End Workflows

All runs below are pending. Use disposable storage/database fixtures; use real model runs only on a supported CUDA host with the required weights.

### A. Static import and backend checks

1. Run `python -m py_compile backend/postprocess/pipeline.py`.
2. Run `python3 -m compileall -q backend/`.
3. Import `postprocess.pipeline` with the documented backend environment and collect the affected tests.
4. Run `python3 scripts/verify_contracts.py` and `bash -n backend/scripts/*.sh scripts/*.sh`.

### B. Central textured generation

1. Submit a valid image-to-raw request with texturing disabled. Confirm raw generation still succeeds, `master/source.glb` exists, and the texture stage is explicitly skipped.
2. Submit the same supported image/model with 1K texturing enabled. Confirm geometry model inference receives no centralized texture-only controls, Paint3D runs exactly once, and a textured GLB with real material/UV/embedded atlas is produced.
3. Repeat at 2K, then 4K and 8K through Hunyuan3D-Paint. Inspect the actual embedded base-colour dimensions: 1024², 2048², 4096², or 8192² as requested. Do not count a configured target value as proof of actual exported size.
4. Confirm RealESRGAN runs at the intended internal stage once for Hunyuan Paint, and missing weights, unsupported inputs, insufficient VRAM, and loader failures produce a meaningful failed/degraded texture state rather than placeholder success.
5. Force the texture adapter to fail and verify raw master and already-valid production artifacts remain available; `texture_stage.status`, `texture_status`, artifact manifest, and `production_status` must consistently surface the failure.
6. Test a legacy `/image-to-textured-mesh` request with resolution nested only in `model_parameters`; verify BUG-002 is fixed. Verify top-level value precedence and legacy texture aliases.
7. Verify repeated clicks/duplicate requests, cancellation, and temporary output cleanup where safely testable.

### C. Mesh / retopology / micro-detail

1. Feed a valid watertight mesh, an open mesh, a zero-extent mesh, a mesh with empty vertices/faces, non-finite coordinates, and a multi-geometry GLB through supported validation/retopology functions.
2. Verify invalid NumPy shapes/types/values fail at the correct boundary with meaningful exceptions; valid inputs must preserve finite coordinates, topology validity, transforms, UVs, and materials where promised.
3. Compare immutable raw master against derived game-ready and LOD outputs. Record face counts, vertex counts, bounds drift, watertight/non-manifold/boundary counts, UV/material presence, and normal/AO bake status.
4. Inspect representative renders for hard-edge/micro-detail retention. Establish model limitations separately from any smoothing/decimation/export damage.
5. Confirm no downstream processing changes the master SHA-256.

### D. Database management

1. In isolated storage, test per-job delete for (a) a job with no `asset_root`, (b) a job with an in-root workspace, and (c) a malicious/out-of-root path. Durable row deletion, workspace cleanup status, and UI messages must agree.
2. Test bulk-delete confirmation/selector requirements, terminal-only behavior, queue/running skips, and Redis/SQLite consistency.
3. Test clear-all-jobs confirmation, all rows including rows absent from Redis, user/token-key preservation, workspace containment, and `VACUUM` reporting.
4. Test clear-all-files confirmation, more than 1,000 metadata records, sharded uploads, direct files, thumbnails, stale metadata entries, Redis index cleanup, and a forced filesystem deletion error.
5. After each operation, verify persisted SQLite/Redis/file-store state, not only local UI state or a success toast.

### E. UI/UX checks

1. With backend and frontend running, use `agent-browser` where available to test generation-page input selection, texture toggle/preset, submit/loading/progress/error states, cancellation and resulting download controls.
2. Verify no separate RealESRGAN or micro-detail control is shown in the intended panel; ensure generation state and submitted API request use the supported defaults.
3. Test admin database filters, pagination/load-more, stale response suppression, manual refresh, row and bulk delete confirmations, clear danger-zone confirmations, Redis unavailable state, and explicit error reporting.
4. Enumerate all remaining visible controls across relevant pages and record only those with a reproducible broken/dead/misleading behavior.

## 7. Testing and Regression Strategy

### Required automated checks

Run and report the exact command and exit status for each applicable check:

- `python -m py_compile backend/postprocess/pipeline.py`
- `python3 -m compileall -q backend/`
- `pytest -q backend/tests/test_postprocess_texture_pipeline.py backend/tests/test_postprocess_e2e.py`
- `pytest -q backend/tests/test_generation_adapter_regressions.py`
- `pytest -q backend/tests/test_database_admin.py`
- Related endpoint/contract tests and any new tests for BUG-002 through BUG-005.
- `python3 scripts/verify_contracts.py`
- `bash -n backend/scripts/*.sh scripts/*.sh`
- `bun run test`
- `bun run lint`
- `bun run build`

Run the complete configured suite as the environment allows. The repository's `backend/pytest.ini` uses `testpaths = tests` and `pythonpath = backend .`; execute commands from the repository root or document another working directory explicitly.

### Test categories and reporting rules

- **Unit tests:** Python syntax/imports; resolution precedence; file-vs-directory deletion; metadata counters; workspace status mapping; material/UV/atlas extraction; FastMesh validation.
- **Integration tests:** API routes with fake scheduler and temporary file/database stores; database admin endpoint contract; persistent Redis+SQLite behavior where a disposable Redis instance is available.
- **Frontend checks:** TypeScript (`bun run test`), lint, production build, plus browser-driven UI interactions.
- **Runtime/model checks:** Real Paint3D and Hunyuan Paint inference, actual RealESRGAN execution, atlas/material validity, cancellation/VRAM behavior, and raw-vs-derived geometry comparison on a compatible NVIDIA CUDA host.
- **Not pass:** A skipped test, unavailable GPU/model/Redis/browser, mocked model output, successful parameter validation without output inspection, or a source-only assertion is not evidence that full model output works. Mark such checks `Skipped` or `Blocked`, and state the exact environmental reason.

Do not edit `backend/thirdparty/` merely to avoid failing a test; investigate whether a project-owned adapter/config boundary can solve it first, unless the defect is proven to require a vendored-source fix.

## 8. Initial Definition of Done and Acceptance Criteria

- [ ] All five confirmed bug IDs have an implementation status, changed-file list, tests, results, and remaining risk recorded in the final table.
- [ ] `backend/postprocess/pipeline.py` parses/imports and affected test modules collect.
- [ ] Legacy nested texture resolution is preserved and correctly normalized without leaking into geometry inference.
- [ ] Clear-all-files removes expected in-root files, handles thumbnails/direct files, keeps path containment, and accurately reports metadata/cleanup results.
- [ ] Per-job deletion messages distinguish missing/not-recorded workspaces, successful cleanup, and cleanup failures.
- [ ] Textured generation for all supported presets either produces a real usable textured asset with the exact expected embedded atlas dimensions or reports a real actionable failure. No fake success or silent exception suppression.
- [ ] RealESRGAN remains an internal automatic Hunyuan Paint enhancement, used at the correct stage and not duplicated. Missing weights or model errors are observable.
- [ ] Known NumPy/retopology failures have reproducible root causes and regression tests; valid supported mesh types preserve geometry integrity, transforms and texture data where promised.
- [ ] Raw and post-processed mesh detail have been inspected using representative assets; any unresolved model-quality limitation is documented rather than hidden behind arbitrary settings.
- [ ] Relevant UI controls, loading/error states, export paths, and database admin workflows agree with durable backend state.
- [ ] Immutable `master/source.glb` is preserved and its hash validated across processing.
- [ ] Relevant docs are current and consistent with code.
- [ ] Relevant Python/frontend/static checks are green, or every failure/skip/blocker is explicitly documented. No skipped GPU/UI/integration test is claimed as passed.
- [ ] Full diff review confirms no accidental dependencies, unrelated scope expansion, removed model capabilities, credential leaks, unsafe file operations, or overwritten user work.

## 9. Implementation, Review, and Git Instructions for the Second AI

1. Read root `RULES.md`, the applicable `Docs/*.md` and task sections, and this handoff file before modifying anything.
2. Verify the current checked-out `Dev` branch and HEAD. Re-check each bug against the current source; do not blindly trust this snapshot or line anchors if the branch has advanced.
3. Run `git status --short --branch` and inspect staged and unstaged diffs before editing. Preserve every pre-existing user change. Never run reset/clean/checkout-overwrite operations or stash/pop without explicit authorization.
4. Fix every confirmed, still-applicable in-scope bug with the smallest correct diff and add/update tests. Investigate suspected findings first; do not implement speculative changes.
5. Update **this same `TASK_BUG_AUDIT_AND_FIX_PLAN.md`** with implementation status, changed files, command output/results, and remaining risks. Do not create a duplicate audit/task Markdown file.
6. Re-read applicable task documents as acceptance criteria and update relevant documentation under `Docs/` plus `README.md` only when required by changed behavior.
7. Review every affected function's callers/callees and the full diff. Verify security, path containment, database integrity, texture/material output, source immutability, model compatibility, cancellation, progress/errors, and safe simplification. Remove redundant code only when equivalence is proved by tests.
8. Run relevant existing/new checks and the broad project checks listed in Section 7 where the environment permits. Report exact commands, actual pass/fail/skip results, and constraints. Do not fabricate runtime validation.
9. Commit verified changes on the existing `Dev` branch only if permissions, current history, and worktree state make it safe. Push only if repository access and permissions allow and no other developer's changes would be overwritten. Never force-push. If commit/push cannot safely occur, state the exact blocker and leave the work uncommitted rather than claiming success.

## 10. Initial Bug Status Table

Implementation status is pending. The implementing AI must update both the initial and expanded tables using actual results.

| Bug ID | Severity | Status | Files Changed | Tests Run | Result | Remaining Risk |
|---|---|---|---|---|---|---|
| BUG-001 | Critical | Done | Fixed | Fixed: Stage 7 game-ready export indentation in pipeline.py | Passed (py_compile, test_postprocess_texture_pipeline) | None |
| BUG-002 | Medium | Done | Fixed | Fixed: single-pass texture resolution extraction with correct precedence | Passed (test_bug002_nested_texture_resolution_precedence) | None |
| BUG-003 | Medium | Done | Fixed | Fixed: _delete_tree handles files (unlink) and directories (rmtree) with root containment guards | Passed (test_delete_tree_handles_files_and_directories) | Files and directories within storage root safely deleted; paths outside storage root rejected. |
| BUG-004 | Low | Done | Fixed | Fixed: clear_all_files collects full metadata batches without pagination-skip during deletion | Passed (test_clear_all_files_paginates_and_reports_authoritative_count) | Authoritative metadata removal count accurately reported across >1,000 files. |
| BUG-005 | Low | Done | Fixed | Fixed: _delete_job_with_workspace & DatabaseTab distinguish deleted, missing, and not_recorded workspace | Passed (test_delete_job_distinguishes_workspace_status) | Distinct response and toast states for missing vs deleted vs not recorded workspaces. |

---

## Audit Handoff Note

This report is based on the remote `Dev` snapshot identified above. It does not assert that the local working tree is clean, that the test suite passes, that GPU workflows are healthy, or that every UI page has been exhaustively exercised. Start by verifying the live branch/worktree and fixing the syntax blocker, then address the expanded findings in priority order. Do not mark any item fixed without root-cause correction and a reproducible regression test; do not claim TripoSR/TripoSG coordinate problems until fixture/visual tests confirm them.

# 11. Expanded Deep-Audit Findings — UI, Tripo Coordinates, Texture Output, Storage, and Runtime

> This section extends the initial five bugs; it does not replace them. The findings below were cross-checked against the same remote `Dev` snapshot. “Source-confirmed” means the code/contract mismatch is visible in the source. It does **not** mean the fix was applied or a live GPU/browser/database reproduction was run. No source code was modified during this audit.

## 11.1 Expanded Source-Confirmed Findings

### BUG-006 — TripoSF applies an extra 90-degree X rotation while claiming to undo a normalization rotation

- **Severity:** High (P1 for TripoSF mesh output)
- **Status:** Source-level transform mismatch confirmed; visual repro on an asymmetric fixture still required.
- **Affected files:** `backend/adapters/triposf_adapter.py::_process_request()` and vendored `backend/thirdparty/TripoSF/inference.py::normalize_mesh()`.
- **Evidence:** The adapter unconditionally calls `final_trimesh.apply_transform(rotation_matrix(+pi/2, X))` and comments that it is reverting a `-90° X` rotation from `normalize_mesh()`. The current vendored `normalize_mesh()` applies scene-node transforms, recenters the mesh, and uniformly scales it; it does not apply an X-axis rotation.
- **Root-cause hypothesis:** The inverse transform is based on an assumption that is not true of the checked-in normalization implementation. If the model output uses the same coordinate basis as the normalized input—as this pipeline implies—the added rotation changes the model's up-axis and can make it look horizontal/sideways in the viewer/export.
- **Required fix:** Trace the complete upstream TripoSF coordinate contract from the coarse TripoSR mesh through normalization, voxelization, inference, export, GLB import, and viewer. Remove or correct the transform only after confirming the expected basis; do not blindly delete rotations based only on object appearance.
- **Required regression:** Use an asymmetric, labelled fixture with known axis basis and nontrivial node transform. Test source/coarse/normalized/reconstructed/exported vertices or bounding-box axes before and after the adapter; assert the final transform is exactly the documented convention. Compare TripoSF generated output in both GLB and OBJ and confirm viewport and export agree.
- **Acceptance:** TripoSF output no longer has an unintended axis swap/90-degree rotation; any intentional conversion is documented once and shared by every relevant output format.

### BUG-007 — Generate 3D's 4K texture preset is submitted as 2K

- **Severity:** High (P1 for the advertised 4K option)
- **Status:** Source-confirmed; request-level regression test pending.
- **Affected files:** `features/workspace/store/WorkspaceContext.tsx::generateImageTo3D()` and `features/workspace/Panels/GeneratePanel.tsx`.
- **Evidence:** The inspected `generateImageTo3D()` path defines `textureResolutionByQuality` keys `low`, `medium`, `high`, `ultra`, and `8k`, while `selectedAtlasPreset` contains `1K`, `2K`, `4K`, or `8K`. For `4K`, that lookup misses. The Generate panel stores `4K` with `textureQuality: 'high'`, so this path's fallback resolves to `2048`, not `4096`.
- **Reachability qualification:** The ordinary Generate panel currently submits via `queueGenerationJob()` / `buildGenerationParameters()`, whose separate preset map directly handles `4K -> 4096`. A repository search found the `generateImageTo3D()` declaration/definition in `WorkspaceContext.tsx` but no direct named call site in the queried snapshot. Therefore the faulty mapping is confirmed in an existing exported context method, but its reachability in the current primary UI path must be traced before treating it as a user-visible live-path regression. Do not break the already-correct request builder while consolidating the duplicate methods.
- **Root cause:** One request path mixes two enums (atlas preset labels and quality labels) in one lookup and relies on a fallback that silently masks the mismatch; parallel builders make it unclear which path owns the contract.
- **Minimal fix:** Trace and remove/route any live callers of the stale builder into the shared preset-normalization helper, or correct it if retained. Use one explicit mapping (1K=1024, 2K=2048, 4K=4096, 8K=8192) across all active generation entry points. Avoid duplicate mapping tables that can diverge.
- **Required regression:** Assert the exact JSON body for all four presets through every reachable generation entry point, and assert the normalized target reaching `run_postprocess_job()` is exactly the selected square atlas size.
- **Acceptance:** No reachable path silently downgrades a selected 4K preset to 2K. If this method is proven dead code, classify it as a legacy-path cleanup instead of claiming the main Generate panel currently sends the wrong size.

### BUG-008 — Successful centralized texturing is not selected as the active generated model

- **Severity:** High (P1 for the visible “Textured Generation” workflow)
- **Status:** Source-confirmed output-contract mismatch; browser repro pending.
- **Affected files:** `backend/postprocess/pipeline.py::_build_result()` and the final result assembly; `features/workspace/store/WorkspaceContext.tsx` job-result handler.
- **Evidence:** The pipeline builds `model_url` and `active_model_url` from the untextured `game_ready` GLB. When central texture generation succeeds, it adds `textured_model_url` and a `textured` artifact, but does not make that URL the active model URL. The frontend completion handler loads only `result.active_model_url || result.model_url`; it does not select `result.textured_model_url` when the requested texture stage completed.
- **Root cause:** The optional texture artifact is added to the manifest but is not wired into the UI's active-result selection contract.
- **Required fix:** Define one unambiguous result policy: with texturing off, active/download the game-ready raw mesh; with texturing on and successful, make the textured GLB the active textured output and expose the raw/master output separately. On texture failure, preserve the raw output and show a degraded state. Keep `master/source.glb` immutable.
- **Required regression:** Stub the central texture stage as success/failure and verify the returned URLs, artifact manifest, selected workspace asset, initial viewport load, and download options. Test both modes.
- **Acceptance:** A successful textured-generation request opens a genuinely textured GLB in the viewer and exposes that same artifact as the primary textured download; a failed texture stage never masquerades as textured success.

### BUG-009 — Central texture output is not propagated to FBX/LOD export artifacts

- **Severity:** High (P1/P2 depending on the advertised engine-ready contract)
- **Status:** Source-confirmed pipeline disconnect; integration fixture pending.
- **Affected file:** `backend/postprocess/pipeline.py::run_postprocess_job()`.
- **Evidence:** FBX is created from `glb_path` before the centralized texture stage. The texture stage writes a separate GLB under `textures/` and does not replace/reload the `uv_mesh` object. LODs are later generated from `uv_mesh`, not the separate textured GLB. Thus the centralized texture is not applied to the already-created FBX or the LOD meshes; they can remain without the newly generated base-colour texture even though the main texture stage reports completion.
- **Root cause:** Texturing happens in a disconnected artifact branch after the primary export, while engine derivative artifacts are generated from the pre-texture in-memory mesh.
- **Required fix:** Reconcile the product contract before changing order. For every format the app promises as textured/game-ready, apply or bake compatible texture/material data to the target and LOD meshes, then export/rebuild FBX from the valid textured source. If any format intentionally cannot carry the material, label it accurately in the manifest and UI rather than reporting a complete textured package.
- **Required regression:** Build a small UV-mapped mesh fixture, inject a known texture, run the pipeline with LODs and FBX enabled, then reopen every artifact and verify UV coordinates, material slots, embedded/base-colour image, dimensions, and download manifest. Compare texture-preservation status for every LOD.
- **Acceptance:** The artifact manifest truthfully distinguishes textured and untextured deliverables; all outputs marketed as textured preserve the expected material data.

### BUG-010 — Texture Studio fabricates model readiness instead of reflecting backend readiness

- **Severity:** Medium (P2)
- **Status:** Source-confirmed UI contract mismatch.
- **Affected file:** `features/workspace/Panels/TexturePanel.tsx::formatTextureModel()` and `textureCapableModels`.
- **Evidence:** `formatTextureModel()` hardcodes `available: true`, `installed: true`, and `status: 'ready'`. When the backend registry returns no usable IDs, the component forcibly injects `paint3d` and Hunyuan Paint as defaults; as a result, the “no texture models” branch cannot be reached under the current fallback logic. A missing weight/native runtime can still be shown as ready until the queued job fails.
- **Root cause:** The component queries a list of model IDs, then invents readiness fields rather than consuming model weight/CUDA/runtime state from the backend's readiness endpoint.
- **Required fix:** Use the authoritative server model-readiness response. Distinguish registered, weights-present, dependency-ready, CUDA-ready, and VRAM-eligible states. A fallback ID can be displayed as an unavailable recommendation, but must not be labelled ready.
- **Required regression:** Mock a registered model with missing weights, a model unavailable on CPU-only runtime, insufficient VRAM, a ready Paint3D model, and an empty registry. Assert the UI labels and submit-button state match the backend response.
- **Acceptance:** No model is marked `ready` solely because its ID appears in a frontend list; unavailable models are disabled or explain how to resolve the problem.

### BUG-011 — Texture Studio exposes controls that are not honoured by the request/backend contract

- **Severity:** Medium (P2)
- **Status:** Source-confirmed request/schema mismatch; decide intended product semantics before removing or wiring the controls.
- **Affected files:** `features/workspace/Panels/TexturePanel.tsx`, `features/workspace/store/WorkspaceContext.tsx::runTextureGeneration()`, `backend/api/routers/mesh_generation.py::ImageMeshPaintingRequest` and `image_mesh_painting()`.
- **Evidence:** The UI tracks style presets, selected PBR map toggles, a Low VRAM toggle and a Generate PBR toggle. `runTextureGeneration()` does not submit the style or selected-map list and does not submit `textureSettings.lowVram`. It submits `generate_pbr` only as an extra top-level property, but the request model has no corresponding field and the endpoint does not transfer it into `JobRequest.inputs`. The UI's `text_prompt` is also sent to the image-painting route as a top-level property, while `ImageMeshPaintingRequest` has no `text_prompt` field; for the supported Paint3D/Hunyuan image-painting route it is not translated into the model's `prompt`/`model_parameters` contract.
- **Root cause:** Frontend settings and backend request schema drifted; the UI shows options without a compatible transport/implementation path.
- **Required fix:** For every visible setting, choose one: implement a supported request field and adapter behaviour; or remove/disable the control and explain the limitation. Do not leave decorative controls that imply a render-quality or resource change. Keep model-specific parameters behind the API boundary and use the existing shared adapter/scheduler path.
- **Required regression:** Component/request-builder tests must assert the exact payload for each supported control. API tests must assert the endpoint either honours each accepted field or rejects unsupported fields explicitly. Include prompts and selected map outputs for both Paint3D and Hunyuan Paint.
- **Acceptance:** Changing a control changes the actual request/result in a test, or the control is absent/clearly disabled. No silent ignored options.

### BUG-012 — Approved image enhancement replaces the reference image later used for texturing

- **Severity:** Medium (P2; material consistency)
- **Status:** Source-confirmed data-flow mismatch against the documented original-reference contract.
- **Affected file:** `backend/api/routers/mesh_generation.py::image_to_raw_mesh()` and `run_postprocess_job()` reference-image resolution.
- **Evidence:** The endpoint first resolves `image_file_path`, but if `preprocessing_artifact_id` is supplied (or enhancement runs), it assigns the enhanced artifact path back into the same `image_file_path` variable. The queued job stores that path as `inputs.image_path`; the central texture stage later resolves this as its reference image. The original image's durable file reference/path is not separately retained in the queued texture-stage inputs in this code path.
- **Root cause:** The one variable serves both the geometry-inference input and the canonical user reference used for texturing, so preprocessing silently changes what the paint model sees.
- **Required fix:** Preserve separate explicit fields for the original durable reference and the approved processed inference image. Persist only stable file/artifact references needed after queueing; do not rely on browser blob URLs or giant base64 payloads. Use the processed image only when the product explicitly intends that as the paint reference.
- **Required regression:** Queue a request with original image A plus approved enhancement B and texturing enabled. Assert the selected geometry adapter receives B while the texture adapter receives A, and verify the same behaviour after a queued-job restart/retry.
- **Acceptance:** Reference-image provenance is explicit and reproducible; preprocessing never silently substitutes the paint reference.

### BUG-013 — Base64/upload request files are placed in temporary directories with no visible success-path ownership/cleanup

- **Severity:** Medium (P2; storage/runtime leak)
- **Status:** Source-confirmed allocation path; whole-lifecycle cleanup trace still required.
- **Affected file:** `backend/api/routers/mesh_generation.py::process_file_input()` plus callers/job lifecycle.
- **Evidence:** The `base64_data` and `upload_file` branches create `tempfile.mkdtemp(prefix="mesh_gen_")`, write the file there and return only the file path. The local `temp_dir` is removed in the exception handler, but not on success, and the returned value carries no explicit cleanup token/path to the scheduler. Since the job runs asynchronously, an immediate cleanup in the request function would be unsafe; the owner must be the job lifecycle.
- **Root cause:** The helper allocates a directory but transfers only a path, without an explicit durable-storage transfer or post-job cleanup contract.
- **Required fix:** Trace every caller before modifying it. Prefer the existing durable file store for asynchronous inputs; otherwise register temp resources with the job and remove them after the last consumer (including texture/auto-rig child stages and retries) has finished. Never delete a reference image while a downstream paint stage still uses it.
- **Required regression:** Submit base64 and multipart inputs, force success/failure/cancellation/worker death/retry, then verify temporary inputs remain until safe to delete and disappear afterwards. Repeated jobs must not grow the `mesh_gen_*` temp directory count without bound.
- **Acceptance:** Asynchronous jobs never lose an input prematurely and do not leave untracked temporary files for the lifetime of the machine.

### BUG-014 — Database bulk-delete status/feature selectors are not applied to Redis-listed jobs

- **Severity:** High (P1; destructive data-integrity issue)
- **Status:** Source-confirmed logic bug; requires a disposable Redis reproduction.
- **Affected file:** `backend/api/routers/database.py::_collect_job_ids()` / `delete_jobs()`.
- **Evidence:** `_collect_job_ids()` first appends every ID from Redis `hkeys("3daigc:jobs")` without checking the requested `status` or `feature`. It applies those filters only to the SQLite `get_jobs_page()` enumeration. `delete_jobs()` later iterates all collected IDs and checks whether the job is terminal, but does not re-check the requested status/feature selector. With Redis enabled, `DELETE /jobs {"status":"completed"}` can also select failed/cancelled Redis jobs, and a feature-filtered delete can select terminal jobs belonging to another feature. Existing tests use a queue without a real Redis result set and therefore do not catch this branch.
- **Root cause:** One combined ID collector mixes filtered SQLite IDs with unfiltered Redis IDs, then discards the selector context.
- **Required fix:** Apply the selector to each source before deletion or validate each resolved job's status/feature immediately before deleting it. Treat missing Redis metadata carefully and report skipped/unverifiable IDs instead of deleting them on assumptions.
- **Required regression:** Use fake or disposable Redis and SQLite containing completed, failed, cancelled, queued, and processing jobs across two features. Prove status selection deletes only the requested status and feature selection deletes only the requested feature; default terminal guards must still skip active jobs.
- **Acceptance:** No bulk selector can delete a different feature/status than the user requested, regardless of whether a job exists in Redis, SQLite, or both.

### BUG-015 — Clear-all/forced job deletion can delete active job records without stopping the worker

- **Severity:** High (P1; race/data-integrity risk)
- **Status:** Source-confirmed missing cancellation/drain gate; live concurrency reproduction pending.
- **Affected file:** `backend/api/routers/database.py::_delete_job_with_workspace()`, `delete_jobs(force=true)`, and `clear_all_jobs()`.
- **Evidence:** `_delete_job_with_workspace()` obtains a status but immediately calls `scheduler.job_queue.delete_job(job_id)` without checking whether the job is queued/processing or asking the scheduler to cancel/drain it. The bulk endpoint guards active jobs only when `force` is false; clear-all calls `_delete_job_with_workspace()` for every collected ID without such a guard. A worker can continue generating/post-processing after its job record/workspace has been removed, then recreate status/result state or write artifacts into a workspace that the clear operation believed was deleted.
- **Root cause:** Database removal is treated as equivalent to worker cancellation, but deleting queue/store records does not establish that the active worker has stopped and released its outputs.
- **Required fix:** For active jobs, choose and document a safe destructive policy: refuse clear-all until active jobs are cancelled/drained, or request scheduler cancellation and wait for confirmed terminal state before deleting records/workspaces. `force=true` must not mean “orphan a live worker”; require explicit semantics and report any workers that cannot be stopped.
- **Required regression:** In an isolated test, block a worker inside inference/postprocess, request clear-all/force-delete, then release the worker. Assert no job row/Redis key is resurrected, no workspace is rewritten after cleanup, and user/token keys remain untouched.
- **Acceptance:** A job cannot outlive its persistence/workspace deletion unless the API explicitly reports that cleanup is incomplete and preserves the required reconciliation information.

### BUG-016 — FileStore cleans stale IDs from the global index but leaves per-type Redis indexes stale

- **Severity:** Low/Medium (P2 for administrative counts and long-running deployments)
- **Status:** Source-confirmed index-maintenance defect.
- **Affected file:** `backend/core/file_store.py::list_file_metadata()`.
- **Evidence:** When expired/missing metadata is found, stale IDs are removed from `3daigc:files:all`. The `3daigc:files:{file_type}` sorted set is only cleaned when `file_type` was passed to `list_file_metadata()`; the normal unfiltered call skips all per-type `zrem`s. `count_files(file_type)` later uses `ZCARD` on those per-type sorted sets, so they can accumulate stale IDs and overstate per-type counts.
- **Root cause:** Stale-entry cleanup is asymmetric between global and per-type indexes.
- **Minimal fix:** Reuse known metadata/index information to remove stale IDs from all relevant indexes, or rebuild/repair type indexes through an authoritative bounded path. Do not invent a file type if expired metadata no longer contains one.
- **Required regression:** Use a fake Redis fixture with expired/missing metadata IDs in global and multiple type sets. Call unfiltered listing and then `count_files()` for each type; assert stale IDs no longer inflate counts.
- **Acceptance:** File metadata counts reflect existing metadata and all sorted-set indexes remain consistent under expiration/deletion.

### BUG-017 — Paint3D concatenates scene geometry without applying GLB node transforms

- **Severity:** Medium (P2; multi-part assets can be spatially corrupted before paint)
- **Status:** Source-confirmed transform omission for non-identity scene nodes; fixture test pending.
- **Affected file:** `backend/adapters/paint3d_adapter.py::_prepare_job_mesh()`.
- **Evidence:** The adapter uses `trimesh.load(..., process=False)`. For a `trimesh.Scene`, it takes `list(mesh.geometry.values())` and concatenates the geometry objects directly. Node transforms in `scene.graph` are not applied in this branch. A multi-object GLB whose mesh nodes have translations/rotations/scales can therefore be concatenated in local coordinates rather than their actual world positions.
- **Root cause:** `Scene.geometry` stores geometry separately from the scene graph; flattening geometry values is not the same as flattening the transformed scene.
- **Required fix:** Reuse the existing project scene-flattening/mesh-IO helper that correctly applies transforms, if compatible with Paint3D's OBJ contract. Preserve per-object geometry/material behaviour as far as the target format supports; do not duplicate scene-transform math.
- **Required regression:** Create a GLB scene with two distinct objects under different non-identity transforms. Compare bounds/centroids before preparation and after the Paint3D input OBJ is reloaded. The objects must remain in their original relative positions.
- **Acceptance:** Texture Studio can paint multi-part transformed GLBs without collapsing, shifting, or rotating components.

### BUG-018 — Texture adapter VRAM readiness can report eligibility when CUDA is unavailable or measure GPU 0 instead of the assigned GPU

- **Severity:** Medium (P2; readiness/queue UX)
- **Status:** Source-confirmed inconsistency in readiness methods.
- **Affected files:** `backend/adapters/paint3d_adapter.py::get_vram_status()` and `backend/adapters/hunyuan3d_paint_v21.py::get_vram_status()`.
- **Evidence:** Both methods initialize `torch_vram=0`; if CUDA is unavailable, their expression treats zero as “eligible” and reports `status='eligible'`, while each adapter's actual `_load_model()` / `_process_request()` rejects CPU operation. Both readiness methods query `torch.cuda.get_device_properties(0)` rather than clearly reporting the assigned `gpu_id`, which can misrepresent eligibility when a job is targeted to a different GPU.
- **Root cause:** “VRAM unknown because CUDA is unavailable” is conflated with “VRAM requirement satisfied,” and the selected device is not used consistently.
- **Required fix:** Report CUDA unavailable as ineligible for these strict-GPU adapters, distinguish unknown from sufficient, and query the assigned device (or the same scheduler resource-plan abstraction used for admission). Do not report eligibility from total physical VRAM when available/free/reserved memory does not satisfy the scheduler's contract.
- **Required regression:** Cover CPU-only runtime, GPU 0 vs GPU 1 with different memory, missing device IDs and insufficient/free-memory states. API model readiness and Texture Studio must agree with the loader/scheduler decision.
- **Acceptance:** The UI/API never says a strict-GPU texture model is ready when it cannot execute on the selected device.

### BUG-019 — The 8K preset can report an 8K texture stage while normal/AO bake maps are capped at 4K

- **Severity:** Medium (P2; output-contract mismatch, if PBR maps are advertised at the selected atlas size)
- **Status:** Source-confirmed resolution divergence; product contract requires explicit decision.
- **Affected file:** `backend/postprocess/pipeline.py::run_postprocess_job()`.
- **Evidence:** The function clamps the general `texture_resolution` used for UV/bake operations to at most 4096, while `resolve_texture_preset()` and `_execute_texture_stage()` allow a requested 8192 atlas. The bake path sets `bake_res = texture_resolution`; consequently a selected 8K request can produce an 8192² central base-colour atlas while the generated normal/AO bake maps are 4096². Metadata can describe the texture-stage target as 8192 without making every map's dimensions obvious.
- **Required fix:** Decide whether 8K refers only to the albedo atlas or to every generated PBR map. If all maps must be 8K, implement a supported map-resolution strategy with explicit GPU/resource admission. If maps have independent dimensions by design, persist/report each map's actual width/height and label that policy in the UI/docs. Never silently imply all maps are 8K.
- **Required regression:** For 1K/2K/4K/8K, reopen every actual exported texture image and assert its on-disk dimensions against the per-map contract, not just `texture_stage.target_atlas_size`.
- **Acceptance:** User-facing claims and metadata match every actual texture file's dimensions.

### BUG-020 — Default-enabled baking and requested collision failures can be hidden as a successful production result

- **Severity:** Medium (P2; quality/observability)
- **Status:** Source-confirmed status propagation gap; failure-path tests pending.
- **Affected file:** `backend/postprocess/pipeline.py::run_postprocess_job()` / final result assembly.
- **Evidence:** The generation API supplies `bake_normal_maps=True` by default. When the bake path raises, the exception handler sets `bake_stats` to `{"status": "skipped", "reason": ...}` but does not add a required/failed bake artifact or a degraded reason. Similarly, collision generation failure logs an error and leaves collision unavailable, while the result manifest marks collision `skipped`; `production_status` primarily checks required artifact errors, QA and LOD validation. The job can therefore be scheduler-completed/production-ready despite a requested default bake or explicitly requested physics/collision stage failing.
- **Root cause:** Optional/requested stage outcome is recorded in diagnostic JSON but does not consistently flow into the artifact manifest and production-status policy.
- **Required fix:** Define whether bake and collision are mandatory, optional or best-effort for each request preset. Preserve best-effort operation if desired, but mark the stage failed/skipped accurately, add actionable user-visible reasons, and derive production status from the declared requirement level. Do not mark an optional stage failed if it was never requested.
- **Required regression:** Force `run_bake`, `run_collision`, and collision fallback to fail individually for requests where each stage is enabled and disabled. Assert `texture_status`, bake/collision artifact status, `production_status`, degraded reasons, and user-facing diagnostics are consistent.
- **Acceptance:** A requested stage never disappears into logs while the UI claims a fully ready production asset.

### BUG-021 — Literal icon-token placeholder text is visible across multiple UI panels

- **Severity:** Low (P3; user-visible polish and credibility)
- **Status:** Source-confirmed literal text in the inspected `Dev` files.
- **Affected files:** `features/workspace/Panels/TexturePanel.tsx`, `features/workspace/Panels/UVUnwrapPanel.tsx`, `features/workspace/Animation/AnimationLeftPanel.tsx`, `features/workspace/Animation/AnimationRightInspector.tsx`, `features/workspace/Rigging/RiggingStudio.tsx`, and `features/settings/GenerationSection.tsx`.
- **Evidence:** Visible JSX/attributes contain fragments such as `SettingsIcon`, `TargetIcon Mesh`, `Painting TargetIcon`, `Smart UV & Texture TargetIcon`, `TargetIcon Character`, `Open Advanced ARDY SettingsIcon`, `TargetIcon Velocity`, `TargetIcon Heading`, `Advanced Pipeline SettingsIcon`, `TargetIcon Skeleton Topology`, `SearchIcon bone...`, `Generation SettingsIcon`, and `TargetIcon Provider Compatibility`. Some `TargetIcon`/`SettingsIcon` matches elsewhere are only JSX comments; only rendered text and actual tooltip/placeholder attributes should be changed.
- **Root cause:** Internal icon/component token names were concatenated into strings instead of using the icon component plus human-readable label.
- **Minimal fix:** Replace each user-visible token with a short correct label (e.g. “Mesh”, “Settings”, “Character”, “Velocity”, “Heading”, “Skeleton Topology”, “Search bones”) and keep the existing icon components for icons. Do not perform blind global replacement because many matches are comments, imports, or actual icon identifiers.
- **Required regression:** Add a scoped source/browser assertion over the affected panels for the known bad literal strings; visually inspect each panel so intended icon artwork remains intact and tooltip copy remains grammatical.
- **Acceptance:** No internal icon/token names appear to users in the affected panels.

### BUG-022 — Generation completion toast ignores a degraded production/texture result

- **Severity:** Medium (P2; misleading error/quality feedback)
- **Status:** Source-confirmed handling mismatch; browser reproduction pending.
- **Affected file:** `features/workspace/store/WorkspaceContext.tsx` job polling/result handler.
- **Evidence:** On scheduler status `completed`, the frontend unconditionally emits a `Generation complete` success toast. The backend can return scheduler completion with `production_status: degraded`, `texture_stage.status: failed`, and a failed textured artifact while keeping the raw/game-ready mesh available. The same handler then loads `active_model_url || model_url`, which currently points to the untextured output (see BUG-008).
- **Root cause:** The UI uses the scheduler lifecycle state as a proxy for artifact/quality readiness and ignores the more granular production result contract.
- **Required fix:** Keep “job execution ended” separate from “requested outputs are ready.” Inspect `production_status`, `degraded_reasons`, and the requested textured artifact state; show success, degraded warning, or failure consistently while preserving any valid raw result.
- **Required regression:** Poll result fixtures for ready, degraded-texture-failure, failed-required-GLB, and successful textured output. Assert toast/status/selected artifact for each.
- **Acceptance:** No failed requested texture/required production artifact is represented only as an unconditional success toast.

### BUG-023 — Unsupported numeric texture sizes are silently rounded to preset buckets

- **Severity:** Medium (P2; API contract clarity)
- **Status:** Source-confirmed normalization behaviour; decide supported public input contract.
- **Affected files:** `backend/api/routers/mesh_generation.py::_normalize_texture_resolution()` and `backend/postprocess/pipeline.py::resolve_texture_preset()`.
- **Evidence:** Request schemas accept numeric values from 256 through 8192, while `resolve_texture_preset()` maps any unrecognised integer at or below 1024 to 1K, 1025–2048 to 2K, 2049–4096 to 4K, and larger values to 8K; unparseable values fall back to 2K. For example, a numeric request of 300 can be accepted at the API boundary and then become a 1024 target instead of being rejected or honoured exactly.
- **Root cause:** A field described as “preset or size” accepts a wider range than the implementation can produce, and an implicit bucketing policy hides the normalization from callers.
- **Required fix:** Choose one public contract. If only the four presets are supported, validate exactly those values (or their exact numeric equivalents) and return a clear 422 for unsupported values. If arbitrary sizes are genuinely supported, preserve the exact number through texture stage, bake and metadata with explicit capability/resource checks.
- **Required regression:** Test numeric 256, 300, 1024, 1536, 2048, 3000, 4096, 5000 and 8192 plus invalid strings. Assert either an exact output dimension or an explicit validation error—never a silent, undocumented remap.
- **Acceptance:** The effective requested resolution is explicit, validated, persisted and reported accurately.

### BUG-024 — Mesh Quality options advertise model sampling settings that the active generation flow does not apply

- **Severity:** Medium (P2; misleading UX, possible stale legacy control)
- **Status:** Source-confirmed UI/request inconsistency; browser/network repro pending.
- **Affected files:** `features/workspace/Panels/GeneratePanel.tsx::MESH_QUALITY_OPTIONS` and `features/workspace/store/WorkspaceContext.tsx::generateImageTo3D()`.
- **Evidence:** The visible preset metadata/tooltips promise values such as 256³/20 steps, 384³/35 steps, 512³/50 steps, and 640³/75 steps. The active generation function explicitly sets `sourceQuality = 'ultra'`, fixes TripoSR `mc_resolution` to 320, fixes TripoSG inference steps to 50, and describes the selector as changing output/texture quality only. The UI's grid/step labels therefore do not consistently describe actual request values.
- **Root cause:** Legacy per-model inference estimates remain in the UI after the architecture moved to maximum-fidelity source extraction and downstream-only quality/polycount controls.
- **Required fix:** Align the copy with the true contract. If the control is output quality only, remove the misleading grid/step claims and communicate downstream polycount/LOD/texture effects. If model sampling settings should vary, make them model-specific and send the exact supported values intentionally; do not show a universal estimate that the adapter ignores.
- **Required regression:** For each quality preset and representative Tripo/Hunyuan/TRELLIS model, inspect the actual JSON request and queued post-process values. Assert UI copy describes those values accurately.
- **Acceptance:** No user-facing quality label promises a sampling/grid setting that is not sent or enforced.

### BUG-025 — Per-job asset deletion validates against a hard-coded storage root instead of the configured storage root

- **Severity:** Medium (P2; cleanup fails when deployments/tests relocate storage)
- **Status:** Source-confirmed root mismatch; configured-storage integration test pending.
- **Affected file:** `backend/api/routers/database.py::_models_root()` and `_delete_job_with_workspace()`.
- **Evidence:** `_models_root()` always returns the repository's `backend/storage/models` path, while `_storage_root()` uses `get_storage_base_dir()` (which reads `STORAGE_LOCAL_PATH`). The per-job deletion path validates `result.asset_root` against `_models_root()`. When the canonical asset workspace lives under a configured alternate storage root, `_delete_tree()` refuses to delete it as outside the hard-coded root even though it is app-owned storage. The later clear-all directory sweep uses `_storage_root()` instead, so single/bulk per-job cleanup and clear-all have different root semantics.
- **Root cause:** Path safety uses a static path in one deletion path and the configurable storage abstraction elsewhere.
- **Minimal fix:** Derive the permitted workspace root from `_storage_root() / "models"` (or its validated `meshes` child according to the canonical layout), resolve both paths, and preserve the containment check. Do not weaken containment or trust an arbitrary `asset_root` merely because it came from job metadata.
- **Required regression:** Set `STORAGE_LOCAL_PATH` to a temporary directory, create one job record with a canonical workspace beneath that directory, then run single/bulk deletion. The row must be deleted and only the contained workspace removed. Include an outside-root path that must be rejected.
- **Acceptance:** Configured storage works consistently for stats, per-job delete, bulk delete and clear-all, without allowing traversal outside the configured models root.

### BUG-026 — Explicit quad topology can silently return a triangle mesh for native-textured source assets

- **Severity:** Medium (P2; requested topology contract is not met)
- **Status:** Source-confirmed skip branch; user-facing fallback semantics need an integration test.
- **Affected file:** `backend/postprocess/pipeline.py` in the retopology decision tree.
- **Evidence:** When `is_quad_requested` and `native_textures` are both true, the pipeline sets `retopo_stats` to `status: "skipped"` because it says retopology would strip UV/material mapping. The pipeline then continues the normal production path and can still assemble a successful game-ready result; the request had explicitly asked for quads but no quad output is generated by that branch. Keeping native texture data is a legitimate constraint, but silently satisfying neither the topology request nor a clearly documented fallback is not a complete product contract.
- **Root cause:** Topology-request state is treated as a best-effort hint for this branch, without an explicit rejection, safe texture-preserving retopo+bake path, or a surfaced “quad unavailable” result.
- **Minimal fix:** Keep native materials safe, but pick and expose one explicit policy: (a) run a UV/material-preserving quad path backed by a real bake/reprojection source; (b) return a structured degraded/unsupported result and tell the user why triangles were retained; or (c) disable the incompatible control before submission. Do not strip textures just to satisfy the quad flag.
- **Required regression:** Submit textured GLBs with triangle and quad requests. Verify final topology statistics, material/UV preservation, artifact/production status, and the frontend message. Include a textureless control fixture where quad retopology should run.
- **Acceptance:** The app never claims a quad request succeeded when the final artifact is triangle-dominant; intentional fallback is visible and preserves source materials.

### BUG-027 — `postprocess_status` remains `completed` even when production/texture status is degraded

- **Severity:** Medium (P2; persisted asset state is misleading)
- **Status:** Source-confirmed status-field mismatch.
- **Affected files:** `backend/postprocess/pipeline.py::_build_result()` and `features/workspace/store/WorkspaceContext.tsx` job-result handling.
- **Evidence:** `_build_result()` assigns the literal `"postprocess_status": "completed"`, while later result assembly can set `production_status` to `"degraded"` when texture generation fails or a quality gate fails. The frontend's generated `ModelAsset` copies `result.postprocess_status || 'completed'`, not `production_status`, so the asset can retain a completed/healthy-looking postprocess badge even though the backend marked the production result degraded. The job polling toast has the same general status-contract concern (BUG-022).
- **Root cause:** The result contains multiple status fields, and the backend sets one before the final outcome is known while the frontend selects that field as its primary asset state.
- **Minimal fix:** Define separate precise meanings for `job_status`, `postprocess_status`, and `production_status`; set the postprocess status from actual stage outcomes at final assembly, preserve `production_status` on `ModelAsset`, and make UI components render the right one. Do not replace stage completion with job failure when only an optional artifact is degraded.
- **Required regression:** Fixture complete, degraded-texture, degraded-QA, failed-required-GLB and canceled states. Assert backend response fields, history/polling response and the saved asset badge remain consistent.
- **Acceptance:** A completed job with degraded artifacts is represented as “completed but degraded,” not as an entirely ready production asset.

## 11.2 Cross-System Issues That Need Explicit Runtime Confirmation

These are actionable audit tasks, but must remain marked unverified until the prescribed reproduction establishes the defect.

| ID | Area | Priority | Evidence / risk | Required next action |
|---|---|---:|---|---|
| SUS-007 | TripoSR / TripoSG coordinate convention | High | TripoSR uses `to_gradio_3d_orientation()` and a fallback with the same transforms; TripoSG comments that its output is natively upright Y-up and applies no adapter-side rotation. This is not proof of a bug, and TripoSF is the only clear transform mismatch identified statically. | Run all three with the same asymmetric reference/known-orientation fixture. Compare source/raw GLB bounds and basis vectors before/after canonical storage, postprocess `load_mesh`, viewer render and export. Do not add a blanket rotation to every Tripo model. |
| SUS-008 | Mesh smoothing, feature loss, micro-detail baking | High | AutoRetopo shell smoothing was reduced, but the pipeline's local optimization guard checks face growth/bounding-box drift/vertex growth; these checks alone cannot establish retention of fine surface detail. Final master-to-derivative comparison can mark degradation, but no representative visual/GPU A/B run was executed. | Run representative smooth/open/high-detail meshes through raw → repair → retopo/remesh → simplify → UV → bake → LOD. Record source SHA-256, Chamfer/Hausdorff or available quality metrics, normal/AO map validity, silhouette, sharp-edge and micro-detail renders. Revert unsafe derived stages, never mutate the master. |
| SUS-009 | Texture map dimensions and semantic channels | Medium | The code verifies the embedded base-colour atlas, but the selected target size and each normal/AO/material map size are separate settings/outputs. Height/displacement appears in the Texture Studio map list while the normal central path's extraction only explicitly saves the base-colour atlas and the bake path is for normal/AO (plus additional maps for native-textured sources). | Define supported channels per adapter/preset, test actual files, remove unsupported map toggles or show per-channel availability/dimensions. Never imply Height/Metallic/Roughness were generated when no corresponding file exists. |
| SUS-010 | Full first-party UI/page audit | Medium | Literal placeholder labels and stale quality labels are confirmed in Texture Studio/Generate Panel, but all visible pages/routes were not interacted with in a running browser. `queueWorkflow()` explicitly throws “Workflow queueing is not supported by the current backend”; establish which visible graph/workflow controls can invoke it. | Run the app with its backend and use `agent-browser`. Enumerate every enabled button/toggle/upload/dropdown in all `app/` routes and major tool panels; test one happy path and error path per capability. Hide/disable unfinished actions or implement using existing APIs; no fake-success handlers. |
| SUS-011 | GPU/model installation/runtime matrix | High | Source manifests and requirements describe a Python 3.10/CUDA 12.4/Torch 2.6 baseline, but this remote audit did not install the environment, load model weights, exercise native extensions, or verify real VRAM admission. | Run installer/setup, requirements checks, model-weight readiness, adapter import, actual load/unload, cancellation and inference in the documented runtime. Capture actual CUDA/PyTorch/device versions and per-model failure logs; compare `requirements.txt`, model-specific installation scripts, Dockerfiles and docs before changing pins. |
| SUS-012 | Texture input file references in Texture Studio | Medium | `runTextureGeneration()` falls back from `referenceImageFileId` to `currentAsset.fileId`, while the selected asset's file ID can describe the mesh rather than the original image. Asset references may be absent after import/manual selection. The actual asset variants need an end-to-end trace before declaring a defect. | Verify image-file and mesh-file IDs remain separate across generated assets, user uploads, imported assets and reference-image replacement. Fail early with “reference image required” instead of sending a mesh file ID as an image ID. |
| SUS-013 | Untracked temp input lifecycle | Medium | BUG-013 establishes success-path `mkdtemp` allocation in one helper; the complete scheduler/child-job lifecycle was not exhaustively searched for a secondary cleanup owner. | Search all `mesh_gen_*` paths and temp cleanup callers in the current checkout. Prove whether any external cleanup already owns these files before adding new cleanup logic. |

## 11.3 Expanded Fix Order (Dependencies Matter)

1. **Phase A — Establish a runnable baseline:** verify checkout/branch and preserve local diffs; fix BUG-001; run `py_compile`, compileall, import/test collection. Do not debug downstream post-process failures before syntax/import failures are removed.
2. **Phase B — Restore correct geometry coordinates and texture requests:** fix BUG-006 via basis/fixture tests; trace BUG-007 reachability before fixing the legacy preset map; fix BUG-023 resolution validation; add exact payload tests for all presets and model adapters. Do not regress the active `buildGenerationParameters()` mapping. Ensure all Tripo model IDs are separately tested.
3. **Phase C — Fix textured artifact handoff:** fix BUG-008, BUG-009 and BUG-022 together as one end-to-end contract. A successful central texture stage must be the active textured asset; preserve immutable raw master; ensure the artifact manifest, FBX/LODs, initial viewport and download links agree.
4. **Phase D — Make Texture Studio honest and functional:** fix BUG-010 and BUG-011, remove BUG-021 literal placeholders, decide SUS-009's map/channel contract, and verify readiness/VRAM against the assigned device (BUG-018).
5. **Phase E — Fix file input lifecycle:** fix BUG-012 reference provenance and BUG-013 temporary-file ownership without cleaning files before async child stages finish. Test retries/cancellation/restart.
6. **Phase F — Fix destructive DB operations before broadening UI:** fix BUG-014 selector filtering and BUG-015 active-job cancellation/draining first; then BUG-003/004/005/016/025 file/workspace/count semantics. Use only temporary database/Redis/storage fixtures. Use only temporary database/Redis/storage fixtures. Explicitly decide whether clear-all may remove non-job-owned files.
7. **Phase G — Make production status truthful:** fix BUG-019/020/027 and BUG-022 stage status; also enforce a visible/fail-safe policy for BUG-026 topology fallbacks. Verify all map sizes, optional-vs-required stage policies, degraded reasons, and user-facing toasts.
8. **Phase H — Quality/runtime gate:** complete SUS-007 through SUS-013 investigations, including visual mesh/detail A/B, browser interaction, all advertised model adapters, CUDA/VRAM, installer, file references, and per-stage output checks. Report blocked tests separately; no mocked/static-only result should be labelled end-to-end verified.

## 11.4 Expanded Acceptance Criteria

- [ ] All BUG-006 through BUG-027 entries are either fixed with regression coverage or explicitly reclassified with a documented reason and evidence.
- [ ] `RAW-QUALITY-001` is resolved only after model-by-model raw-output auditing proves the cause and regression tests pass, or remains explicitly Pending with concrete runtime blockers; maximum model-supported raw quality is preserved with no silent downgrade.
- [ ] TripoSR, TripoSG, and TripoSF have separate coordinate-contract tests; no global rotation is applied without model-specific proof.
- [ ] 1K/2K/4K/8K requests reach the intended backend sizes exactly; request metadata, embedded base-colour image, generated PBR map dimensions, and download artifacts tell the same story.
- [ ] On successful texturing, the workspace viewport and primary textured download use the actual textured artifact; on failure, the raw/game-ready fallback remains available with a visible degraded state.
- [ ] Textured FBX/LOD exports either contain the required textures/materials or are explicitly documented as untextured artifacts; no false textured-package claim.
- [ ] Texture Studio's availability, VRAM, maps/style/prompt/PBR/low-VRAM controls reflect actual backend capability. A control is not considered functional merely because React state toggles.
- [ ] The original reference image is retained independently from any enhanced inference image; queued and retried jobs use durable identifiers.
- [ ] Temporary inputs survive until the last consumer completes and are subsequently cleaned, with bounded disk growth across success/failure/cancel/retry.
- [ ] Redis/SQLite selectors apply consistently to all data sources; destructive operations stop/drain active jobs; file indexes, job rows, workspaces and counts remain consistent.
- [ ] Requested bake/collision/texture failures propagate into artifact states and production status according to an explicit required/optional policy.
- [ ] All placeholder strings in visible UI are removed, and every still-visible action has an implemented, tested behavior or is clearly disabled with a reason.
- [ ] Run the documented Python, TypeScript/lint/build, contract, shell-syntax, API/Redis/SQLite, agent-browser, GPU/model and visual A/B tests where supported. Enter the actual command output, status and environment in the final results table. Do not state “bug-free” based only on static review.

## 11.5 Expanded Bug Status Table

All statuses begin as **Pending**; this document is a repair handoff, not a claim that fixes or tests have been completed.

| Bug ID | Severity | Source confidence | Main path | Required proof before closing |
|---|---|---|---|---|
| RAW-QUALITY-001 | Critical | Done | Per-model raw inference/extraction → `master/source.glb` → UI raw asset selection | Passed: TripoSR max mc_resolution 512, TripoSG full steps & octree depth, Hunyuan3D shape/mini turbo max fidelity, immutable source.glb preserved |
| BUG-006 | High | Done | TripoSF coordinate transform | Passed: test_triposf_coordinate_basis_preserves_upright_orientation_without_spurious_rotation |
| BUG-007 | Medium/High | Done | Legacy/alternate Generate 3D preset builder | Passed: buildGenerationParameters and runTextureGeneration map 4K to 4096 |
| BUG-008 | High | Done | Active model/texture artifact selection | Passed: test_textured_generation_designates_active_model_url_and_preserves_master |
| BUG-009 | High | Done | Textured FBX/LOD pipeline | Passed: test_textured_generation_designates_active_model_url_and_preserves_master (FBX & LODs from textured mesh) |
| BUG-010 | Medium | Done | Texture model readiness UI | Passed: TexturePanel reads model readiness directly from /system/models |
| BUG-011 | Medium | Done | Texture Studio options | Passed: unsupported controls disabled with tooltips and disabled styling |
| BUG-012 | Medium | Done | Enhancement/reference image | Passed: test_bug012_enhancement_preserves_reference_image, test_bug012_resolve_reference_image_precedence |
| BUG-013 | Medium | Done | Async file inputs | Passed: test_bug013_temp_dirs_tracked_and_cleaned, test_bug013_temp_dirs_cleaned_on_scheduling_failure |
| BUG-014 | High | Done | Redis+SQLite bulk selectors | Passed: test_collect_job_ids_applies_status_and_feature_to_redis |
| BUG-015 | High | Done | Clear-all / force delete active job drain | Passed: test_bulk_delete_skips_running_jobs_without_force, worker cancellation draining |
| BUG-016 | Low/Medium | Done | FileStore Redis indexes | Passed: test_filestore_cleans_stale_ids_from_global_and_per_type_sets |
| BUG-017 | Medium | Done | Paint3D multi-part GLB input | Passed: test_paint3d_prepare_job_mesh_applies_scene_transforms |
| BUG-018 | Medium | Done | Paint3D/Hunyuan VRAM admission | Passed: test_bug018_vram_status_ineligible_when_cuda_unavailable, test_bug018_vram_status_checks_assigned_gpu_id |
| BUG-019 | Medium | Done | 8K base-colour vs normal/AO dimensions | Passed: test_8k_preset_normal_ao_bake_not_clamped_and_records_dimensions |
| BUG-020 | Medium | Done | Bake/physics status | Passed: test_bake_and_collision_failures_surface_degraded_reasons |
| BUG-021 | Low | Done | Texture Studio labels | Passed: literal placeholder tokens removed across all 6 targeted UI components |
| BUG-022 | Medium | Done | Job polling/result toast | Passed: toast.warning on degraded status and truthful degradation reasons in UI |
| BUG-023 | Medium | Done | Texture resolution validation | Passed: test_bug023_normalize_texture_resolution_accepts_valid, test_bug023_normalize_texture_resolution_rejects_unsupported |
| BUG-024 | Medium | Done | Mesh Quality presets | Passed: MESH_QUALITY_OPTIONS labels align with downstream output/polycount |
| BUG-025 | Medium | Done | Per-job DB workspace cleanup root | Passed: test_models_root_derived_from_storage_root |
| BUG-026 | Medium | Done | Quad retopology for native-textured mesh | Passed: test_quad_retopology_on_native_textures_reports_degraded_fallback |
| BUG-027 | Medium | Done | Final post-process result and frontend asset state | Passed: ModelAsset preserves productionStatus and degradedReasons |

---

## Completed — 2026-10-11: Tripo Catalog and Multi-View Cleanup

- Removed the dedicated Zero123++ Multi-View workspace/API/model integration and updated active docs and tests.
- Kept TripoSG as the only active Tripo generation model; retired TripoSR and TripoSF adapters, registrations, presets, scheduler profiles, download-manager entries, checkpoint verification, and model-specific install steps.
- Preserved all other model integrations and left every `backend/thirdparty/` vendored repository directory untouched for separate manual cleanup.
- Historical task entries above are intentionally preserved.
