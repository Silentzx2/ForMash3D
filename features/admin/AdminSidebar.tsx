'use client';
import Link from 'next/link';
import type { AdminTab } from './AdminShell';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LayoutDashboardIcon, Layers01, Package, ListOrdered,
  Cpu, ScrollText, Settings01, Activity01,
  BriefcaseBusiness, ChevronRight, ExternalLink,
  Boxes, HardDrive,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

const PRIMARY_NAV: { id: AdminTab | null; label: string; icon: any; href?: string; badge?: string }[] = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboardIcon },
  { id: null, label: 'Workspace', icon: Layers01, href: '/workspace' },
  { id: 'models', label: 'Models', icon: Package },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
  { id: 'runtime', label: 'Runtime', icon: Cpu },
  { id: 'logs', label: 'Live Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings01 },
];

const ADMIN_NAV: { id: AdminTab; label: string; icon: any }[] = [
  { id: 'health', label: 'Health', icon: Activity01 },
  { id: 'jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { id: 'storage', label: 'Storage', icon: HardDrive },
];

export default function AdminSidebar({
  active,
  onChange,
}: {
  active: AdminTab;
  onChange: (t: AdminTab) => void;
}) {
  return (
    <aside
      className="w-60 shrink-0 h-full flex flex-col border-r border-[hsl(var(--border))]"
      style={{
        background: 'hsl(var(--card) / 0.95)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid hsl(var(--border) / 0.5)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--admin-accent) / 0.9) 0%, hsl(var(--admin-accent-deep) / 0.8) 100%)',
              boxShadow: '0 0 16px hsl(var(--admin-accent) / 0.40)',
            }}
          >
             <HugeiconsIcon icon={Boxes} size={16} className="w-[18px] h-[18px] text-[hsl(var(--foreground))]" />
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-[0.15em] text-primary uppercase">ForMash 3D</p>
            <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mt-0.5">Control Panel</p>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-0.5 px-3 hide-scrollbar">
        <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider px-2 pb-2">Navigation</p>
        {PRIMARY_NAV.map(({ id, label, icon, href, badge }) => {
          const Icon = icon as any;
          const isActive = id !== null && active === id;
          const content = (
            <>
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200',
                isActive
                  ? 'bg-primary/20'
                  : 'bg-transparent group-hover:bg-primary/10',
              )}>
                 <HugeiconsIcon icon={icon} size={16} className={cn(
                   'transition-colors duration-200',
                   isActive ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--muted-foreground))]',
                 )} />
              </div>
              <span className={cn(
                'flex-1 text-sm transition-colors duration-200',
                isActive ? 'text-[hsl(var(--foreground))] font-medium' : 'text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--muted-foreground))]',
              )}>{label}</span>
              {badge && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-primary/20 text-primary border border-primary/30">
                  {badge}
                </span>
              )}
               {href && <HugeiconsIcon icon={ExternalLink} size={12} className="text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--muted-foreground))] transition-colors" />}
               {isActive && <HugeiconsIcon icon={ChevronRight} size={12} className="text-primary" />}
            </>
          );

          const baseClass = cn(
            'group w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-200 text-left relative',
            isActive
              ? 'bg-primary/10 border border-primary/25'
              : 'hover:bg-[hsl(var(--primary)/0.05)] border border-transparent hover:border-[hsl(var(--primary)/0.10)]',
          );

          if (href) {
            return (
              <Link key={label} href={href} className={baseClass}>
                {content}
              </Link>
            );
          }

          return (
            <button
              key={id}
              onClick={() => id && onChange(id)}
              className={baseClass}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ background: 'linear-gradient(to bottom, hsl(var(--admin-accent) / 0.9), hsl(var(--admin-accent-deep) / 0.6))' }}
                />
              )}
              {content}
            </button>
          );
        })}

        {/* Admin section */}
        <div className="pt-4">
          <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider px-2 pb-2">Admin</p>
          {ADMIN_NAV.map(({ id, label, icon }) => {
            const Icon = icon as any;
            const isActive = active === id;
            return (
              <button
                key={id}
                onClick={() => onChange(id)}
                className={cn(
                  'group w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-200 text-left relative border',
                  isActive
                    ? 'bg-primary/10 border-primary/25'
                    : 'hover:bg-[hsl(var(--primary)/0.05)] border-transparent hover:border-[hsl(var(--primary)/0.10)]',
                )}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full"
                    style={{ background: 'linear-gradient(to bottom, hsl(var(--admin-accent) / 0.8), hsl(var(--admin-accent-deep) / 0.5))' }}
                  />
                )}
                <div className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all',
                  isActive ? 'bg-[hsl(var(--primary)/0.25)]' : 'group-hover:bg-[hsl(var(--primary)/0.08)]',
                )}>
                   <HugeiconsIcon icon={icon} size={14} className={cn(
                     isActive ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--muted-foreground))]',
                   )} />
                </div>
                <span className={cn(
                  'text-xs transition-colors',
                  isActive ? 'text-[hsl(var(--muted-foreground))] font-medium' : 'text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--muted-foreground))]',
                )}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* System status indicator */}
      <div className="px-3 py-2" style={{ borderTop: '1px solid hsl(var(--border) / 0.5)' }}>
        <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-[hsl(var(--neon-green))]/05 border border-[hsl(var(--neon-green)/0.1)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--neon-green))] animate-pulse shrink-0" />
          <span className="text-[11px] text-[hsl(var(--neon-green))] font-medium">System Online</span>
        </div>
      </div>

      {/* User footer */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid hsl(var(--border) / 0.5)' }}>
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[hsl(var(--primary)/0.05)] transition-colors cursor-pointer group">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-[hsl(var(--foreground))]"
            style={{ background: 'linear-gradient(135deg, hsl(var(--admin-accent) / 0.8), hsl(var(--admin-accent-deep) / 0.8))' }}
          >
            Z
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] truncate">ZeroByte</p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">Administrator</p>
          </div>
          <Link href="/" className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--muted-foreground))] transition-colors" title="Back to app">
             <HugeiconsIcon icon={ExternalLink} size={12} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
