# Current Task — Deep Adapter Parity & Source-Fidelity Audit

**Status:** Complete in code and documentation; runtime-gated validation remains open  
**Date:** 2026-10-03  
**Branch:** `Dev`

## Objective
Re-audit the raw/model-native generation contract after the official-parity quality pass, close remaining gaps that can alter `master/source.glb`, and reconcile project documentation.

## Confirmed closures
- [x] Scheduler strips production-only target/decimation/remesh controls before adapter inference.
- [x] Legacy Hunyuan3D-2.1 raw generation uses seeded 50-step / 5.0-guidance inference without low-VRAM step reduction.
- [x] Legacy Hunyuan3D-2.1 Shape→Paint uses the same source shape contract.
- [x] TRELLIS source texture schema uses 2048 and metadata reports actual sampling stages.
- [x] TRELLIS source texture generation no longer follows a lower UI quality profile.
- [x] TRELLIS.2 source texture generation is fixed to 4096.
- [x] PartPacker documentation matches executable defaults.

## Regression coverage
- [x] Firewall test passes explicit extraction/decimation/remesh controls and asserts they are stripped.
- [x] Legacy Hunyuan contract and implementation checks added.
- [x] TRELLIS source texture/runtime metadata assertions added.
- [x] Frontend source-texture fidelity assertions added.

## Documentation
- [x] MEMORY.md
- [x] ARCHITECTURE.md
- [x] PRD.md
- [x] DESIGN.md
- [x] DECISIONS.md
- [x] SYSTEM-BLUEPRINT.md
- [x] BUG-REPORT-ADAPTER-QUALITY.md
- [x] CHANGELOG.md
- [x] README.md

## Runtime gate
- [ ] CUDA/NVIDIA A/B generation with identical inputs, weights, and seeds.
- [ ] Compare raw face count, silhouette, small-feature retention, normals, orientation, and UV/material state before downstream processing.
