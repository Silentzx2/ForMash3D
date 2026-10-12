# ForMash3D — Raw Mesh Fidelity & Micro-Detail Improvement Plan

**Audit target:** `Silentzx2/ForMash3D`, branch `Dev` (capital D)  
**Research date:** 12 October 2026  
**Scope:** Raw image-to-3D geometry quality, sharp features, micro-detail retention, model/inference limits, and an evidence-based improvement roadmap.  
**Explicitly out of scope for this task:** Implementing code, changing branch contents, committing, or pushing.

> **Bottom line:** ForMash3D already protects the generated source mesh from the normal downstream decimation pipeline. That is good, but it cannot make an under-detailed model output suddenly detailed. The highest-value work is (1) prove the true model-native output and effective extraction resolution with telemetry, (2) benchmark the current top local models against identical inputs, (3) add a strong independent geometry-model contender such as Step1X-3D, and (4) offer multi-view guidance and optional detail refinement. Polycount, subdivision, and a smoother UI are not substitutes for geometry detail that the generator never produced.

---

## 1. Executive recommendation

### Recommended order

1. **Start with TRELLIS.2 as the current local high-quality candidate.** The `Dev` branch already selects its `1536_cascade` route, high sampler steps, a 262,144 token budget, no remesh, and native raw-mesh export. Do not assume that the requested cascade always ends at effective 1536 resolution: instrument the pipeline's *returned effective resolution* and benchmark the resulting mesh first.
2. **Run controlled raw-only comparisons with TripoSG, Hunyuan3D-Shape-v2.1, TRELLIS, and Unique3D.** Hunyuan's configured 512 octree is its current upstream extraction ceiling; Mini-Turbo is a fast/small model, not the high-detail default. TripoSG uses its official Flash VAE decoder on supported GPUs; do not switch to a denser alternate decoder blindly because it can impose substantial memory/runtime costs.
3. **Integrate Step1X-3D as a separate experimental adapter.** Its public geometry pipeline exposes a `sharp` edge-control label and parameters such as `octree_resolution`, `max_facenum`, `do_reduce_face`, and `do_shade_smooth`. Export untouched base geometry first; apply texture, smoothing, and face reduction only to derived copies. Apache-2.0 is the project's stated code license, but audit the exact checkpoint/data licenses too.
4. **Add an optional multi-view workflow.** One image fundamentally under-constrains hidden geometry and fine relief. When users can provide real front/side/back views, use them as a consistent set. A generated turntable can help only when its view consistency is verified; inconsistent synthetic views can damage the reconstruction.
5. **Create an optional, measured detail-refinement stage only after benchmarking.** It must be feature-preserving and operate on a copy of the source mesh. Use displacement/relief reconstruction only where image/normal/multi-view evidence supports it; do not globally smooth or voxel-remesh the source.
6. **If exact parity with Meshy/Tripo matters more than fully local execution, benchmark their current high-geometry API modes too.** This is an explicit product decision: usage cost, latency, terms, privacy, and sending customer images/models to an external service must be accepted first. There is no guarantee that one local open model will match the proprietary platforms for every asset category.

### What success realistically means

The attainable goal is **measurably better native geometry and preserved fine features on a defined test corpus**, not a blanket promise that every single-image mesh will equal a proprietary generator. A one-view input cannot disclose true hidden/back-side microgeometry. In addition, apparent “detail” rendered from a texture/normal map is not the same as geometric relief in the mesh.

---

## 2. What I inspected in the `Dev` branch

The repository was located as `https://github.com/Silentzx2/ForMash3D`, and the exact branch is **`Dev`**. A local `git clone` was attempted, but this execution environment could not resolve `github.com`; code inspection therefore used the connected GitHub repository interface and branch-pinned files. The conclusions below are based on those inspected files, not on a successful local build or GPU generation run.

Relevant code:

- [Model manifest](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/config/models.yaml)
- [Inference parameter policy and scheduler](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/core/scheduler/multiprocess_scheduler.py)
- [TRELLIS adapter](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/adapters/trellis_adapter.py)
- [TRELLIS.2 adapter](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/adapters/trellis2_adapter.py)
- [TRELLIS.2 inference wrapper](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/utils/trellis2_utils.py)
- [Hunyuan3D-Shape-v2.1 adapter](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/adapters/hunyuan3d_shape_v21.py)
- [TripoSG adapter](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/adapters/triposg_adapter.py)
- [Unique3D adapter](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/adapters/unique3d_adapter.py)
- [Mesh processor](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/core/mesh_processor.py)
- [Quality evaluation utilities](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/core/quality/evaluation.py)
- [Mesh-quality benchmark CLI](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/scripts/run_mesh_quality_benchmark.py)
- [Controlled model-run benchmark CLI](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/scripts/run_model_ab_benchmark.py)
- [Existing model-parity tests](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/tests/test_official_model_parity_contract.py)
- [Architecture decisions](https://github.com/Silentzx2/ForMash3D/blob/Dev/Docs/DECISIONS.md)
- [Engineering history / known model fixes](https://github.com/Silentzx2/ForMash3D/blob/Dev/Docs/MEMORY.md)

### Confirmed findings

**A. Raw output is largely model-native today.** The inspected raw routes extract vertices/faces and save them without calling the generic smoothing/decimation utilities:

- TRELLIS calls `run(..., formats=["mesh"])`, uses `simplify=0.0` from the max-quality profile, constructs a `trimesh.Trimesh`, and saves with `do_normalise=False`.
- TRELLIS.2's `raw_mesh_only=True` path converts returned vertices/faces to `trimesh.Trimesh` and returns before the `o_voxel.postprocess.to_glb(...)` export path. That avoids the textured/export path's remesh/decimation logic.
- Hunyuan3D-Shape-v2.1 saves the result with `do_normalise=False` and currently requests an octree resolution of 512 for `source_quality=max`.
- TripoSG writes a native `Trimesh` from the upstream decoder's returned vertices/faces and defaults to `faces=-1`, `auto_optimize=False`; the adapter does not deliberately decimate or smooth the raw mesh before saving.
- The common `MeshProcessor.save_mesh(..., do_normalise=False)` path exports the mesh; it does not invoke `smooth_mesh()` or `simplify_mesh()`.

So the user's diagnosis is plausible: if the exported adapter-level raw file already lacks grooves, ridges, bevels, or fine silhouette changes, **post-processing is not the primary source of that missing detail**. It remains important to verify exactly which file is being inspected and record its face count/hash, but simply disabling downstream smoothing will not fix model-native loss.

**B. The scheduler already strips production polycount/remesh controls from model inputs.** In `multiprocess_scheduler.py`, `_POSTPROCESS_ONLY_INPUTS` removes keys such as `target_polycount`, `faces`, `simplify`, `decimation_target`, and `remesh` before inference. The intent is correctly to preserve source geometry and apply production budgets to derivative assets, not to the original master.

**C. Maximum configured settings are not equivalent to unlimited detail.** `_RAW_MESH_MAX_QUALITY_PARAMETERS` includes the following current profiles:

| Model | Current configured raw-generation profile | Main limitation / risk to test |
|---|---|---|
| TRELLIS.2 | `1536_cascade`, 262,144 `max_num_tokens`, 50 sparse/shape steps, no remesh, no decimation (`-1`) | `1536_cascade` is a requested path, not proof that the cascade actually returned `res=1536`. Official pipeline code returns an effective `res` from cascade sampling; current project metadata should capture that actual value. |
| TripoSG | 50 inference steps, guidance 7.0, Flash decoder depth 9, dense depth 8, hierarchical depth 9, no face reduction | Decoder/latent representation and input evidence still limit detail. The alternative hierarchical decoder queries a much denser grid and can raise VRAM/runtime/OOM risk; compare only in a controlled resource test. |
| Hunyuan3D-Shape-v2.1 | 50 steps, guidance 5.0, octree 512, `num_chunks=20000` | 512 is the configured/upstream extraction ceiling, so more output polygons cannot recover details the representation/extraction does not resolve. |
| Hunyuan3D mini-Turbo | 5 steps, octree 512, FlashVDM enabled, no low-VRAM mode | Fast 0.6B distilled model; treat as latency/low-resource baseline, not the top-fidelity default. More steps should not be arbitrarily forced beyond its trained/distilled schedule. |
| TRELLIS | 50 sparse-structure and 50 shape-latent steps, guidance 7.5, `simplify=0.0` | Its learned representation and native extraction quality set the ceiling. A log currently labels `texture_resolution` as `res`, which risks confusing texture size with geometry resolution. |
| Unique3D | Input processing/refinement enabled; multi-view images and normals are predicted from one image | Predicted views are inferred, not genuine observed geometry. Fine details may be smoothed or inconsistent between imagined views; output needs its own raw-only evaluation. |

**D. There is a telemetry gap around actual extraction.** The scheduler logs requested steps and requested extraction settings; TRELLIS.2 metadata records `pipeline_type` and `max_num_tokens`, but the model pipeline can return a *different effective resolution* from its cascade. Add a real output field for `effective_geometry_resolution`, `voxel_size` (where applicable), native vertices/faces, decoder/extractor name, and whether any reduction/smoothing ran. Never present a requested mode as the measured achieved resolution.

**E. Model metadata is duplicated.** `backend/config/models.yaml` contains preferred extraction/resolution/quality-priority capability hints, while the scheduler separately hardcodes raw max-quality profiles. Add tests to keep these definitions consistent, or consolidate the source of truth; otherwise a future model/config edit can say “high fidelity” while runtime silently uses a lower profile.

**F. The app already has a useful benchmark foundation.** `backend/core/quality/evaluation.py` supports surface sampling, Chamfer Distance, density-aware Chamfer, F-score and normalized surface drift. Its current no-reference comparisons are diagnostics, not ground-truth quality scores. The existing CLI requires exactly matching input hashes/protocol for run-vs-run comparisons; use it rather than judging solely from textured screenshots.

---

## 3. Why a high-poly mesh can still look smooth

1. **Polycount is not information.** Subdivision can create more triangles over a smooth surface, but it cannot infer a screw thread, sharp groove, engraving, wrinkle, or hard-surface edge that never appears in the source mesh. Decimation can destroy detail, but *not* decimating cannot create it either.
2. **The model's learned 3D prior matters.** Image-to-3D systems map a 2D observation into a learned shape representation. Fine relief might be absent from the training prior, suppressed by the latent bottleneck, or blurred by the model's denoising/reconstruction behavior. Changing the export face count does not change those upstream facts.
3. **Geometry extraction is another ceiling.** Marching cubes/implicit grids/octree decoders sample a field at finite resolution; thin surfaces and tiny height differences can disappear below the sampling scale. O-Voxel-style field-free representations are designed to handle a broader range of topologies and sharp features, but they still depend on model predictions and their effective resolution.
4. **A single image is an incomplete measurement.** Front-view texture, lighting, shadows and perspective do not uniquely specify true surface height or unseen sides. A real side/back view adds evidence. Super-resolution can help the image encoder see edges, but it may hallucinate details; it cannot turn guessed detail into ground truth.
5. **Texture can fake geometry.** High-resolution albedo, roughness and normal maps may make a render appear detailed while the mesh silhouette and vertex positions remain smooth. The evaluation must separate actual geometric relief, texture detail and shader/rendering detail.
6. **Processing can still erase detail later.** Even though the current raw route usually avoids generic smoothing, later remesh, voxel-shell reconstruction, smoothing, hole-filling, face reduction, or normal recomputation can degrade derivatives. Preserve one immutable native master and compare all derivatives back to it.
7. **Commercial platforms have their own learned systems and quality modes.** Current Meshy documentation exposes `meshy-7.1` geometry modes including `geometry_resolution: "4k"` for a 4096³ geometry pass and recommends `should_remesh=false` for maximum quality. Current Tripo API documentation identifies `v3.1-20260211` and `geometry_quality: "detailed"` for finer geometry. These are generation-mode capabilities, not merely a requested target triangle count. They are useful comparison baselines, but vendor claims still need hands-on A/B tests.

---

## 4. Model strategy: current local candidates + new challengers

### First test the existing local stack

**1) TRELLIS.2 — primary local baseline.** Its upstream project describes a 4B image-to-3D model using O-Voxel, intended for complex topology and sharp features; its documented paths include 512³, 1024³ and 1536³. Official guidance says at least 24 GB NVIDIA GPU memory and recommends CUDA 12.4/Linux. For ForMash3D, the next task is not to blindly increase polycount: capture the effective cascade `res`, confirm its native raw output is used, and compare the actual shape to TripoSG on the same images. Full 1536 mode may be slow or memory-intensive on lower-end hardware.

**2) TripoSG — strong independent local comparison.** Current adapter settings are already high. Preserve the official Flash VAE decoder route on supported GPUs as the default and run an experimental alternate decoder only in isolated profiling if warranted. Capture the selected decoder path and raw mesh statistics so results can be reproduced.

**3) Hunyuan3D-Shape-v2.1 — strong baseline, known extraction cap.** The project requests `octree_resolution=512`, with 50 steps. The official upstream parameter range defaults lower and caps at 512. Treat this as a separate candidate, not as the source of “infinite micro-detail” via mesh subdivision.

**4) TRELLIS and Unique3D — retain as task-dependent candidates.** TRELLIS is a useful comparison for its own image-to-shape prior. Unique3D's generated-view/normal bridging can help global reconstruction, but test whether fine geometry is genuinely retained rather than only visually implied by vertex colors. Neither should be presumed superior without the corpus test.

### New open model to prototype: Step1X-3D Geometry

Official repository: [stepfun-ai/Step1X-3D](https://github.com/stepfun-ai/Step1X-3D). It advertises a 1.3B geometry model alongside a separate texture model; its geometry pipeline uses a hybrid VAE-DiT and sharp-edge sampling. The public pipeline exposes useful geometry options such as `label` (including `edge_type="sharp"`), `octree_resolution`, `max_facenum`, `do_reduce_face`, and `do_shade_smooth`. Its demo explicitly exports `out.mesh[0]` as the base geometry before running cleanup/face reduction and texturing on a later mesh copy. The repository states Apache-2.0 for the project code.

**Integration rules:**

- Build a separate `Step1X3DImageToRawMeshAdapter`; do not transplant its dependencies into existing model import paths.
- Run upstream geometry-only inference in an isolated environment/worker first; verify Torch/CUDA/PyTorch3D/other binary dependency compatibility before merging dependency pins.
- For the raw output, keep `do_reduce_face=False` and `do_shade_smooth=False` initially, and export the returned base mesh before any `remove_degenerate_face`, `reduce_face`, smoothing, or texture stage. Run cleanup on a derivative, with drift checks against the native master.
- Benchmark `edge_type="sharp"` versus the other supported modes on hard-surface and organic examples. Choose the symmetry label from the asset category and test its effect rather than assuming every asset is symmetric.
- Test 50 steps and `max_facenum` using the supported project code/schema, then tune within measured VRAM/time constraints. A face cap is an upper bound, not a detail guarantee.
- Audit model/checkpoint license and download requirements independently; upstream code license does not automatically grant every checkpoint/dataset right.

**Alternative future route:** if a more recent geometry-specific research model appears promising, build a plugin-like adapter and benchmark it under the same contract. Do not bulk-add multiple models before measuring one challenger end-to-end.

### Commercial parity experiment (optional, not assumed)

For a true competitive quality bar, compare two kinds of outputs:

- **Meshy:** current official Image-to-3D documentation exposes `meshy-7.1`, `geometry_resolution="4k"` for its finest documented geometry pass, `should_remesh=false` as its quality recommendation, and a separate target-polycount/remesh contract. Configure a geometry-first comparison with remeshing off and preserve the pre-remesh output where supported. Be careful not to mistake target polycount for native generation fidelity.
- **Tripo:** current H-series docs list `v3.1-20260211` as their latest/best-quality version and `geometry_quality="detailed"` as the finer-geometry mode for version 3.0 or later. Verify response format/task version at integration time.

Keep this behind an explicit **External Provider** feature flag. Provide clear opt-in, API-key handling, per-job estimated/actual cost, rate-limit/error handling and data-sharing notice. It is not compatible with an offline/local-only guarantee unless the user knowingly opts out of that guarantee.

---

## 5. Input pipeline recommendations

The raw model should receive a clean, high-information image, without aggressive preprocessing that removes the features we want it to reconstruct.

1. **Preserve original pixels and alpha.** Do not destructively overwrite the uploaded reference. Store original input hash plus preprocessed image/hash and metadata.
2. **Foreground segmentation must preserve thin structures.** Validate that object edges, narrow gaps, antennae, handles, hair, fabric fringes and thin protrusions survive background removal. A soft mask or antialiasing halo can make object-crop detection wrong; a simple hard threshold can also remove translucent features. Use asset-aware mask processing and log failures/fallbacks.
3. **Crop for object occupancy without cutting extremities.** Add an inspectable preview and safe margin. Do not blindly zoom to the largest connected silhouette if detached parts/thin features are important.
4. **Use super-resolution selectively.** It can improve encoder input in small images, but it can hallucinate microtexture and change the reference. Keep the original image accessible and A/B the original vs enhanced input; log which one was used.
5. **When available, collect actual multi-view images.** Require camera views to describe the same physical/object design. Add consistency checks for scale, orientation, backgrounds, crop, and part identity. A multi-view mode should not treat several unrelated image variations as a coherent 3D observation.
6. **Build a geometry-first input benchmark.** Include clean product render/reference photos and difficult real images. Record image resolution, crop bounds, alpha behavior, background-removal model/version and object occupancy. This helps separate input quality from model quality.

---

## 6. Raw-source contract and telemetry to implement

These items are implementation work for the next phase, not performed in this task.

### A. Immutable source and derivative separation

- Raw model output is written once to `master/source.glb` (or an equivalent native source artifact) with no smoothing, decimation, retopology, voxelization, texture bake or face reduction.
- Every production artifact (game-ready mesh, low-poly version, LOD, UV/texture bake, remesh, repair, rigging copy) must fork from the source or a named derivative, never mutate `master/source.glb`.
- Persist a hash of the source artifact and report it in metadata; verify the hash remains identical after all downstream jobs.
- Store raw and derivative statistics independently; UI previews must clearly distinguish `Native source`, `Game-ready`, and `Textured preview`.

### B. Record actual—not merely requested—generation settings

For every job, persist at least:

- Model ID, exact checkpoint/revision and dependency/adapter version.
- Input SHA-256, original and processed image sizes, crop/alpha/SR choices, preprocessing versions.
- Seed, actual number of sampling steps, guidance/CFG, dtype, GPU model/VRAM, memory peak, runtime.
- Decoder/extractor path (`flash` vs `hierarchical`, marching cubes vs O-Voxel, etc.), requested resolution **and effective output resolution**, any cascade fallback, `voxel_size` where meaningful, token/face budgets.
- Native vertices, native faces, number of components, bounds, file size and source hash.
- Exact mesh-changing operations applied, parameters, before/after stats, and comparison drift.

Correct the TRELLIS logging label that currently calls `texture_resolution` a `res` value. Geometry resolution and texture atlas size must be separate fields.

### C. Align registry and inference profiles

- Have one source of truth for per-model quality profiles or add tests comparing manifest capabilities with `_RAW_MESH_MAX_QUALITY_PARAMETERS`.
- Do not present generic `preferred_resolution` values as a literal extraction grid if a model uses another representation.
- Make “Highest Geometry Fidelity” and “Fast/Low VRAM” explicit model/profile choices. Do not silently degrade a quality job to a lower-resolution path when tokens/VRAM are insufficient. Return a clear warning or require user approval for a downgrade.
- Add an automated contract test: target polycount/remesh controls never reach raw adapters; a max-fidelity request disables face reduction/smoothing where the upstream pipeline allows it; the effective resolution is reported.

---

## 7. Detail refinement: only after the baseline

An optional post-generation detail-restoration module could help for certain assets, but it should not be used as a universal “AI sharpener.” A wrong displacement can damage a perfectly valid surface.

### Proposed `detail_refinement` stage

- Input: immutable raw source + original reference image and, when available, consistent multi-view images/depth/normal evidence.
- Estimate high-frequency displacement only where the model/reference evidence supports it. Keep feature-edge masks for bevels, mechanical edges and thin parts so normal smoothing/displacement does not round them off.
- Prefer multiview-consistent depth/normal/photometric evidence over arbitrary generated noise. Use bounded displacement, confidence maps, edge-aware regularization and a rollback path.
- Provide separate modes such as `Geometry detail` (actual mesh displacement / refined surface) and `Render detail` (normal/roughness/displacement texture for appearance). Do not market a high-resolution normal map as real vertex geometry.
- Write a new asset, e.g. `derived/detail_refined.glb`; never overwrite the source.
- Gate promotion on silhouette, surface drift, component count, degenerate-face checks and visual turntable review. When uncertain, keep the source instead.

### What not to do

- Do not globally increase triangle count or subdivide a smooth mesh and call it detail recovery.
- Do not apply broad Laplacian/Taubin smoothing to the native source.
- Do not voxel-remesh a high-detail source by default; voxel pitch can erase thin/engraved features.
- Do not blindly run decimation, hole filling, normal recalculation or sharp-edge welding on the master.
- Do not use generative super-resolution as ground-truth geometry.

---

## 8. Controlled benchmark plan

### Test corpus

Create 15–30 reusable image cases, covering:

1. Hard-surface product with engraved labels, seams and bevels.
2. Mechanical object with teeth, slots, threads, bolts and thin edges.
3. Organic subject with folds, scales, feathers or hair-like fine features.
4. Cloth/leaf/open-surface geometry.
5. Thin parts, holes, handles, narrow gaps and detached components.
6. Smooth simple shapes as a control group.
7. At least 5 cases with ground-truth reference meshes or a consistent multi-view capture set.

Keep the same original input and image preprocessing for comparisons. Run at least three seeds where each model allows stochastic sampling. Track model/checkpoint version, inference profile, actual resolution and source file hash.

### Models to compare

- Current local: TRELLIS.2, TripoSG, Hunyuan3D-Shape-v2.1, TRELLIS, Unique3D.
- Latency/low-resource control: Hunyuan3D mini-Turbo.
- New challenger: Step1X-3D geometry-only.
- Optional external baselines: Meshy 7.1 in finest geometry mode, Tripo v3.1 with detailed geometry.

### Required artifact views

For each model/input, retain:

- Native raw GLB.
- Identical neutral-lighting turntable renders (front, back, left, right, top, 3/4).
- Close-up crops of actual physical features, plus wireframe/flat-gray shading (textures off) to reveal true geometry.
- Rendered textured preview separately, clearly labelled as texture-assisted.
- JSON run metadata with parameters/metrics.

### Metrics

Use existing `backend/scripts/run_mesh_quality_benchmark.py` and `backend/scripts/run_model_ab_benchmark.py` as the starting point.

- With a ground-truth mesh: Chamfer Distance, density-aware Chamfer, F-score at a fixed normalized threshold, normalized surface drift, silhouette agreement and high-curvature/feature-edge retention.
- Without ground truth: use fixed multi-view render/wireframe review, consistency across seeds/views, and source-versus-derivative drift. Label these as diagnostics, **not absolute geometry accuracy**.
- All comparisons must normalize/align units and coordinate frames. A wrong rotation/scale can ruin the metric without meaning the detail itself is wrong.
- Validate mesh health separately: degenerate faces, non-finite coordinates, disconnected noise/floater components, self-intersections where measurable, thin-part survival, non-manifold edge behavior and bounding-box sanity.
- Measure wall time, peak VRAM, OOM frequency, peak face count and GLB size; quality gains that make the main product unusable should be surfaced as trade-offs, not hidden.

Current CLI examples (run from the backend environment):

```bash
cd backend
python -m scripts.run_mesh_quality_benchmark --reference /path/to/reference.glb --candidate /path/to/raw_output.glb --output /path/to/report.json
python -m scripts.run_mesh_quality_benchmark --candidate /path/to/raw_output.glb --output /path/to/report-no-reference.json
```

For asset-directory comparisons, use `scripts.run_model_ab_benchmark` with `--baseline-asset`, `--candidate-asset`, and optional `--reference`. It intentionally blocks comparisons with different input hashes/protocol; keep that requirement.

### Proposed acceptance gates (tune after baseline)

- **Native-source preservation:** 0 automatic decimation/smoothing/remesh in the source path; source hash unchanged throughout post-processing.
- **Resolution truthfulness:** each quality run records the decoder/extractor and achieved effective resolution. Any quality downgrade is explicit and never silent.
- **Quality improvement:** on the ground-truth subset, target a meaningful median improvement (initial proposal: at least 10% relative improvement in the selected primary metric versus the current best local baseline) without a measurable regression in major silhouette/large-feature fidelity. Treat 10% as a test target, not a guaranteed result.
- **Feature pass rate:** create a human rubric for the defined engravings/edges/thin features; compare blind, same-scale turntables. Set a threshold only after collecting a reliable baseline.
- **Runtime/resource gate:** define an acceptable GPU-memory/runtime tier, with a clear “HQ / slow” option rather than silently cutting quality.
- **Regression:** current model registrations (including `PartUV`) and existing adapter/contract tests stay intact; legacy retired models are not reintroduced unless separately approved.

---

## 9. Phased implementation roadmap

| Phase | Work | Deliverable / exit criterion | Priority |
|---|---|---|---|
| 0. Baseline | Save current raw outputs and neutral/wireframe turntables for the fixed corpus; capture hashes and existing parameters. | Reproducible baseline across TRELLIS.2, TripoSG, Hunyuan Shape, TRELLIS, Unique3D. | P0 |
| 1. Truthful telemetry | Log TRELLIS.2 effective returned `res` and voxel size; fix texture-vs-geometry-resolution logging; record native counts/hash/extraction path/GPU/peak VRAM. | We know what was actually generated, and can detect silent quality downshifts. | P0 |
| 2. Contract hardening | Preserve immutable `master/source.glb`; verify raw path has no mesh-changing stages; compare `models.yaml` and scheduler quality profiles; add tests for no postprocess inputs to adapters. | Source/detail preservation is tested and observable, not just comments. | P0 |
| 3. Benchmark current models | Run same corpus, seeds, renders and metrics across current local candidates; rank by asset category. | A measured “best model for category” matrix; no model is crowned by face count alone. | P0 |
| 4. Step1X prototype | Implement isolated geometry-only adapter, environment/dependency validation, model manifest + factory + UI registry + download/health check. | End-to-end raw output and identical-corpus benchmark; keep behind experimental flag until it passes. | P1 |
| 5. Input + multi-view | Build mask/crop/SR diagnostics and opt-in multi-view input with view consistency checks. | Better source evidence without destructive preprocessing; demonstrate gains on held-out cases. | P1 |
| 6. Detail refinement | Prototype edge-aware, confidence-gated displacement on a derivative only; report reference/source drift and visual results. | Optional mode shows measurable geometry improvement or remains disabled. | P2 |
| 7. Provider benchmark | Optional Meshy/Tripo API adapter with clear consent, keys, cost and data policy. | Quality ceiling/commercial comparison established; cloud upload never happens silently. | P2 |
| 8. Default policy | Set category-dependent defaults (`HQ local`, `fast`, optional cloud); publish measured memory/time vs quality. | Defaults selected from data, not model marketing claims. | P2 |

---

## 10. Practical priority list

If only three tasks can be done first, do these:

1. **Verify TRELLIS.2's effective `res` and compare its raw geometry against TripoSG.** This is the most likely immediate win because the system already uses a top local model and a high-fidelity path, but current logs do not prove which resolution the cascade actually returned.
2. **Run the raw-only benchmark and visually inspect flat-shaded/wireframe details, not just textured previews.** It tells us whether quality is limited by the base model, preprocessor, effective extraction, or downstream derivative pipeline for each type of asset.
3. **Integrate Step1X-3D as the first new local challenger**, keeping its source output untouched and its environment isolated. Compare the actual output rather than assuming the newest model will win.

Do not start by adding more general mesh libraries or making every model generate millions of faces. Only add a dependency when it solves a measured failure (e.g., better extractor, geometry refinement, mesh health metric) and remains compatible with supported GPU/OS environments.

---

## 11. External research references

All vendor/model capabilities below are sourced from their public documentation/repositories; they describe the authors' published architecture or product API, not independently verified performance on ForMash3D's hardware.

1. **Microsoft TRELLIS.2 official repo** — O-Voxel, 4B image-to-3D, stated 512³ / 1024³ / 1536³ paths, sharp/complex topology focus and hardware requirements: [github.com/microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2).
2. **TRELLIS.2 pipeline code** — `1536_cascade` calls a cascade sampler which returns `res`, and that `res` is used for decoding; therefore report effective output resolution rather than just requested pipeline mode: [official pipeline source](https://github.com/microsoft/TRELLIS.2/blob/main/trellis2/pipelines/trellis2_image_to_3d.py).
3. **Step1X-3D official repo** — 1.3B geometry model, hybrid VAE-DiT, sharp-edge sampling and Apache-2.0 project-code license: [github.com/stepfun-ai/Step1X-3D](https://github.com/stepfun-ai/Step1X-3D). [Pipeline parameters](https://github.com/stepfun-ai/Step1X-3D/blob/main/step1x3d_geometry/models/pipelines/pipeline.py) and [demo exporting base geometry before face reduction/texturing](https://github.com/stepfun-ai/Step1X-3D/blob/main/app.py).
4. **Meshy image-to-3D API docs** — `meshy-7.1`, 2K/4K geometry generation pass, remesh recommendation, and separate polycount contract: [docs.meshy.ai/en/api/image-to-3d](https://docs.meshy.ai/en/api/image-to-3d).
5. **Tripo image-to-model API docs** — current H-series model IDs, `geometry_quality="detailed"`, model-seed reproducibility and input-image recommendations: [developers.tripo3d.ai](https://developers.tripo3d.ai/en/docs/generation-image-to-model).
6. **TripoSG upstream extraction code** — default dense and hierarchical octree depths plus distinct flash/hierarchical decoder paths: [VAST-AI-Research/TripoSG inference utilities](https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/inference_utils.py) and [pipeline code](https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/pipelines/pipeline_triposg_scribble.py).
7. **ForMash3D internal benchmark contract** — run comparison, fixed input hashes, normalized surface drift and quality metrics: [quality evaluation code](https://github.com/Silentzx2/ForMash3D/blob/Dev/backend/core/quality/evaluation.py).

---

## Final decision

**First prove and measure the raw geometry path; then benchmark models; then introduce one serious local model challenger.** Keep the untouched high-fidelity mesh as the immutable source. Use extraction/profile telemetry to make sure high-quality generation means the actual high-quality path ran. Use multi-view evidence for difficult detail, and treat neural displacement/detail refinement as an optional downstream copy with measurable quality gates. Keep a commercial API option as the only honest fallback if required parity is beyond what local open weights can reliably deliver for the target asset set.
