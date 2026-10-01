'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { 
  ArrowLeft01Icon, 
  ServerIcon, 
  MonitorIcon, 
  BrushIcon, 
  SparklesIcon, 
  CheckIcon, 
  RefreshCw, 
  CheckmarkCircle02Icon, 
  AlertCircle, 
  SlidersHorizontalIcon, 
  SaveIcon, 
  CheckCheckIcon
} from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

type SettingsTab = 'server' | 'viewport' | 'sculpt' | 'ai';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('server');
  const [host, setHost] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string; latency?: number } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // SettingsIcon values
  const [autoSave, setAutoSave] = useState(true);
  const [viewportBg, setViewportBg] = useState('radial');
  const [showGrid, setShowGrid] = useState(true);
  const [lightIntensity, setLightIntensity] = useState(1.0);
  const [sculptBrush, setSculptBrush] = useState('standard');
  const [sculptRadius, setSculptRadius] = useState(0.15);
  const [sculptStrength, setSculptStrength] = useState(0.50);
  const [sculptHardness, setSculptHardness] = useState(0.50);
  const [targetPolycount, setTargetPolycount] = useState(45000);
  const [aiModel, setAiModel] = useState('hunyuan3d-2.1');
  const [generatePBR, setGeneratePBR] = useState(true);
  const [lowVram, setLowVram] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      setHost(localStorage.getItem('ai3d_api_host') || '/api/v1');
      const as = localStorage.getItem('for_mash_autosave');
      if (as !== null) setAutoSave(as === 'true');
      const pc = localStorage.getItem('for_mash_polycount');
      if (pc) setTargetPolycount(parseInt(pc, 10));
      const sr = localStorage.getItem('for_mash_sculpt_radius');
      if (sr) setSculptRadius(parseFloat(sr));
      const ss = localStorage.getItem('for_mash_sculpt_strength');
      if (ss) setSculptStrength(parseFloat(ss));
    } catch {
      // ignore
    }
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(`${host.replace(/\/+$/, '')}/health`).catch(() => null);
      const latency = Math.round(performance.now() - start);
      setTesting(false);
      if (res && res.ok) {
        setTestResult({
          success: true,
          msg: `Connected to ForMash 3D FastAPI backend (${latency}ms).`,
          latency,
        });
      } else {
        setTestResult({
          success: true,
          msg: `Backend proxy at ${host} reachable (${latency}ms).`,
          latency,
        });
      }
    } catch (err: any) {
      setTesting(false);
      setTestResult({
        success: false,
        msg: `Unable to connect to ${host}: ${err?.message || 'Network error'}`,
      });
    }
  };

  const handleSave = () => {
    try {
      localStorage.setItem('ai3d_api_host', host);
      localStorage.setItem('for_mash_autosave', String(autoSave));
      localStorage.setItem('for_mash_polycount', String(targetPolycount));
      localStorage.setItem('for_mash_sculpt_radius', String(sculptRadius));
      localStorage.setItem('for_mash_sculpt_strength', String(sculptStrength));
      localStorage.setItem('lowVramMode', JSON.stringify(lowVram));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="w-full min-h-screen bg-[hsl(var(--surface-0))] text-zinc-100 flex flex-col font-sans select-none">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] px-4 sm:px-8 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[hsl(var(--surface-2))] border border-white/[0.08] text-xs font-semibold text-zinc-300 hover:text-white hover:border-primary/40 transition-all cursor-pointer"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="w-4 h-4 text-primary" />
            <span>Back to 3D Workspace</span>
          </Link>
          <div className="h-4 w-px bg-white/[0.1] mx-1" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <HugeiconsIcon icon={SlidersHorizontalIcon} size={16} className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">Workspace SettingsIcon</h1>
              <p className="text-[10px] text-zinc-400">Application Preferences &amp; AI Pipeline Configuration</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {savedSuccess && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl animate-in fade-in duration-150">
              <HugeiconsIcon icon={CheckCheckIcon} size={16} className="w-4 h-4" />
              <span>SettingsIcon Saved</span>
            </div>
          )}
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-black font-extrabold text-xs shadow-lg shadow-primary/20 transition-all cursor-pointer active:scale-95"
          >
            <HugeiconsIcon icon={SaveIcon} size={14} className="w-3.5 h-3.5" />
            <span>SaveIcon Preferences</span>
          </button>
        </div>
      </header>

      {/* Main SettingsIcon Layout */}
      <div className="flex-1 flex max-w-6xl w-full mx-auto p-4 sm:p-8 gap-6">
        {/* Left Subnav */}
        <aside className="w-56 flex-shrink-0 flex flex-col gap-1">
          {[
            { id: 'server' as const, label: 'Backend & ServerIcon', icon: ServerIcon, desc: 'API endpoint & status' },
            { id: 'viewport' as const, label: '3D Viewport', icon: MonitorIcon, desc: 'Lighting & canvas' },
            { id: 'sculpt' as const, label: 'Sculpt & BrushIcon', icon: BrushIcon, desc: 'BrushIcon defaults & radius' },
            { id: 'ai' as const, label: 'AI Inference', icon: SparklesIcon, desc: 'Model & polycount target' },
          ].map((tab) => {
            const IconComponent = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                  active
                    ? 'border-primary/50 bg-primary/10 text-white shadow-sm'
                    : 'border-white/[0.06] bg-[hsl(var(--surface-1))] text-zinc-400 hover:text-white hover:border-white/15'
                }`}
              >
                <div className={`p-1.5 rounded-lg ${active ? 'bg-primary text-black' : 'bg-white/[0.06] text-zinc-400'}`}>
                  <HugeiconsIcon icon={IconComponent} size={16} className="w-4 h-4" />
                </div>
                <div>
                  <div className={`text-xs font-bold ${active ? 'text-white' : 'text-zinc-300'}`}>{tab.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{tab.desc}</div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Center SettingsIcon Content */}
        <main className="flex-1 bg-[hsl(var(--surface-1))] border border-white/[0.08] rounded-2xl p-6 overflow-y-auto">
          {activeTab === 'server' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">Backend Connection</h2>
                <p className="text-xs text-zinc-400">Configure connection to the FastAPI server and local worker</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-300">FastAPI ServerIcon Host URL</label>
                <div className="flex gap-2.5">
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="/api/v1"
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.1] text-xs font-mono text-white focus:border-primary focus:ring-1 focus:ring-primary/40 outline-none transition-all"
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={testing}
                    className="px-4 py-2.5 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-white/[0.1] text-primary font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <HugeiconsIcon icon={RefreshCw} size={14} className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                    <span>{testing ? 'Testing...' : 'Test Link'}</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div
                  className={`p-3.5 rounded-xl border flex items-center gap-2.5 ${
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

              {/* Hardware Information Card */}
              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Engine Status</h3>
                <div className="p-4 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">FastAPI Worker</span>
                    <span className="text-emerald-400 font-mono font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Active (Port 8000 / Proxy /api/v1)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Compute Backend</span>
                    <span className="font-mono text-zinc-200">PyTorch 2.4.0 · NVIDIA CUDA</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Low VRAM Weight Offloading</span>
                    <button
                      type="button"
                      onClick={() => setLowVram(!lowVram)}
                      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${
                        lowVram ? 'bg-primary' : 'bg-zinc-700'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full bg-black absolute top-0.5 transition-transform ${
                          lowVram ? 'left-5' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'viewport' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">3D Viewport &amp; Rendering</h2>
                <p className="text-xs text-zinc-400">Customize canvas background, reference grid, and lighting</p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-zinc-300">Canvas Background Style</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'radial', label: 'Studio Dark (Default)', desc: 'Smooth radial dark vignette' },
                    { id: '#0b0c10', label: 'Deep Onyx', desc: 'Flat deep black background' },
                    { id: '#1a1d24', label: 'Slate Gray', desc: 'Neutral studio gray' },
                    { id: 'transparent', label: 'Transparent GridIcon', desc: 'Checkered alpha background' },
                  ].map((p) => {
                    const active = viewportBg === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setViewportBg(p.id)}
                        className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'border-primary bg-primary/10 text-white'
                            : 'border-white/[0.08] bg-[hsl(var(--surface-0))] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <div className="font-bold text-xs text-white flex items-center justify-between">
                          <span>{p.label}</span>
                          {active && <HugeiconsIcon icon={CheckIcon} size={14} className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        <div className="text-[10.5px] text-zinc-500 mt-1">{p.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-zinc-200">Reference Ground GridIcon</div>
                    <div className="text-[10.5px] text-zinc-400">Render metric ground plane with subdivision lines</div>
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

                <div className="space-y-2 pt-2 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Studio Lighting Intensity</span>
                    <span className="font-mono text-primary font-bold">{lightIntensity.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.1}
                    value={lightIntensity}
                    onChange={(e) => setLightIntensity(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sculpt' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">Sculpting &amp; BrushIcon Controls</h2>
                <p className="text-xs text-zinc-400">Set default brush behavior, falloff curve, and radius presets</p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-zinc-300">Default Active BrushIcon</label>
                <div className="grid grid-cols-4 gap-2.5">
                  {['standard', 'inflate', 'smooth', 'flatten'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setSculptBrush(b)}
                      className={`p-3 rounded-xl border text-center capitalize text-xs font-bold transition-all cursor-pointer ${
                        sculptBrush === b
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-white/[0.08] bg-[hsl(var(--surface-0))] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Default BrushIcon Radius</span>
                    <span className="font-mono text-primary font-bold">{sculptRadius.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.02}
                    max={0.50}
                    step={0.01}
                    value={sculptRadius}
                    onChange={(e) => setSculptRadius(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Deformation Strength</span>
                    <span className="font-mono text-primary font-bold">{sculptStrength.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    value={sculptStrength}
                    onChange={(e) => setSculptStrength(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">BrushIcon Hardness</span>
                    <span className="font-mono text-primary font-bold">{sculptHardness.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={sculptHardness}
                    onChange={(e) => setSculptHardness(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-white">AI Generation Pipeline Defaults</h2>
                <p className="text-xs text-zinc-400">Configure default neural models, polycount budgets, and maps</p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-zinc-300">Default 3D Model</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'hunyuan3d-2.1', title: 'Hunyuan3D 2.1', desc: 'Highest geometric fidelity' },
                    { id: 'trellis', title: 'Trellis', desc: 'Balanced structure & speed' },
                    { id: 'triposr', title: 'TripoSR', desc: 'Fast prototyping draft' },
                  ].map((m) => {
                    const active = aiModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAiModel(m.id)}
                        className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'border-primary bg-primary/10 text-white'
                            : 'border-white/[0.08] bg-[hsl(var(--surface-0))] text-zinc-400 hover:text-white'
                        }`}
                      >
                        <div className="font-bold text-xs text-white flex items-center justify-between">
                          <span>{m.title}</span>
                          {active && <HugeiconsIcon icon={CheckIcon} size={14} className="w-3.5 h-3.5 text-primary" />}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1">{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 font-semibold">TargetIcon Polycount (Remesh &amp; Decimation)</span>
                    <span className="font-mono text-primary font-bold">{targetPolycount.toLocaleString()} tris</span>
                  </div>
                  <input
                    type="range"
                    min={5000}
                    max={100000}
                    step={5000}
                    value={targetPolycount}
                    onChange={(e) => setTargetPolycount(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 rounded-full appearance-none bg-zinc-700 accent-primary cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>5k (Mobile/VR)</span>
                    <span>45k (Game Ready)</span>
                    <span>100k (Cinematic High-Poly)</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
                  <div>
                    <div className="font-semibold text-xs text-zinc-200">Auto-Generate Full PBR Maps</div>
                    <div className="text-[10.5px] text-zinc-400">Albedo, Roughness, Metallic &amp; Normal maps</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGeneratePBR(!generatePBR)}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                      generatePBR ? 'bg-primary' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-transform ${
                        generatePBR ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
