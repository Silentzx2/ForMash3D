"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiClient } from "@/services/apiClient";
import { toast } from "sonner";

type ConnStatus = "CONNECTING" | "CONNECTED" | "ERROR" | "PAUSED";

export function LogsTab() {
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState<ConnStatus>("CONNECTING");
  const [autoScroll, setAutoScroll] = useState(true);
  const [hasReceivedContent, setHasReceivedContent] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const outputTextRef = useRef<Text | null>(null);
  const hasReceivedContentRef = useRef(false);
  const autoScrollRef = useRef(true);
  const streamOffsetRef = useRef(0);
  const streamIdentityRef = useRef<string | null>(null);
  const resetOnRestartRef = useRef(false);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    if (resetOnRestartRef.current) {
      if (outputRef.current) outputRef.current.textContent = "";
      outputTextRef.current = null;
      streamOffsetRef.current = 0;
      streamIdentityRef.current = null;
      hasReceivedContentRef.current = false;
      setHasReceivedContent(false);
      resetOnRestartRef.current = false;
    }

    if (!live) {
      setStatus("PAUSED");
      return;
    }

    let disposed = false;
    let flushFrame: number | null = null;
    const pendingText: string[] = [];

    const flushPending = () => {
      if (flushFrame !== null) {
        window.cancelAnimationFrame(flushFrame);
        flushFrame = null;
      }
      if (pendingText.length === 0) return;

      const text = pendingText.join("");
      pendingText.length = 0;
      if (text.length > 0) {
        let outputText = outputTextRef.current;
        if (!outputText && outputRef.current) {
          outputText = document.createTextNode("");
          outputRef.current.appendChild(outputText);
          outputTextRef.current = outputText;
        }
        outputText?.appendData(text);
        if (!hasReceivedContentRef.current) {
          hasReceivedContentRef.current = true;
          setHasReceivedContent(true);
        }
      }

      const terminal = terminalRef.current;
      if (autoScrollRef.current && terminal) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    };

    const enqueueText = (text: string) => {
      // Never drop or cap pending chunks; flush them together once per frame.
      pendingText.push(text);
      if (flushFrame === null) {
        flushFrame = window.requestAnimationFrame(() => {
          flushFrame = null;
          flushPending();
        });
      }
    };

    setStatus("CONNECTING");
    let ws: WebSocket | null = null;
    let source: EventSource | null = null;

    const startSSE = () => {
      if (disposed || source) return;
      let streamUrl =
        "/api/v1/system/logs/stream?offset=" + String(streamOffsetRef.current);
      if (streamIdentityRef.current) {
        streamUrl += "&identity=" + encodeURIComponent(streamIdentityRef.current);
      }
      source = new EventSource(streamUrl);

      source.onopen = () => {
        if (!disposed) setStatus("CONNECTED");
      };

      source.onmessage = (event) => {
        if (disposed) return;
        let payload: { offset?: unknown; identity?: unknown; chunk?: unknown };
        try {
          payload = JSON.parse(event.data) as {
            offset?: unknown;
            identity?: unknown;
            chunk?: unknown;
          };
        } catch {
          setStatus("ERROR");
          return;
        }

        const nextOffset = Number(payload.offset);
        if (
          typeof payload.chunk !== "string" ||
          !Number.isSafeInteger(nextOffset) ||
          nextOffset < 0
        ) {
          setStatus("ERROR");
          return;
        }

        streamOffsetRef.current = nextOffset;
        if (typeof payload.identity === "string") streamIdentityRef.current = payload.identity;
        enqueueText(payload.chunk);
      };

      source.addEventListener("reset", (event) => {
        if (disposed) return;
        pendingText.length = 0;
        if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
        flushFrame = null;
        if (outputRef.current) outputRef.current.textContent = "";
        outputTextRef.current = null;
        hasReceivedContentRef.current = false;
        const resetEventId = (event as MessageEvent).lastEventId || "";
        const resetParts = resetEventId.split(":");
        streamIdentityRef.current =
          resetParts.length === 3 && resetParts.every((part) => /^-?\d+$/.test(part))
            ? resetParts.slice(0, 2).join(":")
            : null;
        streamOffsetRef.current = 0;
        setHasReceivedContent(false);
        const terminal = terminalRef.current;
        if (terminal) terminal.scrollTop = 0;
      });

      source.onerror = () => {
        if (!disposed) setStatus("ERROR");
      };
    };

    try {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = window.location.host;
      ws = new WebSocket(`${wsProtocol}//${wsHost}/api/v1/system/logs/ws`);

      ws.onopen = () => {
        if (!disposed) setStatus("CONNECTED");
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "reset") {
            if (outputRef.current) outputRef.current.textContent = "";
            outputTextRef.current = null;
            hasReceivedContentRef.current = false;
            setHasReceivedContent(false);
          } else if (data.chunk) {
            enqueueText(data.chunk);
          }
        } catch {
          if (typeof event.data === "string") enqueueText(event.data);
        }
      };

      ws.onerror = () => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      };

      ws.onclose = () => {
        if (!disposed && !source) {
          startSSE();
        }
      };
    } catch {
      startSSE();
    }

    return () => {
      if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
      flushFrame = null;
      if (resetOnRestartRef.current) {
        pendingText.length = 0;
      } else {
        flushPending();
      }
      disposed = true;
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
      if (source) {
        source.close();
        source = null;
      }
    };
  }, [live, streamEpoch]);

  const fetchLatestLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/system/logs/files/master.log?lines=2000", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.content === "string" && outputRef.current) {
        if (data.content.length > 0) {
          if (outputRef.current.textContent !== data.content) {
            outputRef.current.textContent = data.content;
            outputTextRef.current = null;
            hasReceivedContentRef.current = true;
            setHasReceivedContent(true);
            if (autoScrollRef.current && terminalRef.current) {
              terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
            }
          }
        }
      }
    } catch {
      // Ignore background poll errors
    }
  }, []);

  // Poll fallback only when disconnected or initial load
  useEffect(() => {
    if (!live) return;
    if (status === "CONNECTED" && hasReceivedContent) return;
    fetchLatestLogs();
    const interval = setInterval(fetchLatestLogs, 4000);
    return () => clearInterval(interval);
  }, [live, status, hasReceivedContent, fetchLatestLogs]);

  const handleScroll = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setAutoScroll(
      terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60,
    );
  }, []);

  const handleClear = async () => {
    try {
      await getApiClient().clearLogs();
      resetOnRestartRef.current = true;
      setStreamEpoch((current) => current + 1);
      toast.success("Logs cleared");
    } catch {
      toast.error("Failed to clear logs");
    }
  };

  const statusColor =
    status === "CONNECTED"
      ? "#4CAF50"
      : status === "ERROR"
        ? "#F44336"
        : status === "PAUSED"
          ? "#888888"
          : "#FFC107";

  return (
    <div className="relative h-full w-full min-h-[500px]">
      <div
        className="flex flex-col absolute inset-0"
        style={{
          backgroundColor: "#1e1e1e",
          color: "#cccccc",
          fontFamily: 'Consolas, "Courier New", monospace',
        }}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#2d2d2d] text-xs flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span style={{ color: statusColor }} className="font-bold whitespace-nowrap">
              ● {status}
            </span>
            <span className="text-[#555555] truncate">logs/master.log</span>
            <span className="text-[#888888] whitespace-nowrap">
              real-time stream (zero delay)
            </span>
            {status === "ERROR" && (
              <span className="text-[#F44336] text-[11px]">
                — backend offline or stream interrupted; reconnecting
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[#888888]">
            <button
              onClick={() => fetchLatestLogs()}
              className="hover:text-white transition-colors"
              title="Refresh logs immediately"
            >
              Refresh
            </button>
            <button
              onClick={() => setLive((current) => !current)}
              className="hover:text-white transition-colors"
            >
              {live ? "Pause" : "Resume"}
            </button>
            <button
              onClick={handleClear}
              className="hover:text-[#F44336] transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 pb-6 text-[12.5px] leading-5"
          style={{ overflowAnchor: "none" }}
        >
          {!hasReceivedContent && (
            <div className="text-[#555555] mt-2">
              {status === "CONNECTING" && "⏳ Connecting to master.log stream..."}
              {status === "CONNECTED" &&
                "⏳ Reading master.log from the beginning and waiting for new writes..."}
              {status === "ERROR" && "✗ Cannot reach backend. The stream will retry automatically."}
              {status === "PAUSED" && "⏸ Stream paused. Click Resume to continue from the last received byte."}
            </div>
          )}
          <pre
            ref={outputRef}
            className="m-0 whitespace-pre-wrap break-all"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" }}
          />
        </div>

        {!autoScroll && hasReceivedContent && (
          <div className="absolute bottom-8 right-6">
            <button
              onClick={() => {
                setAutoScroll(true);
                const terminal = terminalRef.current;
                if (terminal) terminal.scrollTop = terminal.scrollHeight;
              }}
              className="px-3 py-1 rounded-full text-[11px] font-bold"
              style={{ backgroundColor: "#569cd6", color: "#1e1e1e" }}
            >
              ↓ Jump to latest
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
