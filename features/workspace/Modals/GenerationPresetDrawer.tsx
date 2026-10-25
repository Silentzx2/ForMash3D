'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import type { GenerationSettings } from '../types';
import { parseModelParameterOverrides } from '../utils/buildGenerationParameters';

const STORAGE_KEY = 'ai3d:generation:presets:v1';
const EXPORT_FORMAT = 'formash3d-generation-presets';
const OMIT_FROM_PRESET = new Set([
  'image', 'imageFileId', 'imageName', 'preprocessingArtifactId',
  'preprocessingPreviewUrl', 'preprocessingMetadata', 'modelParameterOverrides',
  'modelParameters', 'model_parameters', 'quality', 'meshQuality', 'requested_quality',
  'guidanceScale', 'guidance_scale', 'num_inference_steps', 'octree_resolution',
  'sampler_overrides', 'samplerOverrides', 'lowVram', 'vramMode',
  'maxNumView', 'resolution',
]);

type PresetSettings = Omit<Partial<GenerationSettings>,
  'image' | 'imageFileId' | 'imageName' | 'preprocessingArtifactId' |
  'preprocessingPreviewUrl' | 'preprocessingMetadata'>;

interface GenerationPreset {
  version: 1;
  id: string;
  name: string;
  revision: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  settings: PresetSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePreset(value: unknown): GenerationPreset {
  if (!isRecord(value) || value.version !== 1) throw new Error('Unsupported generation preset format/version.');
  if (typeof value.id !== 'string' || !value.id || value.id.length > 200 ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 ||
      typeof value.modelId !== 'string' || !value.modelId.trim() || value.modelId.length > 200) {
    throw new Error('Each preset needs a valid name, model ID, and identifier.');
  }
  if (!isRecord(value.settings)) throw new Error('Preset settings must be an object.');

  // Safely ignore legacy modelParameters and modelParameterOverrides on import
  const rawSettings = { ...value.settings };
  delete (rawSettings as Record<string, unknown>).modelParameterOverrides;
  delete (rawSettings as Record<string, unknown>).modelParameters;

  const filteredEntries = Object.entries(rawSettings).filter(([key]) => !OMIT_FROM_PRESET.has(key));
  const settings = parseModelParameterOverrides(Object.fromEntries(filteredEntries));

  if (settings.seed !== undefined &&
      (typeof settings.seed !== 'number' || !Number.isSafeInteger(settings.seed) || settings.seed < 0)) {
    throw new Error('Preset seed must be a non-negative safe integer.');
  }

  const now = new Date().toISOString();
  return {
    version: 1,
    id: value.id,
    name: value.name.trim(),
    modelId: value.modelId.trim(),
    revision: typeof value.revision === 'string' ? value.revision.slice(0, 100) : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt.slice(0, 50) : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt.slice(0, 50) : now,
    settings: settings as unknown as PresetSettings,
  };
}

function makePresetId(): string {
  return globalThis.crypto?.randomUUID?.() || ('preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
}

function snapshotSettings(settings: GenerationSettings): PresetSettings {
  return Object.fromEntries(Object.entries(settings).filter(([key, value]) =>
    !OMIT_FROM_PRESET.has(key) && value !== undefined
  )) as PresetSettings;
}

function readStoredPresets(): GenerationPreset[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 200) throw new Error('Saved preset library is invalid or exceeds 200 profiles.');
  return parsed.map(normalizePreset);
}

export function GenerationPresetDrawer() {
  const { generationSettings, setGenerationSettings, queueGenerationJob } = useWorkspace();
  const [presets, setPresets] = useState<GenerationPreset[]>([]);
  const [ready, setReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('Quality Recipe');
  const [revision, setRevision] = useState('1');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [queueing, setQueueing] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setPresets(readStoredPresets()); }
    catch (error) {
      setStorageBlocked(true);
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Could not read saved presets.' });
    } finally { setReady(true); }
  }, []);

  useEffect(() => {
    if (!ready || storageBlocked) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); }
    catch { setStatus({ type: 'error', message: 'Could not save presets to browser storage.' }); }
  }, [presets, ready, storageBlocked]);

  const selected = presets.find(preset => preset.id === selectedId);

  const savePreset = () => {
    if (!generationSettings.aiModel || !name.trim()) {
      setStatus({ type: 'error', message: 'Choose a model and enter a preset name first.' });
      return;
    }
    try {
      const existing = presets.find(preset => preset.id === selectedId);
      if (!existing && presets.length >= 200) throw new Error('Preset library is limited to 200 profiles.');
      const now = new Date().toISOString();
      const preset: GenerationPreset = {
        version: 1,
        id: existing?.id || makePresetId(),
        name: name.trim(),
        revision: revision.trim().slice(0, 100),
        modelId: generationSettings.aiModel,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        settings: snapshotSettings(generationSettings),
      };
      setStorageBlocked(false);
      setPresets(existing
        ? presets.map(item => item.id === existing.id ? preset : item)
        : [...presets, preset]);
      setSelectedId(preset.id);
      setStatus({ type: 'success', message: 'Saved preset "' + preset.name + '".' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Could not save preset.' });
    }
  };

  const loadSelected = () => {
    if (!selected) return;
    setGenerationSettings(prev => ({
      ...prev,
      ...selected.settings,
      aiModel: selected.modelId,
    }));
    setName(selected.name);
    setRevision(selected.revision);
    setStatus({ type: 'success', message: 'Loaded "' + selected.name + '" while keeping the current image.' });
  };

  const deleteSelected = () => {
    if (!selected || !window.confirm('Delete preset "' + selected.name + '"?')) return;
    setPresets(presets.filter(preset => preset.id !== selected.id));
    setSelectedId('');
    setStatus({ type: 'success', message: 'Deleted preset "' + selected.name + '".' });
  };

  const exportProfiles = (all: boolean) => {
    const profiles = all ? presets : selected ? [selected] : [];
    if (!profiles.length) return;
    const blob = new Blob([JSON.stringify({ format: EXPORT_FORMAT, version: 1, presets: profiles }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = all ? 'formash3d-generation-presets.json' :
      ((selected?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'generation-preset') + '.formash3d.json');
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus({ type: 'success', message: 'Exported ' + profiles.length + ' preset(s).' });
  };

  const importFile = async (file: File) => {
    if (file.size > 1_000_000) {
      setStatus({ type: 'error', message: 'Preset JSON is too large (maximum 1 MB).' });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      let values: unknown[];
      if (isRecord(parsed) && parsed.format === EXPORT_FORMAT && parsed.version === 1 && Array.isArray(parsed.presets)) {
        values = parsed.presets;
      } else if (isRecord(parsed) && parsed.version === 1 && typeof parsed.id === 'string') {
        values = [parsed];
      } else {
        throw new Error('Unsupported file. Import a ForMesh3D generation preset JSON export.');
      }
      if (values.length < 1 || values.length > 100) throw new Error('Import must contain between 1 and 100 presets.');
      if (presets.length + values.length > 200) throw new Error('Import would exceed the 200-profile library limit.');
      const imported = values.map(normalizePreset).map(preset => ({ ...preset, id: makePresetId() }));
      setStorageBlocked(false);
      setPresets([...presets, ...imported]);
      const last = imported[imported.length - 1];
      setSelectedId(last.id);
      setName(last.name);
      setRevision(last.revision);
      setStatus({ type: 'success', message: 'Imported ' + imported.length + ' preset(s). Select one and load it to apply.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'Could not import presets.' });
    }
  };

  const runCurrent = async () => {
    setQueueing(true);
    try { await queueGenerationJob({ ...generationSettings }); }
    finally { setQueueing(false); }
  };

  return (
    <details className="rounded-xl border border-white/[0.1] bg-[hsl(var(--surface-1))] group">
      <summary className="cursor-pointer list-none px-3.5 py-3 flex items-center justify-between gap-3 font-semibold text-zinc-200">
        <span>Generation Output Recipes</span><span className="text-[10px] text-zinc-500 font-normal">Presets · Seed · Output Settings</span>
      </summary>
      <div className="border-t border-white/[0.08] p-3.5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="generation-preset-select" className="text-[11px] font-semibold text-zinc-300">Saved preset</label>
            <select id="generation-preset-select" value={selectedId} onChange={event => {
              setSelectedId(event.target.value);
              const found = presets.find(preset => preset.id === event.target.value);
              if (found) { setName(found.name); setRevision(found.revision); }
              setStatus(null);
            }} className="w-full rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] px-2.5 py-2 text-xs text-white">
              <option value="">Choose a saved preset</option>
              {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} · {preset.modelId}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="generation-preset-name" className="text-[11px] font-semibold text-zinc-300">Preset name</label>
            <input id="generation-preset-name" value={name} maxLength={100} onChange={event => setName(event.target.value)}
              className="w-full rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] px-2.5 py-2 text-xs text-white" placeholder="e.g. Game Ready Production" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="generation-preset-revision" className="text-[11px] font-semibold text-zinc-300">Revision / experiment ID</label>
            <input id="generation-preset-revision" value={revision} maxLength={100} onChange={event => setRevision(event.target.value)}
              className="w-full rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] px-2.5 py-2 text-xs text-white" placeholder="e.g. v1" />
            <p className="text-[10px] text-zinc-500">Metadata only; never sent to the model.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="generation-preset-seed" className="text-[11px] font-semibold text-zinc-300">Seed</label>
            <input id="generation-preset-seed" type="number" min={0} step={1} value={generationSettings.seed} onChange={event => {
              if (event.target.value === '') return;
              const value = Number(event.target.value);
              if (!Number.isSafeInteger(value) || value < 0) return;
              setGenerationSettings(prev => ({ ...prev, seed: value }));
            }} className="w-full rounded-lg bg-[hsl(var(--surface-2))] border border-white/[0.12] px-2.5 py-2 text-xs font-mono text-white" />
          </div>
        </div>
        <div className="space-y-2 border-t border-white/[0.08] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!selected} onClick={loadSelected} className="rounded-lg border border-white/[0.12] px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.05] disabled:opacity-40">Load selected</button>
            <button type="button" disabled={!generationSettings.aiModel || !name.trim()} onClick={savePreset} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-40">{selected ? 'Update selected' : 'Save new preset'}</button>
            <button type="button" disabled={!selected} onClick={deleteSelected} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40">Delete</button>
            <button type="button" onClick={() => importInput.current?.click()} className="rounded-lg border border-white/[0.12] px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.05]">Import JSON</button>
            <input ref={importInput} type="file" accept="application/json,.json" className="hidden" aria-label="Import generation preset JSON"
              onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) await importFile(file); }} />
            <button type="button" disabled={!selected} onClick={() => exportProfiles(false)} className="rounded-lg border border-white/[0.12] px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.05] disabled:opacity-40">Export selected</button>
            <button type="button" disabled={!presets.length} onClick={() => exportProfiles(true)} className="rounded-lg border border-white/[0.12] px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.05] disabled:opacity-40">Export library</button>
            <button type="button" disabled={queueing} onClick={runCurrent} className="rounded-lg border border-primary/40 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-40">{queueing ? 'Queueing…' : 'Run current settings'}</button>
          </div>
          {status && <p role={status.type === 'error' ? 'alert' : 'status'} className={'text-[11px] ' + (status.type === 'error' ? 'text-rose-400' : 'text-emerald-400')}>{status.message}</p>}
        </div>
      </div>
    </details>
  );
}
