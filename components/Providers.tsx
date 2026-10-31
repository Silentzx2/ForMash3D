"use client";

import { ActivityLogger } from "@/components/ActivityLogger";
import { WorkspaceProvider } from "@/features/workspace/store/WorkspaceContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ActivityLogger />
        <WorkspaceProvider>
          <div className="relative z-10 min-h-screen flex flex-col">
            {children}
          </div>
          <Toaster position="bottom-right" richColors />
        </WorkspaceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
