import React, { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { motion } from 'motion/react';
import { ResourceMonitor } from './ResourceMonitor';

import { HugeiconsIcon } from '@hugeicons/react';
import { Box, CableIcon, CheckIcon, ChevronDown, HexagonIcon, LayersIcon, Menu, PackageIcon, Search01Icon, SettingsIcon, SparklesIcon, UserIcon } from '@hugeicons/core-free-icons';
interface TopHeaderProps {
  onMobileMenuToggle?: () => void;
  isMobileNavOpen?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onMobileMenuToggle, isMobileNavOpen }) => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    mainNav,
    navigateToMain,
    activeTool,
    navigateToTool,
    systemStats,
    setIsSettingsOpen,
    setIsDccBridgeOpen,
    setShowWireframe,
    showWireframe,
    setShowGrid,
    showGrid,
    fitToScreen,
    resetCamera,
    isTurntable,
    setIsTurntable,
    setActiveRightTab,
    setRightPanelMode,
    setIsRightPanelOpen,
  } = useWorkspace();

  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkspaceMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [workspaceMenuOpen]);

  // Command palette: keeps existing one-key tool shortcuts untouched.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header
      id="persistent-top-header"
      className="h-[44px] px-2.5 md:px-4 bg-[#0d0d0d]/95 backdrop-blur-xl flex items-center justify-between border-b border-white/[0.10] select-none z-50 text-xs w-full flex-shrink-0 min-w-0 shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
    >
      {/* Left Branding & Mode Dropdown */}
      <div className="flex items-center gap-2.5 md:gap-3.5 min-w-0 overflow-hidden">
        {/* Mobile menu button */}
        <button
          onClick={onMobileMenuToggle}
          className="md:hidden p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-[hsl(var(--surface-1))] transition-colors flex-shrink-0 active:scale-95"
          aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
        >
          <HugeiconsIcon icon={Menu} size={16} className="w-4 h-4" />
        </button>

        {/* Brand Studio Logo (ForMash 3D) */}
        <div
          onClick={() => navigateToMain('dashboard')}
          className="flex items-center gap-2 cursor-pointer group p-1 flex-shrink-0"
        >
          {/* Stylized Logo Cube */}
          <div className="w-5 h-5 rounded-[5px] bg-gradient-to-br from-[#FFD866] via-[#F5C542] to-[#E0A800] flex items-center justify-center text-[#080808] font-black text-[10px] shadow-[0_0_10px_rgba(245,197,66,0.35)] tracking-tighter group-hover:shadow-[0_0_16px_rgba(245,197,66,0.6)] transition-all">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="font-extrabold text-xs tracking-wider text-white uppercase font-sans hidden sm:inline group-hover:text-primary transition-colors">
            ForMash <span className="text-primary font-black">3D</span>
          </span>
        </div>

        {/* 3D Workspace Mode Switcher Dropdown - hidden on mobile */}
        <div ref={workspaceMenuRef} className="relative hidden md:block">
          <button
            id="btn-workspace-switcher"
            onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            className="group h-7 px-2.5 rounded-lg bg-gradient-to-b from-[#1b1b1b] to-[#121212] border border-white/[0.12] flex items-center gap-1.5 hover:border-primary/40 hover:bg-[#202020] transition-all active:scale-95 cursor-pointer shadow-sm"
          >
            <span className="text-primary text-[11px] font-bold flex gap-1.5 items-center">
              <span>3D Workspace</span>
              <HugeiconsIcon icon={ChevronDown} size={16} className={`w-3 h-3 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200 ${workspaceMenuOpen ? 'rotate-180 text-primary' : ''}`} />
            </span>
          </button>

          {workspaceMenuOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-52 py-1.5 rounded-xl bg-[hsl(var(--surface-1))]/95 backdrop-blur-xl border border-white/[0.12] shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Workspace Modes
              </div>
              <button
                onClick={() => { navigateToTool('model'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                  mainNav === 'workspace' && activeTool === 'model'
                    ? 'bg-[hsl(var(--surface-2))] text-primary font-bold'
                    : 'text-zinc-200 hover:bg-[hsl(var(--surface-2))] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>3D Model Studio</span>
                </div>
                {mainNav === 'workspace' && activeTool === 'model' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 text-primary" />}
              </button>
              <button
                onClick={() => { navigateToTool('remesh'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                  mainNav === 'workspace' && activeTool === 'remesh'
                    ? 'bg-[hsl(var(--surface-2))] text-primary font-bold'
                    : 'text-zinc-200 hover:bg-[hsl(var(--surface-2))] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={HexagonIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Quad Remesh (Poly)</span>
                </div>
                {mainNav === 'workspace' && activeTool === 'remesh' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 text-primary" />}
              </button>
              <button
                onClick={() => { navigateToTool('texture'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                  mainNav === 'workspace' && activeTool === 'texture'
                    ? 'bg-[hsl(var(--surface-2))] text-primary font-bold'
                    : 'text-zinc-200 hover:bg-[hsl(var(--surface-2))] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={LayersIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>PBR Texture Studio</span>
                </div>
                {mainNav === 'workspace' && activeTool === 'texture' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 text-primary" />}
              </button>
              <button
                onClick={() => { navigateToTool('animation'); setWorkspaceMenuOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                  mainNav === 'workspace' && activeTool === 'animation'
                    ? 'bg-[hsl(var(--surface-2))] text-primary font-bold'
                    : 'text-zinc-200 hover:bg-[hsl(var(--surface-2))] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
                  <span>Animation & Rigging</span>
                </div>
                {mainNav === 'workspace' && activeTool === 'animation' && <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 text-primary" />}
              </button>
            </div>
          )}
        </div>

        {/* Divider - hidden on mobile */}
        <div className="h-3.5 w-px bg-white/[0.1] mx-0.5 hidden md:block" />

        {/* Center/Left Top Navigation Links in Segmented Pill Bar - hidden on mobile */}
        <nav className="relative flex items-center gap-0.5 bg-[#141414] p-0.5 rounded-lg border border-white/[0.10] text-[11px] font-medium hidden md:flex shadow-inner">
          {[
            {
              id: 'home',
              domId: 'nav-link-home',
              label: 'Home',
              active: mainNav === 'dashboard',
              onClick: () => navigateToMain('dashboard'),
            },
            {
              id: 'studio',
              domId: 'nav-link-studio',
              label: '3D Studio',
              active: mainNav === 'workspace' && activeTool !== 'animation',
              onClick: () => navigateToTool('model'),
            },
            {
              id: 'animation',
              domId: 'nav-link-animation',
              label: 'Animation',
              active: mainNav === 'workspace' && activeTool === 'animation',
              onClick: () => navigateToTool('animation'),
            },
            {
              id: 'assets',
              domId: 'nav-link-assets',
              label: 'Assets',
              active: mainNav === 'assets',
              onClick: () => navigateToMain('assets'),
            },
{
               id: 'system',
               domId: 'nav-link-system',
               label: 'System',
               active: mainNav === 'system',
               onClick: () => navigateToMain('system'),
             },
           ].map((item) => (
            <button
              key={item.id}
              id={item.domId}
              onClick={item.onClick}
              className={`relative px-2.5 py-1 rounded-md transition-colors cursor-pointer active:scale-95 z-10 ${
                item.active ? 'text-white font-bold' : 'text-zinc-300 hover:text-white'
              }`}
            >
              {item.active && (
                <motion.div
                  layoutId="topNavActiveIndicator"
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  className="absolute inset-0 rounded-md bg-gradient-to-b from-primary/20 via-primary/10 to-transparent border border-primary/45 shadow-[0_0_12px_rgba(255,204,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)] -z-10"
                />
              )}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Right: FastAPI Status Pill, AI Models, DCC Bridge, SettingsIcon, Profile */}
      <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
        {/* Restored FastAPI Status Pill - text hidden on small screens */}
        <SimpleTooltip
          label={`FastAPI Backend: ${systemStats.status.toUpperCase()} • GPUs: ${systemStats.gpus?.length || 1} • ${systemStats.total_vram_used_gb != null && systemStats.total_vram_total_gb != null ? `${systemStats.total_vram_used_gb.toFixed(1)}/${systemStats.total_vram_total_gb.toFixed(1)}GB VRAM` : 'Ready'}`}
          side="bottom"
        >
          <button
            id="btn-fastapi-status-pill"
            onClick={() => navigateToMain('system')}
            className="cursor-pointer transition-transform active:scale-95"
          >
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
              systemStats.status === 'online'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
            }`}>
              {systemStats.status === 'online' ? 'FastAPI Online' : 'FastAPI Offline'}
            </span>
          </button>
        </SimpleTooltip>

        {/* Resource Monitor - System Stats */}
        <ResourceMonitor />

        <SimpleTooltip label="Command palette • Ctrl K" side="bottom">
          <button id="btn-header-command-palette" type="button" onClick={() => setCommandOpen(true)} className="hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:bg-[hsl(var(--surface-2))] hover:border-primary/30 text-[11px] text-zinc-300 transition-all shadow-sm cursor-pointer" aria-label="Open command palette">
            <HugeiconsIcon icon={Search01Icon} size={16} className="w-3 h-3 text-primary" />
            <span className="font-semibold hidden md:inline">Search</span>
            <kbd className="hidden lg:inline-flex items-center px-1 py-0.5 rounded border border-white/[0.1] bg-black/20 text-[9px] text-zinc-500 font-mono">Ctrl K</kbd>
          </button>
        </SimpleTooltip>

        {/* AI Models Button - hidden on small mobile */}
        <SimpleTooltip label="Manage AI 3D Models & Weights" side="bottom">
          <button
            id="btn-header-models"
            onClick={() => router.push('/admin?tab=models')}
            className="hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:bg-[hsl(var(--surface-2))] hover:border-white/[0.15] text-[11px] text-zinc-300 transition-all shadow-sm cursor-pointer"
          >
            <HugeiconsIcon icon={PackageIcon} size={16} className="w-3 h-3 text-primary" />
            <span className="font-semibold hidden md:inline">AI Models</span>
          </button>
        </SimpleTooltip>

        {/* DCC Bridge Button - hidden on mobile */}
        <SimpleTooltip label="Connect to Blender / Unreal Engine / Maya via DCC Bridge" side="bottom">
          <button
            id="btn-dcc-bridge"
            onClick={() => setIsDccBridgeOpen(true)}
            className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:bg-[hsl(var(--surface-2))] hover:border-white/[0.15] text-[11px] text-zinc-300 transition-all shadow-sm cursor-pointer"
          >
            <HugeiconsIcon icon={CableIcon} size={16} className="w-3 h-3 text-primary" />
            <span className="font-semibold">DCC Bridge</span>
          </button>
        </SimpleTooltip>

        {/* Quick SettingsIcon Icon */}
        <SimpleTooltip label="Quick SettingsIcon" side="bottom">
          <button
            id="btn-header-settings"
            onClick={() => setIsSettingsOpen(true)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-1))] transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={SettingsIcon} size={16} className="w-3.5 h-3.5" />
          </button>
        </SimpleTooltip>

        {/* Profile Avatar */}
        <SimpleTooltip label="Admin & SettingsIcon" side="bottom">
          <div
            id="btn-header-profile"
            onClick={() => router.push('/admin?tab=settings')}
            className="w-6 h-6 rounded-full bg-[hsl(var(--surface-2))] border border-white/[0.12] flex items-center justify-center text-[10px] font-bold text-primary cursor-pointer hover:border-primary transition-colors overflow-hidden"
          >
            <HugeiconsIcon icon={UserIcon} size={16} className="w-3.5 h-3.5 text-zinc-300" />
          </div>
        </SimpleTooltip>
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search tools, panels, and viewport actions..." />
        <CommandList className="max-h-[min(70vh,520px)] p-1">
          <CommandEmpty>No matching command.</CommandEmpty>
          <CommandGroup heading="Workspace">
            {[
              ['model', '3D Model Studio', 'Generate 3D assets', 'G'],
              ['remesh', 'Retopology / Remesh', 'Make the mesh game-ready', 'R'],
              ['texture', 'AI Texture', 'Paint or texture the current asset', 'T'],
              ['animation', 'Animation', 'Generate or inspect motion', 'A'],
              ['rigging', 'Rigging', 'Prepare a character rig', 'K'],
              ['segment', 'Segmentation', 'Split the asset into parts', 'S'],
            ].map(([tool, label, hint, shortcut]) => (
              <CommandItem key={tool} value={label + ' ' + hint} onSelect={() => { navigateToTool(tool as any); setCommandOpen(false); }}>
                <HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4 text-primary" />
                <span>{label}</span><span className="ml-2 text-xs text-muted-foreground">{hint}</span><CommandShortcut>{shortcut}</CommandShortcut>
              </CommandItem>
            ))}
            <CommandItem value="assets outputs" onSelect={() => { navigateToMain('assets'); setCommandOpen(false); }}><HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4" /><span>Assets</span><CommandShortcut>⌘ 2</CommandShortcut></CommandItem>
            <CommandItem value="jobs queue history" onSelect={() => { navigateToMain('jobs'); setCommandOpen(false); }}><HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4" /><span>Jobs</span><CommandShortcut>⌘ 4</CommandShortcut></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Viewport">
            <CommandItem value="fit frame focus model" onSelect={() => { fitToScreen(); setCommandOpen(false); }}><HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4" /><span>Fit Model</span><CommandShortcut>F</CommandShortcut></CommandItem>
            <CommandItem value="reset camera home" onSelect={() => { resetCamera(); setCommandOpen(false); }}><HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4" /><span>Reset Camera</span><CommandShortcut>Home</CommandShortcut></CommandItem>
            <CommandItem value="wireframe topology edges" onSelect={() => { setShowWireframe(!showWireframe); setCommandOpen(false); }}><HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4" /><span>Toggle Wireframe</span></CommandItem>
            <CommandItem value="grid floor" onSelect={() => { setShowGrid(!showGrid); setCommandOpen(false); }}><HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4" /><span>Toggle Grid</span></CommandItem>
            <CommandItem value="turntable auto rotate" onSelect={() => { setIsTurntable(!isTurntable); setCommandOpen(false); }}><HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4" /><span>{isTurntable ? 'Stop Turntable' : 'Start Turntable'}</span></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Panels">
            <CommandItem value="inspector properties" onSelect={() => { setActiveRightTab('properties'); setRightPanelMode('properties'); setIsRightPanelOpen(true); setCommandOpen(false); }}><HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4" /><span>Open Inspector</span></CommandItem>
            <CommandItem value="assets library" onSelect={() => { setActiveRightTab('assets'); setRightPanelMode('assets'); setIsRightPanelOpen(true); setCommandOpen(false); }}><HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4" /><span>Open Asset Library</span></CommandItem>
            <CommandItem value="settings preferences" onSelect={() => { setIsSettingsOpen(true); setCommandOpen(false); }}><HugeiconsIcon icon={SettingsIcon} size={16} className="mr-2 h-4 w-4" /><span>Open Settings</span></CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
};

