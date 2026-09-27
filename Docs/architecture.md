# ForMash 3D — System & Runtime Architecture

> **Architecture Version**: 0.1.0 (FastAPI + Next.js 16)  
> **Last Verified**: September 2026  
> **Target Environments**: Linux (Ubuntu 20.04/22.04/24.04), Cloud GPU / Local Workstations

---

## 1. Architectural Mission & Overview

ForMash 3D is an end-to-end generative 3D asset pipeline. The system is architected around a clean separation of concerns:
- **Presentation Layer**: Next.js 16 frontend with interactive Three.js 3D viewport, studio workspace tooling, and model management.
- **API Gateway**: FastAPI backend (Python 3.10, Conda env `3daigc-api`) with VRAM-aware multiprocess scheduler, request validation, rate limiting, and static file delivery.
- **Model Adapters**: Python adapters for each AI model (TRELLIS, Hunyuan3D, PartPacker, UltraShape, PartField, P3-SAM, UniRig, FastMesh, VoxHammer, TripoSR, TripoSG, ARDY).
- **Scheduler**: VRAM-aware scheduler with GPU monitoring and optional Redis multi-worker queue.

```mermaid
flowchart TB
    classDef layer fill:#0f172a,stroke:#64748b,stroke-width:1px,color:#94a3b8
    classDef node fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff
    classDef db fill:#1e293b,stroke:#ec4899,stroke-width:2px,color:#fff
    classDef store fill:#1e293b,stroke:#10b981,stroke-width:2px,color:#fff

    subgraph LAYER["Frontend Layer"]
        direction TB
        NEXT["Next.js 16 :3000<br/>React 19 + TypeScript"]:::node
        VPORT["3D Viewport<br/>Three.js / R3F"]:::node
        CONTROLS["Generation Controls<br/>LOD / Budget / Export"]:::node
    end

    subgraph GW["API Gateway Layer"]
        direction TB
        API["FastAPI Gateway :7842<br/>Routers + CORS + Rate Limit"]:::node
        ROUTERS["API Routers<br/>system · file-upload<br/>mesh-generation · mesh-editing<br/>motion-generation · auto-rigging<br/>mesh-segmentation · mesh-retopology<br/>mesh-uv-unwrapping · users"]:::node
        SCHED["VRAM-Aware Scheduler<br/>GPU Mutual Exclusion"]:::node
        STATIC["Static File Delivery<br/>/static Binary Streaming"]:::node
    end

    subgraph CORE["Model Execution Layer"]
        direction TB
        ADAPTERS["Model Adapters<br/>TRELLIS · Hunyuan3D · PartPacker<br/>UltraShape · PartField · UniRig<br/>TripoSR · TripoSG · ARDY<br/>FastMesh · VoxHammer"]:::node
        GPU_MON["GPU Monitor<br/>VRAM / Temperature"]:::node
        VRAM_BUF["VRAM Safety Buffer<br/>1GB Free Margin"]:::node
    end

    subgraph DATA["Storage Layer"]
        direction TB
        FILESTORE["Redis FileStore<br/>Cross-Worker Metadata"]:::store
        LOCAL["Local Filesystem<br/>backend/storage/models/[job_id]/"]:::store
        UPLOADS["Upload Bucket<br/>backend/storage/uploads/"]:::store
        EXPORTS["Export Archives<br/>backend/storage/exports/"]:::store
    end

    subgraph OPT["Optional Services"]
        direction TB
        REDIS["Redis 7 :6379<br/>Multi-Worker Queue"]:::db
    end

    LAYER -->|"REST / SSE / WS"| GW
    API --> ROUTERS
    API --> SCHED
    SCHED --> ADAPTERS
    SCHED --> GPU_MON
    SCHED --> VRAM_BUF
    ADAPTERS -->|Raw Mesh| DATA
    SCHED --"Job Queue"| OPT
    STATIC -->|"Binary Delivery"| LAYER

    style LAYER fill:#0f172a
    style GW fill:#0f172a
    style CORE fill:#0f172a
    style DATA fill:#0f172a
    style OPT fill:#0f172a
```

---

## 2. Component Layers

### 2.1 Presentation Layer (Next.js 16)

| Component | Path | Description |
|---|---|---|
| **App Router** | `app/` | Next.js 16 App Router with server components, layouts, and API proxy routes |
| **Workspace Shell** | `features/workspace/WorkspaceShell.tsx` | Main workspace UI with tabbed panels and model viewport |
| **API Client** | `services/apiClient.ts` | Unified axios client for all FastAPI backend REST/SSE communication |
| **3D Canvas** | `features/workspace/Viewport/MeshViewer.tsx` | Three.js WebGL viewport with orbit controls, wireframe mode, matcap shading |
| **State Stores** | `stores/` | Zustand stores for global client state (`useAppStore`, `useViewerStore`, `useAnimationStore`, `useRiggingStore`, `useUIStore`) |
| **Data Fetching** | hooks + TanStack Query | Server-state caching and synchronization for job status |

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
| **Model Adapters** | `backend/adapters/` | Python inference adapters (TRELLIS, Hunyuan3D, PartPacker, UltraShape, PartField, UniRig, TripoSR, TripoSG, TripoSF, ARDY, FastMesh, VoxHammer) |

### 2.4 Storage Layer

Located at `backend/storage/`:
- **Uploads** (`uploads/`): User-uploaded reference images (`.png`, `.jpg`, `.webp`).
- **Models** (`models/<job_id>/`): Generated 3D assets organized per job.
- **Thumbnails** (`thumbnails/`): Rendered asset preview images.
- **Exports** (`exports/`): Structured ZIP packages for engine delivery.

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
    participant Storage as backend/storage/

    User->>Frontend: Select prompt / image + Platform budget
    Frontend->>API: POST /api/v1/mesh-generation/text-to-textured-mesh
    API->>SCHED: Submit job (VRAM-aware)
    SCHED->>Adapter: Run inference (TRELLIS/Hunyuan3D/etc.)
    Adapter-->>SCHED: Raw 3D mesh output
    SCHED->>Storage: Save source.glb (Untouched Master)
    SCHED->>Storage: Save game_ready.glb (Decimated)
    SCHED->>Storage: Save lods/lod0..3.glb (LOD Cascade)
    SCHED->>Storage: Save collision.glb (Convex Hull)
    SCHED->>Storage: Save quality_report.json (QA 0-100 Score)
    SCHED-->>API: Job complete
    API-->>Frontend: Return {job_id, status: "completed", outputs}
    Frontend->>User: Render 3D model in WebGL Viewport
```

---

## 5. Storage Directory Organization

All user assets and generation outputs are stored under `backend/storage/`:

```mermaid
flowchart LR
    classDef dir fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff
    classDef file fill:#0f172a,stroke:#64748b,stroke-width:1px,color:#cbd5e1

    ROOT["backend/storage/"]:::dir --> UPLOADS["uploads/<br/>Reference Images"]:::dir
    ROOT --> MODELS["models/[job_id]/<br/>Generated Assets"]:::dir
    ROOT --> THUMBS["thumbnails/<br/>Preview PNGs"]:::dir
    ROOT --> EXPORTS["exports/<br/>Production ZIPs"]:::dir

    MODELS --> SRC["source.glb<br/>Untouched Master"]:::file
    MODELS --> GAME["game_ready.glb<br/>Engine-Optimized"]:::file
    MODELS --> LODS["lods/<br/>lod0–lod3.glb"]:::dir
    MODELS --> COL["collision.glb<br/>Convex Hull"]:::file
    MODELS --> QA["quality_report.json<br/>QA 0-100 Score"]:::file

    UPLOADS --> IMG["*.png *.jpg *.webp"]:::file
    EXPORTS --> ZIP["Project_Export_[job_id].zip"]:::file

    style ROOT fill:#0f172a
```

---

## 6. Service Lifecycle Management

### 6.1 Installation (`backend/scripts/install.sh`)

The install script (`backend/scripts/install.sh`) creates the Conda env `3daigc-api` (Python 3.10) and installs:
- PyTorch 2.6.0 + CUDA 12.4 (from `https://download.pytorch.org/whl/cu124`)
- All thirdparty model dependencies (TRELLIS.2, PartField, Hunyuan3D-2.1, UniRig, PartPacker, PartUV, P3-SAM, FastMesh, UltraShape, VoxHammer)
- Main project dependencies (from `backend/requirements.txt`)
- System packages (`libsm6`, `libegl1`, `libgl1-mesa-dev`)

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
- Embedded VRAM-aware scheduler
- No external broker required
- Best for single-GPU deployments

**Multi-Worker Mode** (Redis Queue):
```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start scheduler service
conda activate 3daigc-api
python backend/scripts/scheduler_service.py

# Terminal 3: Start API workers
cd backend && conda activate 3daigc-api
uvicorn api.main_multiworker:app --workers 4 --port 7842
```
- Redis-backed job queue (`RedisJobQueue`)
- Multiple uvicorn workers
- Redis FileStore for cross-worker metadata sharing

### 6.3 Shutdown (`scripts/stop.sh`)
- Gracefully terminates Next.js, Uvicorn, and Redis processes.
- Releases TCP ports 3000, 7842, and 6379.
- Cleans up stale PID files.

---

## 7. Verification & Self-Checks

The backend exposes a health endpoint for runtime verification:
```bash
curl -s http://localhost:7842/health | jq .
# {"status": "healthy", "timestamp": ..., "version": "0.1.0"}
```

The frontend TypeScript types can be checked with:
```bash
npx tsc --noEmit
```

The production frontend build can be verified with:
```bash
bun run build
```

> **Note**: An automated `backend/tests/test_backend_e2e.py` test script referenced in earlier documentation does not currently exist. The health endpoint and TypeScript compiler provide the available self-check mechanisms.