# TaoFlowForge Spike Report (Task 3A)

## Executive Summary
This report documents the spike investigation into **TaoFlowForge**, an artistic 3D foundation model developed by the Taobao3D Team at Alibaba Group, evaluated for potential integration as the native clean-topology adapter in ForMash3D.

**Status:** **NOT EVALUATED — needs GPU + 30 GB disk**
**Conclusion:** "NOT EVALUATED — TaoFlowForge code is published under Apache-2.0 and weights are hosted on ModelScope (~26 GB), but evaluation was blocked by local sandbox constraints (11 GB disk, no GPU). Furthermore, upstream issue #9 reports Stage 2 ignoring conditioning images and producing shattered output topology. The native topology route remains stubbed/disabled in planner rules."

While the upstream research paper, inference code, and model checkpoints have been published (code Apache 2.0 on GitHub, weights on ModelScope), the model cannot be executed in the agent sandbox due to hardware and resource barriers (26.04 GB weights exceeding the 11 GB available sandbox disk space, strict CUDA 12.1 runtime requirement, >=20–24 GB VRAM requirement with no CPU fallback). Additionally, open upstream issue #9 indicates unresolved stability problems with Stage 2 conditioning and mesh shattering. Therefore, the native topology route remains safely stubbed and disabled in planner rules (`backend/config/planner_rules.yaml` and `backend/core/planner.py`), with generation falling back to dense geometry models paired with feature-preserving isotropic retopology.

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
- **Model Checkpoints:** Hosted on ModelScope:
  - ModelScope Hub: [https://www.modelscope.cn/models/Taobao3D/TaoFlowForge/files](https://www.modelscope.cn/models/Taobao3D/TaoFlowForge/files)
  - Checkpoint Breakdown:
    - `stage0.pt`: **5,465,726,007 bytes** (~5.47 GB)
    - `stage1.pt`: **14,543,370,128 bytes** (~14.54 GB)
    - `stage2.pt`: **6,025,399,063 bytes** (~6.03 GB)
    - **Total Weights Footprint:** **26,034,495,198 bytes (~26.04 GB)**
  - External Dependencies: Requires downloading `dinov3-large` weights if not bundled within stage checkpoints.

---

## 4. Licensing Status

- **Code License:** Apache License 2.0 ([Alibaba Taobao3D LICENSE](https://github.com/alibaba/Taobao3D/blob/main/LICENSE)).
- **Weights License:** Apache License 2.0 (specified on ModelScope metadata card).
- **Commercial & Personal Use:** Permissive open-source license permitting personal and commercial use with attribution.
- **Licensing Constraint:** Licensing is permissive; however, local execution is blocked by hardware constraints.

---

## 5. Technical Requirements & Hardware Constraints

| Specification | Upstream Requirement | Local ForMash3D Environment | Status |
|---|---|---|---|
| **Python** | 3.10 | 3.10 / 3.14 | Compatible |
| **PyTorch** | 2.5.1 | Installed | Compatible |
| **CUDA / GPU** | CUDA 12.1 + NVIDIA GPU | CPU Only (no `nvidia-smi`) | **INCOMPATIBLE** |
| **VRAM Footprint** | Sequential offloading: ~20–24 GB; Full pipeline resident: >32 GB | 0 GB VRAM | **INCOMPATIBLE** |
| **Storage / Disk** | > 30 GB free for weights + cache | ~11 GB available on host filesystem | **INCOMPATIBLE** |
| **Auxiliary Libraries**| `open3d==0.19.0`, `embreex==4.4.0` | Not installed | Requires compilation |

### Key Execution Blockers:
1. **Host Disk Saturation:** Downloading the 26.04 GB checkpoint files would immediately cause an `ENOSPC` disk exhaustion error on the host container (~11 GB free space).
2. **CUDA Hardware Dependency:** TaoFlowForge Stage 1 Level-MoE kernels and Stage 2 ray intersection algorithms strictly require CUDA execution; no CPU fallback exists in the official codebase.
3. **Extreme VRAM Threshold:** Even with `--offload` enabled (loading and unloading models stage-by-stage), Stage 1 alone is a 14.54 GB checkpoint with extensive activation memory at $512^3$ resolution, exceeding typical consumer GPUs and requiring at least an RTX 3090 / 4090 (24 GB) or A100.

---

## 6. Architecture & Planner Impact

In accordance with `RULES.md` and `Docs/TASKS.md`:
1. **Stubbed Configuration Retained:**
   `backend/config/planner_rules.yaml` retains the specification entry for `taoflowforge_image_to_raw_mesh` marked with:
   - `adapter_class: "TaoFlowForgeImageToRawMeshAdapter"`
   - `requires_cuda: true`
   - `requires_license_optin: true`
   - `vram_budget_gb: 16.0`
2. **Planner Safe Fallback:**
   `backend/core/planner.py` evaluates candidate adapters against `runtime["installed_adapters"]` and `runtime["enabled_adapters"]`. Because `TaoFlowForgeImageToRawMeshAdapter` is not registered in `installed_adapters`, the planner safely skips it:
   ```
   Candidate 'taoflowforge_image_to_raw_mesh' is not installed/registered.
   Preferred candidate 'taoflowforge_image_to_raw_mesh' unavailable.
   ```
   The planner gracefully falls back to dense generation candidates (`trellis2_image_to_raw_mesh` or `hunyuan3d_shape_v21_image_to_raw_mesh`) combined with feature-preserving isotropic retopology (`skip_retopo_allowed: false`).
3. **No Unnecessary Dependencies Added:**
   In line with YAGNI and the ponytail philosophy, no deadweight adapter stub or non-functional multi-gigabyte download routines were added to the runtime.

---

## 7. User-Run Evaluation Checklist & Re-evaluation Triggers

Before enabling or building an adapter for TaoFlowForge, execute this verification checklist on a dedicated GPU host:
1. **Repository Setup:** Clone `https://github.com/alibaba/Taobao3D` and navigate to the `TaoFlowForge` directory.
2. **Storage Allocation:** Ensure target disk has $\ge 30\text{ GB}$ free space and download official stage checkpoints from ModelScope (`stage0.pt` ~5.5GB, `stage1.pt` ~14.5GB, `stage2.pt` ~6.0GB, total 26.04 GB).
3. **Hardware Runtime:** Verify NVIDIA GPU with $\ge 24\text{ GB}$ VRAM (e.g. RTX 3090/4090 or A100) running PyTorch 2.4+ and CUDA 12.1.
4. **Issue #9 Investigation:** Check upstream GitHub issue #9 status (conditioning image ignored in Stage 2, producing shattered output meshes).
5. **Execution Verification:** Run the official inference script on standard benchmark conditioning images.
6. **Topology Metrics Audit:** Pass the resulting raw meshes through ForMash3D's `compute_mesh_metrics` and `evaluate_topology_gate`.
7. **Adapter Gate:** Enable `taoflowforge_image_to_raw_mesh` in planner rules only if:
   - Output meshes pass the topology gate (0 non-manifold edges, 0 boundary holes, floater ratio < 0.5%).
   - Feature edge retention exceeds isotropic retopology baseline on mechanical test shapes.
   - Stage 2 conditioning is confirmed stable and faithful to input images.
