import React, { useState, useEffect } from 'react';
   import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
   import { HugeiconsIcon } from '@hugeicons/react';
import { Database01Icon, NetworkIcon, LoaderCircleIcon, AlertCircleIcon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
   import { getApiClient } from '@/services/apiClient';
   import { Button } from '@/components/ui/button';

   interface ConnectionInfo {
     status: string;
     ok: boolean;
     error?: string;
   }

   interface TestResults {
     redis: ConnectionInfo;
     storage: ConnectionInfo;
   }

    export function ConnectionsTab() {
      const [data, setData] = useState<TestResults | null>(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState<string | null>(null);

      const fetchConnections = async () => {
        setLoading(true);
        try {
          const health = await getApiClient().getHealthStatus();
          const scheduler = await getApiClient().getSchedulerStatus();
          setData({
            redis: {
              status: health.status === 'healthy' ? 'healthy' : 'unhealthy',
              ok: health.status === 'healthy',
              error: health.status !== 'healthy' ? 'Backend unhealthy' : undefined,
            },
            storage: {
              status: scheduler.scheduler?.running ? 'healthy' : 'unhealthy',
              ok: scheduler.scheduler?.running ?? false,
              error: !scheduler.scheduler?.running ? 'Scheduler not running' : undefined,
            },
          });
        } catch (err) {
          setError('Failed to fetch connections info from backend');
        } finally {
          setLoading(false);
        }
      };

     useEffect(() => {
       fetchConnections();
     }, []);

      if (loading && !data) return <div className="flex h-40 items-center justify-center"><HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-8 h-8 animate-spin text-primary" /></div>;
      if (error) return <div className="p-6 text-destructive flex items-center gap-2"><HugeiconsIcon icon={AlertCircleIcon} size={16} /> {error}</div>;
     if (!data) return null;

      const renderStatus = (info: ConnectionInfo) => {
        if (info.ok) return <div className="flex items-center gap-2 text-emerald-400"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="w-5 h-5" /> Connected</div>;
        return <div className="flex flex-col gap-1 text-destructive"><div className="flex items-center gap-2"><HugeiconsIcon icon={AlertCircleIcon} size={16} className="w-5 h-5" /> Error</div><p className="text-xs opacity-80">{info.error}</p></div>;
      };

     return (
       <div className="p-6 space-y-6">
         <div className="flex items-center justify-between">
           <div>
             <h2 className="text-3xl font-bold tracking-tight text-foreground">System Connections</h2>
             <p className="text-muted-foreground mt-2">Cache and storage connection status</p>
           </div>
           <Button onClick={fetchConnections} disabled={loading} className="bg-primary text-[#080808] hover:bg-primary/90 font-bold">
              {loading ? <HugeiconsIcon icon={LoaderCircleIcon} size={16} className="w-4 h-4 animate-spin mr-2" /> : <HugeiconsIcon icon={NetworkIcon} size={16} className="w-4 h-4 mr-2" />}
             Test Connections
           </Button>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <Card>
             <CardHeader>
               <CardTitle className="flex items-center gap-2"><HugeiconsIcon icon={NetworkIcon} size={16} className="w-5 h-5" /> Redis</CardTitle>
               <CardDescription>In-memory cache and message broker</CardDescription>
             </CardHeader>
             <CardContent>
               {renderStatus(data.redis)}
             </CardContent>
           </Card>
           <Card>
             <CardHeader>
               <CardTitle className="flex items-center gap-2"><HugeiconsIcon icon={Database01Icon} size={16} className="w-5 h-5" /> Storage</CardTitle>
               <CardDescription>Local filesystem and file store</CardDescription>
             </CardHeader>
             <CardContent>
               {renderStatus(data.storage)}
             </CardContent>
           </Card>
         </div>
       </div>
     );
   }
