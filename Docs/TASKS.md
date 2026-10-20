# Task Status Register — ForMash3D

This document maintains the verified task status register across all batches (1, 2, 3, and 4). Every item reflects the verified ground truth in the codebase and test suite.

| Task ID | Component / Description | Status | Commit / Ref | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **1A** | 14-metric calculation (`compute_mesh_metrics`) & master immutability audit | **COMPLETED** | `4b60098f`, `4B/truth` | Implemented in `backend/core/quality/metrics.py`; verified non-mutating copy audit. |
| **1B** | Input image preprocessing module | **COMPLETED (DEDUPLICATED)** | `9767e466` | Redundant `image_prep.py` deleted; routed through existing `image_enhancement.py::preprocess_image` when `apply.input_prep` is enabled. |
| **1C** | Hunyuan3D presets & targeted boundary-loop hole repair | **COMPLETED** | `4b60098f`, `9767e466` | `repair_holes_targeted` closes $\le 50$-vertex holes without full remesh; presets consolidated into `quality.yaml`. |
| **1C.1** | Hunyuan3D smoothness vs TRELLIS.2 ratio evaluation | **PENDING USER GPU RUN** | `scripts/run_final_parity_benchmark.py` | Benchmark CLI supports ratio evaluation; pending live execution: `python scripts/run_final_parity_benchmark.py --images <dir> --api http://localhost:7842`. |
| **1D** | Best-of-N composite candidate seed scorer | **COMPLETED** | `4b60098f`, `9767e466` | `score_seed_candidate` and `select_best_candidate` wired into `multiprocess_scheduler.py` via `_score_and_select()`. Early stopping at 0.85. |
| **1E** | Runtime hardware probe & rule-based planner v0 | **COMPLETED** | `4b60098f`, `9767e466` | `probe_runtime` returns 12 hardware keys; `plan_generation` routes deterministically and queries `models.yaml` for VRAM and capabilities. |
| **2A** | Pre-repair Topology Gate | **COMPLETED** | `603373fa`, `9767e466` | `evaluate_topology_gate` in `backend/postprocess/services/gate.py` runs before repair; routes to `skip_repair`, `minimal_repair`, or `full_repair`. |
| **2B** | Memory-safe feature-aware decimation | **COMPLETED** | `603373fa`, `9767e466` | `memory_safe_decimate` protects against host OOM on $>2\text{M}$ face meshes using psutil monitoring and 35° crease preservation. |
| **2C** | Normal detail bake from master & PBR validation | **COMPLETED** | `603373fa`, `9767e466` | High-to-low bake captures detail from immutable `master/source.glb`; `validate_pbr_asset` verifies OpenGL Y+ convention, packed RMA, and UVs. |
| **2D** | UV backend resolver & unwrap driver | **COMPLETED** | `603373fa`, `9767e466` | `resolve_uv_backend` routes meshes $>500\text{k}$ tris to PartUV if CUDA/VRAM permits, else xatlas directly on NumPy buffers. |
| **2E** | Postprocess pipeline integration | **COMPLETED** | `603373fa`, `9767e466` | Wired in `backend/postprocess/pipeline.py`; SHA-256 byte-for-byte immutability of `master/source.glb` enforced. |
| **3A** | TaoFlowForge adapter & pipeline wiring | **COMPLETED** | `backend/adapters/taoflowforge_adapter.py`, `Docs/taoflowforge_spike_report.md` | Native clean-topology adapter implemented and registered in SSOT; download and install automation added to `manager.sh` and scripts; GPU checklist documented. |
| **3B** | Planner v1 rules & API request wiring | **COMPLETED** | `0a2e7fd3`, `9767e466` | Request schemas accept `mesh_style`, `requested_quality`, `object_type`, `symmetry`; attached `plan` consumed by downstream stages. |
| **3C** | Quality badge & frontend selectors | **COMPLETED** | `0a2e7fd3`, `9767e466` | `GeneratePanel.tsx` displays QualityBadge using backend-computed `quality_tier` (`sharp`, `clean`, `needs_review`) and configuration cutoffs. |
| **3D** | Final benchmark & parity scorecard | **COMPLETED** | `4ec9017d` | Synthetic smoke test generates `Docs/baseline_vs_now_benchmark.json`; CLI extended with `--dry-run`, `--images`, `--api`, and `--competitor-dir`. |
| **3E** | Documentation synchronization | **COMPLETED** | `Docs/` | Architecture, memory, changelog, and README kept strictly in sync with ground truth. |
| **3F** | Quad-dominant export evaluation | **COMPLETED** | `Docs/quad_topology_evaluation.md` | Report evaluated FastMesh and QuadriFlow options against glTF limits. |
| **4A** | SSOT consolidation & pipeline wiring | **COMPLETED** | `68752f47`, `9767e466` | Consolidated 5 YAMLs into `quality.yaml`, removed numeric `DEFAULT` dicts, wired planner execution switches, candidate scoring, and bake options. |
| **4B** | Truth & real measurement | **COMPLETED** | `4ec9017d` | Rewrote `parity_scorecard.json` for sourced/null metrics only, extended benchmark with dry-run and competitor measuring, corrected TaoFlowForge report. |
| **4C** | Documentation truth, cleanup & ADRs | **COMPLETED** | `4C/cleanup-docs` | Replaced TASKS.md with verified status register, added ADR-085/086/087, cleaned deliverables, restored experimental model settings doc. |
