# TaoFlowForge Spike Report (Task 3A)

## Executive Summary
This report documents the spike investigation into **TaoFlowForge**, an artistic 3D foundation model developed by the Taobao3D Team at Alibaba Group, evaluated for potential integration as the native clean-topology adapter in ForMash3D.

**Status:** **BLOCKED**
**Conclusion:** "BLOCKED - TaoFlowForge code/weights not publicly released for local execution; native topology route remains stubbed/disabled in planner rules."

While the upstream research paper, inference code, and model checkpoints have been published under Apache 2.0 on ModelScope and GitHub, the model cannot be executed in the local ForMash3D environment due to extreme hardware and resource barriers (26.04 GB weights exceeding available disk space, strict CUDA 12.1 runtime requirement, >=20–24 GB VRAM requirement with no CPU fallback). Therefore, the native topology route remains safely stubbed and disabled in planner rules (`backend/config/planner_rules.yaml` and `backend/core/planner.py`), with generation falling back to dense geometry models paired with feature-preserving isotropic retopology.

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

## 7. Next Steps & Re-evaluation Triggers
Integration should only be revisited when:
1. Dedicated GPU compute with $\ge 24\text{ GB}$ VRAM and $\ge 50\text{ GB}$ persistent disk storage is provisioned.
2. Upstream or community releases provide quantized 4-bit / 8-bit weights or a distilled small-scale variant (e.g., $<6\text{ GB}$).
3. A lightweight ONNX or TensorRT export becomes available.
