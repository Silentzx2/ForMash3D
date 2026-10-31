import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-default',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80 shadow-sm shadow-primary/20',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground border border-border/50 hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80 shadow-sm shadow-destructive/20',
        outline: 'text-foreground border-border bg-card/50',
        success:
          'border-transparent bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
        warning:
          'border-transparent bg-amber-500/20 text-amber-400 border border-amber-500/30',
        active:
          'border-transparent bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
        pending:
          'border-transparent bg-amber-500/20 text-amber-400 border border-amber-500/30',
        failed:
          'border-transparent bg-destructive/20 text-destructive border border-destructive/30',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
