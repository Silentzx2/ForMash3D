"use client";

import type { RuntimeStatus, GpuInfo } from '@/types';
import type { SystemStatus } from '@/types/api';

/**
 * Convert backend SystemStatus (from /api/v1/system/status) to frontend RuntimeStatus
 * The backend returns nested structures (system.memory, gpu[] array) while frontend expects flat properties
 */
export function mapSystemStatusToRuntimeStatus(sys: SystemStatus): RuntimeStatus {
  const primaryGpu = sys.gpu?.[0];
  const gpus: GpuInfo[] = (sys.gpu || []).map((g, i) => ({
    index: g.id ?? i,
    name: g.name,
    vram_mb: g.memory_total,
    vram_used_mb: g.memory_used,
    utilization: g.gpu_utilization,
    temperature: g.temperature,
  }));

  return {
    engine_initialized: true,
    cuda_available: sys.cuda_available ?? (sys.gpu && sys.gpu.length > 0),
    cuda_version: '12.x', // not exposed by backend API
    driver_version: 'N/A', // not exposed by backend API
    gpu_name: primaryGpu?.name ?? 'Unknown GPU',
    gpu_utilization: sys.gpu_utilization ?? primaryGpu?.gpu_utilization ?? 0,
    gpu_temp: sys.gpu_temp ?? primaryGpu?.temperature ?? 0,
    vram_used_mb: sys.vram_used_mb ?? primaryGpu?.memory_used ?? 0,
    vram_total_mb: sys.vram_total_mb ?? primaryGpu?.memory_total ?? 0,
    cpu_usage: sys.cpu_usage ?? sys.system?.cpu_usage ?? 0,
    cpu_name: sys.cpu_name ?? 'Unknown CPU',
    cpu_cores: sys.cpu_cores,
    cpu_threads: sys.cpu_threads,
    ram_usage: sys.ram_usage ?? sys.system?.memory?.used ?? 0,
    ram_total: sys.ram_total ?? sys.system?.memory?.total ?? 0,
    os: 'Linux', // backend doesn't expose OS in SystemStatus
    network_in: 0,
    network_out: 0,
    storage_used_gb: sys.storage_used_gb ?? sys.system?.disk?.used ?? 0,
    storage_total_gb: sys.storage_total_gb ?? sys.system?.disk?.total ?? 0,
    blender_available: false, // not exposed by backend API
    blender_version: 'N/A', // not exposed by backend API
    repos_installed: sys.models?.loaded ?? 0,
    repos_total: sys.models?.available ?? 0,
    weights_downloaded: (sys.models?.loaded ?? 0) > 0,
    scheduler_running: sys.status === 'healthy' || sys.status === 'running',
    workers: sys.queue?.processing_jobs ?? 0,
    loaded_providers: [], // not exposed by backend API
    gpus,
  };
}

/**
 * Safe getter for system status with fallback to default RuntimeStatus
 */
export function getSafeRuntimeStatus(sys: SystemStatus | null | undefined): RuntimeStatus | null {
  if (!sys) return null;
  try {
    return mapSystemStatusToRuntimeStatus(sys);
  } catch {
    return null;
  }
}