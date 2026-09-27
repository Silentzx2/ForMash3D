# ForMash 3D - Pipeline Implementation Status

> **Version**: 0.1.0
> **Status**: Active development
> **Last Updated**: September 2026

---

## v0.1.0 — Initial FastAPI + Next.js Architecture

### Frontend Architecture

1. **Unified API Client (`services/apiClient.ts`)**:
   - Single `axios`-based client for all FastAPI backend communication.
   - HTTP methods: `get<T>(path)`, `post<T>(path, data)` with TypeScript generics.
   - Request/response interceptors for logging and auth token injection.

2. **Workspace Shell (`features/workspace/WorkspaceShell.tsx`)**:
    - Main application shell with shared 3D viewport, tool panels, and inspector.
    - Supported workspaces & professional workflows:
      - **Generate** (`/workspace/generate`): Text-to-3D, Image-to-3D with TRELLIS and Hunyuan3D-2.1.
      - **Poly / Remesh** (`/workspace/remesh`): Retopology with FastMesh V1K/V4K.
      - **Texture** (`/workspace/texture`): PBR texture generation and painting.
      - **UV Unwrap** (`/workspace/uv`): PartUV semantic unwrapping, UVPackmaster packing, 2D island layout canvas.
      - **Mesh Segmentation** (`/workspace/segment`): PartField semantic part decomposition, hierarchy, isolation, part export.
      - **Mesh Editing** (`/workspace/edit`): VoxHammer text/image neural mesh inpainting and deformation.
      - **Animation & Rigging** (`/workspace/animation`): UniRig skeleton generation and animation studio.
      - **Job Detail / Run Inspector** (`/workspace/jobs`): Hardware telemetry, 5-stage pipeline stepper, live terminal logs, output preview.
      - **Models Manager** (`/admin?tab=models`): Real model registry from `models.yaml` with VRAM pool, capabilities, and parameters.
    - Responsive layout with mobile drawer navigation.
    - Direct asset lineage chaining across tools without manual download or re-upload.
    - Keyboard shortcuts (⌘1–⌘3, G/R/T/U/S/E/A) for tool navigation.

3. **State Management**:
    - Zustand stores (`useAppStore.ts`, `useViewerStore.ts`, `useAnimationStore.ts`, `useUIStore.ts`) for generation state, model selection, and UI panels.
    - TanStack Query for server-state caching.

4. **3D Rendering**: Three.js / React Three Fiber / OrbitControls / Matcap shaders.

---

## v0.1.0 — Backend Architecture

### API Routers (All under `/api/v1`)

| Router | File | Endpoints |
|---|---|---|
| **System** | `backend/api/routers/system.py` | `/system/health`, `/system/info`, `/system/auth-status`, `/system/models`, `/system/features`, `/system/jobs/{job_id}/download` |
| **File Upload** | `backend/api/routers/file_upload.py` | `/file-upload/image`, `/file-upload/mesh`, `/file-upload/{file_id}`, `/file-upload/download/{file_id}` |
| **Mesh Generation** | `backend/api/routers/mesh_generation.py` | `/mesh-generation/text-to-raw-mesh`, `/text-to-textured-mesh`, `/image-to-raw-mesh`, `/image-to-textured-mesh`, `/text-mesh-painting`, `/image-mesh-painting`, `/status/{job_id}`, `/cancel/{job_id}`, `/cost-estimate`, `/models`, `/models/{model_id}/parameters` |
| **Mesh Editing** | `backend/api/routers/mesh_editing.py` | `/mesh-editing/text-mesh-editing`, `/mesh-editing/image-mesh-editing` |
| **Auto Rigging** | `backend/api/routers/auto_rigging.py` | `/auto-rigging`, `/auto-rigging/rig-mesh`, `/auto-rigging/available-models` |
| **Mesh Segmentation** | `backend/api/routers/mesh_segmentation.py` | `/mesh-segmentation`, `/mesh-segmentation/segment-mesh`, `/mesh-segmentation/available-models` |
| **Mesh Retopology** | `backend/api/routers/mesh_retopology.py` | `/mesh-retopology`, `/mesh-retopology/retopology-mesh`, `/mesh-retopology/available-models` |
| **Mesh UV Unwrapping** | `backend/api/routers/mesh_uv_unwrapping.py` | `/mesh-uv-unwrapping`, `/mesh-uv-unwrapping/unwrap-mesh`, `/mesh-uv-unwrapping/available-models` |
| **Users** | `backend/api/routers/users.py` | `/users/register`, `/users/login`, `/users/me` (multi-worker) |

### Backend Core Modules

| Module | File | Purpose |
|---|---|---|
| **Config** | `backend/core/config.py` | Pydantic V2 settings + YAML config (`system.yaml`, `models.yaml`) |
| **Scheduler Factory** | `backend/core/scheduler/scheduler_factory.py` | Create dev/prod schedulers |
| **Multiprocess Scheduler** | `backend/core/scheduler/multiprocess_scheduler.py` | VRAM-aware job scheduling |
| **GPU Monitor** | `backend/core/scheduler/gpu_monitor.py` | Real-time VRAM/temperature polling |
| **Redis Job Queue** | `backend/core/scheduler/redis_job_queue.py` | Multi-worker job distribution |
| **File Store** | `backend/core/file_store.py` | Redis-backed file metadata (multi-worker) |
| **Auth** | `backend/core/auth/` | Redis-based user authentication |

---

## v0.1.0 — Model Adapters

| Adapter | File | Model | VRAM | Inputs | Outputs |
|---|---|---|---|---|---|
| TRELLIS | `backend/adapters/trellis_adapter.py` | TRELLIS | 11.5 GB | text, image | glb, obj |
| TRELLIS.2 | `backend/adapters/trellis2_adapter.py` | TRELLIS.2 | 23 GB | image | glb, obj |
| Hunyuan3D-2.1 | `backend/adapters/hunyuan3d_adapter_v21.py` | Hunyuan3D-2.1 | 8–16 GB | image | glb, obj |
| PartPacker | `backend/adapters/partpacker_adapter.py` | PartPacker | 10 GB | image | glb, obj |
| UltraShape | `backend/adapters/ultrashape_adapter.py` | UltraShape | 26.6 GB | image | glb, obj, ply |
| PartField | `backend/adapters/partfield_adapter.py` | PartField | 4 GB | glb, obj | glb |
| P3-SAM | `backend/adapters/p3sam_adapter.py` | P3-SAM | 60 GB | glb, obj, ply | glb |
| UniRig | `backend/adapters/unirig_adapter.py` | UniRig | 9 GB | obj, glb, fbx | glb, fbx |
| FastMesh V1K | `backend/adapters/fastmesh_adapter.py` | FastMesh-V1K | 16 GB | obj, glb, ply, stl | obj, glb, ply |
| FastMesh V4K | `backend/adapters/fastmesh_adapter.py` | FastMesh-V4K | 24.5 GB | obj, glb, ply, stl | obj, glb, ply |
| VoxHammer | `backend/adapters/voxhammer_adapter.py` | VoxHammer | 40 GB | mesh, text/image | glb |
| PartUV | `backend/adapters/partuv_adapter.py` | PartUV | 7 GB | glb, obj | glb |

---

## v0.1.0 — Configuration

### system.yaml (`backend/config/system.yaml`)
- Logging level, format, file output
- Security: rate limit, CORS origins, API key requirement
- Environment: development/production
- User authentication toggle

### models.yaml (`backend/config/models.yaml`)
Per-feature model definitions with:
- VRAM requirements (MB)
- Supported inputs (text, image, mesh, glb, obj, ply, stl, fbx)
- Supported outputs (glb, obj, ply, fbx)
- Model path references
- Enabled status and max concurrent workers

---

## v0.1.0 — Project Structure

```
ForMash3D/
├── app/                               # Next.js 16 App Router
│   ├── layout.tsx                     # Root layout with Providers
│   ├── page.tsx                       # Landing → WorkspaceShell redirect
│   ├── workspace/page.tsx             # Workspace home (tool tabs)
│   ├── animation/page.tsx             # Animation studio
│   ├── admin/page.tsx                 # Admin dashboard
│   ├── dashboard/page.tsx             # Dashboard overview
│   ├── outputs/page.tsx               # Outputs/assets page
│   ├── system/page.tsx                # System status page
│   └── api/                           # API proxy routes to backend
│
├── features/                          # Feature modules
│   ├── workspace/                     # Main workspace shell & panels
│   │   ├── WorkspaceShell.tsx         # Main app shell
│   │   ├── store/WorkspaceContext.tsx # Workspace state
│   │   ├── Header/                    # Top header
│   │   ├── Navigation/                # Left nav rail
│   │   ├── Panels/                    # Tool panels (Generate, Texture, Remesh)
│   │   ├── RightPanel/                # Inspector panel
│   │   ├── Viewport/                  # 3D MeshViewer
│   │   ├── Animation/                 # Animation studio
│   │   └── Dashboard/                 # Dashboard pages
│   ├── admin/                         # System monitoring & diagnostics
│   └── settings/                      # Settings & model manager
│
├── components/                        # Shared UI components
│   ├── Providers.tsx                  # Theme & state providers
│   ├── ui/                            # Radix UI wrappers
│   └── premium/                       # Premium UI components
│
├── hooks/                             # React hooks
│   ├── useTaskPolling.ts              # Generation task polling
│   └── useRealtime.ts                 # Real-time events
│
├── services/                          # Shared service layer
│   └── apiClient.ts                   # Unified FastAPI client
│
├── stores/                            # Zustand stores
│   ├── useAppStore.ts                 # Main app state
│   ├── useViewerStore.ts              # 3D viewport state
│   ├── useAnimationStore.ts           # Animation studio state
│   └── useUIStore.ts                  # UI proxy store
│
├── types/                             # TypeScript types
│   ├── api.ts                         # API request/response types
│   └── index.ts                       # Re-exports
│
├── backend/                           # FastAPI Python backend (3DAIGC-API)
│   ├── api/                           # API entry points & routers
│   ├── core/                          # Core modules (config, scheduler, auth)
│   ├── adapters/                      # Model adapters
│   ├── config/                        # YAML configs
│   ├── scripts/                       # install.sh, run_server.sh, etc.
│   ├── thirdparty/                    # Third-party model source code & wheels (part of main repo)
│   ├── requirements.txt
│   └── requirements-test.txt
│
├── scripts/                           # System orchestration
│   ├── setup.sh                       # Full system setup
│   ├── start.sh                       # Start services
│   ├── stop.sh                        # Stop services
│   ├── restart.sh                     # Restart services
│   └── verify_contracts.py            # Unified API contract & route verification
│
├── Docs/                              # Technical documentation
├── README.md                          # Main project readme
├── MASTER.md                          # Full system audit and implementation plan
├── .env.example                       # Environment template
└── package.json                       # Frontend metadata (v0.1.0)
```

---

## Contract Verification & Quality Suite

Run the unified Python verification suite to validate all 5 critical contract layers without requiring external services:

```bash
python scripts/verify_contracts.py
```

The suite validates:
1. **FastAPI OpenAPI Endpoint Registration**: Checks that all 23 core endpoints across system, file upload, generation, retopology, uv unwrapping, segmentation, and auto rigging are active.
2. **Configuration Integrity**: Validates `models.yaml` feature mappings and required model definitions.
3. **Frontend Route Safety**: Scans all TypeScript/TSX source files to ensure no dead or obsolete endpoints are referenced.
4. **Data Schema Contracts**: Verifies schema definitions such as `FileUploadResponse` (including `url`).
5. **Asset Lifecycle**: Performs end-to-end upload -> download -> delete validation on simulated assets with MIME type detection.
