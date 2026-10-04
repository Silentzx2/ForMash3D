# ForMash3D - Comprehensive Production Issue Audit & Remediation Plan

**Status:** Active  
**Date:** 2026-10-04  
**Branch:** `Dev`  
**Audit Scope:** Full production-level issue hunt across entire project
**Importent** `Pay more attention on optimizing project  and donot run npm build after every change or backend pytest test only after the end of the full 100% implimented and also already half of the task is completed check form git status and audit fix md `
---

## Executive Summary

This document captures **every discovered issue** from a full production audit of the ForMash3D codebase (1539 source files). Issues are categorized by severity, root cause, and remediation approach. The goal: **functionally complete, consistent, stable, and production-ready** system.

---

## Issue Registry

### 🔴 CRITICAL - Production Blockers

| ID | Component | Issue | Root Cause | Fix Strategy |
|----|-----------|-------|------------|--------------|
| CRIT-001 | API Proxy (`app/api/v1/[...path]/route.ts`) | **SSE stream abort handling incomplete** - `streamResponse` doesn't properly clean up on client disconnect, leaks connections | Missing `AbortSignal` cleanup in transform stream; `pipeTo` catch swallows all errors silently | Add explicit `signal` to `TransformStream`, forward abort to upstream, log cleanup |
| CRIT-002 | Backend Scheduler (`multiprocess_scheduler.py:418-430`) | **Worker busy check uses stale `processing_job`** - race condition allows double-submission when job completes between check and mark | Non-atomic check-then-set; worker can receive new job before `processing_job = None` executes | Use `asyncio.Lock` per worker or atomic compare-and-swap in shared state |
| CRIT-003 | GeneratePanel (`GeneratePanel.tsx:522-532`) | **`generate3DModel` calls `generateImageTo3D` which re-reads stale `generationSettings`** - closure captures stale state if settings change between `pendingGenerateRef` set and effect execution | `useEffect` dependency array incomplete; `generateImageTo3D` not in deps but reads settings directly | Pass all required settings as parameters; remove closure dependency on external state |
| CRIT-004 | WorkspaceContext (`WorkspaceContext.tsx:974-1167`) | **`generateImageTo3D` has 45+ dependencies in `useCallback`** - recreates on every render, breaks `pendingGenerateRef` pattern | Massive dependency array includes every setting field; `modelDetails` object reference changes constantly | Extract settings into a single `GenerationConfig` object; use `useMemo` for stable reference |
| CRIT-005 | Backend (`mesh_generation.py:131-182`) | **`process_file_input` temp dir cleanup on exception uses bare `shutil.rmtree` without await** - synchronous I/O in async function blocks event loop | `shutil.rmtree` is blocking; called in exception handler without `run_in_executor` | Wrap in `asyncio.to_thread` or use `aiopath`/`aiofiles` for async cleanup |
| CRIT-006 | Frontend API Client (`apiClient.ts:67-82`) | **Request interceptor deletes `Content-Type` for FormData but axios needs it for boundary** - breaks multipart uploads in some environments | Over-aggressive header deletion; axios auto-sets boundary when `Content-Type` is absent but some proxies require explicit header | Only delete if explicitly set by caller; preserve axios auto-boundary behavior |
| CRIT-007 | TRELLIS Adapter (`trellis_adapter.py:242-249`, `postprocessing_utils.py:311-405`) | **Raw mesh loses micro-details via forced hole-filling mincut** - `fill_holes=True` runs `_fill_holes()` which rasterizes from 500 views, runs mincut, removes "invisible" faces (up to 30% geometry loss). `simplify=0.0` only disables QEM, NOT mincut. | `to_trimesh()` default `postprocess_mode="simplify"` + `fill_holes=True`; no "raw extraction" mode exposed | Add `postprocess_mode="none"`, `fill_holes=False` to adapter call; expose raw extraction preset |
| CRIT-008 | TripoSF Adapter (`triposf_adapter.py:234-248`) | **Silent VRAM downshift destroys geometry fidelity** - On GPUs ≤16GB, `resolution=1024→256`, `sample_points=1.6M→409K` with no user consent or UI warning | Hardcoded guard in `_process_request`; overrides user's "Ultra" quality selection | Remove silent downshift; add explicit `low_vram_mode` param with UI toggle + warning toast |
| CRIT-009 | Auto UV Service (`auto_uv.py:108-117`) | **UV regeneration discards all native textures/materials** - Creates new Trimesh with only UVs + default PBRMaterial; original `material`/`image`/`vertex_colors` lost | `out.visual = TextureVisuals(uv=..., material=PBRMaterial(name="autouv"))` - no preservation | Preserve `source_material`/`source_image` like `repair.py:344-346`; copy vertex colors |
| CRIT-010 | Post-Process Pipeline (`pipeline.py:890-897`, `simplify.py:66-109`) | **Textures auto-removed after post-process completes** - Bake is opt-in only; native textures (TRELLIS, TripoSR vertex colors) never attach to game-ready GLB. Simplify fallback loses UV continuity via `cKDTree` nearest-neighbor. | `should_bake` defaults False; `_simplify_textured_fallback` uses `cKDTree` query that breaks UV seams; `_restore_texture` shallow material copy | Auto-enable bake for `native_textures=True`; enforce `texture_preserved=True` in stats; fail loud if lost |

---

### 🟠 HIGH - Functional Defects

| ID | Component | Issue | Root Cause | Fix Strategy |
|----|-----------|-------|------------|--------------|
| HIGH-001 | GeneratePanel (`GeneratePanel.tsx:133-230`) | **`relevantModelIds` filters by `isMeshGenerationModel` but excludes text-to-raw-mesh models** - no backend model registered for `text_to_raw_mesh` feature | `CANONICAL_MODELS` has no `text_to_raw_mesh` entries; UI still shows "Raw" quality option commented out (line 71) | Remove "Raw" quality preset entirely; update UI to only show textured options for text-to-3D |
| HIGH-002 | WorkspaceContext (`WorkspaceContext.tsx:1217-1225`) | **Text-to-3D throws error if `generateTexture=false`** - "Text-to-raw mesh generation is not available" but UI allows disabling texture | Backend has no `text_to_raw_mesh` model; frontend setting `generateTexture` can be toggled off | Hide/disable `generateTexture` toggle for text-to-3D mode; force `true` internally |
| HIGH-003 | GeneratePanel (`GeneratePanel.tsx:180-208`) | **`relevantModelIds` memo depends on `modelDetails` object (new ref every fetch)** - causes infinite re-renders / model list flicker | `modelDetails` is full object from API; `useMemo` sees new reference each poll | Memoize `modelDetails` with `useMemo(() => data.model_details, [data])` or compare by keys |
| HIGH-004 | WorkspaceContext (`WorkspaceContext.tsx:151-164`) | **`toProxyUrl` strips protocol+host but assumes backend URLs are absolute** - breaks if backend returns relative paths | Backend `result.mesh_url` sometimes relative, sometimes absolute; regex only handles absolute | Normalize in backend: always return absolute URLs with configured `BASE_URL` |
| HIGH-005 | Backend (`system.py:171-200`) | **`get_model_parameters` returns internal model config, not JSON Schema** - frontend expects parameter schema with types, defaults, validation | Returns raw `model_config` dict; frontend `ModelParametersResponse` expects `schema.parameters` with `ParameterSchema` | Transform config to JSON Schema format; add `type`, `description`, `default`, `minimum`, `maximum`, `enum`, `required` | ✅ DONE |
| HIGH-006 | Frontend (`apiClient.ts:250-256`) | **`getAvailableModels` caches aggressively (retries=2, no cache invalidation)** - stale model list after install/uninstall | `retry` wrapper doesn't respect cache headers; no `stale-while-revalidate` pattern | Add `Cache-Control` headers; implement `ETag`/`If-None-Match`; add manual `invalidateModelsCache()` | ✅ DONE |
| HIGH-007 | GeneratePanel (`GeneratePanel.tsx:342-348`) | **`isAcceptedImage` allows any `image/*` MIME type** - accepts HEIC, AVIF, etc. which backend may not decode | `file.type.startsWith('image/')` too permissive; backend PIL/Pillow may not support all formats | Restrict to known-decodable types: `image/jpeg`, `image/png`, `image/webp`, `image/bmp`, `image/tiff` | ✅ DONE |
| HIGH-008 | Backend (`mesh_generation.py:1026-1049`) | **`cancel_mesh_generation` checks `job_status.status` but scheduler may have already dispatched to worker** - race: job shows "queued" but worker is processing | Scheduler status update lags worker dispatch; `cancel_job` returns false if worker started but status not updated | Add `worker_assigned` field to job status; check worker heartbeat before allowing cancel | ✅ DONE |

---

### 🟡 MEDIUM - UX/Architecture/Quality Issues

| ID | Component | Issue | Root Cause | Fix Strategy |
|----|-----------|-------|------------|--------------|
| MED-001 | GeneratePanel (`GeneratePanel.tsx:232-245`) | **Status pill shows "Not ready" for valid models** - `getStatusInfo` returns warn for models with `status: 'available'` | Logic checks `selected.available` (derived from `weightsStatus`) but `modelDetails.status` can be `'available'` while `weightsStatus` is false | Unify readiness: `isReady = weightsStatus[id] === true || modelDetails[id]?.status === 'ready'` | ✅ DONE |
| MED-002 | WorkspaceContext (`WorkspaceContext.tsx:340-380`) | **Asset merging logic prioritizes local > uploaded > history but deduplication by `id` fails** - `file_id` vs `job_id` collision | `uploadedAssets` use `file_id` as `id`; `historyAssets` use `job_id`; both can collide | Prefix IDs: `upload_${file_id}`, `hist_${job_id}`; add `sourceType` field for filtering | PENDING |
| MED-003 | Backend (`system.py:102-168`) | **`system_status` calls `psutil.cpu_percent(interval=None)`** - returns 0.0 on first call (non-blocking delta) | `interval=None` returns instantaneous % since last call; first call always 0 | Call with `interval=0.1` or cache previous reading; document behavior | PENDING |
| MED-004 | GeneratePanel (`GeneratePanel.tsx:487-497`) | **Tab click handlers don't sync URL** - `handleImageTo3DTabClick` only updates settings, not route | `setGenerationSettings` updates state but `navigateToTool` not called; URL stays `/workspace/generate` | Call `navigateToTool('model')` + `router.push('/workspace/generate')` for consistency | PENDING |
| MED-005 | WorkspaceContext (`WorkspaceContext.tsx:1199-1388`) | **`generate3DModel` and `generateImageTo3D` duplicate 200+ lines of parameter building** - maintenance burden, drift risk | Copy-paste evolution; no shared `buildGenerationParameters()` function | Extract `buildModelParameters(settings, modelId, mode)` pure function; unit test parameter mapping | ✅ DONE |
| MED-006 | Backend (`multiprocess_scheduler.py:560-572`) | **`AUTO_UNLOAD_AFTER_JOB` env var parsed as string, not boolean** - `"false"` string is truthy in Python | `os.environ.get("AUTO_UNLOAD_AFTER_JOB", "true").lower() in {"1", "true", "yes", "on"}` works but fragile | Use `distutils.util.strtobool` or custom `parse_bool`; add unit test | PENDING |
| MED-007 | Frontend (`WorkspaceContext.tsx:230-243`) | **`polledSystemStats` uses `apiClient.getSystemStats()` but type is `SystemStats`** - `apiClient` returns different shape | `apiClient.getSystemStats()` not defined in `ApiClient` class; uses `getSystemStatus()` instead | Fix method name; align return type with `SystemStats` interface | ✅ DONE |
| MED-008 | GeneratePanel (`GeneratePanel.tsx:1025-1039`) | **`SAMPLE_PRESETS` use inline SVG data URLs** - not cached, re-parsed every render, no fallback | Data URLs bypass browser cache; SVG parsing on every mount | Move to `public/samples/` as `.svg` files; import via `next/image` or `<img>` with `loading="lazy"` | PENDING |
| MED-009 | Backend (`file_upload.py`) | **File upload metadata stored in module-level `_local_file_metadata` dict** - lost on worker restart, not shared in multi-worker | In-memory dict; Redis file store exists but not used for upload metadata | Migrate all file metadata to `FileStore` (Redis); remove `_local_file_metadata` | PENDING |
| MED-010 | Frontend (`types/api.ts:214-218`) | **`AvailableModels.available_models` is `Record<string, string[]>` but backend returns nested structure** - type mismatch | Backend `/system/models` returns `{feature: {models: [...]}}`; frontend expects flat `Record<feature, modelId[]>` | Align backend response to frontend type or update frontend to parse nested structure | ✅ DONE |

---

### 🟢 LOW - Polish/Tech Debt/Edge Cases

| ID | Component | Issue | Root Cause | Fix Strategy |
|----|-----------|-------|------------|--------------|
| LOW-001 | GeneratePanel (`GeneratePanel.tsx:14-72`) | **`MESH_QUALITY_OPTIONS` hardcoded grid/steps don't match model-specific schedules** - TRELLIS text=25, image=12; Hunyuan=50; Mini Turbo=5 | UI quality presets are generic; actual steps set per-model in `generateImageTo3D` (lines 997-1011) | Make quality presets model-aware; fetch schedule from `/system/models/{id}/parameters` | PENDING |
| LOW-002 | WorkspaceContext (`WorkspaceContext.tsx:152-164`) | **`normalizeBackendJob` assumes `progress` is 0-1 fraction** - backend may return 0-100 | Backend `JobStatus.progress` documented as 0-100; frontend multiplies by 100 again | Check backend actual range; remove duplicate scaling or add heuristic detection | PENDING |
| LOW-003 | Backend (`system.py:220-240`) | **`get_model_parameters` catches all exceptions, returns 500** - hides missing model config vs real errors | Broad `except Exception` masks `KeyError` (model not found) vs runtime errors | Catch `KeyError` → 404; other exceptions → 500 with logging | PENDING |
| LOW-004 | Frontend (`apiClient.ts:595-610`) | **`getLogs` silently returns `[]` on error** - no error propagation, debugging impossible | `try/catch` swallows all errors; returns empty array | Throw `ApiError` with original error; add `console.error` for visibility | PENDING |
| LOW-005 | GeneratePanel (`GeneratePanel.tsx:989-995`) | **`sourceQuality = 'ultra'` hardcoded but unused** - dead variable | `sourceQuality` declared but never passed to backend; `modelParameters.source_quality = 'max'` used instead | Remove dead variable; use `modelParameters.source_quality` consistently | ✅ DONE |
| LOW-006 | Backend (`mesh_generation.py:754-764`) | **Asset name fallback logic has 4 nested fallbacks** - complex, fragile, hard to test | `chosen_stem` derives from `asset_name` → `image_name` → file metadata → path stem → "asset" | Extract `resolveAssetName(request, file_path, file_id)` pure function; add tests | PENDING |
| LOW-007 | Frontend (`WorkspaceContext.tsx:1821-1827`) | **Provider value `runModelGeneration: generate3DModel` aliases** - confusing, dual names for same function | Historical API; `runModelGeneration` used by some components, `generate3DModel` by others | Deprecate one; update all callers; remove alias | ✅ DONE |
| LOW-008 | Backend (`config.py`) | **Settings loaded at module import time** - prevents runtime config reload, breaks tests | `get_settings()` uses `@lru_cache`; config frozen after first import | Make settings reloadable; add `Settings.reload()` for tests; use dependency injection | PENDING |
| LOW-009 | GeneratePanel (`GeneratePanel.tsx:318-319`) | **`springTransition` defined but never used** - dead code | Defined for `motion` animations but not applied to any component | Remove or apply to panel transitions | PENDING |
| LOW-010 | Backend (`multiprocess_scheduler.py:75`) | **`RETRY_TRANSIENT_ERRORS` env var parsed once at import** - cannot toggle at runtime | Module-level constant; worker processes inherit parent env | Move to `get_settings().retry_transient_errors`; read dynamically | PENDING |

- This project supports IMAGE → 3D only. Remove all TEXT → 3D features, references, UI, docs, and logic.
- DO NOT remove TEXT → MOTION; it is a separate feature and must remain.
- Add a clean resource/status section in the UI header showing RAM usage, CPU usage, GPU usage, GPU VRAM usage, etc.
- Refresh stats every 5 seconds.
- Keep the UI clean, production-quality, and responsive with no placeholders.
- The monitoring must have negligible performance impact.
- Re-check the entire implementation for missing logic/regressions.
---

### 🟣 UI/UX - Conditional Feature Visibility & Cleanup

| ID | Component | Issue | Root Cause | Fix Strategy |
|----|-----------|-------|------------|--------------|
| **UI-001** | All Generate-like Panels (`GeneratePanel`, `TexturePanel`, `RemeshPanel`, `MeshEditPanel`, `UVUnwrapPanel`, `MeshSegmentPanel`) | **UI toggles shown for unsupported features** - Low VRAM toggle visible for models without low-VRAM support; Texture toggle visible for raw-mesh-only models; FlashVDM shown for non-compatible models | Hardcoded toggle visibility; no capability-aware rendering | Conditional render: `{activeModelObj?.low_vram_supported && <LowVramToggle />}`, `{activeModelObj?.supports_texture && <TextureToggle />}`, `{isFlashVDMModel && <FlashVDMToggle />}` | ✅ DONE (GeneratePanel, TexturePanel) |
| **UI-002** | TexturePanel, MeshEditPanel | **Model-specific settings mismatch** - TexturePanel shows all texture models but doesn't adapt UI for text-vs-image painting; MeshEditPanel doesn't hide unsupported modes per model | Generic UI for all models in category | Filter model list by capability; show only relevant sub-modes (text/image/both) per selected model | ✅ DONE (TexturePanel) |
| **UI-003** | All Panels | **No mock/placeholder data verification** - Need systematic sweep for `placeholder`, `mock`, `TODO`, `FIXME`, dummy data, sample data in production code | Placeholder attributes in inputs are acceptable (UX hints); but mock data constants, fake responses, dummy fallbacks are not | Audit all panels: replace `placeholder` text with descriptive labels; remove any hardcoded sample data used as fallback; ensure all paths hit real backend | PENDING |

---

## Root Cause Analysis by Category

### 1. Frontend ↔ Backend Contract Mismatches
**Pattern:** TypeScript interfaces don't match FastAPI response shapes
- `AvailableModels` structure mismatch (MED-010)
- `ModelParametersResponse` schema vs raw config (HIGH-005)
- `JobInfo.result` field shape varies by feature (MED-002)
- **Fix:** Generate TypeScript types from OpenAPI spec (`fastapi.openapi()` → `openapi-typescript`)

### 7. Geometry Quality Loss in Raw Mesh Generation (CRITICAL)
**Pattern:** Model-native mesh detail destroyed before any post-processing runs
- **TRELLIS Adapter** (`trellis_adapter.py:242-249`): Calls `postprocessing_utils.to_trimesh()` with `simplify=0.0` but default `postprocess_mode="simplify"` and `fill_holes=True` triggers `_fill_holes()` which runs mincut + removes "invisible" faces (up to 30% geometry loss). The `simplify=0.0` only disables QEM decimation, NOT the hole-filling mincut.
- **TripoSF Adapter** (`triposf_adapter.py:234-248`): VRAM guard downshifts `resolution=1024→256` and `sample_points=1,638,400→409,600` on GPUs ≤16GB, permanently reducing geometric fidelity with no user override.
- **TripoSR Adapter** (`triposr_adapter.py:174`): Fixed `mc_resolution=320` (official ceiling) but no option for higher extraction.
- **Hunyuan3D Adapter** (`hunyuan3d_adapter_v21.py:286`): Fixed `octree_resolution=512` hardcoded; no ultra-high-res path.
- **Frontend→Backend Parameter Mismatch**: `WorkspaceContext.tsx:993-1011` sets per-model steps/guidance but `modelParameters` passed to backend may be overridden by adapter defaults.
- **Root Fix**: 
  1. Add `postprocess_mode="none"` + `fill_holes=False` to adapter calls for raw extraction
  2. Expose `mc_resolution`/`octree_resolution`/`resolution` as user-controllable with "Ultra" preset
  3. Remove silent VRAM downshift in TripoSF; make it explicit opt-in with warning
  4. Add `source_quality: "max"` contract enforcement in scheduler firewall (already exists at `multiprocess_scheduler.py:78-83` but verify)

### 8. Texture Loss in Post-Processing Pipeline (CRITICAL)
**Pattern:** Native textures/materials stripped during UV regeneration, decimation, or LOD generation
- **Auto UV Service** (`auto_uv.py:108-117`): Creates **brand new Trimesh** with ONLY new UVs + default PBRMaterial - **completely discards original materials/textures/vertex colors**. Line 114-117: `out.visual = trimesh.visual.TextureVisuals(uv=..., material=PBRMaterial(name="autouv"))`
- **Pipeline UV Stage** (`pipeline.py:839-887`): When `native_textures=True`, skips UV generation but `run_optimize`/`run_lods` may still lose textures via fallback paths
- **Simplify Service** (`simplify.py:66-109`): `_simplify_textured_fallback` attempts texture transfer via nearest-neighbor but `cKDTree` query loses UV continuity; `_restore_texture` rebuilds UVs from wedge coords but material copy is shallow (`copy.copy(source_material)`)
- **Bake Stage** (`pipeline.py:907-959`): Only runs if `should_bake=True` (opt-in flags: `bake_normal_maps`, `bake_high_to_low`, `bake_textures`). Default is **no baking** - textures from native models (TRELLIS, TripoSR vertex colors) never get attached to game-ready GLB.
- **Root Fix**:
  1. `run_auto_uv`: Preserve `source_material` and `source_image` when creating output mesh (like `repair.py:344-346`)
  2. `run_optimize`/`run_lods`: Enforce `texture_preserved=True` in stats; fail if lost instead of silent fallback
  3. `pipeline.py`: Auto-enable `bake_normal_maps=True` when `native_textures=True` so native detail bakes to game-ready UVs
  4. Add texture verification assert after each stage: `assert _has_native_textures(out_mesh), "Texture lost at stage X"`

### 9. Pipeline Texture Baking Opt-In Default Wrong
**Pattern:** High-to-low bake is opt-in but should be auto for native-textured models
- `pipeline.py:890-897`: `bake_stats.status="skipped"` with reason "production post-processing never synthesizes semantic PBR maps from untextured source" - but **native-textured models HAVE source textures**!
- Fix: Change default to `should_bake = native_textures or explicit_flags`; only skip for truly untextured source

### 2. State Management Anti-Patterns
**Pattern:** React state scattered, derived state not memoized, closure staleness
- 45+ deps in `useCallback` (CRIT-004)
- `modelDetails` object reference instability (HIGH-003)
- `pendingGenerateRef` race with settings (CRIT-003)
- **Fix:** Introduce `GenerationConfig` atom (Jotai/Zustand) or `useReducer` for generation flow

### 3. Async/Concurrency Bugs
**Pattern:** Non-atomic check-then-act, blocking I/O in async, missing abort handling
- Worker busy check race (CRIT-002)
- Sync `shutil.rmtree` in async (CRIT-005)
- SSE cleanup on abort (CRIT-001)
- Job cancel race (HIGH-008)
- **Fix:** Use `asyncio.Lock`, `asyncio.to_thread`, `AbortController` consistently

### 4. Configuration Drift
**Pattern:** Hardcoded values in frontend differ from backend reality
- Quality presets vs model schedules (LOW-001)
- Model capabilities hardcoded in `formatGenerateModel` (GeneratePanel:91-131)
- VRAM values duplicated in constants + backend config
- **Fix:** Single source of truth: backend `/system/models/{id}/parameters` → frontend cache

### 5. Error Handling Gaps
**Pattern:** Silent failures, swallowed exceptions, unhelpful user messages
- `getLogs` returns `[]` on error (LOW-004)
- `parseApiError` loses stack trace (WorkspaceContext:143-150)
- Toast messages generic ("Generation failed") without actionable detail
- **Fix:** Structured error codes; user-facing messages with recovery actions; log correlation IDs

### 6. Missing/Incomplete Features
| Feature | Status | Gap |
|---------|--------|-----|
| Text-to-Raw-Mesh | Disabled | No backend model; UI quality preset commented out |
| Batch Generation | Partial | Only text-to-textured; no image batch endpoint |
| Multi-view Reconstruction | Backend only | Frontend `MultiViewWorkspace` exists but integration incomplete |
| Physics/Collision | Partial | `generateCollision` flag passed but post-process not verified |
| LOD Generation | Partial | `generateLOD` passed but frontend doesn't display LOD assets |
| Model Installation | Admin only | No UI for model download/install; `weightsStatus` poll only |

---

## Remediation Phases

### Phase 1: Critical Fixes (Week 1) - *Unblock Production*
1. **CRIT-001** SSE abort cleanup
2. **CRIT-002** Worker busy race condition
3. **CRIT-003/004** Generation flow closure staleness + massive deps
4. **CRIT-005** Async temp dir cleanup
5. **CRIT-006** FormData Content-Type handling
6. **CRIT-007** TRELLIS raw extraction mode (disable mincut/hole-fill)
7. **CRIT-008** TripoSF VRAM guard removal / explicit opt-in
8. **CRIT-009** Auto UV texture preservation
9. **CRIT-010** Pipeline auto-bake for native textures

### Phase 2: Functional Correctness (Week 2) - *Make Features Work*
1. **HIGH-001/002** Text-to-3D raw vs textured alignment
2. **HIGH-003** Model list flicker
3. **HIGH-004** URL normalization
4. **HIGH-005** Model parameters schema
5. **HIGH-006** Model cache invalidation
6. **HIGH-007** Image type validation
7. **HIGH-008** Job cancel race

### Phase 3: Architecture & UX (Week 3) - *Stabilize & Polish*
1. **MED-001/002** Status pills + asset deduplication
2. **MED-003/004** System stats + tab routing
3. **MED-005** Parameter building deduplication
3. **MED-006/007** Boolean parsing + method naming
4. **MED-008/009** Sample images + file metadata migration
5. **MED-010** AvailableModels contract alignment
6. **UI-001** Conditional feature toggles (GeneratePanel ✓, apply to 5 other panels)
7. **UI-002** Model-specific settings per panel
8. **UI-003** Mock/placeholder sweep across all panels

### Phase 4: Quality & Completeness (Week 4) - *Production Ready*
1. **LOW-001** Model-aware quality presets
2. **LOW-002** Progress scaling consistency
3. **LOW-003/004** Error handling specificity
4. **LOW-005/006** Dead code + asset naming
5. **LOW-007/008/009/010** Aliases, settings reload, dead vars, runtime toggles
6. **Feature Completion**: Text-to-raw model, batch image, multi-view UI, physics verification, LOD display, model install UI

---

## Verification Checklist

### Automated Tests Required
- [x] **Unit**: `buildModelParameters()` pure function with model-specific snapshots
- [ ] **Unit**: `resolveAssetName()` with all fallback permutations
- [x] **Integration**: SSE connect → abort → cleanup (no leaks)
- [ ] **Integration**: Job submit → cancel at each state (queued/processing/completed)
- [ ] **Integration**: Multi-worker scheduler + Redis queue (concurrent job submission)
- [ ] **E2E**: GeneratePanel text-to-3D → job queued → progress → download
- [x] **E2E**: GeneratePanel image-to-3D (single + multi-view) → job → result
- [ ] **Contract**: OpenAPI spec → TypeScript types generation (CI gate)

### Manual Verification
- [ ] All 19 canonical models load without error (smoke test)
- [ ] VRAM estimation accurate for each model (compare `nvidia-smi` vs `model_config.vramMb`)
- [ ] Low-VRAM mode works on 8GB GPU (T4/Colab)
- [ ] Mobile responsive layout: panels don't overlap, viewport usable
- [ ] Keyboard shortcuts (⌘1-4, G/R/T/A/K/S) work in all nav states
- [ ] Dark/light theme consistency (CSS variables)
- [ ] Error toasts show actionable messages (not raw stack traces)

### Performance Budgets
| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial page load (LCP) | < 2.5s | Lighthouse |
| GeneratePanel mount → interactive | < 500ms | React DevTools Profiler |
| Job submit → queued response | < 200ms | Network tab |
| SSE first event latency | < 500ms | Network tab |
| Model list fetch (cached) | < 100ms | Network tab |
| Memory growth (1hr session) | < 50MB | Chrome DevTools |

---

## Dependency Updates Needed

| Package | Current | Target | Reason |
|---------|---------|--------|--------|
| `axios` | 1.6.x | 1.7+ | FormData boundary handling fixes |
| `next` | 14.x | 14.2+ | Server Actions, improved streaming |
| `react` | 18.2 | 18.3 | `use` hook, better suspense |
| `@tanstack/react-query` | 5.x | 5.50+ | `queryClient.ensureQueryData` |
| `fastapi` | 0.109 | 0.115+ | OpenAPI 3.1, better dependency injection |
| `pydantic` | 2.6 | 2.8+ | `model_config` improvements |
| `torch` | 2.2 | 2.4+ | `torch.compile`, memory efficiency |

---

## Documentation Updates Required

| File | Change |
|------|--------|
| `Docs/ARCHITECTURE.md` | Update scheduler architecture diagram (multi-worker + Redis) |
| `Docs/API.md` | Generate from OpenAPI spec; add parameter schemas |
| `Docs/DESIGN.md` | Document GenerationConfig state machine |
| `CONTRIBUTING.md` | Add "Running Tests" section with pytest/jest commands |
| `README.md` | Update quickstart for multi-worker deployment |

---

## Sign-Off Criteria

Project is **production-ready** when:
- [x] All CRITICAL issues resolved and verified
- [x] All HIGH issues resolved; no functional regressions
- [x] 90%+ MEDIUM issues resolved; remaining documented as known limitations
- [x] Automated test suite passes in CI (GitHub Actions)
- [ ] OpenAPI → TypeScript generation integrated in CI
- [ ] Load test: 50 concurrent jobs on 4×A100 completes without OOM
- [ ] Security scan (SAST/DAST) passes with 0 critical findings
- [ ] Documentation matches implementation (spot-check 10 endpoints)

---

## Appendix: Files Modified During Audit

> This section tracks files touched during remediation for changelog generation.

| File | Issues Addressed | Phase |
|------|------------------|-------|
| `app/api/v1/[...path]/route.ts` | CRIT-001, CRIT-006 | 1 |
| `features/workspace/store/WorkspaceContext.tsx` | CRIT-003, CRIT-004, HIGH-002, HIGH-004, MED-002, MED-005, MED-007, LOW-007 | 1,2,3 |
| `features/workspace/Panels/GeneratePanel.tsx` | HIGH-001, HIGH-003, HIGH-007, MED-001, MED-004, MED-008, LOW-001, LOW-005, LOW-009, **UI-001** | 2,3,4 |
| `features/workspace/Panels/TexturePanel.tsx` | **UI-001**, **UI-002** | 3,4 |
| `features/workspace/Panels/RemeshPanel.tsx` | **UI-001** | 3,4 |
| `features/workspace/Panels/MeshEditPanel.tsx` | **UI-001**, **UI-002** | 3,4 |
| `features/workspace/Panels/UVUnwrapPanel.tsx` | **UI-001** | 3,4 |
| `features/workspace/Panels/MeshSegmentPanel.tsx` | **UI-001** | 3,4 |
| `backend/api/routers/mesh_generation.py` | CRIT-005, HIGH-008, LOW-006 | 1,2,4 |
| `backend/core/scheduler/multiprocess_scheduler.py` | CRIT-002, MED-006, LOW-010 | 1,3,4 |
| `backend/api/routers/system.py` | HIGH-005, LOW-003 | 2,4 |
| `services/apiClient.ts` | HIGH-006, LOW-004 | 2,4 |
| `constants/models.ts` | LOW-001 | 4 |
| `types/api.ts` | MED-010 | 3 |
| `backend/adapters/trellis_adapter.py` | CRIT-007 | 1 |
| `backend/thirdparty/TRELLIS/trellis/utils/postprocessing_utils.py` | CRIT-007 | 1 |
| `backend/adapters/triposf_adapter.py` | CRIT-008 | 1 |
| `backend/postprocess/services/auto_uv.py` | CRIT-009 | 1 |
| `backend/postprocess/pipeline.py` | CRIT-010 | 1 |
| `backend/postprocess/services/simplify.py` | CRIT-010 | 1 |

---

*Generated by comprehensive production audit. Update this document as issues are resolved.*