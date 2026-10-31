"use client";

import React, { useState, useEffect } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel, HelpCircleIcon, LoaderCircle } from '@hugeicons/core-free-icons';
import MarkdownContent from './MarkdownContent';
import '../pages/WikiPage.css';

interface ToolDocMapping {
  id: string;
  title: string;
}

const TOOL_DOCS: Record<string, ToolDocMapping> = {
  model: { id: '18', title: 'Mesh Generation' },
  remesh: { id: '30', title: 'Auto Retopo' },
  uv: { id: '29', title: 'Auto UV' },
  texture: { id: '24', title: 'Texturing' },
  pbr: { id: '24', title: 'Texturing' },
  rigging: { id: '32', title: 'Auto Rig' },
  animation: { id: '32', title: 'Auto Rig' },
  segment: { id: '47', title: 'Mesh Segmentation' },
};

interface ToolContextHelpProps {
  tool: string;
  label?: string;
  className?: string;
}

export const ToolContextHelp: React.FC<ToolContextHelpProps> = ({ tool, label, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doc = TOOL_DOCS[tool];

  useEffect(() => {
    if (!isOpen || !doc) return;
    let isCancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/wiki/${doc.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Article not found');
        return res.json();
      })
      .then(data => {
        if (!isCancelled) {
          if (data.success && data.content) {
            setContent(data.content);
          } else {
            setError(data.error || 'Failed to load article');
          }
        }
      })
      .catch(err => {
        if (!isCancelled) {
          setError(err.message || 'Failed to load article');
        }
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, doc]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={className || "p-1 rounded-lg text-zinc-400 hover:text-primary hover:bg-white/[0.08] transition-colors cursor-pointer"}
        title={label || `Documentation for ${tool}`}
        aria-label="Open documentation help"
      >
        <HugeiconsIcon icon={HelpCircleIcon} size={15} className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 select-text"
          onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}
        >
          <div className="w-full max-w-lg h-full bg-[hsl(var(--surface-1))] border-l border-white/[0.1] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-[hsl(var(--surface-2))] flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/15 text-primary border border-primary/25">
                  <HugeiconsIcon icon={HelpCircleIcon} size={16} className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    {doc ? doc.title : `${tool.toUpperCase()} Documentation`}
                  </h3>
                  <span className="text-[10px] text-zinc-400">Contextual In-App Reference</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-5 text-xs text-zinc-300 leading-relaxed custom-scrollbar">
              {!doc ? (
                <div className="py-12 text-center text-zinc-400 space-y-2">
                  <HugeiconsIcon icon={HelpCircleIcon} size={32} className="mx-auto text-zinc-500 opacity-60" />
                  <p className="font-semibold text-white">No article yet</p>
                  <p className="text-[11px] text-zinc-400 max-w-xs mx-auto">
                    Documentation for the <code className="text-primary font-mono">{tool}</code> tool is currently being authored. Check back soon.
                  </p>
                </div>
              ) : loading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-zinc-400">
                  <HugeiconsIcon icon={LoaderCircle} size={24} className="animate-spin text-primary" />
                  <span className="text-xs">Loading documentation…</span>
                </div>
              ) : error ? (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-1">
                  <p className="font-bold">Failed to load documentation</p>
                  <p className="text-[11px] opacity-80">{error}</p>
                </div>
              ) : content ? (
                <div className="wiki-article p-0 bg-transparent">
                  <MarkdownContent content={content} />
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-400">
                  <p>No content available.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
