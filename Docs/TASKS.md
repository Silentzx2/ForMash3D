# ForMash3D — Unique3D Integration Plan

## 1. Objective

Integrate the **official AiuniAI/Unique3D implementation** into ForMash3D as a first-class **single-image → 3D** model.

**Target branch:** `Dev`  
**Audited Dev HEAD:** `bd3bcd5947981c27d873394316e0207e240d2d71`  
**Feature:** `image_to_raw_mesh`  
**Proposed canonical model ID:** `unique3d_image_to_raw_mesh`  
**Backend:** FastAPI + Python 3.10 (`3daigc-api`)  
**Frontend:** Next.js 16 + React 19  

This document is an **implementation specification**, not an implementation. The coding agent must execute it only after re-reading the current repository state and `RULES.md`.

---

# 2. Mandatory Engineering Rules

The integration MUST follow `RULES.md`.

### Required principles

- Reuse the existing model architecture.
- Do not create a second model manager, registry, scheduler, or storage system.
- Root-cause dependency/runtime issues before fixing them.
- Prefer the smallest correct diff.
- Do not add a dependency when the existing environment already provides a compatible implementation.
- Update all relevant existing documentation after the implementation.
- Do not touch unrelated frontend/backend code.
- Do not modify Python model pipelines merely to make the integration convenient.

### Official-source rule

Unique3D must use the **official upstream source code** for its actual inference algorithm.

The ForMash3D layer should wrap the official implementation rather than re-implement it.

Do NOT rewrite:

- multi-view generation;
- normal prediction;
- mesh initialization;
- stage-1 reconstruction;
- mesh refinement;
- color projection;
- reconstruction losses;
- model architecture;
- checkpoint interpretation;
- official inference defaults.

The adapter exists to translate between ForMash3D and Unique3D.

---

# 3. Current ForMash3D Architecture Already Available

The Dev branch already provides the pieces required for a clean model integration:

- `backend/config/models.yaml` — backend model manifest;
- `backend/core/scheduler/model_factory.py` — model factory/registration;
- `backend/adapters/` — lazy model adapters;
- `backend/core/scheduler/multiprocess_scheduler.py` — VRAM-aware model scheduler;
- `backend/api/routers/mesh_generation.py` — image-to-raw-mesh API;
- `backend/api/routers/system.py` — model readiness/details;
- `backend/scripts/download_models.sh` — model downloader/verifier;
- `manager.sh` — interactive model manager;
- `constants/models.ts` — frontend canonical model registry;
- `features/workspace/Panels/GeneratePanel.tsx` — generation UI;
- `features/workspace/utils/buildGenerationParameters.ts` — model parameter wiring;
- `features/admin/tabs/ModelsTab.tsx` — model administration/status;
- `backend/tests/test_official_model_parity_contract.py` — official-parameter/source-fidelity tests;
- `backend/tests/test_model_readiness.py` — weight/readiness tests.

**Do not build a parallel Unique3D system. Extend these existing mechanisms.**

---

# 4. Third-Party Source Acquisition

## 4.1 Clone official source

Clone the official repository from `AiuniAI/Unique3D` into:

```text
backend/thirdparty/Unique3D/
```

Use the upstream source actually selected for the implementation and record the exact commit/ref.

## 4.2 Remove Git metadata

After cloning and auditing the source:

```bash
rm -rf backend/thirdparty/Unique3D/.git
```

The vendored source must not remain a nested Git repository.

## 4.3 Record upstream revision

Because `.git` will be removed, record the exact upstream commit used somewhere in the project's existing documentation/decision records. Do not leave the vendored version ambiguous.

## 4.4 Preserve license

Keep the upstream `LICENSE` file. The official Unique3D repository is MIT-licensed.

Also update the existing ForMash3D third-party attribution/license documentation where appropriate.

---

# 5. Preserve Official Unique3D Layout

Keep the official source structure intact wherever possible:

```text
backend/thirdparty/Unique3D/
├── app/
├── custum_3d_diffusion/
├── mesh_reconstruction/
├── scripts/
├── assets/
├── LICENSE
├── README.md
├── Installation.md
└── requirements*.txt
```

Do not aggressively delete upstream files simply because ForMash3D does not use the demo UI.

The official inference files remain the source of truth.

---

# 6. Dependency Strategy

ForMash3D has a **shared backend environment**. Current repository configuration pins the core Torch stack around:

```text
Python 3.10
PyTorch 2.6.0 + CUDA 12.4
TorchVision 0.21.0 + CUDA 12.4
TorchAudio 2.6.0 + CUDA 12.4
```

These are controlled by the existing backend installation flow.

## 6.1 No separate Unique3D environment

Do NOT create a second Conda environment for Unique3D.

Do NOT install a second PyTorch/CUDA stack into the shared environment.

Do NOT blindly reproduce the older Unique3D environment from its historical README.

The official project documents older CUDA/PyTorch combinations; those are reference information, not a mandate to replace ForMash3D's runtime.

---

# 7. Unique3D Requirements Editing

The official Unique3D `requirements.txt` must be audited before installation.

The current upstream/Wuvin variants contain core ML/runtime dependencies including Diffusers, PyTorch3D, nvdiffrast, torch-scatter, ONNX Runtime, OpenCV, rembg, xformers, and other packages.

## 7.1 Remove conflicting shared-runtime packages

From the vendored Unique3D requirements, remove any direct dependency that attempts to replace the ForMash3D runtime, especially:

```text
torch
torchvision
torchaudio
```

This must be done so Unique3D uses the project's shared Torch/CUDA baseline.

## 7.2 Do not blindly delete everything else

Each remaining dependency must be classified:

1. Already available in the ForMash3D environment → reuse it.
2. Unique3D-specific and required for inference → retain/install it.
3. Native CUDA dependency → use existing wheelhouse/build rules.
4. Conflicting dependency → verify compatibility before changing anything globally.

Do not turn the Unique3D requirements file into a duplicate of `backend/requirements.txt`.

---

# 8. Special Dependency Audits

Before installation, explicitly audit:

### PyTorch3D

- Check whether a compatible PyTorch3D build already exists.
- Prefer a compatible wheel from `backend/thirdparty/wheels/`.
- Verify compatibility with Torch 2.6.0 + CUDA 12.4.
- Only build from source if necessary.

### torch-scatter

- Check existing version and ABI compatibility.
- Reuse existing compatible installation.
- Prefer the project's wheelhouse.

### xformers

- Do not force Unique3D's historical version.
- Reuse the shared compatible version when possible.

### nvdiffrast

- Verify the current project's installation/build path.
- Prefer existing compatible artifacts.
- Test both CUDA and GL/EGL paths required by Unique3D.

### ONNX Runtime

- Determine whether `onnxruntime-gpu` is actually required by the runtime path.
- Avoid conflicting CPU/GPU variants.
- Do not install historical versions blindly.

### OpenCV

The upstream requirements mention both Python OpenCV variants. Do not install redundant/conflicting packages unless the actual inference path requires them.

### rembg

Reuse the existing compatible background-removal stack where possible. Avoid duplicate preprocessing.

### Gradio

Do not make Gradio a required ForMash3D production dependency merely because the upstream demo uses it.

### wandb

Do not keep a training-only dependency as a mandatory inference dependency unless actual inference imports require it.

---

# 9. Installation Script Integration

Review:

```text
backend/scripts/install.sh
backend/requirements.txt
backend/thirdparty/wheels/
```

Add a Unique3D installation block only for dependencies that are genuinely missing and need model-specific handling.

Reuse the existing patterns:

```text
uv pip
local wheelhouse
PIP_NO_BUILD_ISOLATION=1
shared Torch/CUDA environment
```

Do not duplicate packages already installed globally by the existing model setup.

---

# 10. Weight Storage Layout

Use one canonical weight root:

```text
backend/pretrained/Unique3D/
```

Preserve the official checkpoint layout underneath it:

```text
backend/pretrained/Unique3D/
└── ckpt/
    ├── controlnet-tile/
    ├── image2normal/
    ├── img2mvimg/
    ├── realesrgan-x4.onnx
    └── v1-inference.yaml
```

If the official weight package contains additional mandatory files, include them after verifying the upstream commit.

Do not flatten or rename required checkpoint files unless the official code is explicitly adapted to understand the new structure.

---

# 11. Model Download Script

Modify:

```text
backend/scripts/download_models.sh
```

Add:

```text
unique3d
```

to the existing `AVAILABLE_MODELS` list.

Implement:

```bash
download_unique3d() {
    ...
}
```

The function must:

- create the canonical target path;
- download official Unique3D checkpoints;
- preserve the official `ckpt/` layout;
- use the existing Hugging Face token logic;
- be idempotent;
- support `--force`;
- report useful failures;
- verify required files/directories before declaring success.

Do not create a second downloader framework.

---

# 12. Weight Verification

Extend `verify_all_models()`.

A Unique3D installation must be considered incomplete if required files/directories are missing or empty.

At minimum validate the official checkpoint components:

```text
ckpt/controlnet-tile/
ckpt/image2normal/
ckpt/img2mvimg/
ckpt/realesrgan-x4.onnx
ckpt/v1-inference.yaml
```

Use the project's existing `verify_file()` and `verify_directory()` patterns.

---

# 13. manager.sh Registration

Modify the existing model manager in `manager.sh`.

Add a dedicated entry such as:

```text
Unique3D — High-Fidelity Single Image → 3D
```

Map that menu option to:

```text
unique3d
```

Ensure:

```text
a = Download ALL models
v = Verify existing models
```

also include Unique3D correctly.

Do not disturb existing menu mappings.

---

# 14. Canonical Model ID

Use exactly one ID everywhere:

```text
unique3d_image_to_raw_mesh
```

Do not introduce aliases such as:

```text
unique3d
unique3d_image_to_mesh
unique3d_raw_mesh
unique3d_v1
```

The download slug may be simply:

```text
unique3d
```

but all model-runtime registries must use the canonical model ID.

---

# 15. Backend Manifest Registration

Modify:

```text
backend/config/models.yaml
```

Add under `image_to_raw_mesh`:

```yaml
unique3d_image_to_raw_mesh:
  capabilities:
    text_to_3d: false
    image_to_3d: true
    multiview: false
    texture_generation: true
    raw_mesh: true
  vram_requirement: <verified-value-in-MB>
  supported_inputs: ["image"]
  supported_outputs: ["glb"]
  model_path: "backend/pretrained/Unique3D"
  enabled: true
  max_workers: 1
```

The exact VRAM requirement must be measured from the integrated environment. Do not guess from checkpoint size.

---

# 16. VRAM Reservation Policy

Unique3D must initially run with:

```text
max_workers: 1
```

Measure:

- baseline GPU memory;
- model load peak;
- first inference peak;
- repeat inference peak;
- post-inference memory;
- memory after unload.

Then set the manifest reservation using the measured peak plus the existing scheduler safety policy.

Do not hard-code a second VRAM value inside the adapter.

---

# 17. Official Unique3D Inference Flow

The current official implementation uses a pipeline conceptually equivalent to:

```text
Input Image
    ↓
small-image super-resolution when applicable
    ↓
image → multi-view prediction
    ↓
normal prediction
    ↓
initial mesh
    ↓
stage-1 reconstruction
    ↓
optional refinement
    ↓
multiview color projection
    ↓
GLB export
```

The adapter must preserve this behavior.

The official `gradio_3dgen.py` exposes native parameters including:

```text
input_processing
seed
render_video
do_refine
expansion_weight
init_type
```

For ForMash3D:

- preserve `seed`;
- preserve `input_processing` semantics;
- preserve `do_refine`;
- preserve `expansion_weight`;
- preserve `init_type`;
- do not expose `render_video` unless a concrete ForMash3D product feature requires it.

The exact defaults must be verified from the pinned upstream commit before implementation.

---

# 18. Official Parameter Fidelity

The adapter schema must preserve official model-native defaults.

Known current upstream values to verify against the pinned source include:

```text
do_refine = true
expansion_weight = 0.1
init_type = "std"
```

The actual source remains authoritative.

Do not substitute project-wide values for Unique3D-specific parameters.

---

# 19. Adapter File

Create:

```text
backend/adapters/unique3d_adapter.py
```

Use the same adapter contract as existing image-to-raw-mesh adapters.

Recommended class:

```python
class Unique3DImageToRawMeshAdapter(ImageToMeshModel):
    FEATURE_TYPE = "image_to_raw_mesh"
    MODEL_ID = "unique3d_image_to_raw_mesh"
```

The adapter must provide the existing lifecycle:

```text
load
process
unload
get_supported_formats
get_parameter_schema
```

and return the same generation response shape expected by the scheduler.

---

# 20. Adapter Responsibilities

The adapter is responsible for:

### Input

- validate image path;
- validate output format;
- resolve model and checkpoint roots;
- validate model readiness;
- normalize adapter inputs.

### Inference

- invoke the official Unique3D implementation;
- pass through official model-native parameters;
- keep official reconstruction behavior intact.

### Output

- write a canonical GLB via existing `OutputPathGenerator`/storage mechanisms;
- validate the resulting mesh;
- preserve texture/material information;
- return generation metadata.

---

# 21. Do Not Run Gradio as a Separate ForMash3D Service

Do NOT deploy the upstream:

```text
python app/gradio_local.py
```

as a second server.

ForMash3D already provides:

```text
Next.js UI
FastAPI
Scheduler
Model Adapter
```

The adapter should call the underlying official inference functions directly.

The upstream Gradio code is a reference for the official execution flow and defaults, not the production UI.

---

# 22. Relative Checkpoint Paths

The upstream code uses relative paths such as:

```text
./ckpt/...
```

This is a known integration constraint.

Preferred solution order:

1. Use an upstream-supported absolute/root configuration if available.
2. Otherwise provide adapter-side runtime context for the Unique3D root.
3. If needed, use isolated worker/subprocess context.
4. Only as a last resort use carefully scoped working-directory isolation.

Do NOT globally change the backend process working directory.

Do NOT rewrite all upstream checkpoint references when an adapter-side solution is possible.

---

# 23. Import Namespace Isolation

Unique3D has generic module names under `scripts/`, `app/`, and other folders.

Because ForMash3D contains many third-party projects, imports like:

```python
from scripts...
```

must resolve to the Unique3D copy, not another third-party package.

The adapter must establish the correct Unique3D source root before importing upstream modules.

Verify the resolved module paths during testing.

Do not permanently add the Unique3D root to global `sys.path` at backend startup.

---

# 24. Lazy Import Requirement

Add Unique3D to:

```text
backend/adapters/__init__.py
```

through the existing lazy `_ADAPTER_MAP` pattern.

Do not eagerly import Unique3D or its native dependencies at application startup.

This protects unrelated models from Unique3D dependency failures.

---

# 25. Model Factory Registration

Modify:

```text
backend/core/scheduler/model_factory.py
```

Add:

```text
unique3d_image_to_raw_mesh
    module: adapters.unique3d_adapter
    class: Unique3DImageToRawMeshAdapter
```

Do not create a second model factory.

---

# 26. Backend API Registration

Use the existing endpoint:

```text
POST /api/v1/mesh-generation/image-to-raw-mesh
```

The request should select:

```json
{
  "model_preference": "unique3d_image_to_raw_mesh"
}
```

Do NOT create a `/unique3d` API endpoint.

The existing scheduler/model validation should handle it automatically after registry registration.

---

# 27. System/Availability Registration

The existing `backend/api/routers/system.py` returns model availability and model details.

Unique3D must appear in:

```text
available_models
model_details
weights_status
```

where supported by the current API contract.

The backend is the source of truth for readiness.

---

# 28. Readiness Contract

Unique3D must not be reported “ready” only because:

```text
backend/pretrained/Unique3D/
```

exists.

Ready means the required checkpoint structure is present and non-empty.

Extend `backend/tests/test_model_readiness.py` with Unique3D-specific coverage.

---

# 29. Database / Job Registration

The current database is primarily a job queue/history store; it is not a reason to introduce a duplicate model-catalog table.

Unique3D jobs should naturally persist through the existing job fields:

```text
feature
model_preference
assigned_model
job_metadata
status
result
error
```

Expected values:

```text
feature = image_to_raw_mesh
model_preference = unique3d_image_to_raw_mesh
assigned_model = unique3d_image_to_raw_mesh
```

If the current Dev branch has a separate persistent model metadata store discovered during implementation, register Unique3D there too. Do not invent a new database abstraction if the existing architecture already covers it.

---

# 30. Frontend Canonical Registry

Modify:

```text
constants/models.ts
```

Add a `ModelDefinition` for Unique3D.

Recommended display metadata:

```text
id: unique3d_image_to_raw_mesh
name: Unique3D (High-Fidelity Single Image → 3D)
category: mesh_generation
feature: image_to_raw_mesh
featureLabel: Image to Geometry
supportedInputs: ["image"]
supportedOutputs: ["glb"]
supportsTexture: true
```

`vramMb` must use the verified scheduler requirement.

Do not mark low-VRAM support until an actual tested path exists.

---

# 31. Generate Panel

Inspect and update:

```text
features/workspace/Panels/GeneratePanel.tsx
```

The Unique3D model must be selectable exactly like existing image-to-raw-mesh models.

Do not create a Unique3D-only selector.

The UI must use the canonical ID:

```text
unique3d_image_to_raw_mesh
```

---

# 32. Parameter Wiring

Modify:

```text
features/workspace/utils/buildGenerationParameters.ts
```

When the selected model is Unique3D, forward only the parameters the model actually supports.

Expected model-native inputs to preserve:

```text
seed
input_processing
do_refine
expansion_weight
init_type
```

Do NOT inject unrelated values such as:

```text
octree_resolution
mc_resolution
guidance_scale
num_faces
```

unless official Unique3D source actually consumes them.

---

# 33. Model Parameter Schema

Implement `get_parameter_schema()` in the adapter.

Expose the official parameters and validation ranges.

Current upstream UI indicates:

```text
expansion_weight: -1.0 .. 1.0
init_type: std | thin
```

Verify these values against the pinned source before implementation.

---

# 34. Admin Models Tab

The current admin model page already reads:

```text
CANONICAL_MODELS
available_models
model_details
```

Unique3D should therefore appear automatically after proper registry/API wiring.

Verify:

- search finds Unique3D;
- correct VRAM requirement is displayed;
- readiness state is correct;
- missing weights are visible;
- Ready state appears only after verification;
- no duplicate model card is created.

---

# 35. Smart Generation

Inspect:

```text
backend/api/routers/smart_generation.py
```

If smart generation uses explicit candidate lists, add Unique3D where appropriate.

Recommended role:

```text
single-image → high-quality textured geometry candidate
```

Do not automatically make Unique3D the global default unless the existing product logic has an explicit model-priority mechanism that should include it.

Explicit user model selection must always win.

---

# 36. Source-Fidelity / Downstream Pipeline Contract

Unique3D is a **source generation model**.

The source mesh should be generated at the model's native quality, then preserved as the immutable master.

Flow:

```text
Unique3D
   ↓
raw/native source GLB
   ↓
master/source.glb (immutable)
   ↓
existing production post-process
   ├── retopo
   ├── UV
   ├── texture operations
   ├── LOD
   ├── collision
   └── game-ready
```

Do not use ForMash3D target polycount to destructively simplify inside the Unique3D adapter.

---

# 37. Texture Contract

Unique3D produces textured mesh output in its official generation path.

The adapter must preserve:

- materials;
- UVs;
- texture images;
- vertex colors if present;
- normals.

Do not strip texture data just because the canonical feature is `image_to_raw_mesh`.

Frontend metadata can report:

```text
supportsTexture: true
```

---

# 38. Background Removal / Input Processing

Unique3D exposes input processing/background removal behavior.

Wire this as a model-native parameter.

Avoid duplicate processing such as:

```text
ForMash3D background removal
    ↓
Unique3D background removal
```

unless the official flow and a measured failure justify it.

---

# 39. Input Resolution

Use the upstream Unique3D path for its own resolution handling/super-resolution where available.

Do not add a second generic ForMash3D image upscaler merely because Unique3D accepts small images.

Any global preprocessing already present in ForMash3D must be audited for compatibility with Unique3D's expectations.

---

# 40. Output Orientation

Preserve the official Unique3D coordinate transform.

Do not apply an extra global rotation in the adapter unless tests prove the upstream output needs the project's standard orientation conversion.

Validate:

- front view;
- side view;
- top view;
- Y-up behavior;
- viewer orientation;
- downstream retopo orientation.

---

# 41. Model Lifecycle

Follow the existing adapter lifecycle:

```text
load → process → unload
```

The adapter should:

- load lazily;
- reuse already-loaded resources where safe;
- release GPU references on unload;
- run model-specific cleanup if official code provides it;
- avoid stale tensors or global model state.

Do not use `torch.cuda.empty_cache()` as the only cleanup step if model objects still own GPU memory.

---

# 42. Concurrency

Initial setting:

```yaml
max_workers: 1
```

Unique3D should not run concurrently until measured under the shared environment.

Its multi-component generation pipeline and native rasterization make conservative scheduling appropriate initially.

---

# 43. Progress Reporting

Do not fabricate fake per-iteration progress.

If the official pipeline does not expose a trustworthy callback, use truthful stage-level progress.

Possible stages:

```text
prepare/input
multi-view generation
normal prediction / mesh reconstruction
refinement / color projection
export / validation
```

Use the existing scheduler progress mechanism.

---

# 44. Temporary Files

Unique3D's upstream code may create temporary files/directories.

Ensure job outputs are isolated and cleanup is safe.

Do not allow two jobs to share the same temporary output name.

Use the existing job/storage conventions where possible.

---

# 45. Native OpenGL/EGL Risk

This is one of the highest-risk integration points.

The official Unique3D color-projection path uses nvdiffrast's GL context. Upstream issue history includes failures involving:

- OpenGL 4.4+;
- EGL initialization;
- headless contexts;
- Ninja/CUDA plugin compilation.

ForMash3D is a server-side application, so this path MUST be tested in the actual production-like environment.

Do not replace the renderer first. Reproduce the exact failure and prefer environment/configuration fixes.

---

# 46. Official Checkpoint Compatibility Risk

Historical Unique3D issues show checkpoint/model-version mismatches can produce shape errors during loading.

Therefore:

- pin the exact upstream code revision;
- use the matching official checkpoint package;
- do not mix checkpoints from unrelated forks/versions;
- do not silently “fix” mismatched tensors by ignoring shape errors.

A checkpoint mismatch is a deployment defect and must be fixed at the source/version boundary.

---

# 47. Direct Official Baseline Before Adapter

Before debugging the adapter itself:

1. run the vendored official Unique3D inference directly;
2. use the exact same installed environment;
3. use the exact same checkpoint package;
4. generate one known-good sample.

Then run the same input through the ForMash3D adapter.

This separates:

```text
Unique3D environment failure
```

from:

```text
ForMash3D integration failure
```

---

# 48. Official Parity Test

Add Unique3D to:

```text
backend/tests/test_official_model_parity_contract.py
```

At minimum verify:

- adapter imports;
- correct feature type;
- correct model ID;
- supported formats;
- parameter schema exists;
- official defaults are preserved;
- downstream-only controls are not sent as model parameters.

If feasible, compare a direct official inference and adapter inference using the same image/settings.

Byte-identical output is not required; functional/structural parity is the goal.

---

# 49. Readiness Tests

Extend:

```text
backend/tests/test_model_readiness.py
```

Add cases for:

### Missing checkpoint

→ not ready.

### Partial checkpoint

→ not ready.

### Empty required file

→ not ready.

### Complete checkpoint set

→ ready.

---

# 50. Model Factory Test

Verify the factory can instantiate:

```text
unique3d_image_to_raw_mesh
```

and resolves to:

```text
Unique3DImageToRawMeshAdapter
```

---

# 51. Download Manager Tests

Verify the download script recognizes:

```text
unique3d
```

and that:

```text
--list
-m unique3d
-v
```

behave correctly.

Do not perform a multi-gigabyte download as a normal unit test.

---

# 52. Frontend Registry Tests

Verify `constants/models.ts` contains:

```text
unique3d_image_to_raw_mesh
```

with:

```text
feature = image_to_raw_mesh
input = image
output = glb
```

and verified VRAM metadata.

---

# 53. Parameter Wiring Tests

Selecting Unique3D must preserve:

```text
seed
do_refine
expansion_weight
init_type
input_processing
```

and must not accidentally inherit parameters from TripoSR, TripoSG, Hunyuan, TRELLIS, or other models.

---

# 54. End-to-End GPU Smoke Test

Mandatory sequence:

```text
weight verification
      ↓
adapter load
      ↓
sample image
      ↓
official Unique3D inference
      ↓
GLB output
      ↓
mesh validation
      ↓
texture/material validation
      ↓
master/source.glb
      ↓
existing postprocess
      ↓
viewer
```

The model cannot be marked “ready to use” until this passes.

---

# 55. Quality Validation

For the generated source asset record at least:

```text
vertex_count
face_count
texture presence
material count
UV presence
bounding box
output file size
```

The adapter must not silently decimate the source mesh.

---

# 56. Failure Tests

Verify clean failures for:

- missing image;
- invalid image;
- missing weights;
- incomplete weights;
- insufficient VRAM;
- native extension import failure;
- nvdiffrast GL/EGL failure;
- invalid model parameter;
- official inference exception.

Errors should use the standard ForMash3D job failure flow.

---

# 57. Error UX

If weights are missing, use a useful message like:

```text
Unique3D weights are not installed. Download and verify Unique3D from the Model Manager.
```

Keep detailed exceptions in backend logs.

Do not expose paths/secrets that should remain internal.

---

# 58. Logging

Log model lifecycle events including:

```text
model ID
checkpoint root
input image
seed
official parameters
VRAM reservation
inference start/end
output path
mesh statistics
texture status
```

Do not log authentication tokens.

---

# 59. Existing Model Regression Test

After Unique3D dependency installation and adapter registration, rerun at minimum:

```text
backend/tests/test_adapter_imports.py
backend/tests/test_generation_adapter_regressions.py
backend/tests/test_official_model_parity_contract.py
backend/tests/test_model_readiness.py
```

Unique3D must not break existing model imports or execution contracts.

---

# 60. Runtime Version Audit

Before declaring completion, record actual versions of:

```text
Python
PyTorch
TorchVision
CUDA
Diffusers
Transformers
PyTorch3D
torch_scatter
nvdiffrast
ONNX Runtime GPU
OpenCV
Pillow
PyMeshLab
xformers
NumPy
```

The final environment must be reproducible.

---

# 61. Full Model Selection Flow

The complete product flow must become:

```text
User uploads image
        ↓
Model selector
        ↓
Unique3D selected
        ↓
UI reads model metadata / readiness
        ↓
User selects official Unique3D parameters
        ↓
POST image_to_raw_mesh
        ↓
Scheduler validates model
        ↓
VRAM-aware job execution
        ↓
Unique3D adapter
        ↓
Official Unique3D code
        ↓
GLB
        ↓
master/source.glb
        ↓
Existing production pipeline
        ↓
3D viewer / downloads
```

---

# 62. Documentation Updates Required

Because `RULES.md` requires documentation to stay current, review all relevant existing docs after implementation.

At minimum inspect:

```text
README.md
Docs/ARCHITECTURE.md
Docs/DESIGN.md
Docs/PRD.md
Docs/DECISIONS.md
Docs/MEMORY.md
Docs/SYSTEM-BLUEPRINT.md
Docs/TASKS.md
Docs/api-documentation.md
Docs/SECURITY.md
Docs/CHANGELOG.md
```

Update only the documents whose factual content changes.

Do not create a duplicate model document if an existing document owns the relevant information.

---

# 63. Architecture Documentation

Add Unique3D to the model execution section of `Docs/ARCHITECTURE.md`.

Include:

```text
Model: Unique3D
ID: unique3d_image_to_raw_mesh
Feature: image_to_raw_mesh
Input: image
Output: glb
Texture: supported
Official source: AiuniAI/Unique3D
Weights: backend/pretrained/Unique3D
VRAM: verified runtime reservation
```

Update model/adapter counts if those counts are explicitly documented.

---

# 64. README

Update the model matrix in `README.md` if present.

Recommended entry:

```text
Unique3D | unique3d_image_to_raw_mesh | Single-Image to 3D | <verified VRAM> | High-fidelity textured reconstruction from one image
```

Do not publish an unverified VRAM number.

---

# 65. API Documentation

Update `Docs/api-documentation.md` so the image-to-raw-mesh model list contains:

```text
unique3d_image_to_raw_mesh
```

Document the model-native parameter schema actually exposed.

---

# 66. Architecture Decision

Update `Docs/DECISIONS.md` with a short decision stating:

- official Unique3D source is vendored;
- `.git` metadata is removed;
- shared ForMash3D Torch/CUDA runtime is used;
- a thin adapter bridges official inference to ForMash3D;
- source fidelity is preserved;
- downstream optimization remains separate.

Also record the exact upstream commit used.

---

# 67. Licensing / Security

Update the existing third-party/license/security documentation as needed.

Requirements:

- preserve MIT license;
- preserve upstream attribution;
- no credentials in code;
- use existing Hugging Face token mechanism;
- model downloads remain backend/server-side;
- generated artifacts use existing validated storage paths.

---

# 68. No Duplicate Model Download Locations

There must be one canonical weight root:

```text
backend/pretrained/Unique3D
```

Do not create multiple copies under different project directories without a demonstrated upstream requirement.

---

# 69. No Duplicate Model IDs

After implementation:

```bash
grep -R "unique3d_image_to_raw_mesh" .
```

Every registration should resolve to the same ID.

No accidental aliasing is allowed.

---

# 70. Definition of Done

Unique3D is NOT complete merely because the model appears in the UI or its weights download successfully.

The integration is complete only when all of the following work:

```text
Official Unique3D source
        +
Official weights
        +
Shared ForMash3D environment
        +
Thin adapter
        +
Model config
        +
Model factory
        +
Scheduler
        +
API
        +
Download manager
        +
Readiness
        +
Frontend model registry
        +
Generation UI
        +
Official parameter wiring
        +
Job persistence
        +
Post-processing
        +
Viewer
        +
Tests
        +
Documentation
        +
GPU smoke test
```

---

# 71. Required Final Verification Report

The coding agent must finish with a report in this exact style:

```text
Unique3D Integration: COMPLETE / INCOMPLETE

Official upstream commit: <commit>
Model ID: unique3d_image_to_raw_mesh
Weights: READY / NOT READY
VRAM reservation: <verified MB>

Adapter: PASS / FAIL
Lazy adapter import: PASS / FAIL
Model factory: PASS / FAIL
Backend config: PASS / FAIL
Downloader: PASS / FAIL
manager.sh: PASS / FAIL
Frontend registry: PASS / FAIL
Generate UI: PASS / FAIL
Parameter parity: PASS / FAIL
Readiness: PASS / FAIL
GPU smoke test: PASS / FAIL
Postprocess: PASS / FAIL
Viewer: PASS / FAIL
Regression tests: PASS / FAIL
Documentation: UPDATED / INCOMPLETE
```

Do not claim completion while a mandatory verification item remains untested.

---

# 72. Recommended Implementation Order

## Phase 1 — Source and dependency foundation

```text
Read RULES/docs
→ inspect official Unique3D
→ clone official source
→ record upstream commit
→ remove .git
→ preserve license
→ audit requirements
→ remove conflicting Torch/TorchVision/Torchaudio requirements
→ verify shared dependency compatibility
```

## Phase 2 — Weight management

```text
Download script
→ manager.sh
→ official ckpt layout
→ verification
→ readiness
```

## Phase 3 — Backend model integration

```text
adapter
→ lazy adapter map
→ model factory
→ models.yaml
→ system/readiness
→ API validation
→ scheduler
```

## Phase 4 — Frontend

```text
constants/models.ts
→ GeneratePanel
→ buildGenerationParameters
→ model readiness/status
→ parameter controls
```

## Phase 5 — Validation

```text
adapter tests
→ readiness tests
→ parameter parity
→ dependency regression
→ direct official baseline
→ real GPU adapter run
→ postprocess
→ viewer
```

## Phase 6 — Documentation and final audit

```text
README
→ ARCHITECTURE
→ DECISIONS
→ MEMORY
→ SYSTEM-BLUEPRINT
→ TASKS
→ API docs
→ SECURITY/license
→ CHANGELOG
→ deep gap audit
```

---

# 73. Final Architectural Rule

The intended architecture is:

```text
Official AiuniAI/Unique3D
        │
        │ vendored source
        ▼
backend/thirdparty/Unique3D
        │
        │ thin adapter
        ▼
Unique3DImageToRawMeshAdapter
        │
        ▼
ForMash3D Model Factory
        │
        ▼
VRAM-Aware Scheduler
        │
        ▼
Image → Raw Mesh API
        │
        ▼
master/source.glb
        │
        ▼
Existing ForMash3D Post-Processing
        │
        ├── Retopo
        ├── UV
        ├── Texture
        ├── LOD
        ├── Collision
        └── Game Ready
        │
        ▼
Next.js / Three.js Viewer
```

**Core principle:** integrate around Unique3D; do not rewrite Unique3D.

The ForMash3D integration layer owns model lifecycle, scheduling, storage, API, readiness, download management, UI, and production-pipeline wiring. The official Unique3D source remains responsible for its own inference behavior and model-native parameters.

---

# 74. Audit Findings Used to Produce This Plan

The current Dev branch already has:

- a centralized YAML model manifest;
- lazy adapter registration;
- model factory mapping;
- VRAM-aware scheduling;
- backend readiness reporting;
- official-model parity tests;
- a Hugging Face model downloader;
- interactive `manager.sh` model installation;
- frontend model registry;
- model-specific parameter generation;
- admin model status UI;
- immutable source/master post-processing contract.

Therefore the implementation should be an **extension of existing infrastructure**, not a new subsystem.

The most important integration risks identified from the official Unique3D source are:

1. historical Torch/CUDA version assumptions;
2. PyTorch3D/torch-scatter compatibility;
3. nvdiffrast native extension build/runtime;
4. headless OpenGL/EGL initialization;
5. relative `./ckpt/...` path assumptions;
6. generic module-name import collisions;
7. checkpoint/code version mismatch.

These must be tested explicitly before the model is marked production-ready.

---

# 75. Absolute Completion Condition

The implementation is complete only when a user can do:

```text
Model Manager
    ↓
Download Unique3D
    ↓
Ready
    ↓
Workspace
    ↓
Upload one image
    ↓
Select Unique3D
    ↓
Generate
    ↓
Official Unique3D inference
    ↓
GLB
    ↓
ForMash3D post-processing
    ↓
3D viewer
    ↓
Download
```

with no manual copying of model source, no manual Python environment, no second server, no second model manager, no bypass of the scheduler, and no missing registration layer.

**Do not mark the task complete until the entire chain has been tested.**
