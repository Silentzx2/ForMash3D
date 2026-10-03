# Current Task — Adapter Raw-Quality / Official-Parity Fix

**Status:** Complete in code and documentation  
**Date:** 2026-10-03  
**Branch:** `Dev`

## Objective

Fix the quality gap observed in immutable `source.glb` outputs compared with upstream model examples. The scope is raw model generation and adapter/extraction behavior; downstream post-processing is not treated as the root cause.

## Root causes and fixes

- [x] Replace the project-wide 75-step generation contract with model-specific official/tuned schedules.
- [x] Fix TripoSR raw extraction to the current official 320 ceiling.
- [x] Raise TripoSF raw extraction to 1024³ + 1,638,400 samples, while retaining the existing VRAM safety guard.
- [x] Pass deterministic seeded generators to Hunyuan Shape and Mini Turbo.
- [x] Remove TRELLIS text's artificial 20-step minimum.
- [x] Restore TRELLIS extraction hole filling and Z-up → Y-up conversion.
- [x] Apply Mini Turbo FlashVDM through the official pipeline configuration method.
- [x] Keep unsupported TripoSG rotation/Flash-Decoder changes out of the code.

## Contract

- [x] Source geometry is generated using model-specific quality settings.
- [x] Production polycount remains downstream-only.
- [x] `source.glb` remains the immutable model-native checkpoint.
- [x] Hardware safety caps may reduce raw extraction only when required for safe execution.

## Regression coverage

- [x] Updated TripoSR, TripoSF, and Mini Turbo adapter schema expectations.
- [x] Added a TRELLIS text adapter contract test.
- [x] Added frontend assertions for model-specific schedules and extraction ceilings.
- [x] Retained scheduler/source-quality firewall assertions.

## Documentation

- [x] Added `Docs/BUG-REPORT-ADAPTER-QUALITY.md`.
- [x] Updated `Docs/MEMORY.md`.
- [x] Updated `Docs/ARCHITECTURE.md` and `Docs/PRD.md`.
- [x] Updated `Docs/CHANGELOG.md`.

## Runtime gate

- [ ] CUDA/NVIDIA A/B generation with identical inputs, weights, and seeds.
- [ ] Compare raw face count, silhouette, small-feature retention, normals, orientation, and UV/material state before downstream processing.

The remaining runtime items are intentionally not marked complete because GPU execution was unavailable during this audit.
