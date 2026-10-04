import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorkspace } from '../store/WorkspaceContext';
import { ToolType } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { motion, LayoutGroup } from 'motion/react';


import { HugeiconsIcon } from '@hugeicons/react';
import { BoneIcon, Box, CircleDashedIcon, FilmIcon, FolderOpenIcon, GridIcon, LayersIcon, LayoutDashboardIcon, ListOrderedIcon, ScissorsIcon, SparklesIcon } from '@hugeicons/core-free-icons';
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
  const {
    activeTool,
    mainNav,
    navigateToTool,
    navigateToMainNav,
    isExecuting,
    activeTask,
  } = useWorkspace();

  const handleToolClick = (tool: ToolType) => {
    navigateToTool(tool);
    onToolSelect?.();
  };

  const handleMainNavClick = (nav: 'dashboard' | 'assets' | 'system' | 'jobs') => {
    navigateToMainNav(nav);
    onToolSelect?.();
  };

  const isActive = (tool: ToolType) => mainNav === 'workspace' && activeTool === tool;
  const isOverviewActive = mainNav === 'dashboard';
  const isAssetsActive = mainNav === 'assets';
  const isJobsActive = mainNav === 'jobs';

  // CheckIcon if a specific tool is running a background generation
  const isModelExecuting = isExecuting && (activeTask?.type === 'image-to-3d' || !activeTask?.type);
  const isRemeshExecuting = isExecuting && activeTask?.type === 'remesh';
  const isTextureExecuting = isExecuting && activeTask?.type === 'texture';
  const isAnimationExecuting = isExecuting && activeTask?.type === 'animation';

  // Primary 3D creation tools
  const creationTools: NavItemConfig[] = [
    {
      id: 'tool-btn-model',
      label: 'Model',
      tooltip: '3D Model Generation (Image & Text to 3D) • G',
      shortcut: 'G',
      icon: (props: any) => <HugeiconsIcon icon={Box} size={16} {...props} />,
      active: isActive('model'),
      onClick: () => handleToolClick('model'),
      isExecuting: isModelExecuting,
    },
    {
      id: 'tool-btn-remesh',
      label: 'Poly',
      tooltip: 'Retopology & Quad Remesh • R',
      shortcut: 'R',
      icon: (props: any) => <HugeiconsIcon icon={CircleDashedIcon} size={16} {...props} />,
      active: isActive('remesh'),
      onClick: () => handleToolClick('remesh'),
      isExecuting: isRemeshExecuting,
    },
    {
      id: 'tool-btn-texture',
      label: 'Texture',
      tooltip: 'PBR Texture Maps Generation • T',
      shortcut: 'T',
      icon: (props: any) => <HugeiconsIcon icon={LayersIcon} size={16} {...props} />,
      active: isActive('texture'),
      onClick: () => handleToolClick('texture'),
      isExecuting: isTextureExecuting,
    },
    {
      id: 'tool-btn-uv',
      label: 'UV',
      tooltip: 'UV Unwrapping & Seam Packing • U',
      shortcut: 'U',
      icon: (props: any) => <HugeiconsIcon icon={GridIcon} size={16} {...props} />,
      active: isActive('uv'),
      onClick: () => handleToolClick('uv'),
    },
    {
      id: 'tool-btn-segment',
      label: 'Segment',
      tooltip: 'Mesh Segmentation & Part Splitting • S',
      shortcut: 'S',
      icon: (props: any) => <HugeiconsIcon icon={ScissorsIcon} size={16} {...props} />,
      active: isActive('segment'),
      onClick: () => handleToolClick('segment'),
    },
    {
      id: 'tool-btn-edit',
      label: 'Edit',
      tooltip: 'Neural Mesh Editing & Inpainting • E',
      shortcut: 'E',
      icon: (props: any) => <HugeiconsIcon icon={SparklesIcon} size={16} {...props} />,
      active: isActive('edit'),
      onClick: () => handleToolClick('edit'),
    },
    {
      id: 'tool-btn-animation',
      label: 'Animate',
      tooltip: 'ARDY Motion Animation Studio • A',
      shortcut: 'A',
      icon: (props: any) => <HugeiconsIcon icon={FilmIcon} size={16} {...props} />,
      active: isActive('animation'),
      onClick: () => handleToolClick('animation'),
      isExecuting: isAnimationExecuting,
    },
    {
      id: 'tool-btn-rigging',
      label: 'Rigging',
      tooltip: 'Character Rigging Studio (UniRig AI / Manual Rig)',
      shortcut: 'K',
      icon: (props: any) => <HugeiconsIcon icon={BoneIcon} size={16} {...props} />,
      active: isActive('rigging'),
      onClick: () => handleToolClick('rigging'),
    },
  ];

  // Workspace & project hub views
  const workspaceViews: NavItemConfig[] = [
    {
      id: 'tool-btn-overview',
      label: 'Overview',
      tooltip: 'Studio Overview & Hub • ⌘1',
      shortcut: '⌘1',
      icon: (props: any) => <HugeiconsIcon icon={LayoutDashboardIcon} size={16} {...props} />,
      active: isOverviewActive,
      onClick: () => handleMainNavClick('dashboard'),
    },
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

  /** Render individual desktop nav button with clean SaaS aesthetic and smooth Framer Motion layout sliding */
  const renderDesktopNavButton = (item: NavItemConfig) => {
    const Icon = item.icon;
    return (
      <SimpleTooltip key={item.id} side="right" label={item.tooltip} className="w-full flex justify-center">
        <motion.button
          layout
          id={item.id}
          onClick={item.onClick}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          transition={{
            layout: { type: 'spring', stiffness: 440, damping: 32 },
            scale: { duration: 0.1 },
          }}
          className={`group relative w-[52px] h-[46px] flex flex-col items-center justify-center rounded-xl cursor-pointer flex-shrink-0 select-none transition-colors duration-150 ${
            item.active
              ? 'text-white'
              : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          {/* Framer Motion Background Indicator smoothly slides between active items */}
          {item.active && (
            <motion.div
              layoutId="saasNavActivePill"
              className="absolute inset-0 rounded-xl bg-gradient-to-b from-primary/20 via-primary/10 to-transparent border border-primary/45 shadow-[0_0_14px_rgba(255,204,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)] -z-0"
              transition={{
                type: 'spring',
                stiffness: 440,
                damping: 32,
              }}
            />
          )}

          {/* Live execution pulse indicator */}
          {item.isExecuting && (
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2 z-10" title="Engine actively executing">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
          )}

          <Icon
            className={`w-4 h-4 mb-1 flex-shrink-0 transition-colors duration-150 ${
              item.active
                ? 'text-primary drop-shadow-[0_0_8px_rgba(255,204,0,0.6)]'
                : 'text-zinc-300 group-hover:text-white'
            }`}
          />
          <span
            className={`text-[9px] font-medium leading-none text-center tracking-tight truncate w-full transition-colors duration-150 ${
              item.active ? 'text-white font-bold' : 'text-zinc-300 group-hover:text-white'
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
        aria-label="3D Studio Toolset"
        className="h-full bg-[hsl(var(--surface-0))] flex flex-col select-none overflow-y-auto p-4"
      >
        <div className="flex-1 w-full flex flex-col gap-4">
          {/* Section: 3D Creation Tools */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              3D Creation Tools
            </div>
            <div className="grid grid-cols-1 gap-1">
              {creationTools.map((item) => (
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

          {/* Section: Workspace Views */}
          <div className="space-y-1">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Workspaces & Hub
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
        </div>
      </nav>
    );
  }

  // Desktop: unified, clean SaaS icon rail
  return (
    <LayoutGroup id="workspace-left-navigation">
      <motion.nav
        layout
        id="left-tool-rail"
        aria-label="3D Studio Toolset"
        transition={{
          layout: { type: 'spring', stiffness: 400, damping: 32 },
        }}
        className="relative w-[64px] h-full bg-gradient-to-b from-[#141414] via-[#0d0d0d] to-[#080808] border-r border-white/[0.08] shadow-[4px_0_24px_rgba(0,0,0,0.5)] flex flex-col items-center py-3.5 z-20 select-none flex-shrink-0"
      >
        {/* Primary Tool Stack */}
        <div className="flex-1 w-full flex flex-col items-center gap-1 overflow-y-auto overflow-x-hidden scrollbar-none px-1">
          {/* 3D Creation Tools */}
          <div className="w-full flex flex-col items-center gap-1">
            {creationTools.map(renderDesktopNavButton)}
          </div>

          {/* Clean SaaS Hairline Separator */}
          <div className="w-7 h-px bg-white/[0.08] my-1.5 flex-shrink-0" role="separator" />

          {/* Workspace Views */}
          <div className="w-full flex flex-col items-center gap-1">
            {workspaceViews.map(renderDesktopNavButton)}
          </div>
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
        ? 'bg-gradient-to-r from-primary/15 via-primary/10 to-transparent border border-primary/40 text-white font-bold shadow-sm'
        : 'text-zinc-300 hover:text-white hover:bg-white/[0.04] border border-transparent'
    }`}
  >
    {active && (
      <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.8)]" />
    )}
    <div className="flex items-center gap-3 min-w-0">
      <span className={`flex-shrink-0 transition-transform ${active ? 'text-primary scale-110' : 'text-zinc-400'}`}>
        {icon}
      </span>
      <span className="text-xs font-semibold truncate">{label}</span>
    </div>

    <div className="flex items-center gap-2 flex-shrink-0">
      {isExecuting && (
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
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
