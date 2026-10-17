import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { motion, AnimatePresence } from 'motion/react';


import { HugeiconsIcon } from '@hugeicons/react';
import { Archive, BookmarkIcon, Cancel, CheckIcon, DownloadIcon, FileBoxIcon, LoaderCircle, Plus, ShieldCheckIcon, Trash2, TriangleAlertIcon } from '@hugeicons/core-free-icons';
import { downloadArtifact } from '../lib/artifactDownload';
import { settingsPersistence, type ExportQuickProfile } from '@/services/settingsPersistence';

export const ExportModal: React.FC = () => {
  const { isExportModalOpen, setIsExportModalOpen, currentAsset } = useWorkspace();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick Profiles
  const [profiles, setProfiles] = useState<ExportQuickProfile[]>(() => settingsPersistence.getExportProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>('default-glb');
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // Variant & Format states
  const [variant, setVariant] = useState<'source' | 'game_ready' | 'lod_package'>('game_ready');
  const [exportFormat, setExportFormat] = useState<'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply'>('glb');

  // Packaging toggles & Engine Options
  const [packageZip, setPackageZip] = useState(false);
  const [lodSelection, setLodSelection] = useState<string>('lod0');
  const [includeCollision, setIncludeCollision] = useState<boolean>(false);
  const [textureResolution, setTextureResolution] = useState<string>('2048');

  // Load profiles on mount
  useEffect(() => {
    setProfiles(settingsPersistence.getExportProfiles());
  }, [isExportModalOpen]);

  const handleApplyProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    setVariant(profile.variant);
    setExportFormat(profile.exportFormat);
    setPackageZip(profile.packageZip);
    if (profile.lodSelection) setLodSelection(profile.lodSelection);
    if (profile.includeCollision !== undefined) setIncludeCollision(profile.includeCollision);
    if (profile.textureResolution) setTextureResolution(profile.textureResolution);
  };

  const handleSaveCurrentAsProfile = () => {
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    const saved = settingsPersistence.saveExportProfile({
      name: trimmed,
      variant,
      exportFormat,
      packageZip,
      lodSelection,
      includeCollision,
      textureResolution,
    });
    const refreshed = settingsPersistence.getExportProfiles();
    setProfiles(refreshed);
    setSelectedProfileId(saved.id);
    setNewProfileName('');
    setIsCreatingProfile(false);
  };

  const handleDeleteProfile = (profileId: string) => {
    settingsPersistence.deleteExportProfile(profileId);
    const refreshed = settingsPersistence.getExportProfiles();
    setProfiles(refreshed);
    if (refreshed.length > 0) {
      handleApplyProfile(refreshed[0].id);
    }
  };

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

  const assetName = currentAsset?.name || 'character';
  const assetBaseName = assetName.replace(/\.[^.]+$/, '');
  const qaScore = currentAsset?.qaScore ?? (currentAsset?.artifacts?.qaReport as any)?.game_ready_score;
  const qaStatus = currentAsset?.qaStatus ?? (currentAsset?.artifacts?.qaReport as any)?.status;
  const qaWarnings = currentAsset?.qaWarnings ?? (currentAsset?.artifacts?.qaReport as any)?.warnings ?? [];

  const handleExport = async () => {
    const artifacts = currentAsset?.artifacts;
    const zipUrl = artifacts?.zipUrl;
    const sourceArtifact = artifacts?.source || currentAsset?.source?.viewUrl || currentAsset?.source?.localUrl;
    const selectedUrl =
      packageZip || variant === 'lod_package'
        ? zipUrl
        : variant === 'source'
        ? sourceArtifact
        : exportFormat === 'glb'
        ? artifacts?.gameReadyFormats?.glb || artifacts?.gameReady || null
        : artifacts?.gameReadyFormats?.[exportFormat] || null;

    if (!selectedUrl) {
      setError(
        variant === 'source'
          ? 'The source master is not available yet.'
          : `The ${exportFormat.toUpperCase()} artifact is not available yet.`,
      );
      return;
    }

    const sourceFormat = (
      currentAsset?.format?.toLowerCase() ||
      currentAsset?.source?.filename?.split('.').pop()?.toLowerCase() ||
      currentAsset?.name?.split('.').pop()?.toLowerCase() ||
      'glb'
    ) as 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl' | 'ply';

    const downloadExtension =
      packageZip || variant === 'lod_package'
        ? 'zip'
        : variant === 'source'
        ? (['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'].includes(sourceFormat) ? sourceFormat : 'glb')
        : exportFormat;

    setIsExporting(true);
    setError(null);

    try {
      await downloadArtifact(
        selectedUrl,
        `${assetBaseName}.${downloadExtension}`,
        downloadExtension,
      );
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
              <HugeiconsIcon icon={FileBoxIcon} size={16} className="h-5 w-5 stroke-[2.2]" />
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
            <HugeiconsIcon icon={Cancel} size={16} className="h-4 w-4" />
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
                <HugeiconsIcon icon={ShieldCheckIcon} size={16} className="w-4 h-4 text-[hsl(var(--neon-green))]" />
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

          {/* Quick-Profile Selector */}
          <div className="space-y-2 p-3 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={BookmarkIcon} size={16} className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-white">Export Quick-Profile</span>
              </div>
              <div className="flex items-center gap-1.5">
                {!isCreatingProfile ? (
                  <button
                    type="button"
                    onClick={() => setIsCreatingProfile(true)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <HugeiconsIcon icon={Plus} size={14} className="w-3 h-3 text-primary" />
                    <span>Save Current</span>
                  </button>
                ) : null}
                {profiles.find(p => p.id === selectedProfileId && !p.isBuiltIn) && (
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(selectedProfileId)}
                    className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Delete profile"
                  >
                    <HugeiconsIcon icon={Trash2} size={14} className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {isCreatingProfile ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  placeholder="Profile Name (e.g. Unity Mobile)"
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveCurrentAsProfile(); if (e.key === 'Escape') setIsCreatingProfile(false); }}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.15] text-xs text-white outline-none focus:border-primary"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveCurrentAsProfile}
                  className="px-2.5 py-1.5 rounded-lg bg-primary text-black font-bold text-xs hover:brightness-105 cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingProfile(false)}
                  className="p-1.5 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <HugeiconsIcon icon={Cancel} size={14} className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={selectedProfileId}
                  onChange={e => handleApplyProfile(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs text-zinc-200 outline-none focus:border-primary cursor-pointer"
                >
                  {profiles.map(p => (
                    <option key={p.id} value={p.id} className="bg-[hsl(var(--surface-1))] text-white">
                      {p.name} {p.isBuiltIn ? '(Preset)' : '(Custom)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

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

          {/* Section 3: Engine Options (LOD, Collision, Texture Res) */}
          <div className="space-y-2.5 p-3.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))]">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Engine &amp; Asset Optimization
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">LOD Selection</label>
                <select
                  value={lodSelection}
                  onChange={e => setLodSelection(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs text-zinc-200 outline-none focus:border-primary cursor-pointer"
                >
                  <option value="lod0" className="bg-[hsl(var(--surface-1))]">LOD 0 (Full Quality)</option>
                  <option value="lod1" className="bg-[hsl(var(--surface-1))]">LOD 1 (Medium - 50%)</option>
                  <option value="lod2" className="bg-[hsl(var(--surface-1))]">LOD 2 (Low - 25%)</option>
                  <option value="lod3" className="bg-[hsl(var(--surface-1))]">LOD 3 (Billboard/Proxy - 10%)</option>
                  <option value="all" className="bg-[hsl(var(--surface-1))]">All LOD Levels (0-3)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Texture Resolution</label>
                <select
                  value={textureResolution}
                  onChange={e => setTextureResolution(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs text-zinc-200 outline-none focus:border-primary cursor-pointer"
                >
                  <option value="original" className="bg-[hsl(var(--surface-1))]">Original Size</option>
                  <option value="1024" className="bg-[hsl(var(--surface-1))]">1024 x 1024 (Mobile)</option>
                  <option value="2048" className="bg-[hsl(var(--surface-1))]">2048 x 2048 (Standard)</option>
                  <option value="4096" className="bg-[hsl(var(--surface-1))]">4096 x 4096 (High-Res 4K)</option>
                </select>
              </div>
            </div>

            <label className="flex items-center justify-between text-zinc-300 cursor-pointer pt-1 border-t border-white/[0.06]">
              <span className="text-xs">Include Simplified Collision Mesh</span>
              <input
                type="checkbox"
                checked={includeCollision}
                onChange={e => setIncludeCollision(e.target.checked)}
                className="rounded accent-primary cursor-pointer"
              />
            </label>
          </div>

          {/* Section 4: Packaging Options */}
          <div className="space-y-2 p-3.5 rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-2))]">
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={Archive} size={16} className="w-4 h-4 text-primary" />
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
              <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4 flex-shrink-0" />
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
            className={`flex-1 sm:flex-initial px-5 sm:px-6 py-2.5 text-xs font-black rounded-xl bg-primary text-black hover:brightness-105 shadow-md transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 btn-lighting-shine ${isExporting ? 'is-executing' : ''}`}
          >
            {isExporting ? (
              <>
                <HugeiconsIcon icon={LoaderCircle} size={16} className="h-4 w-4 animate-spin" />
                <span>Packaging…</span>
              </>
            ) : (
              <>
                <HugeiconsIcon icon={DownloadIcon} size={16} className="h-4 w-4 stroke-[2.5]" />
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
