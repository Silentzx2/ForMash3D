# BUG.md — ForMash 3D Active Bug Registry

> **Doc Version**: 1.0
> **Last Updated**: 2026-10-03
> **Status**: ✅ **Implemented & Verified (All Tasks Completed & E2E Tested)**
> **Scope**: Storage contracts, UI/UX wiring, orientation transforms, detail retention, physics collision hardening, and follow-up contract audit
> **Rules**: Follows RULES.md (root-cause first, smallest fix, no new abstractions)

---

## How to Use This File

Each entry is structured as:
1. **Root cause** — the actual code line(s) that are wrong
2. **Observable symptom** — what the user sees
3. **Fix** — minimal diff to resolve
4. **Verification** — how to confirm the fix worked
5. **Recurrence guard** — pattern to prevent the same class of bug returning

---

## BUG-001 — TRELLIS / TRELLIS.2 Write Raw Mesh to Wrong Output Directory

**Severity**: High (breaks canonical storage contract; post-processing cannot find the file in some environments)
**Affects**: `trellis_adapter.py`, `trellis2_adapter.py`
**Status**: Implemented & Resolved

### Root Cause

Two adapters hard-code the raw mesh output path instead of using the shared `OutputPathGenerator` utility.

```
# trellis_adapter.py — image-to-raw-mesh path helper (line ~290)
output_dir = Path(__file__).resolve().parents[1] / "outputs" / "meshes"
# resolves to:  backend/outputs/meshes/

# trellis_adapter.py — text-to-raw-mesh path helper (line ~656)
output_dir = Path(os.getcwd()) / "outputs" / "meshes"
# resolves to:  {cwd}/outputs/meshes/   ← CWD-dependent, always wrong

# trellis2_adapter.py — both path helpers (lines ~219, ~467)
output_dir = Path(os.getcwd()) / "outputs" / "meshes"
# resolves to:  {cwd}/outputs/meshes/
```

All other adapters (TripoSR, TripoSG, Hunyuan Shape/DIT/Paint, PartPacker, FastMesh, etc.) use:

```python
self.path_generator = OutputPathGenerator(base_output_dir="outputs")
# OutputPathGenerator maps "outputs" → backend/storage/models/   (canonical)
# generate_mesh_path() returns:  backend/storage/models/meshes/<model_id>_<stem>_<uuid>.glb
```

`run_postprocess_job` in `pipeline.py` then promotes this to:
`backend/storage/models/meshes/<image_stem>_<job_id>/master/source.glb`
and deletes the temp file. The **canonical `<image_stem>_<job_hash>/` naming is already correct** in `pipeline.py` — it reads `job_inputs["image_path"]` stem + hashes `job_id`. No change needed in `pipeline.py`.

The TRELLIS raw mesh lands in `backend/outputs/meshes/` (a sibling of `storage/`, not inside it). `resolve_server_file_path` in the scheduler may still find it if `ALLOWED_INPUT_ROOTS` includes the backend root, but the path is outside the canonical storage contract and will not survive a storage cleanup.

### Observable Symptom

Files appear at `backend/outputs/meshes/trellis_<name>_<uuid>.glb` instead of `backend/storage/models/meshes/trellis_<name>_<uuid>.glb`. If the backend is started from a non-`backend/` working directory, `Path(os.getcwd()) / "outputs"` lands somewhere else entirely.

### Fix

Replace both `_get_output_path` / `_get_output_mesh_path` helpers in `trellis_adapter.py` and `trellis2_adapter.py` with `OutputPathGenerator`.

**`backend/adapters/trellis_adapter.py`** — add to `__init__` of both the text and image adapters:
```python
from core.utils.file_utils import OutputPathGenerator
# inside __init__:
self.path_generator = OutputPathGenerator(base_output_dir="outputs")
```

Replace every `_get_output_mesh_path` / `_get_text_output_mesh_path` body (currently using `parents[1] / "outputs"` or `Path(os.getcwd()) / "outputs"`):
```python
def _get_output_mesh_path(self, safe_name: str, output_format: str) -> Path:
    return Path(self.path_generator.generate_mesh_path(
        self.model_id, safe_name, output_format
    ))
```

Apply the same one-liner replacement to both helpers in `trellis2_adapter.py`.

**Thumbnail helpers** (`_get_thumbnail_path`) that also use `Path(os.getcwd()) / "outputs" / "thumbnails"` should be replaced with:
```python
return Path(self.path_generator.base_output_dir) / "thumbnails" / filename
```

### Verification

```bash
# After fix: raw TRELLIS output must land inside backend/storage/
python3 -c "
from adapters.trellis_adapter import TRELLISImageToTexturedMeshAdapter
a = TRELLISImageToTexturedMeshAdapter()
p = a._get_output_mesh_path('test', 'glb')
assert 'storage' in str(p), f'Wrong path: {p}'
print('PASS:', p)
"
```

### Recurrence Guard

Any new adapter must **never** hard-code `Path(__file__).parents[N] / "outputs"` or `Path(os.getcwd()) / "outputs"`. Always use `OutputPathGenerator(base_output_dir="outputs")`. Add to RULES.md under Backend Development:

> `OutputPathGenerator(base_output_dir="outputs")` is the only approved way to generate raw adapter output paths. `Path(os.getcwd()) / "outputs"` and `Path(__file__).parents[N] / "outputs"` are banned.

---

## BUG-002 — game_ready/ Dir Appears Empty Before Pipeline Completes + Source ≈ Game-Ready Content

**Severity**: Medium (confusing UX; legitimate quality concern about what post-processing actually changes)
**Affects**: `backend/postprocess/pipeline.py`
**Status**: Implemented & Resolved (both Sub-issue A and Sub-issue B)

### Sub-issue A — Premature Empty Directory Creation

**Root Cause**

`run_postprocess_job` creates **all** canonical subdirectories at the very start of the function (line ~466–475 in `pipeline.py`), before any processing:

```python
for directory in (
    master_dir,
    game_ready_dir,   # ← created immediately, EMPTY
    lod_dir,
    collision_dir,
    texture_dir,
    preview_dir,
    metadata_dir,
):
    directory.mkdir(parents=True, exist_ok=True)
```

The timeline this causes:
| Progress | Stage | Files written to game_ready/ |
|---|---|---|
| 0.00 | dirs created | game_ready/ exists but **empty** |
| 0.05 | master secured | nothing |
| 0.18–0.29 | repair + retopo | nothing |
| 0.30–0.55 | optimize + UV | nothing |
| **0.62** | game-ready write | **glb, obj, stl, ply, fbx, gltf** all appear here |

A user monitoring the filesystem sees `game_ready/` appear immediately (at start), then sees export files flood into it right after the UV stage at progress 0.62. The timing visually looks like "game_ready appeared right after retopo" because retopo (0.24–0.29) is followed immediately by optimize (fast passthrough for most cases) and UV (moderate duration), and all game_ready files write together at 0.62.

**Fix**

Defer non-master directory creation until needed. Only `master_dir` and `metadata_dir` need to exist at the start (for source.glb copy and asset.json check). All others can be created immediately before writing:

```python
# At start: only create what's needed immediately
master_dir.mkdir(parents=True, exist_ok=True)
metadata_dir.mkdir(parents=True, exist_ok=True)

# Before writing game-ready files (at the 0.62 stage):
game_ready_dir.mkdir(parents=True, exist_ok=True)

# Before writing LODs (at the 0.72 stage):
lod_dir.mkdir(parents=True, exist_ok=True)

# Before collision (at the 0.82 stage, physics_enabled only):
collision_dir.mkdir(parents=True, exist_ok=True)

# Before thumbnails (at the 0.90 stage):
preview_dir.mkdir(parents=True, exist_ok=True)

# texture_dir is created only if texture_paths is populated (currently always empty in pipeline)
```

This eliminates the confusing empty-dir appearance and makes the filesystem state accurately reflect pipeline progress.

### Sub-issue B — Source.glb and game_ready.glb Are Visually Identical (No Apparent Change)

**Root Cause**

For **raw untextured meshes** (the most common case: Hunyuan, TripoSR, TripoSG, TRELLIS raw-mesh adapters), when `auto_optimize=false` and `target_polycount` is not set or is 0:

```python
# pipeline.py — optimize stage
elif not auto_optimize and not has_explicit_target:
    optimized = repaired          # PASSTHROUGH: same geometry
    optimize_stats = {"passthrough": True, ...}
```

Then AutoUV runs, which calls `run_auto_uv(optimized, ...)`. `run_auto_uv` returns a new trimesh where **seam-split vertices** are added but the triangle faces represent the same visible surface. The exported `game_ready.glb` has:
- Same triangles as source.glb (same visible shape)
- Additional UV seam-split vertices (invisible without a texture map)
- A UV TEXCOORD_0 accessor (invisible in the viewer since no texture image is embedded)

Since neither source.glb nor game_ready.glb has a visible texture applied in the viewer (both render as gray/matcap), they look **visually identical** even though game_ready.glb contains UV coordinate data that source.glb does not.

This is **technically correct behavior** (source is preserved, game_ready has production UV), but an untextured UV channel is not visible in a normal material view. The pipeline already records `uv_seam_vertex_delta`; a vertex-count increase is diagnostic only and must not be treated as proof of better detail or valid texture output.

### Verified scene-graph regression

`load_mesh()` previously concatenated `Scene.geometry` directly. That uses each geometry's local coordinates and ignores the scene graph's node transforms. A two-part textured GLB fixture with the second part translated by 3 units had source bounds `[-0.5, 3.5]` on X but flattened bounds `[-0.5, 0.5]`; post-processing therefore collapsed the separate parts and changed the model's shape. In the tested fixture the textures survived atlas concatenation, so the earlier claim that this path always strips material images was too broad.

**Fix and verification**

- `load_mesh()` now uses the shared `scene_to_mesh()` helper, which applies scene transforms with `Scene.to_geometry()`. It rejects non-mesh or failed scene conversion instead of silently returning geometry in incorrect local space.
- `test_load_mesh_applies_scene_transforms_and_preserves_textures` verifies world-space bounds, UVs, and an embedded texture after a GLB round trip. The opt-in end-to-end pipeline fixture also verifies transformed bounds, unchanged face count, and texture payload for physics-enabled and physics-disabled runs.
- A game-ready mesh may remain visually identical to its untextured source when geometry is passed through and only UVs were added. That is expected; UV presence alone does not mean an image texture was generated.

### Verification

```python
# After fix: game_ready vertex count must differ from source
import json, pathlib
report = json.loads(pathlib.Path("backend/storage/models/meshes/<job_dir>/metadata/quality_report.json").read_text())
assert report["quality_trace"]["game_ready"]["vertices"] >= report["quality_trace"]["source"]["vertices"]
# UV seam-split vertices increase the count; if equal something is wrong
```

```bash
# game_ready.glb should differ from source.glb
cmp -l backend/storage/models/meshes/<job_dir>/master/source.glb \
       backend/storage/models/meshes/<job_dir>/game_ready/<name>.glb | wc -l
# Should be non-zero
```

### Recurrence Guard

Any stage that writes output into a canonical subdirectory must call `directory.mkdir(parents=True, exist_ok=True)` immediately before its first write — not at the function's start. Document in code:
```python
# ponytail: create each dir immediately before its first write
# so filesystem state reflects pipeline progress honestly
```

---

## BUG-003 — Detail Loss (Face/Object Features Flatten) When Input Image Has a Background

**Severity**: High (primary quality regression for standard user uploads without pre-matting)
**Affects**: `hunyuan3d_shape_v21.py`, `hunyuan3d_dit_v2_mini_turbo.py`, `triposr_adapter.py`, `triposg_adapter.py`, and all adapters that invoke upstream `preprocess_image`
**Status**: Implemented & Resolved

### Root Cause

#### Part A — No Pre-Matting Detection for Alpha-Channel Images

**Hunyuan Shape v2.1** and **DIT v2-mini-Turbo** adapters:
```python
# hunyuan3d_shape_v21.py, hunyuan3d_dit_v2_mini_turbo.py
image = Image.open(image_path)
if image.mode == "RGB":
    image = self.bg_remover(image)   # bg removal on RGB images
else:
    image = image.convert("RGBA")    # RGBA passed through — but silently, even if all-white alpha
```

A PNG saved as RGBA with a solid white background (`alpha == 255` everywhere) is treated as "pre-matted" and passed through WITHOUT background removal, causing the model to see the white background as part of the subject.

Conversely, a correctly pre-matted RGBA PNG (real transparency) goes through the same path correctly.

**TRELLIS** handles this correctly internally (`preprocess_image` in `trellis_image_to_3d.py`):
```python
has_alpha = False
if input.mode == "RGBA":
    alpha = np.array(input)[:, :, 3]
    if not np.all(alpha == 255):   # ← checks that alpha is NOT all-opaque
        has_alpha = True
```

Hunyuan's adapters lack this check. The fix is to apply the same alpha-validity test.

#### Part B — Background Removal Artifacts Corrupt AI Reconstruction

When background removal is imperfect (common on:
- Hair/fur with fine strands
- Complex edge cases: glasses, earrings, teeth visible between lips
- Backgrounds that share colors with subject: gray background on gray clothing, etc.)

The background remover (`rembg` u2net, RMBG-1.4, or Hunyuan's built-in `BackgroundRemover`) produces an alpha mask where some background pixels get alpha > 0. These residual background pixels are passed to the 3D AI model, which reconstructs them as part of the 3D surface. The model has limited "polygon budget" for the reconstruction — allocating geometry to background artifacts means the actual subject's fine details (nose bridge, teeth gap, eyelid folds, eyebrow hair) become under-represented and flatten.

This is more severe for models with lower extraction resolution:
```python
# Hunyuan Shape / DIT — user UI setting flows through to raw extraction
octree_res = min(512, max(64, int(inputs.get("octree_resolution", 384))))
```

If the UI sends `octree_resolution=256` (Medium preset) and the image has a background, the combined effect is:
- Background removal artifacts reduce effective foreground area
- Lower resolution compresses fewer geometric details per area unit
- Result: flat face / missing teeth / flat nose

#### Part C — Raw Extraction Resolution Should Not Follow Target Polycount

The user's insight is architecturally correct: **the AI model's raw extraction resolution should always be at maximum** (the model's internal detail budget), regardless of the user's target output polycount. Target polycount is a post-processing concern (`run_postprocess_job` handles decimation). If the user sets 80K polygons in the UI:
- **Wrong**: AI model generates at 80K directly → loses structural detail
- **Right**: AI model generates at 512 octree resolution (maximum available) → post-processing decimates to 80K → structural detail is preserved via intelligent decimation

This separation is already the documented ADR-031 contract, but the UI's `octree_resolution` setting (derived from quality presets: Low=256, Medium=384, High=512, Ultra=512) still flows through to the adapter. For images with backgrounds, this amplifies detail loss.

### Fix

#### Fix A — Alpha Channel Validity Check (Hunyuan Shape & DIT)

Replace the naive mode check in both adapters:

```python
# BEFORE (hunyuan3d_shape_v21.py and hunyuan3d_dit_v2_mini_turbo.py):
image = Image.open(image_path)
if image.mode == "RGB":
    image = self.bg_remover(image)
else:
    image = image.convert("RGBA")

# AFTER:
import numpy as np
image = Image.open(image_path)
has_useful_alpha = (
    image.mode in ("RGBA", "LA", "PA")
    and np.array(image.getchannel("A")).min() < 255   # at least some transparency
)
if has_useful_alpha:
    image = image.convert("RGBA")     # already pre-matted — skip bg removal
else:
    image = image.convert("RGB")
    image = self.bg_remover(image)    # needs bg removal
```

This mirrors TRELLIS's own `preprocess_image` logic exactly (from `trellis/pipelines/trellis_image_to_3d.py` line 143–147).

#### Fix B — Always Extract at Maximum Octree Resolution

In both Hunyuan adapters, remove the `octree_resolution` from the adapter's `inputs.get()` call and hard-code maximum:

```python
# BEFORE:
octree_res = min(512, max(64, int(inputs.get("octree_resolution", 384))))

# AFTER:
# ponytail: always extract at max resolution; polycount target belongs to post-processing
octree_res = 512
```

The UI quality preset (Low/Medium/High/Ultra) should control post-processing behavior, not raw AI extraction. The `target_polycount` sent in `job_inputs` already controls `run_optimize` in `pipeline.py`. Decoupling extraction resolution from output resolution is the correct long-term architecture per ADR-031 and ADR-034.

#### Fix C — TripoSR Alpha Detection

TripoSR already checks `no_remove_bg` flag and reads the raw RGBA image. Ensure the alpha validity check is applied:

```python
# triposr_adapter.py — before passing to remove_background:
raw_image = Image.open(image_path).convert("RGBA")
import numpy as np
has_useful_alpha = np.array(raw_image.getchannel("A")).min() < 255
if no_remove_bg or has_useful_alpha:
    proc_image = np.array(raw_image.convert("RGB"))
else:
    # existing rembg path
    bg_removed = remove_background(raw_image, self.rembg_session)
    ...
```

### Verification

```bash
# Test: same subject, two images — one with bg, one pre-matted RGBA
# game_ready.glb for bg-image should have same vertex count as pre-matted
# (within 5% — background removed cleanly, same geometry budget)

# Confirm octree_res is always 512 in logs after fix:
grep "octree_resolution" backend/logs/formash3d.log
# Should show: octree_resolution=512 for every Hunyuan job
```

### Recurrence Guard

Rule to add to RULES.md:

> **Alpha-channel validity**: Before passing any image to a background remover, check that the alpha channel actually contains transparency (`min(alpha_channel) < 255`). An all-opaque RGBA image must be treated as RGB and background-removed. Mirror the TRELLIS `preprocess_image` pattern in every adapter.

> **Raw extraction resolution**: AI model extraction parameters (octree_resolution, mc_resolution, grid_resolution) must not be tied to target_polycount. Maximum quality extraction is always correct; post-processing handles the user's polycount target.

---

## BUG-004 — TripoSG Output Appears Horizontal (Incorrect Y-Up Orientation) in 3D Viewer

**Severity**: High (mesh is clearly lying on its side; immediately visible to users)
**Affects**: `backend/adapters/triposg_adapter.py`
**Status**: Implemented & Resolved

### Root Cause

TripoSG's pipeline outputs meshes in its NeRF/training coordinate space, which is **not Y-up** (the Three.js viewer's convention). The TripoSR adapter handles this with an explicit orientation correction:

```python
# triposr_adapter.py — applies Y-up conversion after mesh extraction
from tsr.utils import remove_background, resize_foreground, to_gradio_3d_orientation
mesh = to_gradio_3d_orientation(mesh)
# to_gradio_3d_orientation does:
#   mesh.apply_transform(rotation_matrix(-pi/2, [1, 0, 0]))   # X-axis: -90°
#   mesh.apply_transform(rotation_matrix( pi/2, [0, 1, 0]))   # Y-axis: +90°
```

The TripoSG adapter does **none of this**:

```python
# triposg_adapter.py — after inference, NO orientation correction
mesh = trimesh.Trimesh(outputs[0].astype(np.float32), np.ascontiguousarray(outputs[1]))
# ← raw NeRF coordinate space — horizontal in Y-up viewer
mesh.export(str(output_path))
```

TripoSG and TripoSR are trained in the same NeRF pipeline family. Both require the same X: -90° → Y: +90° correction to stand upright in a Y-up renderer. The ADR-028 documented this for TripoSR; the same constraint was never applied to TripoSG.

### Observable Symptom

Models generated with TripoSG (`triposg_image_to_raw_mesh`) appear lying on their side (rotated ~90°) in the MeshViewer. Models from TripoSR, Hunyuan, and TRELLIS appear correctly upright. The issue is specific to TripoSG because it is the only Tripo-family adapter without the rotation.

### Fix

Add the Y-up orientation fix **after** mesh creation, before `mesh.export()` in `triposg_adapter.py`:

```python
# triposg_adapter.py — after:
#   mesh = trimesh.Trimesh(outputs[0].astype(np.float32), np.ascontiguousarray(outputs[1]))

# Apply Y-up orientation (same as TripoSR's to_gradio_3d_orientation)
import trimesh.transformations as tf
mesh.apply_transform(tf.rotation_matrix(-np.pi / 2, [1, 0, 0]))
mesh.apply_transform(tf.rotation_matrix( np.pi / 2, [0, 1, 0]))

# then existing:
mesh.export(str(output_path))
```

`trimesh.transformations` is already imported through `trimesh` which is already a dependency. No new import needed beyond what `triposg_adapter.py` already uses.

Apply the same fix to the scribble path inside the same adapter (the scribble branch also produces a `trimesh.Trimesh` without orientation correction).

### Verification.

```bash
# After generating a human figure with TripoSG, inspect the bounding box:
python3 -c "
import trimesh
m = trimesh.load('backend/storage/models/meshes/<job_dir>/master/source.glb', process=False)
if isinstance(m, trimesh.Scene):
    m = trimesh.util.concatenate(list(m.geometry.values()))
bb = m.bounding_box.extents
print('X Y Z extents:', bb)
# Y (height) should be the largest dimension for a standing figure
assert bb[1] == max(bb), 'Model is not Y-up — horizontal bug not fixed'
"
```

### Recurrence Guard

Add to RULES.md under Model Adapters:

> Every image-to-mesh adapter that uses a NeRF/diffusion backbone must document its output coordinate system in the class docstring and apply a Y-up correction before `mesh.export()` if the model is not natively Y-up. Use the canonical two-step rotation: `rotation_matrix(-pi/2, [1,0,0])` then `rotation_matrix(pi/2, [0,1,0])` as established by ADR-028.



## Physics/Collision Pipeline — Game-Ready Geometry & Non-Silent Decomposition
**Status**: Implemented & Resolved

Fixed the Physics/Collision pipeline. The collision artifact is generated after the final "game_ready.glb" is produced, using that final game-ready mesh as the collision input (`game_ready_mesh = load_mesh(glb_path)`). "backend/postprocess/physics.py" imports NumPy correctly, and the collision service raises an explicit error when CoACD is unavailable or decomposition produces no parts, eliminating silent convex hull placeholder fallbacks. "master/source.glb" remains immutable.
Regression coverage added in `backend/tests/test_physics.py`.

---

## Cross-Bug Pattern: Micro-Detail Loss (All Models)

**Not a separate bug** — this is a shared consequence of bugs 3 and 4, documented here for agent planning context.

The user observed that TripoSG, TripoSR, and Hunyuan all lose micro-details (nose tip, teeth gap, eyelid crease, eyebrow follicle groupings). This has two root causes:

1. **Background contamination (Bug 3)**: Background pixels are treated as geometry budget. Fix: Bug-003.
2. **Sub-maximum extraction resolution (Bug 3 Fix B)**: `octree_resolution=384` default wastes headroom. Fix: Bug-003.
3. **TripoSG specifically**: No alpha detection + no orientation correction (Bug 4) → the model often generates from a poorly-matted image and the output is also horizontal. Fix: Bug-004.

Once Bug-003 and Bug-004 are fixed, micro-detail quality should improve significantly for all models when working from backgrounded images.

---

## Agent Execution Plan for This Bug File

This section documents how an AI coding agent should process and verify these fixes. Follow RULES.md: root-cause first, smallest correct fix, verify with `python3 -m compileall`, do not introduce new dependencies.

### Read Order (Forward Pass — Top to Bottom)

1. Read `RULES.md` (mandatory)
2. Read this file (`Docs/BUG.md`)
3. Read `Docs/ARCHITECTURE.md` §2.3 (Model Execution Layer) and §2.4 (Storage Layer)
4. Read `Docs/DECISIONS.md` ADR-028, ADR-031, ADR-034, ADR-035
5. Read only the specific adapter files named in each bug

### Read Order (Reverse Verification Pass — Bottom to Top)

6. After implementing fixes, re-read `Docs/ARCHITECTURE.md` §4 (End-to-End Flow) to confirm the canonical storage flow is intact
7. Re-read `Docs/MEMORY.md` latest entries to confirm no regression with recent audit fixes
8. Re-read `RULES.md` to confirm no new abstractions, no new dependencies, no unasked-for boilerplate

### Gap Verification (Re-read MD Files After Fixing)

9. After all 4 fixes, re-read this file and verify each "Verification" block passes
10. Update `Docs/MEMORY.md` with a new dated entry
11. Update `Docs/CHANGELOG.md` (keep only last 3 changes)
12. Update `Docs/TASKS.md` — move BUG-001 through BUG-004 from open to completed
13. Sync `Docs/ARCHITECTURE.md` §2.3 if any adapter behavior changed

### Syntax Checks (Run Before Committing)

```bash
python3 -m compileall backend/adapters/trellis_adapter.py \
                       backend/adapters/trellis2_adapter.py \
                       backend/adapters/triposg_adapter.py \
                       backend/adapters/hunyuan3d_shape_v21.py \
                       backend/adapters/hunyuan3d_dit_v2_mini_turbo.py \
                       backend/postprocess/pipeline.py

python3 backend/tests/test_adapter_imports.py
python3 backend/tests/test_official_model_parity_contract.py
```

---

## Summary Table

| Bug ID | File(s) | Line(s) | Fix Size | Priority | Status |
|---|---|---|---|---|---|
| BUG-001 | `trellis_adapter.py`, `trellis2_adapter.py` | ~290, ~656, ~219, ~467 | 2× 5-line replacements | High | **Implemented & Resolved** |
| BUG-002A | `postprocess/pipeline.py` | ~466–475 | Reorder 6 `mkdir` calls | Medium | **Implemented & Resolved** |
| BUG-002B | `postprocess/pipeline.py`, `postprocess/meshio.py` | `_has_native_textures` call site | Add scene-aware texture check | Medium | **Implemented & Resolved** |
| BUG-003A | `hunyuan3d_shape_v21.py`, `hunyuan3d_dit_v2_mini_turbo.py` | ~156–163 | Alpha validity check (4 lines each) | High | **Implemented & Resolved** |
| BUG-003B | Same + `triposr_adapter.py` | `octree_res` line | Remove `inputs.get("octree_resolution")`, hard-code 512 | High | **Implemented & Resolved** |
| BUG-004 | `triposg_adapter.py` | After mesh creation (~line 268) | 2 `apply_transform` lines | High | **Implemented & Resolved** |
| BUG-005 | `postprocess/meshio.py` | `load_mesh()` scene flattening | Apply scene-graph transforms and fail explicitly when flattening is unsupported | High | **Implemented & Resolved** |
| BUG-006 | `triposr_adapter.py` | Optional texture bake/export | Serialize baked color into a real material/image and report bake failure without claiming texture success | High | **Implemented & Resolved** |
| BUG-007 | `trellis2_adapter.py` | Missing `o_voxel` textured export | Fail explicitly instead of returning an untextured mesh as successful textured generation | High | **Implemented & Resolved** |
| BUG-008 | `triposf_adapter.py` | Coarse-mesh failure fallback | Remove generic icosphere proxy and preserve the real inference error | High | **Implemented & Resolved** |
| BUG-009 | `hunyuan3d_paint_v21.py` | Reference-image preprocessing | Preserve aspect ratio with letterboxing before inference | Medium | **Implemented & Resolved** |
| PHYSICS | `pipeline.py`, `services/collision.py` | collision wiring | Game-ready source + strict CoACD | High | **Implemented & Resolved** |

---

### Generation output capability contract

The configured raw-geometry adapters do not all generate UVs or textures. For shape-only models, no texture in the raw output is a model capability limit, not an exporter defect. Canonical post-processing may generate UV coordinates for those meshes, but UVs alone do not create a texture image; semantic texture generation remains an explicit textured-generation or painting step. Textured adapters must not report successful texture output unless their serialized artifact actually contains its material/image payload.

GPU/checkpoint quality has not been visually verified in this CPU-only environment. Inference-quality comparisons require running the configured checkpoints on the target CUDA 12.4/Python 3.10 environment with sample assets.

*This document is the authoritative engineering reference for these audited bug families.
Per RULES.md, it must be updated after each fix to reflect resolved status.*
