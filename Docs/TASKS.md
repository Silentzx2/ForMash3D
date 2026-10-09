# ForMash3D — High-Fidelity 3D Generation, Detail Preservation, Resource Orchestration & Validation
## Giant Implementation Task — Dev Branch

> **Research provenance:** This task is an expanded/edit of the existing ForMash3D implementation task using the supplied 19-page deep-research audit. The research identified a pipeline-wide quality-loss cascade spanning preprocessing, generation representation, aggressive retopology/decimation, UV/baking, and final-output policy. It specifically recommends treating the preserved high-detail master as the fidelity deliverable, using conservative remeshing before baking, and evaluating TRELLIS.2, TripoSG, and Hi3DGen as complementary/additive technologies rather than relying on one universal generator. [Research audit PDF, pp. 2–10](#research-resource-index).

> **Execution mode:** autonomous, implementation-first, zero-gap completion.
>
> **Mandatory parallel execution:** The lead agent MUST launch **6 worker sub-agents** when the runtime supports six concurrent workers. If the environment cannot sustain six, it MUST launch **at least 4 worker sub-agents** and explicitly record why six was not possible. Every worker must independently read this `docs/task.md`, `RULES.md`, `agent.md`, `README.md`, and the relevant project documentation before changing code. Workers must complete their assigned phase/workstream, report files changed and verification performed, and never assume another worker has satisfied a requirement unless the lead agent verifies it.
>
> **Primary rule:** DO NOT remove, disable, delete, de-register, or replace any existing ForMash3D model/adapter as a way to solve this task. Every currently supported model must remain available. Improvements must be additive, model-aware, and backward-compatible.
>
> **No model training:** use existing open-weight models and existing/open-source components only.
>
> **GPU hardware validation:** the implementation agent must prepare everything and run all non-hardware verification it can. Final real-GPU generation/VRAM validation is explicitly left to the user. The agent must not falsely claim hardware validation passed if it was not run.
>
> **Engineering principle:** improve quality through better conditioning, routing, generation settings, detail-preserving geometry processing, resource management, and verification. Do not create unnecessary architecture or duplicate existing functionality.

---

# 1. Objective

Audit and improve the complete ForMash3D 3D-generation pipeline so that generated assets preserve substantially more geometric detail and visual fidelity while still supporting optimized/game-ready derivatives.

The target is not to imitate one vendor's implementation. The target is to close the quality gap with systems such as Tripo AI and Meshy AI by making ForMash3D's existing open-weight stack substantially smarter.

The primary quality hierarchy is:

1. **Geometric fidelity and detail preservation**
2. **Texture/material fidelity and alignment**
3. **Clean topology / UV quality**
4. **Game-ready optimization**
5. **Performance and resource efficiency**

The final architecture must support both:

- a **high-fidelity master asset**
- one or more **optimized derivative assets**

The high-fidelity master must never be destroyed by optimization.

---

# 2. Mandatory Repository Audit Before Editing

Before changing code, inspect the actual `Dev` branch.

Read and understand:

- `RULES.md`
- `agent.md`
- `README.md`
- all relevant existing Markdown/documentation
- model registry/configuration
- model download/weight management
- every existing 3D generation adapter
- preprocessing
- multiview support
- backend API
- generation workers
- post-processing
- repair
- retopology/remeshing
- UV
- texture generation
- baking
- LOD generation
- physics/game-ready processing
- mesh viewer / generation-status flow
- poly-count controls
- model capability detection
- CUDA/GPU resource logic
- CPU worker logic
- caches and temporary artifacts
- tests and CI

Do not infer behavior from documentation when source code can verify it.

Create an internal implementation map before touching architecture:

`input -> preprocess -> conditioning -> model selection -> model inference -> raw mesh -> immutable master -> repair -> high-fidelity processing -> derivative retopo/remesh -> UV -> bake/material -> LOD -> game-ready -> validation -> final outputs`

Compare the real implementation against this model and identify every divergence.

---

# 3. Hard Invariants

These are non-negotiable.

## 3.1 Existing models must remain

- Do not delete any model.
- Do not delete an existing adapter.
- Do not silently replace an existing model.
- Do not remove model weights/config entries because a new model is considered better.
- Do not hard-code the application to one model.
- Existing model selection must continue to work.
- Existing model-specific capabilities must remain represented.
- New models are additive.
- Existing routes may gain smarter defaults, but the old routes must remain usable.

If a model is temporarily incompatible with a new pipeline stage, add capability metadata and route around the incompatibility instead of deleting it.

## 3.2 No training

Do not train, fine-tune, distill, LoRA-train, or otherwise modify model weights.

Use:

- existing open-weight models
- official/open-source inference code
- existing adapters
- existing preprocessors
- existing remeshing/retopology tools
- existing texture/baking tools
- existing evaluation libraries
- premade components where technically justified

## 3.3 Master preservation

The first valid neural/geometry output must be preserved as an immutable high-fidelity source asset.

Never run destructive optimization directly on the only copy.

Conceptually:

`raw generation -> master/source.glb -> derivatives`

not:

`raw generation -> destructive optimization -> source.glb`

The master is the primary high-fidelity deliverable.

## 3.4 No premature quality loss

Do not:

- decimate before preserving the master
- aggressively retopologize the only copy
- generate LODs from an already-damaged low-quality derivative when the master is available
- bake onto an unnecessarily sparse target
- use texture super-resolution as a substitute for missing geometry
- reduce resolution merely to make the pipeline look faster

Every lossy operation must operate on a derivative.

---

# 4. Required Architecture Improvement: Model-Aware Generation

Do NOT implement “one model replaces everything”.

Implement a model-aware orchestration layer.

## 4.1 Capability registry

Every model/adapter must expose machine-readable capabilities such as:

- image-to-3D
- text-to-3D if supported
- multiview
- single-view
- texture generation
- native PBR
- vertex color
- mesh quality characteristics
- preferred preprocessing
- preferred extraction method
- preferred resolution
- preferred face/triangle budget
- minimum/typical VRAM
- CPU requirements
- multi-GPU compatibility
- supported output formats
- recommended post-processing profile

Do not guess capabilities. Read official model code/docs where possible and confirm from the actual adapter implementation.

## 4.2 Smart model routing

Add routing logic that chooses an appropriate existing model based on:

**Research-derived rule:** Do not infer that the newest or theoretically strongest model is always the best route. The supplied research shows different model families have different representation and output trade-offs: Hunyuan3D-family SDF extraction can smooth sharp/thin features; TRELLIS.2/O-Voxel is aimed at arbitrary topology/sharp features and native PBR; TripoSG emphasizes high-fidelity geometry and hierarchical extraction; Hi3DGen provides a normal-bridging conditioning path. These are routing signals, not reasons to delete any existing model.

- input modality
- model availability
- multiview support
- object type when inferable
- desired quality
- desired polycount
- texture requirement
- available GPU memory
- number of GPUs
- CPU resources
- requested generation mode
- latency/quality mode

Routing must be deterministic and explainable.

Example concept:

`input -> capability filter -> resource filter -> quality profile -> best compatible model`

Do not force a new model onto all requests.

## 4.3 A/B and fallback support

The system must allow controlled benchmarking between models.

Support:

- baseline model
- candidate model
- same input
- same output target
- same evaluation protocol

If the primary model fails due to resource or capability constraints, automatically fall back to another retained compatible model.

Failure handling must not corrupt the master or leave the request in a permanently broken state.

---

# 5. Generation Quality Improvements

## 5.1 Preprocessing

Audit and improve preprocessing before generation.

**Required research-backed checks:**
- Compare current ForMash3D framing/normalization against model-specific pipelines that normalize, resize, and center the subject.
- Verify whether the foreground occupies an appropriate fraction of the image before inference.
- Verify whether background removal is introducing edge halos, holes, or silhouette damage.
- Preserve the highest-value input pixels around edges/corners/high-curvature regions.
- Where an existing model benefits from importance-weighted surface/detail conditioning, expose that capability instead of assuming generic matting is sufficient.

At minimum evaluate:

- background removal
- object framing
- object centering
- scale normalization
- transparent/solid background handling
- image resolution
- aspect ratio handling
- crop strategy
- subject occupancy
- input quality validation

Use model-specific preprocessing profiles where beneficial.

Do not blindly preprocess the same way for every model.

## 5.2 High-detail conditioning

Investigate stronger conditioning paths inspired by current open research, including:

- normal-map bridging
- high-curvature/detail-aware conditioning
- better normalization/framing
- multiview consistency when available
- model-specific image preparation

Hi3DGen-style normal bridging should be evaluated as an optional conditioning module rather than blindly imposed on every model.

Implementation rule:

- first prove whether it improves the existing stack
- only integrate permanently if benchmark evidence supports it

## 5.3 Multiview

If a model supports multiview:

- expose that capability through the adapter registry
- automatically enable/disable multiview controls
- preserve view ordering/metadata
- validate consistency across views
- ensure multiview input is routed only to compatible models

Do not send multiview inputs to single-view models unless a deliberate conversion path exists.

---

# 6. High-Fidelity Generation Strategy

Retain every existing generation model, but optimize each one according to its actual strengths.

For each model:

1. Verify its recommended inference settings.
2. Verify extraction/mesh-conversion settings.
3. Verify resolution settings.
4. Verify face/triangle controls.
5. Verify sampler/step settings where exposed.
6. Verify model-specific preprocessing.
7. Verify texturing strategy.
8. Verify whether the adapter is using the official/recommended implementation.
9. Verify that no unnecessary post-processing is destroying its output.

For models using SDF or volumetric extraction:

**Research-derived Hunyuan3D checks:**
- Verify the model's normalization, resizing and centering path.
- Verify whether its VAE/preprocessing path preserves high-curvature/edge information as intended.
- Verify Marching-Cubes/extraction settings and determine whether sharp/thin features are being smoothed during conversion.
- Compare the raw extracted mesh against the post-processed derivative so any loss can be attributed to generation/extraction versus retopology/decimation.

- use the highest practical quality extraction supported by the model
- evaluate hierarchical/multi-resolution extraction where supported
- expose face/detail controls
- avoid conservative defaults when quality mode is selected

For models with sparse/voxel representations or native materials:

- preserve native geometry/material output as the high-fidelity path
- avoid forcing them through lower-quality legacy assumptions

Do not assume one representation is universally best. Benchmark.

---

# 7. Detail-Preservation Post-Processing Rebuild

This is one of the highest-priority areas.

The improved philosophy is:

`generate high-quality master -> analyze master -> create derivative target -> retopo/remesh conservatively -> UV -> bake -> optional optimization -> LOD`

## 7.1 Repair

Repair only what is necessary.

Check:

- invalid faces
- zero-area faces
- duplicate vertices
- non-manifold edges
- holes
- flipped normals
- disconnected fragments
- extreme spikes
- invalid transforms

Repair operations must preserve geometry whenever possible.

Before/after checks must ensure repair did not materially destroy detail.

## 7.2 Geometry analysis

Before retopo/decimation, calculate useful structural signals where practical:

- curvature
- normal variation
- silhouette importance
- thin-feature regions
- small disconnected components
- local face density
- feature size

Use those signals to make simplification adaptive.

## 7.3 Detail-aware remeshing / retopology

Existing FastMesh / AutoRetopo / other retained tools may be used, but do not automatically run the most aggressive mode.

**Research-backed ordering requirement:** the target derivative topology must be established **before UV/baking**, not after texture baking. The supplied audit specifically identifies the current “dense master -> aggressive simplification -> bake” philosophy as a source of permanent detail loss. Adopt a smart-meshing/generate-first philosophy where practical: create a sufficiently dense, clean target mesh with feature-aware vertex allocation, then bake from the immutable master to that target. The goal is to preserve geometry where geometry is valuable and move only appropriate micro-detail into normal/other maps.

This follows the research's **“Smart Mesh / generate-first”** principle: the desired production mesh should be constructed as an intentional target rather than produced by blindly destroying a dense mesh. When using a retained premade remeshing component, verify that it behaves this way before making it the default. The research specifically references a TRELLIS.2 remeshing-before-baking pattern and QEM-style decimation as a practical example.


The target mesh should be:

- clean
- stable
- sufficiently dense
- silhouette-preserving
- feature-preserving
- suitable for UVs
- suitable for baking

Allocate more geometry to:

- sharp features
- high-curvature regions
- silhouettes
- joints
- thin structures
- visually important surfaces

Allocate less geometry to:

- flat low-information regions

## 7.4 Controlled decimation

Decimation must be a derivative operation.

Use quality-aware settings.

Prefer algorithms/settings that preserve:

- silhouette
- curvature
- normals
- thin features
- important topology
- seams needed for downstream stages

Never force a requested polycount if doing so causes catastrophic fidelity loss.

If the requested budget is too low:

- produce the best valid derivative
- record the compromise
- preserve the high-quality master

## 7.5 High-poly to low-poly baking

The high-poly master remains the source.

Bake at least where supported/required:

- base color/albedo
- normal
- roughness
- metallic
- ambient occlusion

Only add maps when the renderer/material system actually benefits from them.

Do not treat RealESRGAN or another upscaler as a replacement for correct baking.

---

# 8. UV and Texture Quality

Implement quality validation for:

- UV overlap
- UV stretch
- island waste
- texel density
- seam placement
- padding
- atlas utilization
- target resolution
- map consistency

Use adaptive texture resolution.

Do not hard-code 4K for every asset.

For high-fidelity profiles, expose atlas resolution up to the maximum supported by the selected pipeline (the research uses 4096×4096 as an example) and expose generation/detail resolution controls where the model supports them (the research uses TRELLIS.2 up to 1536³ as an example). Verify actual runtime/memory behavior before making these defaults.

Use:

- lower resolution for small/simple assets
- higher resolution for large/high-detail assets
- maximum supported quality profile for high-fidelity output

Where the source model generates native PBR materials, preserve them instead of unnecessarily regenerating everything.

Where geometry-only models are used, route through the best retained texturing stage.

---

# 9. Master + Derivative Asset Model

For each generation create a clear asset hierarchy.

Example:

```text
asset/
  master/
    source.glb
    source_metadata.json

  high_fidelity/
    final_high.glb

  optimized/
    final.glb
    lod0.glb
    lod1.glb
    lod2.glb

  textures/
    ...

  validation/
    ...
```

Use the repository's existing storage structure where one already exists. Do not create a duplicate hierarchy if the project already has an equivalent concept.

Metadata must preserve:

- source model
- model version
- adapter
- preprocess profile
- generation settings
- seed
- source input hash
- geometry settings
- post-processing profile
- target polycount
- texture resolution
- resource placement
- timestamps/version information

---

# 10. LOD Pipeline

LOD generation must happen from the best available derivative.

Do not cascade quality loss blindly.

Each LOD must preserve:

- silhouette
- major proportions
- important thin parts
- visually important materials

Validate:

- triangle count
- bounding box
- disconnected geometry
- normals
- material assignments
- visual degradation across LODs

LOD generation must never modify the master.

---

# 11. Resource Orchestration Architecture

Implement a centralized resource manager instead of letting each model independently make GPU/CPU assumptions.

The resource manager must understand:

- number of GPUs
- total VRAM
- currently free VRAM when detectable
- model memory estimates
- CPU core/thread count
- available system RAM
- concurrent jobs
- model residency
- load/unload state
- GPU affinity

---

# 12. Multi-GPU Model Loading — Mandatory

Support model placement across multiple GPUs when technically supported.

### Required behavior

If a model does not fit on one GPU but the combined available memory across multiple GPUs is sufficient, the resource manager must attempt a supported multi-GPU placement strategy before simply failing.

For example:

`20 GB model + 2 GPUs x 14 GB`

should be evaluated as a multi-GPU/sharded-load case.

However:

**DO NOT naïvely split arbitrary model tensors 50/50.**

A model can only be split when its implementation/framework supports:

- layer/module sharding
- tensor parallelism
- pipeline parallelism
- device mapping
- supported CPU/GPU offload
- another valid distributed placement method

Use actual module sizes and available memory, not hard-coded equal splits.

### Required strategy order

1. Native model-supported tensor/model parallelism
2. Framework-supported balanced device mapping
3. Layer/module sharding
4. CPU offload where useful
5. Single-GPU load if it fits
6. Clear resource failure only when no valid strategy exists

The manager must reserve memory for:

- model parameters
- activations
- temporary tensors
- CUDA runtime
- post-processing

Do not fill VRAM to an unsafe 100%.

### Device balancing

Balance based on actual memory requirements.

If two GPUs have unequal free memory:

- allocate modules according to free capacity
- avoid OOM on one GPU while another has unused memory

### Model residency

Avoid reloading the same model for every request.

Implement a memory-aware model lifecycle:

- cold load
- warm
- idle
- evict
- reload

Keep frequently used models warm when resources permit.

When memory pressure increases:

- evict least-recently-used models
- preserve required jobs
- never corrupt a running generation

---

# 13. CPU Utilization — Mandatory

CPU-bound work must use the available CPU resources efficiently.

The system must detect the available logical CPU count and automatically scale worker/thread counts.

Example:

`4 cores -> up to 4 usable CPU workers where appropriate`
`32 cores -> up to 32 usable CPU workers where the workload supports it`

Do not blindly create 32 Python threads for a single-threaded workload.

Choose the correct mechanism per task:

- multiprocessing/process pools for Python CPU-bound workloads
- threads for I/O-bound tasks
- native library threading for operations that release the GIL
- vectorized operations where available

Prevent oversubscription.

Coordinate:

- Python workers
- PyTorch CPU threads
- OpenMP
- MKL
- BLAS
- image-processing libraries
- mesh-processing libraries

Expose a central CPU policy such as:

```text
FORMSH3D_CPU_THREADS=auto
FORMSH3D_CPU_WORKERS=auto
```

`auto` must resolve from actual available resources.

Provide safe overrides for constrained machines.

---

# 14. Concurrent Job Scheduling

Do not let multiple heavyweight models silently allocate all resources.

Implement resource-aware job admission:

- model memory estimate
- GPU memory availability
- CPU usage
- RAM usage
- queueing
- per-job priority
- cancellation
- cleanup

A large job should not start if it would obviously make the process unstable.

Where possible:

- schedule compatible CPU tasks concurrently
- schedule model loading ahead of inference
- overlap I/O and CPU preprocessing with GPU inference
- reuse cached preprocessing/model state

Do not introduce a distributed system unless the existing application actually requires it.

---

# 15. Performance Optimization

Optimize without lowering the high-quality output.

Investigate:

- lazy loading
- model warm cache
- preprocessing cache
- intermediate artifact cache
- memory reuse
- batch-safe operations where supported
- asynchronous I/O
- pipeline overlap
- unnecessary file conversions
- duplicate image decoding
- duplicate mesh loading
- duplicate texture loading

Track:

- model load time
- inference time
- post-processing time
- memory peak
- CPU utilization
- GPU utilization when available
- output size

Do not optimize by silently lowering quality settings.

Quality mode and performance mode may have different settings, but defaults must remain explicit.

---

# 16. Evaluation and Benchmarking — Corrected

There is currently no guaranteed ground-truth dataset.

Therefore:

## 16.1 Without ground truth

Do NOT treat CD/DCD/F-Score against another generated mesh as absolute truth.

Use:

- multi-view render comparisons
- input-to-render consistency
- geometric consistency
- semantic consistency where useful
- structural consistency where useful
- mesh integrity checks
- topology statistics
- artifact checks
- human A/B evaluation

## 16.2 With ground truth

When an actual reference mesh exists, enable:

- Chamfer Distance
- F-Score
- Density-aware Chamfer Distance
- other relevant geometric metrics

Use consistent normalization, sampling density, and coordinate alignment.

## 16.3 MeshyBench / benchmark integration

Evaluate whether MeshyBench can be reused or integrated as a benchmark/evaluation component instead of reinventing similar functionality.

Do not copy unnecessary infrastructure.

Research the current upstream project and only integrate the subset that provides measurable value.

## 16.4 Rendering benchmark

Use standardized camera positions/orientations.

Compare:

- front
- rear
- left
- right
- top
- bottom
- oblique views

Add more views only when useful.

The benchmark must emphasize:

- silhouette
- thin structures
- sharp edges
- local details
- topology quality
- texture alignment
- material consistency


**Required diagnostics from the supplied research audit:**
- **Geometric consistency:** compare rendered/derived surface normals with predicted or reference depth/normal signals when the dependency is available.
- **Semantic consistency:** use a lightweight DINO-based multi-view identity check where practical to detect Janus faces and identity drift.
- **Structural consistency:** use novel-view or perceptual comparison where supported to identify geometry inconsistencies that point-based metrics miss.
- **Rendering + LPIPS-style comparison:** compare standardized multi-view renders for silhouette, smoothness, seams, texture/material artifacts and overall visual agreement.
- **Human A/B review:** retain a simple reviewer path because the research explicitly notes that standard CD/F-Score do not fully represent perceived quality.
- **Optional LLM/SRAM-like evaluator:** benchmark-only, never mandatory in the production generation path; use only if it produces useful signal relative to cost.

---

# 17. Automated Quality Gates

Before an asset is considered successful, validate:

## Geometry

- valid mesh
- no catastrophic non-manifold state
- no NaN/infinite coordinates
- no invalid faces
- valid normals
- expected scale/bounds
- expected component count

## Detail

- master preserved
- no unexpected massive face reduction
- silhouette preserved
- thin features preserved where present
- high-curvature regions not destroyed

## UV

- valid UVs
- no unexpected overlap
- sensible texel density
- valid material assignment

## Textures

- valid dimensions
- readable files
- correct color spaces where applicable
- no missing maps when required
- no broken references

## GLB/asset integrity

- file opens successfully
- mesh is present
- materials resolve
- textures resolve
- transforms are valid

A failed quality gate must produce a useful diagnostic instead of a silent fallback.

---

# 18. Optional Quality Diagnostics

Use advanced diagnostics only if they provide measurable value and can be integrated cleanly.

Potential options:

- DCD
- multi-view LPIPS-style comparison
- DINO-based semantic consistency
- depth/normal consistency
- structural consistency
- mesh realism evaluation

Do not add an expensive LLM evaluator to the production path unless benchmark evidence shows a real benefit.

Heavy diagnostics should be:

- optional
- benchmark-only
- asynchronous where appropriate

---

# 19. TRELLIS.2 Integration Rule

TRELLIS.2 must be evaluated as a **new retained model**, not as a destructive replacement for existing models.

**Research-derived implementation requirements:**
- Treat the supplied research's **TRELLIS.2 4B / up-to-1536³ / roughly-24GB-class VRAM** figures as starting estimates only; verify the exact currently selected revision, inference path, precision, peak activation memory, and runtime before setting resource policies.
- Preserve TRELLIS.2's native PBR information where the selected path provides it (the research identifies base color, roughness, metallic, and opacity).
- Evaluate whether the current ForMash3D output path is unnecessarily forcing the model through a legacy watertight/SDF-oriented post-processing assumption.
- Prefer the official [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2) implementation/reference pipeline where integration is feasible.
- Evaluate the official O-Voxel path because its native representation is explicitly designed to handle sharp features and arbitrary/open/non-manifold topology, avoiding some of the lossy assumptions of field-based extraction.
- Evaluate the official [O-Voxel package/documentation](https://github.com/microsoft/TRELLIS.2/tree/main/o-voxel) because the research specifically identified mesh/O-Voxel conversion, PBR attributes and GLB export as relevant capabilities.
- Evaluate [ComfyUI's TRELLIS.2 workflow documentation](https://docs.comfy.org/tutorials/3d/trellis2) and the existing [trellis.cpp](https://github.com/pwilkin/trellis.cpp) implementation as possible premade integration paths. Prefer the path that minimizes architectural duplication and best matches ForMash3D's current runtime.
- Verify the actual current memory requirement, CUDA/driver constraints, dependency build requirements, supported output modes and licensing before integration. Treat research-era VRAM figures as estimates, not fixed facts.
- Do not replace every model with TRELLIS.2 merely because the research labels it a strong candidate. Benchmark it against every retained high-quality route.

If it is integrated:

- add an adapter
- register capabilities
- add model weights through the existing model manager
- add resource requirements
- add multi-GPU compatibility metadata
- expose quality settings
- expose output capabilities
- connect it to the same master/derivative architecture
- benchmark it against retained models

Do not delete Hunyuan3D, TRELLIS, Tripo-related retained models, multiview models, or any existing adapter.

The final system should choose among models rather than force one universal generator.

---

# 20. TripoSG / Hierarchical Extraction Rule

Where TripoSG is supported:

**Research-derived requirements:**
- Use the official [VAST-AI-Research/TripoSG](https://github.com/VAST-AI-Research/TripoSG) repository as the primary implementation reference.
- Verify the current implementation of hierarchical extraction in the installed/selected revision before hard-coding CLI/API arguments.
- Tune face/detail parameters experimentally; do not assume the repository's default is the highest-fidelity setting.
- Because the research identifies TripoSG as geometry-focused/vertex-color output, keep it compatible with the existing Hunyuan3D-Paint or best retained texturing path rather than inventing a separate texture stack.

- verify current official extraction options
- use hierarchical extraction when it is confirmed to produce better geometry for the current version
- expose quality-relevant face/detail settings
- keep texturing as a separate compatible stage where required

Do not hard-code stale CLI flags without verifying the actual installed upstream version.

---

# 21. Hi3DGen / Normal Bridging Rule

Investigate Hi3DGen-style normal bridging as a modular conditioning path.

Use the official [ByteDance Hi3DGen repository](https://github.com/bytedance/Hi3DGen) and paper as the primary reference. The supplied audit specifically describes its clean/noisy dual-stream normal-bridging approach as a way to improve high-frequency geometric conditioning. Implement it as an optional, model-aware preconditioning stage and only keep it enabled where controlled evaluation proves a net gain.

The implementation should:

1. generate/obtain a normal representation
2. validate whether it improves downstream geometry
3. benchmark against the normal pipeline
4. integrate only if the improvement is measurable

Keep it optional and model-aware.

---

# 22. Existing Post-Processing Must Be Preserved Where Useful

Do not rewrite working components simply for architectural style.

Reuse existing:

- repair
- FastMesh
- AutoRetopo
- UV
- bake
- RealESRGAN
- LOD
- physics
- game-ready processing

when they remain technically appropriate.

Improve:

- ordering
- parameters
- adaptive behavior
- inputs/outputs
- validation
- detail preservation

Replace only when evidence proves the component is the bottleneck.

### Research-derived post-processing policy

| Existing stage | Problem to verify | Required direction |
|---|---|---|
| Repair | Repair may alter master geometry | Make repair conservative and validate before/after topology/detail |
| Retopo | Aggressive simplification removes detail | Build a feature-aware derivative target before baking |
| UV/Bake | Poor target topology/UVs limit detail transfer | Bake from the immutable master into the validated derivative; use adaptive atlas/texel density |
| Texture SR | Upscaling cannot restore missing information | Treat RealESRGAN-like SR as enhancement only |
| LOD | Cascading simplification can compound errors | Generate LODs from the best valid derivative/master lineage |
| Final output | Optimized mesh may become the only visible asset | Expose the high-fidelity master and optimized derivatives separately |

The supplied research also recommends evaluating atlas sizes up to 4K for high-detail assets where supported, but texture resolution must remain adaptive and must not substitute for missing geometry.

---

# 23. Frontend / API Behavior

The backend improvements must be reflected cleanly in the existing UI/API.

Expose, where already supported:

- model
- quality mode
- polycount
- texture quality
- multiview
- model capability state
- generation progress
- current pipeline stage
- fallback status
- final asset variants

The UI must not expose controls for unsupported model capabilities.

If a model cannot use a given feature, disable/hide the control with a meaningful reason.

---

# 24. Polycount Architecture

Polycount is a target, not a command to destroy geometry.

Implement quality-aware polycount handling:

`requested polycount -> evaluate geometry complexity -> allocate where needed -> derive optimized mesh`

Support:

- auto
- low
- medium
- high
- custom

Do not force a low target onto the master.

The user should be able to retain the full-quality source while requesting a lower game-ready derivative.

---

# 25. Intermediate Artifacts and Reproducibility

Every major stage should be reproducible.

Store sufficient metadata to reproduce:

- preprocessing
- model selection
- generation
- extraction
- repair
- retopo
- UV
- baking
- optimization
- LOD

Use hashes/version identifiers where practical.

Avoid duplicate storage of massive artifacts unless necessary.

---

# 26. Error Handling

Every stage must fail explicitly.

Required behavior:

- no silent corruption
- no silent quality downgrade
- preserve previous valid artifact
- record failure stage
- record model and resource configuration
- return useful error information

If a post-processing stage fails:

- retain the master
- optionally return the best valid previous derivative
- mark the failed stage
- never overwrite the master with an invalid result

---

# 27. Multi-Agent Implementation Strategy

Use multiple sub-agents/workstreams in parallel where the environment supports sub-agents.

**Mandatory launcher rule:**
- Launch **6 worker sub-agents** whenever six concurrent agents are supported.
- If runtime limits prevent six, launch **4 or 5**, never fewer than 4 without a documented platform limitation.
- The lead agent remains responsible for integration and the final audit.
- Every worker MUST read `docs/task.md`, `RULES.md`, `agent.md`, `README.md`, and the documentation relevant to its phase before coding.
- Every worker MUST search/inspect the repository before deciding what to change.
- Workers may not remove another worker's implementation to simplify their own task.
- Workers must preserve existing models/adapters and reconcile shared-file changes with the lead agent.
- After parallel work, the lead agent MUST re-read the final repository and verify every phase independently.

Recommended workstreams:

### Agent A — Repository/Architecture Audit
Map current implementation and identify exact files/classes to modify.

### Agent B — Generation/Model Adapters
Audit every retained model and adapter, capability metadata, settings, routing, and new-model integration.

### Agent C — Geometry/Post-Processing
Implement master preservation, adaptive repair, detail-aware retopo/remesh, baking, decimation and LOD logic.

### Agent D — Resource Manager
Implement GPU discovery, model memory accounting, multi-GPU placement/sharding, CPU scaling, job scheduling, model caching.

### Agent E — Evaluation/Benchmarking
Implement quality gates, rendering comparisons, optional DCD/metrics, benchmark runner, and failure diagnostics.

### Agent F — Frontend/API/Integration + Final Integration Support
Wire the new capabilities into current APIs/UI/status reporting, expose model capabilities, quality profiles, polycount behavior, progress/fallback status, and reconcile cross-cutting integration issues.

### Lead Agent (not counted as a worker)
Must integrate all six workstreams, resolve conflicts, re-read repository rules/docs, run cross-phase tests, and perform the final completeness audit.

If a separate QA worker is desired by the runtime, it may be created only when it does not reduce the mandatory minimum of four workers. Otherwise, QA responsibility remains with Agent F plus the Lead.

If sub-agents are unavailable, execute the workstreams sequentially without skipping any.

---

# 27A. Mandatory Phase Execution Protocol

The task is divided into implementation phases. Every phase below must be completed; “later”, “optional because time”, or “not needed” is not an acceptable completion state unless the requirement is demonstrably inapplicable to the actual codebase.

## Phase 0 — Rule/Architecture Reconnaissance
**Owner:** Lead + Agent A  
**Goal:** establish the actual Dev-branch architecture, current models, adapters, post-processing chain, resource management, and documentation constraints.

Required outputs:
- current architecture map
- exact files/modules to change
- retained-model inventory
- current quality-loss hypotheses
- dependency/license risk list
- cross-agent implementation contracts

## Phase 1 — Evaluation Foundation
**Owner:** Agent E  
**Goal:** implement baseline-safe, ground-truth-aware and no-ground-truth-aware evaluation.

Required:
- mesh integrity checks
- multi-view render comparison
- CD/F-Score where reference meshes exist
- DCD where appropriate
- optional geometric/semantic/structural consistency diagnostics
- benchmark input/output schema
- deterministic comparison settings
- failure diagnostics

## Phase 2 — Model/Conditioning Layer
**Owner:** Agent B  
**Goal:** retain all models and make the generation stack model-aware.

Required:
- capability registry
- model-specific preprocessing
- routing
- fallback
- A/B mode
- multiview capability gating
- TRELLIS.2 additive integration path
- TripoSG settings path
- Hi3DGen normal-bridging experiment path
- official/upstream implementation verification

## Phase 3 — Geometry/Post-Processing
**Owner:** Agent C  
**Goal:** eliminate avoidable post-generation detail loss.

Required:
- immutable master
- conservative repair
- geometry analysis
- feature-aware remesh/retopo
- quality-aware decimation
- high-poly -> derivative bake
- UV validation
- adaptive texture resolution
- LOD lineage/validation
- preservation of existing FastMesh/AutoRetopo/etc. where useful

## Phase 4 — Resource Orchestration
**Owner:** Agent D  
**Goal:** make GPU/CPU usage hardware-aware and stable.

Required:
- GPU discovery
- VRAM accounting
- multi-GPU placement where supported
- safe offload
- model residency/cache
- CPU auto-scaling
- job admission/queueing
- oversubscription prevention
- resource-aware fallback

## Phase 5 — API/UI/Integration
**Owner:** Agent F  
**Goal:** make all new capabilities reachable through existing application paths without breaking UX.

Required:
- API integration
- model capability state
- quality/polycount controls
- progress
- errors/fallback
- variant outputs
- documentation updates
- persistent asset previews & thumbnails across workspace navigation
- header hardware telemetry vertical gauges with dynamic saturated status colors
- dual-state generation queueing ("Queue Next") & viewport HUD job capsule
- dual Redis/SQLite atomic job deletion synchronization

## Phase 6 — Cross-Phase Verification
**Owner:** Lead  
**Goal:** prove the complete system is wired, not merely that individual files exist.

Required:
- import/syntax/build checks
- tests
- integration checks
- mock resource tests
- route tests for every retained model
- regression checks
- documentation consistency check
- exact requirement-to-code-to-test matrix

## Phase 7 — User Hardware Validation Package
**Owner:** Lead  
**Goal:** leave a clean final package for user-side GPU testing.

Required:
- exact GPU test commands
- expected outputs
- expected VRAM behavior
- 1-GPU and 2-GPU scenarios
- CPU-only fallback validation
- clear statement of what was not hardware-tested


---

# 28. Mandatory Verification Before Completion

The implementation is NOT complete until the lead agent verifies all of the following.

## Repository correctness

- [ ] `RULES.md` followed
- [ ] `agent.md` followed
- [ ] existing docs updated where necessary
- [ ] no contradictory documentation remains
- [ ] no stale architecture references remain
- [ ] no unused temporary code remains

## Model integrity

- [ ] every pre-existing model remains registered
- [ ] every pre-existing adapter remains usable
- [ ] no model was removed
- [ ] no model was silently disabled
- [ ] model selection works
- [ ] fallback works
- [ ] capability routing works

## Generation

- [ ] preprocessing works
- [ ] model-aware preprocessing exists
- [ ] model settings are configurable
- [ ] high-quality extraction is used where appropriate
- [ ] master asset is preserved

## Post-processing

- [ ] repair is non-destructive where possible
- [ ] remesh/retopo operates on derivatives
- [ ] detail-aware simplification exists
- [ ] UV validation exists
- [ ] baking preserves available detail
- [ ] LODs derive from valid higher-quality assets
- [ ] master never gets overwritten

## Resource management

- [ ] GPU discovery works
- [ ] model resource requirements are tracked
- [ ] multi-GPU placement is implemented where supported
- [ ] no fake 50/50 split logic
- [ ] CPU worker scaling is implemented
- [ ] oversubscription is controlled
- [ ] model cache/residency works
- [ ] job admission prevents obvious resource exhaustion

## Evaluation

- [ ] no-ground-truth evaluation does not falsely treat another generated mesh as truth
- [ ] ground-truth metrics are supported when references exist
- [ ] multi-view rendering comparison works
- [ ] quality gates work
- [ ] benchmark runner works
- [ ] failure cases are recorded

## Code quality

Run all available:

- Python syntax checks
- import checks
- type/static checks
- unit tests
- integration tests that do not require unavailable GPU hardware
- linting/formatting if repository rules require them
- API schema checks
- frontend build/type checks
- shell/config validation

Search for:

- TODOs accidentally left in required paths
- dead imports
- dead config
- broken paths
- invalid model IDs
- hard-coded GPU indices
- hard-coded CPU counts
- hidden single-GPU assumptions
- duplicated resource-management logic
- silent exception swallowing

---

# 29. GPU Testing Policy

The user will perform final real-hardware GPU validation.

The agent MUST still:

1. Implement all resource-management code.
2. Validate syntax/import/configuration.
3. Add testable mock/simulation coverage for:
   - 1 GPU
   - 2 GPUs
   - insufficient single-GPU VRAM
   - sufficient aggregate multi-GPU VRAM
   - CPU fallback
   - insufficient total resources
4. Produce exact GPU validation commands/checklist for the user.
5. Clearly label any hardware test that was not actually executed.

Never report “GPU verified” unless the GPU test really ran.

---

# 30. Final Quality Verification

At the end, perform a final “100% completion audit”.

Re-read the entire task from top to bottom.

For every requirement:

- identify the implementation file/code path
- confirm it exists
- confirm it is wired into the real execution path
- confirm it is not dead code
- confirm it does not break existing models
- confirm error handling exists
- confirm tests/verification exist

Create a final internal checklist:

```text
Requirement -> Implementation -> Verification -> PASS/FAIL
```

There must be no “probably done”, “should work”, or “left for later” items.

If something genuinely cannot be completed due to external hardware availability or an upstream dependency, document:

- exact blocker
- affected functionality
- code already prepared
- exact user validation command
- fallback behavior

Do not silently omit the requirement.

---

# 31. Documentation Requirements

Update existing project documentation where appropriate.

Document:

- model capability routing
- master vs derivative assets
- multi-GPU behavior
- CPU scaling
- quality modes
- post-processing order
- benchmark/evaluation usage
- user GPU validation procedure

Do not create unnecessary documentation files.

Prefer editing the repository's existing documentation structure according to `RULES.md`.

---

# 32. Scope Discipline

Do NOT:

- train models
- rewrite the entire project
- remove existing models
- replace working systems without evidence
- create a distributed microservice architecture without need
- add multiple overlapping resource managers
- add an expensive evaluator to every generation
- introduce dependencies that can be avoided through existing components
- lower quality to hide performance problems
- silently change user-visible behavior without updating the corresponding UI/API contract

Every new abstraction must have a concrete responsibility.

---

# 32A. Research Integration Rules & Premade Component Policy

The supplied research must be treated as a design input, not as unquestioned implementation truth.

For every external component:
1. Prefer the official upstream repository or project page.
2. Check the actual code/README/version used.
3. Verify license and third-party dependency obligations.
4. Pin a known revision/commit when vendoring is appropriate.
5. Do not copy an entire external repository when a focused integration is sufficient.
6. Do not create duplicate functionality already present in ForMash3D.
7. Record the chosen integration path in the final implementation notes.

Where the repository policy permits vendoring a third-party implementation, prefer the official repository, preserve notices/license files, and isolate the vendor integration behind a ForMash3D adapter. Do not train or modify external model weights.

## Research findings that MUST be reflected in implementation

The supplied 19-page audit identifies these concrete quality-loss mechanisms and recommendations:

- Current quality loss is cumulative, not a single bug: preprocessing, generation representation, retopo/decimation, baking, and output policy all contribute.
- ForMash3D's preserved `master/source.glb` must become the primary high-fidelity deliverable rather than merely a baking source.
- Simpler background removal/conditioning may underuse input detail; evaluate normalization, centering, resizing, and edge/high-curvature preservation.
- Hunyuan3D-family SDF/Marching-Cubes extraction may smooth sharp/thin structures; compensate with model-specific extraction settings or route to other retained generators where benchmark evidence supports it.
- TRELLIS.2/O-Voxel should be evaluated because its native representation is intended to preserve sharp features and arbitrary/open/non-manifold topology without the same field-to-surface conversion assumption.
- TripoSG should be evaluated using current hierarchical extraction and suitable face/detail controls where supported.
- Hi3DGen-style normal bridging should be evaluated as a modular high-frequency conditioning path.
- Retopology/remeshing should happen before UV/baking when building a clean derivative target, not as an afterthought that destroys detail.
- QEM/quality-aware decimation should preserve silhouette/curvature/features.
- UV layout and target topology directly constrain baking quality.
- 4K/large atlases can be useful for high-detail assets, but texture upscaling cannot recreate geometry that was already removed.
- The evaluation plan must not pretend CD/F-Score is a complete human-quality metric.
- DCD, multi-view perceptual comparison, Eval3D-style geometric/semantic/structural consistency, and human A/B review are complementary.
- An LLM/SRAM-style realism check is optional and benchmark-only because of its compute/cost burden.
- TRELLIS.2, TripoSG, Hi3DGen and existing ForMash3D models are complementary candidates; preserve all retained models and route intelligently.


---

# 33. Recommended Target Architecture

The final architecture should conceptually become:

```text
INPUT
  |
  v
Input Validation
  |
  v
Model/Capability Detection
  |
  v
Model-Aware Preprocessing
  |
  +---- optional multiview / normal conditioning
  |
  v
Resource-Aware Model Router
  |
  +---- retained Model A
  +---- retained Model B
  +---- retained Model C
  +---- TRELLIS / TRELLIS.2
  +---- TripoSG where integrated
  +---- other existing models
  |
  v
High-Quality Generation
  |
  v
IMMUTABLE MASTER
  |
  +---- high-fidelity output
  |
  +---- detail-aware repair
  |
  +---- adaptive remesh/retopo
  |
  +---- UV
  |
  +---- bake/material processing
  |
  +---- optimized derivative
  |
  +---- LOD generation
  |
  +---- game-ready processing
  |
  v
Quality Gates
  |
  v
Validation / Benchmarking
  |
  v
Final Asset Set
```

---

# 34. Definition of Done

This task is considered complete only when ForMash3D has all of the following:

1. Existing models are preserved.
2. Model selection is capability-aware.
3. Generation is quality-oriented rather than model-agnostic.
4. High-fidelity master geometry is immutable.
5. Post-processing no longer unnecessarily destroys the master.
6. Retopology/remeshing is adaptive and detail-aware.
7. Baking uses the best available source and target.
8. UVs/materials are validated.
9. LODs are generated from appropriate derivatives.
10. TRELLIS.2, if integrated, is additive and benchmarked.
11. Other candidate quality modules are evaluated before adoption.
12. Multi-GPU loading/sharding is implemented where technically supported.
13. Model memory placement is resource-aware.
14. CPU workloads automatically scale with available cores where parallelism is possible.
15. Concurrent jobs are resource-aware.
16. Model caching/residency is optimized.
17. The system has measurable quality gates.
18. Ground-truth and no-ground-truth evaluation are correctly separated.
19. The benchmark can compare retained models fairly.
20. Failures preserve valid artifacts.
21. Static/unit/integration checks pass.
22. Existing functionality remains intact.
23. Documentation matches the final architecture.
24. A final 100% completeness audit has been performed.

---

# 35. Final Agent Instruction

Do not interpret this document as a suggestion list.

Treat it as an **execution contract**.

First inspect the real repository. Then map requirements to implementation locations. Then execute the work using parallel sub-agents/workstreams where available. Resolve conflicts centrally. Re-check the entire repository after implementation.

**Do not stop after the first successful generation.**

The real success condition is:

> **ForMash3D must preserve more useful geometry and visual detail from generation through final output while retaining every existing model, supporting smart model routing, efficiently using available CPU/GPU resources, and producing verifiable high-fidelity and optimized derivatives.**

Before reporting completion, re-read this entire task, compare every requirement against the implementation, run every available non-hardware verification, check syntax/imports/configuration/builds, inspect for regressions, and explicitly report any item that could not be hardware-validated.

No partial implementation should be presented as complete.

---

# Research Resource Index

The following links were extracted from the supplied research report and supplemented with current primary project links. Agents must prefer primary sources and use secondary articles only for context.

## Primary Model / Pipeline Sources

1. [TRELLIS.2 — Microsoft project](https://microsoft.github.io/TRELLIS.2/)
2. [TRELLIS.2 — GitHub](https://github.com/microsoft/TRELLIS.2)
3. [TRELLIS.2-4B — Hugging Face](https://huggingface.co/microsoft/TRELLIS.2-4B)
4. [O-Voxel documentation/source](https://github.com/microsoft/TRELLIS.2/tree/main/o-voxel)
5. [TRELLIS.2 example / GLB export path](https://github.com/microsoft/TRELLIS.2/blob/main/example.py)
6. [ComfyUI TRELLIS.2 workflow documentation](https://docs.comfy.org/tutorials/3d/trellis2)
7. [trellis.cpp — standalone C++/GGML TRELLIS.2 implementation](https://github.com/pwilkin/trellis.cpp)
8. [TripoSG — official VAST-AI-Research repository](https://github.com/VAST-AI-Research/TripoSG)
9. [TripoSG README](https://github.com/VAST-AI-Research/TripoSG/blob/main/README.md)
10. [TripoSG inference utilities](https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/inference_utils.py)
11. [Hi3DGen — official ByteDance repository](https://github.com/bytedance/Hi3DGen)
12. [Hi3DGen paper](https://arxiv.org/html/2503.22236v1)
13. [Hunyuan3D-2.1 — official repository](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)
14. [Hunyuan3D-2.1 paper](https://arxiv.org/html/2506.15442v1)
15. [Hunyuan3D-2.0 paper](https://arxiv.org/html/2501.12202v1)
16. [TripoSR — official repository](https://github.com/VAST-AI-Research/TripoSR)
17. [TripoSG research discussion listed in the supplied audit](https://www.reddit.com/r/StableDiffusion/comments/1jpl4tm/open_sourcing_triposg_highfidelity_3d_generation/)
18. [TripoSG / TripoSF announcement listed in the supplied audit](https://www.tripo3d.ai/blog/vast-open-source-month)
19. [Hunyuan3D vs TRELLIS comparison source listed in the supplied audit](https://triposr.org/blog/hunyuan3d-vs-trellis)
20. [Tripo vs Meshy comparison source listed in the supplied audit](https://www.tripo3d.ai/compare/tripo-vs-meshy)
21. [Meshy 3D-creation guide repository](https://github.com/meshy-dev/Meshy-guide)
22. [Meshy 3D-printing guidance source listed in the supplied audit](https://www.meshy.ai/blog/best-ai-tools-for-3d-printing)
23. [CraftsMan3D](https://craftsman3d.github.io/)
24. [3D shape discrepancy research](https://arxiv.org/html/2401.09736v1)
25. [Shape fidelity metric from real-world distortions](https://openaccess.thecvf.com/content/CVPR2026/papers/Feng_Learning_3D_Shape_Fidelity_Metric_from_Real-world_Distortions_CVPR_2026_paper.pdf)

## Evaluation / Benchmark Sources

16. [MeshyBench — official repository](https://github.com/meshy-dev/meshybench)
17. [Eval3D — official codebase](https://github.com/eval3d/eval3d-codebase)
18. [Eval3D project page](https://eval3d.github.io/)
19. [PyTorch3D Chamfer Distance implementation](https://github.com/facebookresearch/pytorch3d/blob/main/pytorch3d/loss/chamfer.py)
20. [PyTorch3D documentation](https://pytorch3d.readthedocs.io/en/latest/modules/loss.html)
21. [Density-aware Chamfer Distance reference](https://www.researchgate.net/publication/356510928_Density-aware_Chamfer_Distance_as_a_Comprehensive_Metric_for_Point_Cloud_Completion)
22. [3D shape fidelity metric research](https://openaccess.thecvf.com/content/CVPR2026/papers/Feng_Learning_3D_Shape_Fidelity_Metric_from_Real-world_Distortions_CVPR_2026_paper.pdf)
23. [Perceptual 3D textured shape metric](https://arxiv.org/html/2512.01380v1)
24. [Shape-Realism Alignment Metric](https://arxiv.org/html/2512.01373v1)

## Mesh / Evaluation Research From the Supplied Audit

25. [Measuring discrepancy between 3D geometric models](https://arxiv.org/html/2401.09736v1)
26. [3D mesh comparison discussion](https://www.reddit.com/r/computergraphics/comments/kv374k/how_to_compare_two_3d_meshes/)
27. [TripoSR](https://github.com/VAST-AI-Research/TripoSR)
28. [CraftsMan3D](https://craftsman3d.github.io/)

## ForMash3D / Project Context

29. [ForMash3D repository](https://github.com/Silentzx2/ForMash3D)
30. [ForMash3D developer guide](https://github.com/Silentzx2/ForMash3D/blob/main/Docs/developer-guide.md)

## Agent / Task Execution References From the Supplied Audit

31. [tasksmd/tasks.md](https://github.com/tasksmd/tasks.md)
32. [Markdown as an agent task format](https://dev.to/battyterm/the-case-for-markdown-as-your-agents-task-format-6mp)
33. [AGENTS.md guidance](https://www.augmentcode.com/guides/how-to-build-your-agents-md)
34. [AGENTS.md guide](https://www.aihero.dev/a-complete-guide-to-agents-md)
35. [AGENTS.md 2026 spec discussion](https://www.morphllm.com/agents-md-guide)

## Additional Sources Listed in the Supplied Research

36. [TRELLIS.2 paper](https://arxiv.org/html/2512.14692v1)
37. [Refining Image-to-3D Foundation Models via Geometric Supervision](https://openaccess.thecvf.com/content/CVPR2026W/AI4RWC/papers/Lee_Refining_Image-to-3D_Foundation_Models_via_Geometric_Supervision_for_Industrial_Plant_CVPRW_2026_paper.pdf)
38. [Single-view 3D reconstruction overview](https://www.unite.ai/how-single-view-3d-reconstruction-works/)
39. [Tripo AI / Meshy comparison source listed by the research](https://www.tripo3d.ai/compare/tripo-vs-meshy)
40. [Meshy guide](https://github.com/meshy-dev/Meshy-guide)
41. [Hunyuan3D Hugging Face README](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/refs%2Fpr%2F6/README.md)
42. [Hunyuan3D GPU tutorial](https://www.digitalocean.com/community/tutorials/3d-assets-images-gpu-droplets-hunyuan3d)
43. [ComfyUI TRELLIS.2 release/context discussion](https://blog.comfy.org/p/trellis2-and-pixal3d-are-now-native-in-comfyui)
44. [ComfyUI TRELLIS.2 advanced workflow example](https://www.runcomfy.com/comfyui-workflows/comfyui-trellis2-workflow-advanced-structure-image-generation)
45. [TripoSG user guide reference listed by the research](https://deepwiki.com/VAST-AI-Research/TripoSG/3-user-guide)
46. [Eval3D codebase mirror/reference listed by the research](https://github.com/chengjiafeng857/Eval3d_pipline)
47. [PyTorch3D F-Score discussion](https://github.com/facebookresearch/pytorch3d/issues/733)

**Source handling rule:** Links are references for agent research. Primary repositories/papers take precedence over secondary blogs/reviews. The agent must explicitly record when a recommendation came from a secondary source and verify it against upstream code before implementation. The agent must verify the actual current upstream implementation/version, API, dependency requirements, and license before using any component. Do not implement a stale flag or dependency claim solely because a secondary source mentions it.

---

# 36. Mandatory Final Agent Launch / Handoff Contract

The lead agent must perform the following in order:

1. Read `docs/task.md` completely.
2. Read `RULES.md`, `agent.md`, `README.md`, and all relevant project docs completely.
3. Launch 6 worker sub-agents; if the runtime caps concurrency, launch at least 4 and document the limitation.
4. Give each worker a clearly isolated phase/workstream from Section 27A.
5. Require every worker to read the same task/docs/rules before edits.
6. Require every worker to report:
   - what was inspected
   - files changed
   - why the change was required
   - tests run
   - remaining blockers
7. Merge/reconcile all work.
8. Re-read `docs/task.md` after implementation.
9. Re-read the repository documentation after implementation.
10. Search for regressions, dead code, stale flags, removed model registrations, hidden single-GPU assumptions, CPU oversubscription, broken resource accounting and invalid paths.
11. Run all available non-hardware verification.
12. Do not claim final GPU validation unless it was actually executed.
13. Produce a final requirement matrix with every task item marked `PASS` or `BLOCKED` and the exact reason.
14. A blocked hardware test must include exact user commands, expected behavior, and the code path already prepared for validation.
15. The final implementation is not complete until this process is finished.

**File location requirement:** This document must live in the repository as:

```text
docs/task.md
```

Do not create another differently named task document for the same implementation scope.

**Completion rule:** No partial implementation may be presented as complete.
