## 2026-10-14 — Rigging / Animation Reliability and Native Export

- Fixed UniRig install false-success handling, real mesh-file references, Import/Replace/Export actions, stale mesh-stat carryover, and fabricated rig/mesh status. Manual armature saves now persist the editor bones without claiming they create skin weights.
- Kept the native UniRig FBX for export while serving the converted GLB to the viewport; unsupported generic FBX conversion now returns HTTP 422 with regression coverage.
- Added ARDY-to-loaded-skeleton retargeting in the existing Three.js playback path, with compatibility counts based on the imported model's actual bones; retained rig-gated Motion AI generation, cancellable polling, and corrected identified placeholder/icon-name UI text.
## 2026-10-14 — Unique3D Shared Runtime Dependency Conflict

- Removed the unused import of Unique3D's Gradio wrapper from the backend adapter. That wrapper also initialized a duplicate module-level inference pipeline.
- Removed Gradio from the Unique3D installer dependency list because the ForMash3D backend uses its own FastAPI/Next.js UI and does not launch the upstream Gradio demo.
- Added cleanup for stale `gradio`, `gradio-client`, and `hf-gradio` packages installed by older setup runs, so re-running the installer removes the current environment conflict.
- Kept `datasets==3.6.0` with the project's `huggingface_hub==0.25.0` baseline; this resolves the Datasets bucket-exception import without violating TripoSG's Hub version contract. Added regression coverage for the installer and adapter contract.

## 2026-10-14 — [High-Performance Viewport Engine & Production Postprocessing Pipeline Hardening]

### 3D Viewport Optimizations
- **Zero-Allocation Shading Material Switcher**: Implemented lazy per-mesh material caching (`child.userData.__shadingMaterialCache`) in `MeshViewer.tsx`. Shading mode switches (`clay`, `ceramic`, `chrome`, `gold`, `normals`, `xray`, `turquoise`, `default`/`textured`) and wireframe toggles dynamically reuse instantiated Three.js materials, reducing memory allocation churn to zero during scene traversals.
- **Event-Driven Reflection Peek Capture**: Replaced the unthrottled 1000ms `setTimeout` polling loop with event-driven snapshot captures. Captures now trigger on initial mount and OrbitControls `'end'` events debounced at 250ms, with complete timer, event listener, and object URL revocation on unmount, drastically slashing CPU/GPU overhead when the scene is static.
- **Interactive TransformControls Integration**: Integrated Three.js `TransformControls` into `MeshViewer.tsx` for interactive 3D mesh translation, rotation, and scaling in Edit mode (`interactionMode` synced to `'move' | 'rotate' | 'scale'`). Includes OrbitControls mutual-exclusion locking during dragging (`controls.enabled = !event.value`) and rigging bone joint manipulation (`animSelectedBone`), wired to tactile vertical toolbar buttons in `ViewportToolOverlay.tsx`.
- **Axial Camera Alignment Presets**: Integrated instant axial camera alignment presets (`Perspective`, `Front`, `Side`, `Top`) into `ViewportToolOverlay.tsx`, dispatching custom window events to `MeshViewer.tsx` (`applyCameraPreset`) to snap the viewport smoothly to standard orthographic-style projection viewpoints.
- **Smooth MeshDiffViewer Animation Loop**: Eradicated the React state re-render loop (`setAnimationFrame(prev => prev + 1)`) in `MeshDiffViewer.tsx`. Replaced with a native `requestAnimationFrame` loop that updates controls and renders left/right WebGL scenes directly without React component re-renders, complete with `cancelAnimationFrame` cleanup on unmount.

### Postprocessing Pipeline Enhancements
- **UI Master Post-Processing Toggle & Pipeline Bypass**: Added a master toggle in the UI (`GeneratePanel.tsx`, both on the main configuration panel and the Advanced Drawer) allowing users to cleanly disable post-processing after mesh generation.
  - When disabled (`enable_postprocess: false`), mesh generation returns the raw, unmodified high-fidelity source geometry immediately without executing remeshing, retopology, decimation, UV unwrap, or texture baking stages.
  - **Comprehensive UI Control Blocking & Greying**: When toggled OFF, all downstream post-processing stages and buttons are completely disabled and greyed out (`opacity-40 cursor-not-allowed pointer-events-none`) with contextual `BLOCKED` badges:
    - *Textured Generation & Output Atlas*: Toggle is disabled, locked to raw geometry, and atlas size selector displays a bypass notice.
    - *Smart Intent Presets*: Game, Cinematic, Animation, Print, and Mobile preset buttons are disabled and locked.
    - *Target & Polycount Budget*: Preset buttons (Mobile, Game, Cinema, Native) and the budget slider are disabled and greyed out.
    - *Production QA & Auto-Rig*: Printability check, Auto-repair, and Auto-Rig buttons are locked with an explanatory banner.
    - *Physics Preparation*: Collision hull generation toggle and all body/density/friction controls are disabled.
    - *Mesh Settings*: Texture quality chips, polycount budget, and Quads vs Triangles topology selectors are locked.
    - *Pre-flight Bar*: Header badge and bottom sticky bar display `POSTPROCESS: OFF (RAW)` and `RAW NATIVE GEOMETRY`.
  - **Payload & Backend Parameter Enforcement**: `buildGenerationParameters.ts` and `backend/api/routers/mesh_generation.py` strictly enforce `texture_enabled = false`, `generate_texture = false`, `lod_enabled = false`, `enable_printability = false`, `enable_auto_repair = false`, `enable_auto_rig = false`, and `target_polycount = 0` whenever `enable_postprocess` is False.
  - Handled cleanly in `backend/core/scheduler/multiprocess_scheduler.py`: sets `postprocess_status: "bypassed"` and `production_status: "ready"`, attaching the raw model URLs and polygon counts so Three.js `<MeshViewer />` displays the generated raw mesh seamlessly.
  - Backend request schemas (`ImageToRawMeshRequest`, `ImageToTexturedMeshRequest`, `TextMeshPaintingRequest`) and batch generation endpoints accept `enable_postprocess: bool = Field(True, ...)` and enforce `postprocess_mode: "none"` when toggled off.
- **Quad OBJ Polygonal Export**: Implemented `_export_quad_obj` in `backend/postprocess/pipeline.py` to serialize meshes with genuine 4-vertex polygonal faces (`f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 v4/vt4/vn4`) preserving quad-dominant topology from AutoRetopo / QuadriFlow passes. Automatically bypasses destructive triangle decimation (`Passthrough: Quad-dominant topology preserved from retopology pass`) when quad retopology is requested.
- **Smart Preset Budget Precedence Fix**: Implemented `_resolve_target_polycount_precedence` in `backend/api/routers/mesh_generation.py` ensuring explicit top-level request budgets take precedence over nested defaults and smart presets, preventing nested default `0` from wiping out configured budgets while preserving explicit `0` as an intentional Native/Raw pass-through request.
- **Robust Headless Blender Worker Invocation**: Enhanced `blender_worker_argv` and `blender_expr_argv` in `backend/postprocess/config.py` with multi-path resolution: prefers `BLENDER_EXECUTABLE` on `PATH` if available, gracefully falling back to running workers under `sys.executable` via the embedded `bpy` Python wheel.
- **Dynamic Storage Base Directory Resolution**: Unified `get_storage_base_dir()` in `backend/core/utils/file_utils.py` to dynamically resolve `STORAGE_LOCAL_PATH` relative to project root (`parents[3]`) or default to `backend/storage`, eradicating the nested `backend/backend/storage` directory duplication bug across uploads, models, and static mounts.
- **Watertight 3D Print Preservation**: For 3D printing and closed meshes, `watertight` parameter in AutoRetopo respects already-watertight geometry (`watertight=not bool(repaired_topology.get("watertight", False))`) to avoid destructive voxel rounding on sharp features; the `3d_print` preset sets `target_polycount: 0`, guaranteeing full geometric passthrough without lossy decimation.

### Personal SaaS Workstation Command Center (`app/page.tsx`)
- **Premium Autonomous Portal**: Designed and implemented a responsive, high-performance personal SaaS home page command center replacing the previous redirect.
- **Glassmorphic Navigation & Live Telemetry**: Header features live hardware telemetry querying `/api/v1/system/stats` for real-time VRAM allocation, GPU accelerator status, and direct routing across all application surfaces (`/workspace`, `/workspace/generate`, `/workspace/remesh`, `/workspace/texture`, `/workspace/rigging`, `/outputs`, `/dashboard`, `/system`).
- **Interactive Quick-Launch Hero Console**: Allows typing prompts, toggling pipeline modes, selecting production intent presets (`game_ready`, `cinematic`, `3d_print`, `animation`, `mobile`), and choosing AI models, routing directly into `/workspace/generate` with prefilled query parameters.
- **Bento Tool Grid & Production Presets**: Interactive showcase of the 6 core 3D pipeline engines and the 5 intent contract specifications (face budgets, texture maps, watertightness, LOD counts).
- **Global Keyboard Navigation**: Listens for single-key shortcuts (`G`, `R`, `T`, `U`, `A`, `D`, `O`, `S`) for instant studio routing.

---

### Unique3D Hugging Face Dependency Alignment

- Fixed installation drift where the setup script installed an unpinned latest `datasets` release, then the shared runtime pinned `huggingface_hub==0.25.0`. Newer Datasets versions import `BucketNotFoundError`, which is absent in that Hub version and prevented Unique3D's inference trainer registry from loading.
- Pinned `datasets==3.6.0` consistently in the Unique3D installer and shared backend requirements, without upgrading the shared Hub dependency used by other models.
