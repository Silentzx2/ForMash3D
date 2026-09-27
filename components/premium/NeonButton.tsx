'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type NeonColor = 'purple' | 'blue' | 'cyan' | 'pink' | 'green' | 'amber';
type NeonSize = 'sm' | 'md' | 'lg';
type NeonVariant = 'solid' | 'outline' | 'ghost' | 'primary' | 'destructive' | 'secondary';

interface NeonButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'onDrag' | 'onDragEnd' | 'onDragStart' | 'onDragOver' | 'onDragLeave'> {
  color?: NeonColor;
  size?: NeonSize;
  variant?: NeonVariant;
  glow?: boolean;
  /** Show loading state with shimmer */
  loading?: boolean;
  /** Icon element rendered before children */
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

const COLOR_MAP: Record<NeonColor, { from: string; to: string; glow: string; border: string; textClass: string; bgClass: string; solidTextClass: string }> = {
  purple: {
    from: '#FFE066',
    to: '#E09800',
    glow: 'rgba(255, 204, 0, 0.45)',
    border: 'hsl(var(--primary)/0.5)',
    textClass: 'text-primary',
    bgClass: 'bg-primary/10',
    solidTextClass: 'text-[#080808]',
  },
  blue: {
    from: '#2A2A2A',
    to: '#1A1A1A',
    glow: 'hsl(var(--surface-4))',
    border: 'hsl(var(--border))',
    textClass: 'text-foreground',
    bgClass: 'bg-[hsl(var(--surface-2))]',
    solidTextClass: 'text-foreground',
  },
  cyan: {
    from: '#FFE066',
    to: '#FFCC00',
    glow: 'rgba(255, 204, 0, 0.45)',
    border: 'hsl(var(--primary)/0.5)',
    textClass: 'text-primary',
    bgClass: 'bg-primary/10',
    solidTextClass: 'text-[#080808]',
  },
  pink: {
    from: '#FFE066',
    to: '#E09800',
    glow: 'rgba(255, 204, 0, 0.45)',
    border: 'hsl(var(--primary)/0.5)',
    textClass: 'text-primary',
    bgClass: 'bg-primary/10',
    solidTextClass: 'text-[#080808]',
  },
  green: {
    from: '#22C55E',
    to: '#16A34A',
    glow: '#22C55E',
    border: 'rgba(34, 197, 94, 0.5)',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    solidTextClass: 'text-[#080808]',
  },
  amber: {
    from: '#FFE066',
    to: '#E09800',
    glow: 'rgba(255, 204, 0, 0.45)',
    border: 'hsl(var(--primary)/0.5)',
    textClass: 'text-primary',
    bgClass: 'bg-primary/10',
    solidTextClass: 'text-[#080808]',
  },
};

const SIZES: Record<NeonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
};

export function NeonButton({
  children,
  className,
  color = 'amber',
  size = 'md',
  variant = 'solid',
  glow = false,
  loading = false,
  icon,
  disabled,
  style,
  ...props
}: NeonButtonProps) {
  const c = COLOR_MAP[color];

  const variantBase: Record<NeonVariant, string> = {
    solid: cn(c.solidTextClass, 'font-bold border-t border-white/50 shadow-[0_4px_16px_rgba(255,204,0,0.38),inset_0_1px_0_rgba(255,255,255,0.6)]'),
    outline: cn('bg-transparent border', c.textClass),
    ghost: cn('bg-transparent border-transparent', c.textClass, 'hover:bg-[hsl(var(--surface-2))]'),
    primary: 'text-[#080808] font-bold bg-gradient-to-r from-[#FFE066] via-[#FFCC00] to-[#E09800] hover:brightness-105 border-t border-white/50 shadow-[0_4px_16px_rgba(255,204,0,0.38),inset_0_1px_0_rgba(255,255,255,0.6)]',
    destructive: 'text-white border-transparent bg-destructive hover:bg-destructive/90 shadow-sm',
    secondary: 'bg-[hsl(var(--surface-2))] border border-white/[0.12] text-foreground hover:bg-[hsl(var(--surface-3))] shadow-sm',
  };

  const glowShadow = `0 0 12px ${c.glow} / 0.25, 0 0 30px ${c.glow} / 0.1`;

  return (
    <motion.button
      whileHover={disabled || loading ? undefined : { scale: 1.02 }}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      className={cn(
        'relative inline-flex items-center justify-center rounded-xl font-medium border overflow-hidden',
        'transition-shadow duration-300',
        SIZES[size],
        disabled && 'opacity-50 cursor-not-allowed',
        variantBase[variant],
        className
      )}
      disabled={disabled || loading}
      style={{
        ...(variant === 'solid'
          ? {
              background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
            }
          : {}),
        ...(variant === 'outline'
          ? {
              borderColor: c.border,
            }
          : {}),
        ...(glow ? { boxShadow: glowShadow } : {}),
        ...style,
      }}
      // {...props}
    >
      {/* Animated gradient background for solid variant */}
      {variant === 'solid' && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(135deg, ${c.from}, ${c.to}, ${c.from})`,
            backgroundSize: '200% 100%',
            animation: 'gradient-pan 4s ease infinite',
          }}
        />
      )}

      {/* Animated gradient border for solid variant */}
      {variant === 'solid' && (
        <div
          className="absolute inset-0 pointer-events-none rounded-xl"
          style={{
            padding: '1px',
            background: `linear-gradient(135deg, ${c.from} / 0.8, ${c.to} / 0.4, ${c.from} / 0.6)`,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />
      )}

      {/* Outline variant: subtle gradient border */}
      {variant === 'outline' && (
        <div
          className="absolute inset-0 pointer-events-none rounded-xl"
          style={{
            padding: '1px',
            background: `linear-gradient(135deg, ${c.border}, ${c.to} / 0.2, ${c.border})`,
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />
      )}

      {/* Loading shimmer sweep */}
      {loading && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(105deg, transparent 35%, hsl(var(--foreground) / 0.2) 45%, hsl(var(--foreground) / 0.3) 50%, hsl(var(--foreground) / 0.2) 55%, transparent 65%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s ease-in-out infinite',
          }}
        />
      )}

      {/* Hover shimmer sweep (non-loading) */}
      {!loading && (
        <div
          className="absolute inset-0 pointer-events-none opacity-0 hover:opacity-100 transition-opacity duration-300"
          style={{
            background: 'linear-gradient(105deg, transparent 40%, hsl(var(--foreground) / 0.12) 47%, hsl(var(--foreground) / 0.18) 50%, hsl(var(--foreground) / 0.12) 53%, transparent 60%)',
            backgroundSize: '200% 100%',
            animation: 'text-shimmer 3s linear infinite',
          }}
        />
      )}

      {/* Hover glow for solid variant */}
      {variant === 'solid' && !loading && (
        <div
          className="absolute inset-0 pointer-events-none rounded-xl opacity-0 hover:opacity-100 transition-opacity duration-300"
          style={{
            boxShadow: `0 0 20px ${c.glow} / 0.3, 0 0 40px ${c.glow} / 0.1, inset 0 0 20px hsl(var(--foreground) / 0.05)`,
          }}
        />
      )}

      {/* Content */}
      <span className="relative z-10 inline-flex items-center">
        {icon && (
          <motion.span
            className="flex-shrink-0"
            whileHover={{ rotate: 15, scale: 1.1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          >
            {icon}
          </motion.span>
        )}
        {loading ? (
          <motion.span
            className="inline-flex items-center gap-1.5"
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {children}
          </motion.span>
        ) : (
          children
        )}
      </span>
    </motion.button>
  );
}