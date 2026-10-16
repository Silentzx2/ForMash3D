# ForMash3D — Dev-Branch Upload, Image Preprocessing, Rigging & Export Audit

**Target repository:** `Silentzx2/ForMash3D`  
**Target branch:** `dev`  
**Audit date:** 2026-10-15  
**Purpose:** An implementation backlog for fixing upload truthfulness, durable raw-mesh storage, source/artifact identity, FBX export failure reporting, and image-to-mesh background-removal/crop defects that can introduce background geometry. This file is intentionally separate from the existing `Docs/TASKS.md`; do not overwrite that existing task document.

---

## 1. Executive summary

This review extends the earlier upload/storage/rigging audit to the actual `dev` branch image-preprocessing and export code. Three source-grounded issues deserve immediate attention alongside the original defects.

**Image-to-mesh preprocessing has no reliable “approved foreground” gate.** `backend/core/preprocess/image_enhancement.py::preprocess_image()` treats the mere presence of an alpha channel as proof that background removal is unnecessary. An RGBA image whose alpha is fully opaque is therefore skipped by the shared remover; its alpha bounding box can span the whole photograph, so `auto_crop` does not isolate the subject. In addition, `_realesrgan()` converts the image to RGB and returns RGB, discarding any subject alpha mask; converting it back to RGBA later only creates an opaque alpha channel, it does not restore transparency. The approved image can then reach a model adapter with the background still present or trigger another model-specific remover. These paths plausibly explain side slabs/rectangles around a centred subject, but the reported visual symptom was **not** reproduced in a running model during this source audit.

**The preview UI can mark a failed background-removal result as approved.** `_rmbg()` returns the original image with `rmbg_used=False` and an error when both providers fail, but `preprocess_image()` still writes an `approved.png` artifact and returns its ID. `GeneratePanel.tsx::previewEnhancement()` sets `enhancementEnabled=true` and stores the artifact ID even when `result.warning` is present; the UI then labels the state “Approved”. Crop/foreground statistics are recorded but are not enforced as a quality gate before inference. Model adapters also retain separate background-removal logic, creating unclear ownership and potential repeated processing.

**Export error handling is misleading at the UI boundary.** `features/workspace/Modals/ExportModal.tsx::handleExport()` creates an `<a>` for `selectedUrl`, clicks it, and closes the modal without reading an HTTP response. The `try/catch` cannot detect an HTTP 4xx/5xx from that navigation. A missing/expired artifact or a backend “native FBX unavailable” response can therefore look like a successful export, or the browser may save an error response using the chosen `.fbx` filename. The dedicated Blender conversion worker itself has timeout/cancellation and FBX re-import validation; this audit did not establish a separate intrinsic conversion-worker defect. The already documented rigging/output-path defects still affect which artifact is available and where it resolves.

### Highest-risk findings

1. **P0 — Silent upload fallback:** failed backend uploads become local blob assets, masking the original failure.
2. **P1 — Foreground mask can be lost or falsely trusted:** alpha-channel presence, rather than actual transparency, controls removal; upscaling drops alpha; the preview can still be marked approved after removal failure.
3. **P1 — Export UI does not verify HTTP success:** a missing/unavailable artifact can be treated as exported because the anchor-click path never checks a response.
4. **P1 — Buffered proxy + misleading progress boundary:** the frontend finishes sending to Next.js before the proxy begins backend transfer.
5. **P1 — Non-canonical rigging output / missing native FBX:** standalone UniRig output is written to shared `models/rigged`, and generated auto-rig does not persist the native child FBX in the parent workspace.
6. **P1 — Source/derivative confusion and fallback resolver defects:** requested master paths can resolve to derivatives, and a `system.py` fallback loop can ignore all path keys after the first.
7. **P1 — Metadata persistence failures can still return upload success:** the file may exist on disk while its returned `file_id` cannot be resolved later.

## 2. Audit scope, repository rules and constraints

The earlier repository review enumerated 747 tracked file entries. This extension re-checked the exact current `dev` HEAD and traced the existing upload/storage/rigging paths plus `features/workspace/Panels/GeneratePanel.tsx`, `features/workspace/utils/buildGenerationParameters.ts`, `backend/api/routers/image_enhancement.py`, `backend/core/preprocess/image_enhancement.py`, the Hunyuan3D and Unique3D image adapters, `backend/api/routers/mesh_generation.py`, `features/workspace/Modals/ExportModal.tsx`, `features/mesh-extras/ExportMeshDialog.jsx`, `features/utils/meshExport.js`, `backend/api/routers/mesh_tools.py`, `backend/postprocess/services/convert_fbx.py`, `backend/postprocess/tools/fbx_worker.py`, and the `system.py` artifact-download route. Relevant repo rules/docs and existing test foundations were also checked. Findings distinguish source-proven control-flow issues from likely explanations of the visual symptom. No local application run, browser reproduction, model inference, GPU test, or Blender export test was performed; none is claimed.

This is a deep, end-to-end audit of the **reported asset workflow and adjacent mesh-input paths**, not a claim that every unrelated module in the 747-entry repository was line-by-line audited. Implementation agents must still read all directly relevant caller code and current files again before changing them, because line numbers and branch state can move.

### Mandatory implementation constraints

- Follow `RULES.md` / Ponytail: understand the real flow first, fix root causes, reuse existing helpers, make the smallest correct diff, avoid speculative abstractions and dependencies.
- Preserve `master/source.glb` immutability for generated assets. Manual mesh operations must preserve the selected input as the master/source lineage and write their results as derivatives.
- Keep upload byte limits, file/format validation, root-constrained path resolution, and cancellation/cleanup protections. Do not “fix” oversized meshes by removing validation wholesale.
- In image preprocessing, distinguish an actual alpha mask from an alpha channel; preserve the mask through resize/upscale and validate the resulting foreground before marking an artifact approved. Preserve the original image and never mutate it in place.
- Establish one explicit background-removal ownership/status contract. Do not silently feed an unprocessed image to inference after removal failed, label a warned artifact “Approved”, or blindly delete all disconnected foreground components (some can be legitimate).
- For exports, verify the server response before claiming success. Keep native FBX and viewport GLB distinct; never rename an error response or a non-FBX file to `.fbx`.
- Do not change unrelated generation model behaviour or introduce a separate storage framework if existing `get_storage_base_dir()`, `OutputPathGenerator`, `FileStore`, `uploadMeshFile()`, and canonical post-process workspace helpers can be reused.
- Update the affected documentation required by `RULES.md`: at minimum `Docs/ARCHITECTURE.md`, `Docs/api-documentation.md`, `Docs/SECURITY.md`, `Docs/MEMORY.md`, `Docs/CHANGELOG.md`, and `README.md` as warranted by the final implementation. Do not use this audit as a reason to rewrite unrelated documentation.
- Existing `Docs/TASKS.md` is a separate Pixal3D implementation task and must remain untouched by this work.

---

## 3. Desired end-state contract

The implementation batches must converge on one observable contract:

1. A mesh is not marked as **uploaded/available for backend processing** until its bytes have been fully received, written, validated, and its durable file identity has been registered successfully.
2. Upload progress measures actual transport bytes (`loadedBytes / totalBytes`) and is labelled honestly. A completed browser-to-proxy transfer is not reported as a completed backend save; the UI reaches **Saved** only after the backend responds with a verified file ID and the stored byte size.
3. The uploaded original is retained unchanged in a stable, unique asset workspace under `storage/models/meshes/`. Its manifest records asset/file ID, original name, exact format, byte size, content hash, and canonical source path. Keep compatibility with existing `/api/v1/file-upload/download/{file_id}` IDs/routes while migrating storage.
4. Every tool receives an explicit, resolvable source identity. It must never infer a file from an arbitrary `storage/rigged` directory or rely on a browser-only blob URL for backend processing.
5. Direct and generated rigging both persist the native FBX (when actually produced) and a separate GLB viewport preview in the same canonical asset/job lineage. `artifact_format=fbx` and `artifact_format=rigged` resolve to their declared artifacts, never to a different file chosen by a broad glob.
6. The original source is never renamed to `.glb` unless a real conversion took place. Manual UV/retopology/segmentation/edit operations preserve the user-selected original source and record outputs as derivatives.
7. Invalid, oversized, failed, or interrupted uploads surface an explicit error and leave no fake success asset, orphan partial file, invalid metadata, or unrelated prior asset selected.
8. Image preprocessing validates actual alpha/transparency, crop bounds, foreground occupancy and likely background leakage. A failed/suspicious mask cannot be marked “Approved” or enter inference without a clear review/override path. Upscaling preserves the approved alpha mask; provider status and image provenance are recorded.
9. Background removal runs under a documented single-owner policy: known-good approved masks are not removed again by downstream adapters. If a model requires its own remover, that fallback is explicit, logged, and only used under a defined policy.
10. Export success is reported only after a successful response and valid artifact bytes. Native FBX is independently resolved and validated; an error payload must never be downloaded under an `.fbx` name.

### Suggested canonical layout

Keep the generated-asset layout already used by `backend/postprocess/pipeline.py`; extend it minimally for direct uploads and rigging:

```text
backend/storage/
  uploads/                         # optional temporary/compatibility ingress during migration
  models/meshes/<safe_asset>_<id>/  # one durable workspace per uploaded/generated asset
    master/
      source.<original-ext>         # immutable exact original for uploads (preserve its real format)
      source.glb                    # only when the source is GLB or a real GLB conversion was made
    rigging/
      <job-id>.fbx                  # native output, only if truly produced
      <job-id>.glb                  # separate viewport preview
    metadata/
      asset.json                    # file ID, size bytes, SHA-256, original format, lineage and artifacts
    previews/
      thumbnail.png
    ...derived folders as applicable...
```

This is a target contract, not a mandate to duplicate files. Prefer a single durable copy plus manifest references when the existing file-ID/download path can safely point to it. For generated jobs, preserve the existing `master/source.glb` contract. For uploaded `.obj`, `.ply`, `.fbx`, or `.gltf`, retain the original extension and bytes; do not write those bytes into a `.glb` file.

---

# Batch 1 — Upload truth, byte transfer and durable intake

**Batch objective:** Eliminate fake upload success and fix image-preprocessing trust/alpha handling before model inference. Do not start path migrations until UI entrypoints reliably distinguish a server-persisted asset from a local preview.

## UP-01 — Stop converting upload failure into a successful local-only asset

**Priority:** P0 · **Primary root cause**  
**Evidence:** `features/workspace/types.ts` — `createUploadedMeshAsset()` (~243–264) and `uploadMeshAsset()` (~265–296). `uploadMeshAsset()` catches every error and returns `createUploadedMeshAsset(file)`, which creates a `blob:` URL and has no backend `fileId`. Callers receive an apparently valid `ModelAsset`. `RiggingStudio.tsx` later refuses to rig it because no backend file ID exists, but the local mesh may already be visible in the viewport.

**Required fix:** Remove the silent fallback from the backend-upload contract. A failed upload must reject with the meaningful error (or return an explicit discriminated failure that every caller handles); it must not masquerade as a persisted server asset. If local-only preview is intentionally retained as a separate UX mode, keep it clearly marked as local/unuploaded, do not add it to the backend-asset catalogue as uploaded, and disable backend tools until a real upload succeeds. Reuse the existing helper instead of implementing per-panel fallback logic.

**Acceptance criteria:**
- A backend 400/413/500, network disconnect, missing file ID, or metadata persistence failure shows an error and creates no server-ready asset.
- The selected asset is not switched to an unuploaded blob asset on failure.
- Rigging, retopo, UV, segmentation and mesh-edit endpoints cannot be invoked with a local blob URL as a successful backend source.
- Successful upload returns an asset with a non-empty `fileId` and resolvable server URL.

**Regression coverage:** Mock the upload API to reject, to return no `file_id`, and to succeed. Verify failure is visible and no fake asset is inserted/selected; verify success yields a backend ID.

## UP-02 — Stream multipart uploads through the Next.js proxy instead of buffering them in RAM

**Priority:** P1  
**Evidence:** `app/api/v1/[...path]/route.ts`, `POST()` (~156–205). For `multipart/form-data`, the proxy calls `await request.arrayBuffer()` and wraps the entire body in a `Buffer` before starting the upstream `fetch`. A 40–200 MB model is therefore fully buffered by the Node process; concurrent uploads multiply memory pressure. The browser's upload progress measures bytes sent to the proxy, not bytes already received/written by FastAPI.

**Required fix:** Use a request-body streaming pass-through supported by the deployed Next.js/Node runtime, including the required `duplex: 'half'` behaviour for a streamed Node fetch body when applicable. Preserve the multipart `Content-Type` including its boundary, authorization forwarding, safe timeout/cancellation semantics, and configured request-size protections. Do not parse and rebuild `FormData` in the proxy. Confirm actual runtime support before choosing the smallest compatible implementation.

**Acceptance criteria:**
- Proxy memory use does not scale by allocating an entire extra upload-sized buffer for each request.
- The upstream request starts consuming bytes while the browser is still transmitting them.
- Multipart boundary/content headers remain valid, and cancellation closes upstream work and removes partial backend files.
- JSON requests and existing API routes continue to work.

**Regression coverage:** Proxy integration test with a streamed multipart body; test an interrupted stream and a large body under bounded memory. Verify upload success/failure status is forwarded correctly.

## UP-03 — Unify real mesh upload progress and units across every entrypoint

**Priority:** P1  
**Evidence:** `services/apiClient.ts` already supports `uploadMeshFile(file, onProgress?)`, but `features/workspace/types.ts::uploadMeshAsset()` does not forward progress and its callers show no upload progress. The Assets panel (`features/workspace/RightPanel/RightAssetsPanel.tsx`, `processModelFile()` around 81–147) passes `progressEvent.loaded` into `useUploadProgress()`, which expects **bytes**. Some `GeneratePanel.tsx` handlers pass a percentage into `updateProgress()`, which then divides it by `file.size` again; `useUploadProgress()` is shared but its caller contract is inconsistent. `finishUpload()` hides the active indicator immediately after the request resolves and sets 100%, without separately representing backend validation/registration. `readFileWithProgress()` reports local `FileReader` bytes, not network upload bytes.

**Required fix:** Define and use one progress unit. Prefer byte callbacks for byte-based state, or expose a percentage callback and never mix the two. Wire `uploadMeshAsset(file, onProgress)` through the existing `apiClient.uploadMeshFile()` callback and through the Assets/Rigging/UV/Remesh/Segmentation/Mesh Edit upload controls. Present a compact, accessible upload card with filename, actual `loaded / total` bytes, percentage, transfer state and error. Distinguish **Uploading** from **Verifying/Saving** and **Saved**; only server confirmation ends the operation. Keep `FileReader` progress labelled as local file reading where it is still used.

**Acceptance criteria:**
- A 40+ MB fixture increments loaded bytes from 0 to the actual total; percentage is monotonic and never based on a mismatched unit.
- Every mesh-upload control displays the same truthful status pattern.
- A cache hit in the 3D viewer cannot mark an upload complete; viewer load progress and upload progress remain independent.
- Failure/cancel resets or marks the card as failed, without stale 100% progress or a false success toast.

**Regression coverage:** Unit tests for byte-to-percent calculation and concurrent/repeated upload state; component tests for the main Assets and Rigging upload cards; test both known and missing transport totals.

## UP-04 — Persist uploads in a canonical per-asset workspace without losing the original bytes

**Priority:** P1  
**Evidence:** `backend/api/routers/file_upload.py::upload_file_with_validation()` (~254–350) writes to `storage/uploads/<file-type>/<id-prefix>/upload_<file-id>.<ext>`. This is a usable upload ingress path, but it is separate from `backend/postprocess/pipeline.py::canonical_asset_workspace()` (~394–425), which places durable generated assets under `storage/models/meshes/<asset>_<job-id>/` and snapshots the master to `master/source.glb` in `run_postprocess_job()` (~1217–1218). Uploaded meshes currently do not have an equivalent per-asset workspace/manifest before the user enters Rigging or other mesh tools.

**Required fix:** Reuse `get_storage_base_dir()`, the current file-ID generator, and canonical workspace conventions to assign an uploaded mesh a stable unique asset workspace. Record the exact original file name/format, actual byte size and SHA-256; preserve bytes and original extension. Avoid duplicate full-size copies where a manifest/path reference suffices. Keep the upload ID and download endpoint compatible with existing clients. The workspace root and all paths must remain within the configured storage root.

**Acceptance criteria:**
- A successful upload of GLB/OBJ/PLY/FBX (and supported GLTF policy) has one stable asset ID and canonical workspace that survives a backend restart according to the metadata policy in UP-05.
- The stored source has the same byte length and SHA-256 as the uploaded file.
- Re-uploading the same filename creates a distinct asset; no collisions or accidental overwrite.
- No processing derivative overwrites the uploaded master/source.

**Regression coverage:** Upload representative formats to a temporary storage root; compare stored hash/byte length; test duplicate names and path containment; test reading the source through the normal file-ID API.

## UP-05 — Make file metadata registration/durability part of upload success

**Priority:** P1  
**Evidence:** `backend/api/routers/file_upload.py::upload_file_with_validation()` (~328–333) calls `await store_file_metadata_impl(...)` but ignores whether the store succeeded. `backend/core/file_store.py::FileStore.store_file_metadata()` returns `False` when Redis registration fails. The upload handler can nevertheless return HTTP success and a `file_id` that the download endpoint cannot resolve. In single-worker mode, `backend/api/main_singleworker.py` creates an in-memory metadata store: uploaded bytes survive on disk, but the ID mapping is lost after a process restart. Expiration policy also conflicts: upload responses/metadata advertise expiry after 24 hours, while `backend/core/file_store.py` defaults its Redis TTL to zero unless `FILE_METADATA_TTL_SECONDS` is configured, and file list/download paths do not consistently enforce `expires_at`.

**Required fix:** Define whether uploaded user assets are durable or temporary. For the requested durable mesh library, persist the authoritative asset/file manifest on disk (or in the existing durable database layer) and use Redis/in-memory state only as a cache/index, not the only record of where bytes live. If the intended policy is temporary, enforce one explicit TTL and cleanup policy. Treat `store_file_metadata_impl`/metadata-manifest registration failure as upload failure and remove the newly written file/partial metadata atomically. Keep absolute server filesystem paths internal—`upload_file_with_validation()` currently includes `file_path` in its returned payload even though the browser can use the file ID and download URL. Do not introduce a new storage platform unless the existing manifest/job database cannot meet this contract.

**Acceptance criteria:**
- Upload success implies the returned file ID resolves to an existing file after the request and after process restart.
- A metadata-write failure returns a non-success response and leaves no orphaned successful-looking file.
- `expires_at`, Redis TTL, file list, metadata endpoint and delete/cleanup behaviour agree.
- Existing legacy uploads remain resolvable during migration, with explicit fallback—not broad, ambiguous asset guessing.

**Regression coverage:** Force metadata-store failure; restart/recreate the app state then download by ID; test expiration boundary and cleanup idempotency in single- and multi-worker configurations.

## UP-06 — Align size limits with mesh complexity limits and move heavy validation off the event loop

**Priority:** P1  
**Evidence:** Upload endpoint allows meshes up to 200 MB (`backend/api/routers/file_upload.py`, `upload_mesh()` ~375–399) but `backend/core/utils/file_utils.py` limits `MAX_MESH_VERTICES` and `MAX_MESH_FACES` to 210,000 (~34–35) and `validate_mesh_file()` (~201 onward) calls `trimesh.load(file_path)` synchronously. Consequently, a valid large/high-poly model can be rejected after transfer because of polygon count, and synchronous geometry parsing can block FastAPI's event loop. Since UP-01 currently masks a failed upload as a local blob asset, these limits can look like a successful upload followed by path errors.

**Required fix:** Keep hard byte, format and geometry/resource safeguards, but make their user-facing contract coherent. Document separate byte and geometry ceilings and return a precise validation error with the configured limit. Make complexity policy configurable only if the existing config pattern supports it; choose safe defaults based on measured memory/runtime, not intuition. Run expensive parsing in the existing bounded worker/thread/process mechanism (or FastAPI's threadpool) with sensible limits/timeouts, while preserving cancellation and cleanup. Do not allow malformed or resource-exhaustion files through just to make big uploads work.

**Acceptance criteria:**
- A valid file within the configured byte/complexity limits is not rejected by an undocumented stricter limit.
- A mesh exceeding a limit fails explicitly before it is made selectable; no silent fallback.
- Invalid/non-finite/empty geometry still fails safely.
- Concurrent uploads do not stall lightweight health/status endpoints during geometry inspection.

**Regression coverage:** Boundary tests at and just over byte/vertex/face limits; malformed mesh; async responsiveness with a mocked slow validator; cleanup after rejection.

## UP-07 — Treat `.gltf` consistently in backend format validation

**Priority:** P1  
**Evidence:** The mesh upload route's supported formats include `.gltf` (`backend/api/routers/file_upload.py`, `upload_mesh()` around 375–399), and `backend/core/utils/file_utils.py::MIME_TYPE_MAPPING` includes `model/gltf+json`/`.gltf` (~30–45), but `get_file_type_from_extension()` (~625–640) lists `.glb`, `.obj`, `.fbx`, `.ply`, and `.stl` while omitting `.gltf`. Therefore an uploaded `.gltf` passes the endpoint extension allowlist but is classified as `unknown`, skipping the mesh validation branch in `upload_file_with_validation()`.

**Required fix:** Use the existing central extension/type map as the source of truth for route allowlists, file type classification and frontend format labels. Add `.gltf` to mesh classification if the app supports it, and ensure frontend `ModelAsset.format` preserves `GLTF` rather than relabelling it `GLB`.

**Acceptance criteria:** `.gltf` cannot bypass mesh validation solely because the type classifier forgot the extension; each supported extension maps consistently through upload metadata, validation and asset display.

**Regression coverage:** Table-driven tests comparing supported mesh extensions, inferred type and frontend display format.

## IMG-21 — Preserve real foreground alpha across crop and upscaling

**Priority:** P1 · **Likely contributor to the reported side-rectangle geometry**  
**Evidence:** `backend/core/preprocess/image_enhancement.py::preprocess_image()` uses `had_alpha = "A" in image.getbands()` and only runs `_rmbg()` when `not had_alpha`. This tests the image mode, not whether the alpha channel contains useful transparency: an RGBA PNG with alpha=255 everywhere bypasses removal. `_alpha_bounds()` treats every alpha value above 8 as foreground; a faint edge/background speck can expand the crop back to almost the full image. Most importantly, `_realesrgan()` converts its input to RGB and returns an RGB image, dropping the alpha mask; the later `convert("RGBA")` only creates an opaque alpha channel and cannot restore the old mask. Hunyuan adapters inspect alpha minimum to decide whether to run their own background remover, while Unique3D also has adapter-level removal logic. Together these paths can deliver residual rectangular background pixels to image-to-3D inference or trigger a second removal pass. This is a code-supported failure path, not a claim that every reported artifact has the same cause.

**Required fix:** Add a shared helper that determines whether alpha has meaningful transparent/foreground pixels, not merely whether the mode includes `A`. Preserve a trusted alpha mask through resize/upscale (upscale RGB and alpha separately or reapply a geometrically aligned mask after the upscaler). Compute the subject bbox from a validated/binarized mask with configurable thresholds and sensible padding; handle non-square input without treating the entire opaque frame as a cutout. Record input dimensions/mode, real-alpha status, mask statistics, crop box, and whether the alpha mask survived every preprocessing operation. Preserve the original uploaded image and hash. Do not solve this by always re-removing an already-clean transparent subject or by deleting arbitrary mesh components.

**Acceptance criteria:**
- Opaque RGBA behaves like an opaque RGB/JPEG image and is not treated as an already-cut-out subject.
- A clean transparent PNG remains transparently cut out after crop and both RealESRGAN and Pillow fallback resizing.
- A non-square opaque RGBA photo cannot become “transparent subject approved” merely because square padding adds transparent pixels outside the original opaque rectangle.
- Crop bounds and mask area are derived from the verified subject mask, not a few weak alpha pixels at the edge.
- The model receives the verified preprocessed artifact with mask preserved; original source bytes/hash remain unchanged.

**Regression coverage:** Fixtures for RGB/JPEG, opaque RGBA, clean transparent RGBA, soft/antialiased alpha, alpha with a tiny edge speck, and a non-square image. Mock RealESRGAN success and fallback; assert the output mask geometry and alpha statistics are preserved. Include a case where the original alpha is fully opaque but the crop canvas gains transparent padding.

## IMG-22 — Validate background-removal and crop quality before approving inference input

**Priority:** P1 · **Input-quality gate**  
**Evidence:** In `backend/core/preprocess/image_enhancement.py`, `_rmbg()` returns the original image with `rmbg_used=False` and an error if the integrated and direct providers fail, but `preprocess_image()` still writes both `preview.png` and `approved.png` and returns an `artifact_id`. The result only exposes the removal error as a warning. In `features/workspace/Panels/GeneratePanel.tsx::previewEnhancement()` (~826–862), the returned artifact ID is assigned and `enhancementEnabled` is set to `true` even when `result.warning` is present; the panel derives its “Approved” label from `enhancementEnabled`. `subject_area_fraction`, `crop_box`, `rmbg_used`, and `rmbg_error` are recorded, but `backend/api/routers/mesh_generation.py` accepts the approved artifact without enforcing a foreground-quality decision. Downstream adapters have their own removal logic, so “approved” does not reliably mean the background was removed once and checked.

**Required fix:** Add/reuse a deterministic `inspect_foreground_mask` / `validate_preprocessed_image` helper in the existing preprocessing module. Have it calculate and record at least: whether alpha is genuinely transparent; transparent-pixel fraction; foreground bounding box and occupancy; crop improvement relative to original; mask coverage at image borders; connected foreground components/small-component ratio; and whether the mask/subject survives resizing. Set a structured state such as `already_transparent`, `removed`, `disabled`, `failed`, or `needs_review`, along with the provider, warning and validation reasons. Use conservative thresholds and surface borderline results for review rather than claiming that every disconnected component is noise. On provider failure, do not label the original image an approved background-removed artifact. Keep the existing explicit UI action to disable enhancement/use original, and require successful validation or an explicit user override before inference. Once a validated artifact is approved, pass its status/provenance through `JobRequest` and ensure downstream adapters do not re-run background removal by default; any required adapter fallback must be explicit and logged.

**Acceptance criteria:**
- If all removal providers fail, the UI never says “Approved”; the user sees a clear error/review state and can deliberately choose the documented original-input path.
- `enhancementEnabled=true` is not enough by itself: the API checks artifact status and refuses an unvalidated/failed artifact absent an explicit override.
- The preview surfaces crop/mask warnings before expensive model inference, with original and processed previews available for comparison.
- Logs/job metadata explain whether removal happened, was skipped because the mask was already valid, failed, or was intentionally bypassed.
- No automatic deletion of all disconnected foreground components; low-confidence masks are flagged for review.

**Regression coverage:** Mock both remover providers failing, returning invalid images, and succeeding with/without useful alpha. Test all-opaque alpha, near-full-frame bbox, tiny disconnected specks, border leakage, near-empty mask, and valid transparent cutout. Assert preview API status, UI approval state, generation endpoint rejection/override, and downstream no-double-removal contract.

---

# Batch 2 — Canonical source identity, artifact resolution and rigging output

**Batch objective:** Once upload IDs and bytes are trustworthy, route every mesh operation to the exact selected source and persist all outputs in that asset's canonical workspace.

## ASSET-08 — Preserve `artifact_format` when resolving job/source URLs

**Priority:** P1  
**Evidence:** `backend/api/routers/file_upload.py::resolve_input_reference_async()` (~644–695) strips the query string (`path_str = path_str.split("?", 1)[0]` around 678), so a URL such as `/api/v1/system/jobs/{job_id}/download?artifact_format=master` loses the `artifact_format=master` selector before resolution. Its fallback `get_file_path_impl()` (~171 onward) searches a workspace and returns `game_ready/*.glb` before `master/*.glb` (~190–208), so on metadata loss or ID/path fallback the resolved source may be an optimized derivative, not the requested master. Broad glob fallback also risks selecting an arbitrary matching asset when names overlap.

**Required fix:** Parse URL path and query separately. Route job artifact URLs through the existing job/artifact resolver using the explicit allowlisted `artifact_format` parameter. If only a raw file ID is supplied, resolve only that upload's recorded original. Replace ambiguous “first glob match” behaviour for canonical assets with manifest/ID-based deterministic resolution, retaining safe backward compatibility for legacy assets.

**Acceptance criteria:** `artifact_format=master` resolves only to the immutable master/source artifact; `glb` resolves to the declared GLB artifact; an unknown/missing artifact fails clearly instead of silently choosing a different one. Paths still pass storage-root validation.

**Regression coverage:** Test relative and absolute URLs, query strings, URL-encoded IDs, metadata missing, and workspaces containing both `master/source.glb` and `game_ready/*.glb`.

## ASSET-09 — Separate generation post-processing from manual mesh-tool lineage

**Priority:** P1 · **Source-integrity risk**  
**Evidence:** `backend/core/scheduler/multiprocess_scheduler.py::_handle_job_result()` (~1835 onward) runs the production post-process path for successful jobs with `output_mesh_path` when `postprocess_mode == "production_mesh"`. Several manual mesh APIs set this metadata, including `backend/api/routers/mesh_retopology.py` (~217), `mesh_uv_unwrapping.py` (~209), `mesh_segmentation.py` (~213) and `mesh_editing.py` (~276, ~385). `backend/postprocess/pipeline.py::canonical_asset_workspace()` (~394–425) chooses the job result's `output_mesh_path` as its raw candidate. `run_postprocess_job()` then snapshots it to `master/source.glb` (~1217–1218) and later loads that file as GLB (~1325 onward). Thus a manual tool's derivative may be promoted as the “source”, and OBJ/PLY bytes can be copied into a file ending in `.glb` without conversion, followed by an attempted GLB parse.

**Required fix:** Trace each manual endpoint's true input path and output contract. Distinguish “raw generation output to promote to master” from “operation applied to an existing uploaded/generated asset”. For manual operations, keep the requested input as immutable source/master (preserving its actual extension or performing a real explicit conversion); record the tool output in a named derived-artifact location. Do not funnel every `output_mesh_path` through the generation-specific source-snapshot logic. Reuse current `JobRequest` metadata, `canonical_asset_workspace()` and manifest structure; add only the minimal lineage signal needed to distinguish these workflows.

**Acceptance criteria:**
- A retopo/UV/segment/edit job never replaces the original user's source with the tool's output.
- `.obj` and `.ply` output is never written byte-for-byte to a path called `.glb`.
- All successful tool outputs are registered as derived artifacts with their real format and path.
- Generation jobs continue preserving their raw model output exactly and existing immutable-master parity tests remain valid.

**Regression coverage:** End-to-end-or-contract tests for manual OBJ/PLY input, GLB input, and generated raw output; assert master hash is unchanged and derived artifacts are separate.

## RIG-10 — Write standalone UniRig artifacts under the selected asset's canonical workspace

**Priority:** P1 · **Primary rigging path defect**  
**Evidence:** `backend/adapters/unirig_adapter.py::__init__()` (~63) uses `OutputPathGenerator(base_output_dir="outputs")`. In `backend/core/utils/file_utils.py`, `OutputPathGenerator` converts that to `<storage_base>/models`, and `generate_rigged_path()` (~704 onward) defaults to `subdirectory="rigged"`, producing shared `storage/models/rigged/<model-id>_<source-stem>_<timestamp-seconds>.<format>`. This is not the per-asset workspace under `storage/models/meshes/<asset>_<job-id>/`. The filename uses second-resolution time, so simultaneous jobs with the same model ID/source stem can collide.

**Required fix:** Have the standalone rig job carry a validated canonical source asset/workspace identity (from the uploaded asset manifest/file ID or the selected generated job). Create a unique rig job output directory under that asset's canonical workspace, e.g. `rigging/<rig-job-id>/`, and write both native FBX and GLB preview there. Prefer a unique job ID over timestamp-only uniqueness. Keep the existing adapter API contract by passing the resolved source path plus minimal output/workspace metadata; do not add a parallel storage abstraction. Ensure a source snapshot/reference exists before rigging and is never mutated.

**Acceptance criteria:**
- Rigging a just-uploaded mesh works directly from its actual stored source path.
- Outputs live under the same asset lineage, not a shared `storage/models/rigged` bucket.
- Two concurrent rig jobs on the same basename cannot overwrite each other.
- Original source hash is unchanged; GLB preview and native FBX are separate declared artifacts.

**Regression coverage:** Adapter/scheduler tests with a temp storage root; assert output paths remain under the workspace and two job IDs produce unique files.

## RIG-11 — Preserve the native FBX when generated assets use the auto-rig child workflow

**Priority:** P1  
**Evidence:** `backend/core/scheduler/multiprocess_scheduler.py::_watch_auto_rig()` (~1645–1780) obtains `child_result`, checks `child_result["output_mesh_path"]`, and copies that path into `asset_root/rigging/game_ready_rigged.glb` (~1697–1710). The function does not read/copy `child_result["output_fbx_path"]` (verified against the function body). `UniRigAdapter._process_request()` returns both `output_mesh_path` (converted GLB preview) and `output_fbx_path` (native FBX) (~225–250). As a result, the generated parent job records a rigged GLB but loses the native FBX within its workspace/manifest.

**Required fix:** Copy/validate the child FBX to a unique path in the parent asset's `rigging/` directory, register that FBX path and format in the parent result/manifest, and keep the GLB preview separate. If a child did not truly produce a native FBX, mark it unavailable/failed rather than fabricating one or converting with an unsupported generic converter.

**Acceptance criteria:** A parent auto-rig job that completes with UniRig has both a real preview GLB and a real FBX in the canonical asset workspace; `artifact_format=fbx` returns the native FBX. Missing FBX is reported honestly without corrupting the preview.

**Regression coverage:** Mock child result containing both files; assert both are copied, recorded and independently downloadable. Also test missing/malformed FBX.

## RIG-12 — Use one canonical artifact manifest/resolver for direct and generated rig jobs

**Priority:** P1  
**Evidence:** Generated jobs with `asset_root` use `backend/api/routers/system.py`'s canonical artifact selectors; for `artifact_format=rigged`, it looks for `asset_root/rigging/game_ready_rigged.glb` (~1445). Standalone rig jobs without an `asset_root` instead rely on `result["output_fbx_path"]` and `result["output_mesh_path"]` (~1490 onward), whose paths currently point to global `models/rigged`. These two flows deliver the same feature through different lookup rules and folder layouts; generated-job FBX selection does not resolve the rigging folder in the same way as its GLB counterpart.

**Required fix:** Declare the direct-rig workspace/artifacts in the same job result manifest contract as generated assets. Teach existing allowlisted artifact selection to find `rigging/<job-id>.fbx` and `rigging/<job-id>.glb` using explicit manifest paths. Continue to validate resolved paths under the configured storage root/workspace. Do not trust client-supplied absolute paths or fall back to arbitrary globbing. Keep legacy flat output references resolvable only through an explicit compatibility path.

**Acceptance criteria:** The same download selectors behave consistently for direct rigging and generation-followed-by-rigging; `glb`, `rigged`, and `fbx` each map to the correct declared artifact; unknown or absent formats return clear 4xx errors.

**Regression coverage:** Contract test both job shapes through the real system download route, including root containment and missing-file cases.

## RIG-13 — Fix the system download fallback loop so all declared path keys are checked

**Priority:** P1  
**Evidence:** `backend/api/routers/system.py` (~1504–1508) has:

```python
possible_keys = ["output_mesh_path", "mesh_path", "output_path", "file_path"]
for key in possible_keys:
    if key in result and result[key]:
        output_path = result[key]
    break
```

The `break` is indented inside the loop but outside the `if`, so only `output_mesh_path` is ever examined. Jobs that have a valid file only under `mesh_path`, `output_path`, or `file_path` incorrectly hit “No output file path found”. The same key-list/loop pattern occurs elsewhere in `backend/api/routers/system.py` (~1907 and ~2168) and must be checked, not patched at only one call site.

**Required fix:** Correct the loop/control-flow once at the shared helper if an existing common path can be reused; otherwise correct all equivalent instances. Keep path validation/containment after selection.

**Acceptance criteria:** Each supported result key resolves when it is the only available key; a later key is never ignored because an earlier one is absent. Existing preferred-key precedence stays intact.

**Regression coverage:** Parameterized tests with each of the four keys used individually plus an empty result and a path outside the allowed root.

## RIG-14 — Remove synthetic rig-generation progress increments

**Priority:** P2  
**Evidence:** `stores/useRiggingStore.ts::pollRigJob()` (~145–185) increments `generationProgress` by 1 or 2 on each poll while a job is queued/processing, capping at 90. It does not derive these values from backend progress. It can imply progress even if the job is stalled, making a second progress indicator dishonest.

**Required fix:** Use the real `statusRes.progress` / stage data if the API returns it. If the backend does not provide a reliable percentage, use an indeterminate spinner and honest phase/status text rather than synthesizing percentage. Do not modify real job polling/retry/resume behaviour unnecessarily.

**Acceptance criteria:** A stalled job does not accrue progress; completed jobs reach 100 only on completion; queued/processing state remains visible and accurate.

**Regression coverage:** Poll responses with fixed, changing, absent and failed progress values; assert the UI never invents percentage.

---

# Batch 3 — Mesh-tool entrypoints, format edge cases, safety and regression closure

**Batch objective:** Make every tool entrypoint use the same upload contract, close secondary input-validation gaps, and lock the entire workflow with regression tests and current docs.

## TOOL-15 — Ensure uploaded meshes are inserted into the workspace before selecting them

**Priority:** P1  
**Evidence:** `features/workspace/store/WorkspaceContext.tsx::setCurrentAsset()` (~1244) delegates to `selectAsset(asset.id)` and only selects an ID; it does not add a new object to `assets`. These panel handlers call `setCurrentAsset(await uploadMeshAsset(file))` without first adding the returned asset:

- `features/workspace/Panels/UVUnwrapPanel.tsx` (~42–44)
- `features/workspace/Panels/RemeshPanel.tsx` (~43–47)
- `features/workspace/Panels/MeshSegmentPanel.tsx` (~91–94)
- `features/workspace/Panels/MeshEditPanel.tsx` (~159–162)

Unlike `RightAssetsPanel.tsx` and `RiggingStudio.tsx`, these routes can select an ID that is not yet in the workspace list/current selection derivation, leaving a stale/no asset or relying on a later uploaded-assets query refresh.

**Required fix:** Reuse the existing `addAsset()` + `setCurrentAsset()` flow in these four handlers or add the minimal shared import action to `WorkspaceContext` if that reduces duplication. Only add after upload success. Do not duplicate upload/storage logic in each panel.

**Acceptance criteria:** Immediately after upload, the same asset appears in the Assets list, becomes the actual current asset, displays its backend ID/source URL, and can be passed to the tool request without waiting for background refetch.

**Regression coverage:** Component/context tests for each panel's upload path; ensure failed upload does not add/select an asset and a previous selection is not accidentally submitted.

## TOOL-16 — Define safe single-file `.gltf` handling or support its external dependencies

**Priority:** P1  
**Evidence:** `RightAssetsPanel.tsx` accepts `.gltf` as a single file (~85 onward) and builds a download URL for only that uploaded file (~110–147). `features/workspace/types.ts` / upload UI map `.gltf` to `GLB`. A textual glTF file commonly references external `.bin` buffers and texture files by relative URI; uploading only the `.gltf` JSON does not include those dependencies, so later loading/rigging may fail despite a successful HTTP upload. UP-07 covers backend type validation; this task covers runtime packaging and truthful format support.

**Required fix:** Choose an explicit supported policy: either support `.gltf` as a package/folder/ZIP with every referenced resource validated, stored together and safely resolved, or reject external-resource `.gltf` with a clear message and support only self-contained glTF/GLB assets. Do not silently rewrite arbitrary references or mislabel GLTF as GLB. Preserve security checks against path traversal and remote URI fetches.

**Acceptance criteria:** Self-contained supported files load correctly. A `.gltf` that references missing/external sidecars either loads all validated bundled dependencies or fails before being marked as a usable asset with an actionable error.

**Regression coverage:** Fixtures for GLB, self-contained glTF, glTF with relative `.bin`/texture files, missing sidecar, and malicious `../` reference.

## SEC-17 — Bound mesh base64 decoding before allocating decoded bytes

**Priority:** P1 · **Security/resource guard**  
**Evidence:** `backend/api/routers/mesh_segmentation.py` (~155 onward) calls `base64.b64decode(request.mesh_base64)` then writes the decoded content to a temp file. There is no encoded-size ceiling in that path before decoding. `Docs/SECURITY.md` explicitly requires base64 upload payloads to be rejected using their encoded-size ceiling before allocating the decoded byte buffer. Other shared helper code in `backend/core/utils/file_utils.py::validate_base64_data()` already accepts a `max_bytes` argument, so reuse the existing validation approach.

**Required fix:** Enforce the encoded-size ceiling before decoding, validate the decoded payload and extension/format contract, and use the existing shared base64 validator/helper where compatible. Preserve temp cleanup for all terminal states. Avoid duplicating a new decoder.

**Acceptance criteria:** Oversized encoded payloads fail before allocating the full decoded mesh; malformed base64 is rejected; valid payloads still work; temporary inputs are cleaned on failure/cancellation as appropriate.

**Regression coverage:** Exact-boundary and over-limit tests, malformed base64, valid GLB and invalid mesh bytes. Add a test that verifies rejection occurs before `b64decode` for a clearly oversized string.

## PERF-18 — Keep mesh parsing/validation from blocking the async API event loop

**Priority:** P1  
**Evidence:** `backend/api/routers/file_upload.py::upload_file_with_validation()` awaits the byte-by-byte file write and then calls `validate_mesh_file()` synchronously (~305–315). `backend/core/utils/file_utils.py::validate_mesh_file()` (~201 onward) imports and calls `trimesh.load(file_path)`, may concatenate a scene, computes statistics and enforces complexity limits—all potentially expensive CPU/RAM work. In an async FastAPI handler this synchronous parse can block other work on the same event loop.

**Required fix:** Reuse FastAPI/AnyIO's existing threadpool or the project's bounded worker mechanism for CPU-heavy validation. Keep the byte-size limit before parse, use bounded concurrency/timeouts where available, and avoid duplicate copies of the mesh in memory. Make validation cancellation/error cleanup predictable; do not shift unbounded heavy parsing into uncontrolled background tasks.

**Acceptance criteria:** Large but valid supported files can be validated without freezing health/status/other upload responses; concurrent parser count remains bounded; invalid files still return explicit errors and release temporary files/resources.

**Regression coverage:** Async test with a deliberately slow/mocked parser while a lightweight route is served; test validator exception, cancellation and byte-limit failure cleanup.

## STORAGE-19 — Clean up uploaded thumbnails with the corresponding file

**Priority:** P2  
**Evidence:** `backend/api/routers/file_upload.py::upload_mesh()` schedules thumbnail creation at `_THUMBNAIL_DIR / f"{file_id}.png"`; the delete route (`DELETE /file-upload/{file_id}`, ~445–480) removes the uploaded file and metadata but does not remove the corresponding thumbnail. Repeated upload/delete cycles leave orphaned PNGs under upload storage.

**Required fix:** Extend the existing delete/cleanup path to remove only the matching thumbnail and any manifest-owned workspace/artifacts that the delete contract explicitly owns. Validate every resolved path under the storage root and keep shared/parent job assets safe. Make repeated deletes/cleanup idempotent; do not recursively delete a workspace merely because a filename contains the same ID.

**Acceptance criteria:** Deleting an uploaded asset removes its associated thumbnail and registered upload source; it does not delete unrelated files or a parent generated job's artifacts. Failed cleanup is logged and reported in a controlled way.

**Regression coverage:** Delete twice; thumbnail present/missing cases; malicious IDs/root containment; verify unrelated sibling assets survive.

## EXP-21 — Report export failures from the actual HTTP response

**Priority:** P1  
**Evidence:** `features/workspace/Modals/ExportModal.tsx::handleExport()` resolves a URL from `currentAsset.artifacts`, creates an anchor, clicks it, and closes the modal. Its `try/catch` only catches synchronous DOM/download-trigger errors; it never reads the HTTP response or validates `response.ok`. An expired/missing artifact or a backend HTTP 4xx/5xx (including the documented “native FBX artifact unavailable” response from `backend/api/routers/system.py`) therefore does not set the UI error, and can be downloaded as an error body under the selected `.fbx`/other extension. This is separate from the known artifact-path issues tracked by RIG-10 through RIG-13.

**Required fix:** Use a response-aware download path for these artifact URLs: fetch the resource, check `response.ok` and content type before creating a Blob/download, parse the backend error detail for a useful UI message, and only close the modal after a successful response has been accepted for download. Preserve the intended filename/content-disposition behaviour; revoke temporary object URLs; respect authentication and existing same-origin/proxy semantics. Never rename or retry an error response as an FBX. Keep native FBX availability errors distinct from generic conversion failures. Audit similar anchor-only export actions such as the rigging export button if they use the same API-backed URL contract.

**Acceptance criteria:**
- A successful GLB/OBJ/FBX/ZIP response starts a download with the correct extension and closes the modal only after success is confirmed.
- HTTP 404/422/500, JSON error bodies, network disconnects and invalid content types show an actionable error and do not save a file bearing the requested mesh extension.
- Missing native FBX is shown as “FBX unavailable / rig required” rather than an apparent success.
- Download requests do not bypass required credentials, and temporary object URLs are cleaned up.

**Regression coverage:** Mock success and error status responses for source, game-ready and FBX artifacts; verify file extension/content type, modal state, displayed error and no fake download. Add a route-level test for unavailable `artifact_format=fbx` and a UI contract test that checks `response.ok` before the download begins.

## QA-20 — Add one cross-layer regression suite and update workflow documentation

**Priority:** P1 · **Exit gate for all batches**  
**Evidence:** Existing test foundations include `backend/tests/test_filestore_thumbnail.py`, `backend/tests/test_dev_deep_contract.py` (canonical workspace and artifact-manifest contract tests), `backend/tests/test_api_contracts_lifecycle.py`, `backend/tests/test_review_audit.py`, `backend/tests/test_official_model_parity_contract.py`, and `scripts/verify_contracts.py`. Existing tests cover portions of storage, model parity and canonical post-processing, but the identified failure modes must be connected end-to-end: original image → foreground mask/remove/crop/upscale validation → approved artifact → image-to-mesh inference → mesh quality review, as well as browser upload → stored file ID/path → workspace selection → tool/rigging request → correct artifact download/export.

**Required fix:** Extend the existing tests instead of creating an unrelated duplicate test framework. Tests must cover: upload failure does not fall back to a server-ready blob; byte count/hash match for a large mesh; proxy progress versus backend persistence; metadata write failure/restart; GLTF type/dependency policy; exact selected source resolution; manual operation source immutability; direct rig output workspace; generated auto-rig FBX+GLB manifests; all system download fallback keys; HTTP-aware export failure handling; native FBX worker/result validation; all tool upload handlers inserting/selecting the asset; malformed/oversized base64; and safe cleanup. For preprocessing, test RGB versus opaque RGBA versus real transparent PNG; alpha-mask survival through RealESRGAN and fallback resize; provider failure must not yield an “Approved” artifact; bbox/mask/border/component heuristics are recorded and gated; and a validated mask is not silently reprocessed by model adapters. Update only affected architecture/API/security/changelog/current-state docs. Do not claim GPU E2E success from unit/source-contract tests.

**Required local checks before marking complete** (run from the repository in the actual project environment):

```bash
bun run test
bun run lint
bun run build
python3 -m compileall -q backend/
python3 scripts/verify_contracts.py
bash -n backend/scripts/*.sh scripts/*.sh
```

Also run focused upload/storage/rigging, preprocessing/mask, and export tests while iterating. Use `agent-browser` to verify upload status, the Generation Preview approval/error state, and export error handling. Use a valid mesh over 40 MB and a file intentionally beyond configured limits. Test a transparent cutout, opaque RGBA photo, soft edge, failed remover, and upscaler mask preservation. Exercise the FBX conversion with a supported Blender runtime and re-import check where available. GPU-dependent model inference and real Blender export must be separately labelled “not run” unless actually tested in those environments.

**Acceptance criteria:** All listed checks have actual recorded outcomes (pass/fail/skipped with reason); there is no success claim for unavailable GPU/browser checks; docs explain the final path contract; no unrelated files or `Docs/TASKS.md` are modified.

---

## Export audit note — confirmed path/UI issues versus converter implementation

The current `dev` implementation of `backend/postprocess/services/convert_fbx.py` isolates Blender in a subprocess, serializes conversion through a semaphore, supports a timeout/cancellation check, and verifies the worker result and output file. `backend/postprocess/tools/fbx_worker.py` imports the GLB with the “Temperance” bone heuristic, removes bone-widget scene objects, exports the FBX, and re-imports it to validate mesh/armature/animation take counts. Static source review did **not** prove another intrinsic defect in that isolated converter. The actionable export findings are the existing path/manifest issues (RIG-10 through RIG-13) plus **EXP-21**, where the UI closes on an anchor click without checking whether the requested artifact endpoint actually returned a file. Regression tests must still execute Blender in a supported environment to establish runtime correctness.

---

## 4. Implementation order and dependencies

1. **Complete UP-01 through UP-03 first.** Without truthful upload status and consistent progress, later fixes cannot be verified reliably.
2. Complete UP-04 through UP-07 and IMG-21/IMG-22 before relying on model inference from processed images. The preprocessing contract must distinguish opaque images, already-transparent cutouts, successful removal, failure and review-needed masks.
3. Complete ASSET-08 and ASSET-09 before RIG-10 through RIG-13, establishing the selected source and derivative lineage.
4. Complete RIG-10 through RIG-14, TOOL-15 and TOOL-16; verify direct rig and generation-followed-by-rig paths separately.
5. Complete EXP-21 so the UI tells the truth about artifact download failures; then complete SEC-17, PERF-18 and STORAGE-19.
6. Run QA-20 across the combined image → mesh → rig/export paths. Do not mark a batch done based only on source inspection; use regression checks and separately record GPU/Blender/browser checks that could not run.

## 5. End-to-end manual verification checklist

- [ ] Preprocess the same subject as RGB/JPEG, opaque RGBA, clean transparent PNG and soft-alpha PNG. Compare original and approved preview, foreground bbox/occupancy, border mask and warnings.
- [ ] Force RealESRGAN success and Pillow fallback on an image with a real alpha cutout; verify the subject mask survives both paths and no opaque rectangle is introduced around transparent padding.
- [ ] Force both background-removal providers to fail. Confirm the artifact is failed/needs-review, not “Approved”, and generation is blocked unless the user deliberately chooses the documented override/original-input path.
- [ ] Use an input with a small alpha speck or residual border. Confirm crop/mask validation flags the suspicious result; do not automatically delete every disconnected subject part.
- [ ] For a validated transparent input, confirm downstream model adapters do not run a second background-removal pass unless explicitly required by their declared capability and recorded in job metadata.
- [ ] Run FBX export through `ExportModal` and the Mesh Tools conversion flow. On success verify a real FBX file; on 404/422/500 verify an actionable error, no fake `.fbx` download, and no modal-close success state.
- [ ] For direct rigging and generated auto-rig, verify `artifact_format=fbx` downloads a real native FBX, GLB preview remains separate, and the exported FBX re-imports with the expected mesh, armature and animation takes in a supported Blender environment.

- [ ] Upload a valid GLB larger than 40 MB from Assets. Observe monotonic byte progress; do not load/mark ready before backend success; compare browser file size/hash with backend manifest and download.
- [ ] Repeat through Rigging, Remesh, UV Unwrap, Segmentation and Mesh Edit upload controls. Confirm the same backend file ID is selected and no panel shows a stale asset.
- [ ] Simulate backend rejection and network interruption. Confirm a visible error, no fake local-only “uploaded” asset and no partial server file/metadata.
- [ ] Restart the backend after a successful upload; confirm the ID resolves according to the documented retention policy.
- [ ] Select an uploaded raw mesh and open Rigging. Confirm the request reads the exact selected source path, creates a unique per-asset rig job directory, and leaves the source hash unchanged.
- [ ] For direct and generation-followed-by-rigging jobs, confirm native FBX and GLB preview are stored separately and each `artifact_format` downloads the correct file.
- [ ] Select a generated asset's master/raw source. Confirm a request for `artifact_format=master` never returns `game_ready` and a manual tool never replaces master/source with its derivative.
- [ ] Exercise GLB/GLTF/OBJ/PLY/FBX/STL support per the final allowlist, including missing GLTF sidecars and an oversized/high-complexity file.
- [ ] Confirm job progress comes from backend state or stays indeterminate when a real percentage is unavailable; no timer-based/synthetic increase.
- [ ] Delete an uploaded mesh and confirm its thumbnail is cleaned up while adjacent and parent-job artifacts remain intact.

## 6. Out of scope / non-goals

- Do not refactor all storage or rewrite the full generation/post-processing pipeline.
- Do not disable mesh geometry validation, path allowlists, byte limits or file-ID checks to make a problematic upload appear to work.
- Do not turn a browser `blob:` URL into a fake backend path or place uploaded sources under `storage/models/rigged/`.
- Do not attempt unsupported FBX conversion just to make the download button return a file.
- Do not change the existing model generation fidelity settings to compensate for bad foreground input. Fix the image/mask contract first.
- Do not run background removal blindly twice, discard all disconnected mask components, or mark an unverified preprocessing result approved just to continue generation.
- Do not claim a successful export from an anchor click alone or save an HTTP error payload with a mesh extension.
- Do not overwrite the repository's `Docs/TASKS.md`; this root-level `TASKS.md` is the new audit backlog artifact.

