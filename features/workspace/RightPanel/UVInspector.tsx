'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';


import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight, CheckmarkCircle02Icon, ChevronDown, ChevronUp, LayersIcon, LightbulbIcon, Maximize02Icon, SparklesIcon } from '@hugeicons/core-free-icons';
export const UVInspector: React.FC = () => {
  const { currentAsset, navigateToTool } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'layout' | 'texture' | 'checker'>('layout');
  const [uvChannel, setUvChannel] = useState(0);
  const [isStatsExpanded, setIsStatsExpanded] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw 2D UV layout wireframe on dark grid matching project theme
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background dark surface
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, width, height);

    if (activeTab === 'checker') {
      // Draw crisp UV test checker pattern
      const tileSize = 20;
      for (let x = 0; x < width; x += tileSize) {
        for (let y = 0; y < height; y += tileSize) {
          const isEven = ((x / tileSize) + (y / tileSize)) % 2 === 0;
          ctx.fillStyle = isEven ? '#17181c' : '#272930';
          ctx.fillRect(x, y, tileSize, tileSize);
        }
      }
    } else if (activeTab === 'texture') {
      // Draw procedural texture map representation
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#1c1b12');
      grad.addColorStop(0.5, '#2e2712');
      grad.addColorStop(1, '#181a20');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    } else {
      // Dark coordinate grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      const gridSize = 24;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Draw stylized procedural UV islands in studio primary yellow accent
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 1.3;
    ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';

    // Torso / chest armor island
    ctx.beginPath();
    ctx.moveTo(width * 0.25, height * 0.15);
    ctx.bezierCurveTo(width * 0.40, height * 0.12, width * 0.45, height * 0.12, width * 0.55, height * 0.15);
    ctx.lineTo(width * 0.58, height * 0.40);
    ctx.bezierCurveTo(width * 0.50, height * 0.45, width * 0.35, height * 0.45, width * 0.22, height * 0.40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Helmet circular top island
    ctx.beginPath();
    ctx.arc(width * 0.40, height * 0.65, width * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Shoulder / arm vertical islands
    for (let i = 0; i < 3; i++) {
      const xOffset = width * (0.65 + i * 0.11);
      ctx.beginPath();
      ctx.roundRect(xOffset, height * 0.15, width * 0.08, height * 0.35, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Leg / gauntlet vertical islands
    for (let i = 0; i < 4; i++) {
      const xOffset = width * (0.60 + i * 0.09);
      ctx.beginPath();
      ctx.roundRect(xOffset, height * 0.55, width * 0.07, height * 0.38, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Shield island
    ctx.beginPath();
    ctx.moveTo(width * 0.12, height * 0.55);
    ctx.lineTo(width * 0.22, height * 0.55);
    ctx.lineTo(width * 0.20, height * 0.85);
    ctx.lineTo(width * 0.12, height * 0.80);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }, [activeTab]);

  return (
    <div id="inspector-uv" className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-white overflow-y-auto scrollbar-thin select-none">
      {/* Top Segmented Tabs: UV Layout, Texture Preview, Checker */}
      <div className="p-2.5 border-b border-white/[0.08] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex gap-1 p-1 bg-[hsl(var(--surface-0))] rounded-xl border border-white/[0.08]">
          {(['layout', 'texture', 'checker'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              id={`inspector-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-extrabold capitalize transition-all cursor-pointer ${
                activeTab === tab
                  ? 'bg-primary text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {tab === 'layout' ? 'UV Layout' : tab === 'texture' ? 'Texture' : 'Checker'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-3.5 flex-1">
        {/* 2D UV Layout Canvas Display */}
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden border border-white/[0.1] bg-[hsl(var(--surface-0))] shadow-inner flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={280}
              height={260}
              className="w-full h-[240px] block cursor-grab active:cursor-grabbing"
              title="Interactive UV Layout Viewer"
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400 text-[11px]">UV Channel</span>
              <select
                value={uvChannel}
                onChange={(e) => setUvChannel(Number(e.target.value))}
                className="h-6 px-1.5 rounded-md bg-[hsl(var(--surface-0))] border border-white/[0.08] text-[11px] font-mono text-white"
              >
                <option value={0}>0 (Primary Diffuse)</option>
                <option value={1}>1 (Lightmap / AO)</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="px-2 py-1 rounded-md bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-[10px] text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <span>Fit to View</span>
              </button>
              <button
                type="button"
                className="p-1 rounded-md bg-[hsl(var(--surface-0))] hover:bg-[hsl(var(--surface-2))] border border-white/[0.08] text-zinc-400 hover:text-white cursor-pointer"
                title="Fullscreen UV View"
              >
                <HugeiconsIcon icon={Maximize02Icon} size={16} className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* UV Statistics Accordion Card */}
        <div className="rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] overflow-hidden">
          <button
            type="button"
            onClick={() => setIsStatsExpanded(!isStatsExpanded)}
            className="w-full p-2.5 flex items-center justify-between bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <HugeiconsIcon icon={LayersIcon} size={16} className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-white">UV Statistics</span>
            </div>
            {isStatsExpanded ? <HugeiconsIcon icon={ChevronUp} size={16} className="w-4 h-4 text-zinc-400" /> : <HugeiconsIcon icon={ChevronDown} size={16} className="w-4 h-4 text-zinc-400" />}
          </button>

          {isStatsExpanded && (
            <div className="p-3 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">UV Islands</span>
                  <span className="font-mono text-white font-bold">48</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Min Texel Density</span>
                  <span className="font-mono text-white font-bold">512 px/m</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Coverage</span>
                  <span className="font-mono text-emerald-400 font-bold">87.4%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Max Texel Density</span>
                  <span className="font-mono text-white font-bold">2,048 px/m</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Overlaps</span>
                  <span className="font-mono text-emerald-400 font-bold">0</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 text-[11px]">Average Density</span>
                  <span className="font-mono text-white font-bold">1,024 px/m</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tips & Guidelines Card */}
        <div className="p-3 rounded-xl bg-[hsl(var(--surface-0))] border border-white/[0.08] space-y-2">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={LightbulbIcon} size={16} className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-white">Tips &amp; Guidelines</span>
          </div>

          <div className="space-y-1.5 text-[11px]">
            {[
              'Use UV-free meshes for best unwrap quality',
              'Set appropriate texture resolution (1024–4096)',
              'CheckIcon UV layout for stretched or overlapping areas',
              'High texel density ensures sharp texture baking',
            ].map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-zinc-300 leading-snug">{tip}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Lineage Chaining Button: Use in Texture */}
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
