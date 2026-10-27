# ForMesh3D — GPU Inference Runtime Audit

**Audit date:** 2026-10-27  
**Repository:** https://github.com/Silentzx2/ForMesh3D  
**Branch reviewed:** dev  
**Reviewed commit:** c8b3ab1bd82521b56380c5998a34784dff581803  
**Third-party source gitlink:** backend/thirdparty → Silentzx2/ForMesh3D-ThirdParty, SHA 2ff954dccd31f94eb4cc445535074abd01fa96ab

## Verification boundary

A local recursive clone failed because this environment could not resolve github.com. As requested, the audit instead read the exact dev commit and the parent-recorded submodule commit using GitHub API. No local checkout was available and no source/configuration was changed.

**GPU verification: NOT RUN.** No runnable local checkout, target GPU, model environment or production weights were available. Findings are static code/contract findings or risks, not claims that a GPU crash was reproduced. Real CUDA loading/inference, effective device/dtype, peak VRAM and visual quality need target-host verification.

## Executive summary

High-priority findings:
1. Hi3D overwrites a caller-supplied seed with 42, contrary to the caller-controlled-seed contract.
2. Hi3D declares multi-GPU dispatch in its manifest, while its loader selects one device and does not dispatch components across planned GPU IDs.
3. Hunyuan3D-Shape's active adapter profile conflicts with its manifest comments and architecture/task documentation.
4. Hunyuan3D-Shape moves the full pipeline to CUDA before multi-GPU dispatch or CPU offload, risking OOM before either strategy can help.
5. Hi3D's “textured mesh” route actually exports untextured geometry.
6. Paint3D timeout/cancellation kills its child process but raises before waiting/reaping it or guaranteeing pipe cleanup.
7. Paint3D's LOADED status proves import/path preflight, not that model checkpoints have loaded.
8. Hunyuan background-remover fallbacks can change preprocessing semantics without clearly recording the degraded path in output provenance.
9. Model VRAM reservations are not measured peak-memory guarantees.
10. Unique3D's Lanczos fallback is not quality-equivalent to its learned super-resolution path.

## Findings and permanent fixes

### F-01 — Hi3D overwrites caller-provided seed
**Severity: High — request contract/reproducibility**

Evidence: [hi3d_adapter.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/hi3d_adapter.py) merges inputs with _LOCKED_INFERENCE_PROFILE last; that profile contains seed 42, so request seed is overwritten. This conflicts with [RULES.md](https://github.com/Silentzx2/ForMesh3D/blob/dev/RULES.md) and [GENERATION-UI-CONTRACT.md](https://github.com/Silentzx2/ForMesh3D/blob/dev/Docs/GENERATION-UI-CONTRACT.md), which say seed remains caller-controlled.

Permanent fix: remove seed from the locked profile. Apply default 42 only if seed is missing/None, preserving seed 0. Add regression tests for explicit zero, explicit nonzero, and omitted seed; verify the pipeline call and result metadata.

Acceptance: explicit seeds arrive unchanged; missing seed uses documented default; other inference settings remain locked.

### F-02 — Hi3D advertises multi-GPU placement without implementing it
**Severity: High — resource-placement contract**

Evidence: [models.yaml](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/config/models.yaml) declares multi_gpu=true and accelerate_component_dispatch for Hi3D and its alias. [hi3d_adapter.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/hi3d_adapter.py) selects a single device and uses pipeline.to(device) or CPU-offload helpers; it does not call dispatch_pipeline_across_gpus or use planned gpu_ids for component placement.

Permanent fix: set multi_gpu=false and remove the unsupported strategy for both Hi3D entries unless real dispatch is implemented and tested. Add a ResourcePlanner contract test proving Hi3D cannot receive a multi-GPU plan. If dispatch is added later, verify components are actually placed on at least two reserved GPUs.

Acceptance: resource admission matches real adapter placement.

### F-03 — Hunyuan3D-Shape profile conflicts with manifest and docs
**Severity: High — profile/quality traceability**

Evidence: [hunyuan3d_shape_v21.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/hunyuan3d_shape_v21.py) currently locks octree_resolution=512, num_inference_steps=50, guidance_scale=7.5 and num_chunks=160000. [test_adapter_inference_profile_regressions.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/tests/test_adapter_inference_profile_regressions.py) asserts those values reach inference. But [models.yaml](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/config/models.yaml) comments describe 1300 / 100 steps / CFG 5.0; [ARCHITECTURE.md](https://github.com/Silentzx2/ForMesh3D/blob/dev/Docs/ARCHITECTURE.md) describes 1300 / 150 steps / CFG 5.0 / 80,000 chunks; [TASKS.md](https://github.com/Silentzx2/ForMesh3D/blob/dev/Docs/TASKS.md) records an earlier 1200 / 100-step change.

Permanent fix: do not change the adapter's locked profile casually. First choose the intended profile against quality and memory goals. Then align adapter, manifest comments/metadata, experimental settings, docs and tests. Preserve scheduler-side request filtering. Benchmark the selected profile on fixed reference images before claiming high detail or a safe GPU tier.

Acceptance: one effective profile across runtime/tests/docs; intended values remain distinct from measured quality and VRAM results.

### F-04 — Hunyuan3D-Shape forces full CUDA placement before dispatch/offload
**Severity: High — potential load-time OOM**

Evidence: [hunyuan3d_shape_v21.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/hunyuan3d_shape_v21.py) calls Hunyuan3DDiTFlowMatchingPipeline.from_pretrained with device=device, then pipeline_shapegen.to(device), and only afterward tries dispatch_pipeline_across_gpus. The single-GPU enable_model_cpu_offload path is also later. Full-device allocation can fail before lower-memory placement can help.

Permanent fix: let the resource plan decide initial placement. For multi-GPU plans, dispatch components before full-pipeline .to(cuda). For low-VRAM plans, use supported CPU/offload loading without first forcing every component onto CUDA. Fail cleanly on placement errors. Add call-order contract tests plus GPU smoke tests for offload and multi-GPU plans.

Acceptance: dispatch/offload is applied before full-device movement; failures leave the adapter unloaded/error rather than partially placed.

### F-05 — Hi3D “textured mesh” route returns untextured geometry
**Severity: Medium — capability/UI contract**

Evidence: hi3d_image_to_textured_mesh is registered in [model_factory.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/core/scheduler/model_factory.py) and [models.yaml](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/config/models.yaml), but texture_generation is false and the locked profile has apply_texture=false. [EXPERIMENTAL-MODEL-SETTINGS.md](https://github.com/Silentzx2/ForMesh3D/blob/dev/Docs/EXPERIMENTAL-MODEL-SETTINGS.md) documents that it exports untextured geometry, but the route name remains misleading.

Permanent fix: remove/disable/deprecate the alias from the active UI/API catalog, or route it through a real texture stage with verified texture artifacts. A GLB response does not prove texture exists.

Acceptance: route label, manifest capability and actual embedded texture agree.

### F-06 — Paint3D timeout/cancel does not reap the child process
**Severity: Medium — process/resource cleanup**

Evidence: [paint3d_adapter.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/paint3d_adapter.py), _execute_stage(), calls proc.kill() and immediately raises on cancellation/timeout. Normal proc.wait(timeout=5) occurs later and is bypassed. Pipe closure and reader-thread exit are not guaranteed on those error paths.

Permanent fix: wrap child lifecycle in try/finally. On cancel/timeout, terminate/kill, wait with a bound, escalate if necessary, wait again, close stdout and ensure the reader thread exits. Preserve cancellation status, bounded logs and exception cause. Test that processes are reaped and jobs reach correct terminal state.

Acceptance: no orphaned child or stuck reader after timeout, cancellation or reader error.

### F-07 — Paint3D LOADED status does not prove checkpoint readiness
**Severity: Medium — readiness/failure locality**

Evidence: Paint3D _load_model() checks CUDA, the source directory and imports both stage scripts, then sets ModelStatus.LOADED. Actual model stages run later in child processes; _resolve_checkpoints() can return remote Hugging Face repo IDs, and load preflight does not prove every checkpoint/config resolves. The first job may be where assets/dependencies fail.

Permanent fix: preserve lazy two-stage loading, but preflight required configs and local checkpoint completeness and identify local vs remote sources. If weights intentionally load inside child stages, expose a preflight-ready state instead of implying weights are loaded; preserve actionable child logs. Do not load all weights at startup just to relabel the state.

Acceptance: checkpoint failures are detected or attributed to the correct preflight/stage-load boundary.

### F-08 — Hunyuan background-remover fallback can hide degraded preprocessing
**Severity: Medium/Low — quality observability**

Evidence: [hunyuan3d_shape_v21.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/hunyuan3d_shape_v21.py) and [hunyuan3d_paint_v21.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/hunyuan3d_paint_v21.py) contain safe fallback paths, including identity-like behavior, after background-remover initialization fails. Job success alone does not show that background removal succeeded.

Permanent fix: record background_removal_backend, fallback state and sanitized reason in logs and generation metadata. Emit a warning. If clean foreground extraction is essential, fail fast or use an explicit strict mode. Test successful and fallback paths.

Acceptance: degraded preprocessing is visible without logging secrets.

### F-09 — VRAM reservations are not measured peak-memory guarantees
**Severity: Medium — deployment planning**

Evidence: [models.yaml](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/config/models.yaml) sets TRELLIS.2 23,552 MB (low-VRAM 10,240), Hunyuan Shape 10,240, Unique3D 10,240, Pixal3D 18,432 (low-VRAM 10,240) and Hi3D 16,384 (low-VRAM 8,192). Hunyuan Paint explicitly calls its 12,000 MB value a scheduler reservation, not a measured peak. Docs state CPU CI does not load production checkpoints or measure peak VRAM.

Permanent fix: benchmark real profiles and every stage on supported GPUs. Record free VRAM, peak allocated/reserved VRAM, process nvidia-smi peak, load/inference latency, dtype/device, repeat-run outcome and output validity. Derive reservations with a safety margin and test planner boundaries. Count aggregate VRAM only when components are actually dispatched.

Acceptance: every budget is labelled as measured peak, conservative reservation or offload threshold.

### F-10 — Unique3D SR fallback changes the quality path
**Severity: Low/Medium — output provenance**

Evidence: [unique3d_adapter.py](https://github.com/Silentzx2/ForMesh3D/blob/dev/backend/adapters/unique3d_adapter.py) falls back to Lanczos resizing when RealESRGAN ONNX is unavailable and records a diagnostic. This is resilient but not equivalent to learned SR.

Permanent fix: persist the chosen SR backend/reason in output provenance and logs. Make missing SR fatal only if the quality contract requires it. Test ONNX and fallback paths and verify checkpoint-download completeness.

Acceptance: output metadata clearly identifies RealESRGAN versus Lanczos.

## Model-by-model inference paths

| Model / route | Full path to exercise | Specific focus |
|---|---|---|
| TRELLIS.2 raw | trellis2_image_to_raw_mesh / trellis2_image_to_3d → Trellis2ImageToRawMeshAdapter → Trellis2Runner image pipeline → image_to_mesh(raw_mesh_only=True) → mesh save | CUDA/pre-Ampere attention, low-VRAM, pinned-source dtype and sparse guards, O-Voxel extraction, repeat-run cleanup and peak VRAM. |
| TRELLIS.2 paint | trellis2_image_mesh_painting / trellis2_paint → Trellis2ImageMeshPaintingAdapter → texturing pipeline → texture_mesh → export | Checkpoints, mesh/image validation, texture/material persistence, low-VRAM and exception cleanup. |
| Hunyuan Shape 2.1 | hunyuan3d_shape_v21_image_to_raw_mesh → Shape adapter → pipeline load → dispatch/offload → pipeline_shapegen → export | F-03 profile mismatch, F-04 load ordering, checkpoint resolution, conditioner dtype/device, Numba/torchvision, background fallback and peak VRAM. |
| Hunyuan Paint 2.1 | hunyuan3d_paint_v21_image_mesh_painting → paint pipeline + DINOv2/RealESRGAN assets → multiview/PBR stage → texture verification | 4K/8K contract (1K/2K must route to Paint3D), checkpoint completeness, component placement, PBR/atlas verification and fallback telemetry. |
| Hunyuan legacy paint | hunyuan3dv21_image_mesh_painting → legacy combined Shape/Paint adapter | Verify legacy compatibility with canonical split and output type. |
| TRELLIS paint | trellis_image_mesh_painting → TrellisImageMeshPaintingAdapter; trellis_text_mesh_painting → TrellisTextMeshPaintingAdapter | Mesh/text contract, checkpoints, GPU load, geometry/material integrity and texture persistence. |
| Paint3D | paint3d / paint3d_image_mesh_painting → preflight → isolated stage1 and stage2 subprocesses → textured output | F-06 process cleanup, F-07 readiness, child environment, timeout/cancel, 1K/2K UV output and geometry preservation. |
| Pixal3D | pixal3d_image_to_raw_mesh / pixal3d_image_to_3d → pipeline + DINOv3 conditioning → planned placement → inference → O-Voxel save | DINOv3/NAF availability, real component dispatch, 1536_cascade/2048 compatibility, low-VRAM and peak VRAM. |
| Unique3D | unique3d_image_to_raw_mesh → multiview diffusion → SR/normal prediction → reconstruction/refinement/color projection → GLB | Sequential GPU/CPU placement, shared pipeline cleanup, repeated jobs, low-VRAM, F-10 provenance and valid mesh. |
| Hi3D | hi3d_image_to_raw_mesh → Ampere+ gate → Sparc3DPipeline load → placement/offload → refinement → untextured export | F-01 seed, F-02 multi-GPU, F-05 texture alias, checkpoints/cache path, hardware gate, output validation and peak VRAM. |

Routing/source-of-truth files: backend/core/scheduler/model_factory.py, backend/config/models.yaml, backend/core/scheduler/resource_planner.py, backend/core/scheduler/multiprocess_scheduler.py and backend/api/routers/mesh_generation.py.

## Third-party pin and known regressions

The parent .gitmodules points backend/thirdparty to https://github.com/Silentzx2/ForMesh3D-ThirdParty, and dev records gitlink 2ff954dccd31f94eb4cc445535074abd01fa96ab. That commit includes:
- 2ff954d: TRELLIS.2 SparseTensor empty-coordinate guard and adaptive sparse-occupancy fallback.
- 5711f4d (ancestor): Hunyuan Shape conditioner CPU fallback and component offload.
- f8c8f3c (ancestor): TRELLIS.2 Hugging Face repo-id resolution when local checkpoint directory is absent.
- 04f3dd1 (ancestor): Hunyuan conditioner torchvision CPU transforms for T4/P100 compatibility.
- 56bf6bf (ancestor): TRELLIS.2 BFloat16/Float32 alignment.

Do not blindly update this gitlink to upstream main. Reproduce against the pinned source first. Parent test backend/tests/test_trellis2_dtype_regression.py covers static/CPU-oriented contracts, not real CUDA/O-Voxel inference.

## Documentation drift

- Docs/ARCHITECTURE.md and Docs/TASKS.md retain historical Hunyuan Shape values conflicting with current adapter/test profile.
- backend/config/models.yaml must not imply Shape uses 1300/100/5 while the active source-contract test verifies 512/50/7.5.
- RULES.md and Docs/GENERATION-UI-CONTRACT.md require caller-controlled seeds; Hi3D currently violates this.
- Docs/EXPERIMENTAL-MODEL-SETTINGS.md correctly says Hi3D's textured alias is untextured; the active route/catalog must be equally honest.
- Docs/ARCHITECTURE.md requires real component/layer placement for multi-GPU capability; Hi3D's manifest appears inconsistent.
- Docs/MEMORY.md describes strict Paint3D timeout/cancellation behavior; reconcile the implementation and tests after F-06.

## Instructions for the implementing AI agent

1. Start from dev SHA c8b3ab1bd82521b56380c5998a34784dff581803 and recursively initialize submodules. Confirm backend/thirdparty is exactly 2ff954dccd31f94eb4cc445535074abd01fa96ab. Read RULES.md, CONTRIBUTING.md and relevant sections of Docs/ARCHITECTURE.md, Docs/SYSTEM-BLUEPRINT.md, Docs/MEMORY.md, Docs/TASKS.md, Docs/DECISIONS.md, Docs/EXPERIMENTAL-MODEL-SETTINGS.md, Docs/GENERATION-UI-CONTRACT.md and Docs/GENERATION-CONTROL-AUDIT.md.
2. Reproduce static contracts first. Fix F-01, F-02, F-04, F-05, F-06, F-07 and fallback provenance with minimal diffs. For F-03, do not change the locked Shape profile until the intended values are explicitly selected; then align adapter/config/tests/docs.
3. Add behavior tests for seed preservation including zero, Hi3D multi-GPU planning, textured-route parity, Shape load/dispatch order, Paint3D process reaping on timeout/cancel, checkpoint/readiness behavior and Hunyuan fallback provenance.
4. Run these repository-prescribed checks:
   - PYTHONPATH=backend python -m pytest -q backend/tests backend/thirdparty/tests/test_runtime_path_utils.py
   - python3 -m compileall -q backend/
   - bash -n manager.sh backend/scripts/*.sh scripts/*.sh
   Include test_hi3d_adapter.py, test_adapter_inference_profile_regressions.py, test_config_ssot.py, test_huggingface_readonly_cache.py, test_idle_worker_eviction_and_vram.py, test_model_cache_and_lru_eviction.py, test_trellis2_dtype_regression.py and Unique3D safeguard/VRAM tests.
5. On supported GPU hardware with valid checkpoints, run cold load + full inference + repeat inference + unload/reload per model route with fixed reference images. Record checkpoint/source revision, GPU/compute capability, CUDA/PyTorch versions, effective dtype/device, load/inference latency, allocated/reserved/process peak VRAM, status/log paths, vertex/face counts, finite-geometry/topology checks and texture/material validation. Mark every test PASS, FAIL or NOT RUN.
6. Update relevant docs in the same change and review the diff. Do not push directly to protected dev; use a review branch/PR. Change the third-party repo only if a reproduced root cause is there, and keep the parent gitlink synchronized.

## Verification checklist

- [x] dev commit and parent submodule SHA identified via GitHub API.
- [x] README, RULES, CONTRIBUTING, architecture/blueprint/memory/task/decision/experimental docs, generation UI contract, control audit, manifest, routing, scheduler/resource planner, scoped adapters and relevant tests reviewed.
- [x] Static findings linked to evidence and permanent fixes.
- [ ] Local recursive clone: NOT RUN / blocked because the container could not resolve github.com.
- [ ] Automated tests: NOT RUN — no local checkout/runtime.
- [ ] Production checkpoint loading and end-to-end inference: NOT RUN — no target GPU/checkpoints.
- [ ] Measured peak VRAM and visual/texture A/B: NOT RUN — requires target hardware and weights.

**Conclusion:** this is an actionable static audit, not a claim that GPU inference has been exercised. Resolve the code/contract/cleanup defects, choose and reconcile the intended Hunyuan Shape profile, then complete model-by-model GPU acceptance before calling these paths runtime-verified.
