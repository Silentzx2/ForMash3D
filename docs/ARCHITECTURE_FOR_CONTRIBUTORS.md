# Architecture for Contributors — ForMesh3D

## Folder Map

```
/workspaces/ForMash3D/
├── app/                  # Next.js 16 App Router (frontend)
│   ├── page.tsx          # Home page (Command Center)
│   ├── api/v1/[...path]/ # API proxy to backend
│   └── ...
├── features/workspace/   # React workspace panels & stores
│   ├── Panels/           # GeneratePanel, TexturePanel, etc.
│   ├── Viewport/         # MeshViewer, TransformControls
│   ├── RightPanel/       # Asset, property inspectors
│   ├── store/            # Zustand stores (WorkspaceContext)
│   └── lib/              # buildGenerationParameters, qualityBadge, etc.
├── stores/               # Zustand stores (useAppStore, useViewerStore, etc.)
├── hooks/                # React hooks (useSSE, useTaskPolling, etc.)
├── components/ui/        # shadcn/ui components
├── scripts/              # Shell scripts (setup.sh, start.sh, manager.sh)
│   ├── lib/              # compute_mode.sh (shared resolver)
│   └── tests/            # script_test.sh (static audit + resolver tests)
├── backend/              # FastAPI backend (Python 3.10)
│   ├── api/              # FastAPI routers & main entry points
│   │   ├── main_multiworker.py   # Multi-worker entry (Redis + scheduler)
│   │   ├── main_singleworker.py  # Single-worker entry
│   │   └── routers/              # system, mesh_generation, etc.
│   ├── core/             # scheduler, planner, quality, mesh_processor
│   ├── postprocess/      # Mesh post-processing pipeline
│   ├── config/           # quality.yaml, smart_presets.yaml, models.yaml
│   ├── scripts/          # install.sh (backend dependency install)
│   ├── thirdparty/       # Vendored model source (TRELLIS, Hunyuan, etc.)
│   └── tests/            # Pytest backend tests
├── Docs/                 # Documentation
├── RULES.md              # Mandatory agent operating rules
├── README.md             # Project overview
└── CONTRIBUTING.md       # Contributor guide
```

## Request Flow

```
User uploads image in GeneratePanel
    │
    ▼
buildGenerationParameters() builds request body
    │  (inference params NEVER reach model_parameters — adapter-owned)
    ▼
POST /api/v1/mesh-generation/image-to-raw-mesh  (via app/api/v1/[...path]/route.ts proxy)
    │
    ▼
FastAPI router validates request → creates JobRequest
    │
    ▼
Scheduler (multiprocess_scheduler.py) admits job based on VRAM
    │
    ▼
Model adapter loads checkpoint, runs inference (adapter-owned _LOCKED_INFERENCE_PROFILE)
    │
    ▼
Raw mesh saved as master/source.glb (immutable)
    │
    ▼
Post-processing pipeline (optional): decimation, UV, retopology, LOD, baking
    │
    ▼
Job completed → result URLs returned to frontend
    │
    ▼
MeshViewer loads GLB via /api/v1/system/jobs/{id}/download
```

## Where to Add

### Add a new model adapter

1. Create `backend/adapters/<new>_adapter.py` extending `BaseModel`
2. Register in `backend/adapters/__init__.py` `_ADAPTER_MAP`
3. Add model entry to `backend/config/models.yaml`
4. Add inference profile to adapter's `_LOCKED_INFERENCE_PROFILE` (never in UI)
5. Add model option to `GeneratePanel.tsx` model selector

### Add a new UI panel

1. Create component in `features/workspace/Panels/` or `features/workspace/RightPanel/`
2. Register tool route in `WorkspaceContext.tsx` `TOOL_TO_ROUTE`
3. Add route in `app/workspace/[...tool]/page.tsx` allow-list
4. Add nav link in `app/page.tsx` header or workspace shell

### Add a new test

**Frontend:** Create `*.test.mjs` in `features/workspace/lib/` or `app/api/v1/`, run `bun test`

**Backend:** Create `test_*.py` in `backend/tests/`, run `python -m pytest backend/tests/`

**Shell:** Add to `scripts/tests/script_test.sh` static audit, run `bash scripts/tests/script_test.sh`

## Rules

Read `RULES.md` before contributing. Key principles:

* **Smallest complete change:** No features nobody asked for
* **No new dependencies** unless unavoidable
* **No mock/disconnected controls:** Every UI button must affect the real API request
* **Honest test reporting:** PASS/FAIL/NOT RUN only, never invent results
* **Documentation sync:** Update all relevant `.md` files after every change
