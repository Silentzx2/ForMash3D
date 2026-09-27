'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type StatusState = 'online' | 'offline' | 'warning' | 'error' | 'loading' | 'idle';
type StatusSize = 'sm' | 'md' | 'lg';

interface StatusDotProps {
  status: StatusState;
  size?: StatusSize;
  pulse?: boolean;
  className?: string;
  /** Optional text label rendered next to the dot */
  label?: string;
}

const STATUS_CONFIG: Record<StatusState, { color: string; glow: string; labelColor: string }> = {
  online: {
    color: 'hsl(var(--neon-green))',
    glow: '0 0 6px hsl(var(--neon-green)/0.6), 0 0 14px hsl(var(--neon-green)/0.25)',
    labelColor: 'text-[hsl(var(--neon-green))]',
  },
  offline: {
    color: 'hsl(var(--destructive))',
    glow: '0 0 4px hsl(var(--destructive)/0.4)',
    labelColor: 'text-[hsl(var(--destructive))]',
  },
  warning: {
    color: 'hsl(var(--neon-amber))',
    glow: '0 0 4px hsl(var(--neon-amber)/0.4), 0 0 10px hsl(var(--neon-amber)/0.15)',
    labelColor: 'text-[hsl(var(--neon-amber))]',
  },
  error: {
    color: 'hsl(var(--destructive))',
    glow: '0 0 4px hsl(var(--destructive)/0.5), 0 0 10px hsl(var(--destructive)/0.2)',
    labelColor: 'text-[hsl(var(--destructive))]',
  },
  loading: {
    color: 'hsl(var(--neon-blue))',
    glow: '0 0 4px hsl(var(--neon-blue)/0.4), 0 0 10px hsl(var(--neon-blue)/0.15)',
    labelColor: 'text-[hsl(var(--neon-blue))]',
  },
  idle: {
    color: 'hsl(var(--muted-foreground))',
    glow: 'none',
    labelColor: 'text-muted-foreground',
  },
};

const SIZE_MAP: Record<StatusSize, { dot: number; ring: number }> = {
  sm: { dot: 6, ring: 14 },
  md: { dot: 8, ring: 20 },
  lg: { dot: 10, ring: 24 },
};

export function StatusDot({
  status,
  size = 'md',
  pulse = true,
  className,
  label,
}: StatusDotProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  const s = SIZE_MAP[size];

  return (
    <span
      className={cn('relative inline-flex items-center justify-center gap-2', className)}
      style={{ width: s.ring, height: s.ring }}
    >
      {/* Outer animated ring for online */}
      {status === 'online' && pulse && (
        <motion.span
          className="absolute rounded-full"
          style={{
            width: s.ring,
            height: s.ring,
            border: `1px solid ${cfg.color} / 0.2`,
          }}
          animate={{
            scale: [1, 1.5],
            opacity: [0.5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      )}

      {/* Second outer ring for online */}
      {status === 'online' && pulse && (
        <motion.span
          className="absolute rounded-full"
          style={{
            width: s.ring,
            height: s.ring,
            border: `1px solid ${cfg.color} / 0.12`,
          }}
          animate={{
            scale: [1, 1.8],
            opacity: [0.3, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeOut',
            delay: 0.6,
          }}
        />
      )}

      {/* Pulsing glow for loading state */}
      {status === 'loading' && pulse && (
        <motion.span
          className="absolute rounded-full"
          style={{
            width: s.dot,
            height: s.dot,
            background: cfg.color,
            filter: 'blur(4px)',
          }}
          animate={{
            scale: [1, 1.8],
            opacity: [0.6, 0],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      )}

      {/* Loading: rotating arc */}
      {status === 'loading' && (
        <motion.span
          className="absolute rounded-full"
          style={{
            width: s.dot,
            height: s.dot,
            border: `1.5px solid ${cfg.color} / 0.3`,
            borderTopColor: cfg.color,
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      )}

      {/* Main dot */}
      <motion.span
        className="absolute rounded-full"
        style={{
          width: s.dot,
          height: s.dot,
          background: cfg.color,
          boxShadow: cfg.glow,
        }}
        initial={false}
        animate={
          status === 'loading'
            ? { opacity: [1, 0.5, 1] }
            : status === 'warning' && pulse
              ? { scale: [1, 1.15, 1] }
              : {}
        }
        transition={
          status === 'loading'
            ? { duration: 1, repeat: Infinity, ease: 'easeInOut' }
            : status === 'warning' && pulse
              ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
              : undefined
        }
      />

      {/* Label */}
      {label && (
        <span
          className={cn(
            'text-xs font-medium whitespace-nowrap',
            size === 'sm' && 'text-[10px]',
            cfg.labelColor
          )}
          style={{ marginLeft: s.ring }}
        >
          {label}
        </span>
      )}
    </span>
  );
}