'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight,
  CheckmarkCircle02Icon,
  ChevronDown,
  ChevronUp,
  LayersIcon,
  LightbulbIcon,
  Maximize02Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

type UVLayoutPayload = {
  assetId: string | null;
  channel: number;
  meshCount: number;
  uvMeshCount: number;
  vertexCount: number;
  triangleCount: number;
  uvVertexCount: number;
  outOfBoundsVertices: number;
  invalidUvCount: number;
  sampledTriangleCount: number;
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  edges: Array<[number, number, number, number]>;
};

const numberText = (value: number) => value.toLocaleString();

export const UVInspector: React.FC = () => {
  const { currentAsset, navigateToTool } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'layout' | 'checker'>('layout');
  const [uvChannel, setUvChannel] = useState(0);
  const [isStatsExpanded, setIsStatsExpanded] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [payload, setPayload] = useState<UVLayoutPayload | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Request UV data from the currently loaded viewport mesh; never substitute sample artwork or fabricated statistics.
  useEffect(() => {
    const assetId = currentAsset?.id ?? null;
    const requestLayout = () => {
      setPayload(null);
      if (!assetId) return;
      window.dispatchEvent(new CustomEvent('formash:request_uv_layout', {
        detail: { assetId, channel: uvChannel },
      }));
    };
    const handleLayoutReady = (event: Event) => {
      const detail = (event as CustomEvent<UVLayoutPayload>).detail;
      if (!detail || detail.assetId !== assetId || detail.channel !== uvChannel) return;
      setPayload(detail);
    };
    window.addEventListener('formash:uv_layout_ready', handleLayoutReady);
    window.addEventListener('formash:uv_layout_changed', requestLayout);
    requestLayout();
    return () => {
      window.removeEventListener('formash:uv_layout_ready', handleLayoutReady);
      window.removeEventListener('formash:uv_layout_changed', requestLayout);
    };
  }, [currentAsset?.id, uvChannel]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === canvasContainerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const activePayload =
    payload && payload.assetId === (currentAsset?.id ?? null) && payload.channel === uvChannel
      ? payload
      : null;

  // Auto-fit actual UV bounds on every data/channel change. Dense meshes are edge-sampled only for drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, width, height);

    if (activeTab === 'checker') {
      const tile = 24;
      for (let x = 0; x < width; x += tile) {
        for (let y = 0; y < height; y += tile) {
          ctx.fillStyle = ((Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0) ? '#17181c' : '#272930';
          ctx.fillRect(x, y, tile, tile);
        }
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const grid = 32;
      for (let x = 0; x < width; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    if (!activePayload) {
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(currentAsset ? 'Waiting for viewport UV data…' : 'Select a mesh to inspect its UVs', width / 2, height / 2);
      return;
    }
    if (activePayload.uvMeshCount === 0 || activePayload.edges.length === 0) {
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`No UV channel ${uvChannel} is available on this mesh`, width / 2, height / 2);
      return;
    }

    const pad = 24;
    const spanU = Math.max(1e-6, activePayload.maxU - activePayload.minU);
    const spanV = Math.max(1e-6, activePayload.maxV - activePayload.minV);
    const scale = Math.min((width - pad * 2) / spanU, (height - pad * 2) / spanV);
    const offsetX = (width - spanU * scale) / 2;
    const offsetY = (height - spanV * scale) / 2;
    const mapPoint = (u: number, v: number) => ({
      x: offsetX + (u - activePayload.minU) * scale,
      y: height - offsetY - (v - activePayload.minV) * scale,
    });

    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [u0, v0, u1, v1] of activePayload.edges) {
      const p0 = mapPoint(u0, v0);
      const p1 = mapPoint(u1, v1);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();
  }, [activePayload, activeTab, currentAsset, uvChannel]);

  const handleToggleFullscreen = async () => {
    try {
      const container = canvasContainerRef.current;
      if (!container) return;
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else {
        if (!container.requestFullscreen) throw new Error('Fullscreen is not supported by this browser.');
        await container.requestFullscreen();
      }
    } catch (error) {
      toast.error('Could not change UV view size', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div id="inspector-uv" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white overflow-y-auto scrollbar-thin select-none">
      <div className="p-2.5 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex gap-1 p-1 bg-[hsl(var(--surface-0))] rounded-xl border border-white/[0.08]">
          {(['layout', 'checker'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-extrabold capitalize transition-all cursor-pointer ${
                activeTab === tab ? 'bg-primary text-black shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {tab === 'layout' ? 'UV Layout' : 'UV Checker'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-3.5 flex-1">
        <div className="space-y-2">
          <div
            ref={canvasContainerRef}
            className={`relative rounded-xl overflow-hidden border border-white/[0.1] bg-[hsl(var(--surface-0))] shadow-inner flex items-center justify-center ${isFullscreen ? 'w-screen h-screen p-4' : ''}`}
          >
            <canvas
              ref={canvasRef}
              width={560}
              height={400}
              className={`w-full block ${isFullscreen ? 'h-[calc(100vh-2rem)]' : 'h-[240px]'}`}
              title="UV layout from the selected mesh"
              aria-label="Sampled UV triangle edges for the selected mesh"
            />
            <button
              type="button"
              onClick={handleToggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen UV view' : 'Fullscreen UV view'}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen UV View'}
              className="absolute top-2 right-2 p-1.5 rounded-md bg-[hsl(var(--surface-1))]/90 border border-white/[0.1] text-zinc-300 hover:text-white cursor-pointer"
            >
              <HugeiconsIcon icon={Maximize02Icon} size={16} className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400 text-[11px]">UV Channel</span>
              <select
                value={uvChannel}
                onChange={(e) => setUvChannel(Number(e.target.value))}
                className="h-6 px-1.5 rounded-md bg-[hsl(var(--surface-0))] border border-white/[0.08] text-[11px] font-mono text-white"
              >
                <option value={0}>0 (Primary UV)</option>
                <option value={1}>1 (Secondary UV)</option>
              </select>
            </div>
            <span className="text-[10px] text-zinc-500">
              {activePayload ? `${numberText(activePayload.sampledTriangleCount)} triangles sampled for drawing` : 'Live viewport data'}
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] overflow-hidden">
          <button
            type="button"
            onClick={() => setIsStatsExpanded(!isStatsExpanded)}
            className="w-full p-2.5 flex items-center justify-between bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={LayersIcon} size={16} className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-white">UV Data</span>
            </div>
            {isStatsExpanded
              ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-4 h-4 text-zinc-400" />
              : <HugeiconsIcon icon={ChevronDown} size={16} className="w-4 h-4 text-zinc-400" />}
          </button>

          {isStatsExpanded && (
            <div className="p-3 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {[
                  ['Meshes', activePayload ? numberText(activePayload.meshCount) : '—'],
                  ['Meshes with UVs', activePayload ? numberText(activePayload.uvMeshCount) : '—'],
                  ['Vertices', activePayload ? numberText(activePayload.vertexCount) : '—'],
                  ['Triangles', activePayload ? numberText(activePayload.triangleCount) : '—'],
                  ['UV Vertices', activePayload ? numberText(activePayload.uvVertexCount) : '—'],
                  ['Out-of-Bounds UVs', activePayload ? numberText(activePayload.outOfBoundsVertices) : '—'],
                  ['Invalid UV Values', activePayload ? numberText(activePayload.invalidUvCount) : '—'],
                  ['UV Bounds', activePayload ? `U ${activePayload.minU.toFixed(3)}–${activePayload.maxU.toFixed(3)}, V ${activePayload.minV.toFixed(3)}–${activePayload.maxV.toFixed(3)}` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-zinc-400 text-[10px]">{label}</span>
                    <span className="font-mono text-white text-[11px] break-words">{value}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                UV island count, overlap testing, and texel density are not reported because this viewer does not calculate those metrics.
              </p>
            </div>
          )}
        </div>

        <div className="p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-2">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={LightbulbIcon} size={16} className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-white">Inspection Notes</span>
          </div>
          <div className="space-y-1.5 text-[11px]">
            {[
              'The layout is read from the loaded mesh UV attributes, not generated sample artwork.',
              'Triangle outlines are sampled for responsiveness; geometry and UV counts cover all loaded meshes.',
              'UV coordinates outside 0–1 may be intentional for tiled materials.',
              'Channel 1 is shown only when the mesh provides uv1/uv2 data.',
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-zinc-300 leading-snug">{tip}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigateToTool('texture')}
          className="w-full py-2.5 px-3 rounded-xl bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <HugeiconsIcon icon={SparklesIcon} size={16} className="w-3.5 h-3.5 text-primary" />
          <span>Use in Texture Generation</span>
          <HugeiconsIcon icon={ArrowRight} size={16} className="w-3.5 h-3.5 text-zinc-400" />
        </button>
      </div>
    </div>
  );
};
