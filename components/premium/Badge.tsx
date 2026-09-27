'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'neon';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
  /** Pulse animation for "live" badges */
  pulse?: boolean;
  /** Show a small colored dot indicator before the content */
  dot?: boolean;
}

const VARIANT_STYLES: Record<BadgeVariant, { text: string; bg: string; border: string; hoverBg: string; hoverBorder: string; glow: string; dotColor: string }> = {
  default: {
    text: 'text-muted-foreground',
    bg: 'bg-[hsl(var(--surface-2)/0.6)]',
    border: 'border-[hsl(var(--border)/0.5)]',
    hoverBg: 'hover:bg-[hsl(var(--surface-3))]',
    hoverBorder: 'hover:border-[hsl(var(--border))]',
    glow: 'none',
    dotColor: 'bg-muted-foreground',
  },
  success: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    hoverBg: 'hover:bg-emerald-500/15',
    hoverBorder: 'hover:border-emerald-500/30',
    glow: 'none',
    dotColor: 'bg-emerald-400',
  },
  warning: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/25',
    hoverBg: 'hover:bg-primary/16',
    hoverBorder: 'hover:border-primary/40',
    glow: 'none',
    dotColor: 'bg-primary',
  },
  error: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    hoverBg: 'hover:bg-red-500/15',
    hoverBorder: 'hover:border-red-500/30',
    glow: 'none',
    dotColor: 'bg-red-400',
  },
  info: {
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/20',
    hoverBg: 'hover:bg-sky-500/15',
    hoverBorder: 'hover:border-sky-500/30',
    glow: 'none',
    dotColor: 'bg-sky-400',
  },
  neon: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/25',
    hoverBg: 'hover:bg-primary/20',
    hoverBorder: 'hover:border-primary/40',
    glow: '0 0 8px hsl(var(--primary)/0.25)',
    dotColor: 'bg-primary',
  },
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-px text-[10px] leading-4 gap-1',
  md: 'px-2.5 py-0.5 text-xs leading-4 gap-1.5',
};

const DOT_SIZE: Record<BadgeSize, string> = {
  sm: 'w-1 h-1',
  md: 'w-1.5 h-1.5',
};

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className,
  pulse = false,
  dot = false,
}: BadgeProps) {
  const v = VARIANT_STYLES[variant];

  return (
    <motion.span
      className={cn(
        'relative inline-flex items-center rounded-full font-medium border',
        'transition-all duration-300 ease-out',
        v.text, v.bg, v.border, v.hoverBg, v.hoverBorder,
        SIZE_CLASSES[size],
        className
      )}
      style={{
        boxShadow: v.glow !== 'none' ? v.glow : undefined,
      }}
      whileHover={{ scale: 1.03 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    >
      {/* Dot indicator */}
      {dot && (
        <span className="relative flex items-center justify-center">
          <span className={cn('rounded-full', DOT_SIZE[size], v.dotColor)} />
          {pulse && (
            <motion.span
              className={cn('absolute rounded-full', DOT_SIZE[size], v.dotColor)}
              animate={{ scale: [1, 1.8, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </span>
      )}
      {children}
    </motion.span>
  );
}