"use client";


import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { HeartPulseIcon, CheckmarkCircle01Icon, CancelCircleIcon, TriangleAlertIcon, RefreshCw } from '@hugeicons/core-free-icons';
import { GlassCard } from '@/components/premium/GlassCard';
import { Badge } from '@/components/premium/Badge';
import { NeonButton } from '@/components/premium/NeonButton';
import { Spinner } from '@/components/premium/Spinner';
import { getApiClient } from '@/services/apiClient';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latency: number;
  detail: string;
  extra?: string;
}

export function HealthTab() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [systemStatus, healthStatus] = await Promise.all([
        getApiClient().getSystemStatus(),
        getApiClient().getHealthStatus(),
      ]);
      
      // Create health checks from available data
      const healthChecks: HealthCheck[] = [
        {
          name: 'System',
          status: systemStatus.status === 'healthy' ? 'healthy' as const : 'degraded',
          latency: 0,
          detail: systemStatus.status || 'unknown',
        },
        {
          name: 'Health Endpoint',
          status: healthStatus.status === 'healthy' ? 'healthy' as const : 'degraded',
          latency: 0,
          detail: healthStatus.status,
        },
        {
          name: 'GPU',
          status: (systemStatus.gpu_utilization !== undefined && systemStatus.gpu_utilization !== null) ? 'healthy' : 'down',
          latency: 0,
          detail: systemStatus.gpu_utilization !== undefined ? `GPU Utilization: ${systemStatus.gpu_utilization}%` : 'GPU not detected',
        },
        {
          name: 'CUDA',
          status: systemStatus.cuda_available ? 'healthy' : 'down',
          latency: 0,
          detail: systemStatus.cuda_available ? 'CUDA available' : 'CUDA not available',
        },
      ];

      setChecks(healthChecks);
      setLastChecked(new Date());
    } catch (err) {
      setError('Failed to fetch health data');
      toast.error('Failed to fetch health data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const healthy = checks.filter((c) => c.status === 'healthy').length;
  const degraded = checks.filter((c) => c.status === 'degraded').length;
  const down = checks.filter((c) => c.status === 'down').length;

  if (loading && checks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && checks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <HugeiconsIcon icon={CancelCircleIcon} size={16} className="w-10 h-10 text-[hsl(var(--destructive))]" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <NeonButton variant="secondary" size="sm" onClick={load}>
          <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" /> Retry
        </NeonButton>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {healthy} healthy · {degraded} degraded · {down} down
            {lastChecked && ` · Last checked: ${lastChecked.toLocaleTimeString()}`}
          </p>
        </div>
        <NeonButton variant="secondary" size="sm" onClick={() => { load(); toast.info('Running health checks...'); }}>
          <HugeiconsIcon icon={RefreshCw} size={16} className="w-3.5 h-3.5" />
          RefreshIcon
        </NeonButton>
      </div>

      <GlassCard className="p-6" delay={0.05}>
        <div className="flex items-center gap-4">
          <div className={cn(
            'flex items-center justify-center w-16 h-16 rounded-2xl',
            down > 0 ? 'bg-destructive/10' : degraded > 0 ? 'bg-primary/10' : 'bg-emerald-500/10'
          )}>
            <HugeiconsIcon icon={HeartPulseIcon} size={16} className={cn('w-8 h-8', down > 0 ? 'text-destructive' : degraded > 0 ? 'text-primary' : 'text-emerald-400')} />
          </div>
          <div>
            <h2 className="text-xl font-bold">
              {down > 0 ? 'System Issues Detected' : degraded > 0 ? 'System Partially Degraded' : 'All Systems Operational'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {checks.length} services monitored
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {checks.map((check, i) => (
          <motion.div key={check.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <GlassCard hover className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-xl',
                    check.status === 'healthy' ? 'bg-emerald-500/10' :
                    check.status === 'degraded' ? 'bg-primary/10' : 'bg-destructive/10'
                  )}>
                    {check.status === 'healthy' ? <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="w-4 h-4 text-emerald-400" /> :
                     check.status === 'degraded' ? <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4 text-primary" /> :
                     <HugeiconsIcon icon={CancelCircleIcon} size={16} className="w-4 h-4 text-destructive" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{check.name}</p>
                      {check.latency > 0 && (
                        <span className="text-[10px] text-muted-foreground font-mono">{check.latency}ms</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{check.detail}</p>
                    {check.extra && (
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{check.extra}</p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <Badge variant={check.status === 'healthy' ? 'success' : check.status === 'degraded' ? 'warning' : 'error'}>
                    {check.status}
                  </Badge>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {checks.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <HugeiconsIcon icon={HeartPulseIcon} size={16} className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No health data available</p>
        </div>
      )}
    </div>
  );
}