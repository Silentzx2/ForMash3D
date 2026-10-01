import React, { useState, useCallback } from 'react';

import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel, CheckIcon, CheckmarkCircle02Icon, Copy, FileBoxIcon, LightbulbIcon, ReplyIcon, SearchIcon, SendIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';
import {
  diagnoseUpload,
  createSampleGlbFile,
  formatReport,
  type DiagnosticResult
} from '../lib/uploadDiagnostics';

interface UploadDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFile?: File | null;
}

export const UploadDiagnosticModal: React.FC<UploadDiagnosticModalProps> = ({
  isOpen,
  onClose,
  initialFile
}) => {
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const runDiagnostic = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const file = selectedFile || createSampleGlbFile();
      if (!selectedFile) setSelectedFile(file);
      const diagResult = await diagnoseUpload(file);
      setResult(diagResult);
    } catch (err) {
      setResult({
        success: false,
        timestamp: new Date().toISOString(),
        file: { name: 'unknown', size: 0, type: 'unknown', lastModified: 0 },
        request: { url: '', method: '', headers: {}, formDataEntries: [], apiBaseUrl: '' },
        response: null,
        errors: [err instanceof Error ? err.message : String(err)],
        recommendations: [],
      });
    } finally {
      setRunning(false);
    }
  }, [selectedFile]);

  const copyReport = useCallback(async () => {
    if (!result) return;
    const report = formatReport(result);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = report;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--surface-1))] p-4 select-none animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[hsl(var(--surface-1))] border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] flex items-center justify-center text-[hsl(var(--primary))]">
              <HugeiconsIcon icon={SearchIcon} size={16} className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[hsl(var(--foreground))]">UploadIcon Diagnostics</h3>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Diagnose GLB upload failures and HTML token errors</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))]"
          >
            <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* File Selection */}
          <div className="space-y-2">
            <label className="font-medium text-[hsl(var(--foreground))]">File to Diagnose</label>
            <div className="flex gap-2">
              <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--surface-1))] border border-[hsl(var(--border))] cursor-pointer hover:border-[hsl(var(--primary))]/50 transition-colors">
                <HugeiconsIcon icon={FileBoxIcon} size={16} className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                <span className="text-[hsl(var(--foreground))] truncate">
                  {selectedFile ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)` : 'Select a GLB file...'}
                </span>
                <input
                  type="file"
                  accept=".glb,.gltf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              No file selected? Click "Run Diagnostic" to test with a sample GLB.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={runDiagnostic}
              disabled={running}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))] disabled:opacity-50 text-[hsl(var(--surface-1))] font-bold text-xs transition-colors"
            >
              {running ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-[hsl(var(--surface-1))] border-t-[hsl(var(--surface-1))] rounded-full animate-spin" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <HugeiconsIcon icon={SearchIcon} size={16} className="w-3.5 h-3.5" />
                  <span>Run Diagnostic</span>
                </>
              )}
            </button>
            {result && (
              <button
                onClick={copyReport}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[hsl(var(--surface-2))] hover:bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] font-medium text-xs transition-colors"
              >
                {copied ? <HugeiconsIcon icon={CheckIcon} size={16} className="w-3.5 h-3.5 text-[hsl(var(--neon-green))]" /> : <HugeiconsIcon icon={Copy} size={16} className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Report'}</span>
              </button>
            )}
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-3 pt-2">
              {/* Status Banner */}
              <div className={`p-3 rounded-xl border flex items-center gap-2.5 ${
                result.success
                  ? 'bg-[hsl(var(--neon-green)/0.1)] border-[hsl(var(--neon-green))]/40'
                  : 'bg-[hsl(var(--destructive)/0.1)] border-[hsl(var(--destructive))]/40'
              }`}>
                {result.success
                  ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-4 h-4 text-[hsl(var(--neon-green))] flex-shrink-0" />
                  : <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-4 h-4 text-[hsl(var(--destructive))] flex-shrink-0" />
                }
                <span className={`text-xs font-medium ${result.success ? 'text-[hsl(var(--neon-green))]' : 'text-[hsl(var(--destructive))]'}`}>
                  {result.success ? 'UploadIcon succeeded' : 'UploadIcon failed — see details below'}
                </span>
              </div>

              {/* Request Section */}
              <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                <div className="px-3 py-2 bg-[hsl(var(--surface-1))] border-b border-[hsl(var(--border))] flex items-center gap-2">
                  <HugeiconsIcon icon={SendIcon} size={16} className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                  <span className="font-semibold text-[hsl(var(--foreground))]">Request</span>
                </div>
                <div className="p-3 space-y-2 bg-[hsl(var(--surface-1))]">
                  <div className="flex gap-2">
                    <span className="text-[hsl(var(--muted-foreground))] w-16 flex-shrink-0">URL</span>
                    <span className="text-[hsl(var(--foreground))] font-mono break-all">{result.request.url || '(relative)'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[hsl(var(--muted-foreground))] w-16 flex-shrink-0">Method</span>
                    <span className="text-[hsl(var(--foreground))] font-mono">{result.request.method}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[hsl(var(--muted-foreground))] w-16 flex-shrink-0">API Base</span>
                    <span className="text-[hsl(var(--foreground))] font-mono">{result.request.apiBaseUrl || '(empty — relative URL)'}</span>
                  </div>
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">Headers</span>
                    <div className="mt-1 pl-2 border-l-2 border-[hsl(var(--border))] space-y-0.5">
                      {(Object.entries(result.request.headers) as [string, string | null][]).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <span className="text-[hsl(var(--muted-foreground))] font-mono">{key}:</span>
                          <span className="text-[hsl(var(--foreground))] font-mono">{value ?? '(not set)'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">FormData</span>
                    <div className="mt-1 pl-2 border-l-2 border-[hsl(var(--border))] space-y-0.5">
                      {result.request.formDataEntries.map((entry, i) => (
                        <div key={i} className="text-[hsl(var(--foreground))] font-mono">{entry}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Response Section */}
              {result.response && (
                <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                  <div className="px-3 py-2 bg-[hsl(var(--surface-1))] border-b border-[hsl(var(--border))] flex items-center gap-2">
                    <HugeiconsIcon icon={ReplyIcon} size={16} className="w-3.5 h-3.5 text-[hsl(var(--primary))]" />
                    <span className="font-semibold text-[hsl(var(--foreground))]">Response</span>
                    {result.response.isHtml && (
                      <span className="ml-auto px-2 py-0.5 rounded-md bg-[hsl(var(--destructive))]/20 text-[hsl(var(--destructive))] text-[10px] font-bold">
                        HTML DETECTED
                      </span>
                    )}
                  </div>
                  <div className="p-3 space-y-2 bg-[hsl(var(--surface-1))]">
                    <div className="flex gap-2">
                      <span className="text-[hsl(var(--muted-foreground))] w-16 flex-shrink-0">Status</span>
                      <span className={`font-mono font-bold ${
                        result.response.status >= 200 && result.response.status < 300
                          ? 'text-[hsl(var(--neon-green))]'
                          : 'text-[hsl(var(--destructive))]'
                      }`}>
                        {result.response.status} {result.response.statusText}
                      </span>
                    </div>
                    <div>
                      <span className="text-[hsl(var(--muted-foreground))]">Headers</span>
                      <div className="mt-1 pl-2 border-l-2 border-[hsl(var(--border))] space-y-0.5">
                        {(Object.entries(result.response.headers) as [string, string][]).map(([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <span className="text-[hsl(var(--muted-foreground))] font-mono">{key}:</span>
                            <span className="text-[hsl(var(--foreground))] font-mono break-all">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[hsl(var(--muted-foreground))]">Body</span>
                        {result.response.bodyTruncated && (
                          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">(first 500 chars)</span>
                        )}
                      </div>
                      <pre className="mt-1 p-2 rounded-lg bg-[hsl(var(--surface-1))] border border-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] font-mono text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {result.response.body || '(empty)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div className="rounded-xl border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--surface-1))] p-3 space-y-1">
                  <div className="flex items-center gap-2 text-[hsl(var(--destructive))] font-semibold">
                    <HugeiconsIcon icon={TriangleAlertIcon} size={16} className="w-3.5 h-3.5" />
                    <span>Errors</span>
                  </div>
                  {result.errors.map((error, i) => (
                    <div key={i} className="text-[hsl(var(--destructive))] pl-5">{error}</div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {result.recommendations.length > 0 && (
                <div className="rounded-xl border border-[hsl(var(--primary))]/30 bg-[hsl(var(--surface-1))] p-3 space-y-1">
                  <div className="flex items-center gap-2 text-[hsl(var(--primary))] font-semibold">
                    <HugeiconsIcon icon={LightbulbIcon} size={16} className="w-3.5 h-3.5" />
                    <span>Recommendations</span>
                  </div>
                  {result.recommendations.map((rec, i) => (
                    <div key={i} className="text-[hsl(var(--foreground))] pl-5">{rec}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-[hsl(var(--surface-1))] border-t border-[hsl(var(--border))]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[hsl(var(--surface-2))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-2))] font-medium text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
