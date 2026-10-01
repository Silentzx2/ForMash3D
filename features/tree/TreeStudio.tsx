'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Trees,
  Dices,
  Sparkles,
  Download,
  Grid,
  Eye,
  Sliders,
  Layers,
  RotateCcw,
  Loader2,
  Box,
} from 'lucide-react';
import { useWorkspace } from '@/features/workspace/store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

import TreeViewport from './components/TreeViewport';
import TreeParamPanel from './components/TreeParamPanel';
import TreeTexturePanel from './components/TreeTexturePanel';
import { affectsSkeleton } from './components/treeParams';
import {
  fetchTreePresets,
  previewTree,
  generateTree,
  resolveTextures,
  rollSeed,
  setSpecValue,
} from './utils/treeGen';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './pages/TreeGenPage.css';

function stripWindTint(object: any) {
  object.traverse((node: any) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material?.vertexColors) {
        material.vertexColors = false;
        material.needsUpdate = true;
      }
    }
  });
  return object;
}

export const TreeStudio: React.FC = () => {
  const { navigateToTool } = useWorkspace();

  const [presets, setPresets] = useState<any[]>([]);
  const [presetId, setPresetId] = useState('oak');
  const [spec, setSpec] = useState<any>(null);

  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [meshObject, setMeshObject] = useState<any>(null);
  const [meshStats, setMeshStats] = useState<any>(null);
  const [meshBlob, setMeshBlob] = useState<Blob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ frac: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [textures, setTextures] = useState({ trunk: null, branches: null, leaves: [] });

  const [showGrid, setShowGrid] = useState(true);
  const [orthographic, setOrthographic] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  const [activeTab, setActiveTab] = useState<'params' | 'textures'>('params');

  const previewAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const meshObjectRef = useRef<any>(null);

  // Load tree presets on mount
  useEffect(() => {
    let cancelled = false;
    fetchTreePresets()
      .then(list => {
        if (cancelled) return;
        setPresets(list);
        const defaultPreset = list.find((entry: any) => entry.id === 'oak') || list[0];
        if (defaultPreset) {
          setPresetId(defaultPreset.id);
          setSpec({ ...defaultPreset.spec, seed: rollSeed() });
        }
      })
      .catch(err => {
        if (!cancelled) {
          // Fallback minimal spec if backend isn't ready
          const fallbackSpec = {
            seed: rollSeed(),
            shape: 'conical',
            levels: 3,
            trunk: { length: 12, radius: 0.8, taper: 0.7 },
            leaves: { count: 350, size: 0.8 },
          };
          setSpec(fallbackSpec);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live skeleton preview debounce
  useEffect(() => {
    if (!spec) return;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;

    const timer = setTimeout(() => {
      setPreviewing(true);
      previewTree({ spec, signal: controller.signal } as any)
        .then(payload => {
          setPreview(payload);
          setPreviewError(null);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          setPreviewError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [spec]);

  const selectPreset = useCallback((id: string) => {
    const entry = presets.find(p => p.id === id);
    if (!entry) return;
    setPresetId(id);
    setSpec((current: any) => ({ ...entry.spec, seed: current?.seed ?? entry.spec.seed }));
    setMeshObject(null);
  }, [presets]);

  const handleParamChange = useCallback((path: string, value: any) => {
    setSpec((current: any) => (current ? setSpecValue(current, path, value) : current));
    if (affectsSkeleton(path)) {
      setMeshObject(null);
    }
  }, []);

  const handleRollSeed = useCallback(() => {
    setSpec((current: any) => (current ? { ...current, seed: rollSeed() } : current));
    setMeshObject(null);
  }, []);

  // Dispose old mesh GPU buffers
  const disposeMesh = useCallback((object: any) => {
    object?.traverse?.((node: any) => {
      node.geometry?.dispose?.();
      const material = node.material;
      if (Array.isArray(material)) material.forEach(m => m?.dispose?.());
      else material?.dispose?.();
    });
  }, []);

  useEffect(() => {
    const previous = meshObjectRef.current;
    meshObjectRef.current = meshObject;
    if (previous && previous !== meshObject) disposeMesh(previous);
  }, [meshObject, disposeMesh]);

  useEffect(() => () => disposeMesh(meshObjectRef.current), [disposeMesh]);

  // Full mesh build
  const handleGenerate = useCallback(async () => {
    if (!spec || generating) return;
    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;

    setGenerating(true);
    setError(null);
    setProgress({ frac: 0, message: 'Starting geometry engine…' });

    try {
      setProgress({ frac: 0.1, message: 'Resolving textures…' });
      const resolved = await resolveTextures(textures, { signal: controller.signal });

      const result = await generateTree({
        spec,
        ...resolved,
        signal: controller.signal,
        onProgress: (event: any) => setProgress({ frac: event.frac, message: event.message || event.stage }),
      } as any);

      const url = URL.createObjectURL(result.blob);
      try {
        const gltf = await new GLTFLoader().loadAsync(url);
        setMeshObject(stripWindTint(gltf.scene));
      } finally {
        URL.revokeObjectURL(url);
      }

      setMeshBlob(result.blob);
      setMeshStats(result.stats);
      if (result.spec) setSpec(result.spec);
      setFrameKey(key => key + 1);
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }, [spec, generating, textures]);

  const handleDownload = useCallback(() => {
    if (!meshBlob) return;
    const url = URL.createObjectURL(meshBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tree_${presetId}_${spec?.seed || Date.now()}.glb`;
    a.click();
    URL.revokeObjectURL(url);
  }, [meshBlob, presetId, spec]);

  return (
    <div className="w-full h-full flex flex-col bg-[#080808] text-neutral-100 select-none overflow-hidden relative font-sans">
      {/* Top Header Bar */}
      <header className="h-12 border-b border-white/[0.08] bg-[#0c0c0c] px-4 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <SimpleTooltip label="Back to 3D Workspace">
            <button
              onClick={() => navigateToTool('model')}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </SimpleTooltip>
          <div className="flex items-center gap-2">
            <Trees className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm tracking-wide text-neutral-100">Tree Studio</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
              PROCEDURAL
            </span>
          </div>
        </div>

        {/* Center Preset Selector & Seed */}
        <div className="flex items-center gap-2">
          {presets.length > 0 && (
            <select
              value={presetId}
              onChange={e => selectPreset(e.target.value)}
              className="bg-[#181818] border border-white/[0.1] text-xs text-neutral-200 rounded-lg px-2.5 py-1.5 focus:border-primary/50 outline-none"
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          )}

          <SimpleTooltip label="Re-roll Seed">
            <button
              onClick={handleRollSeed}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181818] border border-white/[0.1] text-xs font-mono text-neutral-300 hover:text-primary hover:border-primary/40 transition-colors"
            >
              <Dices className="w-3.5 h-3.5 text-primary" />
              <span>{spec?.seed ?? '—'}</span>
            </button>
          </SimpleTooltip>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGrid(prev => !prev)}
            className={`p-1.5 rounded-lg border transition-colors ${
              showGrid ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-[#181818] border-white/[0.08] text-neutral-400'
            }`}
          >
            <Grid className="w-4 h-4" />
          </button>

          {meshBlob && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#181818] border border-white/[0.1] text-xs font-semibold text-neutral-200 hover:text-white hover:border-primary/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              Export GLB
            </button>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-black text-xs font-bold hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{progress?.message || 'Building...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Build 3D Mesh</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Side Parameters Drawer */}
        <aside className="w-80 border-r border-white/[0.08] bg-[#0e0e0e] flex flex-col z-10 flex-shrink-0">
          <div className="flex items-center border-b border-white/[0.08] bg-[#121212]">
            <button
              onClick={() => setActiveTab('params')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'params' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Parameters
            </button>
            <button
              onClick={() => setActiveTab('textures')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'textures' ? 'text-primary border-b-2 border-primary bg-white/[0.02]' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Textures
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 text-neutral-300">
            {activeTab === 'params' ? (
              <TreeParamPanel spec={spec} onChange={handleParamChange} />
            ) : (
              <TreeTexturePanel textures={textures} onChange={setTextures} />
            )}
          </div>
        </aside>

        {/* Center 3D Viewport */}
        <main className="flex-1 relative h-full bg-[#080808] overflow-hidden">
          <TreeViewport
            polylines={preview?.polylines || null}
            meshObject={meshObject}
            bounds={preview?.bounds || null}
            frameKey={frameKey}
            orthographic={orthographic}
            showGrid={showGrid}
            onCameraReady={() => {}}
          />

          {/* Telemetry overlay */}
          <div className="absolute bottom-3 left-3 bg-[#121212]/80 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-1.5 text-[11px] font-mono text-neutral-400 pointer-events-none flex items-center gap-4">
            <div>
              Status:{' '}
              <span className={meshObject ? 'text-emerald-400' : previewing ? 'text-amber-400' : 'text-primary'}>
                {meshObject ? 'Committed Mesh' : previewing ? 'Computing Skeleton...' : 'Live Skeleton'}
              </span>
            </div>
            {meshStats && (
              <div>
                Triangles: <span className="text-neutral-200">{meshStats.triangles?.toLocaleString() || '—'}</span>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="absolute top-3 inset-x-12 mx-auto max-w-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs px-3 py-2 rounded-lg flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-neutral-400 hover:text-white">
                ✕
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
export default TreeStudio;
