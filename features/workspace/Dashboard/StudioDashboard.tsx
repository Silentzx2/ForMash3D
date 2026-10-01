import React from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { GpuVramLineChart } from '@/components/premium/GpuVramLineChart';
import { Skeleton } from '@/components/ui/skeleton';


import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight, Box, FolderOpen, Layers, SlidersHorizontal, Sparkles } from '@hugeicons/core-free-icons';
export const StudioDashboard: React.FC = () => {
  const { 
    setMainNav, 
    setActiveTool, 
    assets, 
    isAssetsLoading,
    setCurrentAsset, 
    systemStats, 
    setIsSettingsOpen 
  } = useWorkspace();

  const handleLaunchTool = (tool: import('../types').ToolType) => {
    setActiveTool(tool);
    setMainNav('workspace');
  };

  return (
    <div id="studio-dashboard-view" className="flex-1 w-full h-full overflow-y-auto bg-[hsl(var(--surface-0))] select-none text-xs">
      <div className="max-w-6xl mx-auto w-full p-6 lg:p-8 space-y-6">
        {/* Studio Banner & Quick Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-b from-[#181818] to-[#0f0f0f] border border-white/[0.12] shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] relative overflow-hidden">
          {/* Subtle golden overhead studio lighting corner bloom */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-1.5 relative z-10">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#222222] text-primary uppercase tracking-wider font-bold border border-primary/20 shadow-sm">
                FastAPI + 3D-Pack
              </span>
              <span className={`text-[10px] font-mono flex items-center gap-1.5 ${systemStats.status === 'online' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}`}>
                <span className={`w-2 h-2 rounded-full ${systemStats.status === 'online' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-400'}`} />
                {systemStats.status === 'online' ? 'FastAPI Connected' : 'FastAPI Offline'}
              </span>
            </div>
            <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">
              AI 3D Creation Workspace
            </h1>
            <p className="text-xs text-zinc-200 max-w-xl leading-relaxed">
              Professional high-fidelity 3D modeling, quad topology remeshing, and PBR texture baking.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 relative z-10">
            <button
              onClick={() => handleLaunchTool('model')}
              className="relative px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] text-[#080808] font-black text-xs flex items-center gap-2 shadow-[0_4px_20px_-2px_rgba(255,204,0,0.45),inset_0_1px_0_rgba(255,255,255,0.6)] hover:shadow-[0_6px_28px_rgba(255,204,0,0.65),inset_0_1px_0_rgba(255,255,255,0.8)] hover:brightness-105 transition-all active:scale-95 cursor-pointer border-t border-white/60 btn-lighting-shine"
            >
              <HugeiconsIcon icon={Sparkles} size={16} className="w-4 h-4 fill-current stroke-[2.2]" />
              <span>New 3D Generation</span>
            </button>
          </div>
        </div>

        {/* 3 Core Workflows Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Model */}
          <div 
            onClick={() => handleLaunchTool('model')}
            className="p-5 rounded-2xl bg-gradient-to-b from-[#181818] to-[#101010] border border-white/[0.12] hover:border-primary/60 hover:from-[#1f1f1f] hover:to-[#131313] cursor-pointer transition-all duration-200 group flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_24px_rgba(255,204,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.99]"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center text-primary group-hover:scale-110 group-hover:border-primary/60 group-hover:shadow-[0_0_16px_rgba(255,204,0,0.35)] transition-all">
                <HugeiconsIcon icon={Box} size={16} className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#F5F5F5] group-hover:text-primary transition-colors">3D Mesh Generation</h3>
                <p className="text-zinc-300 text-[11px] mt-1 leading-relaxed">Generate high-fidelity 3D meshes using the installed FastAPI + 3D-Pack neural pipelines.</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-primary group-hover:text-[#FFE066] font-bold text-xs pt-4 transition-colors">
              <span>Launch Tool</span>
              <HugeiconsIcon icon={ArrowRight} size={16} className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform stroke-[2.2]" />
            </div>
          </div>

          {/* PBR Texture */}
          <div 
            onClick={() => handleLaunchTool('texture')}
            className="p-5 rounded-2xl bg-gradient-to-b from-[#181818] to-[#101010] border border-white/[0.12] hover:border-primary/60 hover:from-[#1f1f1f] hover:to-[#131313] cursor-pointer transition-all duration-200 group flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_24px_rgba(255,204,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.99]"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center text-primary group-hover:scale-110 group-hover:border-primary/60 group-hover:shadow-[0_0_16px_rgba(255,204,0,0.35)] transition-all">
                <HugeiconsIcon icon={Layers} size={16} className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#F5F5F5] group-hover:text-primary transition-colors">PBR Texture Studio</h3>
                <p className="text-zinc-300 text-[11px] mt-1 leading-relaxed">Albedo, normal, roughness, and displacement map synthesis up to 8K resolution.</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-primary group-hover:text-[#FFE066] font-bold text-xs pt-4 transition-colors">
              <span>Launch Tool</span>
              <HugeiconsIcon icon={ArrowRight} size={16} className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform stroke-[2.2]" />
            </div>
          </div>

          {/* Remesh */}
          <div 
            onClick={() => handleLaunchTool('remesh')}
            className="p-5 rounded-2xl bg-gradient-to-b from-[#181818] to-[#101010] border border-white/[0.12] hover:border-primary/60 hover:from-[#1f1f1f] hover:to-[#131313] cursor-pointer transition-all duration-200 group flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.6),0_0_24px_rgba(255,204,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.99]"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center text-primary group-hover:scale-110 group-hover:border-primary/60 group-hover:shadow-[0_0_16px_rgba(255,204,0,0.35)] transition-all">
                <HugeiconsIcon icon={SlidersHorizontal} size={16} className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#F5F5F5] group-hover:text-primary transition-colors">Adaptive Remesh</h3>
                <p className="text-zinc-300 text-[11px] mt-1 leading-relaxed">Quad retopology, polygon decimation, and boundary protection presets.</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-primary group-hover:text-[#FFE066] font-bold text-xs pt-4 transition-colors">
              <span>Launch Tool</span>
              <HugeiconsIcon icon={ArrowRight} size={16} className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform stroke-[2.2]" />
            </div>
          </div>
        </div>

        {/* Real-time VRAM and GPU Utilization Monitoring Section */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-[#181818] to-[#101010] border border-white/[0.12] shadow-[0_6px_28px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] space-y-3">
          <GpuVramLineChart height={240} autoPoll pollIntervalMs={3000} />
        </div>

        {/* Recent Studio Assets Catalog */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={FolderOpen} size={16} className="w-4 h-4 text-primary stroke-[2.2]" />
              <h2 className="font-bold text-sm text-white">Recent 3D Studio Assets</h2>
            </div>
            <span className="text-[11px] text-zinc-400">Click any asset to open in 3D Viewport</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {isAssetsLoading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="p-3 rounded-2xl bg-[hsl(var(--surface-1))] border border-white/[0.08] flex flex-col space-y-3">
                  <Skeleton className="w-full aspect-video rounded-xl bg-white/5" />
                  <Skeleton className="h-4 w-3/4 rounded bg-white/10" />
                  <Skeleton className="h-3 w-1/2 rounded bg-white/5" />
                </div>
              ))
            ) : assets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => {
                  setCurrentAsset(asset);
                  setMainNav('workspace');
                }}
                className="p-3 rounded-2xl bg-gradient-to-b from-[#181818] to-[#101010] border border-white/[0.12] hover:border-primary/60 hover:from-[#1f1f1f] hover:to-[#131313] transition-all cursor-pointer group flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] hover:shadow-[0_8px_30px_rgba(255,204,0,0.16)] active:scale-[0.98]"
              >
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-[hsl(var(--surface-0))] border border-white/[0.08] mb-2.5">
                  {asset.thumbnail ? (
                    <img 
                      src={asset.thumbnail} 
                      alt={asset.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <HugeiconsIcon icon={Box} size={16} className="w-8 h-8 text-zinc-400 stroke-[2.2]" />
                    </div>
                  )}
                  <span className="absolute bottom-1.5 right-1.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-primary border border-primary/30 font-bold">
                    {asset.format}
                  </span>
                </div>

                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-xs text-white truncate group-hover:text-primary transition-colors">
                      {asset.name}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-300 font-mono mt-0.5">
                      <span>{(asset.faces / 1000).toFixed(1)}K faces</span>
                      <span>•</span>
                      <span>{asset.materials?.length ?? 0} mats</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap pt-2">
                    {asset.tags.map(t => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-[#202020] text-zinc-200 border border-white/[0.08]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
