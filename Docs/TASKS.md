# Current Task — Source-Fidelity Contract Verification (Bug-Report vs Code)

**Status:** Complete  
**Date:** 2026-10-04  
**Branch:** `Dev`

## Objective
Re-verify BUG-REPORT-ADAPTER-QUALITY.md (BQ-01..BQ-12), the Docs/TASK.md bug registry, and all project docs against the current code, and fix the remaining gaps. Test scripts are verification aids, not the source of truth; the bug report, ADRs, and adapters are authoritative.

## Verified correct in code
- [x] Model-specific frontend schedules: Mini Turbo 5, TRELLIS image 12 / text 25, Hunyuan Shape / legacy 2.1 / TripoSG / UltraShape 50.
- [x] Raw extraction ceilings: TripoSR fixed 320; TripoSF 1024³ + 1,638,400 samples with the VRAM safety downshift preserved.
- [x] Seeded `torch.Generator` in Hunyuan Shape, Mini Turbo, and legacy Hunyuan3D-2.1; Mini Turbo applies FlashVDM through the official pipeline method.
- [x] TRELLIS extraction: `fill_holes=True`, `forward_rot=True`, `simplify=0.0`; source texture fixed 2048, TRELLIS.2 fixed 4096.
- [x] Scheduler firewall strips faces/num_faces/simplify/decimation_target/remesh/remesh_band/remesh_project before adapter inference.
- [x] Legacy Hunyuan3D-2.1 raw and Shape→Paint share seeded 50-step / 5.0-guidance source generation without low-VRAM step reduction.
- [x] TRELLIS/TRELLIS.2 output paths use `OutputPathGenerator`; pipeline.py defers directory creation to first write; `load_mesh()` flattens scenes via `scene_to_mesh()`.
- [x] Alpha validity checks in Hunyuan Shape / Mini Turbo / legacy 2.1 / TripoSR; TripoSG via upstream `prepare_image`; strict CoACD collision; TRELLIS.2 `o_voxel` gate; TripoSR truthful bake reporting; Paint reference aspect-ratio letterbox.

## Gaps found & fixed
- [x] TRELLIS image-path `generation_info` did not record the actual sampling stages (BQ-11 drift vs the text path) — now records ss/slat steps, guidance, texture resolution, bake mode, and simplify ratio.
- [x] Stale official-parity assertion: TRELLIS image `texture_resolution` schema default 1024 → 2048.
- [x] Docs/TASK.md still recorded the TripoSG Y-up rotation (BUG-004) as implemented — updated to reverted/rejected per the 2026-10-03 parity audit.
- [x] TripoSR docstring listed `mc_resolution` "default: 256" — corrected to fixed 320 (official UI ceiling).

## Verification
- [x] Backend pytest: 0 failures (3 runtime-gated skips).
- [x] `npx tsc --noEmit` clean.

## Runtime gate
- [ ] CUDA/NVIDIA A/B generation with identical inputs, weights, and seeds.
