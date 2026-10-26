import React, { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { ToolType } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { motion, LayoutGroup } from 'motion/react';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  BoneIcon,
  Box,
  CircleDashedIcon,
  FileExportIcon,
  FolderOpenIcon,
  Image01Icon,
  LayersIcon,
  LayoutDashboardIcon,
  ListOrderedIcon,
  ScissorsIcon,
  SettingsIcon,
  SparklesIcon,
  GridIcon,
  FilmIcon,
} from '@hugeicons/core-free-icons';

interface LeftNavigationProps {
  /** When true, renders as a wide drawer with full labels instead of icon rail */
  isMobileDrawer?: boolean;
  /** Callback after a tool is selected in mobile drawer (closes drawer) */
  onToolSelect?: () => void;
}

interface NavItemConfig {
  id: string;
  label: string;
  tooltip: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  isExecuting?: boolean;
  badge?: string;
}

export const LeftNavigation: React.FC<LeftNavigationProps> = ({ isMobileDrawer = false, onToolSelect }) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    activeTool,
    mainNav,
    navigateToTool,
    navigateToMainNav,
    isExecuting,
    activeTask,
    isExportModalOpen,
    setIsExportModalOpen,
  } = useWorkspace();

  // Sub-stage tracking for Model (input prompt vs 3D gen settings)
  const [pipelineStage, setPipelineStage] = useState<'input' | 'gen' | null>(null);

  const handleToolClick = (tool: ToolType) => {
    navigateToTool(tool);
    onToolSelect?.();
  };

  const handleMainNavClick = (nav: 'dashboard' | 'assets' | 'system' | 'jobs') => {
    navigateToMainNav(nav);
    onToolSelect?.();
  };

  const isActive = (tool: ToolType) => mainNav === 'workspace' && activeTool === tool;
  const isAssetsActive = mainNav === 'assets';
  const isJobsActive = mainNav === 'jobs';

  // Check if a specific tool is running a background generation
  const isModelExecuting = isExecuting && (activeTask?.type === 'image-to-3d' || !activeTask?.type);
  const isSegmentExecuting = isExecuting && activeTask?.type === 'segment';
  const isRemeshExecuting = isExecuting && activeTask?.type === 'remesh';
  const isTextureExecuting = isExecuting && activeTask?.type === 'texture';
  const isRiggingExecuting = isExecuting && activeTask?.type === 'rigging';

  // Pipeline Stepper (Native 7 stages requested in Phase 4 - Single Image to 3D ONLY, no multi-view, no text-to-3d)
  // [ 🖼️ Image ] -> [ 📦 3D Gen ] -> [ ✂️ Segment ] -> [ 🕸️ Retopo ] -> [ 🎨 Texture ] -> [ 🦴 Rig ] -> [ 📤 Export ]
  const pipelineStages: NavItemConfig[] = [
    {
      id: 'stage-btn-input',
      label: 'Image',
      tooltip: '1. Input Single Image • 1',
      shortcut: '1',
      icon: (props: any) => <HugeiconsIcon icon={Image01Icon} size={16} {...props} />,
      active: isActive('model') && (pipelineStage === 'input' || (!pipelineStage && !isModelExecuting)),
      onClick: () => {
        setPipelineStage('input');
        handleToolClick('model');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('formash:focus_input'));
        }
      },
      isExecuting: false,
    },
    {
      id: 'stage-btn-model',
      label: '3D Gen',
      tooltip: '2. Single Image to 3D Generation • G',
      shortcut: 'G',
      icon: (props: any) => <HugeiconsIcon icon={Box} size={16} {...props} />,
      active: isActive('model') && (pipelineStage === 'gen' || (!pipelineStage && isModelExecuting)),
      onClick: () => {
        setPipelineStage('gen');
        handleToolClick('model');
      },
      isExecuting: isModelExecuting,
    },
    {
      id: 'stage-btn-segment',
      label: 'Segment',
      tooltip: '3. Mesh Segmentation & Part Splitting • S',
      shortcut: 'S',
      icon: (props: any) => <HugeiconsIcon icon={ScissorsIcon} size={16} {...props} />,
      active: isActive('segment'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('segment');
      },
      isExecuting: isSegmentExecuting,
    },
    {
      id: 'stage-btn-retopo',
      label: 'Retopo',
      tooltip: '4. Retopology & Quad Remesh • R',
      shortcut: 'R',
      icon: (props: any) => <HugeiconsIcon icon={CircleDashedIcon} size={16} {...props} />,
      active: isActive('remesh'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('remesh');
      },
      isExecuting: isRemeshExecuting,
    },
    {
      id: 'stage-btn-texture',
      label: 'Texture',
      tooltip: '5. PBR Texture Maps Generation • T',
      shortcut: 'T',
      icon: (props: any) => <HugeiconsIcon icon={LayersIcon} size={16} {...props} />,
      active: isActive('texture'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('texture');
      },
      isExecuting: isTextureExecuting,
    },
    {
      id: 'stage-btn-rigging',
      label: 'Rig',
      tooltip: '6. Character Rigging Studio (UniRig AI) • K',
      shortcut: 'K',
      icon: (props: any) => <HugeiconsIcon icon={BoneIcon} size={16} {...props} />,
      active: isActive('rigging'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('rigging');
      },
      isExecuting: isRiggingExecuting,
    },
    {
      id: 'stage-btn-export',
      label: 'Export',
      tooltip: '7. Export 3D Asset (GLB, OBJ, FBX) • E',
      shortcut: 'E',
      icon: (props: any) => <HugeiconsIcon icon={FileExportIcon} size={16} {...props} />,
      active: isExportModalOpen,
      onClick: () => {
        setIsExportModalOpen(true);
        onToolSelect?.();
      },
    },
  ];

  // Secondary Tools (Available in drawer and secondary stack)
  const secondaryTools: NavItemConfig[] = [
    {
      id: 'tool-btn-uv',
      label: 'UV',
      tooltip: 'UV Unwrapping & Seam Packing • U',
      shortcut: 'U',
      icon: (props: any) => <HugeiconsIcon icon={GridIcon} size={16} {...props} />,
      active: isActive('uv'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('uv');
      },
    },
    {
      id: 'tool-btn-edit',
      label: 'Edit',
      tooltip: 'Neural Mesh Editing & Inpainting',
      shortcut: 'M',
      icon: (props: any) => <HugeiconsIcon icon={SparklesIcon} size={16} {...props} />,
      active: isActive('edit'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('edit');
      },
    },
    {
      id: 'tool-btn-animation',
      label: 'Animate',
      tooltip: 'ARDY Motion Animation Studio • A',
      shortcut: 'A',
      icon: (props: any) => <HugeiconsIcon icon={FilmIcon} size={16} {...props} />,
      active: isActive('animation'),
      onClick: () => {
        setPipelineStage(null);
        handleToolClick('animation');
      },
    },
  ];

  // Workspace & hub views
  const workspaceViews: NavItemConfig[] = [
    {
      id: 'tool-btn-assets',
      label: 'Assets',
      tooltip: 'Outputs & Asset History • ⌘2',
      shortcut: '⌘2',
      icon: (props: any) => <HugeiconsIcon icon={FolderOpenIcon} size={16} {...props} />,
      active: isAssetsActive,
      onClick: () => handleMainNavClick('assets'),
    },
    {
      id: 'tool-btn-jobs',
      label: 'Jobs',
      tooltip: 'Generation Jobs & Run Inspector • ⌘3',
      shortcut: '⌘3',
      icon: (props: any) => <HugeiconsIcon icon={ListOrderedIcon} size={16} {...props} />,
      active: isJobsActive,
      onClick: () => handleMainNavClick('jobs'),
    },
  ];

  /** Render individual desktop nav button with clean Studio Gold active styling */
  const renderDesktopNavButton = (item: NavItemConfig) => {
    const Icon = item.icon;
    return (
      <SimpleTooltip key={item.id} side="right" label={item.tooltip} className="w-full flex justify-center">
        <motion.button
          layout
          id={item.id}
          onClick={item.onClick}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={{
            layout: { type: 'spring', stiffness: 440, damping: 32 },
            scale: { duration: 0.1 },
          }}
          className={`group relative w-[48px] h-[44px] flex flex-col items-center justify-center rounded-xl cursor-pointer flex-shrink-0 select-none transition-colors duration-150 ${
            item.active
              ? 'text-white'
              : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          {/* Studio Obsidian-Gold active indicators (#F5C542 icon + subtle amber indicator) */}
          {item.active && (
            <>
              <motion.div
                layoutId="saasNavActivePill"
                className="absolute inset-0 rounded-xl bg-gradient-to-b from-[#F5C542]/15 via-[#F5C542]/08 to-transparent border border-[#F5C542]/30 shadow-[0_0_12px_rgba(245,197,66,0.2),inset_0_1px_0_rgba(255,255,255,0.08)] -z-0"
                transition={{
                  type: 'spring',
                  stiffness: 440,
                  damping: 32,
                }}
              />
              <span className="absolute left-0.5 top-2.5 bottom-2.5 w-[2.5px] rounded-r-full bg-[#F5C542] shadow-[0_0_8px_rgba(245,197,66,0.8)]" />
            </>
          )}

          {/* Live execution pulse indicator */}
          {item.isExecuting && (
            <span className="absolute top-1 right-1 flex h-2 w-2 z-10" title="Engine actively executing">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F5C542] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F5C542]" />
            </span>
          )}

          <Icon
            className={`w-4 h-4 mb-0.5 flex-shrink-0 transition-colors duration-150 ${
              item.active
                ? 'text-[#F5C542] drop-shadow-[0_0_8px_rgba(245,197,66,0.6)]'
                : 'text-zinc-400 group-hover:text-zinc-200'
            }`}
          />
          <span
            className={`text-[10px] font-medium leading-none text-center tracking-tight truncate w-full transition-colors duration-150 ${
              item.active ? 'text-[#F5C542] font-bold' : 'text-zinc-400 group-hover:text-zinc-200'
            }`}
          >
            {item.label}
          </span>
        </motion.button>
      </SimpleTooltip>
    );
  };

  // Mobile drawer: wide categorized list with full labels
  if (isMobileDrawer) {
    return (
      <nav
        id="left-tool-rail-mobile"
        aria-label="3D Studio Pipeline"
        className="h-full bg-[hsl(var(--surface-0))] flex flex-col select-none overflow-y-auto p-4"
      >
        <div className="flex-1 w-full flex flex-col gap-4">
          {/* Section: Pipeline Stages */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>Pipeline Stages</span>
              <span className="text-[9px] font-mono text-[#F5C542]">7 STAGES</span>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {pipelineStages.map((item) => (
                <MobileNavItem
                  key={item.id}
                  id={item.id}
                  icon={<item.icon className="w-4 h-4" />}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={item.active}
                  isExecuting={item.isExecuting}
                  onClick={item.onClick}
                />
              ))}
            </div>
          </div>

          <div className="h-px bg-white/[0.08] mx-2" />

          {/* Section: Secondary Tools */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Secondary Tools
            </div>
            <div className="grid grid-cols-1 gap-1">
              {secondaryTools.map((item) => (
                <MobileNavItem
                  key={item.id}
                  id={item.id}
                  icon={<item.icon className="w-4 h-4" />}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={item.active}
                  onClick={item.onClick}
                />
              ))}
            </div>
          </div>

          <div className="h-px bg-white/[0.08] mx-2" />

          {/* Section: Workspace Views */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Workspace &amp; Hub
            </div>
            <div className="grid grid-cols-1 gap-1">
              {workspaceViews.map((item) => (
                <MobileNavItem
                  key={item.id}
                  id={item.id}
                  icon={<item.icon className="w-4 h-4" />}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={item.active}
                  onClick={item.onClick}
                />
              ))}
            </div>
          </div>

          <div className="h-px bg-white/[0.08] mx-2" />

          {/* Section: Admin & Settings */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              System
            </div>
            <div className="grid grid-cols-1 gap-1">
              <MobileNavItem
                id="mobile-nav-admin"
                icon={<HugeiconsIcon icon={SettingsIcon} size={16} className="w-4 h-4" />}
                label="Admin & Settings"
                active={pathname === '/admin' || pathname?.startsWith('/admin')}
                onClick={() => {
                  router.push('/admin');
                  onToolSelect?.();
                }}
              />
            </div>
          </div>
        </div>
      </nav>
    );
  }

  // Desktop: Slim 56px vertical command rail matching requirement 1
  return (
    <LayoutGroup id="workspace-left-navigation">
      <motion.nav
        layout
        id="left-tool-rail"
        aria-label="3D Studio Pipeline Stepper"
        transition={{
          layout: { type: 'spring', stiffness: 400, damping: 32 },
        }}
        className="w-[56px] h-full bg-[#121316] border-r border-white/[0.06] flex flex-col items-center py-3 gap-4 z-30 select-none flex-shrink-0"
      >
        {/* Native 7-Stage Pipeline Stepper */}
        <div className="w-full flex-1 flex flex-col items-center gap-1 overflow-y-auto overflow-x-hidden scrollbar-none px-1">
          <div className="w-full flex flex-col items-center gap-1">
            {pipelineStages.map(renderDesktopNavButton)}
          </div>

          {/* Hairline Separator */}
          <div className="w-6 h-px bg-white/[0.08] my-1.5 flex-shrink-0" role="separator" />

          {/* Workspace Views (Assets / Jobs) */}
          <div className="w-full flex flex-col items-center gap-1">
            {workspaceViews.map(renderDesktopNavButton)}
          </div>
        </div>

        {/* Bottom Section: Admin & Settings */}
        <div className="w-full flex flex-col items-center gap-1 pt-2 border-t border-white/[0.06] mt-auto px-1 flex-shrink-0">
          <SimpleTooltip side="right" label="Admin & Settings (/admin)" className="w-full flex justify-center">
            <motion.button
              id="tool-btn-admin-bottom"
              onClick={() => router.push('/admin')}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className={`group relative w-[48px] h-[40px] flex flex-col items-center justify-center rounded-xl cursor-pointer flex-shrink-0 select-none transition-colors duration-150 ${
                pathname === '/admin' || pathname?.startsWith('/admin')
                  ? 'text-[#F5C542] bg-[#F5C542]/10 border border-[#F5C542]/30 shadow-[0_0_12px_rgba(245,197,66,0.2)]'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
              }`}
              aria-label="Admin and Settings"
            >
              <HugeiconsIcon
                icon={SettingsIcon}
                size={16}
                className={`w-4 h-4 mb-0.5 transition-colors duration-150 ${
                  pathname === '/admin' || pathname?.startsWith('/admin')
                    ? 'text-[#F5C542]'
                    : 'text-zinc-400 group-hover:text-white'
                }`}
              />
              <span
                className={`text-[9px] font-medium leading-none tracking-tight ${
                  pathname === '/admin' || pathname?.startsWith('/admin')
                    ? 'text-[#F5C542] font-bold'
                    : 'text-zinc-400 group-hover:text-zinc-200'
                }`}
              >
                Admin
              </span>
            </motion.button>
          </SimpleTooltip>
        </div>
      </motion.nav>
    </LayoutGroup>
  );
};

/** Internal component for mobile drawer nav items with smooth animated feedback */
const MobileNavItem: React.FC<{
  id: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active: boolean;
  isExecuting?: boolean;
  onClick: () => void;
}> = ({ id, icon, label, shortcut, active, isExecuting, onClick }) => (
  <button
    id={id}
    onClick={onClick}
    className={`w-full relative flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all duration-150 active:scale-[0.98] cursor-pointer ${
      active
        ? 'bg-[#F5C542]/15 border border-[#F5C542]/40 text-white font-bold shadow-sm'
        : 'text-zinc-300 hover:text-white hover:bg-white/[0.04] border border-transparent'
    }`}
  >
    {active && (
      <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#F5C542] shadow-[0_0_8px_rgba(245,197,66,0.8)]" />
    )}
    <div className="flex items-center gap-3 min-w-0">
      <span className={`flex-shrink-0 transition-transform ${active ? 'text-[#F5C542] scale-110' : 'text-zinc-400'}`}>
        {icon}
      </span>
      <span className="text-xs font-semibold truncate">{label}</span>
    </div>

    <div className="flex items-center gap-2 flex-shrink-0">
      {isExecuting && (
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F5C542] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F5C542]" />
        </span>
      )}
      {shortcut && (
        <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[9px] font-mono text-zinc-400">
          {shortcut}
        </kbd>
      )}
    </div>
  </button>
);
