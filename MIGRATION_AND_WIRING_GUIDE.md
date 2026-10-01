# ForMash3D — Migration, Wiring & TypeScript Conversion Guide
> **Source:** `3DGenStudio` (React 19 / Vite / Pure CSS)  
> **Destination:** `ForMash3D` (Next.js 16 App Router / TypeScript / Tailwind CSS "Studio Gold" / Zustand)  
> **Date:** October 1, 2026  
> ⚠️ **STATUS: ACTIVE DEVELOPMENT PHASE** — This repository is undergoing active experimental migration and feature integration. Modules from 3DGenStudio are staged under `features/` for review, architectural alignment, and progressive TypeScript conversion.

---

## 0. Two-Way PostProcess Architecture & Microservice (Port 8200)

The production post-processing pipeline in ForMash3D operates in **two distinct execution modes**:

### Mode 1: Automatic AI Generation Chaining
When an AI generative model (`text_to_raw_mesh`, `image_to_raw_mesh`, `text_to_textured_mesh`, etc.) produces a raw 3D mesh:
1. `backend/core/scheduler/multiprocess_scheduler.py` (lines 1177–1235) intercepts the completed inference result.
2. It automatically invokes `postprocess.pipeline.run_postprocess_job` in a non-blocking background thread.
3. The job performs canonical production passes:
   * **Manifold Repair & Hole Filling:** Cleans zero-area faces and non-manifold edges.
   * **Automated Quad/Tri Retopology:** Decimates and optimizes polycount.
   * **Parametric UV Unwrapping:** Generates distortion-minimized seams and packs atlas.
   * **Multi-LOD Optimization:** Employs `meshoptimizer` to generate LOD0–LOD3.
   * **Physics Collision Hulls:** Computes convex hulls and discrete bounding geometry.
   * **Format Conversion:** Generates production GLB, OBJ, and game-ready snapshots.
4. Telemetry is streamed to `features/workspace/store/WorkspaceContext.tsx` (lines 1416–1435) until all production artifacts are loaded into the viewer.

### Mode 2: Manual User-Triggered PostProcess
Users can also invoke post-processing on demand at any time without running AI generation:
1. **Target Selection or Instant Upload:** Users can select any existing workspace mesh or click **"Upload"** directly in `RemeshPanel.tsx`, `UVUnwrapPanel.tsx`, or `MeshSegmentPanel.tsx` to load an external `.glb`, `.obj`, `.stl`, or `.ply` file.
2. **Dedicated Endpoints:**
   * Quad Remesh & Retopo: `POST /api/v1/mesh-retopology/retopologize-mesh`
   * Smart UV Unwrapping: `POST /api/v1/mesh-uv-unwrapping/unwrap-mesh`
   * Semantic Mesh Segmentation: `POST /api/v1/mesh-segmentation/segment-mesh`
3. **Progress Tracking:** The job is queued in the background, reported via the bottom execution status bar, and automatically bound to the 3D viewer upon completion.

### Microservice Isolation (Port 8200)
For standalone high-throughput pipelines, the processing engine can also run as an isolated microservice:
* **Directory:** `backend/postprocess/`
* **Entrypoint:** `backend/postprocess/main.py` (FastAPI with Uvicorn)
* **Launcher Script:** `scripts/start_postprocess_service.sh`
* **Dedicated Port:** `MESHTOOLS_PORT=8200`
* **Key Microservice Endpoints:** `POST /api/meshes/auto-uv`, `POST /api/meshes/auto-retopo`, `POST /api/meshes/repair`, `POST /api/meshes/bake`, `POST /api/meshes/collision`, `POST /api/meshes/segment`.

> 💡 **Note on AI Generation:** ForMash3D does **NOT** use ComfyUI. All AI generations run through native VRAM-aware multiprocess schedulers and adapters (`TRELLIS`, `Hunyuan3D-2.1`, `TripoSR`, `FastMesh`).

---

## 1. Overview of Migrated Features & Assets

All essential UI components, pages, hooks, utilities, and assets from `3DGenStudio` have been organized into modular feature slices under `ForMash3D/features/` with **zero collisions** against existing ForMash3D components (e.g. `MeshViewer.tsx` has been strictly preserved).

### Inventory of Migrated Modules:

| Module / Feature | Location in ForMash3D | Description & Primary Files |
|---|---|---|
| **VFX Studio** | `features/vfx/` | Complete particle node graph (`VfxBoard`), WebGL runtime (`useVfxRuntime`), Timeline (`VfxTimeline`), Bezier/Gradient editors (`VfxCurveEditor`, `VfxGradientEditor`), Spritesheet dialog, Presets dialog, and master page `VfxEditorPage.jsx`. |
| **VFX Resources & Assets** | `public/resources/vfx/` & `resources/vfx/` | Particle presets, textures, flipbooks, spritesheets, and thumbnails served statically at `/resources/vfx/...`. |
| **Procedural Building Studio** | `features/building/` | 2D vector floor plan polygon drawer (`BuildingPlanEditor`), 3D building viewport (`BuildingViewport`), Grammar inspector (`BuildingInspector`), Style packs, and master page `BuildingGenPage.jsx`. |
| **Building Engine & Resources** | `building/` & `public/resources/buildings/` | Procedural building compiler, grammar solver, clipping algorithms (`clip.js`, `compile.js`, `stylepack.js`), and textures. |
| **Procedural Tree Studio** | `features/tree/` | Procedural tree parameters (`TreeParamPanel`), dual-preview skeleton/mesh viewport (`TreeViewport`), bark/foliage textures (`TreeTexturePanel`), leaf pivot dialog (`LeafPivotDialog`), and master page `TreeGenPage.jsx`. |
| **Character & Garment Assembly** | `features/assembly/` | Multi-mesh kitbashing studio (`AssemblyPage.jsx`), Conformal garment fitting (`AssemblyFitPanel.jsx`), Anatomical 3D landmark pins (`AssemblyLandmarkPanel.jsx`), and Atlas texture baker (`AssemblySaveDialog.jsx`). |
| **Advanced Sculpt & Paint** | `features/sculpt-paint/` | Interactive 3D sculpting brushes (`SculptToolsPanel.jsx`, `meshSculpt.js`), 3D surface paint with Photoshop ABR brushes (`PaintingToolsPanel.jsx`, `meshPaintTexture.js`), multi-view orbital projection baking (`gpuTextureBake.js`), and CSG Booleans (`BooleanToolsPanel.jsx`, `three-bvh-csg`). |
| **Mesh Segmentation & Modeling** | `features/mesh-extras/` | Semantic mesh segmentation panel (`SegmentationToolsPanel.jsx`, `meshSegment.js`), Quad retopo controls (`AutoRetopoToolsPanel.jsx`), Auto UV controls (`AutoUvToolsPanel.jsx`), and Mesh repair (`ModelingToolsPanel.jsx`). |
| **Visual Workflow Graph** | `features/graph/` | Visual node pipeline editor (`GraphPage.jsx`, `GraphAssetNode.jsx`, `@xyflow/react`) for chaining Image Gen → 3D Shape → Retopo → Texture → Rigging visually. |
| **2D Texture & Image Editor** | `features/image-editor/` | Multi-layer canvas editor (`ImageEditorPage.jsx`), GPU shadow remover (`shadowRemoverGPU.js`), and seamless texture generator (`seamlessTexture.js`). |
| **Ideation Whiteboard & Wiki** | `features/board/` & `features/wiki/` | Freehand drawing concept board (`BoardPage.jsx`, Excalidraw integration) and in-app markdown documentation browser (`WikiPage.jsx`, `MarkdownContent.jsx`, `content/`). |
| **Mesh Extras & Dialogs** | `features/mesh-extras/` | Advanced multi-format mesh exporter (`ExportMeshDialog.jsx`), gltfpack LOD generator (`OptimizeToolsPanel.jsx`), PBR map baker (`BakeToolsPanel.jsx`), game readiness audit (`GameReadyPanel.jsx`), and ViewGizmo (`ViewGizmo.jsx`). |
| **Game Engine Export Plugins** | `plugins/unity/` & `plugins/unreal/` | Unity VFX Graph package (`com.3dgenstudio.vfx-import`) and Unreal Niagara plugin (`VfxImport.uplugin`). |
| **VFX Architecture Docs** | `Docs/VFX_*.md` | 5 comprehensive architecture documents detailing VFX IR, export bundle specifications, engine mappings, graph schemas, and plugin setups. |

---

## 2. High-Value Functions to Merge into Existing ForMash3D Panels

Rather than just keeping these files separate, certain algorithms in `3DGenStudio` are **superior** to what currently exists in ForMash3D and should be selectively grafted into ForMash3D's existing UI panels:

### 1. Interactive Sculpting vs Only Neural Inpainting
* **Current ForMash3D:** `features/workspace/Panels/MeshEditPanel.tsx` only offers neural inpainting via text/image prompts with a coarse bounding box.
* **Superior 3DGenStudio Feature:** `features/sculpt-paint/utils/meshSculpt.js` & `SculptToolsPanel.jsx`.
* **Action:**
  * Add a tab labeled **"Sculpt Brushes"** inside `MeshEditPanel.tsx`.
  * Wire the 7 sculpt brushes: `Standard`, `Clay`, `Flatten`, `Grab`, `Inflate`, `Pinch`, `Smooth`.
  * Support bilateral symmetry (`symmetryX: true`) by mirroring vertex displacement rays across the X-axis.

### 2. Viewport 3D Texture Painting & GPU UV Baking
* **Current ForMash3D:** `features/workspace/Panels/TexturePanel.tsx` generates entire textures from scratch using Hunyuan3D-Paint-v2.1. There is no way to paint touch-ups directly on the 3D model.
* **Superior 3DGenStudio Feature:** `features/sculpt-paint/utils/meshPaintTexture.js` & `gpuTextureBake.js`.
* **Action:**
  * Add an **"Interactive Paint"** sub-tool inside `TexturePanel.tsx`.
  * Allows users to select brush size, color, hardness, opacity, or load custom Photoshop brushes (`brushAbr.js`).
  * `gpuTextureBake.js` renders screen-space projections onto the mesh's UV coordinates via WebGL shaders without needing Python server roundtrips.

### 3. CSG Boolean Geometry (Cut, Union, Subtract)
* **Current ForMash3D:** No boolean modeling capabilities exist in the workspace.
* **Superior 3DGenStudio Feature:** `features/sculpt-paint/components/BooleanToolsPanel.jsx` & `utils/meshBooleanGeometry.js` (powered by `three-bvh-csg`).
* **Action:**
  * Integrate into `MeshEditPanel.tsx` or a new "Booleans" tool in `LeftNavigation.tsx`.
  * Provides real-time preview of geometric union, subtraction, and intersection stamps on 3D meshes.

### 4. Game-Ready Audit & Multi-LOD gltfpack Export
* **Current ForMash3D:** `features/workspace/Modals/ExportModal.tsx` provides basic GLB/OBJ/FBX export without automated LOD chains or draw call audits.
* **Superior 3DGenStudio Feature:** `features/mesh-extras/ExportMeshDialog.jsx`, `OptimizeToolsPanel.jsx`, and `GameReadyPanel.jsx`.
* **Action:**
  * Upgrade `ExportModal.tsx` with:
    1. **Automated LOD Chains:** Automatically run `meshoptimizer` to generate LOD0 (100%), LOD1 (50%), LOD2 (25%), LOD3 (10%).
    2. **Physics Collider Generation:** Generate Convex Hull or Oriented Bounding Box (OBB) colliders directly in the export bundle.
    3. **Audit Metrics:** Compute draw calls, non-manifold edges, UV overlap percentages, and texture memory consumption.

### 5. Automated Garment Conformal Fitting
* **Current ForMash3D:** Only single-mesh generation and editing.
* **Superior 3DGenStudio Feature:** `features/assembly/utils/assemblyFit.js` & `backend/postprocess/app/services/assemblyfit/`.
* **Action:**
  * Enables kitbashing: import clothes/armor onto an avatar base, automatically conform garments to avoid mesh clipping, transfer skin weights, and bake all materials into a unified single-texture atlas.

---

## 3. Next.js App Router Wiring Guide

To expose these new studios in ForMash3D, wire them into Next.js App Router using one of two patterns:

### Pattern A: Dedicated Tool Views inside `<WorkspaceShell />` (Recommended)
This retains the top navigation bar, status indicators, and unified layout.

1. **Update `LeftNavigation.tsx` (`features/workspace/Navigation/LeftNavigation.tsx`):**
   Add entries for the new tools:
   ```typescript
   { id: 'vfx', label: 'VFX Studio', icon: Sparkles },
   { id: 'tree', label: 'Tree Studio', icon: Trees },
   { id: 'building', label: 'Building Studio', icon: Building2 },
   { id: 'assembly', label: 'Assembly Studio', icon: Shirt },
   { id: 'graph', label: 'Node Flow', icon: GitFork },
   ```

2. **Update `WorkspaceShell.tsx` (`features/workspace/WorkspaceShell.tsx`):**
   Render the new feature workspace when the active tool matches:
   ```tsx
   {activeTool === 'vfx' && <VfxEditorPage />}
   {activeTool === 'tree' && <TreeGenPage />}
   {activeTool === 'building' && <BuildingGenPage />}
   {activeTool === 'assembly' && <AssemblyPage />}
   {activeTool === 'graph' && <GraphPage />}
   ```

### Pattern B: Standalone Routes (For full-window workflows)
Create new routes in `app/`:
- `app/vfx/page.tsx` -> renders `VfxEditorPage`
- `app/buildings/page.tsx` -> renders `BuildingGenPage`
- `app/trees/page.tsx` -> renders `TreeGenPage`
- `app/assembly/page.tsx` -> renders `AssemblyPage`
- `app/board/page.tsx` -> renders `BoardPage`
- `app/wiki/page.tsx` -> renders `WikiPage`

Example `app/vfx/page.tsx`:
```tsx
'use client';

import dynamic from 'next/dynamic';

const VfxEditorPage = dynamic(
  () => import('@/features/vfx/pages/VfxEditorPage'),
  { ssr: false }
);

export default function VfxRoute() {
  return (
    <main className="w-screen h-screen bg-[#080808] overflow-hidden">
      <VfxEditorPage />
    </main>
  );
}
```

---

## 4. JavaScript to TypeScript Conversion Roadmap

When converting `.jsx` and `.js` files to `.tsx` and `.ts`:

### 1. Add `'use client'` Directive
Since these components use browser APIs (`window`, `localStorage`, `HTMLCanvasElement`, WebGL, EventSource), every page and interactive component MUST start with:
```tsx
'use client';
```

### 2. Common Type Definitions Needed
Create `types/vfx.ts`, `types/building.ts`, and `types/assembly.ts`:

#### `types/vfx.ts`:
```typescript
export interface VfxBlock {
  id: string;
  type: string;
  category: 'spawn' | 'initialize' | 'update' | 'output';
  params: Record<string, number | string | boolean | number[]>;
  enabled?: boolean;
}

export interface VfxContextNodeData {
  title: string;
  contextType: 'spawn' | 'initialize' | 'update' | 'output';
  blocks: VfxBlock[];
}

export interface VfxGraphIR {
  version: string;
  metadata: { name: string; author?: string; tags?: string[] };
  systems: Array<{
    id: string;
    capacity: number;
    contexts: Record<string, VfxBlock[]>;
  }>;
}
```

#### `types/building.ts`:
```typescript
export interface BuildingPoint {
  x: number;
  y: number;
}

export interface BuildingPolygon {
  id: string;
  points: BuildingPoint[];
  height?: number;
  storeys?: number;
}

export interface BuildingStyleConfig {
  style: string;
  roofType: 'flat' | 'hip' | 'gabled' | 'mansard';
  facadeTexture: string;
  wallTexture: string;
}
```

#### `types/assembly.ts`:
```typescript
export interface AssemblyPiece {
  id: string;
  name: string;
  fileUrl: string;
  role: 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory';
  visible: boolean;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
}
```

---

## 5. UI & Theme Adaptation (Tailwind CSS "Studio Gold")

3DGenStudio used pure CSS with dark blue/cyan variables and Material Symbols. Adapt them to ForMash3D's design system:

### 1. Color Palette Mapping:
| 3DGenStudio Variable | ForMash3D Tailwind Class / Token | Value |
|---|---|---|
| `var(--surface)` / `var(--surface-container-lowest)` | `bg-[#080808]` / `bg-surface-0` | Canvas base |
| `var(--surface-container)` | `bg-[#121212]` / `bg-surface-1` | Sidebar / Cards |
| `var(--surface-container-high)` | `bg-[#1c1c1c]` / `bg-surface-2` | Inputs / Hover states |
| `var(--surface-container-highest)` | `bg-[#242424]` / `bg-surface-3` | Active tab / Border |
| `var(--primary)` / `var(--primary-dim)` | `text-[#FFCC00]` / `text-gold` / `bg-[#FFCC00]` | Studio Gold Accent |
| `var(--on-surface)` | `text-neutral-100` | Primary text |
| `var(--on-surface-variant)` | `text-neutral-400` | Secondary text / Muted |

### 2. Icon Replacement:
Replace Material Symbols with **Lucide Icons**:
```tsx
// ❌ 3DGenStudio:
<span className="material-symbols-outlined">play_arrow</span>

//  ForMash3D:
import { Play } from 'lucide-react';
<Play className="w-4 h-4 text-primary" />
```

---

## 6. State Management & API Client Integration

### Connecting to ForMash3D Zustand Stores:
Instead of React Context from 3DGenStudio, connect components to ForMash3D's stores:
- **`useViewerStore` (`stores/useViewerStore.ts`):** Bind loaded mesh URL (`modelUrl`), shading mode (`shadingMode`), camera views, and stats.
- **`useAppStore` (`stores/useAppStore.ts`):** Bind prompts, generation queue, active task progress, and layer lists.
- **`WorkspaceContext` (`features/workspace/store/WorkspaceContext.tsx`):** Access active tool, drawer states, and project ID.

### Connecting to FastAPI Backend (:7842):
Replace Express `:3000` / Python `:8200` fetch calls with `services/apiClient.ts`:
```typescript
import apiClient from '@/services/apiClient';

// Example: Auto Retopo
const response = await apiClient.post('/meshes/auto-retopo', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```

---

## 7. Known Bugs, Warnings & Critical Notes

1. **`backend/postprocess` Directory Case Sensitivity**:
   - The directory must remain lowercase `backend/postprocess` on Linux.
   - Core scheduler file `backend/core/scheduler/multiprocess_scheduler.py` expects `from postprocess.pipeline import run_postprocess_job`.
   - The original `pipeline.py`, `physics.py`, and `simplify.py` have been restored alongside the new `app/` service modules.
2. **React 19 & Next.js 16 Dynamic Imports**:
   - Canvas-heavy libraries (`three`, `@xyflow/react`, `@excalidraw/excalidraw`) fail if rendered server-side.
   - **Always wrap them in `dynamic(() => import(...), { ssr: false })`**.
3. **Static Resource Paths**:
   - Preset assets and textures are placed in `public/resources/vfx/` and `public/resources/buildings/`.
   - In Next.js, references to `http://localhost:3000/resources/vfx/...` should be changed to root-relative paths: `/resources/vfx/...`.
4. **Missing CLI Dependencies**:
   - Added `@xyflow/react`, `clipper-lib`, `three-mesh-bvh`, `three-bvh-csg`, `meshoptimizer`, and `@types/three` into `ForMash3D/package.json`.
   - Run `bun install` or `npm install` before launching dev server.

---

## 8. Summary of Migration Actions Completed

- [x] Full sync of VFX engine, plugins, probe scripts, presets, and documentation.
- [x] Full migration of VFX Studio UI (`features/vfx/`).
- [x] Live 3D particle simulation viewport dock wired into `VfxStudio.tsx` (`VfxViewport`, R3F Canvas, Grid, CameraRig, HUD telemetry).
- [x] Injected interactive "Sculpt Brushes" into `features/workspace/Panels/MeshEditPanel.tsx` (7 brushes, bilateral symmetry, stroke stabilizer, and falloff).
- [x] Injected interactive "3D Surface Paint" into `features/workspace/Panels/TexturePanel.tsx` (draw/erase modes, color swatches, opacity, flow, tip shapes, and GPU bake trigger).
- [x] Integrated instant 3D mesh upload into `features/workspace/Panels/RemeshPanel.tsx`.
- [x] Verified and documented Two-Way PostProcess Pipeline (Automatic AI trigger + Manual user panel trigger).
- [x] Full migration of Procedural Tree Studio UI (`features/tree/`).
- [x] Full migration of Procedural Building Studio UI & compiler (`features/building/`, `building/`).
- [x] Full migration of Character Assembly & Garment Fit UI (`features/assembly/`).
- [x] Full migration of Advanced Sculpting Brushes, 3D Paint, and CSG Booleans (`features/sculpt-paint/`).
- [x] Full migration of Visual Workflow Node Graph (`features/graph/`).
- [x] Full migration of 2D Image Editor & Inpainter (`features/image-editor/`).
- [x] Full migration of Concept Whiteboard & Wiki (`features/board/`, `features/wiki/`).
- [x] Full migration of Mesh Extras: LOD optimizer, PBR bake, game-ready audit (`features/mesh-extras/`).
- [x] Added all missing npm dependencies to `package.json`.
- [x] Preserved all existing ForMash3D components without duplication or overwriting.

---

## 9. Relative Import Resolution Matrix (For Developer / Next AI)

When converting `.jsx` files to `.tsx`, 3DGenStudio relative imports should be refactored to use Next.js TypeScript root aliases (`@/...`):

| 3DGenStudio Import | ForMash3D Target / Replacement | Notes |
|---|---|---|
| `import ... from '../components/Header'` | **REMOVE** | Do not render Header inside tools; ForMash3D's `TopHeader.tsx` is globally rendered by `WorkspaceShell`. |
| `import ... from '../components/Footer'` | **REMOVE** | Replaced by ForMash3D's status bar in `WorkspaceShell`. |
| `import ... from '../components/SettingsModal'` | **REMOVE** | Use ForMash3D's `features/settings/SettingsModal.tsx`. |
| `import ... from '../context/ProjectContext'` | `import { useWorkspace } from '@/features/workspace/store/WorkspaceContext'` & `useAppStore` | Map project assets, selections, and jobs to ForMash3D Zustand stores. |
| `import ... from '../config'` or `'../../config'` | `import { SERVER_ORIGIN, API_BASE, assetUrl, resourceUrl } from '@/features/config'` | Use the new compatibility bridge at `features/config.js`. |
| `import ... from '../../vfx/...'` | `import ... from '@/vfx/...'` | Points to the root `vfx/` engine in ForMash3D. |
| `import ... from '../../building/...'` | `import ... from '@/building/...'` | Points to the root `building/` compiler in ForMash3D. |
| `import ... from '../meshEditor/CameraRig'` | Use ForMash3D `MeshViewer` or `@/features/mesh-extras/CameraRig` | For standalone 3D canvases, use `CameraRig` from `mesh-extras`; for workspace tools, prefer ForMash3D's native `MeshViewer`. |
| `import ... from '../meshEditor/ViewportCameras'` | `import ViewportCameras from '@/features/mesh-extras/ViewportCameras'` | Present in `features/mesh-extras/`. |
| `import ... from '../meshEditor/ViewGizmo'` | `import ViewGizmo from '@/features/mesh-extras/ViewGizmo'` | Present in `features/mesh-extras/`. |
| `import ... from '../FolderBrowserDialog'` | `import FolderBrowserDialog from '@/features/mesh-extras/FolderBrowserDialog'` | Present in `features/mesh-extras/`. |
| `import ... from '../ProjectIODialog.css'` | `import '@/features/mesh-extras/ProjectIODialog.css'` | Present in `features/mesh-extras/`. |
| `import ... from '../../utils/vfx/...'` | `import ... from '@/features/vfx/utils/...'` | Present in `features/vfx/utils/` and `features/utils/vfx/`. |
| `import ... from '../../utils/assembly...'` | `import ... from '@/features/assembly/utils/...'` | Present in `features/assembly/utils/` and `features/utils/`. |
| `import ... from '../../utils/ids'` | `import { createId } from '@/features/utils/ids'` | Present in `features/utils/ids.js`. |
| `import ... from '../../hooks/useVfx...'` | `import ... from '@/features/vfx/hooks/...'` | Present in `features/vfx/hooks/` and `features/hooks/`. |

