'use client';

import { motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/lib/utils';

type CardIntensity = 'subtle' | 'default' | 'strong' | 'ultra';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  intensity?: CardIntensity;
  // Legacy props (now ignored for backward compatibility)
  hover?: boolean;
  glow?: boolean;
  animatedBorder?: boolean;
  spotlight?: boolean;
  shimmer?: boolean;
  featured?: boolean;
}

const CARD_CLASSES: Record<CardIntensity, string> = {
  subtle: 'glass-subtle',
  default: 'glass-card',
  strong: 'glass-strong',
  ultra: 'glass-ultra',
};

export function GlassCard({
  children,
  className,
  delay = 0,
  intensity = 'default',
  ...motionProps
}: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay,
        ease: 'easeOut',
      }}
      className={cn(
        'rounded-lg overflow-hidden group',
        CARD_CLASSES[intensity],
        className
      )}
      style={{
        contain: 'layout style',
        ...motionProps.style,
      }}
      {...motionProps}
    >
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}