import { create } from 'zustand';

export interface AssetItem {
  id: string;
  name: string;
  prompt: string;
  format: string;
  timestamp: string;
  thumbnailUrl?: string | null;
  modelUrl?: string | null;
  isFavorite?: boolean;
  job?: { id: string; status: string; prompt: string; result?: { downloadUrls?: { glb?: string; obj?: string } } };
  type?: 'image' | 'model';
}

export type ShadingPreset = 'default' | 'clay' | 'metallic' | 'wireframe' | 'normal' | 'gold' | 'cyberpunk' | 'uv';

export interface ModelMeshStats {
  vertices: number;
  triangles: number;
  dimensions: { x: number; y: number; z: number };
  surfaceArea?: number;
  volume?: number;
  isManifold?: boolean;
  nonManifoldEdges?: number;
  boundaryEdges?: number;
  uvCharts?: number;
}

export interface RigInfo {
  boneCount: number;
  jointHierarchy: string;
  rigWeightMap: 'Complete' | 'Partial' | 'None' | string;
}

export interface AnimationInfo {
  preset: string;
  speed: number;
  isPlaying: boolean;
  duration: number;
  fps?: number;
  frameCount?: number;
}

export type ContextTabType = 'assets' | 'inspector' | 'materials' | 'jobs';

export interface CompareCameraState {
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Global persistent 3D workspace viewer store.
 * Holds canonical loaded model, viewport camera, mesh statistics,
 * material shading state, and context panel tab.
 */
interface ViewerState {
  loadedModelUrl: string | null;
  loadedModelName: string | null;
  selectedAsset: AssetItem | null;
  modelStats: ModelMeshStats | null;
  shadingMode: ShadingPreset;
  wireframeOverlay: boolean;
  activeContextTab: ContextTabType;
  viewport: { cameraPosition: [number, number, number]; target: [number, number, number] } | null;
  compareMode: boolean;
  compareSyncCamera: boolean;
  compareLeftAssetId: string | null;
  compareRightAssetId: string | null;

  setLoadedModel: (url: string | null, name?: string | null, asset?: AssetItem | null) => void;
  setSelectedAsset: (asset: AssetItem | null) => void;
  setModelStats: (stats: ModelMeshStats | null) => void;
  setShadingMode: (mode: ShadingPreset) => void;
  setWireframeOverlay: (enabled: boolean) => void;
  toggleWireframeOverlay: () => void;
  setActiveContextTab: (tab: ContextTabType) => void;
  setViewport: (viewport: { cameraPosition: [number, number, number]; target: [number, number, number] }) => void;
  setCompareMode: (enabled: boolean) => void;
  setCompareSyncCamera: (enabled: boolean) => void;
  setCompareLeftAsset: (assetId: string | null) => void;
  setCompareRightAsset: (assetId: string | null) => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  loadedModelUrl: null,
  loadedModelName: null,
  selectedAsset: null,
  modelStats: null,
  shadingMode: 'default',
  wireframeOverlay: false,
  activeContextTab: 'assets',
  viewport: null,
  compareMode: false,
  compareSyncCamera: false,
  compareLeftAssetId: null,
  compareRightAssetId: null,

  setLoadedModel: (url, name = null, asset = null) => {
    const prev = get().loadedModelUrl;
    if (prev && prev !== url && prev.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prev);
      } catch {
        /* ignore */
      }
    }
    set({
      loadedModelUrl: url,
      loadedModelName: name,
      selectedAsset: asset !== undefined ? asset : get().selectedAsset,
    });
  },

  setSelectedAsset: (asset) => set({ selectedAsset: asset }),
  setModelStats: (stats) => set({ modelStats: stats }),
  setShadingMode: (shadingMode) => set({ shadingMode }),
  setWireframeOverlay: (wireframeOverlay) => set({ wireframeOverlay }),
  toggleWireframeOverlay: () => set((s) => ({ wireframeOverlay: !s.wireframeOverlay })),
  setActiveContextTab: (activeContextTab) => set({ activeContextTab }),
  setViewport: (viewport) => set({ viewport }),
  setCompareMode: (compareMode) => set({ compareMode }),
  setCompareSyncCamera: (compareSyncCamera) => set({ compareSyncCamera }),
  setCompareLeftAsset: (compareLeftAssetId) => set({ compareLeftAssetId }),
  setCompareRightAsset: (compareRightAssetId) => set({ compareRightAssetId }),
}));

/** Single entry point used by panels / drag-drop to load a model everywhere. */
export function loadModelInViewer(url: string, name?: string | null, asset?: AssetItem | null) {
  useViewerStore.getState().setLoadedModel(url, name ?? null, asset ?? null);
  // Keep the legacy window event for any listener that hasn't migrated.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('load-glb-model', { detail: { url, name: name ?? null } }));
  }
}


