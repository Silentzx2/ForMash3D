'use client';

import React, { useState, useEffect, useRef } from 'react';
import { taskPersistence, ActivityNotification } from '@/services/taskPersistence';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BellIcon,
  CheckIcon,
  Trash2,
  CheckmarkCircle02Icon,
  AlertCircle,
  DownloadIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';

export const NotificationCenter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { navigateToMain, selectAsset, assets } = useWorkspace();

  const refreshNotifications = () => {
    setNotifications(taskPersistence.loadNotifications());
  };

  useEffect(() => {
    refreshNotifications();
    const handleUpdate = () => refreshNotifications();
    window.addEventListener('formash_notifications_updated', handleUpdate);
    return () => window.removeEventListener('formash_notifications_updated', handleUpdate);
  }, []);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllAsRead = () => {
    taskPersistence.markAllNotificationsAsRead();
    refreshNotifications();
  };

  const handleClearHistory = () => {
    taskPersistence.clearNotifications();
    refreshNotifications();
  };

  const formatTimestamp = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const now = Date.now();
      const diffSec = Math.floor((now - d.getTime()) / 1000);
      if (diffSec < 60) return 'Just now';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <SimpleTooltip label="Activity & Notifications" side="bottom">
        <button
          id="btn-header-notifications"
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`relative w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            isOpen
              ? 'bg-[hsl(var(--surface-2))] text-white'
              : 'text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-1))]'
          }`}
          aria-label="Activity Center"
        >
          <HugeiconsIcon icon={BellIcon} size={16} className="w-3.5 h-3.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 bg-primary text-black font-black text-[9px] rounded-full flex items-center justify-center leading-none shadow-[0_0_8px_rgba(255,204,0,0.6)] animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </SimpleTooltip>

      {isOpen && (
        <div
          id="notification-center-dropdown"
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl bg-[hsl(var(--surface-1))] border border-white/[0.12] shadow-2xl z-50 overflow-hidden flex flex-col text-xs font-medium animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header */}
          <div className="p-3 border-b border-white/[0.08] bg-[hsl(var(--surface-2))]/60 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-xs">Activity Center</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-mono bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer flex items-center gap-1"
                  title="Mark all as read"
                >
                  <HugeiconsIcon icon={CheckIcon} size={12} className="w-3 h-3 text-emerald-400" />
                  <span>Mark read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  title="Clear history"
                >
                  <HugeiconsIcon icon={Trash2} size={14} className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.04] custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 space-y-1.5">
                <HugeiconsIcon icon={BellIcon} size={24} className="w-6 h-6 mx-auto mb-1 opacity-40 text-zinc-400" />
                <p className="text-xs font-semibold text-zinc-300">No recent activity</p>
                <p className="text-[10px] text-zinc-500">
                  Completed generations, failed jobs, and exports will appear here.
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const isCompleted = item.status === 'completed';
                const isFailed = item.status === 'failed';
                const isExport = item.status === 'export';

                return (
                  <div
                    key={item.id}
                    className={`p-3 transition-colors flex flex-col gap-1.5 ${
                      item.read ? 'hover:bg-white/[0.02]' : 'bg-primary/[0.03] hover:bg-primary/[0.06]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isCompleted
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : isFailed
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-primary/20 text-primary'
                          }`}
                        >
                          <HugeiconsIcon
                            icon={isCompleted ? CheckmarkCircle02Icon : isFailed ? AlertCircle : SparklesIcon}
                            size={12}
                            className="w-3 h-3"
                          />
                        </span>
                        <span className="font-semibold text-white text-[11px] truncate">{item.title}</span>
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500 flex-shrink-0">
                        {formatTimestamp(item.timestamp)}
                      </span>
                    </div>

                    {item.description && (
                      <p className="text-[10px] text-zinc-400 leading-relaxed pl-5 break-words">
                        {item.description}
                      </p>
                    )}

                    {/* Action Links */}
                    <div className="flex items-center gap-2 pl-5 pt-0.5">
                      {item.jobId && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsOpen(false);
                            navigateToMain('jobs');
                          }}
                          className="text-[10px] text-primary hover:underline font-semibold cursor-pointer"
                        >
                          View Job &rarr;
                        </button>
                      )}
                      {item.assetId && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsOpen(false);
                            selectAsset(item.assetId!);
                            navigateToMain('workspace');
                          }}
                          className="text-[10px] text-zinc-300 hover:text-white hover:underline font-semibold cursor-pointer"
                        >
                          Select Asset
                        </button>
                      )}
                      {item.assetUrl && (
                        <a
                          href={item.assetUrl}
                          download
                          className="text-[10px] text-emerald-400 hover:underline font-semibold flex items-center gap-0.5"
                        >
                          <HugeiconsIcon icon={DownloadIcon} size={10} className="w-2.5 h-2.5" />
                          <span>Download</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
