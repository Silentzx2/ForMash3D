## 2026-10-16 — Asset Lineage, Canonical Workspaces & Rigging Artifacts (Batch 2)

- **ASSET-08**: Preserved `artifact_format` query parameter during asynchronous job and asset reference resolution (`file_upload.py`), ensuring master source and format selectors are not stripped on fallback.
- **ASSET-09**: Separated manual mesh-tool lineage (retopology, UV unwrap, segmentation, mesh editing) from raw model generation output in `postprocess/pipeline.py`; manual tools save output to `derived/` preserving true file format and leaving master source immutable.
- **RIG-10**: Relocated standalone UniRig outputs to the selected asset's canonical workspace (`rigging/<job-id>/`), eliminating shared global storage collisions and maintaining source immutability.
- **RIG-11**: Preserved native FBX in generated auto-rig child workflow alongside converted GLB preview; registered both `output_fbx_path` and `output_mesh_path` in parent job results and job manifests.
- **RIG-12**: Unified artifact manifest resolver for direct and generated rig jobs in `system.py::download_job_result`, supporting `glb`, `rigged`, `fbx`, and `master` with clear 422 errors for unrigged assets.
- **RIG-13**: Replaced early-breaking loop with `first_result_path()` across all result resolution sites in `system.py` ensuring every declared key is checked in preferred precedence order.
- **RIG-14**: Eliminated synthetic `generationProgress` incrementing in `stores/useRiggingStore.ts`; added deterministic progress and status derivation in `features/workspace/lib/riggingProgress.ts`.

## 2026-10-16 — Upload Truth, Byte Transfer, Durable Storage & Quality Suite

- **UP-01 to UP-07**: Removed local blob fallback in MeshViewer drag-drop; wired canonical `uploadMeshAsset` and `uploadImageFile`; aligned client size limit to 200MB matching FastAPI; added `mesh_stats` to `FileUploadResponse`; unified `.fbx` and format accept lists across all panels.
- **TOOL-15**: Guaranteed newly uploaded meshes are inserted into the workspace before selection in `WorkspaceContext.tsx` via `setCurrentAsset()`, and safely handled null asset resets across UVUnwrap, Remesh, MeshSegment, and MeshEdit panels.
- **TOOL-16 & UP-07**: Enforced safe single-file glTF policy across frontend (`fileValidation.ts`) and backend (`file_utils.py`); embedded data URIs are supported while external sidecars/bin files are rejected with actionable errors.
- **SEC-17 & PERF-18**: Bounded base64 mesh decoding before allocation and executed heavy geometry validation in AnyIO threadpool off the FastAPI event loop.
- **STORAGE-19**: Asset deletion cleanly removes corresponding thumbnails and empty manifest-owned workspaces under canonical storage.
- **EXP-21**: ExportModal and artifactDownload verify HTTP responses, check content types, parse error details, and preserve source formats (GLB/GLTF/OBJ/PLY/FBX/STL).
- **QA-20**: Verified full QA suite across TypeScript, Node test runner, pytest security/rigging/preprocessing contracts, Python compileall, and shell syntax checks.

## 2026-10-16 — Image Foreground Validation and Approval

- Detect useful source alpha from pixel transparency rather than channel presence, and preserve the mask through RealESRGAN and Pillow resizing.
- Record foreground occupancy, bounds, crop improvement, border coverage, connected components, and resize survival before approval.
- Write approved artifacts only for validated results. Failed removal is blocked, and suspicious previews require an explicit generation override that is preserved in job provenance.
- Added preprocessing and generation-contract regression coverage; GPU/model and browser validation remain runtime-gated.

