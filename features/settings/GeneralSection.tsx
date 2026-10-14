"use client";


import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, LoaderCircleIcon, RefreshCwIcon, CheckmarkCircle01Icon, CancelCircleIcon, Activity01Icon, SaveIcon } from '@hugeicons/core-free-icons';
import { getApiClient } from '@/services/apiClient';
import { Switch } from '@/components/ui/switch';

interface SystemInfoData {
  service: {
    name: string;
    version: string;
    api_version?: string;
  };
  basic_info?: {
    platform: string;
    python_version: string;
  };
  python?: {
    version: string;
  };
  os?: {
    system: string;
    release: string;
    machine: string;
  };
  gpu?: {
    available: boolean;
    name?: string;
    memory_total?: string;
    gpus?: Array<{ name?: string; total_memory_mb?: number }>;
  };
}

interface InitStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  message?: string;
}

export function GeneralSection() {
  const [systemInfo, setSystemInfo] = useState<SystemInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [initSteps, setInitSteps] = useState<InitStep[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ai3d:settings:autoSaveEnabled');
      setAutoSaveEnabled(saved !== 'false');
    }
  }, []);

  const handleToggleAutoSave = (checked: boolean) => {
    setAutoSaveEnabled(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ai3d:settings:autoSaveEnabled', String(checked));
    }
  };

  useEffect(() => {
    fetchSystemInfo();
  }, []);

  async function fetchSystemInfo() {
    try {
      setLoading(true);
      setError(null);
      
      const response = await getApiClient().get<{ success: boolean; data: SystemInfoData }>('/api/v1/system/info');
      if (response && response.data) {
        setSystemInfo(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backend Offline or Service Unavailable');
    } finally {
      setLoading(false);
    }
  }

  const runInitializationCheck = async () => {
    setIsChecking(true);
    setInitSteps([
      { id: 'api', label: 'Backend API Connection', status: 'pending' },
      { id: 'connections', label: 'Database & Redis Connections', status: 'pending' },
      { id: 'dependencies', label: 'System Dependencies', status: 'pending' }
    ]);
    
    let hasError = false;

    // 1. Backend API Connection
    setInitSteps(prev => prev.map(s => s.id === 'api' ? { ...s, status: 'loading' } : s));
    try {
      await getApiClient().get('/api/v1/system/health');
      setInitSteps(prev => prev.map(s => s.id === 'api' ? { ...s, status: 'success' } : s));
    } catch (e) {
      setInitSteps(prev => prev.map(s => s.id === 'api' ? { ...s, status: 'error', message: e instanceof Error ? e.message : 'Failed to connect' } : s));
      hasError = true;
    }

    if (hasError) {
      setIsChecking(false);
      return;
    }

    // 2. Database & Redis Connections
    setInitSteps(prev => prev.map(s => s.id === 'connections' ? { ...s, status: 'loading' } : s));
    try {
      await getApiClient().get('/api/v1/system/status');
      setInitSteps(prev => prev.map(s => s.id === 'connections' ? { ...s, status: 'success', message: 'Backend reachable' } : s));
    } catch (e) {
      setInitSteps(prev => prev.map(s => s.id === 'connections' ? { ...s, status: 'error', message: e instanceof Error ? e.message : 'Connection test failed' } : s));
      hasError = true;
    }

    if (hasError) {
      setIsChecking(false);
      return;
    }

    // 3. Dependencies — skip nonexistent endpoint; mark based on scheduler status
    setInitSteps(prev => prev.map(s => s.id === 'dependencies' ? { ...s, status: 'loading' } : s));
    try {
      const schedulerStatus = await getApiClient().get<any>('/api/v1/system/scheduler-status');
      const adaptersRegistered = schedulerStatus?.scheduler?.adapters_registered ?? schedulerStatus?.adapters_registered ?? 0;
      if (adaptersRegistered > 0) {
        setInitSteps(prev => prev.map(s => s.id === 'dependencies' ? { ...s, status: 'success', message: `${adaptersRegistered} adapters registered` } : s));
      } else {
        setInitSteps(prev => prev.map(s => s.id === 'dependencies' ? { ...s, status: 'error', message: 'No model adapters registered' } : s));
      }
    } catch (e) {
      setInitSteps(prev => prev.map(s => s.id === 'dependencies' ? { ...s, status: 'error', message: e instanceof Error ? e.message : 'Failed to check dependencies' } : s));
    }

    setIsChecking(false);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-40">
          <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">General Settings</h1>
        <p className="text-muted-foreground mt-2">Application information and environment details</p>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
          <HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Application Information */}
      <Card>
        <CardHeader>
          <CardTitle>Application Information</CardTitle>
          <CardDescription>Details about the running service</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Service Name</p>
              <p className="text-base font-semibold">{systemInfo?.service?.name || 'N/A'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Version</p>
              <p className="text-base font-semibold">{systemInfo?.service?.version || 'N/A'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">API Version</p>
              <p className="text-base font-semibold">{systemInfo?.service?.api_version || 'N/A'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">OS Platform</p>
              <p className="text-base font-semibold">
                {systemInfo?.os ? `${systemInfo.os.system} ${systemInfo.os.release} (${systemInfo.os.machine})` : systemInfo?.basic_info?.platform || 'N/A'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Runtime Information */}
      <Card>
        <CardHeader>
          <CardTitle>Runtime Environment</CardTitle>
          <CardDescription>Versions of key dependencies</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Python Version</p>
              <p className="text-base font-semibold">{systemInfo?.python?.version || systemInfo?.basic_info?.python_version || 'N/A'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">GPU Hardware</p>
              <p className={`text-base font-semibold ${systemInfo?.gpu?.available ? '' : 'text-amber-400'}`}>
                {systemInfo?.gpu?.available
                  ? `${systemInfo.gpu.name || systemInfo.gpu.gpus?.[0]?.name || 'NVIDIA GPU'} (${systemInfo.gpu.memory_total || (systemInfo.gpu.gpus?.[0]?.total_memory_mb ? `${systemInfo.gpu.gpus[0].total_memory_mb} MB` : 'Available')})`
                  : 'No GPU Detected'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* General Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={SaveIcon} size={16} className="w-5 h-5 text-primary" />
            General Preferences
          </CardTitle>
          <CardDescription>Configure application-wide preferences and behaviors.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-semibold text-foreground">Auto-save changes</label>
              <p className="text-sm text-muted-foreground">Automatically persist setting changes to local storage as you edit.</p>
            </div>
            <Switch 
              checked={autoSaveEnabled} 
              onCheckedChange={handleToggleAutoSave} 
            />
          </div>
        </CardContent>
      </Card>

      {/* Initialization & Health Checks */}
      <Card>
        <CardHeader>
          <CardTitle>System Initialization & Health</CardTitle>
          <CardDescription>Run diagnostics to verify backend connections and system dependencies</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button 
              variant="default" 
              onClick={runInitializationCheck}
              disabled={isChecking}
              className="bg-primary text-primary-foreground"
            >
              {isChecking ? <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-4 h-4 mr-2 animate-spin" /> : <HugeiconsIcon icon={Activity01Icon} size={16} className="w-4 h-4 mr-2" />}
              {isChecking ? 'Running Checks...' : 'Run Initialization Check'}
            </Button>
            <Button variant="default" onClick={fetchSystemInfo} disabled={loading}>
              <HugeiconsIcon icon={RefreshCwIcon} size={16} className="w-4 h-4 mr-2" />
              Refresh Information
            </Button>
          </div>

          {initSteps.length > 0 && (
            <div className="mt-6 space-y-3 rounded-xl border border-border p-5 bg-card/50">
              {initSteps.map((step, index) => (
                <div key={step.id} className="flex items-start gap-4">
                  <div className="mt-0.5 flex-shrink-0">
                    {step.status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />}
                    {step.status === 'loading' && <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-5 h-5 animate-spin text-primary" />}
                    {step.status === 'success' && <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="w-5 h-5 text-[hsl(var(--neon-green))]" />}
                    {step.status === 'error' && <HugeiconsIcon icon={CancelCircleIcon} size={16} className="w-5 h-5 text-destructive" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {step.label}
                    </p>
                    {step.message && (
                      <p className={`text-xs mt-1 ${step.status === 'error' ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                        {step.message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
