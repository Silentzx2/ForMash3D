"use client";

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Settings01Icon, KeyIcon, SaveIcon, TrashIcon, CpuIcon, HardDriveIcon, ServerIcon, NetworkIcon, RefreshCwIcon,
  Settings02Icon, SparklesIcon, LayoutGridIcon, Download01Icon, KeyboardIcon, BellIcon, SlidersHorizontalIcon,
  ShieldCheckIcon, Database01Icon, CheckIcon, AlertCircleIcon,
} from '@hugeicons/core-free-icons';
import { GlassCard } from '@/components/premium/GlassCard';
import { Badge } from '@/components/premium/Badge';
import { NeonButton } from '@/components/premium/NeonButton';
import { StatusDot } from '@/components/premium/StatusDot';
import { Spinner } from '@/components/premium/Spinner';
import { getApiClient } from '@/services/apiClient';
import type { RuntimeStatus } from '@/types';
import { toast } from 'sonner';

// Import all settings section components from features/settings/sections
import {
  GeneralSection,
  WorkspaceSection,
  GenerationSection,
  ExportBackupSection,
  NotificationsSection,
  ShortcutsSection,
  NetworkSection,
  AdvancedSection,
} from '@/features/settings';

type SettingsSubTab =
  | 'general'
  | 'generation'
  | 'workspace'
  | 'export'
  | 'api'
  | 'shortcuts'
  | 'notifications'
  | 'advanced';

interface SubTabItem {
  id: SettingsSubTab;
  label: string;
  icon: any;
  description: string;
}

  const SETTINGS_SUB_TABS: SubTabItem[] = [
  { id: 'general', label: 'General', icon: Settings02Icon, description: 'App info, theme & auto-save' },
  { id: 'generation', label: 'Generation', icon: SparklesIcon, description: 'Providers, polycounts & quality' },
  { id: 'workspace', label: 'Workspace', icon: LayoutGridIcon, description: '3D viewport defaults & controls' },
  { id: 'export', label: 'Export & Backup', icon: Download01Icon, description: 'File formats, ZIP packaging & backup' },
  { id: 'api', label: 'API & Tokens', icon: KeyIcon, description: 'HuggingFace token & system runtime' },
  { id: 'shortcuts', label: 'Shortcuts', icon: KeyboardIcon, description: 'KeyboardIcon shortcuts & navigation' },
  { id: 'notifications', label: 'Notifications', icon: BellIcon, description: 'Alerts & toast preferences' },
  { id: 'advanced', label: 'Advanced', icon: SlidersHorizontalIcon, description: 'Network, proxy & debug options' },
  ];

const VALID_SUB_TABS: Record<string, SettingsSubTab> = {
  general: 'general',
  generation: 'generation',
  workspace: 'workspace',
  export: 'export',
  backup: 'export',
  api: 'api',
  token: 'api',
  tokens: 'api',
  shortcuts: 'shortcuts',
  notifications: 'notifications',
  advanced: 'advanced',
  network: 'advanced',
};

export function SettingsTab({ initialSection }: { initialSection?: string }) {
  const resolvedInitial = (initialSection && VALID_SUB_TABS[initialSection.toLowerCase()]) || 'general';
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>(resolvedInitial);

  useEffect(() => {
    if (initialSection && VALID_SUB_TABS[initialSection.toLowerCase()]) {
      setActiveSubTab(VALID_SUB_TABS[initialSection.toLowerCase()]);
    }
  }, [initialSection]);

  // HF Token & System InfoIcon states
  const [hfToken, setHfToken] = useState('');
  const [hfStatus, setHfStatus] = useState<{ configured: boolean; valid: boolean }>({ configured: false, valid: false });
  const [saving, setSaving] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

const load = useCallback(async () => {
    try {
      const [status, rt, st] = await Promise.all([
        getApiClient().getHFTokenStatus(),
        getApiClient().getSystemStatus(),
        getApiClient().getSettings(),
      ]);
      setHfStatus(status);
      setRuntime(rt as unknown as RuntimeStatus);
      setSettings(st);
    } catch {
      // Graceful fallback if backend endpoints unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveToken = async () => {
    if (!hfToken.trim()) return;
    setSaving(true);
    try {
      await getApiClient().saveHFToken(hfToken);
      setHfStatus({ configured: true, valid: true });
      setHfToken('');
      toast.success('HuggingFace token saved successfully');
    } catch {
      toast.error('Failed to save token');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveToken = async () => {
    try {
      await getApiClient().removeHFToken();
      setHfStatus({ configured: false, valid: false });
      toast.success('HuggingFace token removed');
    } catch {
      toast.error('Failed to remove token');
    }
  };

  const systemInfo = [
    { label: 'OS', value: runtime?.os ?? 'Linux', icon: ServerIcon, color: 'text-foreground' },
    { label: 'CPU', value: runtime?.cpu_name ?? 'x86_64 CPU', icon: CpuIcon, color: 'text-emerald-400' },
    { label: 'RAM', value: runtime?.ram_total ? `${(runtime.ram_total / 1024).toFixed(0)} GB` : '—', icon: HardDriveIcon, color: 'text-primary' },
    { label: 'GPU', value: runtime?.gpu_name ?? (runtime?.cuda_available ? 'CUDA GPU' : 'None'), icon: CpuIcon, color: 'text-emerald-400' },
    { label: 'CUDA', value: runtime?.cuda_version ?? '12.x', icon: ServerIcon, color: 'text-primary' },
    { label: 'Driver', value: runtime?.driver_version ?? '—', icon: NetworkIcon, color: 'text-primary' },
  ];

  const runtimeConfig = settings
    ? Object.entries(settings).map(([key, value]) => ({
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value: String(value),
      }))
    : [];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1280px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <HugeiconsIcon icon={Settings01Icon} size={16} className="w-6 h-6 text-primary" />
            SettingsIcon & Configuration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage application preferences, generation pipelines, 3D viewport, and system credentials.
          </p>
        </div>
      </div>

      {/* Segmented Sub-Nav Pills */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl glass border border-[hsl(var(--border))] overflow-x-auto hide-scrollbar">
        {SETTINGS_SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
                isActive
                  ? 'bg-primary/20 text-foreground border border-primary/40 shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2)/0.6)] border border-transparent'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : ''}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSubTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {activeSubTab === 'general' && (
            <div className="rounded-xl overflow-hidden">
              <GeneralSection />
            </div>
          )}

          {activeSubTab === 'generation' && (
            <div className="rounded-xl overflow-hidden">
              <GenerationSection />
            </div>
          )}

          {activeSubTab === 'workspace' && (
            <div className="rounded-xl overflow-hidden">
              <WorkspaceSection />
            </div>
          )}

          {activeSubTab === 'export' && (
            <div className="rounded-xl overflow-hidden">
              <ExportBackupSection />
            </div>
          )}

          {activeSubTab === 'api' && (
            <div className="space-y-6">
              {/* System Information */}
              <GlassCard className="p-5" delay={0.05}>
                <div className="flex items-center gap-2 mb-4">
                   <HugeiconsIcon icon={ServerIcon} size={16} className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">System Hardware & Environment</h3>
                  <button
                    onClick={load}
                    className="ml-auto p-1.5 rounded-lg hover:bg-[hsl(var(--surface-2))] text-muted-foreground hover:text-foreground transition-colors"
                  >
                     <HugeiconsIcon icon={RefreshCwIcon} size={16} className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {systemInfo.map((info, i) => {
                    const Icon = info.icon;
                    return (
                      <div
                        key={info.label}
                        className="flex items-center gap-3 p-3 rounded-xl glass border border-[hsl(var(--border)/0.4)]"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--surface-2))]">
                          <HugeiconsIcon icon={Icon} size={14} className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{info.label}</p>
                          <p className="text-sm font-medium text-foreground">{info.value}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>

              {/* HuggingFace Token */}
              <GlassCard className="p-5" delay={0.1}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                     <HugeiconsIcon icon={KeyIcon} size={16} className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">HuggingFace API Token</h3>
                  </div>
                  <Badge variant={hfStatus.configured ? (hfStatus.valid ? 'success' : 'warning') : 'default'}>
                    <StatusDot
                      status={hfStatus.configured ? (hfStatus.valid ? 'online' : 'warning') : 'idle'}
                      size="sm"
                      pulse={false}
                    />
                    <span className="ml-1.5">{hfStatus.configured ? (hfStatus.valid ? 'Active & Valid' : 'Unverified') : 'Not Set'}</span>
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  Required for downloading gated model weights from HuggingFace Hub (TripoSG, Hunyuan3D, RMBG). Your token is stored securely in environment configuration and never exposed to clients.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="flex-1 h-10 px-4 rounded-xl glass text-sm border border-[hsl(var(--border))] focus:border-primary/50 focus:outline-none font-mono placeholder:text-muted-foreground/50"
                  />
                  <NeonButton variant="primary" size="md" onClick={handleSaveToken} disabled={saving || !hfToken.trim()}>
                     <HugeiconsIcon icon={SaveIcon} size={16} className="w-3.5 h-3.5 mr-1.5" />
                    SaveIcon Token
                  </NeonButton>
                  {hfStatus.configured && (
                    <NeonButton variant="destructive" size="md" onClick={handleRemoveToken}>
                       <HugeiconsIcon icon={TrashIcon} size={16} className="w-3.5 h-3.5" />
                    </NeonButton>
                  )}
                </div>
              </GlassCard>

              {/* Runtime Configuration */}
              {runtimeConfig.length > 0 && (
                <GlassCard className="p-5" delay={0.15}>
                  <div className="flex items-center gap-2 mb-4">
                    <HugeiconsIcon icon={Settings01Icon} size={16} className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Backend Engine Configuration</h3>
                  </div>
                  <div className="space-y-2">
                    {runtimeConfig.map((config) => (
                      <div
                        key={config.label}
                        className="flex items-center justify-between p-3 rounded-xl glass border border-[hsl(var(--border)/0.3)] text-xs"
                      >
                        <span className="text-muted-foreground font-medium">{config.label}</span>
                        <span className="font-mono text-foreground">{config.value}</span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}
            </div>
          )}

          {activeSubTab === 'shortcuts' && (
            <div className="rounded-xl overflow-hidden">
              <ShortcutsSection />
            </div>
          )}

          {activeSubTab === 'notifications' && (
            <div className="rounded-xl overflow-hidden">
              <NotificationsSection />
            </div>
          )}

          {activeSubTab === 'advanced' && (
            <div className="space-y-6">
              <AdvancedSection />
              <NetworkSection />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
