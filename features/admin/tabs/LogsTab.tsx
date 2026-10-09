"use client";

import React, { useEffect, useState, useRef } from "react";
import { getApiClient } from '@/services/apiClient';
import { toast } from "sonner";

interface LogLine {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  raw: string;
}

export function LogsTab() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [live, setLive] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // SSE Streaming - real-time log updates (Custom parser for plain text lines)
  useEffect(() => {
    if (!live) return;
    
    // We create our own EventSource because apiClient.streamLogs drops non-JSON payloads
    const es = new EventSource('/api/v1/system/logs/stream?last_n=1000');
    
    es.onmessage = (e) => {
      const lineText = e.data;
      if (!lineText || lineText.trim() === '') return;
      
      // Basic parse: format is often "2026-10-09 03:54:44 - INFO - [source] - message"
      // or "[2026-10-09 03:54:44] [INFO] [source] message"
      // We will try a flexible regex, if it fails, just show raw
      
      const id = `log-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
      let level = 'INFO';
      let timestamp = '';
      let source = 'sys';
      let message = lineText;

      // Match pattern like: 2026-10-09 03:56:05 - backend.server - INFO - The actual message
      // Note: standard python format is: %(asctime)s - %(name)s - %(levelname)s - %(message)s
      let standardMatch = lineText.match(/^([\d-]+ [\d:,]+)\s+-\s+(.*?)\s+-\s+([A-Z]+)\s+-\s+(.*)$/);
      
      if (!standardMatch) {
         // Also support [2026-10-09 03:56:05] [INFO] [source] message
         standardMatch = lineText.match(/^\[([\d-]+ [\d:,]+)\]\s+\[([A-Z]+)\]\s+\[(.*?)\]\s+(.*)$/);
         if (standardMatch) {
            // rearrange to match the first regex group order
            standardMatch = [standardMatch[0], standardMatch[1], standardMatch[3], standardMatch[2], standardMatch[4]];
         }
      }

      if (standardMatch) {
        timestamp = standardMatch[1];
        source = standardMatch[2];
        level = standardMatch[3];
        message = standardMatch[4];
      } else {
        // Fallback match: try to extract something that looks like a level
        const levelMatch = lineText.match(/\b(INFO|ERROR|WARN|WARNING|DEBUG|FATAL|CRITICAL)\b/i);
        if (levelMatch) {
          level = levelMatch[1].toUpperCase();
          if (level === 'WARNING') level = 'WARN';
        }
      }

      const newLog: LogLine = {
        id,
        timestamp,
        level,
        source,
        message,
        raw: lineText
      };

      setLogs((prev) => {
        const next = [...prev, newLog];
        return next.length > 3000 ? next.slice(-2500) : next;
      });
    };

    es.onerror = () => {
      console.warn("SSE logs stream error or reconnecting...");
    };

    return () => {
      es.close();
    };
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
      toast.success("Logs cleared");
    } catch {
      toast.error("Failed to clear backend logs");
    }
  };

  return (
    <div className="relative h-full w-full min-h-[500px]">
      <div 
        className="flex flex-col absolute inset-0 overflow-hidden"
        style={{ backgroundColor: '#1e1e1e', color: '#cccccc', fontFamily: 'Consolas, "Courier New", monospace' }}
      >
        {/* Minimal Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-[#333333] text-xs flex-shrink-0 z-10">
        <div className="flex items-center gap-4">
          <span className="text-[#4CAF50] font-bold">● stream</span>
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
        className="flex-1 overflow-y-auto p-4 text-[13px] leading-relaxed scrollbar-thin scrollbar-thumb-[#424242] pb-8"
        style={{ scrollBehavior: 'smooth' }}
      >
        {logs.length === 0 ? (
          <div className="text-[#888888] italic">Waiting for logs (streaming live from master.log)...</div>
        ) : (
          logs.map((l, index) => {
            const isErr = l.level === 'ERROR' || l.level === 'FATAL' || l.level === 'CRITICAL';
            const isWarn = l.level === 'WARN';
            const isInfo = l.level === 'INFO';
            
            let color = '#cccccc';
            if (isErr) color = '#F44336';
            else if (isWarn) color = '#FFC107';
            else if (isInfo) color = '#4CAF50';
            else if (l.level === 'DEBUG') color = '#2196F3';

            return (
              <div key={l.id} className="whitespace-pre-wrap break-all hover:bg-[#2a2d2e] py-px">
                {l.timestamp && <span className="text-[#888888] mr-2">[{l.timestamp.split(' ')[1] || l.timestamp}]</span>}
                <span style={{ color }} className="font-bold mr-2 w-12 inline-block">
                  {l.level}
                </span>
                {l.source !== 'sys' && <span className="text-[#569cd6] mr-2">[{l.source}]</span>}
                <span style={{ color: isErr ? '#F44336' : '#cccccc' }}>{l.message}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} className="h-4" />
      </div>
    </div>
    </div>
  );
}
