# Model & Pipeline Readiness

**Snapshot:** 2026-10-30  
**Branch:** `dev`  
**Repository:** `Silentzx2/ForMesh3D`

## Purpose

This page separates five states that must not be conflated:

1. **Registered/enabled** — the adapter ID is present and enabled in `backend/config/models.yaml`.
2. **Weights available** — expected checkpoint files appear to exist locally or are reported by the model manifest.
3. **Pipeline loadable** — dependencies, vendored sources, checkpoint structure, CUDA runtime, and device placement allow the complete pipeline to initialize.
4. **Inference succeeds** — the adapter returns an output for a request.
5. **Mesh is usable** — the output opens and passes geometry/topology checks and visual review.

Passing an earlier state does not imply that later states pass. In particular, `GET /api/v1/system/models` is a catalog view, not a certification endpoint.

## Current project-level status

- Multiple image-to-mesh and finishing adapters are registered in the dev branch.
- Some model pipelines are **reported to fail during pipeline initialization/loading** in particular runtime environments.
- Some models are **reported to complete generation but produce broken or unusable meshes**.
- The current reports are not yet tied to a reproducible list of model IDs, exact checkpoint revisions, GPU/driver combinations, and sample inputs. This page records them as unresolved cross-catalog limitations rather than guessing which exact model IDs are affected.
- The shared post-processing pipeline includes repair and mesh-size safeguards, but it cannot guarantee recovery from every model-native failure or malformed surface. The global vertex/face cap is applied after extraction; it is not a pre-inference memory-admission guarantee.
- Hi3D remains experimental. Its actual locked profile and hardware prerequisites are documented in `EXPERIMENTAL-MODEL-SETTINGS.md`.

## Model-family verification boundary

| Family / path | Repository status | What is not certified by this snapshot |
|---|---|---|
| TRELLIS | Registered; geometry repair changes and CPU/source-contract coverage exist | Full checkpoint load, target-GPU inference, and visual mesh quality |
| TRELLIS.2 | Registered; geometry-only raw path skips texture-SLat sampling/decoding | Full checkpoint load, GPU quality, VRAM, and latency |
| Hunyuan3D Shape / Mini Turbo / Paint | Registered paths and compatibility/load safeguards exist | Every deployment's checkpoint completeness, pipeline load, and visual quality |
| TripoSG | Registered; post-extraction mesh-size protection is present | Pre-inference memory safety and target-GPU output quality |
| Unique3D | Registered; recent reconstruction-source adjustments exist | Reproducible visual confirmation across representative inputs |
| Pixal3D | Registered; adapter regression and device-placement contracts exist | Full GPU pipeline and mesh-quality certification |
| Hi3D | Experimental; refinement route and adapter contract exist | General production readiness outside a supported CUDA/checkpoint environment |
| Painting / retopology / UV / rigging paths | Separate stage-specific adapters | Their checkpoints and runtime prerequisites must be validated independently from raw mesh generation |

This table is not a ranking and does not imply that the unverified paths are all failing. It records the boundary between code-level integration and hardware-backed proof.

## CI and verification: what they prove

CPU-oriented backend CI can compile Python and exercise selected source, configuration, scheduler, and mocked adapter contracts. Frontend CI can type-check and build the UI. Those checks do **not** load every model checkpoint, execute CUDA inference, measure real peak VRAM, run every Blender-dependent stage, or judge the visual quality of generated meshes.

For every verification report, include:

- Exact model ID and feature path.
- Commit SHA and third-party submodule SHA.
- Checkpoint source/revision and whether each expected file is complete.
- OS, Python, PyTorch, Transformers/Diffusers, CUDA, driver, GPU model, and free VRAM.
- Cold pipeline-load result and full traceback on failure.
- Input image hash, seed, requested intent/settings, job ID, and raw output path.
- Inference duration, peak VRAM, vertex/face counts, connected components, non-manifold edges, holes, degenerate faces, and visual-review result.
- Post-processing result recorded separately from raw adapter output.

Never infer a successful GPU run from a passing CPU test or a green model-catalog entry. Use `NOT RUN` where the hardware check has not been performed.

## Triage

### Pipeline fails to load

1. Capture the complete backend traceback and exact model ID.
2. Distinguish missing weights (`MODEL_NOT_READY`) from import/checkpoint/pipeline initialization failure (`MODEL_LOAD_ERROR`) and resource admission failure (`INSUFFICIENT_VRAM` / `CUDA_OOM`).
3. Verify checkpoint layout and required files before downloading or replacing weights.
4. Record the GPU, driver, CUDA, Python, and dependency versions.
5. Do not silently substitute a different model without recording that routing decision.

### Model returns broken geometry

1. Preserve and inspect the immutable `master/source.glb` before examining derivatives.
2. Check finite vertex coordinates, face-index bounds, empty geometry, connected components, holes, non-manifold edges, degenerate faces, and extreme vertex/face counts.
3. Compare raw output with the post-processed derivative. This identifies whether the defect originates in model inference or a downstream processing stage.
4. Keep the image hash, seed, model/checkpoint revision, job logs, and failing mesh as a regression case.
5. Do not assume hole filling, smoothing, or decimation can repair a fundamentally collapsed or fragmented reconstruction.

## Release/readiness policy

Do not call the whole model catalog production-ready until each enabled image-to-mesh model has:
- A successful cold load on the supported target runtime.
- A successful representative inference with the expected checkpoint.
- A mesh that passes structural checks and visual review.
- A separate post-processing run with master immutability verified.
- Recorded VRAM, latency, and environment details.
- A repeatable smoke test or a documented reason why that test must remain manual.
