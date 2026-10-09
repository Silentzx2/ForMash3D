"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { getApiClient } from '@/services/apiClient';
import type { AdminLog } from "@/types";
import { toast } from "sonner";

export function LogsTab() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [live, setLive] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // SSE Streaming - real-time log updates
  useEffect(() => {
    if (!live) return;
    const apiClient = getApiClient();
    const cleanup = apiClient.streamLogs(
      (entry) => {
        const key = entry.id || `${entry.timestamp}-${entry.source}-${entry.message}`;
        if (seenIds.current.has(key)) return;
        seenIds.current.add(key);
        
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 3000 ? next.slice(-2500) : next;
        });
      },
      1000
    );

    return () => cleanup();
  }, [live]);

  // Auto-scroll
  useEffect(() => {
    if (live && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, live]);

  const handleClear = async () => {
    try {
      await getApiClient().clearLogs();
      setLogs([]);
      seenIds.current.clear();
    } catch {
      toast.error("Failed to clear backend logs");
    }
  };

  return (
    <div 
      className="flex flex-col h-[calc(100vh-130px)] min-h-[550px] overflow-hidden"
      style={{ backgroundColor: '#1e1e1e', color: '#cccccc', fontFamily: 'Consolas, "Courier New", monospace' }}
    >
      {/* Minimal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-[#333333] text-xs">
        <div className="flex items-center gap-4">
          <span className="text-[#4CAF50]">● stream</span>
          <span className="text-[#888888]">~/logs/master.log</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setLive(!live)} className="hover:text-white transition-colors">
            {live ? "Pause" : "Resume"}
          </button>
          <button onClick={handleClear} className="hover:text-[#F44336] transition-colors">
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div 
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-4 text-[13px] leading-relaxed scrollbar-thin scrollbar-thumb-[#424242]"
        style={{ scrollBehavior: 'smooth' }}
      >
        {logs.length === 0 ? (
          <div className="text-[#888888] italic">Waiting for logs...</div>
        ) : (
          logs.map((l, index) => {
            const isErr = l.level?.toLowerCase() === 'error';
            const isWarn = l.level?.toLowerCase() === 'warn';
            const isInfo = l.level?.toLowerCase() === 'info';
            
            let color = '#cccccc';
            if (isErr) color = '#F44336';
            else if (isWarn) color = '#FFC107';
            else if (isInfo) color = '#4CAF50';
            else if (l.level?.toLowerCase() === 'debug') color = '#2196F3';

            return (
              <div key={l.id || `${l.timestamp}-${index}`} className="whitespace-pre-wrap break-all hover:bg-[#2a2d2e]">
                <span className="text-[#888888] mr-2">[{l.timestamp?.split(' ')[1] || l.timestamp}]</span>
                <span style={{ color }} className="font-bold mr-2 w-12 inline-block">
                  {l.level?.toUpperCase() || 'INFO'}
                </span>
                <span className="text-[#569cd6] mr-2">[{l.source || 'sys'}]</span>
                <span style={{ color: isErr ? '#F44336' : '#cccccc' }}>{l.message}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
