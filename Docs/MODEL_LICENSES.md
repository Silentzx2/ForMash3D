# Third-Party Model Licenses & Attribution Notices

> **Important Legal Disclaimer**:  
> ForMash 3D is an open-source project licensed under the **Apache License 2.0**. However, ForMash 3D incorporates, references, and interfaces with various third-party generative 3D models, neural architectures, and research codebases.  
> **ForMash 3D does NOT claim ownership or authorship of any third-party model architectures, source code, pretrained weights, training datasets, or external services.** All third-party software, model checkpoints, and datasets remain subject to their respective upstream licenses, terms of use, and redistribution conditions.

---

## Overview

In machine learning and neural 3D generation, the **code license** (e.g., MIT, Apache-2.0) often differs from the **model weight license** (which may be research-only, non-commercial, or subject to specific community terms). 

Before deploying any model commercially or redistributing model weights, you must verify the specific license conditions set by the original authors and institutions.

---

## Third-Party Model Catalog & Licensing Matrix

| Model | Primary Research Author / Institution | Upstream Repository | Code License | Checkpoint / Weight License | Commercial Use Permitted? |
|---|---|---|---|---|---|
|---|---|---|---|---|---|
| **TRELLIS** | Microsoft / Jeffrey Xiang | [microsoft/TRELLIS](https://github.com/microsoft/TRELLIS) | MIT | Research / Non-Commercial (Hugging Face) | Check upstream license |
| **TRELLIS.2** | Jeffrey Xiang | [JeffreyXiang/TRELLIS.2](https://github.com/JeffreyXiang/TRELLIS.2) | MIT / Apache-2.0 | Research / Community | Check upstream license |
| **Hunyuan3D-Shape-v2-1** | Tencent Hunyuan Team | [Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Tencent Hunyuan Community License | Tencent Hunyuan Terms | Conditional (Requires agreement to Tencent terms) |
| **Hunyuan3D-Paint-v2-1** | Tencent Hunyuan Team | [Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Tencent Hunyuan Community License | Tencent Hunyuan Terms | Conditional |
| **Hunyuan3D-DiT-v2-mini-Turbo** | Tencent Hunyuan Team | [Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | Tencent Hunyuan Community License | Tencent Hunyuan Terms | Conditional |
| **TripoSR** | VAST-AI Research & Stability AI | [VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR) | MIT | MIT / Stability AI Terms | Yes (Subject to MIT & Stability AI terms) |
| **TripoSG** | VAST-AI Research | [VAST-AI-Research/TripoSG](https://github.com/VAST-AI-Research/TripoSG) | Apache-2.0 / MIT | Research / Gated HF Checkpoint | Check upstream model card |
| **TripoSF** | VAST-AI Research (SparseFlex VAE) | [VAST-AI-Research/TripoSF](https://github.com/VAST-AI-Research/TripoSF) | Apache-2.0 / MIT | Research Checkpoint | Check upstream model card |
| **UniRig** | VAST-AI Research | [VAST-AI-Research/UniRig](https://github.com/VAST-AI-Research/UniRig) | Apache-2.0 / MIT | Research / Open Weights | Check upstream repository |
| **FastMesh** (V1K/V4K) | FastMesh Authors | [FastMesh3D/FastMesh](https://github.com/FastMesh3D/FastMesh) | Academic / Research | Research Only | Non-commercial / Research |
| **PartField** | NVIDIA Research (nv-tlabs) | [nv-tlabs/PartField](https://github.com/nv-tlabs/PartField) | MIT / Research | NVIDIA Research License | Academic / Research only |
| **PartPacker** | NVIDIA Research (NVlabs) | [NVlabs/PartPacker](https://github.com/NVlabs/PartPacker) | NVIDIA Source Code License | Research / Non-Commercial | Non-commercial only |
| **PartUV** | GAP-LAB (CUHK Shenzhen) | [GAP-LAB-CUHK-SZ/PartUV](https://github.com/GAP-LAB-CUHK-SZ/PartUV) | Academic / Research | Research Checkpoint | Academic / Research only |
| **UltraShape-1.0** | Peking University (PKU-YuanGroup) | [PKU-YuanGroup/UltraShape-1.0](https://github.com/PKU-YuanGroup/UltraShape-1.0) | Academic / Research | Research Checkpoint | Academic / Research only |
| **VoxHammer** | VoxHammer Authors | [FishWoWater/VoxHammer](https://github.com/FishWoWater/VoxHammer) | Open Research | Research Checkpoint | Check upstream terms |
| **ARDY** | NVIDIA Research (NVlabs) | [NVlabs/ardy](https://github.com/NVlabs/ardy) | CC-BY-NC-SA / Research | Research Checkpoint | Non-commercial only |
| **P3-SAM** | OpenRobotLab | [OpenRobotLab/P3-SAM](https://github.com/OpenRobotLab/P3-SAM) | Apache-2.0 | Open Weights | Check upstream terms |

---

## Detailed Model Notes & Upstream Provenance

### 1. TRELLIS & TRELLIS.2
- **Authors**: Jeffrey Xiang, Microsoft Research
- **Inference Location**: `backend/adapters/trellis_adapter.py`, `backend/adapters/trellis2_adapter.py`
- **Repository Location**: `backend/thirdparty/TRELLIS`, `backend/thirdparty/TRELLIS.2`
- **Integration Note**: Utilizes integration forks maintained by FishWoWater (`FishWoWater/TRELLIS`) adapted for headless API service execution.
- **License**: Code is MIT. Pretrained checkpoints from Hugging Face (`JeffreyXiang/TRELLIS-image-large`) must be reviewed for commercial redistribution rules.

### 2. Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, and Hunyuan3D-DiT-v2-mini-Turbo
- **Authors**: Tencent Hunyuan Team
- **Inference Location**: `backend/adapters/hunyuan3d_shape_v21.py`, `backend/adapters/hunyuan3d_dit_v2_mini_turbo.py`
- **Repository Location**: `backend/thirdparty/hunyuan3d-shape-v2-1`, `backend/thirdparty/hunyuan3d-paint-v2-1`, `backend/thirdparty/hunyuan3d-dit-v2-mini-turbo`
- **License**: Distributed under the Tencent Hunyuan Community License. Requires acceptance of Tencent terms for commercial products with active user thresholds. Gated weights on Hugging Face (`tencent/Hunyuan3D-2.1`, `tencent/Hunyuan3D-2mini`).

### 3. TripoSR, TripoSG, TripoSF
- **Authors**: VAST-AI Research, Stability AI
- **Inference Location**: `backend/adapters/triposr_adapter.py`, `backend/adapters/triposg_adapter.py`, `backend/adapters/triposf_adapter.py`
- **Repository Location**: `backend/thirdparty/TripoSR`, `backend/thirdparty/TripoSG`, `backend/thirdparty/TripoSF`
- **Identity Notice**: `TripoSR`, `TripoSG`, and `TripoSF` are upstream technical model identifiers created by VAST-AI Research. They are not ForMash 3D brands or trademarks.
- **License**: TripoSR code is MIT. TripoSG and TripoSF check upstream Hugging Face model cards for weight licensing.

### 4. PartPacker, PartField, ARDY (NVIDIA Research)
- **Authors**: NVIDIA Research
- **Repository Location**: `backend/thirdparty/PartPacker`, `backend/thirdparty/PartField`, `backend/thirdparty/ardy`
- **License**: NVIDIA research licenses are typically restricted to non-commercial, academic research, and personal evaluation. Commercial deployment requires prior permission from NVIDIA.

### 5. UniRig
- **Authors**: VAST-AI Research
- **Inference Location**: `backend/adapters/unirig_adapter.py`
- **Repository Location**: `backend/thirdparty/UniRig`
- **License**: Apache-2.0 / MIT. Automated armature generation for bipedal 3D meshes.

### 6. PartUV & UltraShape
- **Authors**: CUHK Shenzhen (PartUV), PKU-YuanGroup (UltraShape)
- **Repository Location**: `backend/thirdparty/PartUV`, `backend/thirdparty/UltraShape`
- **License**: Academic research and evaluation licenses.

---

## Checkpoint Downloads & User Responsibilities

1. **No Checkpoint Redistribution in Git**: ForMash 3D does not bundle heavy model weights directly in this Git repository. Weights are downloaded separately via `backend/scripts/download_models.sh` or automated Hugging Face caching at runtime.
2. **Acceptance of Upstream Terms**: By downloading and running specific models (such as gated models requiring `HF_TOKEN`), you agree to comply with each model creator's terms of service and license agreement.
3. **Attribution Requirement**: When using assets generated by any of these models in downstream projects or research, please cite the corresponding academic paper and original authors.
