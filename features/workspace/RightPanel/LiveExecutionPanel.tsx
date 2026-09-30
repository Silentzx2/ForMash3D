import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  StopCircle,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RotateCcw,
  Cpu,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Box,
  Terminal,
  Layers,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { useWorkspace } from '../store/WorkspaceContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface PipelineStep {
  id: string;
  name: string;
  state: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  skipReason?: string;
  detail?: string;
}

export const LiveExecutionPanel: React.FC = () => {
  const {
    activeTask,
    isExecuting,
    cancelExecution,
    systemStats,
    generationSettings,
    setGenerationSettings,
    generate3DModel,
    setActiveTool,
    currentAsset,
    setRightPanelMode,
    remeshSettings,
    setMainNav,
  } = useWorkspace();

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const [expandedStageId, setExpandedStageId] = useState<string | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handleCopyLogs = async () => {
    const text = (activeTask?.logs || []).map(l => `[${l.level || 'info'}] ${l.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  // Timer tracking
  useEffect(() => {
    if (!activeTask?.startedAt || !isExecuting) return;
    setElapsedSeconds(Math.floor((Date.now() - activeTask.startedAt) / 1000));
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - activeTask.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTask?.startedAt, isExecuting]);

  const logs = activeTask?.logs || [];
  const latestLog = logs[logs.length - 1];

  // Keep the console pinned only when the user is already near the bottom.
  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container || logs.length === 0) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 96) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs.length]);

  if (!activeTask && !isExecuting) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center text-zinc-400 bg-[hsl(var(--surface-1))] select-none">
        <div className="w-10 h-10 rounded-xl bg-[#1B1E24] border border-white/[0.08] flex items-center justify-center text-zinc-500 mb-2">
          <Clock className="w-5 h-5 stroke-[1.5]" />
        </div>
        <div className="text-xs font-semibold text-white">No Active Generation</div>
        <p className="text-[11px] text-zinc-400 mt-1 max-w-[200px]">
          Start a 3D generation or post-processing job to inspect the live execution pipeline.
        </p>
      </div>
    );
  }

  const isCompleted = activeTask?.status === 'completed';
  const isFailed = activeTask?.status === 'failed' || activeTask?.status === 'interrupted';
  const isRunning = isExecuting || activeTask?.status === 'running' || activeTask?.status === 'queued';

  // Active parameters
  const modelName = activeTask?.provider || generationSettings.aiModel || 'Generative Engine';
  const progress = activeTask?.progress ?? 0;
  const stageName = (activeTask?.stage || '').toLowerCase();


  const isRemesh = activeTask?.type === 'remesh';
  const stageNameMap: Record<string, string> = {
    loading_model: 'synthesis',
    generating: 'synthesis',
    postprocess: 'master',
    inspect: 'master',
    repair: 'repair',
    optimize: 'optimize',
    uv: 'uv',
    game_ready: 'game_ready',
    fbx: 'game_ready',
    lod: 'lod',
    collision: 'collision',
    preview: 'qa',
    qa: 'qa',
    completed: 'qa',
    failed: 'qa',
  };

  const pipelineStages: Omit<PipelineStep, 'state'>[] = isRemesh
    ? [
        {
          id: 'synthesis',
          name: 'Source Mesh Ingestion & Preflight',
          detail: `FastMesh ${remeshSettings.variant} ${remeshSettings.polyType.toUpperCase()} retopology`,
        },
      ]
    : [
        {
          id: 'synthesis',
          name: 'AI Geometry Synthesis',
          detail:
            activeTask?.type === 'image-to-3d'
              ? `${modelName} — image preflight and GPU geometry synthesis`
              : `${modelName} — text embedding and GPU mesh synthesis`,
        },
        {
          id: 'master',
          name: 'Canonical Master Asset',
          detail: 'Persist immutable master/source.glb before any downstream processing.',
        },
        {
          id: 'repair',
          name: 'Topology Repair',
          detail: 'Weld, de-duplicate, remove invalid topology and close small holes.',
        },
        {
          id: 'optimize',
          name: 'Geometry Optimization',
          detail: 'Reduce untextured outputs to the configured game-ready triangle budget.',
        },
        {
          id: 'uv',
          name: 'UV Preparation',
          detail: 'Preserve native textured UVs or generate production UVs for raw meshes.',
        },
        {
          id: 'game_ready',
          name: 'Game-Ready Export',
          detail: 'Write the canonical GLB/OBJ/STL/PLY and best-effort FBX/GLTF artifacts.',
        },
        {
          id: 'lod',
          name: 'LOD Generation',
          detail: 'Generate LOD0–LOD3 from the canonical processed mesh.',
        },
        {
          id: 'collision',
          name: 'Collision',
          detail: 'Generate the runtime collision proxy and optional physics metadata.',
        },
        {
          id: 'qa',
          name: 'Preview & QA',
          detail: 'Generate preview artifacts and run final game-ready inspection.',
        },
      ];

  const currentStageIndex = stageNameMap[stageName]
    ? pipelineStages.findIndex(stage => stage.id === stageNameMap[stageName])
    : progress >= 100
      ? pipelineStages.length - 1
      : 0;

  const completedStageCount = pipelineStages.filter((stage, index) => {
    if (isCompleted || progress >= 100) return true;
    return index < currentStageIndex;
  }).length;
  const currentStage = pipelineStages[currentStageIndex] || pipelineStages[0];
  const etaSec = activeTask?.estimatedRemainingSec;
  const etaLabel = etaSec == null
    ? 'Estimating…'
    : etaSec < 60
      ? '~' + etaSec + 's left'
      : '~' + Math.ceil(etaSec / 60) + 'm left';

  const getStepState = (index: number): PipelineStep['state'] => {
    if (isFailed) {
      if (index < currentStageIndex) return 'completed';
      if (index === currentStageIndex) return 'failed';
      return 'pending';
    }
    if (isCompleted || progress >= 100) return 'completed';
    if (index < currentStageIndex) return 'completed';
    if (index === currentStageIndex) return 'active';
    return 'pending';
  };

  const stages: PipelineStep[] = pipelineStages.map((stage, index) => ({
    ...stage,
    state: getStepState(index),
    detail: index === currentStageIndex && activeTask?.currentStep
      ? activeTask.currentStep
      : stage.detail,
  }));

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
      {/* Header Bar */}
      <div className="px-3 py-2.5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0 bg-[hsl(var(--surface-1))]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="font-bold text-xs text-white">Pipeline Execution</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span className="flex items-center">
              <span>{String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}</span>
              <span>:</span>
              <span>{String(elapsedSeconds % 60).padStart(2, '0')}</span>
            </span>
          </span>
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
            isCompleted
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : isFailed
              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
              : 'bg-primary/15 text-primary border border-primary/30 animate-pulse'
          }`}>
            {activeTask?.status || (isExecuting ? 'Running' : 'Idle')}
          </span>
          <button
            type="button"
            onClick={() => setMainNav('jobs')}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Inspect Full Run in Job Details"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Execution Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin scrollbar-thumb-zinc-700/60 scrollbar-track-transparent">
        {/* Real Current Step Banner */}
        <div className="p-2.5 rounded-xl bg-[#1B1E24] border border-white/[0.08] space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Current Task</div>
            <span className="text-[10px] font-mono font-bold text-primary">{progress}%</span>
          </div>
          <div className="text-xs font-bold text-white leading-snug">
            {activeTask?.title || '3D Asset Generation'}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="px-1.5 py-0.5 rounded border border-primary/25 bg-primary/10 text-primary text-[8px] font-bold uppercase tracking-wider">
              {currentStage?.name || 'Execution'}
            </span>
            <span className="text-[9px] text-zinc-500 font-mono">
              {completedStageCount}/{pipelineStages.length} stages complete
            </span>
          </div>
          <div className="text-[10px] text-zinc-300 font-mono mt-1 break-words">
            {latestLog?.message || activeTask?.currentStep || (isRunning ? 'Executing inference graph...' : isCompleted ? 'Generation complete' : 'Ready')}
          </div>
          <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono mt-1.5">
            <span>Live backend telemetry</span>
            <span>{isCompleted ? 'Ready' : isFailed ? 'Stopped' : etaLabel}</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-white/[0.06] rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isCompleted
                  ? 'bg-emerald-400'
                  : isFailed
                  ? 'bg-rose-500'
                  : 'bg-primary'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>

        {/* Hardware Status Note */}
        <div className="p-2 rounded-lg bg-[#181B20] border border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-zinc-500" />
            <span>{systemStats.gpu || 'GPU Accelerated'}</span>
          </span>
          {systemStats.vramUsedGb != null ? (
            <div className="flex items-center gap-1 font-mono text-zinc-300">
              <span>{systemStats.vramUsedGb != null ? systemStats.vramUsedGb.toFixed(1) : '—'}</span>
              <span>/ {systemStats.vramTotalGb?.toFixed(1) || '8'} GB VRAM</span>
            </div>
          ) : (
            <span>Active</span>
          )}
        </div>

        {/* Pipeline Stages Dependency List */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Pipeline Stages ({stages.filter(s => s.state === 'completed').length} / {stages.length})
            </span>
            <span className="text-[9px] font-mono text-zinc-500">
              Backend telemetry · live stage state
            </span>
          </div>

          <div className="space-y-1 rounded-xl bg-[#181B20] border border-white/[0.08] p-2">
            {stages.map((stage) => {
              const isStageActive = stage.state === 'active';
              const isStageDone = stage.state === 'completed';
              const isStageFailed = stage.state === 'failed';
              const isStageSkipped = stage.state === 'skipped';
              const isExpanded = isStageActive || expandedStageId === stage.id || isStageFailed;
              const hasContent = Boolean(stage.detail || stage.skipReason);

              return (
                <div
                  key={stage.id}
                  onClick={() => {
                    if (hasContent) {
                      setExpandedStageId(expandedStageId === stage.id ? null : stage.id);
                    }
                  }}
                  className={`p-2 rounded-lg border transition-all ${
                    hasContent ? 'cursor-pointer' : ''
                  } ${
                    isStageActive
                      ? 'bg-[hsl(var(--surface-2))] border-primary/40 shadow-sm'
                      : isStageDone
                      ? 'bg-transparent border-transparent text-zinc-300 hover:bg-white/[0.02]'
                      : isStageFailed
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      : isStageSkipped
                      ? 'bg-transparent border-transparent opacity-50 text-zinc-500'
                      : 'bg-transparent border-transparent text-zinc-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* State glyph */}
                      <span className="flex-shrink-0 font-mono text-xs">
                        {isStageDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        {isStageActive && (
                          <span className="relative flex h-2.5 w-2.5 mx-0.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                          </span>
                        )}
                        {isStageFailed && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                        {isStageSkipped && <span className="text-zinc-600 font-bold px-0.5">—</span>}
                        {stage.state === 'pending' && <span className="text-zinc-600">○</span>}
                      </span>

                      <span className={`text-[11px] font-semibold truncate ${
                        isStageActive ? 'text-primary font-bold' : isStageDone ? 'text-zinc-200' : isStageFailed ? 'text-rose-300' : 'text-zinc-400'
                      }`}>
                        {stage.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[9px] font-mono text-zinc-500 uppercase">
                        {stage.state}
                      </span>
                      {hasContent && (
                        <ChevronRight className={cn(
                          'w-3 h-3 text-zinc-500 transition-transform duration-200',
                          isExpanded && 'rotate-90 text-primary'
                        )} />
                      )}
                    </div>
                  </div>

                  {/* Stage detail or skip explanation with accordion animation */}
                  <AnimatePresence>
                    {isExpanded && (stage.skipReason || stage.detail) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        {isStageSkipped && stage.skipReason && (
                          <div className="text-[9px] text-zinc-500 pl-5 pt-1 italic">
                            Skipped: {stage.skipReason}
                          </div>
                        )}
                        {stage.detail && (
                          <div className="text-[9px] text-zinc-300 pl-5 pt-1 font-mono">
                            {stage.detail}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Execution Logs Console */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Live Execution Logs
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyLogs}
                disabled={logs.length === 0}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40"
                title="Copy logs"
              >
                {logsCopied ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Copied</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </span>
                )}
              </button>
              <span className="text-[9px] font-mono text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06] flex items-center gap-1">
                <span>{logs.length}</span> <span>entries</span>
              </span>
            </div>
          </div>

          <div ref={logsContainerRef} className="rounded-xl bg-black/60 border border-white/[0.08] p-2.5 max-h-44 overflow-y-auto font-mono text-[10px] space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent select-text">
            {logs.length === 0 ? (
              <div className="text-zinc-500 italic py-3 text-center text-[10px]">
                Awaiting telemetry logs from worker...
              </div>
            ) : (
              logs.map((log, idx) => {
                const timeStr = log.timestamp
                  ? new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : '';
                const isSuccess = log.level === 'success';
                const isWarn = log.level === 'warning' || log.level === 'warn';
                const isError = log.level === 'error';
                return (
                  <div key={idx} className="flex items-start gap-1.5 leading-tight">
                    {timeStr && (
                      <span className="text-zinc-600 flex-shrink-0 text-[9px] select-none">
                        {timeStr}
                      </span>
                    )}
                    <span
                      className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded flex-shrink-0 select-none leading-none ${
                        isSuccess
                          ? 'text-emerald-400 bg-emerald-500/15'
                          : isError
                          ? 'text-rose-400 bg-rose-500/15'
                          : isWarn
                          ? 'text-amber-400 bg-amber-500/15'
                          : 'text-sky-400 bg-sky-500/15'
                      }`}
                    >
                      {log.level || 'info'}
                    </span>
                    <span
                      className={`break-words ${
                        isSuccess
                          ? 'text-emerald-300'
                          : isError
                          ? 'text-rose-300'
                          : isWarn
                          ? 'text-amber-300'
                          : 'text-zinc-300'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Actionable Error Card */}
        {isFailed && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2 text-rose-300">
            <div className="flex items-center gap-1.5 font-bold text-xs text-rose-200">
              <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>Generation Failed</span>
            </div>
            
            <p className="text-[11px] text-rose-300/90 leading-relaxed">
              {activeTask?.diagnostic?.issueDescription || activeTask?.errorMessage || 'The generation job encountered an unrecoverable runtime error.'}
            </p>

            {/* Hardware-specific Actionable Fix */}
            <div className="pt-1 flex flex-col gap-1.5">
              {!generationSettings.lowVram && (
                <button
                  type="button"
                  onClick={() => {
                    setGenerationSettings(prev => ({ ...prev, lowVram: true }));
                    void generate3DModel();
                  }}
                  className="w-full py-1.5 px-2 rounded-lg bg-primary text-black font-bold text-[10px] hover:bg-[hsl(var(--primary)/0.9)] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Enable Low VRAM Mode (&lt;8GB) &amp; Retry</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void generate3DModel()}
                className="w-full py-1.5 px-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold text-[10px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry Generation</span>
              </button>
            </div>

            {/* Expandable Technical Diagnostic */}
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="text-[9px] text-zinc-400 hover:text-white flex items-center gap-1 pt-1 cursor-pointer"
            >
              <span>Technical Diagnostics</span>
              {showDiagnostics ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            {showDiagnostics && (
              <pre className="mt-1 p-2 rounded-lg bg-black/40 border border-white/[0.08] text-[9px] font-mono text-zinc-400 overflow-x-auto whitespace-pre-wrap max-h-36">
                {activeTask?.errorMessage || activeTask?.diagnostic?.issueDescription || 'No diagnostic trace available'}
              </pre>
            )}
          </div>
        )}

        {/* Completion Success Card */}
        {isCompleted && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 text-emerald-300">
            <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>3D Asset Ready in Viewport</span>
            </div>
            <p className="text-[11px] text-emerald-300/90 leading-relaxed">
              The backend pipeline completed successfully and the production asset is ready for inspection/export.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {[
                ['Master', Boolean(currentAsset?.artifacts?.source)],
                ['Game Ready', Boolean(currentAsset?.artifacts?.gameReady)],
                ['LOD', Boolean(currentAsset?.artifacts?.lods?.length)],
                ['Collision', Boolean(currentAsset?.artifacts?.collision)],
                ['QA', Boolean(currentAsset?.qaScore ?? currentAsset?.artifacts?.qaReport)],
              ].map(([label, ready]) => (
                <span key={String(label)} className={ready ? 'px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-wider border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-wider border-white/[0.06] bg-white/[0.03] text-zinc-500'}>
                  {String(label)} {ready ? 'ready' : '—'}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setRightPanelMode('properties')}
                className="py-1.5 px-2 rounded-lg bg-emerald-500 text-black font-bold text-[10px] hover:bg-emerald-400 transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <Box className="w-3 h-3" />
                <span>Inspect Properties</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTool('texture');
                  setRightPanelMode('properties');
                }}
                className="py-1.5 px-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold text-[10px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>Bake Textures</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Primary Action Bar during Running */}
      {isRunning && (
        <div className="p-2.5 border-t border-white/[0.08] bg-[hsl(var(--surface-1))]">
          <button
            type="button"
            onClick={cancelExecution}
            className="w-full h-9 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
          >
            <StopCircle className="w-4 h-4 text-rose-400" />
            <span>Cancel Generation</span>
          </button>
        </div>
      )}
    </div>
  );
};
