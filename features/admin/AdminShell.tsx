"use client";


import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LayoutDashboardIcon, BoxesIcon, Activity01Icon, ScrollTextIcon, Briefcase01Icon,
  ListOrderedIcon, HeartPulseIcon, Settings01Icon, HardDriveIcon,
  ChevronLeft, ChevronRight, BoxIcon, SparklesIcon, CpuIcon,
  ZapIcon, Wifi01Icon, Search01Icon, BellIcon, Menu01Icon
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { APP_NAME, ADMIN_NAV_ITEMS } from '@/constants';
import { StatusDot } from '@/components/premium/StatusDot';
import { getApiClient } from '@/services/apiClient';
import { useBackendStatus } from '@/hooks/useBackendData';
import type { RuntimeStatus } from '@/types';

const ICON_MAP: Record<string, any> = {
  LayoutDashboardIcon: LayoutDashboardIcon,
  BoxesIcon: BoxesIcon,
  ActivityIcon: Activity01Icon,
  ScrollTextIcon: ScrollTextIcon,
  BriefcaseIcon: Briefcase01Icon,
  ListOrderedIcon: ListOrderedIcon,
  HeartPulseIcon: HeartPulseIcon,
  SettingsIcon: Settings01Icon,
  HardDriveIcon: HardDriveIcon,
};

export type AdminTab =
  | 'overview'
  | 'models'
  | 'runtime'
  | 'logs'
  | 'jobs'
  | 'queue'
  | 'health'
  | 'storage'
  | 'settings';

interface AdminShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

export function AdminShell({ activeTab, onTabChange, children }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const pathname = usePathname();

  const loadRuntime = useCallback(async () => {
    try {
      const status = await getApiClient().getSystemStatus();
      if (status) setRuntime(status as unknown as RuntimeStatus);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadRuntime();
    const interval = setInterval(loadRuntime, 10000);
    return () => clearInterval(interval);
  }, [loadRuntime]);

  const gpuOnline = runtime?.cuda_available ?? false;
  const backendOnline = useBackendStatus();
  const vramUsed = runtime ? (runtime.vram_used_mb / 1024).toFixed(1) : '—';
  const vramTotal = runtime ? (runtime.vram_total_mb / 1024).toFixed(0) : '—';

  return (
    <div className="flex h-screen overflow-hidden">
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          'fixed lg:relative z-50 top-0 bottom-0 left-0 h-full max-w-[85vw] flex flex-col glass-strong border-r border-[hsl(var(--border))] transition-all duration-300 shrink-0',
          collapsed ? 'w-[68px]' : 'w-[240px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center gap-3 h-16 px-4 border-b border-[hsl(var(--border))] shrink-0">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 group-hover:border-primary/50 transition-colors">
              <HugeiconsIcon icon={BoxIcon} size={16} className="w-5 h-5 text-primary" />
              <div className="absolute inset-0 rounded-xl bg-primary/5 group-hover:bg-primary/10 transition-colors" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-foreground">{APP_NAME}</span>
                <span className="text-[10px] text-muted-foreground">Control Center</span>
              </div>
            )}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
          {!collapsed && (
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-3 mb-2">
              Navigation
            </p>
          )}
          {ADMIN_NAV_ITEMS.map((item) => {
            const IconComponent = ICON_MAP[item.icon] || LayoutDashboardIcon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  setMobileOpen(false);
                }}
                className={cn(
                  'group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all duration-200',
                  isActive
                    ? 'bg-primary/10 text-foreground border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] border border-transparent',
                  collapsed && 'justify-center'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-glow"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-primary"
                  />
                )}
                <HugeiconsIcon icon={IconComponent} size={20} className={cn('w-[18px] h-[18px] shrink-0', isActive && 'text-primary')} />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                {isActive && !collapsed && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-2 border-t border-[hsl(var(--border))] space-y-1">
          <Link
            href="/workspace"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-all',
              collapsed && 'justify-center'
            )}
          >
            <HugeiconsIcon icon={SparklesIcon} size={20} className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Workspace</span>}
          </Link>
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex items-center justify-center h-10 border-t border-[hsl(var(--border))] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
        >
          {collapsed ? <HugeiconsIcon icon={ChevronRight} size={16} className="w-4 h-4" /> : <HugeiconsIcon icon={ChevronLeft} size={16} className="w-4 h-4" />}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between h-16 px-4 lg:px-6 glass-strong border-b border-[hsl(var(--border))] shrink-0 z-30">
          <div className="flex items-center gap-3 flex-1">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))]"
            >
              <HugeiconsIcon icon={Menu01Icon} size={16} className="w-5 h-5" />
            </button>

            <div className="relative flex-1 max-w-md">
              <HugeiconsIcon icon={Search01Icon} size={16} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SearchIcon models, jobs, logs..."
                className="w-full h-9 pl-9 pr-4 rounded-xl glass text-sm text-foreground placeholder:text-muted-foreground/50 border border-[hsl(var(--border))] focus:border-primary/50 focus:outline-none transition-colors"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-surface-2 text-[10px] text-muted-foreground border border-border">
                ⌘K
              </kbd>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl glass border border-[hsl(var(--border))]">
              <HugeiconsIcon icon={CpuIcon} size={16} className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">GPU</span>
              <StatusDot status={gpuOnline ? 'online' : 'offline'} size="sm" />
            </div>

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl glass border border-[hsl(var(--border))]">
              <HugeiconsIcon icon={Wifi01Icon} size={16} className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-muted-foreground">Backend</span>
              <StatusDot status={backendOnline ? 'online' : 'offline'} size="sm" />
            </div>

            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl glass border border-[hsl(var(--border))]">
              <HugeiconsIcon icon={ZapIcon} size={16} className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-mono text-muted-foreground">VRAM</span>
              <span className="text-xs font-mono text-foreground">{vramUsed}/{vramTotal} GB</span>
            </div>

            <button className="relative p-2 rounded-xl glass border border-[hsl(var(--border))] text-muted-foreground hover:text-foreground transition-colors">
              <HugeiconsIcon icon={BellIcon} size={16} className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
            </button>

            <button className="flex items-center gap-2 p-1 pr-3 rounded-xl glass border border-[hsl(var(--border))] hover:border-primary/40 transition-colors">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-xs font-bold text-[#080808]">
                AI
              </div>
              <span className="hidden md:block text-xs font-medium text-foreground">Admin</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
