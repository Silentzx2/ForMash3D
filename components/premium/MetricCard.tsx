"use client";


import { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { GlassCard } from './GlassCard';

type MetricColor = 'purple' | 'blue' | 'cyan' | 'green' | 'pink' | 'amber';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  trend?: { value: number; positive: boolean };
  color?: MetricColor;
  delay?: number;
  children?: React.ReactNode;
  /** Array of numbers for a sparkline mini-chart (7-30 points recommended) */
  sparkline?: number[];
}

const ICON_COLORS: Record<MetricColor, { text: string; bg: string; glow: string; accent: string }> = {
  purple: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    glow: '0 0 12px hsl(var(--primary)/0.2)',
    accent: 'hsl(var(--primary))',
  },
  blue: {
    text: 'text-foreground',
    bg: 'bg-[hsl(var(--surface-3))]',
    glow: 'none',
    accent: 'hsl(var(--muted-foreground))',
  },
  cyan: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    glow: '0 0 12px hsl(var(--primary)/0.2)',
    accent: '#FFD866',
  },
  green: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    glow: '0 0 12px rgba(34, 197, 94, 0.2)',
    accent: '#22C55E',
  },
  pink: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    glow: '0 0 12px hsl(var(--primary)/0.2)',
    accent: 'hsl(var(--primary))',
  },
  amber: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    glow: '0 0 12px hsl(var(--primary)/0.2)',
    accent: 'hsl(var(--primary))',
  },
};

/** Hook: animates a numeric value from 0 to target */
function useCountUp(target: number, duration = 1200, delay = 0) {
  const [display, setDisplay] = useState(() => {
    // Initialize with target if it's not a valid number for animation
    if (target === 0 || typeof target !== 'number' || isNaN(target)) return target;
    return 0;
  });
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0 || typeof target !== 'number' || isNaN(target)) return;
    const timeout = setTimeout(() => {
      startRef.current = null;
      const step = (timestamp: number) => {
        if (!startRef.current) startRef.current = timestamp;
        const elapsed = timestamp - startRef.current;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.round(eased * target));
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    }, delay * 1000);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, delay]);

  return display;
}

/** Mini sparkline SVG */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 28;
  const padY = 2;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - padY - ((v - min) / range) * (h - padY * 2);
    return `${x},${y}`;
  });
  const pathD = `M${points.join(' L')}`;
  const areaD = `${pathD} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-20 h-7"
      preserveAspectRatio="none"
      style={{ overflow: 'visible' }}
    >
      {/* Area fill */}
      <path d={areaD} fill={color} opacity={0.08} />
      {/* Line */}
      <motion.path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
      />
      {/* End dot */}
      <motion.circle
        cx={w}
        cy={h - padY - ((data[data.length - 1] - min) / range) * (h - padY * 2)}
        r="2"
        fill={color}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: 1.2 }}
      />
    </svg>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  icon,
  trend,
  color = 'amber',
  delay = 0,
  children,
  sparkline,
}: MetricCardProps) {
  const ic = ICON_COLORS[color] || ICON_COLORS.amber;
  const isNumeric = typeof value === 'number' || (!isNaN(Number(value)) && value !== '');
  const numericVal = isNumeric ? Number(value) : 0;
  const hasDecimals = String(value).includes('.');
  const decimalPlaces = hasDecimals ? String(value).split('.')[1]?.length || 0 : 0;

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 shadow-sm transition-all hover:border-[hsl(var(--border))/0.8]">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <motion.div
              className={cn('flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--surface-2))] text-zinc-300 border border-[hsl(var(--border)/0.5)]')}
              whileHover={{ scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            >
              {icon}
            </motion.div>
          )}
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            {label}
          </span>
        </div>
        {trend && (
          <span
            className={cn(
              'text-xs font-mono inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md',
              trend.positive
                ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                : 'text-rose-400 bg-rose-500/10 border border-rose-500/20'
            )}
          >
            <span>{trend.positive ? '↑' : '↓'}</span>
            {Math.abs(trend.value)}%
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5 font-mono">
          {isNumeric ? (
            <span className="text-2xl font-black text-white">
              {numericVal.toFixed(decimalPlaces)}
            </span>
          ) : (
            <span className="text-2xl font-black text-white">
              {value}
            </span>
          )}
          {unit && (
            <span className="text-xs text-zinc-400 font-sans">
              {unit}
            </span>
          )}
        </div>

        {sparkline && sparkline.length >= 2 && (
          <Sparkline data={sparkline} color={ic.accent} />
        )}
      </div>

      {children}
    </div>
  );
}