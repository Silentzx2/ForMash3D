import { notFound } from 'next/navigation';
import { WorkspaceShell } from '@/features/workspace/WorkspaceShell';
import { isKnownWorkspaceRoute } from '@/features/workspace/lib/workspaceRouteContract';

export default async function WorkspaceToolPage({
  params,
}: {
  params: Promise<{ tool: string[] }>;
}) {
  const { tool = [] } = await params;
  if (!isKnownWorkspaceRoute(tool)) notFound();
  return <WorkspaceShell />;
}
