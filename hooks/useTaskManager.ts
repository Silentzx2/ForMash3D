"use client";

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { InstallProgress } from '@/types';

interface Task {
  id: string;
  type: 'generation' | 'download' | 'install' | 'render' | 'texture';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  label: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

const POLL_INTERVAL = 5000;  // Increased from 3s to 5s to reduce backend load
const MAX_RECONNECT_ATTEMPTS = 30;

// Stop polling when tab is hidden to save resources
let documentVisible = true;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    documentVisible = !document.hidden;
  });
}

// ponytail: only poll tasks that map to a real backend generation job (uuid).
// Local placeholder ids (created before POST returns) and non-generation tasks
// (download/install/render) would hit /generation/{id}/status and 404 forever.
const BACKEND_JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPollableGenerationTask(task: Task): boolean {
  return task.type === 'generation' && BACKEND_JOB_ID_RE.test(task.id);
}

function createTaskFromJob(job: { id: string; status: string; progress: number; prompt?: string; mode?: string }): Task {
  return {
    id: job.id,
    type: 'generation',
    status: job.status as Task['status'],
    progress: job.progress ?? 0,
    label: job.prompt ?? job.mode ?? 'Generation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: { job },
  };
}

export function useTaskManager() {
  const tasks = useAppStore((s) => s.tasks);
  const setTask = useAppStore((s) => s.setTask);
  const removeTask = useAppStore((s) => s.removeTask);
  const currentJob = useAppStore((s) => s.currentJob);
  const setCurrentJob = useAppStore((s) => s.setCurrentJob);
  const updateJobProgress = useAppStore((s) => s.updateJobProgress);
  const addLogEntry = useAppStore((s) => s.addLogEntry);
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const activeJobIdRef = useRef<string | null>(null);
  const pollTickCountRef = useRef(0);

  const registerTask = useCallback(
    (task: Task) => {
      setTask(task);
      activeJobIdRef.current = task.id;
    },
    [setTask]
  );

  const updateTask = useCallback(
    (taskId: string, updates: Partial<Task>) => {
      const existing = useAppStore.getState().tasks[taskId];
      if (!existing) return;
      setTask({ ...existing, ...updates, updatedAt: Date.now() });
    },
    [setTask]
  );

  const completeTask = useCallback(
    (taskId: string, status: 'completed' | 'failed' | 'cancelled') => {
      updateTask(taskId, { status, progress: status === 'completed' ? 100 : 0 });
      if (activeJobIdRef.current === taskId) {
        activeJobIdRef.current = null;
      }
    },
    [updateTask]
  );

  const removeTaskById = useCallback(
    (taskId: string) => {
      removeTask(taskId);
      if (activeJobIdRef.current === taskId) {
        activeJobIdRef.current = null;
      }
    },
    [removeTask]
  );

const reconnectToRunningTasks = useCallback(async () => {
     const state = useAppStore.getState();
     const runningTasks = Object.values(state.tasks).filter(
       (t) => (t.status === 'running' || t.status === 'queued') && isPollableGenerationTask(t)
     );

     if (runningTasks.length === 0) return;

     for (const task of runningTasks) {
       try {
         const res = await fetch(`/api/v1/system/jobs/${task.id}`);
         if (!res.ok) continue;
         const data = await res.json();
         const status = data?.data || data;

         updateTask(task.id, {
           status: (status.status || 'running') as Task['status'],
           progress: Math.round((status.progress ?? 0) * 100), // Convert 0-1 to 0-100
           updatedAt: Date.now(),
         });

         if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
           completeTask(task.id, status.status as 'completed' | 'failed' | 'cancelled');
         }
       } catch {
         // Silently skip tasks that can't be reached
       }
     }
   }, [updateTask, completeTask]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollTickCountRef.current = 0;

    const scheduleNext = () => {
      pollTickCountRef.current++;
      // Gentle exponential backoff: 5s, 7.5s, 10s, then cap at 10s
      const backoffFactor = Math.min(pollTickCountRef.current, 3);
      const interval = Math.min(POLL_INTERVAL + (backoffFactor - 1) * 2500, 10000);

      pollIntervalRef.current = setTimeout(() => {
        const state = useAppStore.getState();
        const runningTasks = Object.values(state.tasks).filter(
          (t) => (t.status === 'running' || t.status === 'queued') && isPollableGenerationTask(t)
        );

        if (runningTasks.length === 0) {
          stopPolling();
          return;
        }

        for (const task of runningTasks) {
          fetch(`/api/v1/system/jobs/${task.id}`)
            .then((res) => {
              if (!res.ok) return;
              return res.json();
            })
            .then((data) => {
              if (!data) return;
              const status = data?.data || data;
              updateTask(task.id, {
                status: (status.status || 'running') as Task['status'],
                progress: Math.round((status.progress ?? 0) * 100), // Convert 0-1 to 0-100
                updatedAt: Date.now(),
              });

              if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
                completeTask(task.id, status.status as 'completed' | 'failed' | 'cancelled');
              }
            })
            .catch(() => {
              // Silently ignore polling errors
            });
        }

        scheduleNext();
      }, interval);
    };

    scheduleNext();
  }, [updateTask, completeTask, stopPolling]);

  const reconnectToDownload = useCallback(
    (downloadId: string) => {
      const state = useAppStore.getState();
      const download = state.downloads[downloadId];
      if (!download || download.status === 'completed' || download.status === 'error') return;

      setTask({
        id: downloadId,
        type: 'download',
        status: download.status === 'paused' ? 'queued' : 'running',
        progress: (download.downloaded / Math.max(download.size, 1)) * 100,
        label: download.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    },
    [setTask]
  );

  const reconnectToInstall = useCallback(
    (modelId: string, progress: InstallProgress) => {
      const statusMap: Record<string, Task['status']> = {
        starting: 'queued',
        downloading: 'running',
        extracting: 'running',
        installing: 'running',
        completed: 'completed',
        failed: 'failed',
        error: 'failed',
      };

      setTask({
        id: modelId,
        type: 'install',
        status: statusMap[progress.status] ?? 'running',
        progress: progress.percent ?? 0,
        label: progress.model_id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: { progress },
      });
    },
    [setTask]
  );

  useEffect(() => {
    reconnectToRunningTasks();
    startPolling();

    return () => {
      stopPolling();
    };
  }, [reconnectToRunningTasks, startPolling, stopPolling]);

  return {
    tasks,
    registerTask,
    updateTask,
    completeTask,
    removeTaskById,
    reconnectToRunningTasks,
    reconnectToDownload,
    reconnectToInstall,
    startPolling,
    stopPolling,
    hasActiveTasks: Object.values(tasks).some((t) => t.status === 'running' || t.status === 'queued'),
  };
}