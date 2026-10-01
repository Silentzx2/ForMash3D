"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { TriangleAlertIcon, RefreshCwIcon, ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const handleReset = () => {
    setIsRetrying(true);
    // Small delay to let the spinner animate before the page unmounts
    setTimeout(() => reset(), 600);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center overflow-hidden relative">
      
      {/* Background Effects */}
      <div className="absolute inset-0 bg-mesh-gradient pointer-events-none" />
      
      {/* Corrupted Red/Orange Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-[hsl(var(--destructive)/0.08)] blur-[120px] rounded-full pointer-events-none animate-pulse" />
      
      {/* Horizontal Glitch Line */}
      <div 
        className="absolute left-0 w-full h-px bg-gradient-to-r from-transparent via-[hsl(var(--destructive)/0.6)] to-transparent pointer-events-none z-20"
        style={{ animation: 'error-scanline 3s linear infinite' }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8">
        
        {/* Icon with Pulse Rings */}
        <div className="relative flex items-center justify-center w-32 h-32">
          {/* Pulse Ring 1 */}
          <div 
            className="absolute inset-0 rounded-3xl border border-[hsl(var(--destructive)/0.4)]"
            style={{ animation: 'error-pulse-ring 2s ease-out infinite' }}
          />
          {/* Pulse Ring 2 (Delayed) */}
          <div 
            className="absolute inset-0 rounded-3xl border border-[hsl(var(--destructive)/0.4)]"
            style={{ animation: 'error-pulse-ring 2s ease-out infinite 0.6s' }}
          />
          
          {/* Main Icon Container */}
          <div className="relative z-10 flex items-center justify-center w-20 h-20 rounded-2xl bg-[hsl(var(--destructive)/0.1)] border border-[hsl(var(--destructive)/0.3)] backdrop-blur-sm shadow-[0_0_40px_hsl(var(--destructive)/0.2)]"
               style={{ animation: 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards', opacity: 0 }}
          >
            <HugeiconsIcon 
              icon={TriangleAlertIcon} 
              size={40} 
              className="w-10 h-10 text-[hsl(var(--destructive))]" 
              style={{ animation: 'icon-glitch 0.6s infinite linear' }}
            />
          </div>
        </div>

        {/* Text Content */}
        <div className="space-y-4">
          <p 
            className="text-sm font-semibold text-[hsl(var(--destructive))] tracking-widest uppercase font-mono"
            style={{ animation: 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards', opacity: 0 }}
          >
            {/* System Exception */}
          </p>
          
          <h1 
            className="text-4xl sm:text-5xl font-bold tracking-tight"
            style={{ animation: 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards, error-flicker 4s linear infinite', opacity: 0 }}
          >
            Something <span className="text-[hsl(var(--destructive))]">crashed</span>
          </h1>
          
          <p 
            className="text-lg text-muted-foreground max-w-md leading-relaxed"
            style={{ animation: 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards', opacity: 0 }}
          >
            A critical error disrupted the neural engine. The system state has been corrupted.
          </p>

          {/* Terminal Style Error Message */}
          {error.message && (
            <div 
              className="relative mt-4 px-5 py-4 rounded-xl bg-black/50 border border-[hsl(var(--destructive)/0.2)] max-w-md text-left overflow-hidden"
              style={{ animation: 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.5s forwards', opacity: 0 }}
            >
              {/* Scanline inside terminal */}
              <div 
                className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[hsl(var(--destructive)/0.5)] to-transparent"
                style={{ animation: 'error-scanline 4s linear infinite' }}
              />
              <p className="text-[10px] font-mono text-[hsl(var(--destructive)/0.7)] mb-2 uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[hsl(var(--destructive))] animate-pulse" />
                Error Log
              </p>
              <code className="block text-xs text-muted-foreground/80 font-mono break-all leading-relaxed">
                {error.message}
              </code>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div 
          className="flex flex-col sm:flex-row items-center gap-4 mt-2"
          style={{ animation: 'fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards', opacity: 0 }}
        >
          <Button 
            variant="ghost" 
            onClick={handleReset}
            disabled={isRetrying}
            className="border border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--surface-2))] hover:border-foreground/20 transition-all duration-300 w-full sm:w-auto"
          >
            <HugeiconsIcon icon={RefreshCwIcon} size={16} className={`w-4 h-4 mr-2 transition-transform duration-500 ${isRetrying ? 'animate-spin' : ''}`} />
            {isRetrying ? 'Rebooting...' : 'Try Again'}
          </Button>
          
          <Link href="/" className="w-full sm:w-auto group">
            <Button className="w-full bg-primary text-[#080808] hover:bg-primary/90 font-bold shadow-sm transition-all duration-300 hover:scale-105">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="w-4 h-4 mr-2 transition-transform group-hover:-translate-x-1" />
              Abort to Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}