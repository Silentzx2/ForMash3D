'use client';

import * as React from 'react';

interface SimpleTooltipProps {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  tooltipClassName?: string;
}

export const SimpleTooltip: React.FC<SimpleTooltipProps> = ({ label, children, side = 'right', className = '', tooltipClassName = '' }) => {
  return (
    <div className={`relative inline-flex group ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 px-2.5 py-1.5 text-[10px] font-medium text-[hsl(var(--tooltip-fg))] bg-[hsl(var(--tooltip-bg))] border border-[hsl(var(--tooltip-border))] rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 ${
          typeof label === 'string' ? 'whitespace-nowrap' : 'min-w-[180px] whitespace-normal'
        } ${
          side === 'top'
            ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
            : side === 'bottom'
            ? 'top-full left-1/2 -translate-x-1/2 mt-2'
            : side === 'left'
            ? 'right-full top-1/2 -translate-y-1/2 mr-2'
            : 'left-full top-1/2 -translate-y-1/2 ml-2'
        } ${tooltipClassName}`}
      >
        {label}
      </span>
    </div>
  );
};
