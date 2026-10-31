# Hi3D v1.0 Integration Proposal

**Status:** Proposal only — approval required before any Hi3D integration work  
**Date:** 2026-10-27  
**Scope:** Research, architecture fit, and an implementation plan. This document does **not** clone or vendor Hi3D, install dependencies, download weights, change registries, or expose an API/UI path.

## 1. Decision requested

Please explicitly approve or reject a later implementation batch for Hi3D v1.0 under the constraints in this proposal.

Approval would authorize, as a separate final batch:

1. Pinning and vendoring the reviewed Hi3D source revision without upstream `.git` metadata.
2. Creating an isolated Hi3D runtime rather than changing the shared model environment in place.
3. Adding a backend refinement adapter and the required disabled/unavailable-by-default manifest contract.
4. Adding download/checkpoint verification and CPU/source-contract tests.
5. Running hardware-gated GPU validation before enabling the feature.
6. Only after acceptance, adding an explicit refinement API action and a UI entry point if the product owner wants them.

Approval does **not** mean that the model is accepted for automatic routing, that the 1536³ path is supported, or that the current shared Python environment may be downgraded/upgraded to satisfy Hi3D.

## 2. Executive recommendation

**Recommended decision: conditional approval for a backend-only, explicit second-stage refinement integration; do not approve automatic image-to-3D routing yet.**

Hi3D v1.0 is not a drop-in single-image generator. Its official pipeline takes a reference image and a same-object coarse mesh, then refines that mesh. The existing ForMesh3D image-to-raw-mesh contract is image-only and produces the coarse/raw master. Hi3D should therefore be a distinct `image_mesh_refinement` capability and job stage, not another candidate under the existing `image_to_raw_mesh` planner route.

The first implementation should support only an explicitly selected resolution that has been measured on the target hardware. Start with 512³ or 1024³; keep 1536³ disabled until a compatible high-memory GPU run proves peak memory, completion, output quality, and cleanup. Hi3D requires Linux, Python 3.10, NVIDIA compute capability 8.0+, CUDA 12.0–12.5, and has no CPU path. It should not be advertised as available on CPU mode or pre-Ampere GPUs.

## 3. Upstream identity and revision

| Item | Reviewed fact / proposal |
|---|---|
| Official source | `https://github.com/hi3d-official/Hi3Dv1.0` |
| Upstream branch | `main` |
| Reviewed revision | `13657ad09afaa92e350b461a1cd66399e44a59c4` |
| Revision evidence | GitHub API reports this as the current `main` commit during review; the commit has a verified GitHub signature. |
| Upstream release description | High-resolution 3D geometry refinement built upon Sparc3D. |
| Model artifact source | `https://huggingface.co/hi3d-official/Hi3Dv1.0` |
| Package/API names | Source package is named `sparc3d`; public pipeline is `Sparc3DPipeline`. |
| Training/evaluation scope | Inference code is released; training code, benchmark splits, and the paper evaluation harness are not included. |

The implementation batch must pin the source to the full commit above (or a later revision separately reviewed and approved), record the exact model-artifact revision, and never load an unpinned `main` checkout at runtime. The reviewed commit is a source revision, not a promise that future `main` changes are compatible.

## 4. What the upstream pipeline does

Hi3D progressively refines sparse geometry. The reference image conditions sparse flow at coordinates derived from the coarse mesh; a sparse VAE decodes latents into a signed-distance field; FlexiCubes extracts a mesh; the extracted surface is revoxelized for the next pass.

| Requested resolution | Passes | Nominal extraction grids | Transformer use |
|---:|---:|---|---|
| 512 | 1 | 512³ | `transformer_512` |
| 1024 | 2 | 512³ then 1024³ | `transformer_512`, then `transformer_1024` |
| 1536 | 3 | 512³, 1024³, then 1536³ | `transformer_512`, then `transformer_1024` twice |

Important behavior for the adapter contract:

- Batch size is one.
- Default sampling is 25 scheduler updates per pass using the Heun flow-match scheduler.
- DINOv2-large and CLIP ViT-L/14 are separate conditioning models, loaded on first use unless locally cached.
- The conditioning encoders run in fp32 with autocast disabled and produce a `[1, 2917, 2048]` feature tensor.
- The released artifact contains eight required second-stage files: JSON descriptors plus `transformer_512/model.safetensors`, `transformer_1024/model.safetensors`, and `vae/model.safetensors`.
- The loader consumes JSON and safetensors and does not execute model-repository Python or unpickle checkpoints, according to the upstream documentation.
- Output is geometry-only: no textures, materials, or vertex colors.
- Upstream removes small disconnected components, simplifies toward approximately 1M faces at 512/1024 and 2M at 1536, recenters the vertices, and scales them to unit maximum radius.
- Absolute input world-space position and scale are not preserved. Severe coarse-mesh structural errors can persist, and hidden surfaces are plausible completions rather than measured reconstruction.
- Adaptive voxelization can use a coarser support grid when the voxel budget is exceeded. The requested resolution label is not proof of a dense grid or a fixed triangle count.
- If the requested resolution cannot be reached, upstream raises rather than silently returning a lower-resolution result. The adapter must preserve that failure semantics.

## 5. Fit with the existing ForMesh3D architecture

The current documented path is:

`GeneratePanel.tsx` → `buildGenerationParameters.ts` → FastAPI request validation → `JobRequest` → resource planner/scheduler → model adapter → raw output → immutable `master/source.glb` → optional centralized post-processing.

Relevant inspected owners are:

- `backend/core/models/base.py`: model lifecycle, scheduler-selected `gpu_id`/`gpu_ids`, status, error preservation, and unload hooks.
- `backend/core/models/mesh_models.py`: image-to-mesh input/output base contract.
- `backend/core/scheduler/model_factory.py`: adapter registry and dynamic construction.
- `backend/core/scheduler/resource_planner.py`: single-GPU admission, explicitly declared multi-GPU strategies, CPU plans, and live available VRAM.
- `backend/core/scheduler/multiprocess_scheduler.py`: worker execution, candidate seeds, progress, geometry telemetry, model cache, and post-process orchestration.
- `backend/config/models.yaml`: canonical model facts, readiness paths, capabilities, VRAM reservation, output formats, and worker limits.
- `backend/postprocess/pipeline.py`: canonical asset workspace, immutable master promotion, artifact manifests, quality gates, and derivatives.
- `backend/scripts/download_models.sh`: model download/verification entry point.
- `backend/api/routers/system.py` and `backend/api/routers/mesh_generation.py`: authorized artifact delivery, model discovery, and generation job construction.

### Proposed ownership boundary

Hi3D must be represented as a separate second-stage contract, for example:

```text
coarse image generation
  → secure coarse output as immutable master/source.glb
  → explicit Hi3D refinement job (reference image + selected coarse master)
  → separate refined raw output
  → secure refined master/source.glb lineage
  → existing post-processing and artifact manifest
```

The recommended feature identifier is `image_mesh_refinement`. It must not be added to the automatic `image_to_raw_mesh` candidate list until there is a product-approved chaining policy and measured capacity. A raw generation request that has only an image must never accidentally select Hi3D and fail because a coarse mesh is absent.

### Intended source layout after approval

```text
backend/thirdparty/Hi3Dv1.0/       # reviewed upstream source, no .git directory
backend/adapters/hi3d_adapter.py   # ForMesh3D lifecycle/input/output wrapper
backend/config/models.yaml          # disabled/verified Hi3D refinement facts
backend/config/hi3d.yaml            # optional adapter-owned profiles and paths
backend/scripts/download_models.sh  # explicit Hi3D source/checkpoint target
backend/scripts/install_hi3d.sh     # optional isolated-runtime installer
backend/tests/test_hi3d_contract.py
backend/tests/test_hi3d_checkpoint_manifest.py
Docs/HI3D-PROPOSAL.md               # this proposal; update only after approval
```

The exact directory casing should follow the repository convention chosen during implementation, but the package root must remain source-isolated so a vendored `sparc3d` cannot shadow an unrelated Python package or another third-party model.

Vendoring must use a reviewed archive or clone of the pinned commit, preserve applicable `LICENSE`, `NOTICE`, `AUTHORS`, `THIRD_PARTY_LICENSES.md`, and required upstream attribution headers, then remove only the vendored checkout’s `.git` directory. No project-level Git metadata may be touched. Excluded sample media should not be copied merely because it is present upstream.

## 6. Proposed adapter and pipeline contract

### Inputs

The adapter should accept only canonical, server-resolved paths supplied by the scheduler:

- `reference_image_path`: the original or approved/preprocessed image used for the coarse asset.
- `coarse_mesh_path`: preferably the selected asset’s immutable `master/source.glb`; never a browser URL or arbitrary client filesystem path.
- `output_format`: initially `glb` for canonical output. Other exports may be derived after the master is secured.
- `resolution`: an explicit enum of `512`, `1024`, or `1536`; no arbitrary numeric resolution.
- `num_inference_steps`: default 25, bounded and adapter-owned unless an approved profile explicitly permits another value.
- `seed`: caller-controlled and recorded; do not claim bitwise determinism because upstream documents GPU nondeterminism.
- `sequential_cpu_offload`: an adapter/resource-plan decision, not an exposed fake low-VRAM switch.
- `cache_dir` / `local_files_only`: resolved from trusted server configuration, not client input.

Before inference, validate that the image and mesh exist, are inside the authorized storage roots, are readable, and are not symlinks escaping those roots. Load the coarse mesh without mutating it; reject empty, non-finite, malformed, or unsupported scene/geometry input. Record image and coarse-mesh SHA-256 values and the source master hash in provenance.

### Outputs

Return the established scheduler shape:

```text
{
  "success": true,
  "output_mesh_path": ".../refined.glb",
  "generation_info": { ... }
}
```

`generation_info` must include at least the upstream revision, model-artifact revision, source/coarse/image hashes, requested resolution, achieved resolution status, pass count, steps, seed, device, offload mode, geometry-only status, vertex/face counts, normalization/coordinate note, and any adaptive-voxel or quality warnings. The shared `raw_geometry_telemetry` must report adapter/checkpoint identity and effective values rather than treating a requested resolution as achieved.

The adapter must write to a job-scoped temporary/output path and let the existing post-process pipeline create or refresh the refined immutable master. It must not overwrite the coarse asset’s `master/source.glb` or mutate any user-selected source mesh. `MeshProcessor.save_mesh(..., do_normalise=False)` or the equivalent should preserve the upstream result after upstream’s documented normalization; no second, implicit project normalization should be introduced.

### Progress, cancellation, and errors

Map scheduler update events to job progress across passes. Clearly report that decoding, extraction, and postprocessing do not emit upstream scheduler events, so progress may pause. Validate cancellation between passes and before canonical promotion. Preserve exception causes in the same style as `BaseModel` and current adapters.

Failure must be explicit for missing source mesh, missing encoders, unsupported GPU, missing native kernels, checkpoint mismatch, invalid geometry, OOM, and an unreachable requested resolution. Do not silently fall back to CPU, silently download arbitrary revisions, silently downshift resolution, or convert a refinement failure into a coarse-generation success.

## 7. Registry, planner, API, and UI changes after approval

These are proposed future changes only; none are made by this document.

### Registry and resource planning

Add a separate `image_mesh_refinement` entry in `backend/config/models.yaml` with:

- `upstream_repository` and immutable reviewed `upstream_ref`.
- `checkpoint_license: "LicenseRef-Hi3D-1.0"` or the project’s approved equivalent; do not label it Apache-2.0.
- `capabilities.image_mesh_refinement: true`, `requires_coarse_mesh: true`, `raw_mesh: true`, `texture_generation: false`, `native_topology: false`.
- `supported_inputs: ["image", "mesh"]` and initially `supported_outputs: ["glb"]`.
- `multi_gpu: false` until a real Hi3D placement implementation is reviewed and measured.
- `cpu_only: false`, with an explicit `requires_cuda`/compute-capability readiness fact if supported by the manifest schema.
- A conservative measured reservation, not an estimate copied from checkpoint disk size.
- `enabled: false` until source, dependencies, checkpoints, GPU smoke tests, legal review, and acceptance criteria pass.

Only after that gate should `ModelFactory.ADAPTER_REGISTRY` receive the adapter mapping, and only as an explicit refinement feature. The planner must not treat aggregate VRAM as usable unless the adapter implements real multi-GPU placement. The first safe policy is single selected GPU plus optional sequential CPU offload, with one worker and no concurrent Hi3D jobs per reserved device.

### API and UI

The safest first product surface is an explicit endpoint or child-job action that requires both an image reference and a mesh/file/job reference. It should use the canonical file-store resolver and return the normal job lifecycle/artifact manifest. It must not overload `/image-to-raw-mesh` with an optional hidden coarse input.

After backend acceptance, a UI action such as **Refine selected asset with Hi3D** may be added to the asset/mesh workflow. It should show:

- that Hi3D is a geometry refinement stage, not a fresh image-only generator;
- the selected coarse source and reference image;
- supported resolution and an honest GPU/readiness/weights state;
- the scale normalization consequence;
- geometry-only output and the later optional texture/post-process stages;
- the required commercial attribution when applicable.

No UI model-selector entry should appear while the manifest is disabled or unavailable. No automatic intent preset should select Hi3D until a separate product decision authorizes that behavior.

## 8. Dependencies and isolation plan

The official measured stack is Python 3.10.12, PyTorch 2.5.0+cu124, torchvision 0.20.0+cu124, CUDA toolkit 12.4.131, Triton 3.1.0, `spconv-cu120==2.3.6`, `flash-attn==2.7.4.post1`, `transformers==4.46.3`, NumPy 1.26.4, `accelerate`, and the package’s pinned core dependencies. Hi3D’s project metadata also requires `pyfqmr`, `packaging`, `ninja`, `psutil`, and compatible Pillow/trimesh/safetensors/Hugging Face packages.

This does not fit the shared environment as-is:

- `backend/requirements-models.txt` currently pins `transformers==4.44.2` and `huggingface_hub>=0.25,<0.26`; Hi3D requires Transformers `>=4.46,<5` and Hugging Face Hub `>=0.28,<1`.
- The main project targets PyTorch 2.6.0+cu124, while Hi3D’s verified stack is PyTorch 2.5.0+cu124. The matching torchvision, FlashAttention build, sparse-convolution wheel, and ABI must be tested as a set.
- A shared process importing both dependency families risks import/API/ABI conflicts and native-kernel failures.

**Recommendation:** create a dedicated `3daigc-hi3d` Python 3.10 environment or an equivalently isolated worker container. Do not upgrade/downgrade `3daigc-api` for Hi3D. The ForMesh3D adapter should call a small, controlled helper boundary when the isolated environment is required, using discrete argv, a bounded timeout, controlled `PYTHONPATH`, selected `CUDA_VISIBLE_DEVICES`, and structured JSON/progress IPC. If later testing proves an in-process import is safe, that is a separate decision and must still keep the vendored package path scoped.

The isolated environment must use the exact reviewed constraints, avoid unpinned latest resolution, and never run an upstream install script without source review. FlashAttention is a native build with `--no-build-isolation`; Triton compiles mesh kernels on first use. Both build behavior and cache paths must be documented and reproducible.

## 9. Weights, download manager, cache, and storage

### Artifact inventory

The official license schedule identifies eight Hi3D refinement artifacts. The three safetensors files are approximately:

- `transformer_512/model.safetensors`: 3,675,679,280 bytes.
- `transformer_1024/model.safetensors`: 3,675,679,280 bytes.
- `vae/model.safetensors`: 376,629,712 bytes.

Together these are approximately 7.73 GB before JSON files, encoders, runtime packages, kernel caches, and temporary files. DINOv2-large and CLIP ViT-L/14 are separate external model artifacts; the official sources reviewed here do not state their total download size.

### Proposed download behavior

After approval, extend the existing download manager with a dedicated Hi3D target, stored under the configured pretrained/cache root rather than committed to Git. The implementation must:

1. Pin the Hugging Face model revision and allowlist only the required eight files.
2. Record exact file sizes and SHA-256 digests in a manifest reviewed into the project.
3. Download to a temporary directory, support resume/retry where the client permits it, verify every file, then atomically rename the complete directory.
4. Treat missing, truncated, unexpected, or hash-mismatched files as not ready; never report success based only on directory existence or minimum size.
5. Keep model cache location configurable and separate from user asset storage.
6. Prefer local files in production and pass `local_files_only=True` after the manager has verified the cache; runtime inference must not silently reach the network.
7. Download the DINOv2 and CLIP encoder revisions separately, with their own allowlists, licenses, hashes, and readiness checks.
8. Surface truthful progress, disk-space failures, cancellation, and an actionable incomplete-cache state.

The existing `master/source.glb` asset workspace remains the source of user geometry; model weights must never be placed inside an asset workspace or included in an output ZIP.

## 10. GPU, VRAM, concurrency, and cleanup risks

### Known upstream constraints

- Linux only; Python 3.10 only in the measured setup.
- NVIDIA compute capability 8.0 or newer; no CPU inference path.
- CUDA toolkit 12.0–12.5 must match the PyTorch build.
- 1536³ was validated only on a 96 GB NVIDIA H20. Upstream does not establish a minimum VRAM requirement for smaller cards.
- Each transformer is approximately 1.8B parameters; main layers use fp16. Decoded sparse feature memory is input-dependent.
- Sequential CPU offload reduces model residency but does not remove decoded-feature GPU memory and does not establish a minimum VRAM guarantee.
- FlashAttention is required and has no fallback attention path.
- A decoded-feature guard raises above 12,000,000 features; adaptive voxelization can reduce support-grid resolution with a warning.

### Project resource policy

Do not set a nominal VRAM field from the 7.73 GB checkpoint footprint. Measure peak allocated and reserved memory for each supported resolution and offload mode on target GPUs, add the project safety margin, and use those measurements as scheduler reservations. Until measured:

- mark the model unavailable rather than guessing;
- keep `multi_gpu: false`;
- use `max_workers: 1`;
- do not expose a user-controlled “Low VRAM” switch;
- do not silently retry a failed 1536 request at 1024 or 512.

The adapter must use the scheduler-selected device (`cuda:{gpu_id}`), not a hard-coded `cuda:0`. On unload and on failed inference, release pipeline references and offload hooks, collect Python garbage where needed, call `torch.cuda.empty_cache()` for the selected device, and leave the model in an observable error/unloaded state. Model cache TTL/LRU behavior must not evict a model while a refinement job is active.

## 11. Licensing, attribution, and provenance

Hi3D is **not** covered by a simple Apache-2.0 or MIT project-wide license. The reviewed `LICENSE` is the **Hi3D Open License Agreement Version 1.0**, issued by OCEANO HK HOLDING LIMITED. The upstream license schedule states that the Hi3D-owned/authorized second-stage code, configuration, documentation, and eight listed model artifacts are covered by that agreement, while original SPARC3D/TRELLIS/Pointcept/O-CNN/FlexiCubes portions retain their own Apache-2.0/MIT terms and sample media, external models, and Hunyuan materials are excluded.

The implementation must preserve and ship applicable upstream notices and the complete agreement/link when distributing Hi3D materials. Legal review must explicitly cover:

- commercial use and the acceptable-use policy;
- the requirement for **“Powered by Hi3D 1.0”** in a commercial product/service UI, About page, acknowledgements, API documentation, or equivalent customer-facing legal notice;
- the scale threshold: above 200,000 monthly active users or at least USD 1,000,000 monthly revenue, notify the licensor and apply for a separate written license within 60 days;
- downstream notice, modified-file, and acceptable-use-policy obligations if source/weights are distributed;
- the separate Apache-2.0/MIT terms for retained upstream code;
- Apache-2.0 DINOv2, MIT CLIP, and any optional coarse-generator terms;
- the fact that Hunyuan3D-2 mini is only an optional upstream example and must not be silently added as a Hi3D dependency;
- provenance records for every source revision, model revision, dependency lock, and checkpoint digest.

Generated meshes are treated by the Hi3D agreement as standalone outputs when they contain no Hi3D materials or model derivative, but output ownership/copyright and third-party input rights are not guaranteed by that agreement. The product must not imply official Hi3D endorsement.

## 12. Security and supply-chain controls

The current security policy treats uploads, meshes, checkpoints, third-party source, and generated assets as untrusted. Hi3D adds several supply-chain risks:

- a moving Git branch or Hugging Face revision could change code or weights;
- FlashAttention, spconv, Triton, and FlexiCubes involve native/CUDA code or JIT compilation;
- model repositories and encoder caches are external inputs;
- separate DINOv2/CLIP downloads can create hidden network access during inference;
- an isolated package environment can still execute native build steps.

Required controls after approval:

1. Pin the signed source commit, model revision, encoder revisions, package versions, and CUDA/PyTorch build.
2. Review vendored source and all declared transitive/native dependencies before installation.
3. Use a lock/constraints file and, where available, package hashes and an approved wheel source. Do not trust ambient `PIP_INDEX_URL` or execute arbitrary repository setup code.
4. Use safetensors/JSON only for the eight Hi3D artifacts; reject unexpected executable/model-repository files.
5. Enforce `local_files_only` in the production worker and expose network access only to the explicit download manager.
6. Use canonical path resolution and root containment for every image, mesh, cache, and output path.
7. Run the helper with least privilege, bounded time/memory, controlled environment variables, and no credentials in child-process arguments or logs.
8. Keep source, checkpoint, input, output, and dependency hashes in job provenance without logging tokens or private URLs.

## 13. Tests and validation plan

### CPU/static tests (no weights or CUDA required)

- Verify the adapter module is importable only through its scoped third-party path and cannot shadow another `sparc3d` package.
- Verify registry schema, feature separation, disabled readiness, required coarse-mesh input, supported resolutions, and no automatic planner selection.
- Verify checkpoint-manifest allowlist, exact size/hash checks, incomplete-cache rejection, atomic install behavior, and `local_files_only` configuration.
- Verify path containment, input-file validation, source/coarse/image SHA-256 provenance, and no source mutation.
- Mock the pipeline and assert output schema, progress mapping, metadata, normalization note, cancellation, chained exceptions, and cleanup.
- Verify scheduler device/resource-plan propagation and that aggregate VRAM is not admitted without a real placement strategy.
- Verify post-process promotion preserves the coarse/refined immutable master lineage and that derivatives do not overwrite either master.
- Run existing backend contract/source compilation checks and the relevant download-script shell syntax check. Do not claim GPU inference from these tests.

### GPU/checkpoint tests required before enabling

On a supported Ampere-or-newer host with the exact isolated environment:

1. Run a 512³ refinement with a fixed image/coarse-mesh pair and capture wall time, peak allocated/reserved VRAM, host RAM, output hashes, geometry metrics, and logs.
2. Repeat 512³ and 1024³ to verify stable cache reuse, cleanup, and deterministic metadata. Compare geometry with a mesh-aware metric, not byte hashes alone.
3. Run 1536³ only on hardware with enough measured headroom; upstream’s H20 validation is evidence, not a project guarantee for another GPU.
4. Exercise missing encoders, missing/corrupt files, unsupported compute capability, FlashAttention failure, OOM, cancellation, timeout, and retry recovery.
5. Exercise one concurrent non-Hi3D job and one queued Hi3D job to prove scheduler isolation and no cross-model CUDA contamination.
6. Inspect visual PNGs from the same reference/coarse inputs, including thin features, disconnected components, hidden surfaces, normalization, orientation, and downstream postprocessing.
7. Confirm the raw refined master is geometry-only and that optional existing texture stages remain separate and do not mutate it.

## 14. Acceptance criteria

Hi3D may be enabled only when all of the following are true:

- source revision, model revision, encoder revisions, licenses, notices, and hashes are recorded;
- the vendored tree has no `.git` metadata and preserves required notices without copying excluded sample media;
- the isolated runtime installs reproducibly without changing the shared `3daigc-api` dependency pins;
- readiness is false on CPU, pre-Ampere, missing-kernel, missing-weight, incomplete-cache, or unsupported-CUDA hosts;
- download progress and verification are truthful and resumable/atomic;
- the adapter requires a same-object image and coarse mesh and never changes the input master;
- the scheduler uses measured single-GPU reservations, one worker, explicit device selection, and observable cleanup/error states;
- requested versus achieved resolution, adaptive voxelization warnings, normalization, hashes, and peak VRAM are persisted in provenance;
- finite geometry/topology checks pass and the refined master/derivative contract is preserved;
- GPU smoke tests pass for every enabled resolution on the declared hardware class;
- existing backend/frontend/source-contract checks pass without unrelated regressions;
- legal approval confirms the Hi3D Open License obligations and required commercial attribution;
- UI/API exposure is explicit, truthful, and disabled until the backend capability is actually ready.

## 15. Rollback strategy

The integration should be one isolated, reversible change set. If validation or legal review fails:

1. Set the Hi3D manifest entry disabled/unavailable and remove it from planner candidates.
2. Remove the explicit route/UI feature flag and stop creating new Hi3D jobs.
3. Revert the adapter/helper/runtime/download changes without reverting unrelated user work.
4. Leave existing user assets and their provenance readable; do not delete generated outputs automatically.
5. Remove Hi3D source, environment, caches, or weights only through an explicit operator action after checking that no retained artifact or legal record depends on them.
6. Preserve the proposal and failure evidence so a later pinned revision can be evaluated independently.

## 16. Sources and limitations

### Primary sources reviewed

- Official repository: <https://github.com/hi3d-official/Hi3Dv1.0>
- Official README at reviewed `main`: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/README.md>
- Installation requirements and verified stack: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/docs/installation.md>
- Pipeline, pass structure, preprocessing, extraction, normalization, and memory: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/docs/pipeline.md>
- Package metadata: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/pyproject.toml>
- Verified constraints: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/docker/constraints.txt>
- License: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/LICENSE>
- Third-party license scope and external models: <https://raw.githubusercontent.com/hi3d-official/Hi3Dv1.0/main/THIRD_PARTY_LICENSES.md>
- Reviewed signed commit: <https://github.com/hi3d-official/Hi3Dv1.0/commit/13657ad09afaa92e350b461a1cd66399e44a59c4>
- Model artifacts: <https://huggingface.co/hi3d-official/Hi3Dv1.0>

### Repository sources inspected

`Docs/TASKS.md`, `Docs/ARCHITECTURE.md`, `Docs/SECURITY.md`, `backend/config/models.yaml`, `backend/core/models/base.py`, `backend/core/models/mesh_models.py`, `backend/core/scheduler/model_factory.py`, `backend/core/scheduler/resource_planner.py`, `backend/core/scheduler/multiprocess_scheduler.py`, `backend/postprocess/pipeline.py`, `backend/scripts/download_models.sh`, and the existing image/mesh adapters.

### Limitations

- No Hi3D source was cloned or vendored.
- No Hi3D, encoder, or coarse-stage weights were downloaded.
- No Hi3D dependencies were installed.
- No GPU, CUDA kernel, checkpoint-backed inference, VRAM measurement, visual comparison, or quality A/B was run in this proposal pass.
- The upstream documentation validates the 1536³ ladder only on a 96 GB H20 and does not publish a minimum VRAM requirement for smaller GPUs; all project reservations must therefore remain unverified until measured.
- The current working tree contains unrelated pre-existing modifications. This proposal adds no changes to `Docs/TASKS.md`, `MEMORY.md`, `CHANGELOG.md`, or `DECISIONS.md`.

## Explicit approval request

**Please reply with explicit approval for the conditional implementation batch described in Sections 2, 5, 7, 8, and 9, or identify the constraints that must change. Until that approval is provided, Hi3D remains unmodified, unintegrated, unregistered, uninstalled, weight-free, and absent from the UI/API.**
