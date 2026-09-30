# ForMash3D Quality & Detail Restoration — Master Plan v2.1 (CODE + GENERATION-BOUNDARY VERIFIED)

**Status**: Executive Plan v2.1 — expanded after re-reading the latest `main` branch, `RULES.md`, the existing v2 plan, generation adapters, post-processing, and upstream model/export contracts.
**Date**: Sept 30, 2026
**Repo**: `github.com/Silentzx2/ForMash3D`
**Verified ForMash3D main commit**: `f35cf832d2cf8639a98182ba29a428b526420b06` (`debug: trace job_id flow in RedisJobQueue enqueue/get_job/dequeue`)
**Authoritative repo rules**: `RULES.md` (no `AGENTS.md` or `AGENT.md` exists on `main`)
**Supersedes**: `FORMASH3D_QUALITY_MASTER_PLAN.md` (v1 was architecture-inferred and contained fictional file paths). This document intentionally keeps the same master-plan file and extends/corrects v2 rather than creating a second plan.
**Implementation status**: Do **not** start implementation from the old Tier 0 order yet. The generation boundary must be audited first because some detail is already being lost before production post-processing.

---

## 0. EXECUTIVE DECISION — WHAT CHANGED FROM v2

The v2 plan correctly identified several real post-processing bugs. After re-checking the latest `main` branch, one additional architectural fact is now important enough to change the execution order:

> **The quality problem is not purely a post-processing problem. The first loss boundary must be measured at `source.glb`, immediately after model-native generation/extraction, before repair/optimization/UV/LOD.**

The current repository already contains a deliberate raw-geometry preservation architecture:

```text
INPUT
  ↓
MODEL INFERENCE
  ↓
MODEL-NATIVE EXTRACTION / EXPORT
  ↓
source.glb                  ← CRITICAL QUALITY CHECKPOINT
  ↓
PRODUCTION POST-PROCESSING
  ├─ inspect
  ├─ repair
  ├─ optimize / preserve
  ├─ auto UV
  ├─ texture / bake / paint (when supported)
  ├─ LOD
  └─ QA / metadata
  ↓
game_ready.glb + LODs + other artifacts
```

This distinction matters because post-processing can only preserve, reproject, simplify, or transfer information that still exists in the source mesh or another explicitly available high-detail source. It cannot reconstruct arbitrary model detail that the generator itself never represented.

Therefore the revised execution strategy is:

1. **Locate the first quality-loss boundary** with `source.glb` as the immutable checkpoint.
2. **Fix generation/export contract bugs first** where they are proven by code.
3. Then fix the already-verified post-processing bugs.
4. Only then add automatic texture/paint chaining where a legitimate texture source/model exists.
5. Do not treat a same-mesh bake as a magical PBR/detail generator.

This ordering is mandatory for the implementation agent. Otherwise a post-processing fix can make the output cleaner without recovering the details users actually care about.

---

## ⚠️ WHY v1 WAS WRONG (Correction Notice)

v1 of this plan assumed a generic "AI 3D pipeline" structure and invented file paths that sound plausible but are not real (`backend/core/mesh_optimizer.py`, `backend/core/pbr_baker.py`). The live repository has different, reusable components.

The current `main` branch was re-read through the GitHub repository integration, including:

- `RULES.md` — authoritative engineering rules and current known-state notes
- `Docs/DECISIONS.md` — including raw-geometry and model-specific extraction decisions
- `Docs/MEMORY.md` — prior quality findings and known GPU-validation gaps
- `Docs/CHANGELOG.md` — current architecture/runtime changes
- `features/workspace/store/WorkspaceContext.tsx` — actual generation request contract sent by the UI
- `backend/adapters/triposr_adapter.py`
- `backend/adapters/triposg_adapter.py`
- `backend/adapters/triposf_adapter.py`
- `backend/adapters/trellis_adapter.py`
- `backend/adapters/trellis2_adapter.py`
- `backend/adapters/fastmesh_adapter.py`
- `backend/adapters/ultrashape_adapter.py`
- `backend/adapters/partpacker_adapter.py`
- `backend/postprocess/pipeline.py`
- `backend/postprocess/services/repair.py`
- `backend/postprocess/services/simplify.py`
- `backend/postprocess/services/auto_retopo.py`
- `backend/postprocess/services/autoretopo/*`
- `backend/postprocess/services/auto_uv.py` + `backend/postprocess/services/autouv/*`
- `backend/postprocess/services/bake.py`
- `backend/postprocess/tools/bake_worker.py`
- `backend/postprocess/services/inspect.py`
- `backend/postprocess/schemas.py`
- `backend/tests/test_postprocess_e2e.py`
- `backend/api/routers/mesh_generation.py`
- `backend/api/routers/mesh_retopology.py`
- `backend/utils/trellis2_utils.py`

The current plan therefore separates **verified bugs**, **verified integration-contract problems**, and **quality ceilings that are not automatically bugs**.

---

# 1. RULES.md / ENGINEERING CONSTRAINTS

`RULES.md` is mandatory and was re-read before extending this plan.

Key constraints that govern this work:

- Root cause before workaround.
- Reuse existing implementations before adding new ones.
- No unrequested abstractions or duplicate systems.
- Deletion/simplification is preferred over new machinery.
- Fewest files possible.
- Preserve the existing architecture and APIs unless the bug requires a contract correction.
- All Python must compile.
- Shell scripts must pass `bash -n`.
- Relevant Markdown documentation must be updated after meaningful changes.
- `source.glb` is the immutable raw/master asset.
- Raw generation should preserve model-native geometry; optimization/retopology belongs downstream unless a model-specific upstream contract explicitly requires an extraction step.
- GPU validation is still required; the current development environment is not a substitute for the real NVIDIA runtime.

No new module names from v1 are to be created unless future code inspection proves an existing implementation truly cannot cover the requirement.

---

# 2. QUALITY MODEL — FIND THE FIRST LOSS, DO NOT GUESS

For every quality complaint, the implementation agent must answer:

> **At which stage did the information first disappear?**

The diagnostic chain is:

```text
A. Reference image
B. Preprocessed model input
C. Model-native latent/inference output
D. Model-native extracted mesh
E. source.glb (canonical raw artifact)
F. After repair
G. After optimization / retopo
H. After UV / material processing
I. game_ready.glb
J. LOD1 / LOD2 / LOD3
```

A complaint is classified as:

| First loss boundary | Classification | Correct response |
|---|---|---|
| B → C | Model/input problem | inspect preprocessing, inference controls, model contract |
| C → D | Model-native extraction problem | inspect voxel/SDF/octree/decoder resolution and model settings |
| D → E | Model/export integration problem | inspect adapter/export/third-party postprocess |
| E → F | Repair problem | fix topology repair policy |
| F → G | Optimization / retopo problem | fix target budgets, preservation, or retopo routing |
| G → H | UV/material/shading problem | fix UV, normals, material handling |
| H → I | Export problem | fix GLB/material serialization |
| I → J | LOD problem | preserve/rebuild texture/materials for simplified meshes |

**Hard rule:** never claim a post-processing fix recovers model-native detail until a source-vs-output comparison proves that the detail survived to `source.glb`.

---

# 3. CURRENT MAIN: GENERATION-SIDE QUALITY STATE

Several important raw-generation safeguards were already added on `main` before this plan revision. These must be preserved; do not re-introduce the old behavior while fixing quality.

## 3.1 Raw generation is already told not to decimate

`WorkspaceContext.tsx` now sends:

```ts
auto_optimize: false,
target_polycount: targetPoly,
```

for generation requests.

`Docs/DECISIONS.md` ADR-031 and `Docs/MEMORY.md` both record the reason: earlier workspace behavior caused models such as TRELLIS and TripoSG to reduce geometry before downstream tools could see the native mesh.

This is **already the intended architecture**. Do not revert it.

## 3.2 Model-specific extraction parameters are already mapped

The current UI maps quality to model-specific parameters rather than assuming all adapters understand `octree_resolution`:

```text
TripoSR    → mc_resolution
TripoSF    → resolution
PartPacker  → grid_resolution + num_faces=-1
UltraShape  → octree_res
TRELLIS.2   → decimation_target=-1 + remesh=false
```

This fixes a previous real contract problem, but it does **not** prove that every chosen value is valid for every upstream version. Each model contract still has to be checked and validated.

## 3.3 Detail-generation controls are currently suspicious / partially unconsumed

`WorkspaceContext.tsx` sends fields such as:

```text
preserve_details
detail_pass
detail_guidance
triposf_pass
mesh_enhancement_mode
```

A repository-wide search on the current `main` branch did **not** find corresponding model/service consumers for these fields beyond the request construction in the workspace store.

Therefore these are currently classified as:

> **Verified integration gap / dead parameter candidate — not yet safe to call a product bug until the complete API/request path is traced once more.**

The implementation agent must either:

- connect each field to a real existing backend behavior, or
- remove/stop sending it if it is not part of the supported contract.

Do **not** add a new “detail engine” merely to make the field appear functional.

---

# 4. 🔴 VERIFIED / HIGH-CONFIDENCE GENERATION-SIDE FINDINGS

These findings were added after the original v2 plan because they affect quality **before or during source generation**.

## GENERATION BUG A — Hunyuan extraction resolution can exceed the documented upstream contract

**ForMash3D current path:**

`WorkspaceContext.tsx` uses:

```ts
const octreeRes = currentQuality === 'ultra' ? 640 : 512;
```

and sends `octree_resolution` to Hunyuan shape adapters.

**ForMash3D adapter path:**

`hunyuan3d_shape_v21.py` and related Hunyuan adapters pass that value into the upstream generation call.

**Upstream contract check:** Tencent's Hunyuan3D-2.1 API documentation documents `octree_resolution` with a default of 256 and a documented range ending at 512. citeturn709456search1turn709456search3

Therefore `640` is **outside the documented API contract** and must not be treated as a valid Ultra extraction setting without proving that the exact bundled upstream version accepts it.

### Correct action

Do not blindly “increase resolution more.” First:

1. Confirm the exact Hunyuan version actually installed by ForMash3D.
2. Confirm its real accepted `octree_resolution` range.
3. Clamp/configure the ForMash3D quality mapping to the highest supported value.
4. Measure whether the model's actual source mesh improves before/after that change.
5. Preserve the GPU/VRAM safety reason documented in `RULES.md`.

This is a generation-contract problem, not a post-process bug.

---

## GENERATION BUG B — TRELLIS.2 uses `-1` as ForMash3D's no-decimation sentinel, but the upstream GLB exporter does not expose that sentinel contract

**ForMash3D:**

- `WorkspaceContext.tsx` sends `decimation_target = -1` and `remesh = false` for TRELLIS.2 raw generation.
- `trellis2_adapter.py` defaults `decimation_target` to `-1` when `auto_optimize` is false.
- `backend/utils/trellis2_utils.py` forwards that value directly to `o_voxel.postprocess.to_glb()`.

**Upstream TRELLIS.2:**

The official `to_glb()` implementation documents `decimation_target` as the target count for simplification, and in the `not remesh` branch it directly executes simplification calls using that target. The current public function does not show a `<= 0` “skip simplification” guard in that branch. citeturn545985view0turn378188view0

That means:

> `-1` is **not a proven upstream no-op sentinel**.

This is a high-confidence integration-contract defect. It may cause an error, an invalid target, or other unintended behavior depending on the installed `cumesh` implementation. It must not be assumed safe merely because the ForMash3D UI uses it as “no optimization.”

### Correct action

Trace the exact installed `cumesh` behavior and use one of the following minimal fixes:

- pass a verified non-destructive target (normally the current face/vertex count), or
- add a tiny explicit pass-through guard at the ForMash3D integration boundary if the upstream exporter cannot represent “no decimation” natively.

Do not invent a new mesh optimizer.

### Quality implication

This item is especially important to the user's observation because TRELLIS.2 export happens **before** the canonical `source.glb` checkpoint. A bad exporter contract can make the model look low-detail even when the latent model itself produced more geometry.

---

## GENERATION FINDING C — Model-native extraction itself has a hard quality ceiling

The current system cannot promise that post-processing will recreate details that are lost during model-native extraction.

Examples verified from current adapters / upstream contracts:

- TripoSR exposes `mc_resolution`; upstream CLI documentation describes this as the marching-cubes grid resolution, default 256. citeturn709456search5
- Hunyuan3D exposes `octree_resolution`; Tencent documents it as the mesh-resolution control. citeturn709456search1turn709456search3
- TripoSF reconstructs from a voxel/sparse representation at a configured volume resolution and point-sampling budget in the ForMash3D adapter.
- TripoSG's geometry path uses hierarchical extraction; the current ForMash3D standard path does not expose the upstream hierarchical geometry extraction depth as a user-controlled quality parameter. The upstream project documents `dense_octree_depth` and `hierarchical_octree_depth` in its geometry extraction utilities. citeturn709456search8

This is **not automatically a bug**. It is a model capability/parameter boundary.

### Correct action

For each supported model, record:

```text
model-native reconstruction control
model-native extraction control
maximum safe value in installed version
VRAM cost
known low-VRAM quality compromise
```

Then verify whether ForMash3D's High/Ultra presets actually select the best supported values within the configured hardware budget.

---

## GENERATION FINDING D — TripoSF intentionally trades quality for VRAM below 16 GB

`triposf_adapter.py` contains an explicit low-VRAM branch:

- GPUs below 16 GB force `pruning=True`.
- `sample_points_num` is capped to 655,360.

`Docs/MEMORY.md` already records this as a deliberate quality/memory trade-off rather than accidental decimation.

### Correct action

Do **not** remove this blindly.

Instead:

1. surface it honestly as a quality limitation,
2. ensure High/Ultra do not imply “maximum fidelity” when this constraint is active,
3. compare source quality on >=16 GB vs <16 GB hardware,
4. consider model selection/routing rather than silently degrading the same model.

---

## GENERATION FINDING E — Existing “detail preservation” UI settings are not enough evidence of real detail preservation

The frontend currently sends several detail-related settings, but code search did not find corresponding backend consumers for the named detail passes.

Therefore the quality plan must not use a request field as proof that detail enhancement is happening.

### Correct action

A setting counts as implemented only when the agent can trace:

```text
UI state
 → API payload
 → router/schema
 → scheduler job input
 → adapter/service
 → actual algorithm parameter
 → measurable output change
```

If any link is missing, mark the feature as **unconsumed** and do not build a parallel implementation without first checking existing model capabilities.

---

# 5. 🔴 VERIFIED POST-PROCESSING ROOT CAUSES (ORIGINAL v2, STILL VALID)

## BUG 1 (CRITICAL): LOD1/LOD2/LOD3 lose their texture/materials

**File**: `backend/postprocess/services/simplify.py`, `_simplify()`

Current decimation creates a fresh `trimesh.Trimesh` from vertices/faces only:

```python
result = trimesh.Trimesh(
    vertices=np.asarray(out.vertex_matrix(), dtype=np.float64),
    faces=np.asarray(out.face_matrix(), dtype=np.int64),
    process=False,
)
```

No `.visual`, UVs, or material payload is preserved.

`run_lods()` applies `_simplify()` to the reduced levels, while LOD0 is the original mesh. Therefore LOD1/2/3 can be structurally simplified but visually untextured.

### Correct fix direction

Use an index-safe, texture-aware route. The plan must **not** accept a naive vertex-by-vertex UV copy because quadric collapse changes vertex correspondence.

Preferred order:

1. inspect whether PyMeshLab's texture-aware decimator can preserve the needed material/UV information;
2. if not, decimate and regenerate/reproject UV/materials using the existing UV/texture tooling;
3. keep LOD0 untouched;
4. assert material/texture presence on textured LOD outputs.

---

## BUG 2 (REVISED): `bake.py` is disconnected, but it is NOT a generic texture generator

The original v2 wording overstated this bug by treating `run_bake()` as if it could automatically synthesize PBR textures for an otherwise untextured raw mesh.

Current code inspection of `backend/postprocess/services/bake.py` and `backend/postprocess/tools/bake_worker.py` shows the real contract:

- `run_bake(low_glb, high_glb, ...)` is a **high-to-low detail transfer** operation.
- The low-poly mesh needs usable UVs.
- The high-poly/source mesh is the detail/material source.
- The bake can transfer normal/AO/base-color/roughness/metallic information from that source.

The worker itself describes this explicitly: baking is what makes optimization/retopology non-destructive by capturing detail from the high-poly mesh.

### Consequence

For an untextured model that contains **no textured/material high-resolution source**, simply calling `run_bake()` cannot invent a truthful PBR albedo/roughness/metallic texture.

A raw grey mesh cannot magically acquire an authored base-color texture from a bake whose source is also grey/untextured.

### Correct architecture

Separate two concepts:

**A. Detail-preserving bake**

```text
source.glb (high/detail source)
      ↓
optimize / retopo → low mesh + UVs
      ↓
run_bake(high=source, low=optimized)
      ↓
normal / AO / base-color / roughness / metallic transfer where source data exists
```

**B. Texture synthesis / painting**

```text
image/reference + generated mesh
      ↓
existing Paint/Texturing model capability
      ↓
new PBR material
```

Do not merge A and B into a fake “automatic bake” feature.

---

## BUG 3 (CRITICAL): AutoRetopo exists but is not invoked by the production path

`run_auto_retopo()` is defined in `backend/postprocess/services/auto_retopo.py` but code search on `main` finds the definition without a production caller.

The QA engine already recommends `autoretopo` when a mesh is non-watertight.

### Correct fix direction

Use the existing QA signal to trigger AutoRetopo **only when the defect warrants a structural rebuild**. Do not run it unconditionally on every asset because it rebuilds topology and can itself remove detail.

The trigger must consider:

- watertight state
- boundary count / hole size
- source/detail preservation
- asset class where possible
- whether the source mesh already contains authored UV/materials

---

## BUG 4 (DESIGN LIMIT): Repair closes only small holes

The production pipeline uses:

```python
max_hole_size=30
```

This is deliberate: closing large boundaries with a simple fan can stretch texels and produce a worse visible surface.

### Correct action

Do **not** simply increase `max_hole_size` globally.

Use a two-stage policy:

```text
small defects  → repair.py
large structural defects → AutoRetopo (with preservation-aware settings)
```

The thresholds must be shared between QA and action logic so the report does not recommend a fix that the pipeline does not take.

---

## BUG 5 (CRITICAL): Raw/untextured path requests fully smooth normal grouping

`pipeline.py` currently calls `run_auto_uv()` with:

```python
normal_smooth_deg=180
```

`schemas.py` documents 180° as fully smooth.

Although `preserve_normals=True` is also set, this 180° value is still dangerous whenever normals have to be rebuilt because the geometry is no longer carrying usable source normals.

### Correct fix direction

Do not hardcode one global angle and assume all assets are hard-surface.

Instead:

- preserve valid source normals whenever possible;
- use an edge-angle threshold only when normals are actually rebuilt;
- validate on both organic and hard-surface assets;
- prefer the smallest change that removes accidental full smoothing without creating faceting on organic meshes.

A value around 45–60° is a candidate for validation, **not a pre-approved final number**.

---

## BUG 6 (CRITICAL WHEN USED): FastMesh has a fixed 1K/4K vertex budget

`fastmesh_adapter.py` currently maps variants to:

```python
target_vertex_count = 1000 if variant == "V1K" else 4000
```

The mesh-retopology API itself can accept a caller target, but the adapter's variant defaults remain extremely low for detailed hero assets.

### Correct action

Before raising the default, confirm the actual caller flow and the manifest/runtime contract.

Prefer:

- caller-supplied target when already supported,
- model-specific quality presets,
- a higher ceiling only when the user actually requests it.

Do not remove the low-budget variants; they are useful for lightweight assets.

---

## BUG 7 (CONFIRMED): Textured assets skip optimization entirely

The production pipeline does:

```python
if native_textures:
    optimized = repaired
```

This is safe for preserving UV/material correspondence but creates a sharp policy difference:

```text
textured → raw triangle count passes through
untextured → capped at ~50k triangles
```

### Correct action

After BUG 1 is fixed, add a **texture-preserving optimization path** for textured assets.

That path must prove:

- UV/material integrity,
- texture presence,
- acceptable visual loss,
- target triangle budget.

Do not reuse the current UV-blind decimator unchanged.

---

## BUG 8 (CRITICAL WHEN AUTORETOPO IS ENABLED): AutoRetopo defaults are too smoothing-heavy

`backend/postprocess/services/autoretopo/config.py` currently contains:

```python
shell_smooth: 1.4
shell_taubin: 10
preserve_features: False
shell_resolution: 256
```

This combination can smooth or erase small/hard features before silhouette projection gets a chance to restore them.

### Correct action

Do not wire AutoRetopo into production before validating safer defaults.

The existing v2 candidate direction remains:

```text
shell_smooth   ≈ 0.5–0.6
shell_taubin   ≈ 2–3
preserve_features = True
feature_angle ≈ 25–30°
```

But these are **test candidates**, not hardcoded requirements. Validate against both hard-surface and organic assets.

---

# 6. REVISED ROOT-CAUSE → FIX MAP

| Symptom | Verified cause / boundary | Current status | Correct response |
|---|---|---|---|
| Detail already missing before postprocess | Model-native inference/extraction ceiling; must compare source.glb | **New boundary finding** | Audit generation contract first |
| Ultra generation does not necessarily mean higher valid Hunyuan extraction | ForMash3D sends 640 while upstream 2.1 API documents max 512 | **Verified contract mismatch** | Verify exact installed version and cap to supported range |
| TRELLIS.2 “no optimization” uses `-1` | ForMash3D forwards `-1` to upstream `to_glb()` simplification path | **Verified integration-risk/bug** | Replace sentinel with verified no-op/passthrough behavior |
| “detail” UI settings appear ineffective | `preserve_details`, `detail_pass`, `detail_guidance`, etc. have no identified backend consumer | **Verified gap candidate** | Trace complete contract; wire existing behavior or remove dead fields |
| “too smooth” | `normal_smooth_deg=180` | **Verified** | Preserve/recompute normals with validated angle policy |
| holes | repair only closes ≤30-edge loops | **Verified design limit** | small repair + conditional AutoRetopo |
| large holes persist | AutoRetopo is defined but not production-wired | **Verified** | Wire only behind QA trigger |
| LODs untextured | `_simplify()` drops visual/material/UV data | **Verified** | Texture-aware decimation/re-UV/reprojection |
| raw untextured mesh has no PBR maps | Production bake is skipped | **Verified** | Use Paint/texturing path when a real reference exists; otherwise report no authored texture |
| bake cannot invent texture | `run_bake()` is high→low transfer | **Verified contract** | Use source/detail bake, not fake material synthesis |
| FastMesh output too blobby | 1K/4K vertex defaults | **Verified** | Configurable budgets / preserve hero detail |
| textured assets explode triangle count | native-texture branch fully bypasses optimization | **Verified** | Add UV-safe optimization after LOD texture fix |
| AutoRetopo may remove detail | smoothing-heavy defaults | **Verified** | Change defaults before wiring |
| <16GB TripoSF loses detail | pruning + lower point cap is forced | **Verified deliberate trade-off** | Surface limitation; route to another model for max fidelity |

---

# 7. REVISED IMPLEMENTATION PLAN — LOOP ENGINEERING ORDER

The previous v2 plan started at post-processing Tier 0. That is no longer the correct first step.

## TIER -1 — GENERATION FIDELITY GATE (DO FIRST)

### -1.1 Build the loss-boundary experiment

Use the existing canonical artifact system. Do **not** create a new permanent pipeline.

For each test generation, record:

```text
input image/reference
model id + version
GPU + VRAM
all model parameters actually sent
source.glb vertex count
source.glb triangle count
watertight / boundary metrics
material/UV presence
texture dimensions/material count
bounding box
```

Then compare the same metrics after each post-processing stage.

The implementation agent must be able to answer:

```text
Did detail disappear before source.glb?
Did repair remove it?
Did optimization remove it?
Did retopo rebuild it incorrectly?
Did UV/material handling only make it LOOK missing?
Did the LOD exporter strip the representation?
```

### -1.2 Trace every generation quality parameter end-to-end

Required parameters to trace:

```text
auto_optimize
target_polycount
preserve_details
detail_pass
detail_guidance
triposf_pass
mesh_enhancement_mode
octree_resolution
mc_resolution
resolution
grid_resolution
octree_res
decimation_target
remesh
```

For each, classify:

```text
CONSUMED → actual algorithm parameter
TRANSFORMED → renamed/mapped to model-specific parameter
IGNORED → silently unused
UNSUPPORTED → not valid for this provider
DUPLICATED → two layers both optimize/alter geometry
```

Only `CONSUMED` and justified `TRANSFORMED` parameters should remain part of the “quality” story.

### -1.3 Correct Hunyuan extraction-range handling

Resolve the `640` Ultra setting against the installed Hunyuan version.

Preferred outcome:

```text
UI quality → highest actually supported upstream resolution
```

not:

```text
UI quality → arbitrary larger number
```

### -1.4 Fix TRELLIS.2 no-decimation contract

Do not pass `-1` into an upstream simplification API unless the exact installed implementation proves it is a no-op.

Preferred minimal approach:

```text
if no decimation requested:
    use a verified no-op target / skip simplification
else:
    use requested decimation target
```

Because `to_glb()` also performs UV/material extraction, preserve the existing export path; only correct the target semantics.

### -1.5 Validate model-native source detail

Test at least:

- hard-surface asset with sharp edges
- thin-feature asset: straps/antenna/fingers/ears
- organic asset with fine surface detail
- textured model

For each, compare model-native `source.glb` against the model's own upstream output/expected extraction path where practical.

### -1.6 Stop condition for Tier -1

Do **not** move into post-processing fixes until:

- the first quality-loss boundary is known for each test case,
- unsupported/silent quality parameters are identified,
- Hunyuan extraction values are contract-safe,
- TRELLIS.2 no-decimation behavior is correct,
- and `source.glb` is confirmed to retain the maximum detail the chosen model/version can actually output under the hardware budget.

---

# 8. TIER 0 — POST-PROCESSING EMERGENCY FIXES

Once Tier -1 is stable:

## 0.1 Fix LOD texture/material loss

File:

```text
backend/postprocess/services/simplify.py
```

Requirement:

- preserve/reconstruct material + UV data for textured LODs;
- never do a naive 1:1 UV copy after topology-changing decimation;
- add a small executable check.

## 0.2 Fix full-smooth normal recomputation

File:

```text
backend/postprocess/pipeline.py
backend/postprocess/schemas.py
```

Requirement:

- source normals preserved when valid;
- validated hard-edge policy when rebuilding;
- no universal “180° = smooth everything” default for raw meshes.

## 0.3 Fix AutoRetopo defaults before production wiring

File:

```text
backend/postprocess/services/autoretopo/config.py
backend/postprocess/schemas.py
```

Requirement:

- reduce smoothing/taubin defaults;
- enable feature preservation where the asset class needs it;
- validate before production use.

## 0.4 Wire AutoRetopo as a conditional repair path

File:

```text
backend/postprocess/pipeline.py
```

Requirement:

- use existing QA;
- only rebuild when ordinary repair cannot safely close the defect;
- preserve source/master;
- record whether the structural rebuild actually happened.

---

# 9. TIER 1 — TEXTURE / DETAIL PRESERVATION CORRECTION

This tier is **changed materially from v2**.

## 1.1 Separate “bake” from “texture generation”

### A. Bake path

Use:

```text
source.glb (high/detail)
→ optimize or retopo
→ auto UV
→ bake source → lower mesh
```

This is the existing `bake.py` contract.

### B. Texture generation path

For a raw untextured mesh, use an existing image-conditioned texturing/Paint capability if available, such as the already-supported Shape→Paint workflow.

Do not call `run_bake()` and claim that this has created authored PBR texture information when the high-poly source contains none.

## 1.2 Reuse the existing Shape→Paint capability

`RULES.md` explicitly says the Paint-v2-1 pipeline supports Shape→Paint automatic chaining.

Therefore the implementation agent must first inspect the already-existing chaining path and reuse it rather than creating a second paint orchestrator.

The chain should only run when:

- a valid reference image is available,
- the selected model/capability supports painting,
- VRAM/resource requirements are satisfiable,
- the asset is not already correctly textured,
- and the job contract can represent the chained stage.

## 1.3 Honest fallback for untextured output

If no legitimate texturing source/model is available:

- keep the geometry;
- generate only the maps that are scientifically/algorithmically defensible from the available source (for example geometry-derived AO/normal data where the existing implementation supports it);
- do **not** fabricate semantic base-color/roughness/metallic content;
- expose `texture_status = unavailable/not_generated` rather than silently shipping a fake “PBR asset.”

## 1.4 Preserve high-poly detail when simplifying textured assets

Once source-vs-output quality is verified:

```text
source.glb
   ↓
controlled decimation / retopo
   ↓
UV
   ↓
high → low bake
```

The high-poly source is the detail authority.

---

# 10. TIER 2 — CREASE / DETAIL PRESERVATION DURING RETOPOLOGY

## 2.1 FastMesh target budget must be explicit

File:

```text
backend/adapters/fastmesh_adapter.py
```

Use the already-exposed caller target where possible. Do not hardwire a “hero” target until the actual request flow and model manifest are verified.

## 2.2 Retopo should never silently become the default detail destroyer

Before running any topology-changing stage, compare:

```text
source vertex/face count
source feature metrics
retopo vertex/face count
retopo feature metrics
```

A retopo pass that succeeds technically but destroys the requested asset class's visual features is not a successful quality pass.

## 2.3 AutoRetopo feature preservation

Validate:

- `preserve_features=True`
- `feature_angle`
- `shell_resolution`
- `project=True`
- lower smoothing/taubin iterations

against at least one hard-surface and one organic asset.

---

# 11. TIER 3 — TEXTURED-PATH TRIANGLE CONTROL

The existing all-or-nothing branch must become:

```text
native texture detected
    ↓
UV-safe optimization if target requires it
    ↓
verify material/UV integrity
    ↓
optional bake from source.glb
```

The optimized textured path must never trade away the material merely to hit a triangle budget.

`LOD0` and `LOD1+` must each have explicit material/UV checks.

---

# 12. TIER 4 — QA / REGRESSION GATES

## 4.1 Promote actionable topology state

If QA says:

```text
watertight = false
fix = autoretopo
```

the pipeline must either:

- actually execute the authorized repair path, or
- record why it intentionally did not.

No dead-end recommendations.

## 4.2 Add LOD material-presence verification

Every exported LOD must report:

```text
material count
UV present
texture/material references present
texture size(s)
```

## 4.3 Add source-vs-final quality accounting

Every production postprocess job should be able to answer:

```text
source triangles
final triangles
LOD triangles
repair changes
retopo changes
texture state
```

This is critical for distinguishing “AI generated poor detail” from “our pipeline deleted detail.”

## 4.4 Preserve the immutable master

`source.glb` remains byte-for-byte unchanged.

No repair, decimation, UV, retopo, bake, or export operation may overwrite it.

---

# 13. LOOP-ENGINEERED EXECUTION METHOD

Every implementation item follows the same loop:

### LOOP 1 — READ

Read the exact files named by the item and all direct callers/callees.

### LOOP 2 — REPRODUCE

Run the smallest fixture or runtime check that demonstrates the issue.

### LOOP 3 — LOCATE FIRST LOSS

Measure the earliest stage where the expected detail/material/topology disappeared.

### LOOP 4 — PATCH THE SHARED ROOT CAUSE

Follow `RULES.md`:

- reuse existing helper;
- smallest correct diff;
- no duplicate mechanism;
- no workaround at every caller when one shared fix works.

### LOOP 5 — VERIFY

Run the smallest deterministic check that exercises the changed behavior.

For non-trivial logic this must include a runnable assertion/test.

### LOOP 6 — DOCUMENT

Update the relevant Markdown files immediately:

- `Docs/MEMORY.md`
- `Docs/DECISIONS.md` when architecture/contract changes
- `Docs/CHANGELOG.md`
- relevant `Docs/*` design/API documentation
- `README.md` only when user-facing behavior changes

### LOOP 7 — RE-CHECK NEIGHBOR PATHS

Before moving on, search every caller of the changed function and make sure the fix did not create a sibling regression.

### LOOP 8 — STOP OR PROCEED

Proceed only when the success criteria for that tier are met.

Do not stack five speculative fixes and then guess which one worked.

---

# 14. TEST MATRIX

The minimum validation matrix is:

| Asset class | Purpose | Required models / paths |
|---|---|---|
| Hard surface | crease/shading/detail preservation | TripoSR / TripoSG / Hunyuan shape / FastMesh path |
| Thin geometry | hole/reconstruction quality | Hunyuan / TripoSG / TRELLIS-family |
| Organic detail | smoothing vs. feature preservation | Hunyuan / TRELLIS / TripoSF |
| Native textured | material/LOD preservation | Hunyuan3D-Paint / TRELLIS / TRELLIS.2 |
| Raw untextured | texture-state correctness | TripoSR / TripoSG / TripoSF / PartPacker / UltraShape |
| Hero retopo | target-budget correctness | FastMesh / AutoRetopo |

Minimum artifacts to inspect:

```text
source.glb
game_ready.glb
lod1.glb
lod2.glb
lod3.glb
qa report
postprocess stats
```

---

# 15. REQUIRED QUALITY METRICS

For every quality fixture record:

### Geometry

- vertices
- triangles
- connected components
- boundary edges / holes
- watertight state
- non-manifold state
- bounding box
- source → final triangle ratio

### Appearance

- material count
- UV presence
- texture presence
- texture resolution
- normal map presence
- AO/ORM state where applicable

### Detail preservation

At minimum compare:

- source vs optimized vertex/triangle density,
- source vs optimized silhouette,
- hard-edge presence,
- thin-part survival,
- large-hole count,
- texture/material retention.

Do not reduce “quality” to triangle count alone.

---

# 16. MODEL-SPECIFIC QUALITY NOTES

## TripoSR

Upstream exposes `mc-resolution` as the marching-cubes grid resolution; its documented default is 256. citeturn709456search5

ForMash3D already maps High/Ultra quality to `mc_resolution` values. The remaining question is whether the selected value provides meaningful quality gain for the installed model/runtime and hardware.

Do not assume a higher marching-cubes grid repairs missing neural geometry. It only gives the extractor more spatial resolution over what the reconstruction provides.

## TripoSG

The current adapter preserves raw geometry when `auto_optimize=false`. That is correct.

Its upstream geometry extraction utilities expose dense and hierarchical octree depths; the current standard adapter path does not expose those controls as a ForMash3D quality contract. citeturn709456search8

Audit before adding any new parameter. Prefer the upstream pipeline's existing defaults/controls over inventing new heuristics.

## TripoSF

Current ForMash3D quality is influenced by:

- `resolution`
- `sample_points_num`
- `pruning`
- GPU-dependent low-VRAM overrides

The low-VRAM branch is intentionally conservative and must remain a documented trade-off unless a different model-routing strategy replaces it.

## Hunyuan3D

`octree_resolution` is a real extraction control. The official 2.1 API documents a 64–512 range, with 256 as the default. citeturn709456search1turn709456search3

Therefore ForMash3D must not treat 640 as a valid quality setting unless the exact installed upstream version proves otherwise.

## TRELLIS.2

Upstream `to_glb()` performs mesh cleaning and simplification, and the official project examples intentionally set an explicit decimation target and remesh flag. citeturn709456search0turn709456search2turn709456search6

ForMash3D's raw path therefore must have a **verified no-decimation contract**, not merely a `-1` sentinel passed through an API that expects a real target.

## TRELLIS / other textured providers

Native texture ownership must be preserved. Any topology-changing stage after a textured provider must either be UV/material aware or re-create the material using an existing valid source path.

---

# 17. DO NOT MAKE THESE ARCHITECTURAL MISTAKES

Do **not**:

- create `mesh_optimizer.py`
- create `pbr_baker.py`
- create `mesh_healer.py`
- create `displacement_extractor.py`
- create `crease_detector.py`
- create `detail_pipeline.py`
- create a second texture orchestration system
- replace the model adapters with a generic fake “quality engine”
- use a same-mesh bake as proof that PBR textures have been authored
- increase every resolution number without checking upstream contracts and GPU cost
- automatically retopologize every mesh just because a tool exists
- claim “detail preserved” because triangle count is high
- treat frontend request fields as implemented backend features without tracing the consumer

The correct strategy remains:

> **integrate existing code, correct contracts, and remove destructive behavior before adding anything new.**

---

# 18. REVISED EXECUTION ORDER FOR THE AI AGENT

## Phase 0 — Source-of-truth recheck

Read in this order:

1. `RULES.md`
2. `Docs/DECISIONS.md`
3. `Docs/MEMORY.md`
4. `Docs/CHANGELOG.md`
5. `features/workspace/store/WorkspaceContext.tsx`
6. relevant model adapter (`TripoSR`, `TripoSG`, `TripoSF`, `Hunyuan`, `TRELLIS`, `TRELLIS.2`)
7. `backend/postprocess/pipeline.py`
8. `backend/postprocess/services/simplify.py`
9. `backend/postprocess/services/repair.py`
10. `backend/postprocess/services/auto_retopo.py` + `autoretopo/*`
11. `backend/postprocess/services/auto_uv.py` + `autouv/*`
12. `backend/postprocess/services/bake.py` + `backend/postprocess/tools/bake_worker.py`
13. `backend/postprocess/services/inspect.py`
14. `backend/tests/test_postprocess_e2e.py`

## Phase 1 — Generation contract / quality gate

1. Trace all quality fields.
2. Fix Hunyuan resolution range mismatch.
3. Fix TRELLIS.2 `-1` no-decimation contract.
4. Verify model-native extraction limits.
5. Validate `source.glb` quality on the test matrix.

## Phase 2 — Post-process correctness

1. Fix LOD texture loss.
2. Fix normal smoothing policy.
3. Fix AutoRetopo defaults.
4. Wire conditional AutoRetopo.
5. Validate repair → retopo behavior.

## Phase 3 — Texture/material correctness

1. Separate bake from texture generation.
2. Reuse existing Shape→Paint chaining where applicable.
3. Add high→low bake only where a legitimate high-detail source exists.
4. Add explicit texture-status QA for raw untextured outputs.

## Phase 4 — Optimization/retopo consistency

1. UV-safe textured optimization.
2. FastMesh target control.
3. AutoRetopo feature preservation.
4. LOD generation with material retention.

## Phase 5 — Documentation + regression gate

1. Run Python compile checks.
2. Run the postprocess test suite/checks available in the repo.
3. Run targeted runtime checks in a real GPU environment.
4. Update Markdown state docs.
5. Only after the above, consider the master plan complete.

---

# 19. SUCCESS CRITERIA — REVISED

The plan is successful only when all of these are true:

### Generation fidelity

✅ For a selected model/version, the highest supported quality settings are actually passed into the model/extractor.

✅ No quality parameter is silently ignored or falsely presented as active.

✅ Hunyuan extraction values stay within the real installed upstream contract.

✅ TRELLIS.2 raw/no-optimization generation is truly non-destructive at its export boundary rather than relying on an unverified `-1` sentinel.

✅ `source.glb` retains the best detail the selected model can produce under the configured hardware budget.

### Post-processing fidelity

✅ No post-processing stage causes unexplained or accidental high-frequency detail loss.

✅ Hard-surface edges do not become universally smooth because of a global 180° normal threshold.

✅ Large holes are either repaired through an intentional structural path or explicitly surfaced; they are not silently shipped as acceptable final assets when the pipeline says a repair is available.

✅ AutoRetopo is only invoked when the QA signal justifies it, with validated preservation settings.

### Texture/material fidelity

✅ Textured LODs retain valid UV/material/texture data.

✅ Textured assets can be optimized without simply bypassing all optimization forever.

✅ `run_bake()` is used as a high→low transfer tool, not misrepresented as a texture-synthesis engine.

✅ Raw untextured assets do not silently claim to have authored PBR maps when no source/model exists to generate them.

✅ Where the existing Shape→Paint capability is available and selected, automatic chaining uses the existing contract rather than duplicating it.

### QA integrity

✅ QA metrics identify source-vs-final changes.

✅ Every `lodN.glb` reports valid material/UV state.

✅ `source.glb` remains immutable.

✅ The system can distinguish:

```text
MODEL QUALITY LIMIT
vs.
POST-PROCESSING REGRESSION
vs.
EXPORT/MATERIAL REGRESSION
```

That distinction is the main purpose of this revision.

---

# 20. DOCUMENTATION UPDATE REQUIREMENTS

Any implementation derived from this plan must update the project's existing Markdown documentation in the same change set when the behavior changes.

At minimum review:

- `Docs/MEMORY.md`
- `Docs/DECISIONS.md`
- `Docs/CHANGELOG.md`
- relevant API/model documentation
- `README.md` when user-visible behavior changes

Do not leave this plan or the repository docs describing a dead path after it becomes live.

---

# 21. RESEARCH / UPSTREAM REFERENCES USED FOR THIS REVISION

These are reference points for the model/export contracts only. The ForMash3D implementation remains the source of truth for how the platform currently integrates them.

- Hunyuan3D-2.1 API documentation — `octree_resolution`, generation steps, guidance, and documented parameter ranges:
  `https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/API_DOCUMENTATION.md`

- Hunyuan3D shape generation example:
  `https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/examples/shape_gen.py`

- TripoSR official CLI — `mc-resolution` and mesh extraction options:
  `https://github.com/VAST-AI-Research/TripoSR/blob/main/run.py`

- TripoSG official extraction utility — hierarchical/dense octree geometry extraction:
  `https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/inference_utils.py`

- TRELLIS.2 official `to_glb()` — simplification, hole cleanup, remeshing, UV unwrapping, and texture baking behavior:
  `https://github.com/microsoft/TRELLIS.2/blob/main/o-voxel/o_voxel/postprocess.py`

- TRELLIS.2 official app/export example:
  `https://github.com/microsoft/TRELLIS.2/blob/main/app.py`

---

# 22. NOTES FOR THE AI AGENT

1. This plan is derived from the actual ForMash3D `main` branch source verified on Sept 30, 2026, plus targeted upstream contract research. Re-check file/function locations before editing because `main` can move.
2. `RULES.md` is authoritative in the current repository; `AGENTS.md` and `AGENT.md` were not present on `main`.
3. The repository's current raw-geometry decisions are intentional. Do not reintroduce pre-postprocess decimation.
4. Treat the `source.glb` checkpoint as the boundary between “what the model generated” and “what ForMash3D did afterward.”
5. `bake.py` is an existing high→low detail-transfer system. It is not a general semantic texture generator.
6. Do not wire AutoRetopo before fixing/validating its smoothing defaults.
7. Do not use a new abstraction when an existing adapter/service already owns the behavior.
8. Every non-trivial change must leave one runnable validation path.
9. GPU inference, CUDA extension behavior, and real texture-generation behavior still require real runtime validation; source inspection alone is not sufficient evidence for final visual quality.
10. The implementation agent must report exact files changed, root cause, minimal diff, and validation performed.

---

# 23. FINAL PLAN STATE

**Plan state**: ✅ Expanded and re-verified; **implementation intentionally deferred until the generation-fidelity gate is executed**.

**Main conclusion**:

> The original v2 post-processing findings remain real, but they are not the complete explanation for the user's quality complaint. The first investigation target is now the model-generation → extraction → export boundary and the integrity of `source.glb`.

The practical objective is not “add more post-processing.” It is:

```text
MAXIMUM MODEL-NATIVE DETAIL
        ↓
PRESERVE IT IN source.glb
        ↓
ONLY THEN repair / optimize / retopo / UV
        ↓
TRANSFER DETAIL WHEN A REAL HIGH-POLY SOURCE EXISTS
        ↓
GENERATE PBR ONLY THROUGH A REAL TEXTURE/PAINT SOURCE
        ↓
EXPORT LODs WITHOUT LOSING MATERIALS
        ↓
QA PROVES WHERE ANY REMAINING LOSS OCCURRED
```

That is the execution architecture to use before any implementation agent is allowed to start changing code.

---

**Plan Owner**: David (ForMash3D)
**Status**: ✅ Verified against current source + targeted upstream contracts; **ready for the Phase 0 / Tier -1 audit, not blind implementation**.
**Correction of**: `FORMASH3D_QUALITY_MASTER_PLAN.md` (v1, architecture-inferred — fictional file list must not be implemented).
