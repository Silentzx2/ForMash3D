"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiClient } from "@/services/apiClient";
import { LOG_VIEW_INITIAL_TAIL, LOG_VIEW_MAX_LINES } from "@/constants/logs";
import { toast } from "sonner";

type ConnStatus = "CONNECTING" | "CONNECTED" | "ERROR" | "PAUSED";

export function LogsTab() {
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState<ConnStatus>("CONNECTING");
  const [autoScroll, setAutoScroll] = useState(true);
  const [hasReceivedContent, setHasReceivedContent] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [fileName] = useState("master.log");
  const terminalRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const outputTextRef = useRef<Text | null>(null);
  const outputLineCountRef = useRef(0);
  const trailingNewlineRef = useRef(false);
  const hasReceivedContentRef = useRef(false);
  const autoScrollRef = useRef(true);
  const streamOffsetRef = useRef(0);
  const streamIdentityRef = useRef<string | null>(null);
  const resetOnRestartRef = useRef(false);
  const liveRef = useRef(true);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    if (resetOnRestartRef.current) {
      if (outputRef.current) outputRef.current.textContent = "";
      outputTextRef.current = null;
      outputLineCountRef.current = 0;
      trailingNewlineRef.current = false;
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
    let retryTimer: number | null = null;
    let pollInterval: number | null = null;
    let retryDelay = 1000;
    const pendingText: string[] = [];
    let source: EventSource | null = null;

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
        if (outputText) {
          outputText.appendData(text);
          outputLineCountRef.current += (text.match(/\n/g) || []).length;
          trailingNewlineRef.current = text.endsWith("\n");
          const visibleLines = outputLineCountRef.current +
            (outputText.length > 0 && !trailingNewlineRef.current ? 1 : 0);
          if (visibleLines > LOG_VIEW_MAX_LINES) {
            let linesToDrop = visibleLines - LOG_VIEW_MAX_LINES;
            let deleteEnd = -1;
            let removedLines = 0;
            let searchFrom = 0;
            const currentText = outputText.data;
            while (linesToDrop > 0) {
              deleteEnd = currentText.indexOf("\n", searchFrom);
              if (deleteEnd < 0) break;
              searchFrom = deleteEnd + 1;
              removedLines += 1;
              linesToDrop -= 1;
            }
            if (deleteEnd >= 0) {
              outputText.deleteData(0, deleteEnd + 1);
              outputLineCountRef.current -= removedLines;
            }
          }
        }
        if (!hasReceivedContentRef.current) {
          hasReceivedContentRef.current = true;
          setHasReceivedContent(true);
        }
      }
      const terminal = terminalRef.current;
      if (autoScrollRef.current && terminal) terminal.scrollTop = terminal.scrollHeight;
    };

    const enqueueText = (text: string) => {
      pendingText.push(text);
      if (flushFrame === null) {
        flushFrame = window.requestAnimationFrame(() => {
          flushFrame = null;
          flushPending();
        });
      }
    };

    // High-frequency low-latency poller (every 250ms) using byte-offset deltas
    // This provides buttery-smooth line-by-line updates even through aggressive reverse proxy buffers (Kaggle/ngrok)
    let isPolling = false;
    const pollTail = async () => {
      if (disposed || !liveRef.current || isPolling) return;
      isPolling = true;
      try {
        const offsetParam = streamOffsetRef.current > 0 ? `&offset=${streamOffsetRef.current}` : "";
        const identityParam = streamIdentityRef.current ? `&identity=${encodeURIComponent(streamIdentityRef.current)}` : "";
        const linesParam = streamOffsetRef.current === 0 ? `&lines=${LOG_VIEW_INITIAL_TAIL}` : "";
        const url = `/api/v1/system/logs/tail?file=${encodeURIComponent(fileName)}${offsetParam}${identityParam}${linesParam}`;

        const res = await fetch(url);
        if (res.ok && !disposed) {
          const data = await res.json();
          if (data.identity) {
            streamIdentityRef.current = data.identity;
          }
          if (data.truncated) {
            if (outputRef.current) outputRef.current.textContent = "";
            outputTextRef.current = null;
            outputLineCountRef.current = 0;
            trailingNewlineRef.current = false;
          }
          if (typeof data.offset === "number") {
            streamOffsetRef.current = data.offset;
          }
          if (typeof data.chunk === "string" && data.chunk.length > 0) {
            enqueueText(data.chunk);
          }
          if (!hasReceivedContentRef.current) {
            hasReceivedContentRef.current = true;
            setHasReceivedContent(true);
          }
          setStatus("CONNECTED");
        }
      } catch {
        if (!disposed && status !== "ERROR") {
          setStatus("ERROR");
        }
      } finally {
        isPolling = false;
      }
    };

    // Immediate initial fetch
    pollTail();

    // Start 350ms smooth live poller
    pollInterval = window.setInterval(pollTail, 350);

    const startSSE = () => {
      if (disposed || !live || source) return;
      setStatus("CONNECTING");
      const fileQuery = "file=" + encodeURIComponent(fileName);
      const streamUrl = streamIdentityRef.current
        ? "/api/v1/system/logs/stream?" + fileQuery +
          "&offset=" + String(streamOffsetRef.current) +
          "&identity=" + encodeURIComponent(streamIdentityRef.current)
        : "/api/v1/system/logs/stream?" + fileQuery +
          "&tail=" + String(LOG_VIEW_INITIAL_TAIL);
      source = new EventSource(streamUrl);

      source.onopen = () => {
        if (disposed) return;
        retryDelay = 1000;
        setStatus("CONNECTED");
      };

      source.addEventListener("sync", (event) => {
        if (disposed) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data);
          if (payload.identity && typeof payload.identity === "string") {
            streamIdentityRef.current = payload.identity;
            const nextOffset = Number(payload.offset);
            if (Number.isSafeInteger(nextOffset) && nextOffset >= 0) {
              streamOffsetRef.current = nextOffset;
            }
          }
          if (!hasReceivedContentRef.current) {
            hasReceivedContentRef.current = true;
            setHasReceivedContent(true);
          }
        } catch {
          // ignore malformed sync
        }
      });

      source.onmessage = (event) => {
        if (disposed) return;
        let payload: { offset?: unknown; identity?: unknown; chunk?: unknown };
        try {
          payload = JSON.parse(event.data) as {
            offset?: unknown; identity?: unknown; chunk?: unknown;
          };
        } catch {
          setStatus("ERROR");
          return;
        }
        const nextOffset = Number(payload.offset);
        if (
          typeof payload.chunk !== "string" ||
          typeof payload.identity !== "string" ||
          !/^\d+:\d+$/.test(payload.identity) ||
          !Number.isSafeInteger(nextOffset) ||
          nextOffset < 0
        ) {
          setStatus("ERROR");
          return;
        }
        streamOffsetRef.current = nextOffset;
        streamIdentityRef.current = payload.identity;
        enqueueText(payload.chunk);
        if (!hasReceivedContentRef.current) {
          hasReceivedContentRef.current = true;
          setHasReceivedContent(true);
        }
      };

      source.addEventListener("reset", (event) => {
        if (disposed) return;
        pendingText.length = 0;
        if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
        flushFrame = null;
        if (outputRef.current) outputRef.current.textContent = "";
        outputTextRef.current = null;
        outputLineCountRef.current = 0;
        trailingNewlineRef.current = false;
        hasReceivedContentRef.current = false;
        const resetEventId = (event as MessageEvent).lastEventId || "";
        const resetParts = resetEventId.split(":");
        streamIdentityRef.current =
          resetParts.length === 3 && resetParts.every((part) => /^\d+$/.test(part))
            ? resetParts.slice(0, 2).join(":")
            : null;
        streamOffsetRef.current = 0;
        setHasReceivedContent(false);
        if (terminalRef.current) terminalRef.current.scrollTop = 0;
      });

      source.onerror = () => {
        if (disposed) return;
        setStatus("ERROR");
        if (!source || source.readyState !== EventSource.CLOSED || retryTimer !== null) return;
        source.close();
        source = null;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 5000);
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          startSSE();
        }, delay);
      };
    };
    startSSE();

    return () => {
      if (flushFrame !== null) window.cancelAnimationFrame(flushFrame);
      flushFrame = null;
      if (pollInterval !== null) window.clearInterval(pollInterval);
      pollInterval = null;
      if (resetOnRestartRef.current) pendingText.length = 0;
      else flushPending();
      disposed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (source) {
        source.close();
        source = null;
      }
    };
  }, [live, streamEpoch, fileName]);

  const handleScroll = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setAutoScroll(
      terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60,
    );
  }, []);

  const handleRefresh = () => {
    resetOnRestartRef.current = true;
    setLive(true);
    setStreamEpoch((current) => current + 1);
  };

  const handleClear = async () => {
    try {
      await getApiClient().clearLogs();
      resetOnRestartRef.current = true;
      setLive(true);
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
              ● {status === "CONNECTED" ? "LIVE (250ms)" : status}
            </span>
            <span className="text-[#555555] truncate">logs/{fileName}</span>
            <span className="text-[#888888] whitespace-nowrap">
              tail {LOG_VIEW_INITIAL_TAIL} lines · buffer {LOG_VIEW_MAX_LINES} lines
            </span>
            {status === "ERROR" && (
              <span className="text-[#F44336] text-[11px]">
                — backend offline or stream interrupted; reconnecting
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[#888888]">
            <button
              onClick={handleRefresh}
              className="hover:text-white transition-colors"
              title="Restart the live tail from recent lines"
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
              {status === "CONNECTING" && "⏳ Connecting to master.log..."}
              {status === "CONNECTED" &&
                `⏳ Fetching recent lines from ${fileName}…`}
              {status === "ERROR" && "✗ Stream interrupted; retrying automatically."}
              {status === "PAUSED" && "⏸ Stream paused. Click Resume to continue from the last received byte."}
            </div>
          )}
          {hasReceivedContent && outputLineCountRef.current === 0 && (
            <div className="text-[#666666] mt-2 italic">
              ● {fileName} is attached and live (currently 0 lines). Service output will appear here in real time.
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
