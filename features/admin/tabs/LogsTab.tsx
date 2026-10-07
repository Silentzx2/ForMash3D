"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  Terminal, Search, Trash2, XCircle, CheckCircle, Check,
  RefreshCw, Copy, Pause, WrapText, Download,
  ArrowDown, X
} from "lucide-react";
import { getApiClient } from '@/services/apiClient';
import type { AdminLog } from "@/types";
import { toast } from "sonner";

type LevelKey = "all" | "info" | "success" | "warn" | "error" | "debug";

const LEVEL_STYLE: Record<string, { badge: string; text: string; label: string }> = {
  info:    { badge: "bg-[hsl(var(--log-info))]/20 text-[hsl(var(--log-info))] border-[hsl(var(--log-info))]/40", text: "text-[hsl(var(--log-info))]", label: "INFO" },
  success: { badge: "bg-[hsl(var(--log-success))]/20 text-[hsl(var(--log-success))] border-[hsl(var(--log-success))]/40", text: "text-[hsl(var(--log-success))]", label: "OK  " },
  warn:    { badge: "bg-[hsl(var(--log-warn))]/20 text-[hsl(var(--log-warn))] border-[hsl(var(--log-warn))]/40", text: "text-[hsl(var(--log-warn))]", label: "WARN" },
  error:   { badge: "bg-[hsl(var(--log-error))]/20 text-[hsl(var(--log-error))] border-[hsl(var(--log-error))]/40", text: "text-[hsl(var(--log-error))]", label: "ERR " },
  debug:   { badge: "bg-[hsl(var(--log-debug))]/20 text-[hsl(var(--log-debug))] border-[hsl(var(--log-debug))]/40", text: "text-[hsl(var(--log-debug))]", label: "DBG " },
};

function formatTime(ts: string): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T"));
  if (isNaN(d.getTime())) return ts.slice(11, 19) || ts;
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function formatFullTs(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T"));
  if (isNaN(d.getTime())) return ts;
  return `${d.toISOString().slice(0, 10)} ${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function LogsTab() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LevelKey>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [live, setLive] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [copied, setCopied] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const isAutoScrollRef = useRef(autoScroll);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  isAutoScrollRef.current = autoScroll;

  // Load initial logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getApiClient().getLogs(1000, level === "all" ? undefined : level);
      setLogs(data);
      seenIds.current = new Set(data.map((l) => l.id || `${l.timestamp}-${l.source}-${l.message}`));
    } catch {
      toast.error("Failed to load backend logs");
    } finally {
      setLoading(false);
    }
  }, [level]);

  // Initial fetch on mount or level filter change
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Live polling - fetch new logs every 3s and append smoothly
  useEffect(() => {
    if (!live) return;

    const poll = async () => {
      try {
        const data = await getApiClient().getLogs(1000, level === "all" ? undefined : level);
        const newEntries = data.filter(
          (l) => !seenIds.current.has(l.id || `${l.timestamp}-${l.source}-${l.message}`)
        );

        if (newEntries.length > 0) {
          newEntries.forEach((entry) => {
            const key = entry.id || `${entry.timestamp}-${entry.source}-${entry.message}`;
            seenIds.current.add(key);
          });

          setLogs((prev) => {
            const next = [...prev, ...newEntries];
            if (next.length > 2500) {
              return next.slice(-2000);
            }
            return next;
          });
        }
      } catch {
        // Silent failure for polling - don't spam toasts
      }
    };

    // Initial poll
    void poll();

    // Set up 3-second interval
    pollTimerRef.current = setInterval(poll, 3000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [live, level]);

  // Scroll listener for detecting user manual scroll vs auto-scroll
  const handleScroll = useCallback(() => {
    const el = terminalRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (isAtBottom) {
      setAutoScroll(true);
      setShowJumpToLatest(false);
    } else {
      setAutoScroll(false);
      setShowJumpToLatest(true);
    }
  }, []);

  // Auto-scroll when new logs arrive if enabled
  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Derived available sources
  const sources = useMemo(() => {
    const s = new Set(logs.map((l) => l.source).filter(Boolean));
    return ["all", ...Array.from(s).sort()];
  }, [logs]);

  // Filter logs by search, level, and source
  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (level !== "all" && l.level !== level) return false;
      if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
      if (q) {
        const msgMatch = l.message?.toLowerCase().includes(q);
        const srcMatch = l.source?.toLowerCase().includes(q);
        if (!msgMatch && !srcMatch) return false;
      }
      return true;
    });
  }, [logs, level, sourceFilter, search]);

  // Level counts
  const counts = useMemo(() => {
    const c = { all: logs.length, info: 0, success: 0, warn: 0, error: 0, debug: 0 };
    for (const l of logs) {
      if (l.level in c) {
        c[l.level as keyof typeof c]++;
      }
    }
    return c;
  }, [logs]);

  // Copy logs
  const handleCopy = async () => {
    if (filteredLogs.length === 0) {
      toast.info("No logs to copy");
      return;
    }
    try {
      const text = filteredLogs
        .map((l) => `[${formatFullTs(l.timestamp)}] [${(l.level || 'info').toUpperCase()}] [${l.source || 'sys'}] ${l.message}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`Copied ${filteredLogs.length} log lines to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy logs");
    }
  };

  // Download logs
  const handleDownload = () => {
    if (filteredLogs.length === 0) {
      toast.info("No logs to download");
      return;
    }
    try {
      const text = filteredLogs
        .map((l) => `[${formatFullTs(l.timestamp)}] [${(l.level || 'info').toUpperCase()}] [${l.source || 'sys'}] ${l.message}`)
        .join("\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `formash-3d-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filteredLogs.length} log lines`);
    } catch {
      toast.error("Failed to download logs");
    }
  };

  // Clear logs via backend DELETE endpoint
  const handleClear = async () => {
    setIsClearing(true);
    try {
      await getApiClient().clearLogs();
      setLogs([]);
      seenIds.current.clear();
      toast.success("All logs cleared successfully");
    } catch {
      toast.error("Failed to clear backend logs");
    } finally {
      setIsClearing(false);
    }
  };

  const jumpToBottom = () => {
    setAutoScroll(true);
    setShowJumpToLatest(false);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-[hsl(var(--log-warn))]/40 text-[hsl(var(--log-warn))] font-bold px-0.5 rounded">
          {text.slice(idx, idx + query.length)}
        </span>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div id="page-terminal-logs" className="flex flex-col h-[calc(100vh-130px)] min-h-[550px] bg-[hsl(var(--surface-0))] rounded-xl border border-[hsl(var(--border))] overflow-hidden text-xs">
      {/* ── Terminal Title Bar ── */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[hsl(var(--surface-1))] border-b border-[hsl(var(--border))]">
        {/* Terminal dots & command path */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--destructive))]/80 border border-[hsl(var(--destructive))]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--log-warn))]/80 border border-[hsl(var(--log-warn))]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--log-success))]/80 border border-[hsl(var(--log-success))]" />
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))] truncate">
            <Terminal className="w-3.5 h-3.5 text-[hsl(var(--log-info))]" />
            <span className="text-[hsl(var(--log-info))] font-semibold">fastapi@studio</span>
            <span className="text-[hsl(var(--muted-foreground))]">:</span>
            <span className="text-[hsl(var(--foreground))]">~/logs</span>
            <span className="text-[hsl(var(--muted-foreground))]">$</span>
            <span className="text-[hsl(var(--foreground))] font-normal">poll logs 3s</span>
          </div>
        </div>

        {/* Live Stream Status & Action Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Live / Paused toggle */}
          <button
            onClick={() => setLive((v) => !v)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold flex items-center gap-1.5 transition-all ${
              live
                ? "bg-[hsl(var(--log-success))]/15 text-[hsl(var(--log-success))] border border-[hsl(var(--log-success))]/30 shadow-sm"
                : "bg-[hsl(var(--surface-2))]/20 text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]/30"
            }`}
            title={live ? "Click to pause live polling" : "Click to resume live polling"}
          >
            {live ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--log-success))] animate-pulse" />
                <span>POLLING</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" />
                <span>PAUSED</span>
              </>
            )}
          </button>

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="px-2 py-1 rounded-md bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:text-[hsl(var(--foreground))] flex items-center gap-1 transition-colors"
            title="Copy filtered logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[hsl(var(--log-success))]" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="font-mono text-[10.5px]">Copy</span>
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="px-2 py-1 rounded-md bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:text-[hsl(var(--foreground))] flex items-center gap-1 transition-colors"
            title="Download log file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="font-mono text-[10.5px]">Export</span>
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            disabled={isClearing}
            className="px-2 py-1 rounded-md bg-[hsl(var(--destructive))]/10 hover:bg-[hsl(var(--destructive))]/20 border border-[hsl(var(--destructive))]/30 text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))] flex items-center gap-1 transition-colors disabled:opacity-50"
            title="Clear all application logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="font-mono text-[10.5px]">Clear</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => fetchLogs()}
            disabled={loading}
            className="p-1 rounded-md bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-3))] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            title="Refresh logs from server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[hsl(var(--log-info))]" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Filter & Search Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-[hsl(var(--surface-1))] border-b border-[hsl(var(--border))]">
        {/* Level Badges */}
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "info", "success", "warn", "error", "debug"] as LevelKey[]).map((lvl) => {
            const isSelected = level === lvl;
            const count = lvl === "all" ? counts.all : counts[lvl as keyof typeof counts] || 0;
            return (
              <button
                key={lvl}
                onClick={() => setLevel(lvl)}
                className={`px-2 py-0.5 rounded text-[10.5px] font-mono uppercase font-semibold transition-all flex items-center gap-1 ${
                  isSelected
                    ? "bg-[hsl(var(--log-info))] text-white shadow-sm"
                    : "bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-3))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))]"
                }`}
              >
                <span>{lvl}</span>
                <span className={`text-[9px] px-1 py-0.2 rounded ${
                  isSelected ? "bg-black/30 text-white" : "bg-[hsl(var(--surface-3))] text-[hsl(var(--muted-foreground))]"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search, Source Filter & Wrap Toggle */}
        <div className="flex items-center gap-2">
          {/* Source dropdown */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">SRC:</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded px-1.5 py-0.5 text-[10.5px] font-mono text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--log-info))]"
            >
              {sources.map((s) => (
                <option key={s} value={s} className="bg-[hsl(var(--surface-2))] text-[hsl(var(--foreground))]">
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Search box */}
          <div className="relative">
            <Search className="w-3 h-3 text-[hsl(var(--muted-foreground))] absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-6 pr-5 py-0.5 w-36 lg:w-48 bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded text-[11px] font-mono text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:border-[hsl(var(--log-info))]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>

          {/* Wrap toggle */}
          <button
            onClick={() => setWrap((w) => !w)}
            className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono flex items-center gap-1 border transition-colors ${
              wrap
                ? "bg-[hsl(var(--log-info))]/15 border-[hsl(var(--log-info))]/40 text-[hsl(var(--log-info))]"
                : "bg-[hsl(var(--surface-2))] border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
            title="Toggle word wrap"
          >
            <WrapText className="w-3 h-3" />
            <span>Wrap</span>
          </button>
        </div>
      </div>

      {/* ── Main Terminal Log Stream Area ── */}
      <div
        ref={terminalRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto p-3 font-mono text-[11.5px] leading-relaxed bg-[hsl(var(--surface-0))] text-[hsl(var(--foreground))] space-y-0.5 scrollbar-thin scrollbar-thumb-[hsl(var(--border))]"
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-[hsl(var(--muted-foreground))] font-mono">
            <RefreshCw className="w-4 h-4 animate-spin mr-2 text-[hsl(var(--log-info))]" />
            <span>Loading logs from backend...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[hsl(var(--muted-foreground))] font-mono space-y-1">
            <Terminal className="w-6 h-6 text-[hsl(var(--muted-foreground))]" />
            <span>No log entries match the current filter.</span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Try clearing search or changing the log level.</span>
          </div>
        ) : (
          filteredLogs.map((l, index) => {
            const levelStyle = LEVEL_STYLE[l.level?.toLowerCase()] || LEVEL_STYLE.info;
            return (
              <div
                key={l.id || `${l.timestamp}-${index}`}
                className={`flex items-start gap-2 px-1.5 py-0.5 rounded hover:bg-[hsl(var(--surface-2))] transition-colors ${
                  wrap ? "flex-wrap" : "whitespace-pre"
                }`}
              >
                {/* Line number */}
                <span className="text-[hsl(var(--muted-foreground))] select-none text-[10px] w-8 text-right flex-shrink-0 font-mono">
                  {index + 1}
                </span>

                {/* Timestamp */}
                <span
                  className="text-[hsl(var(--muted-foreground))] select-none flex-shrink-0 font-mono text-[10.5px]"
                  title={formatFullTs(l.timestamp)}
                >
                  {formatTime(l.timestamp)}
                </span>

                {/* Level badge */}
                <span
                  className={`px-1 py-0.1 rounded text-[9.5px] font-bold tracking-wider flex-shrink-0 border ${levelStyle.badge}`}
                >
                  {levelStyle.label}
                </span>

                {/* Source tag */}
                <span className="text-[hsl(var(--log-debug))] font-semibold flex-shrink-0">
                  [{l.source || "sys"}]
                </span>

                {/* Log message content */}
                <span className={`text-[hsl(var(--foreground))] flex-1 ${wrap ? "break-words" : ""}`}>
                  {highlightMatch(l.message, search)}
                </span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* ── Floating Jump to Bottom Button ── */}
      {showJumpToLatest && (
        <div className="relative">
          <button
            onClick={jumpToBottom}
            className="absolute bottom-3 right-4 px-3 py-1.5 rounded-full bg-[hsl(var(--log-info))] hover:bg-[hsl(var(--log-info))]/90 text-[hsl(var(--surface-0))] font-mono font-bold text-[11px] shadow-lg flex items-center gap-1.5 animate-bounce z-10 transition-transform active:scale-95"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Jump to latest</span>
          </button>
        </div>
      )}

      {/* ── Terminal Status Bar Footer ── */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[hsl(var(--surface-1))] border-t border-[hsl(var(--border))] font-mono text-[10.5px] text-[hsl(var(--muted-foreground))]">
        <div className="flex items-center gap-3">
          <span>
            LINES: <strong className="text-[hsl(var(--foreground))]">{filteredLogs.length}</strong> / {logs.length}
          </span>
          <span>
            AUTO-SCROLL: <strong className={autoScroll ? "text-[hsl(var(--log-success))]" : "text-[hsl(var(--muted-foreground))]"}>{autoScroll ? "ON" : "OFF"}</strong>
          </span>
          <span>
            WRAP: <strong className={wrap ? "text-[hsl(var(--log-info))]" : "text-[hsl(var(--muted-foreground))]"}>{wrap ? "ON" : "OFF"}</strong>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--log-success))]" />
            <span className="text-[hsl(var(--muted-foreground))]">Repos: logs/, backend/logs/, backend/run/</span>
          </span>
          <span className="text-[hsl(var(--muted-foreground))]">UTF-8</span>
        </div>
      </div>
    </div>
  );
}
