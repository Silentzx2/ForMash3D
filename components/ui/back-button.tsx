"use client";

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BackButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  variant?: 'default' | 'ghost' | 'outline' | 'secondary';
  label?: string;
}

// Pages where the back button should never appear
const HIDE_ON = ['/'];

export function BackButton({ className, variant = 'ghost', label = 'Back', ...props }: BackButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // history.length > 1 means there's something to go back to.
    // We also guard against the initial direct-navigation case where
    // the referrer is empty or from a different origin.
    const hasHistory = window.history.length > 1;
    const referrer = document.referrer;
    const sameOrigin = referrer && referrer.startsWith(window.location.origin);
    setCanGoBack(hasHistory && !!sameOrigin);
  }, [pathname]);

  // Don't render on root/home pages or when there's nowhere to go back
  if (HIDE_ON.includes(pathname) || !canGoBack) return null;

  return (
    <Button
      variant={variant}
      onClick={() => router.back()}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-all duration-200',
        'hover:-translate-x-0.5',
        className
      )}
      aria-label="Go back"
      {...props}
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1" />
      {label}
    </Button>
  );
}
