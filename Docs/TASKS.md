# ForMash3D — Zero123++ v1.2 Multi-View Generation Implementation Plan

**Status:** Completed & Verified  
**Target branch:** `Dev`  
**Scope:** Multi-View generation + Multi-View image export + Multi-View → 3D integration  
**Primary model:** `sudo-ai/zero123plus-v1.2`  
**Model visibility:** Hidden from the normal Single Image / Text model selector  
**Environment:** Existing ForMash3D `3daigc-api` environment only  
**Python:** 3.10  
**PyTorch:** 2.6.0 + CUDA 12.4  
**GPU lifecycle:** Load on demand → infer → save → unload  

---

## 1. Goal

Add a real Multi-View workflow to ForMash3D where the user can:

1. Switch the Generate input mode from **Single Image** to **Multi-View**.
2. Reuse an image already uploaded in Single Image mode without uploading it again.
3. Generate a consistent six-view image set from that image using **Zero123++ v1.2**.
4. Inspect the generated views in a dedicated Multi-View gallery with zoom/pan.
5. Export the generated views as a ZIP without generating a 3D mesh.
6. Upload an existing set of multi-view images and export them as a ZIP.
7. Send a Multi-View set into a selected 3D model only when that model explicitly declares `multiview: true`.
8. Keep the Zero123++ model hidden from the normal 3D model selector.
9. Store generated Multi-View assets under the canonical mesh workspace in a dedicated `multiview/` directory.
10. Maintain deterministic hashes/manifests so Multi-View output can be traced, cached and reproduced.

---

# 2. Research findings that constrain the implementation

## 2.1 Zero123++ v1.2

Official project:

- Repository: `https://github.com/SUDO-AI-3D/zero123plus`
- Base checkpoint: `sudo-ai/zero123plus-v1.2`
- Official custom Diffusers pipeline is provided by the upstream repository.
- The v1.2 model is designed more specifically for 3D generation than generic novel-view synthesis.
- v1.2 handles input camera intrinsics more deliberately, is more robust to input FOV/cropping, and normalizes its output FOV to 30°.
- Fixed output camera azimuths relative to the input are:
  - 30°
  - 90°
  - 150°
  - 210°
  - 270°
  - 330°
- v1.2 fixed elevations alternate:
  - 20°
  - -10°
  - 20°
  - -10°
  - 20°
  - -10°
- The official base inference example requires about 5 GB VRAM.
- Recommended input is square, with recommended resolution at least 320×320.
- Around 28 inference steps is normally enough; delicate details may benefit from 75–100 steps.
- The official model repository is about 5.58 GB on disk.
- v1.2 also has a separate normal-generation ControlNet capable of producing view-space normal images.
- The upstream repository documents a normal-image → alpha/mask post-processing path.

### Critical terminology rule

Do **not** call the normal output a conventional tangent-space texture normal map in the UI.

Use:

> **View-Space Normals**

because these are view-space normal images generated for reconstruction/masking.

---

## 2.2 Background / mask handling

Zero123++ base output is opaque and can contain the model's gray background.

The upstream project recommends an additional background-removal pass such as `rembg`.

Therefore the Multi-View system should treat background removal as an optional post-generation processing stage rather than claiming that Zero123++ itself is a general background-removal model.

Recommended toggles:

- `Transparent Background`
- `Generate Masks`
- `Generate View-Space Normals`

`Generate View-Space Normals` is optional because it adds another inference stage and additional VRAM/time.

Do **not** add a Depth ControlNet toggle to the v1.2 Multi-View drawer unless a separately verified v1.2 depth path is introduced. The official repository documents the depth ControlNet for the v1.1 path, while v1.2 documents the normal-generation ControlNet.

---

## 2.3 License constraint

The official repository states:

- Code: Apache-2.0
- Model weights: CC-BY-NC 4.0

The upstream README states that the model or derivatives cannot be used in a commercial product pipeline, while generated outputs can be used freely.

This is an explicit product/legal constraint.

### Implementation requirement

Keep Zero123++ isolated behind a dedicated Multi-View adapter and feature type so it can be replaced later without changing:

- Multi-View UI
- storage
- hashing
- ZIP export
- job lifecycle
- Multi-View 3D request contract

Do not silently represent Zero123++ as a generally commercial-safe dependency.

---

# 3. Existing ForMash3D findings

The current `Dev` branch already contains a partial Multi-View UI skeleton.

Important current behavior:

- `features/workspace/Panels/GeneratePanel.tsx` already has a Multi-View area and four slots.
- `generationSettings` already contains `multiviewImages`.
- Single-image upload already stores:
  - preview image
  - `imageFileId`
  - `imageName`
- Existing Multi-View upload currently collects images but deliberately rejects real Multi-View generation because the backend contract is still single-image.
- `backend/config/models.yaml` already uses a `capabilities.multiview` field.
- Current registered image-to-3D models are marked `multiview: false`.
- Some models already expose `max_images`.
- `backend/core/scheduler/model_factory.py` is the canonical model registration/config bridge.
- The scheduler already supports:
  - on-demand worker creation
  - GPU-aware scheduling
  - model loading
  - model unloading
  - automatic unload after successful/failed generation
- Current global Python runtime is already:
  - Python 3.10
  - PyTorch 2.6.0
  - torchvision 0.21.0
  - CUDA 12.4 wheels
- Current project uses one shared `3daigc-api` environment.
- Canonical mesh asset storage is:
  `backend/storage/models/meshes/<asset_name>_<job_id>/`
- Existing ZIP delivery is on-demand, not stored as a permanent export tree.
- `RULES.md` requires reusing existing architecture, root-cause analysis, minimal changes, and keeping documentation current.

### Important consequence

Do **not** create a second Multi-View system beside the current GeneratePanel state or a second scheduler.

Extend the existing contracts.

---

# 4. Product workflow

## 4.1 Single Image → Multi-View

```text
User uploads car.png
        ↓
Single Image state stores:
  image
  imageFileId
  imageName
        ↓
User clicks Multi-View
        ↓
Same image automatically appears
        ↓
User clicks Generate Views
        ↓
Zero123++ worker loads
        ↓
Generate six-view result
        ↓
Split + name views
        ↓
Optional masks / view-space normals
        ↓
Save multiview/
        ↓
Unload Zero123++
        ↓
Gallery becomes available
```

No re-upload is required.

---

# 5. Multi-View UI

## 5.1 Input-mode selector

Use the existing Generate panel input switch.

Target modes:

```text
Single Image
Multi-View
```

Do not expose Zero123++ as an ordinary `AI Model` option.

---

## 5.2 Multi-View input modes

Inside Multi-View:

```text
[ Generate Views ] [ Upload Views ]
```

### Generate Views

Requires exactly one source image.

The source can be:

- image already uploaded in Single Image mode
- newly uploaded in Multi-View mode

### Upload Views

Allows the user to supply a manual set of view images.

Supported practical minimum:

- 2 images for collection/export
- 3+ images for meaningful reconstruction
- up to the selected model's declared `max_images`

The exact reconstruction minimum/maximum is a backend capability contract, not hardcoded UI behavior.

---

# 6. Model capability gate

When the user selects a 3D model for Multi-View reconstruction:

```text
selected 3D model
        ↓
backend capability
        ↓
capabilities.multiview
        ↓
      true?
     /      \
   YES       NO
    ↓         ↓
Enable     Disable
Generate 3D Generate 3D
```

### UI behavior

If supported:

```text
Multi-View Support
✓ Supported

[ Generate 3D ]
```

If unsupported:

```text
Multi-View Support
✕ Not supported by selected model

[ Generate 3D ]  disabled
```

### Backend must enforce this too

The UI lock is not a security boundary.

The Multi-View → 3D API must reject a request when:

```python
capabilities["multiview"] is not True
```

or when the requested image count exceeds:

```python
capabilities["max_images"]
```

when a limit exists.

---

# 7. Zero123++ model visibility

This is mandatory.

## Zero123++ must NOT appear in:

- Single Image 3D model selector
- Text-to-3D model selector
- Normal image-to-mesh model list
- Generic 3D model dropdowns

## Zero123++ may appear internally in:

- Multi-View generation capability metadata
- Model/download manager
- backend model registry
- scheduler diagnostics
- job logs
- system/model status APIs when appropriate

Recommended model manifest flags:

```yaml
feature_type: image_to_multiview
hidden_from_model_selector: true
multiview_generator: true
```

The existing model selector should continue filtering by actual generation feature type, so adding Zero123++ must never accidentally place it in `image_to_raw_mesh` or `image_to_textured_mesh`.

---

# 8. New adapter

Create:

```text
backend/adapters/zero123plus_adapter.py
```

This adapter must:

- inherit from the project's appropriate base model contract
- follow existing adapter lifecycle conventions
- load the official Zero123++ implementation
- keep upstream pipeline source unchanged
- expose only the ForMash3D-specific request/result translation
- support `torch.float16`
- target the existing CUDA worker
- unload cleanly
- expose truthful runtime information
- never perform 3D mesh post-processing
- never alter source image bytes

Suggested model ID:

```text
zero123plus_v12_image_to_multiview
```

Suggested feature:

```text
image_to_multiview
```

---

# 9. Third-party source installation

## 9.1 Vendor official repository

First add the upstream source under:

```text
backend/thirdparty/zero123plus/
```

Source:

```text
https://github.com/SUDO-AI-3D/zero123plus.git
```

Required vendor workflow:

```bash
cd backend/thirdparty
git clone https://github.com/SUDO-AI-3D/zero123plus.git zero123plus
rm -rf zero123plus/.git
```

The vendored upstream source is treated as third-party source.

### Do not rewrite the upstream implementation

Use the official files, especially:

```text
diffusers-support/
examples/
util/
predict.py
```

through the adapter.

---

# 10. Requirements strategy

The current ForMash3D environment already owns:

```text
Python 3.10
torch==2.6.0+cu124
torchvision==0.21.0+cu124
torchaudio==2.6.0+cu124
```

The upstream Zero123++ requirements currently list their own unpinned `torch` and `torchvision`, plus older pins such as:

```text
diffusers==0.20.2
transformers==4.29.2
```

### Mandatory ForMash3D rule

Do not let the upstream requirements overwrite the project's PyTorch runtime.

The effective runtime must remain:

```text
Python 3.10
PyTorch 2.6.0
torchvision 0.21.0
CUDA 12.4
```

### Installation approach

Do not create another environment.

Do not install a second PyTorch build.

Use an installer-controlled dependency overlay:

1. Clone the official repository.
2. Read its `requirements.txt`.
3. Remove/filter only upstream `torch` and `torchvision` entries before installation.
4. Keep the existing ForMash3D PyTorch 2.6 installation authoritative.
5. Install the remaining required runtime dependencies into `3daigc-api`.
6. Verify compatibility with the project's current `diffusers` / `transformers` baseline before changing any global versions.
7. Do not globally downgrade `diffusers` just because the upstream README recommends 0.20.2.
8. If compatibility requires an adapter-local compatibility patch, keep that patch in ForMash3D rather than creating another Python environment.
9. Do not modify unrelated model requirements.

### Important dependency rule

The official upstream requirements include demo-oriented packages such as Streamlit/Gradio. They should not automatically be added to production just because the upstream repository contains its demo.

Install only dependencies actually required by the ForMash3D adapter/runtime.

---

# 11. Installation script integration

Update:

```text
backend/scripts/install.sh
```

Add a dedicated section after the shared PyTorch baseline and before final application validation.

The section should:

1. Ensure the official third-party source exists.
2. Verify it is the expected Zero123++ repository.
3. Keep the vendor directory without its `.git`.
4. Install its non-PyTorch dependencies into the existing `3daigc-api` environment.
5. Never replace:
   - Python 3.10
   - torch 2.6.0
   - torchvision 0.21.0
6. Verify imports after installation.
7. Run a lightweight CPU-safe import check without executing GPU inference.
8. Fail clearly if the Zero123++ adapter cannot import.

Suggested install log:

```text
[INFO] Installing Zero123++ v1.2 dependencies
[INFO] Reusing existing 3daigc-api environment
[INFO] Python: 3.10
[INFO] PyTorch: 2.6.0+cu124
[INFO] torchvision: 0.21.0+cu124
[INFO] Zero123++ dependency installation complete
```

---

# 12. Download manager integration

Update:

```text
backend/scripts/download_models.sh
```

Add a dedicated hidden/internal download entry:

```text
zero123plus
```

Recommended source:

```text
sudo-ai/zero123plus-v1.2
```

Expected local directory:

```text
backend/pretrained/zero123plus-v1.2/
```

The download manager should support the existing patterns:

```text
download
verify
force re-download
list
```

The model can be present in the download manager while remaining hidden from the normal 3D model selector.

### Do not auto-download optional normal ControlNet by default

Base Multi-View generation and the optional normal-generation ControlNet should have separate weight entries.

Recommended:

```text
zero123plus
zero123plus_normal_controlnet
```

The second checkpoint should be optional and only downloaded/used when the user enables View-Space Normals.

---

# 13. Model manifest

Add a dedicated feature section to:

```text
backend/config/models.yaml
```

Conceptually:

```yaml
image_to_multiview:
  zero123plus_v12_image_to_multiview:
    capabilities:
      image_to_multiview: true
      multiview: true
      fixed_view_count: 6
      view_normals: true
      masks: true
      image_export: true
      hidden_from_model_selector: true
    vram_requirement: 5120
    supported_inputs: ["image"]
    supported_outputs: ["png", "zip"]
    model_path: "backend/pretrained/zero123plus-v1.2"
    enabled: true
    max_workers: 1
```

The exact VRAM field should be treated as a scheduler planning estimate, while runtime telemetry remains authoritative.

### Important

This entry is NOT:

```yaml
image_to_raw_mesh:
```

and is NOT:

```yaml
image_to_textured_mesh:
```

That keeps Zero123++ invisible in the existing 3D model picker.

---

# 14. Scheduler lifecycle

Use the existing scheduler rather than adding a separate Multi-View worker framework.

Expected lifecycle:

```text
QUEUED
  ↓
LOADING_MODEL
  ↓
PREPARING_REFERENCE
  ↓
GENERATING_MULTIVIEW
  ↓
SPLITTING_VIEWS
  ↓
OPTIONAL_MASKS
  ↓
OPTIONAL_NORMALS
  ↓
SAVING_ARTIFACTS
  ↓
UNLOADING_MODEL
  ↓
COMPLETED
```

The scheduler must preserve the existing GPU mutual-exclusion and VRAM safety rules.

---

# 15. Model load / unload behavior

When the user clicks:

> Generate Views

The system must:

1. enqueue the job
2. load Zero123++ only when the worker starts
3. generate the views
4. save all artifacts
5. release model references
6. call the existing unload path
7. release GPU memory
8. complete the job

No persistent Zero123++ model should remain loaded just because the user opened Multi-View mode.

### Failure path

If generation fails:

```text
load
→ fail
→ unload
→ release GPU
→ mark job failed
```

The worker must not stay resident with the partially initialized pipeline.

---

# 16. Multi-View output structure

Extend the canonical workspace:

```text
backend/storage/models/meshes/<asset_name>_<job_id>/
```

to:

```text
<asset_name>_<job_hash>/
├── multiview/
│   ├── source.png
│   ├── front_right_30.png
│   ├── right_90.png
│   ├── back_right_150.png
│   ├── back_left_210.png
│   ├── left_270.png
│   ├── front_left_330.png
│   ├── contact_sheet.png
│   ├── manifest.json
│   ├── masks/
│   │   ├── front_right_30.png
│   │   └── ...
│   └── normals/
│       ├── front_right_30.png
│       └── ...
├── master/
├── game_ready/
├── lods/
├── collision/
├── textures/
├── previews/
└── metadata/
```

Only create optional directories when the corresponding outputs are actually generated.

Do not create empty placeholder trees.

---

# 17. Single-image source retention

If the starting image was uploaded in Single Image mode:

```text
single image
    ↓
Multi-View
```

preserve the original source image as:

```text
multiview/source.png
```

This is a copy for the asset workspace.

The original uploaded file remains the canonical upload source.

Never overwrite the original upload.

---

# 18. View naming

The six official v1.2 cameras should be stored using their actual relative azimuths.

Recommended filenames:

```text
front_right_30.png
right_90.png
back_right_150.png
back_left_210.png
left_270.png
front_left_330.png
```

This is better than falsely naming 30° as exact `front.png`.

For the UI, human-readable labels can be:

```text
Front Right
Right
Back Right
Back Left
Left
Front Left
```

The manifest must retain the exact numeric azimuth/elevation/FOV.

---

# 19. Manual Multi-View upload

User can open:

```text
Multi-View → Upload Views
```

and upload multiple images.

The backend stores each image as an input artifact.

Provide view assignment UI:

```text
Front
Back
Left
Right
Front Right
Front Left
```

For arbitrary user image sets, allow a view to remain:

```text
Unassigned
```

until the user maps it.

Do not silently guess a view angle without storing that it was inferred.

---

# 20. Multi-View image-only export

A user must be able to use Multi-View without generating a mesh.

Flow:

```text
Upload / Generate Views
        ↓
Review gallery
        ↓
Export ZIP
        ↓
Done
```

No 3D model is required for image-only export.

---

# 21. ZIP filename contract

The ZIP filename must always derive from the originally uploaded image filename.

Example:

```text
Uploaded:
spaceship.png

ZIP:
spaceship.zip
```

Do not use:

```text
spaceship_multiview_8439.zip
generated_views.zip
job_<id>.zip
```

Internally the asset directory can remain hash-based.

---

# 22. ZIP contents

Generated set:

```text
spaceship.zip
├── front_right_30.png
├── right_90.png
├── back_right_150.png
├── back_left_210.png
├── left_270.png
├── front_left_330.png
└── manifest.json
```

When optional outputs are enabled:

```text
spaceship.zip
├── views/
├── masks/
├── normals/
└── manifest.json
```

The user should not need to choose internal ZIP naming.

---

# 23. Hash design

Use stable SHA-256 hashes.

## Input hash

```text
source_sha256
```

Hash the actual source image bytes.

## Generation request hash

Build from canonicalized data:

```text
source_sha256
model_id
model_version
adapter_version
inference_steps
seed
background_removal
generate_masks
generate_normals
output_format
```

Canonicalize key ordering before hashing.

Example:

```text
mv_request_sha256 = SHA256(canonical_json)
```

## Asset directory

Use:

```text
<safe_asset_name>_<short_hash>/
```

Example:

```text
spaceship_7f3a21c9/
```

### Why this matters

The hash must distinguish:

- same image / same settings
- same image / different settings
- same image / different model version
- regenerated result
- optional normal/mask generation

This enables deterministic cache checks and avoids accidentally mixing artifacts.

---

# 24. Manifest

Write:

```text
multiview/manifest.json
```

with at least:

```json
{
  "schema_version": 1,
  "source_filename": "spaceship.png",
  "source_sha256": "...",
  "request_sha256": "...",
  "model_id": "zero123plus_v12_image_to_multiview",
  "model_version": "v1.2",
  "adapter_version": "...",
  "inference_steps": 28,
  "seed": "...",
  "output_fov_deg": 30,
  "view_count": 6,
  "views": [
    {
      "file": "front_right_30.png",
      "azimuth_deg": 30,
      "elevation_deg": 20
    }
  ],
  "masks_generated": false,
  "view_space_normals_generated": false,
  "created_at": "..."
}
```

Do not invent numeric values when runtime data is unavailable.

---

# 25. Multi-View gallery

After successful generation, opening the Multi-View mode should immediately show the generated images when available.

Grid:

```text
┌────────────┬────────────┬────────────┐
│ Front Right│   Right    │ Back Right │
│            │            │            │
├────────────┼────────────┼────────────┤
│ Back Left  │    Left    │ Front Left │
│            │            │            │
└────────────┴────────────┴────────────┘
```

Each card should show:

- view label
- azimuth
- optional elevation
- generated/uploaded state
- optional mask/normal indicator

---

# 26. Image zoom viewer

Clicking any Multi-View image opens a larger viewer.

Required interactions:

- zoom in
- zoom out
- fit to screen
- 100%
- pan
- previous image
- next image
- close

Useful keyboard controls:

```text
Esc   close
←     previous
→     next
+     zoom in
-     zoom out
0     fit
1     100%
```

Do not load a second heavy image viewer dependency if an existing project utility can provide the interaction.

---

# 27. Drawer

Multi-View advanced controls belong in a drawer.

Recommended:

```text
MULTI-VIEW OPTIONS

Generation
────────────────────
Inference Steps
[ 28 ]

Seed
[ Auto ]

Output
────────────────────
☑ Save Contact Sheet

Post Processing
────────────────────
☐ Transparent Background
☐ Generate Masks
☐ Generate View-Space Normals

Export
────────────────────
☑ Include Manifest
```

### Defaults

- 28 inference steps
- automatic seed
- contact sheet enabled
- manifest enabled
- masks disabled
- view-space normals disabled

The defaults should favor useful low-VRAM behavior.

---

# 28. Generate 3D action

There are two different actions and they must not be confused:

### `Generate Views`

Loads Zero123++.

### `Generate 3D`

Loads the selected 3D reconstruction model.

That means:

```text
Generate Views
      ↓
Zero123++
      ↓
UNLOAD
      ↓
Generate 3D
      ↓
3D model
      ↓
UNLOAD
```

Never keep both large inference models resident unless an explicit future requirement proves it necessary.

---

# 29. Multi-View → 3D request contract

Use a normalized backend contract similar to:

```json
{
  "input_type": "multiview",
  "images": [
    {
      "file_id": "...",
      "view": "front_right",
      "azimuth_deg": 30,
      "elevation_deg": 20
    }
  ],
  "model_preference": "..."
}
```

The exact adapter input transformation stays model-specific.

The shared scheduler should not assume all 3D models consume six images identically.

---

# 30. Existing 3D model compatibility

A model is eligible only when its manifest/adapter actually supports:

```yaml
multiview: true
```

and, where applicable:

```yaml
max_images: N
```

Do not set `multiview: true` merely because a research paper mentions multi-view.

The adapter must have an actual tested ForMash3D contract.

---

# 31. Source fidelity rule

Multi-View image generation itself does not produce a 3D mesh.

Once Multi-View images are sent to a 3D generator, the existing ForMash3D source-fidelity contract remains unchanged:

```text
Multi-View evidence
       ↓
3D model-native maximum fidelity
       ↓
master/source.glb
       ↓
post-processing
       ↓
game_ready
```

Do not pass downstream `target_polycount` into the Zero123++ image generator as a geometry setting.

---

# 32. Storage integration for image-only jobs

A Multi-View-only job should still create a canonical asset workspace.

Example:

```text
backend/storage/models/meshes/spaceship_<job_id>/
└── multiview/
    ├── source.png
    ├── ...
    └── manifest.json
```

No empty `master/` or `game_ready/` directory should be created for an image-only job.

This follows the project's existing rule to defer non-master artifact directories until actually needed.

---

# 33. API design

Add a dedicated router rather than forcing Multi-View into the single-image request schema.

Suggested:

```text
backend/api/routers/multiview.py
```

Endpoints:

```text
POST /api/v1/multiview/generate
POST /api/v1/multiview/upload
GET  /api/v1/multiview/{asset_id}
GET  /api/v1/multiview/{asset_id}/download
GET  /api/v1/multiview/{asset_id}/zip
```

If an existing project endpoint already cleanly covers one of these operations, reuse it instead of duplicating it.

The exact route names should follow existing API naming conventions after tracing the current router structure.

---

# 34. Frontend state

Extend `GenerationSettings` only where existing shared state cannot already carry the required information.

Do not create a parallel global store.

Suggested additional state if necessary:

```text
multiviewSourceFileId
multiviewJobId
multiviewStatus
multiviewViews
multiviewManifest
multiviewZipUrl
multiviewError
multiviewInputMode
```

Prefer deriving these from existing job/result state where possible.

---

# 35. UI behavior when switching modes

## Single → Multi-View

If:

```text
generationSettings.image exists
```

automatically show it as the Multi-View reference.

## Multi-View → Single

Do not delete the Multi-View result.

## Reload workspace

Restore completed Multi-View assets from backend history/canonical storage rather than relying only on React memory.

---

# 36. Model selector separation

The generic 3D model selector must continue to contain only actual mesh-generation models.

Do not add:

```text
Zero123++
```

to:

```text
image_to_raw_mesh
image_to_textured_mesh
text_to_textured_mesh
```

Instead:

```text
image_to_multiview
```

is its only model feature.

The Multi-View UI may internally request:

```text
zero123plus_v12_image_to_multiview
```

without exposing the model as a normal user-selectable 3D provider.

---

# 37. Dependency safety

Because the project uses a shared environment, dependency changes require extra care.

Required checks:

```bash
python --version
python -c "import torch; print(torch.__version__)"
python -c "import torchvision; print(torchvision.__version__)"
python -c "import diffusers; print(diffusers.__version__)"
python -c "import transformers; print(transformers.__version__)"
```

Expected core:

```text
Python 3.10.x
torch 2.6.0+cu124
torchvision 0.21.0+cu124
```

The exact compatible `diffusers`/`transformers` versions must be established against the existing ForMash3D environment before changing any global pins.

Do not break existing TRELLIS/Hunyuan/Tripo adapters to satisfy one upstream dependency blindly.

---

# 38. Docker integration

Update the project Docker build only as needed.

The existing Dockerfile already establishes:

```text
CUDA 12.4
Python 3.10
PyTorch 2.6.0
```

Do not add a Zero123++ virtual environment.

Add:

- official third-party source checkout
- filtered/runtime dependencies
- model package initialization
- import verification

Do not auto-download 5.58 GB of model weights during every Docker build unless that is already the project's established model provisioning strategy.

Prefer the existing model downloader/storage flow for weights.

---

# 39. Download verification

The downloader should verify:

- model directory exists
- required files exist
- model metadata exists
- no partial checkpoint is treated as ready
- optional ControlNet is independently verified

A failed/partial download must report `weights_status: false`.

---

# 40. Runtime verification

Before declaring the feature complete:

## Import-level

```text
Zero123++ adapter import succeeds
official pipeline import succeeds
model registry loads
```

## Scheduler-level

```text
job queues
worker starts
model loads
job completes
model unloads
```

## Artifact-level

```text
six PNGs exist
manifest exists
hash exists
ZIP exists
```

## GPU-level

On an NVIDIA environment:

```text
VRAM before
VRAM peak
VRAM after unload
```

must be captured.

The post-unload VRAM must return close to the pre-job baseline; exact allocator behavior must be reported rather than assumed.

---

# 41. Regression tests

Add focused tests under existing test conventions.

Minimum:

### Capability

- hidden Zero123++ model is not exposed in generic model selector
- Zero123++ appears only in `image_to_multiview`
- `multiview: false` keeps Generate 3D disabled
- `multiview: true` enables Generate 3D
- `max_images` is enforced

### State

- Single-image upload is reused when switching to Multi-View
- Multi-View result survives mode switching
- image name is preserved for ZIP naming

### Hash/storage

- deterministic input hash
- deterministic request hash
- canonical `multiview/` output directory
- no empty artifact folders

### Output

- six official view names
- manifest includes exact azimuth/elevation/FOV
- ZIP contains all selected outputs
- ZIP filename uses uploaded image stem

### Lifecycle

- model loads on job start
- model unloads on success
- model unloads on failure

### Isolation

- Zero123++ does not change `image_to_raw_mesh`
- Zero123++ does not change `image_to_textured_mesh`
- existing single-image models remain single-image unless their own adapter explicitly gains Multi-View support

---

# 42. Validation matrix

| Scenario | Expected |
|---|---|
| Single image only | Existing workflow unchanged |
| Single → Multi-View | Existing image appears automatically |
| Generate Views | Zero123++ job runs |
| Zero123 success | six view images saved |
| Zero123 fail | model unloaded + job failed |
| Generate masks OFF | no masks directory |
| Normals OFF | no normals directory |
| Export ZIP only | no 3D job required |
| Existing uploaded image | source reused |
| Manual multi-view upload | gallery + ZIP work |
| Unsupported 3D model | Generate 3D disabled |
| Supported 3D model | Generate 3D enabled |
| Model max_images exceeded | request rejected |
| Zero123 model selector | hidden |
| Single-image model lists | unchanged |
| Workspace reload | Multi-View asset discoverable |
| Same source/settings | same request hash |
| Different steps/seed | different request hash |
| GPU success | Zero123 unloaded |

---

# 43. UX rules

Keep the main Multi-View UI compact.

Main surface:

```text
Reference
View set
Generate Views
Generate 3D
Export ZIP
```

Advanced drawer:

```text
steps
seed
background
mask
view-space normals
contact sheet
manifest
```

Do not put all technical controls directly into the main panel.

---

# 44. Accessibility / interaction rules

- All buttons need descriptive labels/tooltips.
- Disabled Generate 3D must explain why.
- Loading state must identify the active phase.
- Upload errors must identify the exact problem.
- Generated image cards must have useful accessible labels.
- Keyboard navigation must work through the gallery.
- Zoom controls need accessible labels.

---

# 45. No fake capability

Never display:

```text
Multi-View Supported
```

based on:

- model name
- paper title
- UI assumption
- presence of multiple uploaded images

Only backend manifest + adapter capability defines support.

---

# 46. No fake output

Never generate placeholder thumbnails or pretend the current single-image backend consumed multiple images.

A Multi-View asset is complete only when its actual requested view files have been written and verified.

---

# 47. No duplicate model runtime

Do not create:

```text
zero123_env/
venv_zero123/
conda-zero123/
```

ForMash3D must use the existing:

```text
3daigc-api
```

environment.

---

# 48. Official source preservation rule

The third-party source must remain recognizable as the official upstream implementation.

Preferred architecture:

```text
backend/thirdparty/zero123plus/
        ↑
official upstream code

backend/adapters/zero123plus_adapter.py
        ↑
ForMash3D integration layer
```

Do not fork the official pipeline into a rewritten parallel implementation.

---

# 49. Recommended implementation order

## Phase 1 — Vendor + runtime

1. Clone official repository into `backend/thirdparty/zero123plus`.
2. Remove `.git`.
3. Add model downloader entry.
4. Add installer section.
5. Filter upstream torch/torchvision requirements.
6. Reuse Python 3.10 + PyTorch 2.6.
7. Add import verification.

## Phase 2 — Adapter

1. Add `zero123plus_adapter.py`.
2. Load official custom Diffusers pipeline.
3. Normalize input image.
4. Run inference.
5. Split the six-view output.
6. Save view metadata.
7. Unload model.

## Phase 3 — Backend contract

1. Add `image_to_multiview` model feature.
2. Add capability metadata.
3. Add Multi-View job request/result contract.
4. Add storage and hash layer.
5. Add ZIP export.
6. Add optional mask/normal stages.

## Phase 4 — UI/UX

1. Replace current unavailable Multi-View placeholder.
2. Reuse Single Image source automatically.
3. Add Generate Views.
4. Add Upload Views.
5. Add capability gate for Generate 3D.
6. Add drawer.
7. Add gallery.
8. Add zoom viewer.
9. Add Export ZIP.

## Phase 5 — Multi-View → 3D

1. Add multi-image input contract.
2. Enable only verified 3D adapters.
3. Enforce capability on backend.
4. Generate model.
5. Keep `master/source.glb` fidelity contract unchanged.
6. Run normal post-processing afterwards.

## Phase 6 — Verification

1. Unit tests.
2. Static checks.
3. Install script validation.
4. Downloader verification.
5. GPU runtime test.
6. Visual gallery test.
7. ZIP content test.
8. Existing single-image regression test.
9. Re-read all affected documentation.

---

# 50. Required project documentation updates after implementation

Do not create a separate permanent documentation universe for this feature.

Update the existing files:

```text
Docs/PRD.md
Docs/ARCHITECTURE.md
Docs/DESIGN.md
Docs/TASKS.md
Docs/DECISIONS.md
Docs/MEMORY.md
Docs/CHANGELOG.md
Docs/SYSTEM-BLUEPRINT.md
README.md
```

At minimum document:

- Multi-View workflow
- Zero123++ adapter
- hidden model visibility
- capability gating
- storage layout
- hash contract
- ZIP naming
- GPU load/unload behavior
- optional masks
- optional view-space normals
- license constraint
- dependency/install behavior

Keep `Docs/CHANGELOG.md` within its existing “last 3 changes” convention.

---

# 51. RULES.md / mandatory implementation rules

The implementation must follow the repository's existing `RULES.md`.

### Root-cause / reuse

- Read the existing Multi-View placeholder and trace it end-to-end before changing it.
- Reuse the existing `generationSettings`, upload helpers, job queue, scheduler, model factory, file store, canonical asset storage, and ZIP infrastructure wherever possible.
- Do not create a second global state system.
- Do not create a second scheduler.
- Do not create a second ZIP/export subsystem unless the existing one cannot represent image-only Multi-View artifacts.
- Do not introduce a generic abstraction until existing code has been inspected for reuse.

### Third-party source

- Use the official Zero123++ repository.
- Clone into `backend/thirdparty/zero123plus`.
- Remove `.git` after vendoring.
- Keep the upstream implementation intact as far as possible.
- Put ForMash3D-specific behavior into the adapter/integration layer.
- Do not create an unrelated rewrite of the official pipeline.

### Dependency isolation

- Use the existing `3daigc-api` environment.
- Force Python 3.10.
- Keep PyTorch 2.6.0 + CUDA 12.4 as the project baseline.
- Never install an additional Torch build for Zero123++.
- Never create a Zero123-specific environment.
- Filter upstream `torch` and `torchvision` requirements rather than allowing them to overwrite project pins.
- Do not blindly downgrade global Diffusers/Transformers; validate compatibility first.
- Do not break existing model integrations to satisfy one upstream dependency.

### Feature isolation

- Zero123++ belongs only to `image_to_multiview`.
- Do not add it to `image_to_raw_mesh`.
- Do not add it to `image_to_textured_mesh`.
- Do not show it in the normal model selector.
- Do not allow it to be selected as a normal 3D generation provider.

### Capability truth

- UI availability must come from real backend capability metadata.
- Backend must enforce the same capability.
- `multiview: true` must mean an actual tested adapter contract.
- `max_images` must be respected.
- Never infer capability from filenames or model names.

### Source/image integrity

- Preserve original uploaded image bytes.
- Do not overwrite the original image.
- Do not modify the raw image just to simplify the UI state.
- Generated Multi-View images are derived artifacts.
- Hash source bytes and request settings deterministically.

### GPU lifecycle

- Load Zero123++ only when Generate Views is executed.
- Unload after success.
- Unload after failure.
- Do not keep Zero123++ resident while idle.
- Do not require Zero123++ and the 3D generator to occupy GPU memory simultaneously.

### Storage

- Use canonical asset storage.
- Create `multiview/` only when needed.
- Do not create persistent export directories.
- Generate ZIP files on demand.
- Keep the uploaded image stem for the ZIP filename.
- Use hash-based internal directories.

### UI/UX

- Keep main UI simple.
- Put advanced controls in the drawer.
- Let users inspect generated images before generating 3D.
- Support zoom/pan.
- Make disabled actions explain their reason.
- Never expose a fake working state.

### Documentation

After the implementation:

- re-read affected Markdown files
- update every relevant existing Markdown file
- keep architecture/decision/memory docs synchronized
- do not create a new permanent Markdown file solely because the implementation is easier to explain there

### Testing

At minimum validate:

- import
- model registry
- capability gate
- single → multiview state reuse
- generation
- unload
- storage
- hash
- ZIP
- gallery result
- unsupported model gate
- existing single-image regression

### Commit rule

Complete the entire implementation and documentation pass before creating the review commit.

The implementation target is **one commit** on `Dev` for the complete feature.

---

# 52. Explicit non-goals

Do not add these during this feature unless separately requested:

- Zero123++ in Single Image 3D model selector
- Text → Multi-View generation
- arbitrary camera control for Zero123++
- automatic depth ControlNet for v1.2
- automatic 3D generation immediately after every Multi-View generation
- simultaneous resident Zero123++ + 3D model
- separate Python environment
- commercial-license assumptions
- replacement of existing post-processing
- mesh simplification inside Zero123++ adapter

---

# 53. Acceptance criteria

The feature is considered complete only when all are true:

1. Multi-View mode is a real supported workflow, not a placeholder.
2. Existing Single Image uploads automatically appear in Multi-View.
3. `Generate Views` actually runs Zero123++ v1.2.
4. Zero123++ loads only for the job and unloads afterward.
5. Six actual view images are written.
6. Images are visible in the Multi-View gallery.
7. Images can be zoomed/panned.
8. User can export views as a ZIP without generating 3D.
9. ZIP filename uses the original uploaded image stem.
10. Multi-View artifacts are stored under `multiview/`.
11. Manifest and deterministic hashes are stored.
12. Optional masks and view-space normals are properly gated.
13. Selected 3D model is checked for `multiview` capability.
14. Generate 3D is locked when unsupported.
15. Backend independently rejects unsupported Multi-View requests.
16. Zero123++ does not appear in the normal 3D model selector.
17. Existing Single Image model flows remain unchanged.
18. Existing global PyTorch 2.6/Python 3.10 environment remains authoritative.
19. No extra virtual environment is created.
20. Official upstream source is vendored under `backend/thirdparty/zero123plus/` with `.git` removed.
21. Existing project docs are updated.
22. Tests cover the new contracts.
23. GPU runtime validation confirms load → inference → unload behavior.
24. The Zero123++ CC-BY-NC license restriction is documented and not hidden.

---

# 54. Research references

Official Zero123++ repository:

- https://github.com/SUDO-AI-3D/zero123plus

Official v1.2 checkpoint:

- https://huggingface.co/sudo-ai/zero123plus-v1.2

Official custom pipeline:

- `diffusers-support/` inside the Zero123++ repository

Official v1.2 normal-generation ControlNet:

- `sudo-ai/controlnet-zp12-normal-gen-v1`

Official requirements reference:

- https://github.com/SUDO-AI-3D/zero123plus/blob/main/requirements.txt

ForMash3D reference branch:

- https://github.com/Silentzx2/ForMash3D/tree/Dev

---

## Final implementation principle

```text
Existing Single Image
        │
        ├───────────────┐
        │               │
        ▼               ▼
Single Image → 3D    Multi-View
                    │
           ┌────────┴─────────┐
           │                  │
      Generate Views      Upload Views
           │                  │
      Zero123++          User Images
           │                  │
           └────────┬─────────┘
                    ▼
             Multi-View Pack
                    │
          ┌─────────┴──────────┐
          │                    │
     Export ZIP          Capability Check
                               │
                        ┌──────┴──────┐
                        │             │
                       YES            NO
                        │             │
                   Generate 3D      Locked
                        │
                        ▼
                  3D Adapter
                        │
                        ▼
                 master/source.glb
                        │
                        ▼
              Existing post-process
```

Zero123++ is therefore a **hidden, dedicated Multi-View image-generation provider**, not another 3D model. Its output becomes a reusable Multi-View asset pack that can either be exported directly or passed to a verified multi-view-capable 3D adapter.
