# Architecture — ForMash 3D

> **Architecture Version**: 0.1.0 (FastAPI + Next.js 16)
> **Last Verified**: October 3, 2026
> **Target Environments**: Linux (Ubuntu 20.04/22.04/24.04), Cloud GPU / Local Workstations

---

## 1. Architectural Mission & Overview

ForMash 3D is an end-to-end generative 3D asset pipeline. The system is architected around a clean separation of concerns:

- **Presentation Layer**: Next.js 16 frontend with interactive Three.js 3D viewport, studio workspace tooling, and model management.
- **API Gateway**: FastAPI backend (Python 3.10, Conda env `3daigc-api`) with VRAM-aware multiprocess scheduler, request validation, rate limiting, and authorized artifact delivery.
- **Model Adapters**: Python adapters for each AI model (TRELLIS, Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, Hunyuan3D-DiT-v2-mini-Turbo, PartPacker, UltraShape, PartField, UniRig, TripoSR, TripoSG, TripoSF, ARDY, FastMesh, VoxHammer). The Paint-v2-1 pipeline supports Shape→Paint automatic chaining with configurable texture resolution (512/768), max view counts (6-12), PBR state tracking, and VRAM-aware scheduling.
- **Scheduler**: VRAM-aware scheduler with GPU monitoring, model-input sanitization, and optional Redis multi-worker queue.

### Model-Native Source Fidelity Contract
- Each generation model keeps its own tuned inference schedule; the frontend does not use a project-wide step count.
- The scheduler strips downstream-only target/decimation/remesh controls before adapter inference.
- Raw extraction ceilings remain model-specific; only explicit hardware safety guards may lower them.
- Source texture profiles are explicit: TRELLIS 2048 and TRELLIS.2 4096. Production quality/poly budgets stay downstream.
- master/source.glb is immutable; retopology, UV, LOD, collision, and bake operations act on derived artifacts.

```mermaid
flowchart TB
    %% Sleek Studio Palette
    classDef gold fill:#1a1915,stroke:#ffcc00,stroke-width:2px,color:#ffcc00;
    classDef cyan fill:#0f1d24,stroke:#06b6d4,stroke-width:2px,color:#67e8f9;
    classDef purple fill:#191326,stroke:#a855f7,stroke-width:2px,color:#d8b4fe;
    classDef green fill:#0d2018,stroke:#10b981,stroke-width:2px,color:#6ee7b7;
    classDef orange fill:#24160c,stroke:#f97316,stroke-width:2px,color:#fdba74;
    classDef slate fill:#14171f,stroke:#475569,stroke-width:1.5px,color:#e2e8f0;

    subgraph LAYER["🌐 Studio Frontend Layer (Next.js 16)"]
        direction TB
        NEXT["Next.js 16 Studio :3000<br/>React 19 + TypeScript"]:::gold
        VPORT["3D Viewport<br/>Three.js / React Three Fiber"]:::gold
        CONTROLS["Studio Panels<br/>Gen · Retopo · UV · Texture · Rig"]:::gold
    end

    subgraph GW["⚡ API Gateway Layer (FastAPI)"]
        direction TB
        API["FastAPI Gateway :7842<br/>Routers + CORS + Rate Limiter"]:::cyan
        ROUTERS["API Routers<br/>/v1/system · /v1/mesh-generation<br/>/v1/mesh-retopology · /v1/auto-rigging<br/>/v1/mesh-uv-unwrapping · /v1/jobs"]:::cyan
        STATIC["Authorized Artifact Delivery<br/>Manifest + Download API"]:::cyan
    end

    subgraph SCHEDULER["🛡️ Hardware & Scheduling Layer"]
        direction TB
        SCHED["VRAM-Aware Scheduler<br/>GPU Mutual Exclusion"]:::orange
        GPU_MON["Hardware Telemetry<br/>VRAM / Temp Polling"]:::orange
        VRAM_BUF["Safety Margin Buffer<br/>1024 MB Headroom Margin"]:::orange
        REDIS["Redis 7 Queue :6379<br/>Multi-Worker Mode"]:::orange
    end

    subgraph CORE["🧠 Model Execution Layer (23 Adapters)"]
        direction TB
        SHAPE["Shape Generation<br/>TRELLIS · Hunyuan3D-2.1<br/>TripoSR · TripoSG · TripoSF"]:::purple
        PAINT["Texture Synthesis<br/>Hunyuan3D-Paint 2B<br/>RealESRGAN x4+ PBR"]:::purple
        STRUCT["Structure & Motion<br/>FastMesh (V1K/V4K) · PartPacker<br/>UniRig · ARDY · VoxHammer"]:::purple
    end

    subgraph POST["⚙️ Production Post-Processing Core"]
        direction TB
        SRC_CHECK["master/source.glb<br/>Immutable Master Checkpoint"]:::green
        REPAIR["Watertight Repair<br/>Boundary Component Guard"]:::green
        SIMPLIFY["PyMeshLab Decimation<br/>Texture Preservation Fallback"]:::green
        FINISH["LOD0-LOD3 Cascades<br/>CoACD Physics & QA 0-100"]:::green
    end

    subgraph DATA["📦 Canonical Storage Layer"]
        direction TB
        LOCAL["Asset Workspace<br/>backend/storage/models/meshes/<asset>_<job_id>/"]:::slate
        ZIP["Engine-Ready Delivery<br/>Unreal Engine 5 · Unity · Godot 4"]:::slate
    end

    LAYER -->|"REST + mesh-tool SSE"| GW
    API --> ROUTERS
    ROUTERS --> SCHEDULER
    SCHEDULER --> CORE
    CORE -->|"Raw Model Output"| SRC_CHECK
    SRC_CHECK --> POST
    POST --> LOCAL
    LOCAL --> ZIP
    LOCAL -->|"Authorized artifacts"| STATIC
    STATIC -->|"View / Download"| VPORT
```

---

## 2. Component Layers

### 2.1 Presentation Layer (Next.js 16)

| Component | Path | Description |
|---|---|---|
| **App Router** | `app/` | Next.js 16 App Router with server components, layouts, and API proxy routes |
| **Workspace Shell** | `features/workspace/WorkspaceShell.tsx` | Main workspace UI with tabbed panels and model viewport |
| **API Client** | `services/apiClient.ts` | Unified axios client for all FastAPI backend REST/SSE communication |
| **3D Canvas** | `features/workspace/Viewport/MeshViewer.tsx` | Three.js WebGL viewport with orbit controls, wireframe/matcap shading, physics smoke test, and opt-in mirror inspection |
| **State Stores** | `stores/` | Zustand stores for global client state (`useAppStore`, `useViewerStore`, `useAnimationStore`, `useRiggingStore`, `useUIStore`) |
| **Data Fetching** | hooks + TanStack Query | Server-state caching and synchronization for job status |
| **Icon System** | `@hugeicons/react` + `@hugeicons/core-free-icons` | Primary icon library; replaces `lucide-react`. Mapping documented in `components/icons/hugeicons-mapping.ts` |

### ADR-009: Hugeicons as Frontend Icon Library
**Decision**: Migrate frontend icon system from `lucide-react` to Hugeicons.
**Reason**: Consistent icon weight, broader free icon set, no external font dependency, and first-class React tree-shaking.
**Scope**: 75+ files migrated including all `components/ui/*`, `features/workspace/**`, `features/admin/**`, and `features/settings/**`.

### 2.2 API Gateway Layer (FastAPI)

Located at `backend/api/`:
- **Entry Points**: `main_singleworker.py` (embedded scheduler) and `main_multiworker.py` (Redis queue). Python 3.10 via Conda env `3daigc-api`.
- **API Routers**: REST controllers for system info, file upload, mesh generation/editing, auto-rigging, segmentation, retopology, UV unwrapping, and user management.
- **Configuration** (`backend/core/config.py`): Pydantic V2 settings loaded from `.env` and YAML config files (`system.yaml`, `models.yaml`).
- **Static File Server**: Optimized binary streaming for 3D formats (`.glb`, `.gltf`, `.fbx`, `.obj`, `.stl`) with cache headers.
- **Auth Service** (`backend/core/auth/`): Optional Redis-based authentication controlled by `P3D_USER_AUTH_ENABLED`.

### 2.3 Model Execution Layer

| Component | Path | Description |
|---|---|---|
| **Scheduler Factory** | `backend/core/scheduler/scheduler_factory.py` | Creates dev/prod scheduler instances |
| **Multiprocess Scheduler** | `backend/core/scheduler/multiprocess_scheduler.py` | VRAM-aware scheduler with GPU mutual exclusion |
| **GPU Monitor** | `backend/core/scheduler/gpu_monitor.py` | Real-time VRAM and temperature polling |
| **Job Queue** | `backend/core/scheduler/job_queue.py` | Job request models and types |
| **Redis Job Queue** | `backend/core/scheduler/redis_job_queue.py` | Redis-backed distributed job queue (multi-worker with bounded 20-connection pool) |
| **Model Adapters** | `backend/adapters/` | Python inference adapters (TRELLIS, Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, Hunyuan3D-DiT-v2-mini-Turbo, PartPacker, UltraShape, PartField, UniRig, TripoSR, TripoSG, TripoSF, ARDY, FastMesh, VoxHammer, Zero123PlusAdapter). All raw outputs route through `OutputPathGenerator` into canonical storage (`backend/storage/models/meshes/`). Camera-aligned model handling is model-specific; TripoSR is normalized for the viewer, while no extra TripoSG rotation is injected beyond its upstream integration. Zero123++ is isolated under `image_to_multiview` for novel viewpoint synthesis. |
| **Paint-v2-1 Pipeline** | `backend/adapters/hunyuan3d_paint_v21.py` | Hunyuan3D-Paint-v2-1 adapter with RealESRGAN x4+ super-resolution, DifferentiableRenderer for PBR validation, VRAM status tracking, and Shape→Paint automatic chaining support |
| **Multi-View Router** | `backend/api/routers/multiview.py` | Dedicated API router for Zero123++ view generation, manual view sets, ZIP export, and capability-gated `/reconstruct-3d` |

### 2.4 Storage Layer

Located at `backend/storage/`:
- **Uploads** (`uploads/`): User-uploaded reference images (`.png`, `.jpg`, `.webp`).
- **Models** (`models/meshes/<asset_name>_<job_id>/`): Canonical per-generation mesh asset workspaces.
- **Asset workspace**: `master/` (`source.glb` immutable master), `game_ready/` (engine-optimized final output), `lods/` (LOD0..3), `collision/` (CoACD convex decomposition derived from final `game_ready.glb`), `textures/`, `previews/`, `multiview/` (6 novel views, `manifest.json`, optional `masks/`, optional `normals/`), and `metadata/` (`quality_report.json`, `asset.json`, `physics.json`). Directory creation is deferred until writing begins.
- **ZIP delivery**: Generated on demand from the canonical workspace; no persistent `exports/` tree is required. Multi-view packages derive directly as `<original_stem>.zip`.

### 2.5 Local Wheelhouse

Prebuilt wheels are cached at `backend/thirdparty/wheels/` (inside the main ForMash3D repository). The `download_and_install_release_wheels()` function in `scripts/setup.sh` fetches all `.whl` files from the `ForMash3D/releases/tag/Wheels` GitHub Release and installs them. The install script (`backend/scripts/install.sh`) uses `--find-links="$WHEEL_DIR"` to prefer local prebuilt wheels when installing dependencies, falling back to PyPI/index/Git when no compatible wheel exists. Wheels are automatically downloaded from the ForMash3D GitHub Release at runtime into `backend/thirdparty/wheels/`.

---

## 3. Performance Optimizations

| Optimization | Target Layer | Mechanism | Impact |
|---|---|---|---|
| **GPU Mutual Exclusion** | Scheduler | Strict process locking | Prevents GPU OOM during concurrent inference |
| **GPU Monitoring** | Scheduler | Real-time VRAM/temperature polling | Dynamic scheduling decisions |
| **VRAM Safety Buffer** | Scheduler | `VRAM_SAFETY_MARGIN_MB=1024` | Ensures 1GB free margin after each job |
| **Auto Unload** | Scheduler | `AUTO_UNLOAD_AFTER_JOB=true` | Frees VRAM between jobs |
| **Connection Reuse** | Frontend | Axios singleton (`services/apiClient.ts`) | Eliminates per-request overhead |
| **SSE Streaming** | API Gateway | Server-Sent Events for progress | Real-time feedback without polling |
| **Tensor Core Acceleration** | Backend | `torch.backends.cuda.matmul.allow_tf32 = True` | 3x-8x matmul speedup on Ampere/Ada/Hopper |
| **Inference Mode** | Backend | `torch.inference_mode()` | Eliminates autograd graph tracking overhead |
| **ORJSON Serialization** | Backend | `ORJSONResponse` with fallback | 10x-20x faster JSON serialization |
| **GZip Compression** | Backend | `GZipMiddleware(minimum_size=1000)` | 75-85% response size reduction |
| **Browser Caching** | Backend | `Cache-Control` headers | Reduces repeated asset downloads |
| **Code-Splitting** | Frontend | `next/dynamic` with skeleton fallbacks | Reduced initial bundle size |
| **Font Optimization** | Frontend | `next/font/google` with `display: 'swap'` | Eliminates CLS and render blocking |

---

## 4. End-to-End Generation Request Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as Next.js 16 Frontend
    participant API as FastAPI Router (:7842)
    participant SCHED as VRAM-Aware Scheduler
    participant Adapter as Model Adapter
    participant PostProcess as Production Post-Processing
    participant Storage as backend/storage/

    User->>Frontend: Select prompt / image + production triangle budget
    Frontend->>API: POST /api/v1/mesh-generation/text-to-textured-mesh
    API->>SCHED: Submit job (VRAM-aware)
    SCHED->>Adapter: Run maximum-fidelity model inference; strip production-only budget flags
    Adapter-->>SCHED: Raw model-native mesh output
    SCHED->>Storage: Preserve master/source.glb byte-for-byte
    SCHED->>PostProcess: Repair -> conditional Retopo -> apply target polycount -> Auto UV/Preserve -> QA
    PostProcess->>Storage: Save game_ready/* final formats
    PostProcess->>Storage: Save lods/lod0..3.glb
    PostProcess->>Storage: Save collision/collision.glb
    PostProcess->>Storage: Save textures/, previews/, metadata/quality_report.json
    SCHED-->>API: Job complete
    API-->>Frontend: Return {job_id, status: "completed", outputs}
    Frontend->>User: Render 3D model in WebGL Viewport
```

---

## 5. Storage Directory Organization

```mermaid
flowchart LR
    classDef dir fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff
    classDef file fill:#0f172a,stroke:#64748b,stroke-width:1px,color:#cbd5e1

    ROOT["backend/storage/"]:::dir --> UPLOADS["uploads/<br/>Reference Images"]:::dir
    ROOT --> MODELS["models/meshes/<asset_name>_<job_id>/<br/>Canonical Asset Workspace"]:::dir
    ROOT --> THUMBS["thumbnails/<br/>Preview PNGs"]:::dir
    ROOT --> DELIVERY["On-demand ZIP delivery"]:::dir

    MODELS --> SRC["source.glb<br/>Untouched Master"]:::file
    MODELS --> GAME["game_ready.glb<br/>Engine-Optimized"]:::file
    MODELS --> LODS["lods/<br/>lod0–lod3.glb"]:::dir
    MODELS --> COL["collision.glb<br/>Convex Hull"]:::file
    MODELS --> QA["quality_report.json<br/>QA 0-100 Score"]:::file

    UPLOADS --> IMG["*.png *.jpg *.webp"]:::file
    DELIVERY --> ZIP["Project_Export_[job_id].zip"]:::file

    style ROOT fill:#0f172a
```

---

## 6. Service Lifecycle Management

### 6.1 Installation (`backend/scripts/install.sh`)

The install script creates the Conda env `3daigc-api` (Python 3.10) and installs:
- PyTorch 2.6.0 + CUDA 12.4 (from `https://download.pytorch.org/whl/cu124`)
- All thirdparty model dependencies (TRELLIS.2, PartField, Hunyuan3D-Shape-v2-1, Hunyuan3D-Paint-v2-1, Hunyuan3D-DiT-v2-mini-Turbo, UniRig, PartPacker, PartUV, P3-SAM, FastMesh, UltraShape, VoxHammer)
- Main project dependencies (from `backend/requirements.txt`)
- System packages (`libsm6`, `libegl1`, `libgl1-mesa-dev`)
- RealESRGAN_x4plus.pth for Hunyuan3D-Paint-v2-1 super-resolution
- DifferentiableRenderer native modules for Hunyuan3D-Paint-v2-1 PBR validation

Build isolation is disabled globally (`PIP_NO_BUILD_ISOLATION=1`, `UV_NO_BUILD_ISOLATION=1`) — required for building flash-attn, nvdiffrast, nvdiffrec, CuMesh, FlexGEMM, o-voxel, cubvh, and bpy-renderer.

### 6.2 Startup (`scripts/start.sh` / `manager.sh`)

```mermaid
flowchart LR
    classDef step fill:#1e293b,stroke:#8b5cf6,stroke-width:2px,color:#fff
    classDef service fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#fff

    A["scripts/start.sh<br/>Launcher"]:::step --> B{"Single or<br/>Multi-Worker?"}:::step
    B -->|Single| C["Uvicorn<br/>main_singleworker:app<br/>:7842"]:::service
    B -->|Multi| D["Redis Server<br/>:6379"]:::service
    D --> E["Scheduler Service<br/>python scheduler_service.py"]:::service
    E --> F["Uvicorn Workers x4<br/>main_multiworker:app<br/>:7842"]:::service
    C --> G["Next.js Dev Server<br/>:3000"]:::service
    F --> G

    style A fill:#1e293b,stroke:#8b5cf6
    style B fill:#1e293b,stroke:#f59e0b
```

**Single-Worker Mode** (default):
```bash
cd backend && conda activate 3daigc-api
uvicorn api.main_singleworker:app --workers 1 --port 7842
```

**Multi-Worker Mode** (Redis Queue):
```bash
redis-server
conda activate 3daigc-api
python backend/scripts/scheduler_service.py
cd backend && conda activate 3daigc-api
uvicorn api.main_multiworker:app --workers 4 --port 7842
```

### 6.3 Shutdown (`scripts/stop.sh`)
- Gracefully terminates Next.js, Uvicorn, and Redis processes.
- Releases TCP ports 3000, 7842, and 6379.
- Cleans up stale PID files.

---

## 7. API Endpoints

### System & Health
- `GET /health`: Health check with timestamp and status.
- `GET /api/v1/system/health`: Extended system health.
- `GET /api/v1/system/info`: Host hardware specs, OS, RAM, GPU telemetry.
- `GET /api/v1/system/models`: Model registry with VRAM budgets and weights status.
- `GET /api/v1/system/jobs/history`: Job history with search and status filtering.

### File Upload & Storage
- `POST /api/v1/file-upload/image`: Upload reference image.
- `POST /api/v1/file-upload/mesh`: Upload base mesh for post-processing.
- `GET /api/v1/file-upload/download/{file_id}`: Stream stored file.

### Mesh Generation & Processing
- `POST /api/v1/mesh-generation/image-to-raw-mesh`: Geometry synthesis from image.
- `POST /api/v1/mesh-generation/image-to-textured-mesh`: Full PBR geometry + texture from models that natively implement the feature.
- Hunyuan3D Shape→Paint: Shape-v2-1 or DiT-v2-mini-Turbo uses `image-to-raw-mesh`, then optionally chains into `hunyuan3d_paint_v21_image_mesh_painting` after geometry completion.
- `POST /api/v1/mesh-generation/image-mesh-painting`: Paint textures onto mesh (Hunyuan3D-Paint-v2-1).
- `GET /api/v1/mesh-generation/status/{job_id}`: Real-time generation job status.
- `POST /api/v1/mesh-generation/cancel/{job_id}`: Cancel a running job.
- `POST /api/v1/mesh-generation/cost-estimate`: Estimate VRAM and time cost.
- `GET /api/v1/system/jobs/{job_id}/download?artifact_format=<format>`: Deliver canonical master, game-ready, LOD, collision, texture, preview, QA, or ZIP artifacts.

### Mesh Editing, Rigging, Segmentation, Retopology, UV
- `POST /api/v1/mesh-editing/text-edit`: Edit mesh with text prompt.
- `POST /api/v1/mesh-editing/image-edit`: Edit mesh with image reference.
- `POST /api/v1/auto-rigging/generate-rig`: Generate skeletal rig with UniRig.
- `POST /api/v1/mesh-segmentation/segment-mesh`: Decompose mesh into parts.
- `POST /api/v1/mesh-retopology/retopology-mesh`: Retopologize dense mesh.
- `POST /api/v1/mesh-uv-unwrapping/unwrap-mesh`: Generate UV atlas.

### Motion Generation
- `POST /api/v1/motion-generation/generate-motion`: Synthesize 3D human motion from text.
- `GET /api/v1/motion-generation/checkpoints`: Query installed ARDY checkpoints.

---

## 8. Model Catalog

| Model Architecture | Registered Adapters | Category / Tasks | VRAM Budget |
|---|---|---|---|
| **Hunyuan3D-Shape-v2-1** | `hunyuan3d_shape_v21_image_to_raw_mesh` | Raw Mesh | ~10 GB |
| **Hunyuan3D-Paint-v2-1** | `hunyuan3d_paint_v21_image_mesh_painting` | PBR Texture | ~21 GB |
| **Hunyuan3D-DiT-v2-mini-Turbo** | `hunyuan3d_dit_v2_mini_turbo_image_to_raw_mesh` | Raw Mesh | ~6 GB |
| **Hunyuan3D-2.1 (Legacy)** | `hunyuan3dv21_image_to_raw_mesh`, `hunyuan3dv21_image_to_textured_mesh`, `hunyuan3dv21_image_mesh_painting` | Raw & Textured Mesh | 8–19.5 GB |
| **TRELLIS** | `trellis_text_to_textured_mesh`, `trellis_image_to_textured_mesh`, `trellis_text_mesh_painting`, `trellis_image_mesh_painting` | Text/Image to Mesh, Mesh Painting | 11.5 GB |
| **TRELLIS.2** | `trellis2_image_to_textured_mesh`, `trellis2_image_mesh_painting` | Structured 3D & Painting | 23.5 GB |
| **TripoSR** | `triposr_image_to_raw_mesh` | Single-Image to Mesh | 6 GB |
| **TripoSG** | `triposg_image_to_raw_mesh` | Image & Scribble to Mesh | 8 GB |
| **TripoSF** | `triposf_image_to_raw_mesh` | SparseFlex Mesh | 12 GB |
| **ARDY** | `ardy_motion_generation` | Motion AI | 8 GB |
| **PartPacker** | `partpacker_image_to_raw_mesh` | Part-Level Image to Mesh | 10 GB |
| **UltraShape** | `ultrashape_image_to_raw_mesh` | Arbitrary-Topology Mesh | 26.6 GB |
| **PartField** | `partfield_mesh_segmentation` | Mesh Segmentation | 4 GB |
| **P3-SAM** | `p3sam_mesh_segmentation` | High-Precision Segmentation | 60 GB |
| **UniRig** | `unirig_auto_rig` | Auto-Rigging | 9 GB |
| **FastMesh** | `fastmesh_v1k_retopology`, `fastmesh_v4k_retopology` | Mesh Retopology | 16–24.5 GB |
| **PartUV** | `partuv_uv_unwrapping` | UV Unwrapping | 7 GB |
| **VoxHammer** | `voxhammer_text_mesh_editing`, `voxhammer_image_mesh_editing` | Text/Image Mesh Editing | 40 GB |

---

## 8.1 Raw Generation Fidelity / Official Parity Contract

Raw generation is model-specific. ForMash3D does not apply one global inference-step contract because released models are tuned/distilled for different schedules.

```
model-specific inference settings
        ↓
scheduler removes post-process-only controls
        ↓
adapter preprocessing
        ↓
official/vendored model pipeline
        ↓
high-fidelity supported extraction
        ↓
immutable master/source.glb
```

Quality-critical extraction settings are aligned to the current upstream implementation wherever possible. Hardware safety guards may downshift a request only when the configured density would be unsafe on the available GPU.

TRELLIS uses a vendored extraction helper that performs hole filling, UV parametrization, texture baking, and orientation conversion. The immutable source path intentionally keeps model geometry unsimplified even though the upstream downloadable GLB performs additional extraction work.

---

## 9. Third-Party Source Repositories

Each model integration has its own third-party source directory under `backend/thirdparty/`:

```
backend/thirdparty/
├── hunyuan3d-shape-v2-1/    # Hunyuan3D-Shape-v2-1 (3.3B shape)
├── hunyuan3d-paint-v2-1/    # Hunyuan3D-Paint-v2-1 (2B PBR texture, RealESRGAN, DifferentiableRenderer)
├── hunyuan3d-dit-v2-mini-turbo/  # Hunyuan3D-DiT-v2-mini-Turbo (0.6B)
├── TRELLIS/
├── TRELLIS.2/
├── PartField/
├── PartPacker/
├── PartUV/
├── FastMesh/
├── UltraShape/
├── UniRig/
├── VoxHammer/
├── TripoSR/
├── TripoSG/
├── TripoSF/
├── ardy/
└── wheels/
```

---

## 10. Configuration Files

### system.yaml (`backend/config/system.yaml`)
```yaml
logging:
  level: "INFO"
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
  file: null

security:
  rate_limit_per_minute: 60
  cors_origins: ["*"]
  api_key_required: false

environment: "production"
debug: false

user_auth_enabled: false
```

### models.yaml (`backend/config/models.yaml`)
Each feature maps model IDs to configurations with `vram_requirement`, `supported_inputs`, `supported_outputs`, `model_path`, `enabled`, and `max_workers`.

---

## 11. Verification & Self-Checks

```bash
# Health check
curl -s http://localhost:7842/health | jq .

# TypeScript type check
npx tsc --noEmit

# Frontend build test
bun run build

# Python syntax check
python3 -m compileall backend/api backend/core backend/adapters

# Shell script syntax check
bash -n backend/scripts/install.sh
```

---

## 12. Design Decisions

### ADR-001: Lazy Adapter Loading
**Decision**: All model adapters use lazy imports inside `_load_model()` to prevent cascading import failures.
**Reason**: Optional heavy packages (`accelerate`, `cv2`, `yacs`) should not prevent other models from loading.

### ADR-002: VRAM-Aware Scheduling
**Decision**: Strict GPU mutual exclusion with 1GB safety margin.
**Reason**: Prevents OOM crashes during concurrent inference on shared GPUs.

### ADR-003: Source Asset Immutability
**Decision**: `source.glb` is preserved byte-for-byte as an untouched master archive.
**Reason**: Enables reproducibility and rollback to original geometry.

### ADR-004: Local-First Architecture
**Decision**: All processing runs locally; no cloud dependencies.
**Reason**: Privacy, offline capability, and cost control.

### ADR-005: Zustand for Client State
**Decision**: Zustand stores for global client state instead of Redux or Context.
**Reason**: Minimal boilerplate, fast selectors, easy middleware integration.

### ADR-006: Next.js App Router
**Decision**: Next.js 16 App Router with server components.
**Reason**: Built-in data fetching, layouts, and API proxy routes.

### ADR-007: Bun as Frontend Package Manager
**Decision**: Bun as authoritative frontend package manager.
**Reason**: Faster than npm/yarn, compatible with npm ecosystem.

### ADR-008: Conda for Python Environment
**Decision**: Conda env `3daigc-api` for Python 3.10 + PyTorch 2.6.0 + CUDA 12.4.
**Reason**: Reproducible GPU environment, easy dependency management.

### 2.5 Post-Processing Engine

The production post-processing engine lives under backend/postprocess/. Successful mesh-generation jobs run this engine before the job is marked completed.

Pipeline: MODEL INFERENCE -> immutable master/source.glb -> world-space scene flattening -> Inspect/Repair -> conditional AutoRetopo for a large boundary component -> texture-aware Optimize/Preserve -> Auto UV/Preserve for raw outputs -> GAME READY -> LOD -> collision -> preview -> QA. Scene flattening applies node transforms and fails explicitly for unsupported mixed geometry rather than silently processing local-space coordinates. Native textured outputs are optimized with UV/material-aware decimation; raw outputs receive geometry optimization and production UVs. UV coordinates do not generate an image texture; shape-only model outputs remain untextured unless an explicit texture-generation or bake step succeeds. High-to-low bake remains an explicit transfer operation, and post-processing does not synthesize semantic textures from an untextured source. Quality metadata records source hash, source/repaired/optimized/game-ready snapshots, topology state, texture state, and per-LOD UV/material preservation.

The main runtime remains Python 3.10 + PyTorch 2.6.0 + CUDA 12.4. Blender-dependent FBX, GLTF, and thumbnail work runs in an isolated headless Blender process through BLENDER_EXECUTABLE and is best-effort for generation completion.

## Physics layer
Physics is an opt-in layer after the existing generation and production post-processing pipeline. The immutable master remains unchanged. When requested, the scheduler passes a provider-neutral physics intent into post-processing; the existing collision service produces the collision representation and `metadata/physics.json` records the rigid-body configuration, material response, collision statistics, provenance, and capabilities. The browser viewer uses the canonical collision artifact with pinned Rapier 0.19.3 while remaining on the existing direct Three.js renderer. Physics preparation is skipped for intermediate Shape output in Shape→Paint auto-chaining and runs only on the final output. The physics runtime is not an inference model and does not consume generation-model VRAM.

### Execution telemetry and cancellation
The workspace treats `/api/v1/system/jobs/{job_id}` as the source of truth for live job state. The frontend uses adaptive, visibility-aware polling because the current backend exposes the system job status contract as REST; it does not claim a per-job SSE stream that is not implemented. Queue cancellation uses `POST /api/v1/mesh-generation/cancel/{job_id}` and preserves the job history record.

Segmentation results carry `segmentation_info` through normalized asset metadata so inspectors render actual backend part statistics rather than static sample data.

## Review Audit Hardening — Current Runtime Contracts

The scheduler control plane keeps blocking SQLite work off the FastAPI event loop, treats job-status reads as side-effect-free, recovers processing jobs after restart, and terminates owning worker processes for timeout/cancellation before publishing terminal state.

Redis control state uses noeviction. Result payloads use dedicated per-job keys with native Redis TTLs. Resource-blocked jobs rotate to the back of the queue so a non-runnable large model does not globally block compatible work.

Filesystem inputs are restricted to explicit asset roots by default; file uploads and base64 inputs enforce bounded ingestion. The GLB client cache applies one L1 budget to both network hydration and persistent-cache hydration.

## Review Audit — Generation/Post-Process Completion Boundary

The current production scheduler keeps generation jobs in a non-terminal state while canonical post-processing runs. The native model output is secured under the immutable master checkpoint first, then repair/retopo/optimization/UV, game-ready export, LOD, optional collision, preview, and QA are completed before the scheduler publishes terminal success. `postprocess_status` remains explicit for progress/retry observability, but it does not make a job terminal before the production artifact is ready.

Workspace state is keyed by backend job ID rather than a single global active operation. Batch submissions carry a scheduler-owned `batch_id` and `batch_max_parallel`; the scheduler refuses additional workers for that batch until a slot is free.

## Review Audit — Canonical Runtime Contracts

The backend model manifest is the source of truth for model readiness, capabilities, supported IO, VRAM reservation, and worker limits. Frontend model selectors consume the runtime model-details endpoint; static model definitions remain presentation fallbacks only.

Generation completion is production-oriented:
1. native model output is persisted as the immutable master;
2. canonical production post-processing runs;
3. game-ready/LOD/physics/preview/QA artifacts are written;
4. the job reaches terminal success only after the requested production outputs are complete.

Batch text generation submits independent jobs under a scheduler-owned batch ID and max-parallel limit. Redis and single-worker queues expose the same terminal semantics and error-code surface.

Each canonical asset manifest carries asset_id, job_id, optional parent_job_id, model/feature information, seed/settings, and SHA-256 input hashes for reproducibility.


## Final Review Audit Gap Closure — September 30, 2026

The final non-testing audit pass keeps the architecture split at the actual execution boundary: GPU inference becomes a completed raw result immediately, while canonical production post-processing is an independently tracked background task. Request-owned temporary input remains alive until post-processing finishes so asset lineage can hash the original inputs; scheduler shutdown waits briefly for those tasks before releasing persistence.

Model configuration remains canonical in `backend/config/models.yaml`. Adapter constructors reject missing manifest VRAM, repository-relative model/third-party roots are used, and variant-specific overrides do not silently replace manifest values. The system API exposes runtime readiness, weights state, capabilities, and canonical queue counters to the frontend.

The workspace consumes those capabilities for routing and keeps the viewer asset synchronized when post-processing transitions from pending/running to completed or failed. The in-memory GLB cache uses bounded LRU accounting for replacement and reuse.


## Production Workflow Contract

All mesh-producing jobs carry `postprocess_mode: production_mesh` when they produce a user-owned mesh. The scheduler owns Shape→Paint dependencies; the browser only observes workflow state. Production artifacts are exposed through the authorized job download API and a structured artifact manifest. Job history is durable in SQL; Redis is a queue/cache.

Mesh tools run inside the main FastAPI process under `/api/v1/mesh-tools/*`. There is no browser-direct or default-startup port 8200 sidecar.
