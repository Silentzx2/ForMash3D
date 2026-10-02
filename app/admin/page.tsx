'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdminShell } from '@/features/admin/AdminShell';
import dynamic from 'next/dynamic';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon } from '@hugeicons/core-free-icons';

const OverviewTab = dynamic(() => import('@/features/admin/tabs/OverviewTab').then(m => m.OverviewTab), { ssr: false });
const RuntimeTab = dynamic(() => import('@/features/admin/tabs/RuntimeTab').then(m => m.RuntimeTab), { ssr: false });
const LogsTab = dynamic(() => import('@/features/admin/tabs/LogsTab').then(m => m.LogsTab), { ssr: false });
const JobsTab = dynamic(() => import('@/features/admin/tabs/JobsTab').then(m => m.JobsTab), { ssr: false });
const QueueTab = dynamic(() => import('@/features/admin/tabs/QueueTab').then(m => m.QueueTab), { ssr: false });
const HealthTab = dynamic(() => import('@/features/admin/tabs/HealthTab').then(m => m.HealthTab), { ssr: false });
const StorageTab = dynamic(() => import('@/features/admin/tabs/StorageTab').then(m => m.StorageTab), { ssr: false });
const SettingsTab = dynamic(() => import('@/features/admin/tabs/SettingsTab').then(m => m.SettingsTab), { ssr: false });
const ModelsTab = dynamic(() => import('@/features/admin/tabs/ModelsTab').then(m => m.ModelsTab), { ssr: false });

const VALID_TABS = new Set([
  'overview',
  'models',
  'runtime',
  'logs',
  'jobs',
  'queue',
  'health',
  'storage',
  'settings',
]);

const SECTION_TO_TAB: Record<string, string> = {
  runtime: 'runtime',
  logs: 'logs',
  queue: 'queue',
  jobs: 'jobs',
  history: 'jobs',
  health: 'health',
  monitoring: 'health',
  storage: 'storage',
  general: 'settings',
  workspace: 'settings',
  generation: 'settings',
  export: 'settings',
  backup: 'settings',
  shortcuts: 'settings',
  notifications: 'settings',
  advanced: 'settings',
  network: 'settings',
  api: 'settings',
};

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab')?.toLowerCase();
  const sectionParam = searchParams.get('section')?.toLowerCase();

  // Resolve initial tab from tab query or mapped section query
  const resolveInitialTab = (): string => {
    if (tabParam && VALID_TABS.has(tabParam)) {
      return tabParam;
    }
    if (sectionParam && SECTION_TO_TAB[sectionParam]) {
      return SECTION_TO_TAB[sectionParam];
    }
    return 'overview';
  };

  const [activeTab, setActiveTab] = useState<string>(resolveInitialTab);

  // Sync tab state if URL parameters change externally
  useEffect(() => {
    const targetTab = resolveInitialTab();
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, sectionParam]);

  const handleTabChange = useCallback((newTab: string) => {
    setActiveTab(newTab);
    router.replace(`/admin?tab=${newTab}`, { scroll: false });
  }, [router]);

  const renderTab = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'models': return <ModelsTab />;
      case 'runtime': return <RuntimeTab />;
      case 'logs': return <LogsTab />;
      case 'jobs': return <JobsTab />;
      case 'queue': return <QueueTab />;
      case 'health': return <HealthTab />;
      case 'storage': return <StorageTab />;
      case 'settings': return <SettingsTab initialSection={sectionParam} />;
      default: return <OverviewTab />;
    }
  };

  return (
    <AdminShell activeTab={activeTab} onTabChange={handleTabChange}>
      {renderTab()}
    </AdminShell>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-[#0d0e12] text-zinc-400">
          <HugeiconsIcon icon={LoaderCircleIcon} size={24} className="h-6 w-6 animate-spin text-purple-400" />
        </div>
      }
    >
      <AdminPageContent />
    </Suspense>
  );
}
