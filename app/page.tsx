'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchHomeTelemetry, UNKNOWN_HOME_TELEMETRY, type HomeTelemetry } from './homeTelemetry';
import {
  Sparkles,
  Box,
  Layers,
  Cpu,
  Zap,
  Play,
  ArrowRight,
  HardDrive,
  Check,
  Activity,
  Scissors,
  Palette,
  Maximize2,
  UserCheck,
  BarChart3,
  Database,
  ShieldCheck,
  Terminal,
  Settings,
  FolderGit2,
  ChevronRight,
  UploadCloud,
  Workflow,
  Monitor,
  Flame,
  Clock,
  Download,
  Share2,
} from 'lucide-react';

const PRESET_WORKFLOWS = [
  {
    id: 'game_ready',
    label: 'Game Ready',
    targetBudget: '50,000 Tris',
    textures: '1K PBR Atlas',
    lods: 'LOD0 – LOD4 Chain',
    features: ['Convex Collision Hull', 'Draw-Call Optimized', 'Unity / Unreal Ready'],
    route: '/workspace/generate?intent=game_ready',
    color: 'from-amber-500/20 to-yellow-500/5',
    borderColor: 'border-amber-500/30',
    tag: 'Recommended for Games',
  },
  {
    id: 'cinematic',
    label: 'Cinematic & VFX',
    targetBudget: '200,000 Tris',
    textures: '2K – 4K PBR Atlas',
    lods: 'Production High',
    features: ['Polygonal Quad OBJ', 'Micro-Detail Normal Bake', 'Blender / Maya Compatible'],
    route: '/workspace/generate?intent=cinematic',
    color: 'from-purple-500/20 to-pink-500/5',
    borderColor: 'border-purple-500/30',
    tag: 'Ultra-High Fidelity',
  },
  {
    id: '3d_print',
    label: '3D Print (Watertight)',
    targetBudget: 'Native Geometry',
    textures: 'Untextured Solid',
    lods: 'Zero Decimation',
    features: ['100% Manifold Guarantee', 'Automated Hole Closure', 'Bambu / Prusa Slicer Ready'],
    route: '/workspace/generate?intent=3d_print',
    color: 'from-emerald-500/20 to-green-500/5',
    borderColor: 'border-emerald-500/30',
    tag: 'Physical Prototyping',
  },
  {
    id: 'animation',
    label: 'Animation & Rigging',
    targetBudget: '30,000 Tris',
    textures: '1K PBR Atlas',
    lods: 'Deformation Clean',
    features: ['54-Bone Humanoid Skeleton', 'Automatic Skinning Weights', 'Motion Retargeting Ready'],
    route: '/workspace/rigging',
    color: 'from-cyan-500/20 to-blue-500/5',
    borderColor: 'border-cyan-500/30',
    tag: 'Characters & Motion',
  },
  {
    id: 'mobile',
    label: 'Mobile & WebXR',
    targetBudget: '20,000 Tris',
    textures: '512px Lightweight Atlas',
    lods: 'Aggressive Falloff',
    features: ['Minimal Memory Footprint', 'Zero Draw-Call Spikes', 'Instant WebGL Loading'],
    route: '/workspace/generate?intent=mobile',
    color: 'from-orange-500/20 to-red-500/5',
    borderColor: 'border-orange-500/30',
    tag: 'Ultra-Lightweight',
  },
];

const CORE_PIPELINES = [
  {
    title: 'Neural 3D Generation',
    tag: 'Inference',
    description: 'Transform images or concept sketches into full 3D geometry in seconds using Trellis 2, Hunyuan3D v2.1, and Unique3D.',
    route: '/workspace/generate',
    icon: Sparkles,
    specs: 'Single Image · Text Prompt · Multi-Model Ensemble',
    highlight: 'Instant Mesh Synthesis',
  },
  {
    title: 'Smart Quad Retopology',
    tag: 'Topology',
    description: 'Rebuild dense triangle soup into clean quad-dominant edge loops with customizable face budgets and genuine Quad OBJ export.',
    route: '/workspace/remesh',
    icon: Scissors,
    specs: 'InstantMeshes · FastMesh · 50k Game Budget',
    highlight: 'Quad-Dominant Flow',
  },
  {
    title: 'PBR Texture Studio & Bake',
    tag: 'Materials',
    description: 'Synthesize multi-view diffuse, normal, roughness, metallic, and AO maps with automated high-to-low raycast baking up to 8K.',
    route: '/workspace/texture',
    icon: Palette,
    specs: '1K – 8K Atlases · PBR Maps · SSS Support',
    highlight: 'High-To-Low Raycasting',
  },
  {
    title: 'Auto-Rigging & Motion Library',
    tag: 'Animation',
    description: 'Detect skeletal landmarks, bind automatic skin weights, and preview character animations with the integrated motion library.',
    route: '/workspace/rigging',
    icon: UserCheck,
    specs: 'UniRig · 54 Bones · FBX Export',
    highlight: 'Zero-Shot Skinning',
  },
  {
    title: 'Automated UV Parameterization',
    tag: 'Unwrapping',
    description: 'Production-grade UV seam placement, angle-preserving flattening, and distortion-free island packing via XAtlas.',
    route: '/workspace/uv',
    icon: Maximize2,
    specs: 'XAtlas · Seam Welding · <1% Distortion',
    highlight: 'Zero Island Overlap',
  },
  {
    title: 'Semantic Segmentation & Editing',
    tag: 'Modification',
    description: 'Decompose meshes into hierarchical functional parts or perform localized bounding-box edits and deformations.',
    route: '/workspace/segment',
    icon: Layers,
    specs: 'Part Hierarchy · 3D Bounding Box · Sculpting',
    highlight: 'Non-Destructive Parts',
  },
];

const SHOWCASE_ITEMS = [
  {
    name: 'Cyberpunk Sentinel Drone',
    category: 'Game Ready',
    polycount: '48,200 Tris',
    topology: 'Quad-Dominant',
    texture: '2048x2048 PBR',
    formats: ['GLB', 'FBX', 'OBJ'],
    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    route: '/workspace/generate?intent=game_ready',
  },
  {
    name: 'Mythic Obsidian Dragon',
    category: 'Cinematic VFX',
    polycount: '184,000 Tris',
    topology: 'Fine Relief',
    texture: '4096x4096 8K Normals',
    formats: ['GLB', 'FBX', 'QUAD-OBJ'],
    image: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=800&q=80',
    route: '/workspace/generate?intent=cinematic',
  },
  {
    name: 'Tactical Exoskeleton Armor',
    category: 'Animation Rigged',
    polycount: '32,400 Tris',
    topology: 'UniRig 54-Bone',
    texture: '1024x1024 PBR',
    formats: ['GLB', 'FBX (Rigged)'],
    image: 'https://images.unsplash.com/photo-1614741118887-7a4ee193a5fa?auto=format&fit=crop&w=800&q=80',
    route: '/workspace/rigging',
  },
  {
    name: 'Precision Mechanical Turbine',
    category: '3D Print Watertight',
    polycount: '112,000 Faces',
    topology: '100% Manifold Solid',
    texture: 'Non-Textured STL',
    formats: ['STL', 'GLB', 'OBJ'],
    image: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80',
    route: '/workspace/generate?intent=3d_print',
  },
];

export default function HomePage() {
  const router = useRouter();

  // Interactive Quick Launch State
  const [promptInput, setPromptInput] = useState('');
  const [selectedIntent, setSelectedIntent] = useState('game_ready');
  const [selectedModel, setSelectedModel] = useState('trellis2_image_to_raw_mesh');
  const [activeTab, setActiveTab] = useState<'generate' | 'retopo' | 'texture' | 'rigging'>('generate');

  // Live Hardware Telemetry State
  const [telemetry, setTelemetry] = useState<HomeTelemetry>(UNKNOWN_HOME_TELEMETRY);
  const [telemetryLoading, setTelemetryLoading] = useState(true);

  // Fetch live system stats; unavailable API data stays explicitly unknown.
  // Polling pauses when the tab is hidden (DESIGN.md §10) and resumes on return.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchStats = async () => {
      const data = await fetchHomeTelemetry();
      if (!cancelled) {
        setTelemetry(data);
        setTelemetryLoading(false);
      }
    };

    const start = () => {
      stop();
      void fetchStats();
      interval = setInterval(fetchStats, 10000);
    };

    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    start();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'g':
          e.preventDefault();
          router.push('/workspace/generate');
          break;
        case 'r':
          e.preventDefault();
          router.push('/workspace/remesh');
          break;
        case 't':
          e.preventDefault();
          router.push('/workspace/texture');
          break;
        case 'u':
          e.preventDefault();
          router.push('/workspace/uv');
          break;
        case 'a':
          e.preventDefault();
          router.push('/workspace/rigging');
          break;
        case 'd':
          e.preventDefault();
          router.push('/dashboard');
          break;
        case 'o':
          e.preventDefault();
          router.push('/outputs');
          break;
        case 's':
          e.preventDefault();
          router.push('/system');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const handleQuickLaunch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const params = new URLSearchParams();
      if (promptInput.trim()) {
        params.set('prompt', promptInput.trim());
      }
      if (selectedIntent) {
        params.set('intent', selectedIntent);
      }
      if (selectedModel) {
        params.set('model', selectedModel);
      }
      router.push(`/workspace/generate?${params.toString()}`);
    },
    [promptInput, selectedIntent, selectedModel, router]
  );

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] selection:bg-primary selection:text-black">
      {/* ── STICKY GLASS HEADER ────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full bg-[hsl(var(--background))]/85 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 group cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-amber-600 flex items-center justify-center text-black font-black text-lg shadow-[0_0_20px_rgba(255,204,0,0.35)] transition-transform group-hover:scale-105">
                <Box className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="flex flex-col">
                <span className="font-black tracking-tight text-base text-white group-hover:text-primary transition-colors flex items-center gap-1.5">
                  ForMash<span className="text-primary">3D</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                    Pro Studio
                  </span>
                </span>
                <span className="text-[10px] text-zinc-500 font-mono tracking-wider uppercase">
                  Personal 3D Workstation
                </span>
              </div>
            </Link>
          </div>

          {/* Nav Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/workspace"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Workspace
            </Link>
            <Link
              href="/workspace/generate"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Generate
            </Link>
            <Link
              href="/workspace/remesh"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Retopo
            </Link>
            <Link
              href="/workspace/texture"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Textures
            </Link>
            <Link
              href="/workspace/rigging"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Rigging
            </Link>
            <Link
              href="/outputs"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Outputs
            </Link>
            <Link
              href="/dashboard"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Telemetry
            </Link>
            <Link
              href="/system"
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              System
            </Link>
          </nav>

          {/* Right Header: Telemetry Pill & Launch Button */}
          <div className="flex items-center gap-3">
            <Link
              href="/system"
              className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:border-primary/40 transition-all text-xs font-mono cursor-pointer"
              title="Click to view hardware diagnostics"
            >
              <span className={`w-2 h-2 rounded-full ${telemetry.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`} />
              <span className="text-zinc-400">VRAM</span>
              <span className="text-primary font-bold">
                {telemetryLoading ? (
                  <span className="skeleton-shimmer h-4 w-32 inline-block font-mono" />
                ) : telemetry.vramUsedGb !== null && telemetry.vramTotalGb !== null
                  ? `${telemetry.vramUsedGb.toFixed(1)} / ${telemetry.vramTotalGb.toFixed(0)} GB`
                  : 'Unavailable'}
              </span>
            </Link>

            <Link
              href="/workspace/generate"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-black font-bold text-sm shadow-[0_0_20px_rgba(255,204,0,0.3)] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              <Zap className="w-4 h-4 fill-black" />
              <span>Launch Studio</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO COMMAND CENTER ────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-32">
        {/* Glow Effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          {/* Badge */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[hsl(var(--surface-1))]/80 border border-primary/30 backdrop-blur-md shadow-lg">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-ping" />
              <span className="text-xs font-mono font-semibold text-primary uppercase tracking-wider">
                Personal Multi-Model 3D Workstation · Zero Cloud Fees
              </span>
            </div>
          </div>

          {/* Main Title */}
          <div className="text-center max-w-4xl mx-auto mb-6">
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-white leading-[1.1] mb-6">
              Production-Grade 3D Meshes from Any Concept.
            </h1>
            <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Your private generative 3D creative suite. Generate, auto-retopologize to clean quad flow,
              bake 8K PBR textures, and rig humanoid skeletons right on your personal workstation.
            </p>
          </div>

          {/* Quick Launch Console (Real Interactive Generator) */}
          <div className="max-w-3xl mx-auto mt-8">
            <div className="p-2 sm:p-3 bg-[hsl(var(--surface-1))]/90 rounded-2xl border border-white/[0.12] backdrop-blur-xl shadow-2xl">
              {/* Mode Switcher Tabs */}
              <div className="flex items-center gap-1 p-1 bg-black/40 rounded-xl mb-3 overflow-x-auto scrollbar-none">
                <button
                  type="button"
                  onClick={() => setActiveTab('generate')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'generate'
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Image / Text to 3D</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('retopo')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'retopo'
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Quad Retopo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('texture')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'texture'
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>PBR Texture</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('rigging')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'rigging'
                      ? 'bg-primary text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Auto-Rigging</span>
                </button>
              </div>

              {/* Dynamic Input Form */}
              <form onSubmit={handleQuickLaunch} className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    placeholder={
                      activeTab === 'generate'
                        ? 'Asset name (text-to-3D is unavailable; upload a reference image in Studio)...'
                        : activeTab === 'retopo'
                        ? 'Target polycount budget or remeshing prompt...'
                        : activeTab === 'texture'
                        ? 'Texture style: "weathered metallic brass, rusted edges, 4K PBR"...'
                        : 'Rigging target: "Humanoid bipedal combat rig"...'
                    }
                    className="w-full px-4 py-3.5 bg-black/60 rounded-xl border border-white/[0.08] focus:border-primary focus:ring-1 focus:ring-primary text-white text-sm placeholder-zinc-500 transition-all outline-none"
                  />
                  <div className="absolute right-2 top-2">
                    <button
                      type="submit"
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-black font-bold text-xs transition-transform active:scale-95 cursor-pointer shadow-md"
                    >
                      <span>Launch Studio</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sub-controls: Intent Pills & Model Selection */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
                  {/* Preset Pills */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-mono text-zinc-500 uppercase mr-1">Preset:</span>
                    {PRESET_WORKFLOWS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedIntent(p.id)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                          selectedIntent === p.id
                            ? 'bg-primary/20 text-primary border border-primary/40 font-bold'
                            : 'bg-white/[0.03] text-zinc-400 hover:text-white border border-transparent'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Model Selector Dropdown */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-zinc-500 uppercase">Engine:</span>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="bg-black/80 border border-white/[0.1] rounded-md px-2 py-1 text-xs text-zinc-300 font-mono focus:border-primary outline-none cursor-pointer"
                    >
                      <option value="trellis2_image_to_raw_mesh">Trellis 2 (1536 Cascade)</option>
                      <option value="hunyuan3d_shape_v21_image_to_raw_mesh">Hunyuan3D 2.1 (Sharp Solids)</option>
                      <option value="unique3d_image_to_raw_mesh">Unique3D (Clean Geometry)</option>
                      <option value="triposg_image_to_raw_mesh">TripoSG (Fast Mesh)</option>
                    </select>
                  </div>
                </div>
              </form>
            </div>
          </div>

          {/* Quick Metrics Ticker */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mt-12 pt-8 border-t border-white/[0.06]">
            <div className="flex flex-col items-center text-center p-3 rounded-xl bg-white/[0.02]">
              <span className="text-2xl font-black text-white font-mono flex items-center gap-1">
                <Clock className="w-4 h-4 text-primary" />
                <span>&lt; 45s</span>
              </span>
              <span className="text-xs text-zinc-400 mt-1">Average Inference Time</span>
            </div>
            <div className="flex flex-col items-center text-center p-3 rounded-xl bg-white/[0.02]">
              <span className="text-2xl font-black text-white font-mono flex items-center gap-1">
                <Box className="w-4 h-4 text-primary" />
                <span>8K PBR</span>
              </span>
              <span className="text-xs text-zinc-400 mt-1">Maximum Atlas Dimension</span>
            </div>
            <div className="flex flex-col items-center text-center p-3 rounded-xl bg-white/[0.02]">
              <span className="text-2xl font-black text-white font-mono flex items-center gap-1">
                <Scissors className="w-4 h-4 text-primary" />
                <span>Quads</span>
              </span>
              <span className="text-xs text-zinc-400 mt-1">Polygonal Wavefront Export</span>
            </div>
            <div className="flex flex-col items-center text-center p-3 rounded-xl bg-white/[0.02]">
              <span className="text-2xl font-black text-white font-mono flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span>100% Solid</span>
              </span>
              <span className="text-xs text-zinc-400 mt-1">Watertight 3D Slicing</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── CORE AUTONOMOUS PIPELINE GRID ──────────────────────────────── */}
      <section className="py-16 md:py-24 bg-[hsl(var(--surface-0))] border-y border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Workflow className="w-4 h-4 text-primary" />
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-primary">
                  Workstation Tools
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                Complete End-to-End Generative Pipeline
              </h2>
            </div>
            <p className="text-sm text-zinc-400 max-w-md mt-2 md:mt-0">
              Every tool runs locally on your machine with dedicated subprocess workers, multi-stage
              caching, and zero external subscriptions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CORE_PIPELINES.map((pipe) => {
              const IconComponent = pipe.icon;
              return (
                <Link
                  key={pipe.title}
                  href={pipe.route}
                  className="group relative p-6 rounded-2xl bg-[hsl(var(--surface-1))] border border-white/[0.08] hover:border-primary/50 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(255,204,0,0.12)] cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all">
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.05] text-zinc-400 border border-white/[0.06]">
                        {pipe.tag}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-white group-hover:text-primary transition-colors mb-2">
                      {pipe.title}
                    </h3>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                      {pipe.description}
                    </p>
                  </div>

                  <div>
                    <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs font-mono text-zinc-500">
                      <span>{pipe.specs}</span>
                      <span className="text-primary font-bold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        Launch <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WORKFLOW PRESETS COMPARISON ────────────────────────────────── */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-primary">
              Target Specific Industry Standards
            </span>
            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-2 mb-4">
              Smart Intent Presets for Your Exact Engine
            </h2>
            <p className="text-sm text-zinc-400">
              ForMash3D automatically resolves triangle budgets, UV generation, and collision hulls based
              on your selected project intent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PRESET_WORKFLOWS.map((preset) => (
              <div
                key={preset.id}
                className={`p-6 rounded-2xl bg-gradient-to-br ${preset.color} bg-[hsl(var(--surface-1))] border ${preset.borderColor} flex flex-col justify-between transition-all hover:scale-[1.01]`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono font-bold text-white px-2 py-0.5 rounded bg-black/40 border border-white/10">
                      {preset.tag}
                    </span>
                    <span className="text-xs font-mono text-zinc-400">{preset.targetBudget}</span>
                  </div>

                  <h3 className="text-xl font-bold text-white mb-2">{preset.label}</h3>

                  <div className="space-y-1.5 text-xs font-mono text-zinc-400 mb-6">
                    <div className="flex justify-between py-1 border-b border-white/[0.06]">
                      <span className="text-zinc-500">Textures</span>
                      <span className="text-zinc-300 font-semibold">{preset.textures}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/[0.06]">
                      <span className="text-zinc-500">LOD Strategy</span>
                      <span className="text-zinc-300 font-semibold">{preset.lods}</span>
                    </div>
                  </div>

                  <ul className="space-y-2 mb-6">
                    {preset.features.map((feat) => (
                      <li key={feat} className="flex items-center gap-2 text-xs text-zinc-300">
                        <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Link
                  href={preset.route}
                  className="w-full py-2.5 px-4 rounded-xl bg-white/[0.08] hover:bg-primary hover:text-black text-white font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <span>Generate with {preset.label}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── RECENT CREATIONS & SHOWCASE GALLERY ────────────────────────── */}
      <section className="py-16 md:py-24 bg-[hsl(var(--surface-0))] border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-12">
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-primary">
                Workstation Gallery
              </span>
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-1">
                Inspect Production Mesh Outputs
              </h2>
            </div>
            <Link
              href="/outputs"
              className="text-xs font-mono text-primary font-bold flex items-center gap-1 hover:underline mt-2 sm:mt-0 cursor-pointer"
            >
              <span>View All Exported Assets</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {SHOWCASE_ITEMS.map((item) => (
              <div
                key={item.name}
                className="group rounded-2xl bg-[hsl(var(--surface-1))] border border-white/[0.08] overflow-hidden hover:border-primary/50 transition-all duration-200 hover:-translate-y-1 shadow-lg"
              >
                <div className="relative aspect-square w-full bg-black/60 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-80 group-hover:opacity-100"
                  />
                  <div className="absolute top-2.5 left-2.5">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/80 text-primary border border-primary/30 backdrop-blur-sm">
                      {item.category}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <h4 className="font-bold text-sm text-white truncate mb-2">{item.name}</h4>
                  <div className="space-y-1 text-[11px] font-mono text-zinc-400 mb-3">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Polycount</span>
                      <span className="text-zinc-200">{item.polycount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Flow</span>
                      <span className="text-zinc-200">{item.topology}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    {item.formats.map((fmt) => (
                      <span
                        key={fmt}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06]"
                      >
                        {fmt}
                      </span>
                    ))}
                  </div>

                  <Link
                    href={item.route}
                    className="w-full py-1.5 px-3 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-black font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Box className="w-3.5 h-3.5" />
                    <span>Inspect in Viewport</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LIVE HARDWARE TELEMETRY & WORKSTATION METRICS ──────────────── */}
      <section className="py-16 md:py-24 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="p-8 rounded-3xl bg-[hsl(var(--surface-1))] border border-white/[0.08] relative overflow-hidden shadow-2xl">
            <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
              <div className="max-w-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400">
                    Live Hardware Health
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-3">
                  Dedicated Workstation Engine
                </h2>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Your models execute in an isolated multi-process architecture with GPU memory clearing,
                  automatic worker garbage collection, and direct on-disk serialization.
                </p>

                <div className="flex flex-wrap gap-4 mt-6">
                  <Link
                    href="/system"
                    className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-bold text-xs transition-colors flex items-center gap-2 cursor-pointer border border-white/[0.08]"
                  >
                    <Settings className="w-3.5 h-3.5 text-primary" />
                    <span>System Telemetry</span>
                  </Link>
                  <Link
                    href="/dashboard"
                    className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-bold text-xs transition-colors flex items-center gap-2 cursor-pointer border border-white/[0.08]"
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-primary" />
                    <span>Analytics Dashboard</span>
                  </Link>
                </div>
              </div>

              {/* Hardware Gauges */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full lg:w-auto">
                <div className="p-4 rounded-xl bg-black/50 border border-white/[0.06] min-w-[200px]">
                  <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-primary" />
                      <span>GPU VRAM</span>
                    </span>
                    <span className={`${telemetry.vramUsedGb !== null && telemetry.vramTotalGb !== null ? 'text-emerald-400' : 'text-zinc-500'} font-bold`}>
                      {telemetryLoading ? (
                        <span className="skeleton-shimmer h-4 w-16 inline-block" />
                      ) : telemetry.vramUsedGb !== null && telemetry.vramTotalGb !== null ? 'Reported' : 'Unavailable'}
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono text-white mb-2">
                    {telemetryLoading ? (
                      <span className="skeleton-shimmer h-6 w-28 inline-block font-mono" />
                    ) : telemetry.vramUsedGb === null ? 'Unavailable' : telemetry.vramUsedGb.toFixed(1)}{' '}
                    {telemetry.vramUsedGb !== null && (
                      <span className="text-xs text-zinc-500 font-normal">
                        {telemetryLoading ? (
                          <span className="skeleton-shimmer h-3 w-14 inline-block" />
                        ) : telemetry.vramTotalGb === null ? 'Unavailable' : `${telemetry.vramTotalGb.toFixed(0)} GB`}
                      </span>
                    )}
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{
                        width: telemetryLoading
                          ? '100%'
                          : telemetry.vramUsedGb !== null && telemetry.vramTotalGb !== null && telemetry.vramTotalGb > 0
                            ? `${Math.min(100, (telemetry.vramUsedGb / telemetry.vramTotalGb) * 100)}%`
                            : '0%',
                      }}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-black/50 border border-white/[0.06] min-w-[200px]">
                  <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-2">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-primary" />
                      <span>Engine Latency</span>
                    </span>
                    <span className="text-primary font-bold">
                      {telemetryLoading ? (
                        <span className="skeleton-shimmer h-4 w-20 inline-block font-mono" />
                      ) : telemetry.latencyMs === null ? 'Unavailable' : `${telemetry.latencyMs} ms`}
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono text-white mb-2">
                    {telemetryLoading ? (
                      <span className="skeleton-shimmer h-6 w-16 inline-block font-mono" />
                    ) : telemetry.queueRunning ?? 'Unavailable'}{' '}
                    <span className="text-xs text-zinc-500 font-normal">Active Jobs</span>
                  </div>
                  <div className="text-xs font-mono text-zinc-500 truncate">
                    {telemetryLoading ? (
                      <span className="skeleton-shimmer h-3 w-24 inline-block" />
                    ) : telemetry.gpuName || 'Unavailable'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KEYBOARD SHORTCUTS BANNER ──────────────────────────────────── */}
      <section className="py-8 bg-black/40 border-t border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-mono text-zinc-400">
            <span className="text-zinc-500 uppercase font-semibold">Hotkeys:</span>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                G
              </kbd>
              <span>Generate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                R
              </kbd>
              <span>Retopo</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                T
              </kbd>
              <span>Texture</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                U
              </kbd>
              <span>UV Pack</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                A
              </kbd>
              <span>Animation</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                D
              </kbd>
              <span>Dashboard</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                O
              </kbd>
              <span>Outputs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 rounded bg-[hsl(var(--surface-1))] border border-white/[0.1] text-primary font-bold">
                S
              </kbd>
              <span>System</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.08] bg-[hsl(var(--surface-0))] py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div>
              <h4 className="text-xs font-mono font-bold uppercase text-white tracking-wider mb-4">
                Generative Tools
              </h4>
              <ul className="space-y-2 text-xs text-zinc-400">
                <li>
                  <Link href="/workspace/generate" className="hover:text-primary transition-colors cursor-pointer">
                    Image to 3D Mesh
                  </Link>
                </li>
                <li>
                  <Link href="/workspace/generate" className="hover:text-primary transition-colors cursor-pointer">
                    Text to 3D Asset
                  </Link>
                </li>
                <li>
                  <Link href="/workspace/remesh" className="hover:text-primary transition-colors cursor-pointer">
                    Quad Retopology
                  </Link>
                </li>
                <li>
                  <Link href="/workspace/texture" className="hover:text-primary transition-colors cursor-pointer">
                    PBR Texture Studio
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold uppercase text-white tracking-wider mb-4">
                Rigging & Motion
              </h4>
              <ul className="space-y-2 text-xs text-zinc-400">
                <li>
                  <Link href="/workspace/rigging" className="hover:text-primary transition-colors cursor-pointer">
                    Automated UniRig
                  </Link>
                </li>
                <li>
                  <Link href="/workspace/animation" className="hover:text-primary transition-colors cursor-pointer">
                    3D Animation Studio
                  </Link>
                </li>
                <li>
                  <Link href="/workspace/uv" className="hover:text-primary transition-colors cursor-pointer">
                    XAtlas UV Packing
                  </Link>
                </li>
                <li>
                  <Link href="/workspace/segment" className="hover:text-primary transition-colors cursor-pointer">
                    Mesh Segmentation
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold uppercase text-white tracking-wider mb-4">
                Workstation & Storage
              </h4>
              <ul className="space-y-2 text-xs text-zinc-400">
                <li>
                  <Link href="/outputs" className="hover:text-primary transition-colors cursor-pointer">
                    Outputs & Downloads
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="hover:text-primary transition-colors cursor-pointer">
                    Telemetry Analytics
                  </Link>
                </li>
                <li>
                  <Link href="/system" className="hover:text-primary transition-colors cursor-pointer">
                    GPU & VRAM Status
                  </Link>
                </li>
                <li>
                  <Link href="/workspace" className="hover:text-primary transition-colors cursor-pointer">
                    3D Viewport Studio
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-mono font-bold uppercase text-white tracking-wider mb-4">
                Documentation & Specs
              </h4>
              <ul className="space-y-2 text-xs text-zinc-400">
                <li>
                  <span className="text-zinc-500 font-mono">Docs/ARCHITECTURE.md</span>
                </li>
                <li>
                  <span className="text-zinc-500 font-mono">Docs/DESIGN.md</span>
                </li>
                <li>
                  <span className="text-zinc-500 font-mono">Docs/DECISIONS.md</span>
                </li>
                <li>
                  <span className="text-zinc-500 font-mono">Docs/CHANGELOG.md</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-zinc-500">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-primary" />
              <span>ForMash3D Workstation v2.5 · Powered by Autonomous AI Pipelines</span>
            </div>
            <div>
              <span>Personal Workstation License · Localhost GPU Execution</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
