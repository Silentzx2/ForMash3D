# Experimental Model Settings — Maximum Detail

**Research snapshot:** 2026-10-20  
**Scope:** `EXPERIMENTAL_MAX_DETAIL` — a backend snapshot of adapter-owned inference profiles, **not** a user-facing preset  
**Status:** Active experimental defaults in the adapters today; no inference-quality win is claimed until the user compares generated assets.

## Where these settings live

The numbers below are **adapter-owned**. Each adapter holds a `_LOCKED_INFERENCE_PROFILE` dict and merges it into the request inside its own `_process_request` (`backend/adapters/*.py`); the adapter's profile therefore wins over anything a client sends.

The scheduler enforces that ownership in `backend/core/scheduler/multiprocess_scheduler.py`: `_build_model_inference_inputs()` drops the post-process-only keys (`_POSTPROCESS_ONLY_INPUTS`) and, for the model IDs listed in `_ADAPTER_OWNED_INFERENCE_PROFILE_MODEL_IDS`, drops adapter-owned inference keys (including the alternate `steps` control and model-side `texture_size`) as well, then forces `source_quality="max"`. What remains (image path, seed, output format, …) is forwarded to the adapter, which applies its own locked profile on top. Nested sampler-profile dictionaries are copied per request so downstream consumers cannot mutate the module-level profile for later generations.

There is **no "Max Detail" (or experimental max-detail) toggle in the UI**, and the Generate panel exposes **no inference controls at all** — the user-selectable controls are the model engine, the texture toggle and atlas size, the post-processing toggle, the output preset, the polycount budget and the seed, and only `seed` is forwarded as a model parameter (`features/workspace/utils/buildGenerationParameters.ts`). The experiment is a backend snapshot, so an "A/B review" means generating with the snapshot and comparing the results against reference outputs; there is no switch to flip.

The output presets themselves are a separate concern: `backend/config/smart_presets.yaml` is the source of truth for the preset catalogue, and the frontend keeps a minimal fallback table in `constants/smartPresetFallback.json` guarded by `backend/tests/test_smart_preset_parity.py`.

## Locked change-control policy

These are intentional limit-crossing stress-test settings. OOM, artifacts, crashes, or worse geometry are acceptable test outcomes; the user will lower settings after reviewing results. Keep the raw master mesh un-decimated where the adapter supports it; production budgets belong on derived copies.

**Before changing any setting listed here in a later task, ask the user once, present the proposed changes together, and wait for explicit confirmation.** Do not ask separately model by model. Do not edit the locked profile while waiting. If an option is not supported by the adapter/checkpoint, explain that boundary instead of inventing or silently substituting a parameter.

This is a repository engineering rule documented for contributors and agents; it is not an automated runtime approval gate.

## How to interpret evidence

- **Official-supported maximum/default:** exposed or documented by the upstream model project.
- **Community experiment:** reported by an individual in an issue/discussion. It is a candidate configuration, not a maintainer-approved universal optimum.
- **Adapter-owned profile:** the value that actually reaches the model, taken from the adapter's `_LOCKED_INFERENCE_PROFILE`. Request-side copies of the same key are stripped by the scheduler, so the effective value is the adapter's value.
- **Project max-detail profile:** existing ForMash3D extraction/default choices, sometimes with resource-dependent guards. A requested value does not prove the same effective value was used; inspect generation telemetry.
- No full GPU inference/A-B benchmark was run as part of this settings-only change. Validate output detail, silhouette, holes, thin features, artifacts, texture sharpness and runtime on the user's hardware.

## Active profiles

| Model / workflow | Active experimental settings | Evidence and limits |
|---|---|---|
| **Hunyuan3D-Shape-v2.1** | `octree_resolution=1300`, `num_inference_steps=150`, `guidance_scale=5.0`, `num_chunks=80000`, `mc_algo=mc`, `source_quality=max`; dense marching cubes, no source decimation | The upstream demo exposes up to 100 steps, caps octree at 512, and uses guidance 5.0. The active ForMash3D request (150 steps / octree 1300) deliberately exceeds both upstream UI declarations. This is a stress-test request with elevated OOM/crash risk, not a supported limit or measured quality improvement. |
| **Legacy Hunyuan3D-2.1 aliases** | `octree_resolution=512`, `num_inference_steps=100`, `guidance_scale=5.0`, `source_quality=max` | The legacy alias adapter (`backend/adapters/hunyuan3d_adapter_v21.py`) keeps the upstream step ceiling and CFG default and the 512-octree UI cap. The 1300/150 stress-test values belong to the Hunyuan3D-Shape-v2.1 adapter only. |
| **Hunyuan3D-DiT-v2-Mini-Turbo** | `octree_resolution=768`, `num_inference_steps=20`, `guidance_scale=7.5`, `num_chunks=80000`, `mc_algo=mc`, `low_vram=false`, `low_vram_mode=false`, `enable_flashvdm=false` | The adapter warns when the octree resolution exceeds the trained 380 and refuses `enable_flashvdm=True` because the raw-source fidelity profile uses the native dense decoder. 768 octree / 20 steps therefore exceed the distilled 5-step, 380-octree trained recipe; this is an experimental stress-test profile, not a verified checkpoint-safe setting. |
| **TripoSG** | `num_inference_steps=100`, `guidance_scale=9.0`, `flash_octree_depth=10`, `dense_octree_depth=10`, `hierarchical_octree_depth=11`, `use_flash_decoder=false` | Steps/guidance match the upstream defaults; depth 10/11 is ForMash3D's high-detail extraction profile. Existing adapter VRAM gating can lower the effective hierarchical depth. The UI request and the achieved depth must not be confused. There is no `faces` key: the face budget is a post-process-only setting and the scheduler keeps it out of inference. |
| **Unique3D** | `seed=1145`, `input_processing=true`, `do_refine=true`, `expansion_weight=0.1`, `init_type=std`, `low_vram=false` | Keep supported project/upstream parameters. The integrated adapter does not expose inference-step or CFG controls; no community step/guidance setting is invented. |
| **Pixal3D** | `resolution=2048`, `pipeline_type=1536_cascade`, `low_vram=false`; sparse `steps=100 / guidance_strength=10.0 / guidance_rescale=0.9 / rescale_t=8.0`; shape `100 / 10.0 / 0.8 / 8.0`; texture `100 / 3.5 / 0.5 / 8.0` | 1536 is Pixal3D's official standard mode. Sampler numbers are adapted from the TRELLIS.2 community issue #92 because the integrated implementation uses the same staged sampler parameter shape; they have **not** been benchmarked directly on Pixal3D. Keep this caveat visible. |
| **TRELLIS (image/text geometry and supported painting paths)** | Locked profile requests `num_inference_steps=100`, `ss_sampling_steps=100`, `slat_sampling_steps=100`, shared `guidance_scale=7.5`, `simplify=0.0`, `low_vram=false`; default texture size 2048 | The adapter clamps the effective sparse and SLAT call arguments to 50 (`max(1, min(50, requested_steps))`), even though the adapter-owned request profile keeps 100. The UI exposes separate sparse/SLAT guidance while this adapter retains one shared guidance field, and the locked profile cannot express the official separate CFG values. Do not confuse configured versus effective values; the active 50-step cap is not evidence of a runtime A/B quality win. |
| **TRELLIS.2 (raw/image geometry aliases)** | `1536_cascade`, `max_num_tokens=524288`, `low_vram=false`; sparse: `steps=100, guidance_strength=10.0, guidance_rescale=0.9, rescale_t=8.0`; shape: `100, 10.0, 0.8, 8.0`; texture: `100, 3.5, 0.5, 8.0`; `decimation_target=-1`, `remesh=false`, model-side `texture_size=4096`; downstream production atlas resolution remains a separate setting | These are active ForMash3D stress-test requests, not a verified upstream optimum. They exceed the official UI's 50-step declaration; `-1` keeps the raw master un-decimated. GPU memory and output quality need hardware-backed checks. |
| **Hunyuan3D-Paint-v2.1** | `max_num_view=9`, per-view inference `resolution=768`; preserve 4K/8K texture atlas selection | The adapter's locked profile uses 9 views and 768 per-view inference resolution, matching the upstream demo's 6–9 views and 512/768 per-view range. Nine is also the adapter's schema default. More views cost time/memory and are not guaranteed to improve every image. |
| **Paint3D** | Four generated child-config passes: stage-1 `txt2img=40 / CFG 7.0`, stage-1 `inpaint=40 / CFG 3.0`, stage-2 UV `inpaint=40 / CFG 3.0`, stage-2 UV `img2img=40 / CFG 7.0`; atlas 1024/2048 | Values are read from `_generate_configs()` in `backend/adapters/paint3d_adapter.py`. The per-job stage YAML, not the comment name “two-stage,” is the ground truth. Atlas output remains limited to 1K/2K. |
| **FastMesh V1K / V4K** | Use the respective fixed V1K (about 1k vertices) and V4K (about 4k vertices) variants | This is learned retopology with fixed checkpoint targets, not a diffusion sampler. No supported CFG/step control is exposed; do not invent one or silently relabel the output as raw source geometry. Note that the adapter's `poly_type="quad"` route calls `MeshProcessor.tri2quad()`, which imports the unbundled `meshiki` package and therefore fails in a standard install. |
| **PartUV** | Adapter default `distortion_threshold=2.5`; ABF, 5 iterations, PAMO defaults where the installed upstream config applies | `backend/adapters/partuv_adapter.py` uses 2.5 as its adapter default; the bundled upstream PartUV config (`backend/thirdparty/PartUV/config/config.yaml`) uses `threshold: 1.25`, so 2.5 is the project's adapter value, not a verified upstream default. Higher thresholds allow more distortion in exchange for faster work/fewer charts. The adapter currently exposes only the distortion threshold; other upstream config options are not being newly injected. |
| **UniRig** | Keep supported `skeleton`, `skin`, `full` modes; optionally seed the generation | No comparable CFG/denoising-step controls are exposed by the adapter. Upstream warns that skinning can degrade when the predicted skeleton is inaccurate and recommends refining it before skinning. |
| **ARDY Core / G1** | Keep currently supported checkpoints and their trained FPS/horizon variants; current default is Core RP 20 FPS / Horizon 40 | Upstream CLI documents CFG weights `[2.0, 2.0]`, but ForMash3D's current adapter does not pass a configurable `cfg_weight`; don't imply that a config-only edit would change it. No unsupported newer checkpoint is enabled by this settings task. |
| **Mesh segmentation** | No profile | The manifest has no active segmentation adapter; no model settings are fabricated. |

## Sources checked

### Official model controls / docs

- [Hunyuan3D-2.1 Gradio settings](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/gradio_app.py): steps up to 100, octree up to 512, guidance default 5.0; Mini Turbo uses a 5-step schedule.
- [Hunyuan3D-Paint demo](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/hy3dpaint/demo.py): demo profile uses 6 views / 512 and notes 6–9 views and 512/768 resolution.
- [Hunyuan3D-Paint README](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/hy3dpaint/README.md): documents the supported view range and 512/768 per-view resolutions. The adapter's locked profile uses 9 views / 768.
- [TRELLIS UI](https://github.com/microsoft/TRELLIS/blob/main/app.py): official stage-specific guidance controls and maximum 50-step range.
- [TRELLIS.2 UI](https://github.com/microsoft/TRELLIS.2/blob/main/app.py): official independent sparse/shape/texture samplers, guidance rescale, rescale-t and 1536 cascade options.
- [Pixal3D current upstream repository](https://github.com/Ardynai/pixal3d): standard resolution 1536, low-VRAM mode defaults to 1024.
- [TripoSG official inference utilities](https://github.com/VAST-AI-Research/TripoSG/blob/main/triposg/inference_utils.py): documented dense/hierarchical octree extraction.
- [PartUV configuration reference](https://github.com/EricWang12/PartUV/blob/main/doc/config.md): distortion threshold, ABF iterations, PAMO and thread/stream defaults.
- [UniRig repository](https://github.com/VAST-AI-Research/UniRig): seed option and skeleton-refinement guidance.
- [ARDY generator CLI](https://github.com/nv-tlabs/ardy/blob/main/scripts/generate.py): default CFG weights `[2.0, 2.0]`.

### Community experiment / report

- [TRELLIS.2 issue #92 — quality-first configuration experiment](https://github.com/microsoft/TRELLIS.2/issues/92), opened 2026-01-16; the values above are an individual contributor's experiment, not an official default or a proven universal optimum.
- [Community Hunyuan3D-2.1 workflow discussion](https://www.reddit.com/r/StableDiffusion/comments/1ojcfti/your_hunyuan_3d_21_preferred_workflow_settings/): anecdotal report of testing 100 steps and higher octree values with OOM as resolution increased. Values above the official 512-octree ceiling are used by the Hunyuan3D-Shape-v2.1 adapter's stress-test profile and are not upstream-supported limits.

## User review checklist

For each model compare the existing/reference output with this experimental profile using the same input, seed when supported, preprocessing and export settings. Review silhouette/input resemblance, fine features, sharp edges, holes, topology, surface artifacts, actual/effective extraction resolution, texture seams/sharpness, runtime and memory. Promote or revise a profile only after the user has reviewed these comparisons and explicitly approved any later setting change.

Because the Generate panel exposes no inference controls, the comparison is made by generating with the current adapter profile and keeping the outputs as the new reference; a later profile change is a code change in the adapter, gated by the change-control policy above.
