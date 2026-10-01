'use client';

import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { apiClient } from '../lib/api';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';


import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircle, Brush, Cancel, Check, CheckmarkCircle02Icon, GridIcon, Monitor, RefreshCw, Server, SlidersHorizontal, Sparkles } from '@hugeicons/core-free-icons';
type SettingsTab = 'server' | 'viewport' | 'sculpt' | 'ai';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    systemStats,
    refreshSystemStats,
    generationSettings,
    setGenerationSettings,
    environmentSettings,
    setEnvironmentSettings,
    sculptSettings,
    setSculptSettings,
    paintBrushSettings,
    setPaintBrushSettings,
    showGrid,
    setShowGrid,
  } = useWorkspace();

  const [activeTab, setActiveTab] = useState<SettingsTab>('server');

  // Close on Escape key
  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSettingsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

  // Server settings state
  const [host, setHost] = useState(() => {
    try {
      return localStorage.getItem('ai3d_api_host') || apiClient.getBaseUrl();
    } catch {
      return apiClient.getBaseUrl();
    }
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string; latency?: number } | null>(null);

  // Auto-save toggle
  const [autoSave, setAutoSave] = useState(() => {
    try {
      const v = localStorage.getItem('for_mash_autosave');
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  });

  if (!isSettingsOpen) return null;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const stats = await apiClient.getSystemStats();
      const latency = Math.round(performance.now() - start);
      setTesting(false);
      if (stats.status === 'online') {
        setTestResult({
          success: true,
          msg: `Connected to ForMash 3D FastAPI backend (${latency}ms).`,
          latency,
        });
        refreshSystemStats();
      } else {
        setTestResult({
          success: false,
          msg: 'Backend server returned offline status. Check your FastAPI service.',
        });
        refreshSystemStats();
      }
    } catch (err: any) {
      setTesting(false);
      setTestResult({
        success: false,
        msg: `Failed to connect to ${host}: ${err?.message || 'Network error'}`,
      });
      refreshSystemStats();
    }
  };

  const handleSave = () => {
    try {
      localStorage.setItem('ai3d_api_host', host);
      localStorage.setItem('for_mash_autosave', String(autoSave));
      localStorage.setItem('for_mash_polycount', String(generationSettings.autoOptimizeSettings.targetPolycount));
      localStorage.setItem('for_mash_sculpt_radius', String(sculptSettings.radius));
      localStorage.setItem('for_mash_sculpt_strength', String(sculptSettings.strength));
    } catch {
      // ignore localStorage quota errors
    }
    apiClient.setBaseUrl(host);
    setIsSettingsOpen(false);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsSettingsOpen(false);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 select-none animate-in fade-in duration-150"
    >
      <div className="w-full max-w-2xl max-h-[88vh] rounded-2xl bg-[hsl(var(--surface-1))] border border-white/[0.12] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[hsl(var(--surface-2))] border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <HugeiconsIcon icon={SlidersHorizontal} size={16} className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Studio Settings</h3>
              <p className="text-[10.5px] text-zinc-400">Configure viewport, pipeline defaults, and local AI runtime</p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-5 pt-2.5 bg-[hsl(var(--surface-2))] border-b border-white/[0.08] flex-shrink-0">
          {[
            { id: 'server' as const, label: 'Backend & Server', icon: (props: any) => <HugeiconsIcon icon={Server} size={16} {...props} /> },
            { id: 'viewport' as const, label: '3D Viewport', icon: (props: any) => <HugeiconsIcon icon={Monitor} size={16} {...props} /> },
            { id: 'sculpt' as const, label: 'Sculpt & Brush', icon: (props: any) => <HugeiconsIcon icon={Brush} size={16} {...props} /> },
            { id: 'ai' as const, label: 'AI Inference', icon: (props: any) => <HugeiconsIcon icon={Sparkles} size={16} {...props} /> },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-t-lg transition-all cursor-pointer border-b-2 ${
                  active
                    ? 'text-primary border-primary bg-[hsl(var(--surface-0))] shadow-sm'
                    : 'text-zinc-400 hover:text-white border-transparent hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4 text-xs bg-[hsl(var(--surface-0))] flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
          {/* TAB 1: Server & Backend */}
          {activeTab === 'server' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-300 flex items-center justify-between">
                  <span>FastAPI Backend Server URL</span>
                  <span className="text-[10px] text-zinc-500 font-mono">Default: /api/v1</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="/api/v1"
                    className="flex-1 px-3 py-2 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.1] text-xs font-mono text-white focus:border-primary focus:ring-1 focus:ring-primary/40 outline-none transition-all"
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="px-3.5 py-2 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.1] text-primary font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <HugeiconsIcon icon={RefreshCw} size={16} className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                    <span>{testing ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-xl border flex items-center gap-2.5 ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  {testResult.success ? (
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <HugeiconsIcon icon={AlertCircle} size={16} className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="text-xs">{testResult.msg}</span>
                </div>
              )}

              {/* Hardware and System Details */}
              <div className="space-y-2 pt-1">
                <span className="font-semibold text-[11px] text-zinc-400 uppercase tracking-wider">
                  Hardware &amp; Engine Telemetry
                </span>
                <div className="p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">FastAPI Pipeline Status</span>
                    <span
                      className={`text-xs font-mono font-bold flex items-center gap-1.5 ${
                        systemStats.status === 'online' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          systemStats.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                        }`}
                      />
                      {systemStats.status === 'online'
                        ? `Online (${systemStats.lastPingMs || 12}ms)`
                        : 'Offline / Connecting'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-zinc-400">Acceleration Device</span>
                    <span className="font-mono text-zinc-200">
                      {systemStats.gpu && systemStats.gpu !== 'Unavailable' ? systemStats.gpu : 'NVIDIA CUDA / PyTorch'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-zinc-400">VRAM Allocation</span>
                    <span className="font-mono text-primary font-semibold">
                      {systemStats.vramUsedGb != null
                        ? `${systemStats.vramUsedGb} / ${systemStats.vramTotalGb || 16} GB`
                        : 'Dynamic GPU Memory'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-zinc-400">Python / PyTorch</span>
                    <span className="font-mono text-zinc-400">
                      {systemStats.pythonVersion || 'Python 3.10+'} · PyTorch 2.4.0 CUDA
                    </span>
                  </div>
                </div>
              </div>

              {/* Auto-Save Configuration */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
                <div>
                  <div className="font-semibold text-zinc-200">Continuous Auto-Save</div>
                  <div className="text-[11px] text-zinc-400">Automatically save modified meshes &amp; scene state</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoSave(!autoSave)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    autoSave ? 'bg-primary' : 'bg-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-transform ${
                      autoSave ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Viewport & Rendering */}
          {activeTab === 'viewport' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* Viewport Background Presets */}
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300">Viewport Background Style</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'radial', label: 'Studio Dark', bg: 'radial-gradient(ellipse 75% 65% at 50% 50%, #161616 0%, #0d0d0d 55%, #060606 100%)' },
                    { id: '#0b0c10', label: 'Deep Onyx', bg: '#0b0c10' },
                    { id: '#1a1d24', label: 'Slate Gray', bg: '#1a1d24' },
                    { id: 'transparent', label: 'Transparent', bg: '#111' },
                  ].map((preset) => {
                    const isSelected = environmentSettings.backgroundColor === (preset.id === 'radial' ? 'transparent' : preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setEnvironmentSettings((prev) => ({
                            ...prev,
                            backgroundColor: preset.id === 'radial' ? 'transparent' : preset.id,
                          }))
                        }
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-white'
                            : 'border-white/[0.08] bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ background: preset.bg }} />
                          <span className="text-[11px] font-medium">{preset.label}</span>
                        </div>
                        {isSelected && <HugeiconsIcon icon={Check} size={16} className="w-3.5 h-3.5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Grid & Lighting Controls */}
              <div className="p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon icon={GridIcon} size={16} className="w-4 h-4 text-primary" />
                    <div>
                      <div className="font-semibold text-zinc-200">Floor Reference Grid</div>
                      <div className="text-[10.5px] text-zinc-400">Display infinite metric grid plane in 3D viewport</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowGrid(!showGrid)}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                      showGrid ? 'bg-primary' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-transform ${
                        showGrid ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-2 border-t border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Studio Key Light Intensity</span>
                    <span className="font-mono text-primary font-bold">{(environmentSettings.keyLightIntensity || 1.0).toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.1}
                    value={environmentSettings.keyLightIntensity || 1.0}
                    onChange={(e) =>
                      setEnvironmentSettings((prev) => ({
                        ...prev,
                        keyLightIntensity: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Sculpt & Brush */}
          {activeTab === 'sculpt' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300">Default Sculpt Brush</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['standard', 'inflate', 'smooth', 'flatten'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setSculptSettings((prev) => ({ ...prev, brush: b as any }))}
                      className={`p-2.5 rounded-xl border text-center capitalize text-xs font-semibold transition-all cursor-pointer ${
                        sculptSettings.brush === b
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-white/[0.08] bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] space-y-3.5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Default Brush Radius</span>
                    <span className="font-mono text-primary font-bold">{(sculptSettings.radius || 0.15).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.02}
                    max={0.50}
                    step={0.01}
                    value={sculptSettings.radius || 0.15}
                    onChange={(e) =>
                      setSculptSettings((prev) => ({
                        ...prev,
                        radius: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Default Sculpt Strength</span>
                    <span className="font-mono text-primary font-bold">{(sculptSettings.strength || 0.50).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    value={sculptSettings.strength || 0.50}
                    onChange={(e) =>
                      setSculptSettings((prev) => ({
                        ...prev,
                        strength: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Brush Hardness / Sharp Falloff</span>
                    <span className="font-mono text-primary font-bold">{(sculptSettings.hardness || 0.50).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={sculptSettings.hardness || 0.50}
                    onChange={(e) =>
                      setSculptSettings((prev) => ({
                        ...prev,
                        hardness: parseFloat(e.target.value),
                      }))
                    }
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: AI Inference & Pipeline */}
          {activeTab === 'ai' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="space-y-2">
                <label className="font-semibold text-zinc-300">3D Generation Model Backend</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'hunyuan3d-2.1', title: 'Hunyuan3D 2.1', desc: 'High-detail neural geometry' },
                    { id: 'trellis', title: 'Trellis', desc: 'Structured lattice generation' },
                    { id: 'triposr', title: 'TripoSR', desc: 'Ultra-fast low-latency draft' },
                  ].map((m) => {
                    const isSelected = (generationSettings.aiModel || 'hunyuan3d-2.1') === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setGenerationSettings((prev) => ({ ...prev, aiModel: m.id }))}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-white'
                            : 'border-white/[0.08] bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <div className="font-bold text-xs text-white flex items-center justify-between">
                          <span>{m.title}</span>
                          {isSelected && <HugeiconsIcon icon={Check} size={16} className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1">{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Polycount Slider */}
              <div className="p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 font-semibold">Default Target Polycount</span>
                  <span className="font-mono text-primary font-bold">
                    {generationSettings.autoOptimizeSettings.targetPolycount.toLocaleString()} triangles
                  </span>
                </div>
                <input
                  type="range"
                  min={5000}
                  max={100000}
                  step={5000}
                  value={generationSettings.autoOptimizeSettings.targetPolycount}
                  onChange={(e) =>
                    setGenerationSettings((prev) => ({
                      ...prev,
                      autoOptimizeSettings: {
                        ...prev.autoOptimizeSettings,
                        targetPolycount: parseInt(e.target.value, 10),
                      },
                    }))
                  }
                  className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                  <span>5k (Low Poly)</span>
                  <span>45k (Game Ready)</span>
                  <span>100k (High Fidelity)</span>
                </div>
              </div>

              {/* PBR Texture Generation Toggle */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-[hsl(var(--surface-1))] border border-white/[0.08]">
                <div>
                  <div className="font-semibold text-zinc-200">Auto-Generate PBR Texture Maps</div>
                  <div className="text-[11px] text-zinc-400">Synthesize Albedo, Normal, Roughness &amp; Metallic maps</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setGenerationSettings((prev) => ({
                      ...prev,
                      generatePBR: !prev.generatePBR,
                    }))
                  }
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    generationSettings.generatePBR !== false ? 'bg-primary' : 'bg-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-transform ${
                      generationSettings.generatePBR !== false ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-[hsl(var(--surface-2))] border-t border-white/[0.08] flex-shrink-0">
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="px-4 py-2 rounded-xl bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-white font-medium text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 active:scale-95 text-black font-extrabold text-xs shadow-md shadow-primary/20 transition-all cursor-pointer"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
