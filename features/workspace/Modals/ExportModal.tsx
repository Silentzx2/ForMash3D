import React, { useState, useEffect } from 'react';
import { Download, X, FileBox, Check, Layers, Archive, Box, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceContext';
import { motion, AnimatePresence } from 'motion/react';

export const ExportModal: React.FC = () => {
  const { isExportModalOpen, setIsExportModalOpen, currentAsset } = useWorkspace();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Variant & Format states
  const [variant, setVariant] = useState<'source' | 'game_ready' | 'lod_package'>('game_ready');
  const [exportFormat, setExportFormat] = useState<'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply'>('glb');
  const [targetPlatform, setTargetPlatform] = useState<'mobile' | 'low' | 'medium' | 'high' | 'cinematic'>('medium');

  // Packaging toggles
  const [packageZip, setPackageZip] = useState(false);

  // Dismiss on Escape
  useEffect(() => {
    if (!isExportModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExportModalOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExportModalOpen, setIsExportModalOpen]);

  if (!isExportModalOpen) return null;

  const assetName = currentAsset?.name || 'character.glb';
  const qaScore = currentAsset?.qaScore ?? (currentAsset?.artifacts?.qaReport as any)?.game_ready_score;
  const qaStatus = currentAsset?.qaStatus ?? (currentAsset?.artifacts?.qaReport as any)?.status;
  const qaWarnings = currentAsset?.qaWarnings ?? (currentAsset?.artifacts?.qaReport as any)?.warnings ?? [];

  const handleExport = async () => {
    const artifacts = currentAsset?.artifacts;
    const zipUrl = artifacts?.zipUrl;
    const sourceArtifact = artifacts?.source;
    const gameReadyUrl =
      artifacts?.gameReadyFormats?.[exportFormat] ||
      artifacts?.gameReady ||
      null;
    const selectedUrl =
      packageZip || variant === 'lod_package'
        ? zipUrl
        : variant === 'source'
        ? sourceArtifact
        : gameReadyUrl;

    if (!selectedUrl) {
      setError('This artifact is not available yet.');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      const link = document.createElement('a');
      link.href = selectedUrl;
      link.download = packageZip || variant === 'lod_package'
        ? `${assetName}.zip`
        : `${assetName}.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setIsExportModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) setIsExportModalOpen(false); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-4 text-xs select-none"
    >
      <div className="w-full max-w-lg max-w-[calc(100vw-1.5rem)] max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(var(--surface-1))] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-[hsl(var(--surface-2))] px-4 sm:px-5 py-3.5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30">
              <FileBox className="h-5 w-5 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Production Export Engine</h2>
              <p className="text-[11px] text-zinc-400 truncate max-w-[200px] sm:max-w-[280px]">{assetName}</p>
            </div>
          </div>
          <button
            onClick={() => setIsExportModalOpen(false)}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-5 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
          {/* QA Quality Score Banner */}
          {qaScore !== undefined && (
            <div className={`p-3 rounded-xl border flex items-center justify-between ${
              qaScore >= 80
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : qaScore >= 50
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[hsl(var(--neon-green))]" />
                <div>
                  <div className="font-bold text-xs flex items-center gap-1.5">
                    <span>Quality Score: {qaScore}/100</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-mono font-bold bg-black/30">
                      {qaStatus || (qaScore >= 80 ? 'PASS' : 'WARN')}
                    </span>
                  </div>
                  <div className="text-[10px] opacity-80">
                    {qaWarnings.length > 0 ? qaWarnings[0] : 'Asset validated for game engine compliance'}
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold">
                {currentAsset?.faces?.toLocaleString() ?? 0} tris
              </span>
            </div>
          )}

          {/* Section 1: Asset Variant */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Asset Variant</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'game_ready', label: 'Game-Ready', tip: 'Optimized budget' },
                { id: 'source', label: 'Source Master', tip: 'Uncompressed raw' },
                { id: 'lod_package', label: 'LOD Package', tip: 'LOD0–LOD3 cascade' },
              ].map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariant(v.id as any)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    variant === v.id
                      ? 'border-primary bg-[hsl(var(--surface-3))] text-white shadow-sm'
                      : 'border-white/[0.08] bg-[hsl(var(--surface-2))] text-zinc-300 hover:border-white/[0.16]'
                  }`}
                >
                  <span className={`block text-xs font-bold ${variant === v.id ? 'text-primary' : 'text-zinc-200'}`}>
                    {v.label}
                  </span>
                  <span className="block text-[9px] text-zinc-400 mt-0.5">{v.tip}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Target Platform Budget (when Game-Ready is active) */}
          {variant === 'game_ready' && (
            <div className="space-y-1.5 p-3 rounded-xl bg-black/20 border border-white/[0.06]">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Optimization Target</span>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {[
                  { id: 'mobile', label: 'Mobile', desc: '~18k' },
                  { id: 'low', label: 'Low', desc: '~28k' },
                  { id: 'medium', label: 'Medium', desc: '~45k' },
                  { id: 'high', label: 'High', desc: '~85k' },
                  { id: 'cinematic', label: 'Cine', desc: '~180k' },
                ].map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setTargetPlatform(p.id as any)}
                    className={`py-1.5 px-1 rounded-lg text-center transition-all cursor-pointer ${
                      targetPlatform === p.id
                        ? 'bg-[hsl(var(--neon-green))] text-black font-bold'
                        : 'bg-[hsl(var(--surface-2))] text-zinc-300 hover:bg-white/[0.06] border border-white/[0.06]'
                    }`}
                  >
                    <span className="block text-[10px]">{p.label}</span>
                    <span className="block text-[8px] opacity-75">{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section 2: Format Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Target Format</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { id: 'glb', label: 'GLB', tip: 'Binary' },
                { id: 'gltf', label: 'GLTF', tip: 'JSON' },
                { id: 'fbx', label: 'FBX', tip: 'Autodesk' },
                { id: 'obj', label: 'OBJ', tip: 'Wavefront' },
                { id: 'stl', label: 'STL', tip: '3D Print' },
                { id: 'ply', label: 'PLY', tip: 'Polygon' },
              ].map(fmt => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setExportFormat(fmt.id as any)}
                  className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                    exportFormat === fmt.id
                      ? 'border-primary bg-[hsl(var(--surface-3))] text-primary font-bold'
                      : 'border-white/[0.08] bg-[hsl(var(--surface-2))] text-zinc-300 hover:border-white/[0.16]'
                  }`}
                >
                  <span className="block text-xs">{fmt.label}</span>
                  <span className="block text-[8px] text-zinc-400 mt-0.5">{fmt.tip}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Packaging Options */}
          <div className="space-y-2 p-3.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))]">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-primary" />
              <div>
                <span className="text-zinc-200 font-bold block text-xs">Complete Asset ZIP</span>
                <span className="text-[10px] text-zinc-400">
                  Includes every artifact that was actually generated: master, game-ready formats, LODs,
                  collision, textures, previews, and metadata.
                </span>
              </div>
            </div>
            <label className="flex items-center justify-between text-zinc-300 cursor-pointer">
              <span>Package complete workspace</span>
              <input
                type="checkbox"
                checked={packageZip}
                onChange={e => setPackageZip(e.target.checked)}
                className="rounded accent-primary"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-white/[0.08] bg-[hsl(var(--surface-2))] px-4 sm:px-5 py-3.5 flex-shrink-0">
          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
            {packageZip ? 'ZIP Archive' : `${exportFormat.toUpperCase()} Single Asset`}
          </span>
          <div className="flex items-center justify-end gap-2.5">
<button
            onClick={() => setIsExportModalOpen(false)}
            className="flex-1 sm:flex-initial rounded-xl px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={isExporting}
            className={`flex-1 sm:flex-initial px-5 sm:px-6 py-2.5 text-xs font-black rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-[#080808] hover:brightness-105 shadow-[0_4px_16px_rgba(255,204,0,0.38)] hover:shadow-[0_6px_22px_rgba(255,204,0,0.5)] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 btn-lighting-shine ${isExporting ? 'is-executing' : ''}`}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Packaging…</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4 stroke-[2.5]" />
                <span>Export {packageZip ? 'ZIP' : exportFormat.toUpperCase()}</span>
              </>
            )}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
