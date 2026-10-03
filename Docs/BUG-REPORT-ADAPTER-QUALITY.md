# Adapter Raw-Quality Parity Audit — 2026-10-03

**Branch:** `Dev`  
**Scope:** Raw/model-native generation quality only. This audit is separate from downstream retopology, polycount, LOD, UV, collision, and game-ready processing.

## Executive finding

The primary confirmed root cause was an **incorrect global inference contract**: ForMash3D was sending a generic 75-step generation configuration into models tuned for different official schedules. Several adapters consumed or clamped those values, so the neural generation path no longer matched the upstream demo path.

A second class of defects came from adapter/extraction parity drift: TripoSR was requested above the current official UI extraction ceiling, TripoSF was below its high-density extraction path, Hunyuan raw adapters did not pass an explicit seed generator, and the TRELLIS adapter disabled extraction-time hole filling and the upstream orientation conversion.

## Confirmed bugs

| ID | Severity | Root cause | Fix |
|---|---|---|---|
| BQ-01 | Critical | Global 75-step contract was reused across models whose official/tuned schedules are 5, 12, 25, or 50. | Model-specific frontend schedules: Mini Turbo 5; TRELLIS image 12; TRELLIS text 25; Hunyuan Shape/UltraShape/TripoSG 50. |
| BQ-02 | High | TripoSR requested 512 marching-cubes resolution although the current official UI supports up to 320. | Raw extraction is fixed to 320. |
| BQ-03 | High | TripoSF requested 512³ although the adapter supports 1024³ and the high-density path uses 1,638,400 samples. | Raw extraction starts at 1024³ + 1,638,400 samples; the existing VRAM guard can still downshift safely. |
| BQ-04 | Medium | Hunyuan Shape and Mini Turbo did not pass an explicit `torch.Generator`. | Both now pass deterministic seeded generators. |
| BQ-05 | High | TRELLIS raw extraction disabled hole filling when simplification was off. | Hole filling is always enabled for model extraction; simplification remains disabled for immutable raw source. |
| BQ-06 | High | TRELLIS text sampling had an artificial minimum of 20; generic 75 steps became 50. | Artificial floor removed; frontend uses the upstream 25-step text schedule. |
| BQ-07 | Medium | Mini Turbo exposed `enable_flashvdm` but never applied it. Tencent exposes FlashVDM as a pipeline configuration method / launch option. | Adapter now applies the official pipeline method; frontend enables it for Mini Turbo. |
| BQ-08 | Medium | TRELLIS extraction passed `forward_rot=False`, disabling its upstream Z-up → Y-up conversion. | Extraction now uses `forward_rot=True`. |

## Rejected false positives

The following earlier suggestions were checked and intentionally **not** changed:

- **TripoSG Y-up rotation:** no extra rotation was added; current upstream integration does not support the proposed additional transform.
- **TripoSG Flash Decoder should be disabled:** rejected; current TripoSG pipeline defaults `use_flash_decoder=True`, and its official inference script omits the argument.
- **TripoSR foreground ratio 0.85 is wrong:** rejected as a global bug; the current official UI uses 0.85, while 0.9 is used only by a convenience example path.

## Adapter parity rule

```
Model-specific UI contract
        ↓
scheduler removes post-process-only controls
        ↓
adapter preprocessing
        ↓
official model pipeline
        ↓
supported high-fidelity extraction
        ↓
immutable master/source.glb
```

An adapter must not replace a model's quality-critical official parameter with a generic project-wide value without an explicit compatibility reason.

## TRELLIS comparison note

The upstream TRELLIS downloadable GLB is not a raw mesh dump: its `to_glb()` path performs mesh post-processing, hole filling, UV parametrization, multiview texture baking, and orientation conversion. Therefore a visual comparison must distinguish the neural model output from the upstream demo's extracted GLB.

## Validation status

Source-level parity review and regression-test updates were completed. CUDA/NVIDIA generation and visual A/B renders were not available in this environment, so this task does not claim runtime visual validation.


## Deep audit closure — 2026-10-03
| ID | Severity | Gap | Closure |
|---|---|---|---|
| BQ-09 | Critical | Scheduler firewall missed adapter-level source reduction controls. | Added faces/num_faces/simplify/decimation_target/remesh* to the centralized firewall. |
| BQ-10 | High | Legacy Hunyuan3D-2.1 could lower steps under low_vram and ignored explicit seed/guidance. | Raw and Shape→Paint now share seeded 50-step / 7.5-guidance generation. |
| BQ-11 | Medium | TRELLIS schema default and response metadata drifted from runtime behavior. | Schema uses 2048 source texture and metadata records actual sampling stages. |
| BQ-12 | High | TRELLIS source texture inherited a lower UI quality profile. | Source texture is fixed to 2048; TRELLIS.2 source texture is fixed to 4096. |

Static contracts cover these closures. Earlier speculative TripoSG rotation/Flash-Decoder/foreground-ratio changes remain rejected. CUDA/NVIDIA A/B visual validation is still required.
