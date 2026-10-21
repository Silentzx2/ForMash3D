# TaoFlowForge Spike Report (Task 3A)

## Executive Summary
This report documents the spike investigation and subsequent **code-level integration** of **TaoFlowForge**, an artistic 3D foundation model developed by the Taobao3D Team at Alibaba Group, as a native clean-topology adapter in ForMash3D.

**Status:** **ADAPTER IMPLEMENTED & WIRED — NOT EVALUATED. Weights are downloadable via `manager.sh` / `backend/scripts/download_models.sh`; inference needs a GPU.**
**Conclusion:** "TaoFlowForge adapter (`TaoFlowForgeImageToRawMeshAdapter`) has been implemented and wired into the ForMash3D pipeline architecture. Checkpoint download tooling is integrated into `manager.sh` (option [17]) and `backend/scripts/download_models.sh -m taoflowforge` using ModelScope (`Taobao3D/TaoFlowForge`, ~26 GB across `stage0.pt`, `stage1.pt`, `stage2.pt`). Execution requires a dedicated CUDA GPU environment (>=20 GB VRAM as reserved in the model manifest) and sufficient disk space (>30 GB). When running in resource-constrained or CPU environments, the adapter safely raises a structured error or skips registration, allowing the planner to fall back to dense generation paired with isotropic retopology."

While the upstream research paper, inference code, and model checkpoints have been published (code Apache 2.0 on GitHub, weights on ModelScope), the model cannot be executed in the agent sandbox due to hardware and resource barriers (26.04 GB weights exceeding the 11 GB available sandbox disk space, strict CUDA 12.1 runtime requirement, >=20 GB VRAM requirement with no CPU fallback). Additionally, open upstream issue #9 indicates unresolved stability problems with Stage 2 conditioning and mesh shattering. Therefore, the native topology route remains safely protected by runtime capability gates, falling back to dense geometry models paired with feature-preserving isotropic retopology when GPU or weights are absent.

### Current status (re-verified against the repository)

The spike was a **code and integration investigation**. It did **not** produce a measured quality or topology result, and none exists in this repository:

- The adapter exists (`backend/adapters/taoflowforge_adapter.py`) and is registered in the model factory (`backend/core/scheduler/model_factory.py`) and the planner's adapter map (`backend/core/planner.py`).
- The model is **disabled by default**: `taoflowforge_image_to_raw_mesh` has `enabled: false` in `backend/config/models.yaml` (VRAM reservation 20480 MB), and `backend/config/planner_rules.yaml` marks it `requires_cuda: true` and `requires_license_optin: true`.
- TaoFlowForge is **absent from the output-preset catalogue** (`backend/config/smart_presets.yaml` and the `NATIVE_PRESET` model priority list in `backend/core/smart_presets.py`), so it is not selected by any preset. The only route to it is the planner's `native_clean` specialised route, which requires the adapter to be both enabled and license-opted-in.
- The adapter's locked inference profile is `fill_holes=true`, `offload="auto"`, `low_vram=false` (`backend/adapters/taoflowforge_adapter.py::_LOCKED_INFERENCE_PROFILE`).
- **No TaoFlowForge inference has been executed in this repository**, so no timing, VRAM, vertex/face count, topology-gate or feature-retention number may be quoted as a measurement. The evaluation checklist in §7 is still outstanding and must be run on a GPU host before the model is enabled.
- §5's "Local ForMash3D Environment" column describes the **spike-time agent sandbox**, not a property of the repository or of a deployed install.

---

## 1. Paper Status and Authors

- **Paper Title:** *TaoFlowForge: Progressive Native Mesh Generation via Cascaded Flow Matching*
- **Preprint Identifier:** [arXiv:2609.37139](https://arxiv.org/abs/2609.37139) (cross-referenced with project page and earlier preprint citation [arXiv:2507.16290](https://arxiv.org/abs/2507.16290) / *Dens3R*)
- **Project Page:** [https://alibaba.github.io/Taobao3D/blog/taoflowforge/](https://alibaba.github.io/Taobao3D/blog/taoflowforge/)
- **Authors:** Xianze Fang, Qiyuan Feng, Dongfang Sun, Yan Zhang, Xiuchao Wu, Jingnan Gao, Jiangjing Lyu, Chengfei Lyu, Gang Yu
- **Affiliation:** Taobao3D Team, Alibaba Group
- **Publication Date:** September 2026

---

## 2. Core Architecture & Methodology

TaoFlowForge proposes progressive native mesh generation directly from single images using cascaded flow matching, bypassing implicit representations (e.g., NeRF, 3D Gaussians, or Marching Cubes SDFs):

1. **Stage 0 — Coarse Occupancy Generation:**
   - Converts the conditioned input image into coarse occupied voxels on a $64^3$ grid using a flow-matching transformer.
2. **Stage 1 — Fine Vertex Generation:**
   - Employs a Level-Mixture-of-Experts (Level-MoE) transformer to progressively refine the coarse occupancy into surface vertices mapped onto a high-resolution $512^3$ spatial lattice.
   - Leverages Bernoulli statistics for data whitening and image embeddings (DINOv3-large backbone).
3. **Stage 2 — Topology Prediction & Repair:**
   - Estimates connectivity affinity between predicted vertices and decodes triangle faces.
   - Runs post-processing steps (hole filling and normal orientation correction using ray casting via Open3D or embreex).

---

## 3. Repository & Weights Availability

- **Code Repository:** Publicly available in the official Alibaba repository:
  - GitHub URL: [https://github.com/alibaba/Taobao3D/tree/main/TaoFlowForge](https://github.com/alibaba/Taobao3D/tree/main/TaoFlowForge)
  - Provides CLI (`taoflowforge.cli`), Python API (`taoflowforge.pipeline.TaoFlowForgePipeline`), and Gradio demo (`gradio_demo.py`).
  - A vendored copy of the upstream code is included in this repository at `backend/thirdparty/Taobao3D/TaoFlowForge`, and the adapter resolves it from there.
- **Model Checkpoints:** Hosted on ModelScope:
  - ModelScope Hub: [https://www.modelscope.cn/models/Taobao3D/TaoFlowForge/files](https://www.modelscope.cn/models/Taobao3D/TaoFlowForge/files)
  - Checkpoint Breakdown (as observed from the upstream ModelScope file listing during the spike):
    - `stage0.pt`: **5,465,726,007 bytes** (~5.47 GB)
    - `stage1.pt`: **14,543,370,128 bytes** (~14.54 GB)
    - `stage2.pt`: **6,025,399,063 bytes** (~6.03 GB)
    - **Total Weights Footprint:** **26,034,495,198 bytes (~26.04 GB)**
  - The repository itself only records the approximate total ("~26GB total: stage0.pt, stage1.pt, stage2.pt", `backend/scripts/download_models.sh`); the exact byte counts above come from the external ModelScope listing and cannot be reproduced from this repository.
  - External Dependencies: Requires downloading `dinov3-large` weights if not bundled within stage checkpoints.

---

## 4. Licensing Status

- **Code License:** Apache License 2.0 ([Alibaba Taobao3D LICENSE](https://github.com/alibaba/Taobao3D/blob/main/LICENSE)).
- **Weights License:** Apache License 2.0 (specified on ModelScope metadata card).
- **Commercial & Personal Use:** Permissive open-source license permitting personal and commercial use with attribution.
- **Licensing Constraint:** Licensing is permissive; however, local execution is blocked by hardware constraints.

---

## 5. Technical Requirements & Hardware Constraints

The "Spike-time sandbox" column records the agent sandbox in which the spike was performed. It is **not** a property of the repository or of a deployed install; the upstream requirements column is external documentation.

| Specification | Upstream Requirement | Spike-time sandbox | Status |
|---|---|---|---|
| **Python** | 3.10 | 3.10 / 3.14 | Compatible |
| **PyTorch** | 2.5.1 | Installed | Compatible |
| **CUDA / GPU** | CUDA 12.1 + NVIDIA GPU | CPU Only (no `nvidia-smi`) | **INCOMPATIBLE** |
| **VRAM Footprint** | Sequential offloading: ~20–24 GB; Full pipeline resident: >32 GB | 0 GB VRAM | **INCOMPATIBLE** |
| **Storage / Disk** | > 30 GB free for weights + cache | ~11 GB available on host filesystem | **INCOMPATIBLE** |
| **Auxiliary Libraries**| `open3d==0.19.0`, `embreex==4.4.0` | Not installed | Requires compilation |

The ForMash3D-side VRAM contract is the model manifest reservation of **20480 MB (20 GB)** in `backend/config/models.yaml`; the adapter's default is `vram_requirement=20480` when no manifest value is supplied. The upstream "~20–24 GB" figures are external and were not measured here.

### Key Execution Blockers:
1. **Host Disk Saturation:** Downloading the ~26 GB checkpoint files would immediately cause an `ENOSPC` disk exhaustion error on the spike sandbox (~11 GB free space).
2. **CUDA Hardware Dependency:** TaoFlowForge Stage 1 Level-MoE kernels and Stage 2 ray intersection algorithms strictly require CUDA execution; no CPU fallback exists in the official codebase. The adapter enforces this: `is_available()` returns `False` without CUDA and `_load_model()` raises `RuntimeError("TaoFlowForge requires CUDA; no GPU is available.")`.
3. **Extreme VRAM Threshold:** Even with offload enabled (loading and unloading models stage-by-stage, `offload="auto"`), Stage 1 alone is a large checkpoint with extensive activation memory at $512^3$ resolution, so a 24 GB-class GPU (RTX 3090/4090) or A100 is the practical target. This is an upstream sizing argument, not a ForMash3D measurement.

---

## 6. Architecture & Planner Impact

In accordance with `RULES.md` and `Docs/TASKS.md`:
1. **Adapter Implementation (`backend/adapters/taoflowforge_adapter.py`):**
   - The adapter `TaoFlowForgeImageToRawMeshAdapter` is implemented as an `ImageToRawMeshAdapter` subclass.
   - It manages the 3-stage cascaded flow matching pipeline (`stage0.pt`, `stage1.pt`, `stage2.pt`) loaded from `$PRETRAINED_DIR/Taobao3D/TaoFlowForge`.
   - Runtime safeguards verify CUDA availability and checkpoint presence before initialization: `is_available()` returns `False` when the third-party code, CUDA or any of the three stage checkpoints is missing, so the model is not offered as usable. If a request is nevertheless dispatched, `_load_model()` raises `FileNotFoundError` (missing checkpoints) or `RuntimeError` (no CUDA) and `_process_request()` surfaces it as a `RuntimeError` — a failed job is reported as failed, never as a silent success.
2. **Download & Management Script Integration:**
   - **`backend/scripts/download_models.sh`**: Supports `-m taoflowforge` to fetch `stage0.pt`, `stage1.pt`, and `stage2.pt` from ModelScope (`Taobao3D/TaoFlowForge`) with automatic directory verification.
   - **`manager.sh`**: Option `[17] TaoFlowForge - Progressive native mesh generation (Alibaba)` is available in the interactive model manager menu.
   - **`backend/scripts/install.sh`**: Installs TaoFlowForge thirdparty requirements from `backend/thirdparty/Taobao3D/TaoFlowForge/requirements.txt` with wheel index fallback.
3. **Planner Rules & Safe Fallback:**
   - `backend/config/planner_rules.yaml` defines `taoflowforge_image_to_raw_mesh` with `requires_cuda: true` and `requires_license_optin: true`. It does **not** define a `vram_budget_gb`; the planner derives the VRAM budget from the model manifest instead (`vram_requirement: 20480` MB in `backend/config/models.yaml`, i.e. ~20 GB).
   - `backend/core/planner.py` evaluates candidate adapters against `runtime["installed_adapters"]`, `runtime["enabled_adapters"]` and `runtime["license_optins"]`. If the adapter is unavailable or unverified, the planner gracefully falls back to dense generation candidates (`trellis2_image_to_raw_mesh` or `hunyuan3d_shape_v21_image_to_raw_mesh`) combined with feature-preserving isotropic retopology (`skip_retopo_allowed: false`).

---

## 7. User-Run Evaluation Checklist & Re-evaluation Triggers

This checklist is **still outstanding** — none of it has been executed in this repository, so no result may be reported from it yet. Before enabling TaoFlowForge, execute this verification checklist on a dedicated GPU host:
1. **Repository Setup:** Clone `https://github.com/alibaba/Taobao3D` and navigate to the `TaoFlowForge` directory.
2. **Storage Allocation:** Ensure target disk has $\ge 30\text{ GB}$ free space and download official stage checkpoints from ModelScope (`stage0.pt` ~5.5GB, `stage1.pt` ~14.5GB, `stage2.pt` ~6.0GB, total ~26 GB).
3. **Hardware Runtime:** Verify NVIDIA GPU with $\ge 24\text{ GB}$ VRAM (e.g. RTX 3090/4090 or A100) running PyTorch 2.4+ and CUDA 12.1. The ForMash3D manifest reserves 20480 MB for this model.
4. **Issue #9 Investigation:** Check upstream GitHub issue #9 status (conditioning image ignored in Stage 2, producing shattered output meshes). This is an external upstream issue; its status is not tracked in this repository.
5. **Execution Verification:** Run the official inference script on standard benchmark conditioning images.
6. **Topology Metrics Audit:** Pass the resulting raw meshes through ForMash3D's `compute_mesh_metrics` (`backend/core/quality/metrics.py`) and `evaluate_topology_gate` (`backend/postprocess/services/gate.py`). The gate thresholds are defined in `backend/config/quality.yaml` under `gate`: `max_non_manifold_edges: 0`, `max_non_manifold_vertices: 0`, `max_holes: 0`, `max_floater_ratio: 0.005`, `max_degenerate_faces: 0`, `min_aspect_ratio_p1: 0.05`, `min_aspect_ratio_p5: 0.1`.
7. **Adapter Gate:** Enable `taoflowforge_image_to_raw_mesh` (currently `enabled: false` in `backend/config/models.yaml`) only if:
   - Output meshes pass the topology gate (0 non-manifold edges, 0 non-manifold vertices, 0 holes, floater ratio ≤ 0.5%, 0 degenerate faces, aspect-ratio floors as configured).
   - Feature edge retention exceeds isotropic retopology baseline on mechanical test shapes.
   - Stage 2 conditioning is confirmed stable and faithful to input images.
