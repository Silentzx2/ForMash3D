'use client';

import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSearch, LoaderCircle, Wrench } from 'lucide-react';
import { useWorkspace } from '../store/WorkspaceContext';
import {
  autoRetopo,
  autoUv,
  inspectMesh,
  optimizeMesh,
  repairMesh,
  DEFAULT_AUTO_UV_OPTIONS,
  DEFAULT_INSPECT_OPTIONS,
  DEFAULT_SIMPLIFY_OPTIONS,
} from '@/features/utils/meshTools';

type ToolProgress = { message?: string; frac?: number; stage?: string; type?: string };
type TransformResult = { blob: Blob; stats?: unknown; previewUrl?: string | null };
type Transform = (
  mesh: Blob,
  fileName: string,
  onProgress: (progress: ToolProgress) => void,
) => Promise<TransformResult>;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function displayStats(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const MeshToolsPanel: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const [running, setRunning] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [inspection, setInspection] = useState<Record<string, any> | null>(null);
  const [lastResult, setLastResult] = useState<{ operation: string; fileName: string; stats: unknown } | null>(null);

  const sourceUrl = currentAsset?.source?.viewUrl || currentAsset?.source?.localUrl || currentAsset?.artifacts?.source || currentAsset?.artifacts?.gameReady;
  const sourceName = currentAsset?.source?.filename || `${currentAsset?.name || 'mesh'}.glb`;
  const canRun = Boolean(
    sourceUrl &&
    currentAsset &&
    currentAsset.category !== 'texture' &&
    !['IMAGE'].includes(currentAsset.format) &&
    ['GLB', 'GLTF', 'OBJ', 'PLY', 'FBX', 'STL', 'FILE'].includes(currentAsset.format)
  );
  const summary = useMemo(() => inspection?.summary && typeof inspection.summary === 'object'
    ? inspection.summary
    : null, [inspection]);

  const readSource = async () => {
    if (!sourceUrl) throw new Error('The selected asset has no downloadable mesh source.');
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Could not load the selected mesh (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('The selected mesh is empty.');
    return blob;
  };

  const runTransform = async (operation: string, suffix: string, transform: Transform) => {
    if (!canRun || running) return;
    setRunning(operation);
    setStage('Loading selected mesh…');
    setProgress(0);
    setMessage('');
    setError('');
    setInspection(null);
    setLastResult(null);
    try {
      const input = await readSource();
      const result = await transform(input, sourceName, (event) => {
        if (event.message) setStage(event.message);
        if (typeof event.frac === 'number') setProgress(Math.max(0, Math.min(99, Math.round(event.frac * 100))));
      });
      if (!(result?.blob instanceof Blob) || result.blob.size === 0) {
        throw new Error('The backend completed without returning a mesh file.');
      }
      const base = (currentAsset?.name || 'mesh').replace(/[^a-z0-9_-]+/gi, '_');
      const outputName = `${base}_${suffix}.glb`;
      downloadBlob(result.blob, outputName);
      setLastResult({ operation, fileName: outputName, stats: result.stats ?? null });
      setProgress(100);
      setStage('Complete');
      setMessage(`${operation} completed. Downloaded ${outputName}; the original asset was not overwritten.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('');
    } finally {
      setRunning(null);
    }
  };

  const runInspection = async () => {
    if (!canRun || running) return;
    setRunning('Inspect');
    setStage('Analyzing mesh…');
    setProgress(20);
    setMessage('');
    setError('');
    setLastResult(null);
    try {
      const input = await readSource();
      const report = await inspectMesh(input, { options: DEFAULT_INSPECT_OPTIONS, fileName: sourceName });
      setInspection(report && typeof report === 'object' ? report : { result: report });
      setProgress(100);
      setStage('Complete');
      setMessage('Inspection completed. This check does not modify the mesh.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('');
    } finally {
      setRunning(null);
    }
  };

  const buttons: Array<{ label: string; description: string; action: () => void }> = [
    { label: 'Inspect mesh', description: 'Check topology, UVs, pivots and game-ready budgets.', action: () => void runInspection() },
    { label: 'Optimize', description: 'Reduce geometry while preserving the source asset.', action: () => void runTransform('Optimize', 'optimized', (mesh, fileName, onProgress) => optimizeMesh(mesh, { options: DEFAULT_SIMPLIFY_OPTIONS, fileName, onProgress: onProgress as any })) },
    { label: 'Auto UV', description: 'Generate UV coordinates for the selected mesh.', action: () => void runTransform('Auto UV', 'uv', (mesh, fileName, onProgress) => autoUv(mesh, { options: DEFAULT_AUTO_UV_OPTIONS, fileName, onProgress })) },
    { label: 'Auto retopology', description: 'Rebuild topology using the backend retopology pipeline.', action: () => void runTransform('Auto retopology', 'retopologized', (mesh, fileName, onProgress) => autoRetopo(mesh, { fileName, onProgress: onProgress as any })) },
    { label: 'Repair mesh', description: 'Attempt backend topology and non-manifold repair.', action: () => void runTransform('Repair', 'repaired', (mesh, fileName, onProgress) => repairMesh(mesh, { fileName, onProgress })) },
  ];

  return (
    <section id="panel-mesh-tools" className="flex h-full flex-col overflow-y-auto bg-[hsl(var(--surface-1))] px-3 py-4 text-xs text-zinc-200">
      <header className="mb-4 space-y-1.5 pr-7">
        <div className="flex items-center gap-2 text-primary">
          <Wrench className="h-4 w-4" aria-hidden="true" />
          <h2 className="text-sm font-bold">Mesh Tools</h2>
        </div>
        <p className="leading-relaxed text-zinc-400">
          Run supported backend mesh operations on the selected asset. Every transform is downloaded as a new GLB; the source remains unchanged.
        </p>
      </header>

      <div className="mb-3 rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-2))] p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Selected asset</div>
        <div className="mt-1 truncate text-sm font-semibold text-white">{currentAsset?.name || 'No asset selected'}</div>
        <div className="mt-1 text-[10px] text-zinc-400">
          {canRun ? `${currentAsset?.format} · ${currentAsset?.statsAvailable ? `${currentAsset.faces.toLocaleString()} faces` : 'face count unavailable'}` : 'Select a supported 3D mesh from Assets or the viewport.'}
        </div>
      </div>

      <div className="space-y-2">
        {buttons.map((button) => (
          <div key={button.label} className="rounded-xl border border-white/[0.08] bg-[hsl(var(--surface-0))] p-3">
            <div className="mb-2">
              <div className="font-semibold text-zinc-100">{button.label}</div>
              <p className="mt-1 leading-relaxed text-zinc-400">{button.description}</p>
            </div>
            <button
              type="button"
              onClick={button.action}
              disabled={!canRun || running !== null}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running === button.label || (button.label === 'Inspect mesh' && running === 'Inspect') || (button.label === 'Repair mesh' && running === 'Repair')
                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                : button.label === 'Inspect mesh' ? <FileSearch className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {running === 'Inspect' && button.label === 'Inspect mesh' ? 'Inspecting…' : (running === button.label || (running === 'Repair' && button.label === 'Repair mesh')) ? 'Working…' : button.label}
            </button>
          </div>
        ))}
      </div>

      {running && (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white">{running}</span>
            <span className="font-mono text-primary">{progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          {stage && <p className="mt-2 text-zinc-400">{stage}</p>}
        </div>
      )}

      {message && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 leading-relaxed text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{message}</span>
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 leading-relaxed text-rose-300" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
        </p>
      )}

      {summary && (
        <div className="mt-3 rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-3">
          <h3 className="font-bold text-white">Inspection summary</h3>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['pass', 'warn', 'fail'] as const).map((key) => (
              <div key={key} className="rounded-lg bg-white/[0.04] p-2 text-center">
                <div className={key === 'pass' ? 'text-emerald-300' : key === 'warn' ? 'text-amber-300' : 'text-rose-300'}>{String(summary[key] ?? 0)}</div>
                <div className="mt-1 text-[9px] uppercase text-zinc-500">{key}</div>
              </div>
            ))}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-zinc-400 hover:text-white">View full report</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-2 text-[10px]">{displayStats(inspection)}</pre>
          </details>
        </div>
      )}

      {lastResult && (
        <details className="mt-3 rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-0))] p-3">
          <summary className="cursor-pointer font-semibold text-white">Last result: {lastResult.fileName}</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-2 text-[10px]">{displayStats(lastResult.stats)}</pre>
        </details>
      )}
    </section>
  );
};
