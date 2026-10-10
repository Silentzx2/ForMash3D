import type { SystemStats } from '@/features/workspace/types';
import { dedupedGet } from '@/lib/requestDedup';

export interface HistoryItem {
  prompt?: [number, string, Record<string, unknown>, Record<string, unknown>, string[]];
  outputs?: Record<string, Record<string, unknown>>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

const API_BASE = '/api/v1';

export interface BackendSystemStats {
  status: 'online' | 'offline' | 'connecting' | 'error';
  host: string;
  gpu: string;
  vramUsedGb: number | null;
  vramTotalGb: number | null;
  ramUsedGb: number | null;
  ramTotalGb: number | null;
  torchVramUsedGb: number | null;
  torchVramTotalGb: number | null;
  gpuType: string | null;
  gpuIndex: number | null;
  pythonVersion: string | null;
  torchVersion: string | null;
  apiVersion: string | null;
  queueRunning: number;
  queuePending: number;
  activePromptId: string | null;
  activeNode: string | null;
  lastPingMs: number;
}

class ApiClient {
  private listeners: Map<string, Set<(data: unknown) => void>>;
  private _host: string;

  constructor() {
    this.listeners = new Map();
    this._host = API_BASE;
  }

  private emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch { /* ignore listener errors */ }
    });
  }

  public getBaseUrl(): string { return this._host; }

  public setBaseUrl(host: string) { this._host = host; }

  public on(event: string, callback: (data: unknown) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  public off(event: string, callback: (data: unknown) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  async getSystemStats(): Promise<BackendSystemStats> {
    const start = performance.now();
    try {
      const [sysRes, statusRes, runtimeRes] = await Promise.allSettled([
        dedupedGet<Record<string, unknown>>('/api/v1/system/info'),
        dedupedGet<Record<string, unknown>>('/api/v1/system/status'),
        dedupedGet<Record<string, unknown>>('/api/v1/system/scheduler-status'),
      ]);

      const latency = Math.round(performance.now() - start);
      const isAnyOk = sysRes.status === 'fulfilled' || statusRes.status === 'fulfilled' || runtimeRes.status === 'fulfilled';

      if (!isAnyOk) {
        return {
          status: 'offline',
          host: API_BASE,
          gpu: 'Unavailable',
          vramUsedGb: null, vramTotalGb: null,
          ramUsedGb: null, ramTotalGb: null,
          torchVramUsedGb: null, torchVramTotalGb: null,
          gpuType: null, gpuIndex: null,
          pythonVersion: null, torchVersion: null,
          apiVersion: null,
          queueRunning: 0, queuePending: 0,
          activePromptId: null, activeNode: null,
          lastPingMs: latency,
        };
      }

      const rawStatus = statusRes.status === 'fulfilled' ? statusRes.value : {};
      const rawSys = sysRes.status === 'fulfilled' ? sysRes.value : {};
      const rawRt = runtimeRes.status === 'fulfilled' ? runtimeRes.value : {};

      const statusData = (rawStatus.data ?? rawStatus) as Record<string, any>;
      const sysData = (rawSys.data ?? rawSys) as Record<string, any>;
      const rtData = (rawRt.data ?? rawRt) as Record<string, any>;

      // Extract GPU details from /system/status
      const gpusList = Array.isArray(statusData.gpu) ? statusData.gpu : [];
      const primaryGpu = gpusList[0] || {};
      const gpuName = primaryGpu.name || 'NVIDIA GPU';

      // VRAM in MB
      let vramTotalMb = primaryGpu.memory_total;
      let vramFreeMb = primaryGpu.memory_free;
      let vramUsedMb = primaryGpu.memory_used;

      // System Memory
      const sysMem = sysData.system?.memory || sysData.memory || {};
      const ramTotalMb = sysMem.total;
      const ramUsedMb = sysMem.used;

      const vramUsedGb = vramUsedMb != null ? Number((vramUsedMb / 1024).toFixed(2)) : null;
      const vramTotalGb = vramTotalMb != null ? Number((vramTotalMb / 1024).toFixed(2)) : null;
      const ramUsedGb = ramUsedMb != null ? Number((ramUsedMb / 1024).toFixed(2)) : null;
      const ramTotalGb = ramTotalMb != null ? Number((ramTotalMb / 1024).toFixed(2)) : null;

      const pythonVer = sysData.system?.python_version || sysData.application?.environment || null;
      const torchVer = primaryGpu.cuda?.torch_version || null;
      const apiVer = sysData.application?.version || 'v1';

      return {
        status: 'online',
        host: API_BASE,
        gpu: gpuName,
        vramUsedGb,
        vramTotalGb,
        ramUsedGb,
        ramTotalGb,
        torchVramUsedGb: null,
        torchVramTotalGb: null,
        gpuType: primaryGpu.name ? 'CUDA' : null,
        gpuIndex: primaryGpu.id ?? 0,
        pythonVersion: typeof pythonVer === 'string' ? pythonVer.split(' ')[0] : null,
        torchVersion: typeof torchVer === 'string' ? torchVer : null,
        apiVersion: apiVer,
        queueRunning: Number(rtData.queue?.processing_jobs ?? rtData.scheduler?.queue_status?.processing_jobs ?? 0),
        queuePending: Number(rtData.queue?.pending_jobs ?? rtData.scheduler?.queue_status?.queued_jobs ?? 0),
        activePromptId: null,
        activeNode: null,
        lastPingMs: latency,
      };
    } catch {
      return {
        status: 'offline',
        host: API_BASE,
        gpu: 'Unavailable',
        vramUsedGb: null, vramTotalGb: null,
        ramUsedGb: null, ramTotalGb: null,
        torchVramUsedGb: null, torchVramTotalGb: null,
        gpuType: null, gpuIndex: null,
        pythonVersion: null, torchVersion: null,
        apiVersion: null,
        queueRunning: 0, queuePending: 0,
        activePromptId: null, activeNode: null,
        lastPingMs: 0,
      };
    }
  }

  async getQueue(): Promise<{ running: unknown[]; pending: unknown[] }> {
    try {
      const res = await fetch(`${API_BASE}/system/jobs/queue/stats`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { running: [], pending: [] };
      const payload = await res.json();
      const data = (payload?.data ?? payload) as { pending_jobs?: number; processing_jobs?: number };
      return { 
        running: Array.from({ length: data.processing_jobs ?? 0 }, (_, i) => ({ id: `job-${i}`, status: 'processing' })),
        pending: Array.from({ length: data.pending_jobs ?? 0 }, (_, i) => ({ id: `job-${i}`, status: 'queued' }))
      };
    } catch {
      return { running: [], pending: [] };
    }
  }

  async getHistory(maxItems = 20): Promise<Record<string, HistoryItem>> {
    try {
      const res = await fetch(`${API_BASE}/system/jobs/history?limit=${maxItems}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return {};
      const payload = await res.json();
      const data = (payload?.data ?? payload) as { jobs?: Array<Record<string, unknown>> };
      const result: Record<string, HistoryItem> = {};
      (data.jobs ?? []).forEach((j, i) => {
        const jobId = (j.job_id ?? j.id ?? `job-${i}`) as string;
        const jobBase = `/api/v1/system/jobs/${jobId}`;
        const result = (j.result ?? {}) as Record<string, any>;
        // Canonical production artifacts: game_ready GLB by default,
        // master/source.glb for the source view, thumbnail endpoint always
        // resolves (file → input image → placeholder) even after a restart.
        const gameReadyUrl =
          result.model_url || result.game_ready_url || `${jobBase}/download?artifact_format=glb`;
        const sourceUrl =
          result.source_model_url || result.high_fidelity_url || `${jobBase}/download?artifact_format=master`;
        const thumbnailUrl = result.thumbnail_url || `${jobBase}/thumbnail`;
        result[jobId] = {
          prompt: [0, (j.prompt ?? j.feature ?? '') as string, {}, {}, []] as unknown as HistoryItem['prompt'],
          outputs: {
            ...result,
            glb: gameReadyUrl,
            model_url: gameReadyUrl,
            game_ready_url: gameReadyUrl,
            source: sourceUrl,
            source_model_url: sourceUrl,
            thumbnail: thumbnailUrl,
            thumbnail_url: thumbnailUrl,
            polygon_count: j.polygon_count ?? result.polygon_count,
            vertex_count: j.vertex_count ?? result.vertex_count,
            dimensions: j.dimensions ?? result.dimensions,
            bounding_box: j.bounding_box ?? result.bounding_box,
            object_count: j.object_count ?? result.object_count,
            component_count: j.component_count ?? result.component_count,
            material_count: j.material_count ?? result.material_count,
            topology: j.topology ?? result.topology,
            mesh_details: j.mesh_details ?? result.mesh_details,
            postprocess_status: j.postprocess_status ?? result.postprocess_status,
          },
          status: { status_str: (j.status ?? 'unknown') as string, completed: j.status === 'completed' || j.status === 'succeeded' || j.status === 'completed_degraded' },
        };
      });
      return result;
    } catch {
      return {};
    }
  }

  async deleteHistory(promptId: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/system/jobs/${encodeURIComponent(promptId)}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
    } catch { /* ignore */ }
  }

  connectWebSocket() { /* SSE handled by individual components */ }
  disconnectWebSocket() {}

  emitProgress(progress: number, node?: string) {
    this.emit('progress', { value: progress, max: 100, node });
  }

  emitExecuting(node?: string) {
    this.emit('executing', { node });
  }

  emitExecuted() {
    this.emit('executed', {});
    this.emit('connected', { status: 'online' });
  }

  emitError(message: string) {
    this.emit('execution_error', { exception_message: message });
  }

  cancelExecution() {
    this.emit('execution_error', { exception_message: 'Execution cancelled by user' });
  }
}

// Workspace-specific apiClient: standalone instance of the workspace ApiClient
// defined above. It already carries the workspace helpers (on/off,
// getSystemStats, getQueue, getHistory, …), so no shared-singleton binding
// is required.
export const apiClient = new ApiClient() as any;

export async function fetchSystemStats(): Promise<SystemStats> {
  const stats = await apiClient.getSystemStats();
  return { ...stats, apiVersion: null } as SystemStats;
}
