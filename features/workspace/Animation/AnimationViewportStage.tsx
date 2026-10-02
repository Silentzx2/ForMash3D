'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { MeshViewer } from '../Viewport/MeshViewer';
import { useWorkspace } from '../store/WorkspaceContext';
import { useAnimationStore, ViewportGizmoTool, CameraPreset } from '@/stores/useAnimationStore';
import { useViewerStore } from '@/stores/useViewerStore';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';


import { HugeiconsIcon } from '@hugeicons/react';
import { Box, CameraIcon, ChevronDown, MaximizeIcon, Maximize02Icon, MousePointerIcon, MoveIcon, PauseIcon, PlayIcon, RotateCw, SkipBackIcon, SkipForwardIcon, ZoomInIcon, ZoomOutIcon } from '@hugeicons/core-free-icons';
export const AnimationViewportStage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const { currentAsset, showWireframe, setShowWireframe } = useWorkspace();
  const {
    activeViewportTool,
    setActiveViewportTool,
    isPlaying,
    togglePlay,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    fps,
    setFps,
    displayOptions,
    toggleDisplayOption,
    autoCamera,
    setAutoCamera,
    showContacts,
    setShowContacts,
    motionAiPrompt,
    setCameraPreset,
  } = useAnimationStore();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [fpsDropdownOpen, setFpsDropdownOpen] = useState(false);
  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'Perspective' | 'Front' | 'Top' | 'Side'>('Perspective');
  const [timelineTab, setTimelineTab] = useState<'edit' | 'playback' | 'keyframes'>('edit');

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const { currentTime, duration } = useAnimationStore.getState();
      let next = currentTime + delta;
      if (next >= duration) {
        next = 0; // loop
      }
      setCurrentTime(next);

      if (useAnimationStore.getState().isPlaying) {
        animId = requestAnimationFrame(loop);
      }
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, setCurrentTime]);

  // Handle Timeline Scrubbing
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsScrubbing(true);
    handleTimelineScrub(e);
  };

  const handleTimelineScrub = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const progress = x / rect.width;
      const newTime = progress * duration;
      setCurrentTime(newTime);
    },
    [duration, setCurrentTime]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isScrubbing) handleTimelineScrub(e);
    };
    const onMouseUp = () => setIsScrubbing(false);

    if (isScrubbing) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isScrubbing, handleTimelineScrub]);

  // Step 1 frame
  const stepFrame = (deltaFrames: number) => {
    const frameTime = 1 / fps;
    const next = Math.max(0, Math.min(duration, currentTime + deltaFrames * frameTime));
    setCurrentTime(next);
  };

  // Timers formatting
  const currentFrame = Math.round(currentTime * fps);
  const totalFrames = Math.round(duration * fps);
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins.toString().padStart(2, '0')}:${secs.padStart(5, '0')}`;
  };

  const scrubProgress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Clean ruler seconds marks
  const rulerTicks = [0, 1.0, 2.0, 3.0, 4.0, 5.0];

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 bg-[hsl(var(--surface-0))] overflow-hidden select-none">
      {/* 1. 3D VIEWPORT CANVAS AREA (Center) */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[hsl(var(--surface-0))]">
        <MeshViewer showOverlayUI={false} className="w-full h-full" />

        {/* TOP VIEWPORT OVERLAY CONTROLS (Clean Charcoal Card styling) */}
        <div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between pointer-events-none">
          {/* Left: Perspective dropdown + snapshot + wireframe */}
          <div className="pointer-events-auto flex items-center gap-1.5 p-1 bg-[hsl(var(--surface-1)/0.95)] backdrop-blur-md border border-white/[0.08] rounded-xl shadow-xl">
            <div className="relative">
              <button
                onClick={() => setCameraDropdownOpen(!cameraDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <span>{cameraMode}</span>
                <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400" />
              </button>

              {cameraDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-32 bg-[hsl(var(--surface-2))] border border-white/[0.12] rounded-lg shadow-2xl p-1 z-30">
                  {(['Perspective', 'Front', 'Top', 'Side'] as const).map((cam) => (
                    <button
                      key={cam}
                      onClick={() => {
                        setCameraMode(cam);
                        setCameraDropdownOpen(false);
                        const mapped = cam.toLowerCase() as CameraPreset;
                        setCameraPreset(mapped);
                        window.dispatchEvent(new CustomEvent('setCameraPreset', { detail: mapped }));
                      }}
                      className={`w-full text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                        cameraMode === cam ? 'bg-primary text-black font-bold' : 'text-zinc-300 hover:bg-white/[0.06]'
                      }`}
                    >
                      {cam}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="h-3.5 w-px bg-white/10" />

            <SimpleTooltip label="Capture Viewport Snapshot">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('takeViewportSnapshot'));
                  toast.success('Snapshot Saved', { description: 'Rendered current frame to image' });
                }}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={CameraIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>

            <SimpleTooltip label="Toggle Wireframe">
              <button
                onClick={() => {
                  setShowWireframe?.(!showWireframe);
                  useViewerStore.getState().toggleWireframeOverlay();
                }}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  showWireframe
                    ? 'text-primary bg-primary/15'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <HugeiconsIcon icon={Box} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>
          </div>

          {/* Center: Auto CameraIcon + GridIcon + Skeleton + Contacts */}
          <div className="pointer-events-auto flex items-center gap-2.5 p-1 bg-[hsl(var(--surface-1)/0.95)] backdrop-blur-md border border-white/[0.08] rounded-xl shadow-xl">
            {/* Auto CameraIcon Toggle */}
            <button
              onClick={() => setAutoCamera(!autoCamera)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                autoCamera
                  ? 'bg-primary text-black font-bold shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${autoCamera ? 'bg-black' : 'bg-zinc-600'}`} />
              <span>Auto CameraIcon</span>
            </button>

            {/* Show GridIcon Checkbox */}
            <label className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-300 hover:text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={displayOptions.showGrid}
                onChange={() => toggleDisplayOption('showGrid')}
                className="rounded border-white/20 bg-[hsl(var(--surface-2))] text-primary focus:ring-0 cursor-pointer"
              />
              <span>GridIcon</span>
            </label>

            {/* Show Skeleton Checkbox */}
            <label className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-300 hover:text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={displayOptions.showSkeleton}
                onChange={() => toggleDisplayOption('showSkeleton')}
                className="rounded border-white/20 bg-[hsl(var(--surface-2))] text-primary focus:ring-0 cursor-pointer"
              />
              <span>Skeleton</span>
            </label>

            {/* Show Contacts Checkbox */}
            <label className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-300 hover:text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showContacts}
                onChange={() => setShowContacts(!showContacts)}
                className="rounded border-white/20 bg-[hsl(var(--surface-2))] text-primary focus:ring-0 cursor-pointer"
              />
              <span>Contacts</span>
            </label>
          </div>

          {/* Right: Fullscreen Toggle */}
          <div className="pointer-events-auto">
            <SimpleTooltip label="Toggle Fullscreen">
              <button
                onClick={() => {
                  if (!document.fullscreenElement) {
                    containerRef.current?.requestFullscreen?.();
                    setIsFullscreen(true);
                  } else {
                    document.exitFullscreen?.();
                    setIsFullscreen(false);
                  }
                }}
                className="p-2 rounded-xl bg-[hsl(var(--surface-1)/0.95)] backdrop-blur-md border border-white/[0.08] text-zinc-300 hover:text-white transition-all cursor-pointer shadow-xl"
              >
                <HugeiconsIcon icon={Maximize02Icon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>
          </div>
        </div>

        {/* LEFT VIEWPORT TOOL STRIP */}
        <div className="absolute left-3 top-16 z-10 flex flex-col gap-1 p-1 bg-[hsl(var(--surface-1)/0.95)] backdrop-blur-md border border-white/[0.08] rounded-xl shadow-xl">
          {[
            { id: 'select', icon: <HugeiconsIcon icon={MousePointerIcon} size={16} className="w-4 h-4" />, label: 'Select (Q)' },
            { id: 'move', icon: <HugeiconsIcon icon={MoveIcon} size={16} className="w-4 h-4" />, label: 'MoveIcon (W)' },
            { id: 'rotate', icon: <HugeiconsIcon icon={RotateCw} size={16} className="w-4 h-4" />, label: 'Rotate (E)' },
            { id: 'scale', icon: <HugeiconsIcon icon={MaximizeIcon} size={16} className="w-4 h-4" />, label: 'Scale (R)' },
          ].map((tool) => {
            const isActive = activeViewportTool === tool.id;
            return (
              <SimpleTooltip key={tool.id} side="right" label={tool.label}>
                <button
                  onClick={() => setActiveViewportTool(tool.id as ViewportGizmoTool)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                    isActive
                      ? 'border border-primary bg-primary/15 text-primary shadow-sm font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  {tool.icon}
                </button>
              </SimpleTooltip>
            );
          })}
        </div>

        {/* 3D ORIENTATION GIZMO (Top Right) */}
        <div className="absolute right-4 top-16 z-10 pointer-events-none flex flex-col items-center justify-center w-12 h-12">
          <div className="relative w-10 h-10">
            <div className="absolute bottom-1/2 left-1/2 w-4 h-0.5 bg-red-500 origin-left rotate-0 flex items-center justify-end pr-0.5">
              <span className="text-[8px] font-bold text-red-400 transform -translate-y-2">X</span>
            </div>
            <div className="absolute bottom-1/2 left-1/2 w-4 h-0.5 bg-green-500 origin-left -rotate-90 flex items-center justify-end pr-0.5">
              <span className="text-[8px] font-bold text-green-400 transform translate-x-2">Y</span>
            </div>
            <div className="absolute bottom-1/2 left-1/2 w-4 h-0.5 bg-blue-500 origin-left rotate-135 flex items-center justify-end pr-0.5">
              <span className="text-[8px] font-bold text-blue-400 transform translate-y-2">Z</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. REFINED & UNCLUTTERED COMPACT TIMELINE */}
      <div className="h-[148px] bg-[hsl(var(--surface-1))] border-t border-white/[0.08] flex flex-col flex-shrink-0 z-20">
        {/* Timeline Top Bar (Transport Controls + Timers + FPS) */}
        <div className="h-10 px-4 bg-[hsl(var(--surface-2))] border-b border-white/[0.08] flex items-center justify-between">
          {/* Left: Timeline Tabs */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 mr-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-xs font-bold text-white tracking-wide">Timeline</span>
            </div>

            <div className="flex items-center gap-1 bg-[hsl(var(--surface-0))] p-0.5 rounded-lg border border-white/[0.08]">
              {(['edit', 'playback', 'keyframes'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setTimelineTab(tab)}
                  className={`px-3 py-0.5 rounded-md text-[11px] font-semibold capitalize transition-all cursor-pointer ${
                    timelineTab === tab
                      ? 'bg-primary text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Center: Transport Controls + ClockIcon / Frame Counters */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentTime(0)}
                className="p-1 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Skip to start"
              >
                <HugeiconsIcon icon={SkipBackIcon} size={16} className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => stepFrame(-1)}
                className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Previous frame"
              >
                <span className="text-xs font-mono font-bold">&laquo;</span>
              </button>
              <button
                onClick={togglePlay}
                className="w-7 h-7 rounded-full bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] flex items-center justify-center font-black shadow-[0_0_14px_rgba(255,204,0,0.45)] transition-transform active:scale-95 cursor-pointer mx-1"
                title={isPlaying ? 'PauseIcon' : 'PlayIcon'}
              >
                {isPlaying ? <HugeiconsIcon icon={PauseIcon} size={16} className="w-3.5 h-3.5 fill-current" /> : <HugeiconsIcon icon={PlayIcon} size={16} className="w-3.5 h-3.5 fill-current ml-0.5" />}
              </button>
              <button
                onClick={() => stepFrame(1)}
                className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Next frame"
              >
                <span className="text-xs font-mono font-bold">&raquo;</span>
              </button>
              <button
                onClick={() => setCurrentTime(duration)}
                className="p-1 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Skip to end"
              >
                <HugeiconsIcon icon={SkipForwardIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Timers */}
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="text-white font-semibold">
                {formatTime(currentTime)} <span className="text-zinc-500">/</span> {formatTime(duration)}
              </span>
              <span className="text-zinc-400">
                Frame <span className="text-primary font-bold">{currentFrame}</span> / {totalFrames}
              </span>
            </div>
          </div>

          {/* Right: FPS selector & Zoom */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setFpsDropdownOpen(!fpsDropdownOpen)}
                className="flex items-center gap-1 text-[11px] font-semibold text-zinc-200 hover:text-white px-2.5 py-1 rounded-md bg-[hsl(var(--surface-0))] border border-white/[0.08] cursor-pointer"
              >
                <span>{fps} FPS</span>
                <HugeiconsIcon icon={ChevronDown} size={16} className="w-3 h-3 text-zinc-400" />
              </button>
              {fpsDropdownOpen && (
                <div className="absolute right-0 bottom-full mb-1 w-20 bg-[hsl(var(--surface-2))] border border-white/[0.12] rounded-lg shadow-xl p-1 z-30">
                  {[20, 24, 30, 60].map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setFps(f);
                        setFpsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2 py-0.5 rounded text-xs transition-colors ${
                        fps === f ? 'bg-primary text-black font-bold' : 'text-zinc-300 hover:bg-white/[0.06]'
                      }`}
                    >
                      {f} FPS
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-zinc-400">
              <HugeiconsIcon icon={ZoomOutIcon} size={16} className="w-3.5 h-3.5" />
              <input type="range" min="1" max="4" defaultValue="1" className="w-14 accent-primary h-1 bg-white/20 rounded cursor-pointer" />
              <HugeiconsIcon icon={ZoomInIcon} size={16} className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* Clean, Readable Dual-Track Inspection Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Track Names */}
          <div className="w-44 flex-shrink-0 border-r border-white/[0.08] bg-[hsl(var(--surface-1))] flex flex-col justify-between py-1 text-xs text-zinc-400 font-medium">
            <div className="h-5 px-3 flex items-center text-[10px] text-zinc-500 uppercase tracking-wider font-mono">
              Tracks
            </div>
            {/* Track 1 label */}
            <div className="h-11 px-3 flex items-center justify-between text-zinc-200 font-semibold">
              <span className="truncate">Generated Motion</span>
              <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">ARDY</span>
            </div>
            {/* Track 2 label */}
            <div className="h-8 px-3 flex items-center justify-between text-zinc-300 text-[11px]">
              <span className="truncate">Keyframes &amp; Poses</span>
              <span className="text-[9px] text-zinc-500 font-mono">3 Poses</span>
            </div>
          </div>

          {/* Right Track Canvas & Ruler */}
          <div
            ref={timelineRef}
            onMouseDown={handleTimelineMouseDown}
            className="flex-1 relative overflow-hidden bg-[hsl(var(--surface-0))] cursor-crosshair flex flex-col justify-between py-1 px-2"
          >
            {/* Top Seconds Ruler */}
            <div className="h-5 border-b border-white/[0.08] relative">
              {rulerTicks.map((tick) => {
                const percent = (tick / 5.0) * 100;
                return (
                  <div
                    key={tick}
                    style={{ left: `${percent}%` }}
                    className="absolute top-0 bottom-0 flex flex-col items-start -translate-x-1/2 pointer-events-none"
                  >
                    <span className="text-[9px] font-mono text-zinc-400 font-semibold">{tick}s</span>
                    <div className="w-px h-1.5 bg-white/20 mt-auto" />
                  </div>
                );
              })}
            </div>

            {/* Track 1: Clean, Spacious Motion Clip Bar */}
            <div className="h-11 relative flex items-center">
              <div className="w-full h-8 rounded-lg bg-gradient-to-r from-primary/20 via-[hsl(var(--surface-2))] to-[hsl(var(--surface-2)/0.8)] border border-primary/40 relative overflow-hidden flex items-center justify-between px-3 shadow-md">
                <div className="flex items-center gap-2 truncate">
                  <HugeiconsIcon icon={PlayIcon} size={16} className="w-3 h-3 text-primary fill-current flex-shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {motionAiPrompt || 'A character walks forward, looks around, then runs and jumps, landing smoothly.'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-primary flex-shrink-0 bg-black/40 px-2 py-0.5 rounded">
                  <span>{duration.toFixed(1)}s</span>
                  <span className="text-zinc-500">•</span>
                  <span>{fps} FPS</span>
                </div>
              </div>
            </div>

            {/* Track 2: Clean Keyframe Markers (No tangled web!) */}
            <div className="h-8 relative flex items-center border-t border-white/[0.08]">
              <div className="w-full h-px bg-white/[0.08] relative">
                {/* Clean, well-spaced Keyframe Diamonds */}
                {[
                  { pct: 0, label: 'Start Pose', color: 'bg-amber-400' },
                  { pct: 25, label: 'Walk Stride', color: 'bg-sky-400' },
                  { pct: 50, label: 'Look Around', color: 'bg-purple-400' },
                  { pct: 75, label: 'Jump Apex', color: 'bg-emerald-400' },
                  { pct: 100, label: 'Smooth Land', color: 'bg-amber-400' },
                ].map((marker, idx) => (
                  <div
                    key={idx}
                    style={{ left: `${marker.pct}%` }}
                    className={`absolute -top-1.5 w-3 h-3 ${marker.color} rotate-45 transform -translate-x-1/2 shadow-[0_0_6px_rgba(255,204,0,0.5)] cursor-pointer hover:scale-125 transition-transform`}
                    title={`${marker.label} (${((marker.pct / 100) * duration).toFixed(1)}s)`}
                  />
                ))}
              </div>
            </div>

            {/* SCRUBBER PLAYHEAD (Yellow vertical line with smooth triangular needle) */}
            <div
              style={{ left: `${scrubProgress}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-primary z-20 pointer-events-none transform -translate-x-1/2 shadow-[0_0_8px_rgba(255,204,0,0.9)]"
            >
              <div className="w-3.5 h-3 bg-primary rounded-b-xs shadow-md -translate-x-[6px] flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-black" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
