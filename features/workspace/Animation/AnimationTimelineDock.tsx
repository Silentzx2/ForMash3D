'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useAnimationStore, AnimationStudioMode } from '@/stores/useAnimationStore';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ChevronDown,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
} from '@hugeicons/core-free-icons';

export const AnimationTimelineDock: React.FC = () => {
  const timelineRef = useRef<HTMLDivElement>(null);

  const {
    activeMode,
    setActiveMode,
    isPlaying,
    togglePlay,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    fps,
    setFps,
    isLooping,
    setIsLooping,
    motionAiPrompt,
    setMotionAiPrompt,
    setIsMotionLibraryOpen,
  } = useAnimationStore();

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [fpsDropdownOpen, setFpsDropdownOpen] = useState(false);
  const [presetsDropdownOpen, setPresetsDropdownOpen] = useState(false);
  const [timelineTab, setTimelineTab] = useState<'edit' | 'playback' | 'keyframes'>('edit');

  // Presets
  const presets = [
    { label: 'Walk Forward & Jump', prompt: 'A character walks forward with confident strides, pauses, then jumps high and lands cleanly.' },
    { label: 'Athletic Run Cycle', prompt: 'A character performs a dynamic athletic sprint forward with natural arm swings.' },
    { label: 'Combat Ready Idle', prompt: 'A warrior in a grounded combat stance shifts weight smoothly, breathing steadily.' },
    { label: 'Friendly Wave & Greet', prompt: 'A character stops in place, smiles, raises right hand and waves enthusiastically.' },
    { label: 'Sneak & Turn Corner', prompt: 'A character sneaks slowly, checking left and right, then turns 90 degrees around a corner.' },
  ];

  const handleSelectPreset = (p: typeof presets[0]) => {
    setMotionAiPrompt(p.prompt);
    setPresetsDropdownOpen(false);
    toast.success(`Preset loaded: "${p.label}"`);
  };

  const modePills = [
    { id: 'text_to_motion', label: 'Text to Motion' },
    { id: 'editing', label: 'Motion Editing' },
    { id: 'retarget', label: 'Retarget / Apply' },
    { id: 'library', label: 'Motion Library' },
  ];

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const { currentTime, duration, isLooping } = useAnimationStore.getState();
      let next = currentTime + delta;
      if (next >= duration) {
        if (isLooping) {
          next = 0;
        } else {
          next = duration;
          setIsPlaying(false);
          return;
        }
      }
      setCurrentTime(next);
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, setCurrentTime, setIsPlaying]);

  // Handle Timeline Scrubbing
  const handleTimelineScrub = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = x / rect.width;
      const newTime = Math.max(0, Math.min(percentage * duration, duration));
      setCurrentTime(newTime);
    },
    [duration, setCurrentTime]
  );

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsScrubbing(true);
    handleTimelineScrub(e);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isScrubbing) handleTimelineScrub(e);
    };
    const handleMouseUp = () => {
      if (isScrubbing) setIsScrubbing(false);
    };

    if (isScrubbing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, handleTimelineScrub]);

  const stepFrame = (direction: -1 | 1) => {
    const frameDuration = 1 / fps;
    const next = Math.max(0, Math.min(duration, currentTime + direction * frameDuration));
    setCurrentTime(next);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const currentFrame = Math.floor(currentTime * fps);
  const totalFrames = Math.floor(duration * fps);

  // Ruler ticks (every 1 second)
  const rulerTicks: number[] = [];
  for (let i = 0; i <= Math.ceil(duration); i++) {
    rulerTicks.push(i);
  }

  return (
    <div
      id="animation-timeline-dock"
      className="w-full bg-[hsl(var(--surface-1))]/95 backdrop-blur-md border-t border-white/[0.08] shadow-[0_-8px_32px_rgba(0,0,0,0.5)] flex flex-col flex-shrink-0 z-20 select-none overflow-hidden"
    >
      {/* Top Studio Controls Bar: Modes, Model Badge, Presets, Transport Controls, FPS */}
      <div className="h-10 px-3 bg-[hsl(var(--surface-2))] border-b border-white/[0.08] flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        {/* Left: Mode Switcher Pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1 bg-[hsl(var(--surface-0))] p-0.5 rounded-lg border border-white/[0.08]">
            {modePills.map((mode) => {
              const isActive =
                activeMode === mode.id ||
                (mode.id === 'text_to_motion' && (activeMode === 'animate' || activeMode === 'motion_ai'));
              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    if (mode.id === 'library') {
                      setIsMotionLibraryOpen(true);
                    } else {
                      setActiveMode(mode.id as AnimationStudioMode);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-primary text-black font-bold shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>

          {/* Presets dropdown */}
          <div className="relative">
            <button
              onClick={() => setPresetsDropdownOpen(!presetsDropdownOpen)}
              className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--surface-0))] hover:bg-white/[0.06] border border-white/[0.08] rounded-lg text-[11px] font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={SlidersHorizontalIcon} size={14} className="w-3.5 h-3.5 text-primary" />
              <span>Presets</span>
              <HugeiconsIcon icon={ChevronDown} size={14} className="w-3 h-3 text-zinc-400" />
            </button>

            {presetsDropdownOpen && (
              <div className="absolute left-0 bottom-full mb-1 w-64 bg-[hsl(var(--surface-2))] border border-white/[0.12] rounded-xl shadow-2xl p-1.5 z-40 space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  ARDY Motion Presets
                </div>
                {presets.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectPreset(p)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-white/[0.06] transition-colors cursor-pointer text-zinc-200"
                  >
                    <p className="font-semibold text-white text-[11px]">{p.label}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{p.prompt}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Transport Controls + Timers */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-0.5">
            <SimpleTooltip label="Skip to start">
              <button
                onClick={() => setCurrentTime(0)}
                className="p-1 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={SkipBackIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>
            <SimpleTooltip label="Previous frame">
              <button
                onClick={() => stepFrame(-1)}
                className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <span className="text-xs font-mono font-bold">&laquo;</span>
              </button>
            </SimpleTooltip>
            <SimpleTooltip label={isPlaying ? 'Pause' : 'Play'}>
              <button
                onClick={togglePlay}
                className="w-7 h-7 rounded-full bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 text-[#080808] flex items-center justify-center font-black shadow-[0_0_12px_rgba(255,204,0,0.4)] transition-transform active:scale-95 cursor-pointer mx-1"
              >
                {isPlaying ? (
                  <HugeiconsIcon icon={PauseIcon} size={16} className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <HugeiconsIcon icon={PlayIcon} size={16} className="w-3.5 h-3.5 fill-current ml-0.5" />
                )}
              </button>
            </SimpleTooltip>
            <SimpleTooltip label="Next frame">
              <button
                onClick={() => stepFrame(1)}
                className="p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <span className="text-xs font-mono font-bold">&raquo;</span>
              </button>
            </SimpleTooltip>
            <SimpleTooltip label="Skip to end">
              <button
                onClick={() => setCurrentTime(duration)}
                className="p-1 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={SkipForwardIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>
            <SimpleTooltip label={isLooping ? 'Loop: Enabled' : 'Loop: Disabled'}>
              <button
                onClick={() => setIsLooping(!isLooping)}
                className={`p-1 rounded transition-colors cursor-pointer ${
                  isLooping ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <HugeiconsIcon icon={RepeatIcon} size={16} className="w-3.5 h-3.5" />
              </button>
            </SimpleTooltip>
          </div>

          {/* Time & Frame Counter */}
          <div className="flex items-center gap-2 font-mono text-xs px-2 py-0.5 rounded bg-[hsl(var(--surface-0))] border border-white/[0.08]">
            <span className="text-white font-semibold">
              {formatTime(currentTime)} <span className="text-zinc-500">/</span> {formatTime(duration)}
            </span>
            <span className="text-zinc-400 text-[11px]">
              F<span className="text-primary font-bold">{currentFrame}</span>/{totalFrames}
            </span>
          </div>
        </div>

        {/* Right: FPS Selector */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => setFpsDropdownOpen(!fpsDropdownOpen)}
              className="flex items-center gap-1 text-[11px] font-semibold text-zinc-200 hover:text-white px-2 py-1 rounded-md bg-[hsl(var(--surface-0))] border border-white/[0.08] cursor-pointer"
            >
              <span>{fps} FPS</span>
              <HugeiconsIcon icon={ChevronDown} size={14} className="w-3 h-3 text-zinc-400" />
            </button>
            {fpsDropdownOpen && (
              <div className="absolute right-0 bottom-full mb-1 w-20 bg-[hsl(var(--surface-2))] border border-white/[0.12] rounded-lg shadow-xl p-1 z-40">
                {[20, 24, 30, 60].map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setFps(f);
                      setFpsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                      fps === f ? 'bg-primary text-black font-bold' : 'text-zinc-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    {f} FPS
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrub Track Inspection Area */}
      <div className="h-16 flex overflow-hidden">
        {/* Track Label */}
        <div className="w-36 flex-shrink-0 border-r border-white/[0.08] bg-[hsl(var(--surface-1))] flex flex-col justify-center px-3 text-xs text-zinc-400">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200 truncate text-[11px]">ARDY Motion</span>
            <span className="text-[9px] font-mono text-primary bg-primary/10 px-1 py-0.2 rounded font-bold">NV</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono truncate">{duration.toFixed(1)}s • {fps}fps</span>
        </div>

        {/* Interactive Scrubbing Bar & Playhead */}
        <div
          ref={timelineRef}
          onMouseDown={handleTimelineMouseDown}
          className="flex-1 relative overflow-hidden bg-[hsl(var(--surface-0))] cursor-crosshair flex flex-col justify-between py-1 px-3"
        >
          {/* Seconds Ruler */}
          <div className="h-3.5 border-b border-white/[0.08] relative">
            {rulerTicks.map((tick) => {
              const pct = (tick / duration) * 100;
              return (
                <div
                  key={tick}
                  style={{ left: `${pct}%` }}
                  className="absolute top-0 bottom-0 flex flex-col items-start -translate-x-1/2 pointer-events-none"
                >
                  <span className="text-[8px] font-mono text-zinc-400">{tick}s</span>
                  <div className="w-px h-1 bg-white/20 mt-auto" />
                </div>
              );
            })}
          </div>

          {/* Motion Clip Track */}
          <div className="h-8 relative flex items-center">
            <div className="w-full h-6 rounded-md bg-gradient-to-r from-primary/20 via-[hsl(var(--surface-2))] to-[hsl(var(--surface-2)/0.8)] border border-primary/30 relative overflow-hidden flex items-center justify-between px-2.5 shadow-inner">
              <span className="text-[11px] font-medium text-white truncate max-w-[70%]">
                {motionAiPrompt || 'Character animation track'}
              </span>
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-primary">
                <span>{duration.toFixed(1)}s</span>
              </div>
            </div>

            {/* Red Playhead Line & Scrub Needle */}
            <div
              style={{ left: `${Math.max(0, Math.min(progressPercent, 100))}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(255,204,0,0.8)] pointer-events-none z-30"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-primary -translate-x-1/2 -translate-y-1 shadow-md border border-black" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
