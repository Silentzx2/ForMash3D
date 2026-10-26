'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CameraIcon,
  CheckIcon,
  GridIcon,
  HelpCircleIcon,
  LayersIcon,
  Cancel,
} from '@hugeicons/core-free-icons';
import { DEFAULT_WORKSPACE_SHORTCUTS } from '@/services/settingsPersistence';

interface ViewportHUDProps {
  rightOffset?: number;
  className?: string;
}

export const ViewportHUD: React.FC<ViewportHUDProps> = ({ rightOffset = 16, className = '' }) => {
  const {
    shadingMode,
    setShadingMode,
    showWireframe,
    setShowWireframe,
    showGrid,
    setShowGrid,
    resetCamera,
    isRightPanelOpen,
  } = useWorkspace();

  const [shadingMenuOpen, setShadingMenuOpen] = useState(false);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [hotkeysModalOpen, setHotkeysModalOpen] = useState(false);

  const shadingMenuRef = useRef<HTMLDivElement>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);

  // Close flyout menus on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (shadingMenuRef.current && !shadingMenuRef.current.contains(target)) {
        setShadingMenuOpen(false);
      }
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(target)) {
        setCameraMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShadingMenuOpen(false);
        setCameraMenuOpen(false);
        setHotkeysModalOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelectShading = (mode: 'pbr' | 'clay' | 'wireframe' | 'matcap') => {
    switch (mode) {
      case 'pbr':
        setShadingMode('textured');
        setShowWireframe(false);
        toast.info('Shading: PBR Textured');
        break;
      case 'clay':
        setShadingMode('clay');
        setShowWireframe(false);
        toast.info('Shading: Clay / Untextured');
        break;
      case 'wireframe':
        setShowWireframe(true);
        toast.info('Shading: Wireframe Overlay');
        break;
      case 'matcap':
        setShadingMode('matcap-chrome');
        setShowWireframe(false);
        toast.info('Shading: Chrome Matcap');
        break;
    }
    setShadingMenuOpen(false);
  };

  const handleCameraPreset = (preset: 'reset' | 'front' | 'side' | 'top') => {
    if (preset === 'reset') {
      resetCamera();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('setCameraPreset', { detail: 'perspective' }));
      }
      toast.info('Camera: Reset (Perspective)');
    } else {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('setCameraPreset', { detail: preset }));
      }
      const label = preset.charAt(0).toUpperCase() + preset.slice(1);
      toast.info(`Camera: ${label} View`);
    }
    setCameraMenuOpen(false);
  };

  const handleToggleGrid = () => {
    const next = !showGrid;
    setShowGrid(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toggleGrid'));
    }
    toast.info(next ? 'Ground Grid: Visible' : 'Ground Grid: Hidden');
  };

  // Group shortcuts by category for modal
  const shortcutCategories = [
    { id: 'tools', title: 'Generative 3D Tools' },
    { id: 'viewport', title: '3D Viewport & Navigation' },
    { id: 'general', title: 'Global Shortcuts' },
    { id: 'navigation', title: 'Workspace Switcher' },
  ];

  return (
    <>
      {/* Floating Vertical Tool Pill */}
      <aside
        id="viewport-hud-pill"
        style={{ right: `${rightOffset}px` }}
        className={`absolute top-1/2 -translate-y-1/2 z-20 hidden md:flex flex-col gap-2 p-1.5 rounded-full bg-[#16171B]/90 backdrop-blur-md border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.6)] select-none transition-all duration-200 pointer-events-auto ${className}`}
        aria-label="Viewport controls"
      >
        {/* [ ⚙️ Shading Mode ] */}
        <div ref={shadingMenuRef} className="relative">
          <SimpleTooltip label="Shading Mode (PBR, Clay, Wireframe, Matcap)" side="left">
            <button
              type="button"
              id="btn-hud-shading-mode"
              onClick={() => {
                setShadingMenuOpen(!shadingMenuOpen);
                setCameraMenuOpen(false);
              }}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                shadingMenuOpen || showWireframe
                  ? 'bg-[#F5C542] text-black shadow-[0_0_12px_rgba(245,197,66,0.4)]'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              aria-label="Shading Mode"
            >
              <HugeiconsIcon icon={LayersIcon} size={18} className="w-4 h-4 stroke-[2]" />
            </button>
          </SimpleTooltip>

          {/* Shading Flyout Menu */}
          {shadingMenuOpen && (
            <div className="absolute right-full mr-2.5 top-0 w-44 p-1.5 rounded-2xl bg-[#16171B]/95 backdrop-blur-xl border border-white/[0.06] shadow-[0_12px_36px_rgba(0,0,0,0.7)] z-50 animate-in fade-in zoom-in-95">
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Shading Mode
              </div>
              {[
                { id: 'pbr' as const, label: 'PBR Textured', active: (shadingMode === 'textured' || shadingMode === 'pbr') && !showWireframe },
                { id: 'clay' as const, label: 'Clay / Untextured', active: shadingMode === 'clay' && !showWireframe },
                { id: 'wireframe' as const, label: 'Wireframe', active: showWireframe || shadingMode === 'wireframe' },
                { id: 'matcap' as const, label: 'Matcap (Chrome)', active: shadingMode.startsWith('matcap') && !showWireframe },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectShading(item.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    item.active
                      ? 'bg-[#1D1F26] text-[#F5C542] font-semibold'
                      : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.active && <HugeiconsIcon icon={CheckIcon} size={14} className="w-3.5 h-3.5 text-[#F5C542]" />}
                </button>
              ))}

              <div className="my-1 border-t border-white/[0.06]" />
              <button
                type="button"
                id="btn-hud-environment-settings"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('toggleEnvironmentPanel'));
                  }
                  setShadingMenuOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
              >
                <span>Environment &amp; Lights</span>
              </button>
            </div>
          )}
        </div>

        {/* [ 📷 Camera Presets ] */}
        <div ref={cameraMenuRef} className="relative">
          <SimpleTooltip label="Camera Presets (Reset, Front, Side, Top)" side="left">
            <button
              type="button"
              id="btn-hud-camera-presets"
              onClick={() => {
                setCameraMenuOpen(!cameraMenuOpen);
                setShadingMenuOpen(false);
              }}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                cameraMenuOpen
                  ? 'bg-[#F5C542] text-black shadow-[0_0_12px_rgba(245,197,66,0.4)]'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              aria-label="Camera Presets"
            >
              <HugeiconsIcon icon={CameraIcon} size={18} className="w-4 h-4 stroke-[2]" />
            </button>
          </SimpleTooltip>

          {/* Camera Presets Flyout */}
          {cameraMenuOpen && (
            <div className="absolute right-full mr-2.5 top-0 w-40 p-1.5 rounded-2xl bg-[#16171B]/95 backdrop-blur-xl border border-white/[0.06] shadow-[0_12px_36px_rgba(0,0,0,0.7)] z-50 animate-in fade-in zoom-in-95">
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Camera Angle
              </div>
              {[
                { id: 'reset' as const, label: 'Reset (Home)' },
                { id: 'front' as const, label: 'Front' },
                { id: 'side' as const, label: 'Side (Right)' },
                { id: 'top' as const, label: 'Top' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleCameraPreset(item.id)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* [ ⌗ Ground Grid Toggle ] */}
        <SimpleTooltip label={showGrid ? 'Hide Ground Grid' : 'Show Ground Grid'} side="left">
          <button
            type="button"
            id="btn-hud-ground-grid"
            onClick={handleToggleGrid}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              showGrid
                ? 'bg-white/15 text-[#F5C542] border border-[#F5C542]/30'
                : 'text-zinc-300 hover:text-white hover:bg-white/10'
            }`}
            aria-label="Toggle Ground Grid"
          >
            <HugeiconsIcon icon={GridIcon} size={18} className="w-4 h-4 stroke-[2]" />
          </button>
        </SimpleTooltip>

        {/* [ ❓ Hotkeys Help ] */}
        <SimpleTooltip label="Keyboard Shortcuts & Hotkeys" side="left">
          <button
            type="button"
            id="btn-hud-hotkeys-help"
            onClick={() => setHotkeysModalOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            aria-label="Hotkeys Help"
          >
            <HugeiconsIcon icon={HelpCircleIcon} size={18} className="w-4 h-4 stroke-[2]" />
          </button>
        </SimpleTooltip>
      </aside>

      {/* Hotkeys Help Modal Dialog */}
      {hotkeysModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Studio Hotkeys & Shortcuts"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
        >
          <div
            className="relative w-full max-w-lg rounded-2xl bg-[#16171B] border border-white/[0.06] shadow-[0_16px_48px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] bg-[#121316]">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#F5C542]/10 border border-[#F5C542]/20 flex items-center justify-center text-[#F5C542]">
                  <HugeiconsIcon icon={HelpCircleIcon} size={16} className="w-4 h-4 stroke-[2]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white font-sans">Keyboard Shortcuts</h3>
                  <p className="text-[11px] text-zinc-400">Quick navigation & studio hotkeys</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHotkeysModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                aria-label="Close shortcuts dialog"
              >
                <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto space-y-5 custom-scrollbar text-xs">
              {shortcutCategories.map((cat) => {
                const items = DEFAULT_WORKSPACE_SHORTCUTS.filter((s) => s.category === cat.id);
                if (items.length === 0) return null;
                return (
                  <div key={cat.id} className="space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#F5C542]/80">
                      {cat.title}
                    </span>
                    <div className="grid grid-cols-1 gap-1.5">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-[#1D1F26] border border-white/[0.06]"
                        >
                          <div className="space-y-0.5">
                            <span className="text-zinc-200 font-medium block">{item.name}</span>
                            <span className="text-[10px] text-zinc-500 block">{item.description}</span>
                          </div>
                          <kbd className="px-2 py-1 rounded-md bg-[#121316] border border-white/[0.06] text-[11px] font-mono text-[#F5C542] font-semibold whitespace-nowrap ml-3 shadow-inner">
                            {item.defaultKey}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/[0.06] bg-[#121316] flex justify-end">
              <button
                type="button"
                onClick={() => setHotkeysModalOpen(false)}
                className="px-4 py-1.5 rounded-full bg-[#1D1F26] hover:bg-white/[0.08] text-white font-medium text-xs border border-white/[0.06] transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
