import React, { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { ShadingMode, ModelAsset } from '../types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { toast } from 'sonner';
import { downloadArtifact } from '../lib/artifactDownload';
import { MeshDiffViewer } from '../Viewport/MeshDiffViewer';
import { ModelComparisonViewer } from '../Viewport/ModelComparisonViewer';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Box,
  Cancel,
  CheckIcon,
  ChevronDown,
  DownloadIcon,
  EyeIcon,
  HexagonIcon,
  LayersIcon,
  Lock,
  MoveIcon,
  PaletteIcon,
  Plus,
  RefreshCw,
  Search01Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Unlock,
  ZapIcon,
} from '@hugeicons/core-free-icons';
import { useViewerStore } from '@/stores/useViewerStore';
import { useUIStore } from '@/stores/useUIStore';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import AssetSelectorModal from '@/features/mesh-extras/AssetSelectorModal.jsx';

export const RightPropertyPanel: React.FC = () => {
  const { 
    currentAsset, 
    activeTool,
    shadingMode,
    setShadingMode,
    showWireframe,
    setShowWireframe,
    remeshSettings,
    textureSettings,
    generationSettings,
    systemStats,
    updateMaterialConfig,
    assets = []
  } = useWorkspace();

  const modelStats = useViewerStore((s) => s.modelStats);

  // Accordion state persisted in UI store
  const rightPanelSections = useUIStore((s) => s.rightPanelSections);
  const setRightPanelSectionExpanded = useUIStore((s) => s.setRightPanelSectionExpanded);
  const toggleRightPanelSection = useUIStore((s) => s.toggleRightPanelSection);

  // Client-side text filter
  const [filterQuery, setFilterQuery] = useState('');
  const normalizedFilter = filterQuery.trim().toLowerCase();

  // Model comparison state
  const [selectedCompareAssetId, setSelectedCompareAssetId] = useState<string | null>(null);
  const [selectedLineageUrl, setSelectedLineageUrl] = useState<string | null>(null);
  const [selectedLineageLabel, setSelectedLineageLabel] = useState<string | null>(null);
  const [isComparePickerOpen, setIsComparePickerOpen] = useState(false);

  // Auto-expand section matching activeTool; manual toggle overrides auto behavior
  const manualOverridesRef = useRef<Set<string>>(new Set());
  const prevToolRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevToolRef.current !== activeTool) {
      prevToolRef.current = activeTool;
      let targetSection: string | null = null;
      if (activeTool === 'edit') {
        targetSection = 'transform';
      } else if (activeTool === 'texture' || activeTool === 'pbr' || activeTool === 'remesh' || activeTool === 'model') {
        targetSection = 'context';
      }
      if (targetSection && !manualOverridesRef.current.has(targetSection)) {
        setRightPanelSectionExpanded(targetSection, true);
      }
    }
  }, [activeTool, setRightPanelSectionExpanded]);

  const handleManualToggle = (sectionId: string) => {
    manualOverridesRef.current.add(sectionId);
    toggleRightPanelSection(sectionId);
  };

  const isSectionVisible = (keywords: string[]) => {
    if (!normalizedFilter) return true;
    return keywords.some(
      (kw) => kw.toLowerCase().includes(normalizedFilter) || normalizedFilter.includes(kw.toLowerCase())
    );
  };

  const isSectionExpanded = (sectionId: string, keywords: string[]) => {
    if (normalizedFilter) {
      return isSectionVisible(keywords);
    }
    return rightPanelSections?.[sectionId] ?? true;
  };

  const [exportFormat, setExportFormat] = useState<'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply'>('glb');
  const [embedTextures, setEmbedTextures] = useState(true);
  const [dracoCompression, setDracoCompression] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // ponytail: transforms are display-only — not applied to the 3D scene
  const [transform, setTransform] = useState({
    posX: 0,
    posY: 0,
    posZ: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    scaleZ: 1.0,
    lockScale: true
  });

  // Material & PBR Shader Settings
  const [materialSettings, setMaterialSettings] = useState({
    albedoColor: 'hsl(0, 0%, 100%)',
    roughness: 0.45,
    metallic: 0.15,
    normalStrength: 1.0,
    ambientOcclusion: 0.85,
    displacementScale: 0.05,
    normalFormat: 'OpenGL' as 'OpenGL' | 'DirectX',
    uvProjection: 'Smart UV (xatlas)'
  });

  const handleScaleChange = (val: number) => {
    if (transform.lockScale) {
      setTransform(prev => ({ ...prev, scaleX: val, scaleY: val, scaleZ: val }));
    } else {
      setTransform(prev => ({ ...prev, scaleX: val }));
    }
  };

  const handleResetTransform = () => {
    setTransform({
      posX: 0,
      posY: 0,
      posZ: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1.0,
      scaleY: 1.0,
      scaleZ: 1.0,
      lockScale: true
    });
  };

  const handleExportDownload = async () => {
    if (!currentAsset) return;
    const sourceUrl =
      currentAsset.artifacts?.gameReadyFormats?.[exportFormat] ||
      (exportFormat === 'glb' ? currentAsset.artifacts?.gameReady : undefined) ||
      (exportFormat === 'glb' ? currentAsset.source?.localUrl || currentAsset.source?.viewUrl : undefined);
    if (!sourceUrl) {
      toast.error('Export unavailable', {
        description: `${exportFormat.toUpperCase()} is not available for this asset yet.`,
      });
      return;
    }

    const assetBaseName = currentAsset.name.replace(/\.[^.]+$/, '');
    setIsExporting(true);
    try {
      await downloadArtifact(sourceUrl, `${assetBaseName}.${exportFormat}`, exportFormat);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : 'Export failed';
      toast.error('Export failed', { description: msg });
      setExportSuccess(false);
    } finally {
      setIsExporting(false);
    }
  };

  if (!currentAsset) {
    return (
      <div id="panel-properties-inspector" className="flex flex-col h-full items-center justify-center bg-[hsl(var(--surface-1))] px-6 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--surface-0))] border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-3 shadow-inner">
          <HugeiconsIcon icon={Box} size={16} className="w-6 h-6 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-xs font-bold text-white tracking-wide">No Active 3D Asset</div>
        <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed max-w-[210px]">
          Generate a model or select one from the Assets tab to inspect geometry, PBR maps, and exports.
        </div>
      </div>
    );
  }

  // Keywords for filtering
  const transformKeywords = ['transform', 'position', 'rotation', 'scale', 'world space', 'euler', 'ratio', 'x', 'y', 'z'];
  const geometryKeywords = ['geometry', 'topology', 'manifold', 'watertight', 'vertices', 'polygons', 'faces', 'surface area', 'volume', 'uv charts', 'dimensions', 'components', 'semantic', 'details'];
  const contextKeywords = 
    activeTool === 'remesh'
      ? ['retopology', 'quad', 'fastmesh', 'variant', 'polygons', 'flow', 'alignment', 'remesh']
      : activeTool === 'model'
      ? ['ai generator', 'pipeline', 'model engine', 'octree', 'diffusion', 'rmbg', 'cutout', 'generator']
      : ['pbr', 'material', 'roughness', 'metallic', 'normal', 'intensity', 'cavity', 'ambient occlusion', 'ao', 'baked', 'maps'];
  const shadingKeywords = ['shading', 'viewport', 'pbr lit', 'clay', 'gold', 'chrome', 'ceramic', 'normals', 'wire solo', 'wireframe', 'overlay'];
  const meshDiffKeywords = ['mesh difference', 'difference', 'diff viewer', 'diff'];
  const comparisonKeywords = ['model comparison', 'comparison', 'compare', 'lineage', 'qa', 'score', 'delta'];
  const exportKeywords = ['quick export', 'export', 'download', 'format', 'glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'embed', 'draco', 'compression'];

  // QA score calculations for Model Comparison (never estimate client-side)
  const currentQAReport = (currentAsset.artifacts?.qaReport as any);
  const currentQA = (currentQAReport?.qa as any) || currentQAReport;
  const currentScore = typeof currentAsset.qaScore === 'number'
    ? currentAsset.qaScore
    : typeof currentQA?.score === 'number'
    ? currentQA.score
    : typeof currentQAReport?.score === 'number'
    ? currentQAReport.score
    : undefined;
  const currentTopology = currentQA?.subscores?.geometry_topology ?? currentQAReport?.subscores?.geometry_topology;
  const currentUV = currentQA?.subscores?.uv_material ?? currentQAReport?.subscores?.uv_material;
  const currentBudget = currentQA?.subscores?.platform ?? currentQAReport?.subscores?.platform;

  let compareScore: number | undefined;
  let compareTopology: number | undefined;
  let compareUV: number | undefined;
  let compareBudget: number | undefined;

  if (selectedCompareAssetId) {
    const compareAsset = assets.find((a: ModelAsset) => a.id === selectedCompareAssetId);
    if (compareAsset) {
      const compReport = (compareAsset.artifacts?.qaReport as any);
      const compQA = (compReport?.qa as any) || compReport;
      compareScore = typeof compareAsset.qaScore === 'number'
        ? compareAsset.qaScore
        : typeof compQA?.score === 'number'
        ? compQA.score
        : typeof compReport?.score === 'number'
        ? compReport.score
        : undefined;
      compareTopology = compQA?.subscores?.geometry_topology ?? compReport?.subscores?.geometry_topology;
      compareUV = compQA?.subscores?.uv_material ?? compReport?.subscores?.uv_material;
      compareBudget = compQA?.subscores?.platform ?? compReport?.subscores?.platform;
    }
  } else if (selectedLineageUrl) {
    const beforeQA = (currentQAReport?.before_postprocess?.qa as any) || (currentQAReport?.before_postprocess as any) || (currentQAReport?.before as any);
    if (beforeQA) {
      compareScore = beforeQA.score;
      compareTopology = beforeQA.subscores?.geometry_topology;
      compareUV = beforeQA.subscores?.uv_material;
      compareBudget = beforeQA.subscores?.platform;
    }
  }

  const activeCompareTarget = selectedLineageUrl || selectedCompareAssetId;

  return (
    <div 
      id="panel-properties-inspector" 
      className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden"
    >
      {/* Header with Asset Meta */}
      <div className="p-2.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] flex items-center justify-center text-primary flex-shrink-0">
            <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))] truncate">{currentAsset.name}</h2>
            <span className="text-xs text-[hsl(var(--muted-foreground))] block">Inspector & Properties</span>
          </div>
        </div>
        <span className="text-xs uppercase font-mono font-bold px-2 py-0.5 rounded-md bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-primary flex-shrink-0">
          {currentAsset.format}
        </span>
      </div>

      {/* Client-side text filter */}
      <div className="px-2.5 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-0))]/50">
        <div className="relative flex items-center">
          <HugeiconsIcon icon={Search01Icon} size={14} className="absolute left-2.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter properties..."
            className="w-full pl-8 pr-7 py-1 text-xs rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-primary transition-all font-mono"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2 text-[hsl(var(--muted-foreground))] hover:text-white"
            >
              <HugeiconsIcon icon={Cancel} size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 no-scrollbar">
        {/* 1. Object Transform Section */}
        {isSectionVisible(transformKeywords) && (
          <Collapsible
            open={isSectionExpanded('transform', transformKeywords)}
            onOpenChange={() => handleManualToggle('transform')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={MoveIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Object Transform
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('transform', transformKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetTransform();
                }}
                className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))] transition-colors"
              >
                <SimpleTooltip label="Reset Transform">
                  <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" />
                </SimpleTooltip>
              </button>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-2 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* Position (m) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span>Position (m)</span>
                  <span className="font-mono text-[hsl(var(--muted-foreground))]">World Space</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--destructive))] font-bold mr-1 text-xs">X</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={transform.posX} 
                      onChange={(e) => setTransform(p => ({ ...p, posX: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-green))] font-bold mr-1 text-xs">Y</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={transform.posY} 
                      onChange={(e) => setTransform(p => ({ ...p, posY: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-blue))] font-bold mr-1 text-xs">Z</span>
                    <input 
                      type="number" 
                      step="0.1" 
                      value={transform.posZ} 
                      onChange={(e) => setTransform(p => ({ ...p, posZ: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                </div>
              </div>

              {/* Rotation (°) */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span>Rotation (Euler °)</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--destructive))] font-bold mr-1 text-xs">X</span>
                    <input 
                      type="number" 
                      value={transform.rotX} 
                      onChange={(e) => setTransform(p => ({ ...p, rotX: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-green))] font-bold mr-1 text-xs">Y</span>
                    <input 
                      type="number" 
                      value={transform.rotY} 
                      onChange={(e) => setTransform(p => ({ ...p, rotY: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-blue))] font-bold mr-1 text-xs">Z</span>
                    <input 
                      type="number" 
                      value={transform.rotZ} 
                      onChange={(e) => setTransform(p => ({ ...p, rotZ: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                </div>
              </div>

              {/* Scale */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                  <span>Scale Ratio</span>
                  <button
                    onClick={() => setTransform(p => ({ ...p, lockScale: !p.lockScale }))}
                    className="flex items-center gap-1 text-primary hover:underline text-[11px]"
                  >
                    {transform.lockScale ? <HugeiconsIcon icon={Lock} size={16} className="w-3 h-3" /> : <HugeiconsIcon icon={Unlock} size={16} className="w-3 h-3" />}
                    <span>{transform.lockScale ? 'Uniform Locked' : 'Independent'}</span>
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--destructive))] font-bold mr-1 text-xs">X</span>
                    <input 
                      type="number" 
                      step="0.05" 
                      value={transform.scaleX} 
                      onChange={(e) => handleScaleChange(parseFloat(e.target.value) || 1)}
                      className="w-full bg-transparent text-[hsl(var(--foreground))] outline-none" 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-green))] font-bold mr-1 text-xs">Y</span>
                    <input 
                      type="number" 
                      step="0.05" 
                      value={transform.scaleY} 
                      onChange={(e) => setTransform(p => ({ ...p, scaleY: parseFloat(e.target.value) || 1 }))}
                      disabled={transform.lockScale}
                      className={`w-full bg-transparent text-[hsl(var(--foreground))] outline-none ${transform.lockScale ? 'opacity-70' : ''}`} 
                    />
                  </div>
                  <div className="flex items-center px-2 py-1 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--neon-blue))] font-bold mr-1 text-xs">Z</span>
                    <input 
                      type="number" 
                      step="0.05" 
                      value={transform.scaleZ} 
                      onChange={(e) => setTransform(p => ({ ...p, scaleZ: parseFloat(e.target.value) || 1 }))}
                      disabled={transform.lockScale}
                      className={`w-full bg-transparent text-[hsl(var(--foreground))] outline-none ${transform.lockScale ? 'opacity-70' : ''}`} 
                    />
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 2. Geometry Statistics & Topology Health */}
        {isSectionVisible(geometryKeywords) && (() => {
          const verticesDisplay = currentAsset?.vertices
            ? currentAsset.vertices.toLocaleString()
            : modelStats?.vertices
            ? modelStats.vertices.toLocaleString()
            : '—';

          const facesDisplay = currentAsset?.faces
            ? currentAsset.faces.toLocaleString()
            : modelStats?.triangles
            ? modelStats.triangles.toLocaleString()
            : '—';

          const isManifold = currentAsset?.isManifold ?? modelStats?.isManifold ?? true;
          const nonManifoldEdges = currentAsset?.nonManifoldEdges ?? modelStats?.nonManifoldEdges ?? 0;
          const surfaceArea = currentAsset?.surfaceArea ?? modelStats?.surfaceArea;
          const volume = currentAsset?.volume ?? modelStats?.volume;
          const uvCharts = currentAsset?.uvCharts ?? modelStats?.uvCharts;

          return (
            <Collapsible
              open={isSectionExpanded('geometry', geometryKeywords)}
              onOpenChange={() => handleManualToggle('geometry')}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
            >
              <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                  >
                    <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                      Geometry & Topology
                    </span>
                    <HugeiconsIcon
                      icon={ChevronDown}
                      size={14}
                      className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                        isSectionExpanded('geometry', geometryKeywords) ? 'rotate-180 text-primary' : ''
                      }`}
                    />
                  </button>
                </CollapsibleTrigger>
                {isManifold && nonManifoldEdges === 0 ? (
                  <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--neon-green))] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--neon-green))]/10 border border-[hsl(var(--neon-green))]/30">
                    <HugeiconsIcon icon={ShieldCheckIcon} size={16} className="w-3 h-3" />
                    Manifold
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                    <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-3 h-3" />
                    Non-Manifold ({nonManifoldEdges})
                  </span>
                )}
              </div>

              <CollapsibleContent className="px-2.5 pb-3 space-y-2.5 pt-1 border-t border-[hsl(var(--border))]/40">
                {/* Counts & Flow */}
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Vertices</span>
                    <span className="font-bold text-[hsl(var(--foreground))]">{verticesDisplay}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Polygons</span>
                    <span className="font-bold text-primary">{facesDisplay}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Topology</span>
                    <span className="font-bold text-[hsl(var(--neon-blue))] truncate block">{currentAsset.topology || 'Triangle'}</span>
                  </div>
                </div>

                {/* Physical Telemetry: Surface Area, Volume, UV Charts */}
                <div className="grid grid-cols-3 gap-1.5 font-mono text-xs">
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Surface Area</span>
                    <span className="font-bold text-[hsl(var(--foreground))]">{surfaceArea !== undefined ? `${surfaceArea} m²` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">Volume</span>
                    <span className="font-bold text-primary">{volume !== undefined ? `${volume} m³` : '—'}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-[hsl(var(--muted-foreground))] block text-[10px]">UV Islands</span>
                    <span className="font-bold text-[hsl(var(--neon-green))]">{uvCharts !== undefined && uvCharts > 0 ? `${uvCharts} charts` : '1 chart'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                  <span>UV Channels</span>
                  <span className="font-mono text-[hsl(var(--foreground))]">2 (UV0: Diffuse, UV1: Lightmap)</span>
                </div>
                {currentAsset.dimensions && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                    <span>Dimensions (X×Y×Z)</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset.dimensions.x} × {currentAsset.dimensions.y} × {currentAsset.dimensions.z} m</span>
                  </div>
                )}
                {currentAsset.componentCount !== undefined && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                    <span>Components / Parts</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">{currentAsset.componentCount > 0 ? `${currentAsset.componentCount} connected parts` : '1 part'}</span>
                  </div>
                )}
                {currentAsset.meshDetails && (
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1 border-t border-[hsl(var(--border))]">
                    <span>Semantic Details</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">
                      {Array.isArray((currentAsset.meshDetails as any)?.semantic_parts)
                        ? ((currentAsset.meshDetails as any).semantic_parts.length > 0
                          ? (currentAsset.meshDetails as any).semantic_parts.join(', ')
                          : 'Not analyzed / monolithic')
                        : typeof (currentAsset.meshDetails as any)?.semantic_parts === 'string'
                          ? (currentAsset.meshDetails as any).semantic_parts
                          : 'Unsupported'}
                    </span>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })()}

        {/* 3. Dynamic Context-Aware Inspector Sections based on activeTool */}
        {(activeTool === 'texture' || activeTool === 'pbr' || activeTool === 'remesh' || activeTool === 'model') && isSectionVisible(contextKeywords) && (
          <Collapsible
            open={isSectionExpanded('context', contextKeywords)}
            onOpenChange={() => handleManualToggle('context')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  {activeTool === 'remesh' ? (
                    <HugeiconsIcon icon={HexagonIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  ) : activeTool === 'model' ? (
                    <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  ) : (
                    <HugeiconsIcon icon={PaletteIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    {activeTool === 'remesh'
                      ? 'Quad Retopology Inspector'
                      : activeTool === 'model'
                      ? '3D AI Generator Pipeline'
                      : 'PBR Material Channels'}
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('context', contextKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-3 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* CASE A: Tool is Texture or PBR */}
              {(activeTool === 'texture' || activeTool === 'pbr') && (
                <>
                  {/* Roughness */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
                      <span>Roughness</span>
                      <span className="font-mono font-bold text-primary">{materialSettings.roughness.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={materialSettings.roughness}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setMaterialSettings(p => ({ ...p, roughness: val }));
                        updateMaterialConfig?.({ roughness: val });
                      }}
                      className="w-full accent-primary cursor-pointer"
                    />
                  </div>

                  {/* Metallic */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
                      <span>Metallic</span>
                      <span className="font-mono font-bold text-primary">{materialSettings.metallic.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={materialSettings.metallic}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setMaterialSettings(p => ({ ...p, metallic: val }));
                        updateMaterialConfig?.({ metalness: val });
                      }}
                      className="w-full accent-primary cursor-pointer"
                    />
                  </div>

                  {/* Normal Strength */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
                      <span>Normal Intensity</span>
                      <span className="font-mono font-bold text-primary">{materialSettings.normalStrength.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={materialSettings.normalStrength}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setMaterialSettings(p => ({ ...p, normalStrength: val }));
                        updateMaterialConfig?.({ normalScale: val });
                      }}
                      className="w-full accent-primary cursor-pointer"
                    />
                  </div>

                  {/* Ambient Occlusion */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[hsl(var(--foreground))]">
                      <span>Cavity & AO Strength</span>
                      <span className="font-mono font-bold text-primary">{materialSettings.ambientOcclusion.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={materialSettings.ambientOcclusion}
                      onChange={(e) => setMaterialSettings(p => ({ ...p, ambientOcclusion: parseFloat(e.target.value) }))}
                      className="w-full accent-primary cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] pt-1.5 border-t border-[hsl(var(--border))]">
                    <span>Normal Standard</span>
                    <div className="flex gap-1.5">
                      {(['OpenGL', 'DirectX'] as const).map(fmt => (
                        <button
                          key={fmt}
                          onClick={() => setMaterialSettings(p => ({ ...p, normalFormat: fmt }))}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-colors ${
                            materialSettings.normalFormat === fmt
                              ? 'bg-primary text-[hsl(var(--primary-foreground))]'
                              : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {currentAsset?.artifacts?.pbrMaps && Object.keys(currentAsset.artifacts.pbrMaps).length > 0 && (
                    <div className="pt-2 border-t border-[hsl(var(--border))] space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                        Baked PBR Maps
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(currentAsset.artifacts.pbrMaps).map(([mapType, url]) => (
                          <a
                            key={mapType}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] text-[11px] font-medium text-[hsl(var(--foreground))] flex items-center justify-between border border-[hsl(var(--border))] transition-colors"
                          >
                            <span className="capitalize">{mapType}</span>
                            <HugeiconsIcon icon={DownloadIcon} size={16} className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* CASE B: Tool is Retopo / Remesh */}
              {activeTool === 'remesh' && (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>FastMesh Variant</span>
                    <span className="font-mono font-bold text-primary">{remeshSettings.variant}</span>
                  </div>
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>Output Polygons</span>
                    <span className="font-mono text-[hsl(var(--neon-blue))] uppercase">{remeshSettings.polyType}</span>
                  </div>
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>Quad Flow Alignment</span>
                    <span className="font-mono text-[hsl(var(--neon-green))]">{currentAsset.topology} • {currentAsset.statsAvailable ? currentAsset.faces.toLocaleString() : '—'} faces</span>
                  </div>
                </div>
              )}

              {/* CASE D: Tool is 3D Generation / Model */}
              {activeTool === 'model' && (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>Model Engine</span>
                    <span className="font-mono text-primary">{generationSettings.aiModel}</span>
                  </div>
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>Octree Depth</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">Not available until workflow execution</span>
                  </div>
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>Diffusion Steps</span>
                    <span className="font-mono text-[hsl(var(--foreground))]">Workflow-defined</span>
                  </div>
                  <div className="flex justify-between text-[hsl(var(--foreground))]">
                    <span>Cutout RMBG</span>
                    <span className="font-mono text-[hsl(var(--neon-green))]">{generationSettings.removeBackground ? 'Requested' : 'Off'}</span>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 4. Shading & Render Viewport Overrides */}
        {isSectionVisible(shadingKeywords) && (
          <Collapsible
            open={isSectionExpanded('shading', shadingKeywords)}
            onOpenChange={() => handleManualToggle('shading')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={EyeIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Viewport Shading
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('shading', shadingKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 pt-1 border-t border-[hsl(var(--border))]/40">
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => setShadingMode('textured')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'textured'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  PBR Lit
                </button>

                <button
                  onClick={() => setShadingMode('clay')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'clay'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Clay
                </button>

                <button
                  onClick={() => setShadingMode('matcap-gold')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-gold'
                      ? 'bg-amber-400 text-black font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Gold
                </button>

                <button
                  onClick={() => setShadingMode('matcap-chrome')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-chrome'
                      ? 'bg-zinc-200 text-black font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Chrome
                </button>

                <button
                  onClick={() => setShadingMode('matcap-ceramic')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-ceramic' || shadingMode === 'matcap'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Ceramic
                </button>

                <button
                  onClick={() => setShadingMode('matcap-normal')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'matcap-normal' || shadingMode === 'normals'
                      ? 'bg-sky-400 text-black font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Normals
                </button>

                <button
                  onClick={() => setShadingMode('wireframe')}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    shadingMode === 'wireframe'
                      ? 'bg-primary text-[hsl(var(--primary-foreground))] font-bold shadow'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  Wire Solo
                </button>

                <button
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`py-1.5 px-1.5 rounded-lg text-xs font-semibold transition-all text-center truncate ${
                    showWireframe
                      ? 'bg-[hsl(var(--neon-green))]/20 text-[hsl(var(--neon-green))] font-bold border border-[hsl(var(--neon-green))]/40'
                      : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                  }`}
                >
                  + Overlay
                </button>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 5. Mesh Difference Viewer (UX-05) */}
        {currentAsset && isSectionVisible(meshDiffKeywords) && (
          <Collapsible
            open={isSectionExpanded('meshDiff', meshDiffKeywords)}
            onOpenChange={() => handleManualToggle('meshDiff')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={ZapIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Mesh Difference Viewer
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('meshDiff', meshDiffKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="px-2.5 pb-3 pt-1 border-t border-[hsl(var(--border))]/40">
              <MeshDiffViewer className="w-full h-full" showControls={true} />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 6. Model Comparison Viewer (UX-02) */}
        {currentAsset && isSectionVisible(comparisonKeywords) && (
          <Collapsible
            open={isSectionExpanded('modelComparison', comparisonKeywords)}
            onOpenChange={() => handleManualToggle('modelComparison')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={ZapIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Model Comparison Viewer
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('modelComparison', comparisonKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-3 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* Target Picker Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {activeCompareTarget ? (
                  <div className="flex items-center justify-between w-full p-2 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))]">
                    <span className="text-xs font-mono truncate text-[hsl(var(--foreground))]">
                      vs {selectedLineageLabel || assets.find((a: ModelAsset) => a.id === selectedCompareAssetId)?.name || 'Comparison Target'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompareAssetId(null);
                        setSelectedLineageUrl(null);
                        setSelectedLineageLabel(null);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[hsl(var(--surface-3))] hover:bg-[hsl(var(--surface-4))] text-zinc-300 hover:text-white transition-all text-[11px]"
                    >
                      <span>Clear</span>
                      <HugeiconsIcon icon={Cancel} size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 w-full">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsComparePickerOpen(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-zinc-200 hover:text-white transition-all font-mono text-xs cursor-pointer"
                      >
                        <HugeiconsIcon icon={Plus} size={14} className="text-primary" />
                        <span>Select Mesh to Compare</span>
                      </button>
                    </div>

                    {/* Quick Lineage Comparison Options (Master vs Game-Ready / LOD) */}
                    {Boolean(currentAsset.artifacts?.source && currentAsset.artifacts?.source !== currentAsset.artifacts?.gameReady) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLineageUrl(currentAsset.artifacts!.source!);
                          setSelectedCompareAssetId(null);
                          setSelectedLineageLabel('Source Master (Raw)');
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-md bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-[11px] text-[hsl(var(--muted-foreground))] hover:text-white transition-colors"
                      >
                        <span>Compare with Source Master</span>
                      </button>
                    )}

                    {Boolean(currentAsset.artifacts?.lods && currentAsset.artifacts.lods.length > 0) && (
                      <div className="flex gap-1.5">
                        {currentAsset.artifacts!.lods!.map((lodUrl, idx) => (
                          <button
                            key={lodUrl}
                            type="button"
                            onClick={() => {
                              setSelectedLineageUrl(lodUrl);
                              setSelectedCompareAssetId(null);
                              setSelectedLineageLabel(`LOD ${idx + 1}`);
                            }}
                            className="flex-1 py-1 px-1.5 rounded-md bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-[10px] font-mono text-[hsl(var(--muted-foreground))] hover:text-white transition-colors"
                          >
                            LOD {idx + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Surface Real QA Score Delta and Sub-scores (Topology/UV/Budget) */}
              {activeCompareTarget && (
                <div>
                  {typeof currentScore === 'number' && typeof compareScore === 'number' ? (
                    <div className="p-2.5 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-[hsl(var(--foreground))]">Objective QA Delta</span>
                        {(() => {
                          const delta = compareScore - currentScore;
                          return (
                            <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded border ${
                              delta > 0
                                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                                : delta < 0
                                ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                                : 'text-sky-400 bg-sky-500/10 border-sky-500/30'
                            }`}>
                              {delta > 0 ? `+${delta}` : delta} pts ({currentScore} → {compareScore})
                            </span>
                          );
                        })()}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                        <div className="p-1.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))]">
                          <span className="text-[hsl(var(--muted-foreground))] block">Topology</span>
                          <span className="font-bold text-[hsl(var(--foreground))]">
                            {typeof currentTopology === 'number' && typeof compareTopology === 'number'
                              ? `${(compareTopology - currentTopology >= 0 ? '+' : '') + (compareTopology - currentTopology).toFixed(1)}`
                              : '—'}
                          </span>
                        </div>
                        <div className="p-1.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))]">
                          <span className="text-[hsl(var(--muted-foreground))] block">UV & Mat</span>
                          <span className="font-bold text-[hsl(var(--foreground))]">
                            {typeof currentUV === 'number' && typeof compareUV === 'number'
                              ? `${(compareUV - currentUV >= 0 ? '+' : '') + (compareUV - currentUV).toFixed(1)}`
                              : '—'}
                          </span>
                        </div>
                        <div className="p-1.5 rounded bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))]">
                          <span className="text-[hsl(var(--muted-foreground))] block">Budget</span>
                          <span className="font-bold text-[hsl(var(--foreground))]">
                            {typeof currentBudget === 'number' && typeof compareBudget === 'number'
                              ? `${(compareBudget - currentBudget >= 0 ? '+' : '') + (compareBudget - currentBudget).toFixed(1)}`
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] italic px-1">
                      Backend QA diagnostic data not available for comparison target.
                    </div>
                  )}
                </div>
              )}

              <ModelComparisonViewer 
                className="w-full h-full min-h-[200px]" 
                showControls={true} 
                modelIds={activeCompareTarget ? [currentAsset.id, activeCompareTarget] : []} 
              />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 7. Production Export Section */}
        {isSectionVisible(exportKeywords) && (
          <Collapsible
            open={isSectionExpanded('export', exportKeywords)}
            onOpenChange={() => handleManualToggle('export')}
            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] overflow-hidden transition-all"
          >
            <div className="flex items-center justify-between p-2.5 hover:bg-[hsl(var(--surface-2))]/40 transition-colors">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 flex-1 text-left select-none cursor-pointer group"
                >
                  <HugeiconsIcon icon={DownloadIcon} size={16} className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-bold text-xs text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] uppercase tracking-wider transition-colors">
                    Quick Export Asset
                  </span>
                  <HugeiconsIcon
                    icon={ChevronDown}
                    size={14}
                    className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] ml-auto mr-1 transition-transform duration-200 ${
                      isSectionExpanded('export', exportKeywords) ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="px-2.5 pb-3 space-y-3 pt-1 border-t border-[hsl(var(--border))]/40">
              {/* Formats Grid */}
              <div className="grid grid-cols-6 gap-1">
                {(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`py-1.5 rounded-lg uppercase font-mono font-bold text-xs transition-colors ${
                      exportFormat === fmt
                        ? 'bg-primary text-[hsl(var(--primary-foreground))]'
                        : 'bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>

              {/* Export Options Toggles */}
              <div className="space-y-2 text-xs">
                <label className="flex items-center justify-between text-[hsl(var(--foreground))] cursor-pointer">
                  <span>Embed PBR Textures</span>
                  <input
                    type="checkbox"
                    checked={embedTextures}
                    onChange={(e) => setEmbedTextures(e.target.checked)}
                    className="rounded accent-primary cursor-pointer"
                  />
                </label>
                <label className="flex items-center justify-between text-[hsl(var(--foreground))] cursor-pointer">
                  <span>Draco Mesh Compression</span>
                  <input
                    type="checkbox"
                    checked={dracoCompression}
                    onChange={(e) => setDracoCompression(e.target.checked)}
                    className="rounded accent-primary cursor-pointer"
                  />
                </label>
              </div>

              {/* Download Button */}
              <button
                id="btn-export-download"
                onClick={handleExportDownload}
                disabled={isExporting}
                className="w-full py-2.5 rounded-xl bg-[hsl(var(--surface-3))] hover:bg-[hsl(var(--surface-4))] border border-[hsl(var(--border))] text-primary font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-md cursor-pointer"
              >
                {isExporting ? (
                  <HugeiconsIcon icon={RefreshCw} size={16} className="w-4 h-4 animate-spin text-primary" />
                ) : exportSuccess ? (
                  <HugeiconsIcon icon={CheckIcon} size={16} className="w-4 h-4 text-[hsl(var(--neon-green))]"/>
                ) : (
                  <HugeiconsIcon icon={DownloadIcon} size={16} className="w-4 h-4 text-primary" />
                )}
                <span>
                  {isExporting ? 'Packing 3D Bundle...' : exportSuccess ? 'Export Saved!' : `Download ${exportFormat.toUpperCase()}`}
                </span>
              </button>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Real Modal Picker for Model Comparison (T-03) */}
      {isComparePickerOpen && (
        <AssetSelectorModal
          assetType="mesh"
          onSelect={(asset: any) => {
            if (asset?.id) {
              setSelectedCompareAssetId(asset.id);
              setSelectedLineageUrl(null);
              setSelectedLineageLabel(asset.name || 'Selected Asset');
            }
            setIsComparePickerOpen(false);
          }}
          onClose={() => setIsComparePickerOpen(false)}
          title="Select Model to Compare"
        />
      )}
    </div>
  );
};