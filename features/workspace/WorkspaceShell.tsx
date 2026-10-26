'use client';

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import dynamic from 'next/dynamic';
import { useWorkspace } from './store/WorkspaceContext';
import { TopHeader } from './Header/TopHeader';
import { LeftNavigation } from './Navigation/LeftNavigation';
import { ViewportHUD } from './Viewport/ViewportHUD';


import { HugeiconsIcon } from '@hugeicons/react';
import { Box, Cancel, FolderOpenIcon, PanelLeftClose, PanelLeftOpen, PanelRightOpen, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';
import { settingsPersistence } from '@/services/settingsPersistence';
import { useUIStore } from '@/stores/useUIStore';
// Dynamic imports for heavy 3D components and panels
const MeshViewer = dynamic(() => import('./Viewport/MeshViewer').then(mod => mod.MeshViewer), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-[hsl(var(--surface-0))] animate-pulse" />
});

import { MOTION_FAST, MOTION_SPRING } from '@/lib/motion';

// Dynamic imports for tool panels (loaded on-demand when tool selected)
const GeneratePanel = dynamic(() => import('./Panels/GeneratePanel').then(mod => mod.GeneratePanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const TexturePanel = dynamic(() => import('./Panels/TexturePanel').then(mod => mod.TexturePanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const ActiveJobFloatingCard = dynamic(() => import('./Panels/ActiveJobFloatingCard').then(mod => mod.ActiveJobFloatingCard), {
  ssr: false,
  loading: () => null,
});
const RemeshPanel = dynamic(() => import('./Panels/RemeshPanel').then(mod => mod.RemeshPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const UVUnwrapPanel = dynamic(() => import('./Panels/UVUnwrapPanel').then(mod => mod.UVUnwrapPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const MeshSegmentPanel = dynamic(() => import('./Panels/MeshSegmentPanel').then(mod => mod.MeshSegmentPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const MeshEditPanel = dynamic(() => import('./Panels/MeshEditPanel').then(mod => mod.MeshEditPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const MeshToolsPanel = dynamic(() => import('./Panels/MeshToolsPanel').then(mod => mod.MeshToolsPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const JobDetailView = dynamic(() => import('./Jobs/JobDetailView').then(mod => mod.JobDetailView), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const ViewportToolOverlay = dynamic(() => import('./Viewport/ViewportToolOverlay').then(mod => mod.ViewportToolOverlay), {
  ssr: false,
});

import { RightWorkspacePanel } from './RightPanel/RightWorkspacePanel';

const AnimationLeftPanel = dynamic(() => import('./Animation/AnimationLeftPanel').then(mod => mod.AnimationLeftPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const RiggingLeftPanel = dynamic(() => import('./Rigging/RiggingLeftPanel').then(mod => mod.RiggingLeftPanel), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const MotionLibraryDrawer = dynamic(() => import('./Animation/MotionLibraryDrawer').then(mod => mod.MotionLibraryDrawer), {
  ssr: false,
});

const OutputsPage = dynamic(() => import('./Dashboard/OutputsPage').then(mod => mod.OutputsPage), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const SystemPage = dynamic(() => import('./Dashboard/SystemPage').then(mod => mod.SystemPage), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const StudioDashboard = dynamic(() => import('./Dashboard/StudioDashboard').then(mod => mod.StudioDashboard), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});

const ExportModal = dynamic(() => import('./Modals/ExportModal').then(mod => mod.ExportModal), {
  ssr: false,
});
const SettingsModal = dynamic(() => import('./Modals/SettingsModal').then(mod => mod.SettingsModal), {
  ssr: false,
});
const DccBridgeModal = dynamic(() => import('./Modals/DccBridgeModal').then(mod => mod.DccBridgeModal), {
  ssr: false,
});
import type { ToolType } from './types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

const ROUTE_SEGMENT_TO_TOOL: Record<string, ToolType> = {
  'generate': 'model',
  'model': 'model',
  '3d-gen': 'model',
  'remesh': 'remesh',
  'texture': 'texture',
  'textures': 'texture',
  'uv': 'uv',
  'segment': 'segment',
  'edit': 'edit',
  'pbr': 'tools',
  'animation': 'animation',
  'animate': 'animation',
  'rigging': 'rigging',
  'tools': 'tools',
};

export const WorkspaceShell: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();

  const {
    mainNav, setMainNav, activeTool, setActiveTool,
    rightPanelMode, setRightPanelMode,
    isLeftPanelOpen, isRightPanelOpen,
    setIsLeftPanelOpen, setIsRightPanelOpen,
    navigateToTool, navigateToMainNav,
    currentAsset, isExecuting,
  } = useWorkspace();

  // Mobile menu state: left navigation drawer
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isMobileNavOpen) return;

    const drawer = mobileNavRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = drawer?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements?.[0];
    const lastFocusable = focusableElements?.[focusableElements.length - 1];
    firstFocusable?.focus();

    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !firstFocusable || !lastFocusable) return;

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener('keydown', handleDrawerKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDrawerKeyDown);
      if (previouslyFocused?.isConnected) {
        if (previouslyFocused.getClientRects().length > 0) {
          previouslyFocused.focus();
        } else {
          document.querySelector<HTMLElement>('#left-tool-rail button')?.focus();
        }
      }
    };
  }, [isMobileNavOpen]);

  // Global Workspace Navigation Keyboard Shortcuts (⌘1, ⌘2, ⌘3, ⌘4→Logs, G, R, T, A, S, ⌘,)
  // Global Workspace Navigation Keyboard Shortcuts with Custom Remapping Support (T-04)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting keystrokes in inputs, textareas, or content-editable elements
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const isMac = typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().includes('MAC');
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      const parts: string[] = [];
      if (cmdOrCtrl) parts.push('Ctrl/Cmd');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let mainKey = e.key;
      if (mainKey === ' ') mainKey = 'Space';
      else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
      parts.push(mainKey);
      const pressedCombo = parts.join(' + ').toLowerCase();

      // Read effective shortcuts (defaults + custom overrides)
      const shortcuts = settingsPersistence.getEffectiveShortcuts();

      const matches = (id: string, fallback: string) => {
        const bound = (shortcuts[id] || fallback).toLowerCase();
        return bound === pressedCombo;
      };

      if (matches('nav-dashboard', 'Ctrl/Cmd + 1')) {
        e.preventDefault();
        navigateToMainNav('dashboard');
      } else if (matches('nav-assets', 'Ctrl/Cmd + 2')) {
        e.preventDefault();
        navigateToMainNav('assets');
      } else if (matches('nav-jobs', 'Ctrl/Cmd + 3')) {
        e.preventDefault();
        navigateToMainNav('jobs');
      } else if (matches('nav-logs', 'Ctrl/Cmd + 4')) {
        e.preventDefault();
        router.push('/admin?tab=logs');
      } else if (matches('nav-settings', 'Ctrl/Cmd + ,')) {
        e.preventDefault();
        router.push('/admin?tab=settings');
      } else if (matches('tool-model', 'G')) {
        e.preventDefault();
        navigateToTool('model');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-remesh', 'R')) {
        e.preventDefault();
        navigateToTool('remesh');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-texture', 'T')) {
        e.preventDefault();
        navigateToTool('texture');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-uv', 'U')) {
        e.preventDefault();
        navigateToTool('uv');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-edit', 'E')) {
        e.preventDefault();
        navigateToTool('edit');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-animation', 'A')) {
        e.preventDefault();
        navigateToTool('animation');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-rigging', 'K')) {
        e.preventDefault();
        navigateToTool('rigging');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-segment', 'S')) {
        e.preventDefault();
        navigateToTool('segment');
        setIsLeftPanelOpen(true);
      } else if (matches('command-palette', 'Ctrl/Cmd + K')) {
        e.preventDefault();
        useUIStore.getState().toggleCommandPalette();
      } else if (matches('quick-save', 'Ctrl/Cmd + S')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('saveWorkspaceSnapshotPrompt'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateToMainNav, navigateToTool, router, setIsLeftPanelOpen]);

  useEffect(() => {
    const rawPath = pathname?.toLowerCase() ?? '';
    const cleanPath = rawPath.replace(/\/+$/, ''); // Strip trailing slashes

    // Overview / Dashboard routes
    if (cleanPath === '/workspace/overview' || cleanPath === '/workspace/dashboard' || cleanPath === '/dashboard' || cleanPath === '/') {
      setMainNav('dashboard');
      return;
    }

    // Outputs / Assets routes
    if (cleanPath === '/workspace/assets' || cleanPath === '/workspace/outputs' || cleanPath === '/outputs' || cleanPath === '/assets') {
      setMainNav('assets');
      return;
    }

    // System routes
    if (cleanPath === '/workspace/system' || cleanPath === '/system') {
      setMainNav('system');
      return;
    }

    // Jobs routes: /workspace/jobs or /workspace/jobs/[id] or /jobs
    if (cleanPath.startsWith('/workspace/jobs') || cleanPath === '/jobs') {
      setMainNav('jobs');
      return;
    }

    // Models route: redirect to admin models tab
    if (cleanPath === '/workspace/models' || cleanPath === '/models') {
      router.push('/admin?tab=models');
      return;
    }

    // Rigging routes: /rigging or /workspace/rigging
    if (cleanPath === '/rigging' || cleanPath.startsWith('/rigging')) {
      setMainNav('workspace');
      setActiveTool('rigging');
      return;
    }

    // Animation routes: /animation or /workspace/animation
    if (cleanPath === '/animation' || cleanPath.startsWith('/animation')) {
      setMainNav('workspace');
      setActiveTool('animation');
      return;
    }

    // Workspace tool routes: /workspace/[tool] or /workspace
    setMainNav('workspace');
    if (cleanPath.startsWith('/workspace/')) {
      const toolSegment = cleanPath.replace('/workspace/', '').split('/')[0];
      const matched = ROUTE_SEGMENT_TO_TOOL[toolSegment] || 'model';
      setActiveTool(matched);
    } else if (cleanPath === '/workspace') {
      setActiveTool('model');
    }
  }, [pathname, setMainNav, setActiveTool]);

  // Close mobile nav on tool change
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [activeTool]);

  // Responsive panel management: on tablet/mobile (< 1024px), keep right panel closed by default to give generous 3D canvas room
  useEffect(() => {
    const handleInitialResponsiveLayout = () => {
      if (typeof window !== 'undefined') {
        const width = window.innerWidth;
        if (width < 1024) {
          setIsRightPanelOpen(false);
        }
        if (width < 768) {
          // On mobile, start with clean viewport
          setIsLeftPanelOpen(false);
        }
      }
    };
    handleInitialResponsiveLayout();
  }, [setIsLeftPanelOpen, setIsRightPanelOpen]);

  // Mutually exclusive panel toggles on mobile (< 768px) to prevent messy overlapping panels
  const toggleLeftPanel = useCallback((open: boolean) => {
    if (open && typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsRightPanelOpen(false);
    }
    setIsLeftPanelOpen(open);
  }, [setIsLeftPanelOpen, setIsRightPanelOpen]);

  const toggleRightPanel = useCallback((open: boolean) => {
    if (open && typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsLeftPanelOpen(false);
    }
    setIsRightPanelOpen(open);
  }, [setIsLeftPanelOpen, setIsRightPanelOpen]);

  // Ensure mutual exclusion on mobile resize as well
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && isMobileNavOpen) {
        setIsMobileNavOpen(false);
      }
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        if (isLeftPanelOpen && isRightPanelOpen) {
          setIsRightPanelOpen(false);
        }
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isLeftPanelOpen, isRightPanelOpen, isMobileNavOpen, setIsRightPanelOpen]);



  const renderToolPanel = () => {
    switch (activeTool) {
      case 'model': return <GeneratePanel />;
      case 'remesh': return <RemeshPanel />;
      case 'texture': return <TexturePanel />;
      case 'uv': return <UVUnwrapPanel />;
      case 'segment': return <MeshSegmentPanel />;
      case 'edit': return <MeshEditPanel />;
      case 'animation': return <AnimationLeftPanel />;
      case 'rigging': return <RiggingLeftPanel />;
      case 'tools': return <MeshToolsPanel />;
      case 'pbr': return <MeshToolsPanel />;
      default: return <GeneratePanel />;
    }
  };

  return (
    <div id="forge3d-app-root" className="flex flex-col h-screen w-screen overflow-hidden bg-[hsl(var(--surface-0))] text-[#E0E2E8]">
      <div className="flex-shrink-0 relative z-50">
        <TopHeader onMobileMenuToggle={() => setIsMobileNavOpen(!isMobileNavOpen)} isMobileNavOpen={isMobileNavOpen} />
      </div>
      <div className="flex flex-1 overflow-hidden relative bg-[hsl(var(--surface-1))]">
        {/* Left tool rail - desktop: docked | mobile: hidden (drawer used instead) */}
        <div className="z-30 h-full flex-shrink-0 relative hidden md:block">
          <LeftNavigation />
        </div>

        {/* Mobile navigation drawer overlay */}
        <AnimatePresence>
          {isMobileNavOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileNavOpen(false)}
                className="fixed inset-0 bg-black/60 z-40 md:hidden"
              />
              {/* Drawer */}
              <motion.aside
                ref={mobileNavRef}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={MOTION_SPRING}
                className="fixed left-0 top-0 bottom-0 w-[260px] max-w-[85vw] z-50 md:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Studio navigation"
              >
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between px-3 py-3 bg-[hsl(var(--surface-0))] border-b border-white/[0.08]">
                    <span className="font-extrabold text-xs tracking-wider text-white uppercase">Tools</span>
                    <button
                      type="button"
                      onClick={() => setIsMobileNavOpen(false)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-1))] transition-colors"
                      aria-label="Close navigation menu"
                    >
                      <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[hsl(var(--surface-0))]">
                    <LeftNavigation isMobileDrawer onToolSelect={() => setIsMobileNavOpen(false)} />
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Center Workspace & 3D Stage */}
        <div className="flex-1 h-full relative overflow-hidden min-w-0">
          {/* Continuous Full-Bleed 3D Viewport in Background */}
          {mainNav === 'workspace' && (
            <main id="center-viewport-stage" className="absolute inset-0 z-0 overflow-hidden studio-canvas-vignette">
              <MeshViewer />
              <ViewportToolOverlay />
              <ViewportHUD rightOffset={isRightPanelOpen ? 300 : 32} />

              {/* Clean studio empty-state watermark */}
              {!currentAsset && !isExecuting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-10 text-center px-4">
                  <div className="max-w-md space-y-2.5 opacity-40 transition-opacity duration-300">
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-3 text-[#F5C542]">
                      <HugeiconsIcon icon={Box} size={22} className="stroke-[1.8]" />
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white/90 font-sans">
                      Ready For A New 3D Model?
                    </h2>
                    <p className="text-xs sm:text-sm text-zinc-400 font-sans max-w-sm mx-auto">
                      Instantly generate high-fidelity 3D assets from your reference images
                    </p>
                  </div>
                </div>
              )}
            </main>
          )}

              {/* Floating Context Tool Panel (Left) - Responsive width & mobile sheet */}
              <AnimatePresence initial={false}>
                {mainNav === 'workspace' && isLeftPanelOpen && (
                  <motion.aside
                    id="context-tool-panel-container"
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -15 }}
                    transition={MOTION_FAST}
                    className="absolute inset-x-2 md:inset-auto top-2 bottom-2 md:left-2 md:top-2 md:bottom-2 md:w-[320px] lg:w-[340px] rounded-2xl bg-[#16171B] border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.6)] flex flex-col z-20 overflow-hidden overflow-x-hidden"
                  >
                {/* Mobile panel header with close button */}
                <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08] bg-[hsl(var(--surface-0))] md:hidden flex-shrink-0">
                  <span className="font-bold text-xs text-white">Tool Panel</span>
                  <button
                    type="button"
                    onClick={() => toggleLeftPanel(false)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-primary hover:bg-[hsl(var(--surface-2))] transition-all cursor-pointer"
                    aria-label="Close tool panel"
                  >
                    <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-hidden relative">
                  {/* Floating Collapse Button - desktop only */}
                  <div className="absolute top-2 right-2 z-20 hidden md:block">
                    <SimpleTooltip label="Collapse panel" side="left">
                      <button
                        type="button"
                        onClick={() => toggleLeftPanel(false)}
                        className="p-1 rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-400 hover:text-primary hover:bg-[hsl(var(--surface-3))] transition-all cursor-pointer"
                        aria-label="Collapse tool panel"
                      >
                        <HugeiconsIcon icon={PanelLeftClose} size={16} className="w-3.5 h-3.5" />
                      </button>
                    </SimpleTooltip>
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={activeTool}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 4 }}
                      transition={MOTION_FAST}
                      className="h-full w-full flex flex-col overflow-hidden"
                    >
                      {renderToolPanel()}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Left collapsed toggle button - hidden on mobile */}
          {mainNav === 'workspace' && !isLeftPanelOpen && (
            <div className="absolute left-0.5 top-1/2 -translate-y-1/2 z-20 hidden md:block">
              <SimpleTooltip label="Open Tool Panel">
                <button
                  type="button"
                  onClick={() => toggleLeftPanel(true)}
                  className="w-5 h-11 rounded-r-lg bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-l-0 border-white/[0.1] text-zinc-400 hover:text-primary hover:border-primary/40 hover:bg-[hsl(var(--surface-2))] transition-all flex items-center justify-center shadow-xl cursor-pointer active:scale-95"
                >
                  <HugeiconsIcon icon={PanelLeftOpen} size={16} className="w-3.5 h-3.5" />
                </button>
              </SimpleTooltip>
            </div>
          )}

          {/* Floating Context-Aware Control & Property Panel (Right) - Responsive width & mobile sheet */}
          <AnimatePresence initial={false}>
            {mainNav === 'workspace' && isRightPanelOpen && (
              <motion.aside
                id="right-inspector-assets-column"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={MOTION_FAST}
                className="absolute inset-x-2 md:inset-auto top-2 bottom-2 md:right-2 md:top-2 md:bottom-2 md:w-[280px] rounded-2xl bg-[#16171B] border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.6)] flex flex-col z-20 overflow-hidden"
              >
                {/* Mobile close button for right panel */}
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/[0.08] bg-[hsl(var(--surface-0))] md:hidden flex-shrink-0">
                  <span className="font-bold text-xs text-white">Inspector &amp; Assets</span>
                  <button
                    type="button"
                    onClick={() => toggleRightPanel(false)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-primary hover:bg-[hsl(var(--surface-2))] transition-all cursor-pointer"
                    aria-label="Close inspector and assets panel"
                  >
                    <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
                  </button>
                </div>
                <RightWorkspacePanel />
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Right collapsed toggle button - hidden on mobile */}
          {mainNav === 'workspace' && !isRightPanelOpen && (
            <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-20 hidden md:block">
              <SimpleTooltip label="Open Asset Store / Inspector">
                <button
                  type="button"
                  onClick={() => toggleRightPanel(true)}
                  className="w-5 h-11 rounded-l-lg bg-[hsl(var(--surface-1))]/90 backdrop-blur-md border border-r-0 border-white/[0.1] text-zinc-400 hover:text-primary hover:border-primary/40 hover:bg-[hsl(var(--surface-2))] transition-all flex items-center justify-center shadow-xl cursor-pointer active:scale-95"
                >
                  <HugeiconsIcon icon={PanelRightOpen} size={16} className="w-3.5 h-3.5" />
                </button>
              </SimpleTooltip>
            </div>
          )}

          {/* Mobile: unified bottom quick dock - only shown when both panels are closed to prevent any UI overlapping */}
          {mainNav === 'workspace' && !isLeftPanelOpen && !isRightPanelOpen && (
            <div className="md:hidden absolute bottom-2.5 inset-x-3 z-20 flex items-center justify-between pointer-events-none">
              <button
                type="button"
                onClick={() => toggleLeftPanel(true)}
                className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-black font-black text-xs shadow-xl shadow-black/50 hover:bg-primary/90 transition-all active:scale-95 cursor-pointer border border-primary/40"
                aria-label="Open tool panel"
              >
                <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4 stroke-[2.5]" />
                <span>Tools</span>
              </button>

              <button
                type="button"
                onClick={() => toggleRightPanel(true)}
                className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[hsl(var(--surface-1))]/95 backdrop-blur-md border border-white/[0.15] text-zinc-200 hover:text-white font-bold text-xs shadow-xl shadow-black/50 transition-all active:scale-95 cursor-pointer"
                aria-label="Open inspector and assets"
              >
                <HugeiconsIcon icon={FolderOpenIcon} size={16} className="w-4 h-4 stroke-[2.2] text-primary" />
                <span>Inspector</span>
              </button>
            </div>
          )}
        </div>

        {/* Dashboard/Assets/System overlays with smooth Framer Motion transition - matching exact workspace dimensions */}
        <AnimatePresence mode="wait" initial={false}>
          {mainNav === 'dashboard' && (
            <motion.div
              key="dashboard-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[56px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <StudioDashboard />
            </motion.div>
          )}
          {mainNav === 'assets' && (
            <motion.div
              key="assets-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[56px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <OutputsPage />
            </motion.div>
          )}
          {mainNav === 'system' && (
            <motion.div
              key="system-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[56px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <SystemPage />
            </motion.div>
          )}
          {mainNav === 'jobs' && (
            <motion.div
              key="jobs-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[56px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <JobDetailView onBack={() => setMainNav('workspace')} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <SettingsModal />
      <ExportModal />
      <DccBridgeModal />
      <MotionLibraryDrawer />
      <ActiveJobFloatingCard />
    </div>
  );
};

export default WorkspaceShell;
