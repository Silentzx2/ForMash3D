import { create } from 'zustand';
import { useAppStore } from '@/stores/useAppStore';
import type { ViewerState, ViewerMode } from '@/types';

export type InspectorTab = 'scene' | 'properties' | 'material' | 'lighting' | 'export' | 'logs';
export type BottomDockTab = 'recent' | 'queue' | 'progress' | 'notifications' | 'downloads' | 'history' | 'assets';

interface UIState {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  mobileMenuOpen: boolean;
  mobileLeftSidebarOpen: boolean;
  mobileRightSidebarOpen: boolean;
  viewer: ViewerState;
  inspectorTab: InspectorTab;
  bottomDockTab: BottomDockTab;
  setInspectorTab: (tab: InspectorTab) => void;
  setBottomDockTab: (tab: BottomDockTab) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomPanel: () => void;
  setMobileMenuOpen: (v: boolean) => void;
  setMobileLeftSidebarOpen: (v: boolean) => void;
  setMobileRightSidebarOpen: (v: boolean) => void;
  setViewerMode: (mode: ViewerMode) => void;
  toggleAutoRotate: () => void;
  toggleGrid: () => void;
  toggleWireframe: () => void;
  toggleFullscreen: () => void;
  toggleStats: () => void;
  resetCamera: () => void;
  creativeLayoutMode: boolean;
  toggleCreativeLayoutMode: () => void;
  capabilities: {
    threeDGen: boolean;
    remesh: boolean;
    textureGen: boolean;
  };
  setCapability: (cap: keyof UIState['capabilities'], enabled: boolean) => void;
  rightPanelSections: Record<string, boolean>;
  setRightPanelSections: (sections: Record<string, boolean>) => void;
  setRightPanelSectionExpanded: (sectionId: string, expanded: boolean) => void;
  toggleRightPanelSection: (sectionId: string) => void;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  clonedJobId: string | null;
  setClonedJobId: (id: string | null) => void;
}

let resetCameraCallback: (() => void) | null = null;
export const registerResetCamera = (cb: () => void) => { resetCameraCallback = cb; };

export const useUIStore = create<UIState>()((set) => ({
  get leftSidebarCollapsed() { return useAppStore.getState().leftSidebarCollapsed; },
  get rightSidebarCollapsed() { return useAppStore.getState().rightSidebarCollapsed; },
  get bottomPanelCollapsed() { return useAppStore.getState().bottomPanelCollapsed; },
  get mobileMenuOpen() { return useAppStore.getState().mobileMenuOpen; },
  get mobileLeftSidebarOpen() { return useAppStore.getState().mobileLeftSidebarOpen; },
  get mobileRightSidebarOpen() { return useAppStore.getState().mobileRightSidebarOpen; },
  get viewer() { return useAppStore.getState().viewer; },
  get inspectorTab() { return useAppStore.getState().inspectorTab as InspectorTab; },
  get bottomDockTab() { return useAppStore.getState().bottomDockTab as BottomDockTab; },
  get creativeLayoutMode() { return useAppStore.getState().creativeLayoutMode; },
  get capabilities() { return useAppStore.getState().capabilities as UIState['capabilities']; },
  get rightPanelSections() { return useAppStore.getState().rightPanelSections; },
  get isCommandPaletteOpen() { return useAppStore.getState().isCommandPaletteOpen; },
  get clonedJobId() { return useAppStore.getState().clonedJobId; },

  setClonedJobId: (clonedJobId) => useAppStore.setState({ clonedJobId }),
  setCapability: (cap, enabled) =>
    useAppStore.setState((s) => ({ capabilities: { ...s.capabilities, [cap]: enabled } })),
  setRightPanelSections: (rightPanelSections) => useAppStore.setState({ rightPanelSections }),
  setRightPanelSectionExpanded: (sectionId, expanded) =>
    useAppStore.getState().setRightPanelSectionExpanded(sectionId, expanded),
  toggleRightPanelSection: (sectionId) =>
    useAppStore.getState().toggleRightPanelSection(sectionId),
  setCommandPaletteOpen: (isCommandPaletteOpen) => useAppStore.setState({ isCommandPaletteOpen }),
  toggleCommandPalette: () => useAppStore.getState().toggleCommandPalette(),
  setInspectorTab: (inspectorTab) => useAppStore.setState({ inspectorTab }),
  setBottomDockTab: (bottomDockTab) => useAppStore.setState({ bottomDockTab }),
  toggleLeftSidebar: () => useAppStore.setState((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
  toggleRightSidebar: () => useAppStore.setState((s) => ({ rightSidebarCollapsed: !s.rightSidebarCollapsed })),
  toggleBottomPanel: () => useAppStore.setState((s) => ({ bottomPanelCollapsed: !s.bottomPanelCollapsed })),
  setMobileMenuOpen: (mobileMenuOpen) => useAppStore.setState({ mobileMenuOpen }),
  setMobileLeftSidebarOpen: (mobileLeftSidebarOpen) => useAppStore.setState({ mobileLeftSidebarOpen }),
  setMobileRightSidebarOpen: (mobileRightSidebarOpen) => useAppStore.setState({ mobileRightSidebarOpen }),
  setViewerMode: (mode) =>
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, mode } })),
  toggleAutoRotate: () =>
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, autoRotate: !s.viewer.autoRotate } })),
  toggleGrid: () =>
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, showGrid: !s.viewer.showGrid } })),
  toggleWireframe: () =>
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, showWireframe: !s.viewer.showWireframe } })),
  toggleFullscreen: () =>
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, fullscreen: !s.viewer.fullscreen } })),
  toggleStats: () =>
    useAppStore.setState((s) => ({ viewer: { ...s.viewer, showStats: !s.viewer.showStats } })),
  resetCamera: () => { resetCameraCallback?.(); },
  toggleCreativeLayoutMode: () =>
    useAppStore.setState((s) => ({ creativeLayoutMode: !s.creativeLayoutMode })),
}));

// Mirror app store data into this proxy store so subscribers re-render.
// Shallow-compare each field to avoid unnecessary re-render cascades.
useAppStore.subscribe((state, prevState) => {
  const next: Partial<UIState> = {};
  if (prevState.leftSidebarCollapsed !== state.leftSidebarCollapsed) next.leftSidebarCollapsed = state.leftSidebarCollapsed;
  if (prevState.rightSidebarCollapsed !== state.rightSidebarCollapsed) next.rightSidebarCollapsed = state.rightSidebarCollapsed;
  if (prevState.bottomPanelCollapsed !== state.bottomPanelCollapsed) next.bottomPanelCollapsed = state.bottomPanelCollapsed;
  if (prevState.mobileMenuOpen !== state.mobileMenuOpen) next.mobileMenuOpen = state.mobileMenuOpen;
  if (prevState.mobileLeftSidebarOpen !== state.mobileLeftSidebarOpen) next.mobileLeftSidebarOpen = state.mobileLeftSidebarOpen;
  if (prevState.mobileRightSidebarOpen !== state.mobileRightSidebarOpen) next.mobileRightSidebarOpen = state.mobileRightSidebarOpen;
  if (prevState.viewer !== state.viewer) next.viewer = state.viewer;
  if (prevState.inspectorTab !== state.inspectorTab) next.inspectorTab = state.inspectorTab as InspectorTab;
  if (prevState.bottomDockTab !== state.bottomDockTab) next.bottomDockTab = state.bottomDockTab as BottomDockTab;
  if (prevState.creativeLayoutMode !== state.creativeLayoutMode) next.creativeLayoutMode = state.creativeLayoutMode;
  if (prevState.capabilities !== state.capabilities) next.capabilities = state.capabilities as UIState['capabilities'];
  if (prevState.rightPanelSections !== state.rightPanelSections) next.rightPanelSections = state.rightPanelSections;
  if (prevState.isCommandPaletteOpen !== state.isCommandPaletteOpen) next.isCommandPaletteOpen = state.isCommandPaletteOpen;
  if (prevState.clonedJobId !== state.clonedJobId) next.clonedJobId = state.clonedJobId;
  if (Object.keys(next).length > 0) useUIStore.setState(next);
});