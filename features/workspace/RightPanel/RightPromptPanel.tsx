import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { apiClient, HistoryItem } from '../lib/api';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

import { HugeiconsIcon } from '@hugeicons/react';
import { FileCodeIcon, RefreshCw, Trash2 } from '@hugeicons/core-free-icons';

export const RightPromptPanel: React.FC = () => {
  const { currentAsset } = useWorkspace();
  const [historyItem, setHistoryItem] = useState<HistoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const promptId = currentAsset?.source?.promptId;

  const load = useCallback(async (requestedPromptId = promptId) => {
    const requestId = ++requestIdRef.current;
    if (!requestedPromptId) {
      setHistoryItem(null);
      setError('Select a generation output to inspect its recorded prompt.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const history = await apiClient.getHistory(64);
      const item = history[requestedPromptId];
      if (!item) throw new Error('Prompt record is no longer present in generation history.');
      if (requestId !== requestIdRef.current) return;
      setHistoryItem(item);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setHistoryItem(null);
      setError(e instanceof Error ? e.message : 'Unable to load prompt history.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    void load(promptId);
    return () => { requestIdRef.current += 1; };
  }, [load, promptId]);

  const handleDelete = async () => {
    if (!promptId || loading) return;
    const deletingPromptId = promptId;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await apiClient.deleteHistory(deletingPromptId);
      if (requestId !== requestIdRef.current || promptId !== deletingPromptId) return;
      setHistoryItem(null);
    } catch (e) {
      if (requestId !== requestIdRef.current || promptId !== deletingPromptId) return;
      setError(e instanceof Error ? e.message : 'Unable to delete prompt history.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--surface-1))] text-xs">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-2.5">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={FileCodeIcon} size={16} className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="font-bold text-[hsl(var(--foreground))]">Prompt</span>
        </div>
        <div className="flex items-center gap-1">
          <SimpleTooltip label="Refresh prompt">
            <button type="button" aria-label="Refresh prompt" disabled={loading} onClick={() => void load()} className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-2))] hover:text-[hsl(var(--foreground))] disabled:opacity-40">
              <HugeiconsIcon icon={RefreshCw} size={16} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </SimpleTooltip>
          <SimpleTooltip label="Delete history record">
            <button type="button" aria-label="Delete prompt history" onClick={() => void handleDelete()} disabled={!promptId || loading} className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive))/10] hover:text-[hsl(var(--destructive))] disabled:opacity-40">
              <HugeiconsIcon icon={Trash2} size={16} className="h-3.5 w-3.5" />
            </button>
          </SimpleTooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {error && <div role="status" className="rounded-xl border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))/10] p-3 text-[hsl(var(--destructive))]">{error}</div>}
        {loading && !historyItem && <div role="status" className="p-3 text-[hsl(var(--muted-foreground))]">Loading prompt history…</div>}
        {historyItem && (
          <>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3 space-y-2">
              <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Status</span><span className="text-[hsl(var(--primary))]">{historyItem.status?.status_str ?? 'Unknown'}</span></div>
              <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Completed</span><span>{historyItem.status?.completed ? 'Yes' : 'No'}</span></div>
            </div>
            <pre className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-0))] p-3 text-[10px] leading-relaxed text-[hsl(var(--foreground))] overflow-auto whitespace-pre-wrap">
              {JSON.stringify(historyItem.prompt, null, 2)}
            </pre>
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3">
              <div className="mb-2 font-semibold text-[hsl(var(--foreground))]">Recorded Outputs</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-[hsl(var(--muted-foreground))]">{JSON.stringify(historyItem.outputs, null, 2)}</pre>
            </div>
          </>
        )}
        {!loading && !error && !historyItem && (
          <div className="p-3 text-[hsl(var(--muted-foreground))]">No prompt history record is selected.</div>
        )}
      </div>
    </div>
  );
};
