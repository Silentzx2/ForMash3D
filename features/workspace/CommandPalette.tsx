'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from './store/WorkspaceContext';
import { useUIStore } from '@/stores/useUIStore';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  CableIcon,
  Camera01Icon,
  Download01Icon,
  EyeIcon,
  GridIcon,
  HexagonIcon,
  LayersIcon,
  MoveIcon,
  PaletteIcon,
  PlayIcon,
  RotateCw,
  Search01Icon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StarIcon,
  SunIcon,
  ZapIcon,
} from '@hugeicons/core-free-icons';
import { ModelAsset } from './types';

interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}) => {
  const router = useRouter();
  const storeOpen = useUIStore((s) => s.isCommandPaletteOpen);
  const setStoreOpen = useUIStore((s) => s.setCommandPaletteOpen);

  const isOpen = controlledOpen !== undefined ? controlledOpen : storeOpen;
  const setIsOpen = setControlledOpen !== undefined ? setControlledOpen : setStoreOpen;

  const {
    navigateToMain,
    navigateToTool,
    selectAsset,
    assets = [],
    currentAsset,
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

  // Listen for ⌘K / Ctrl+K and Esc without stealing focus from active input elements
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isInput) {
          // Do not steal focus when user is typing in input or textarea
          return;
        }
        e.preventDefault();
        setIsOpen(!isOpen);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  const runAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  const favoriteAssets = assets.filter((a: ModelAsset) => a.isFavorite);
  const recentAssets = [...assets]
    .filter((a: ModelAsset) => !a.isFavorite)
    .slice(0, 5);

  return (
    <CommandDialog open={isOpen} onOpenChange={setIsOpen}>
      <CommandInput placeholder="Search tools, assets, navigation, and viewport actions..." />
      <CommandList className="max-h-[min(70vh,520px)] p-1 no-scrollbar">
        <CommandEmpty>No matching tools or assets found.</CommandEmpty>

        {/* Favorite Assets */}
        {favoriteAssets.length > 0 && (
          <CommandGroup heading="Favorite Assets">
            {favoriteAssets.map((asset: ModelAsset) => (
              <CommandItem
                key={`fav-${asset.id}`}
                value={`asset favorite ${asset.name} ${asset.format} ${asset.topology || ''}`}
                onSelect={() => runAction(() => selectAsset(asset.id))}
                className="flex items-center gap-2 cursor-pointer"
              >
                <HugeiconsIcon icon={StarIcon} size={16} className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="font-medium text-xs text-[hsl(var(--foreground))] truncate">{asset.name}</span>
                <span className="ml-auto font-mono text-[10px] uppercase text-primary px-1.5 py-0.5 rounded bg-[hsl(var(--surface-3))]">
                  {asset.format}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Recent Assets */}
        {recentAssets.length > 0 && (
          <CommandGroup heading="Recent Assets">
            {recentAssets.map((asset: ModelAsset) => (
              <CommandItem
                key={`rec-${asset.id}`}
                value={`asset recent ${asset.name} ${asset.format} ${asset.topology || ''}`}
                onSelect={() => runAction(() => selectAsset(asset.id))}
                className="flex items-center gap-2 cursor-pointer"
              >
                <HugeiconsIcon icon={Box} size={16} className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
                <span className="text-xs text-[hsl(var(--foreground))] truncate">{asset.name}</span>
                <span className="ml-auto font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                  {asset.format}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Tools & Workflows */}
        <CommandGroup heading="Tools & Engines">
          <CommandItem
            value="model generation 3d generate text image"
            onSelect={() => runAction(() => navigateToTool('model'))}
          >
            <HugeiconsIcon icon={SparklesIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>3D Model Studio</span>
            <span className="ml-2 text-xs text-muted-foreground">Generate from text/image</span>
            <CommandShortcut>G</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="remesh retopology quad flow fastmesh"
            onSelect={() => runAction(() => navigateToTool('remesh'))}
          >
            <HugeiconsIcon icon={HexagonIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>Quad Retopology</span>
            <span className="ml-2 text-xs text-muted-foreground">FastMesh game-ready clean quads</span>
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="texture pbr paint material albedo roughness"
            onSelect={() => runAction(() => navigateToTool('texture'))}
          >
            <HugeiconsIcon icon={PaletteIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>AI PBR Texturing</span>
            <span className="ml-2 text-xs text-muted-foreground">Photorealistic PBR map painting</span>
            <CommandShortcut>T</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="uv unwrapping lscm charts seam partuv"
            onSelect={() => runAction(() => navigateToTool('uv'))}
          >
            <HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>UV Unwrapping</span>
            <span className="ml-2 text-xs text-muted-foreground">PartUV automated UV atlas</span>
            <CommandShortcut>U</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="edit mesh transform gizmo move rotate scale"
            onSelect={() => runAction(() => navigateToTool('edit'))}
          >
            <HugeiconsIcon icon={MoveIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>Mesh Edit & Transform</span>
            <span className="ml-2 text-xs text-muted-foreground">Interactive 3D manipulators</span>
            <CommandShortcut>E</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="animation ardy motion clips timeline"
            onSelect={() => runAction(() => navigateToTool('animation'))}
          >
            <HugeiconsIcon icon={PlayIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>Animation & Motion</span>
            <span className="ml-2 text-xs text-muted-foreground">Dual-Track skeletal motion timeline</span>
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="rigging unirig skeleton bones armature"
            onSelect={() => runAction(() => navigateToTool('rigging'))}
          >
            <HugeiconsIcon icon={ZapIcon} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>UniRig Armature</span>
            <span className="ml-2 text-xs text-muted-foreground">Automated bipedal character rig</span>
            <CommandShortcut>K</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="segmentation parts split mesh segment"
            onSelect={() => runAction(() => navigateToTool('segment'))}
          >
            <HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4 text-primary shrink-0" />
            <span>Mesh Segmentation</span>
            <span className="ml-2 text-xs text-muted-foreground">Decompose mesh into subparts</span>
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Workspace Navigation */}
        <CommandGroup heading="Navigation">
          <CommandItem
            value="dashboard overview home"
            onSelect={() => runAction(() => navigateToMain('dashboard'))}
          >
            <HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4 text-[hsl(var(--foreground))] shrink-0" />
            <span>Dashboard / Command Center</span>
            <CommandShortcut>⌘ 1</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="assets outputs library files"
            onSelect={() => runAction(() => navigateToMain('assets'))}
          >
            <HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4 text-[hsl(var(--foreground))] shrink-0" />
            <span>Assets Library</span>
            <CommandShortcut>⌘ 2</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="jobs queue history processing"
            onSelect={() => runAction(() => navigateToMain('jobs'))}
          >
            <HugeiconsIcon icon={RotateCw} size={16} className="mr-2 h-4 w-4 text-[hsl(var(--foreground))] shrink-0" />
            <span>Jobs & Execution</span>
            <CommandShortcut>⌘ 3</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="logs backend system console"
            onSelect={() => runAction(() => router.push('/admin?tab=logs'))}
          >
            <HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4 text-[hsl(var(--foreground))] shrink-0" />
            <span>System Telemetry & Logs</span>
            <CommandShortcut>⌘ 4</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="settings preferences configuration shortcuts"
            onSelect={() => runAction(() => router.push('/admin?tab=settings'))}
          >
            <HugeiconsIcon icon={SettingsIcon} size={16} className="mr-2 h-4 w-4 text-[hsl(var(--foreground))] shrink-0" />
            <span>Preferences & Settings</span>
            <CommandShortcut>⌘ ,</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Viewport Actions */}
        <CommandGroup heading="Viewport Controls">
          <CommandItem
            value="fit model focus frame camera"
            onSelect={() => runAction(() => fitToScreen())}
          >
            <HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>Fit Model to Screen</span>
            <CommandShortcut>F</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="reset camera position home view"
            onSelect={() => runAction(() => resetCamera())}
          >
            <HugeiconsIcon icon={Box} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>Reset Camera</span>
            <CommandShortcut>Home</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="toggle wireframe topology edges"
            onSelect={() => runAction(() => setShowWireframe(!showWireframe))}
          >
            <HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>{showWireframe ? 'Hide Wireframe Overlay' : 'Show Wireframe Overlay'}</span>
          </CommandItem>

          <CommandItem
            value="toggle grid floor ground"
            onSelect={() => runAction(() => setShowGrid(!showGrid))}
          >
            <HugeiconsIcon icon={GridIcon} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>{showGrid ? 'Hide Grid' : 'Show Grid'}</span>
          </CommandItem>

          <CommandItem
            value="turntable auto rotate 360 preview"
            onSelect={() => runAction(() => setIsTurntable(!isTurntable))}
          >
            <HugeiconsIcon icon={RotateCw} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>{isTurntable ? 'Stop Turntable' : 'Start Turntable Rotation'}</span>
          </CommandItem>

          <CommandItem
            value="screenshot snapshot capture image render viewport"
            onSelect={() => runAction(() => window.dispatchEvent(new CustomEvent('takeViewportSnapshot')))}
          >
            <HugeiconsIcon icon={Camera01Icon} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>Capture 3D Viewport Snapshot</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Panels & Modals */}
        <CommandGroup heading="Workspace Panels">
          <CommandItem
            value="inspector properties panel geometry pbr"
            onSelect={() =>
              runAction(() => {
                setActiveRightTab('properties');
                setRightPanelMode('properties');
                setIsRightPanelOpen(true);
              })
            }
          >
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>Open Properties Inspector</span>
          </CommandItem>

          <CommandItem
            value="asset library drawer files"
            onSelect={() =>
              runAction(() => {
                setActiveRightTab('assets');
                setRightPanelMode('assets');
                setIsRightPanelOpen(true);
              })
            }
          >
            <HugeiconsIcon icon={LayersIcon} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>Open Asset Library Drawer</span>
          </CommandItem>

          <CommandItem
            value="dcc bridge blender maya unity unreal connect"
            onSelect={() => runAction(() => setIsDccBridgeOpen(true))}
          >
            <HugeiconsIcon icon={CableIcon} size={16} className="mr-2 h-4 w-4 shrink-0" />
            <span>Open DCC Bridge (Blender / Maya)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
