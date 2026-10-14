"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { getApiClient } from '@/services/apiClient';
import { toast } from "sonner";

interface LogLine {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

type ConnStatus = 'CONNECTING' | 'CONNECTED' | 'ERROR' | 'PAUSED';

const LEVEL_COLOR: Record<string, string> = {
  ERROR: '#F44336', FATAL: '#F44336', CRITICAL: '#F44336',
  WARN: '#FFC107', WARNING: '#FFC107',
  INFO: '#4CAF50',
  DEBUG: '#2196F3',
};

// Parse a plain-text log line from Python logging
// Format: "2026-10-09 04:00:00 - module.name - INFO - message"
function parseLine(raw: string): LogLine {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Primary: %(asctime)s - %(name)s - %(levelname)s - %(message)s
  const m1 = raw.match(/^([\d-]+ [\d:,]+)\s+-\s+(.*?)\s+-\s+(INFO|DEBUG|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\s+-\s+(.*)$/i);
  if (m1) {
    const lvl = m1[3].toUpperCase().replace('WARNING', 'WARN');
    return { id, timestamp: m1[1], source: m1[2], level: lvl, message: m1[4] };
  }

  // Fallback: just detect level keyword
  const lvlMatch = raw.match(/\b(INFO|DEBUG|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\b/i);
  const lvl = lvlMatch ? lvlMatch[1].toUpperCase().replace('WARNING', 'WARN') : 'INFO';
  return { id, timestamp: '', source: 'sys', level: lvl, message: raw };
}

function logKey(line: LogLine): string {
  return [line.timestamp, line.level, line.source, line.message].join('\u0000');
}

function countLogLines(lines: LogLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = logKey(line);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isReplayDuplicate(line: LogLine, counts: Map<string, number>): boolean {
  const key = logKey(line);
  const remaining = counts.get(key) ?? 0;
  if (remaining <= 0) return false;
  if (remaining === 1) counts.delete(key);
  else counts.set(key, remaining - 1);
  return true;
}

function capLogLines(lines: LogLine[]): LogLine[] {
  return lines.length > 3000 ? lines.slice(-2500) : lines;
}

export function LogsTab() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState<ConnStatus>('CONNECTING');
  const [autoScroll, setAutoScroll] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const logsRef = useRef<LogLine[]>([]);
  const initialSnapshotLoadedRef = useRef(false);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  // Load the current master.log snapshot as well as subscribing to live writes.
  // The stream replays recent lines, so a counted overlap removes only replayed
  // occurrences while preserving genuinely repeated log messages.
  useEffect(() => {
    if (!live) {
      setStatus('PAUSED');
      return;
    }

    let disposed = false;
    let snapshotReady = initialSnapshotLoadedRef.current;
    let replayCounts = snapshotReady ? countLogLines(logsRef.current) : new Map<string, number>();
    const bufferedStreamLines: LogLine[] = [];

    setStatus('CONNECTING');
    setHistoryError(false);

    const es = new EventSource('/api/v1/system/logs/stream?last_n=500');

    es.onopen = () => {
      if (!disposed) setStatus('CONNECTED');
    };

    const appendLiveLine = (line: LogLine) => {
      if (disposed) return;
      if (!snapshotReady) {
        bufferedStreamLines.push(line);
        return;
      }
      if (isReplayDuplicate(line, replayCounts)) return;
      setLogs(prev => capLogLines([...prev, line]));
    };

    es.onmessage = (e) => {
      const raw = e.data as string;
      // Skip empty, whitespace-only, or SSE comment lines (heartbeats).
      if (!raw || !raw.trim() || raw.startsWith(':')) return;
      appendLiveLine(parseLine(raw));
    };

    es.onerror = () => {
      if (!disposed) setStatus('ERROR');
    };

    if (!snapshotReady) {
      setHistoryLoaded(false);
      void getApiClient().get<any>('/api/v1/system/logs', { params: { lines: 500 } })
        .then((response) => {
          if (disposed) return;

          const entries = Array.isArray(response?.logs) ? response.logs : [];
          // The API returns newest-first; reverse it for terminal chronology.
          const history: LogLine[] = entries.slice().reverse().map((entry: any, index: number) => {
            if (typeof entry?.raw === 'string' && entry.raw.length > 0) {
              return parseLine(entry.raw);
            }
            const level = String(entry?.level || 'INFO').toUpperCase().replace('WARNING', 'WARN');
            return {
              id: String(entry?.id ?? `history-${index}-${entry?.timestamp ?? ''}`),
              timestamp: String(entry?.timestamp ?? ''),
              level,
              source: String(entry?.source || entry?.logger || 'sys'),
              message: String(entry?.message ?? ''),
            };
          });

          replayCounts = countLogLines(history);
          snapshotReady = true;
          initialSnapshotLoadedRef.current = true;

          // The SSE subscription may have replayed these same lines while the
          // history request was in flight. Drop only matching occurrences.
          const liveOnly = bufferedStreamLines.splice(0).filter(
            line => !isReplayDuplicate(line, replayCounts)
          );
          setLogs(capLogLines([...history, ...liveOnly]));
          setHistoryLoaded(true);
          setHistoryError(false);
        })
        .catch(() => {
          if (disposed) return;
          snapshotReady = true;
          const buffered = bufferedStreamLines.splice(0);
          setLogs(prev => capLogLines([...prev, ...buffered]));
          setHistoryLoaded(true);
          setHistoryError(true);
        });
    } else {
      setHistoryLoaded(true);
    }

    return () => {
      disposed = true;
      es.close();
    };
  }, [live]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleScroll = useCallback(() => {
    const el = terminalRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  const handleClear = async () => {
    try {
      await getApiClient().clearLogs();
      setLogs([]);
      toast.success("Logs cleared");
    } catch {
      toast.error("Failed to clear logs");
    }
  };

  const statusColor = status === 'CONNECTED' ? '#4CAF50'
    : status === 'ERROR' ? '#F44336'
    : status === 'PAUSED' ? '#888888'
    : '#FFC107';

  return (
    <div className="relative h-full w-full min-h-[500px]">
      <div
        className="flex flex-col absolute inset-0"
        style={{ backgroundColor: '#1e1e1e', color: '#cccccc', fontFamily: 'Consolas, "Courier New", monospace' }}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#2d2d2d] text-xs flex-shrink-0">
          <div className="flex items-center gap-3">
            <span style={{ color: statusColor }} className="font-bold">● {status}</span>
            <span className="text-[#555555]">logs/master.log</span>
            {status === 'ERROR' && (
              <span className="text-[#F44336] text-[11px]">— backend offline or unreachable</span>
            )}
            {historyError && (
              <span className="text-[#FFC107] text-[11px]">— could not load existing log history</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[#888888]">
            <span>{logs.length} lines</span>
            <button
              onClick={() => setLive(v => !v)}
              className="hover:text-white transition-colors"
            >
              {live ? 'Pause' : 'Resume'}
            </button>
            <button onClick={handleClear} className="hover:text-[#F44336] transition-colors">
              Clear
            </button>
          </div>
        </div>

        {/* Log output */}
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 pb-6 text-[12.5px] leading-5"
          style={{ scrollBehavior: 'smooth' }}
        >
          {logs.length === 0 ? (
            <div className="text-[#555555] mt-2">
              {status === 'CONNECTING' && '⏳ Connecting to log stream...'}
              {status === 'CONNECTED' && !historyLoaded && '⏳ Loading recent entries from master.log...'}
              {status === 'CONNECTED' && historyLoaded && historyError && '⚠ Could not load log history; waiting for live entries...'}
              {status === 'CONNECTED' && historyLoaded && !historyError && '⏳ No entries found in master.log yet — waiting for new log entries...'}
              {status === 'ERROR' && '✗  Cannot reach backend. Start the backend and refresh.'}
              {status === 'PAUSED' && '⏸  Stream paused. Click Resume to reconnect.'}
            </div>
          ) : (
            logs.map(l => {
              const col = LEVEL_COLOR[l.level] || '#cccccc';
              const isErr = l.level === 'ERROR' || l.level === 'FATAL' || l.level === 'CRITICAL';
              return (
                <div key={l.id} className="whitespace-pre-wrap break-all hover:bg-[#252526] py-px">
                  {l.timestamp && (
                    <span className="text-[#555555] mr-2 select-none">
                      {l.timestamp.split(' ')[1] ?? l.timestamp}
                    </span>
                  )}
                  <span style={{ color: col, minWidth: '3.5rem', display: 'inline-block' }} className="font-semibold mr-2 select-none">
                    {l.level}
                  </span>
                  {l.source && l.source !== 'sys' && (
                    <span className="text-[#569cd6] mr-2">[{l.source}]</span>
                  )}
                  <span style={{ color: isErr ? '#F44336' : '#d4d4d4' }}>{l.message}</span>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        {/* Jump to bottom pill */}
        {!autoScroll && logs.length > 0 && (
          <div className="absolute bottom-8 right-6">
            <button
              onClick={() => { setAutoScroll(true); endRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
              className="px-3 py-1 rounded-full text-[11px] font-bold"
              style={{ backgroundColor: '#569cd6', color: '#1e1e1e' }}
            >
              ↓ Jump to latest
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
