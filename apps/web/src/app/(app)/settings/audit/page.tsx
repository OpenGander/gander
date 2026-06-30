/**
 * Audit Log Settings Page
 * View security and activity history
 */

'use client';

import React, { useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AuditLogsTable } from '@/components/settings';
import { useUsers } from '@/hooks/useUsers';
import type { AuditAction } from '@/lib/types/user-management';

export default function AuditPage() {
  const { auditLogs, auditLogsLoading, auditLogsTotal, fetchAuditLogs } = useUsers();

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const handleFilterChange = useCallback(
    (action: AuditAction | null) => {
      fetchAuditLogs(action);
    },
    [fetchAuditLogs]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Audit Log
          </CardTitle>
          <CardDescription>
            Security events and activity history for your organization.
            {auditLogsTotal > 0 && (
              <span className="ml-1">
                Showing {auditLogs.length} of {auditLogsTotal} events.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditLogsTable
            logs={auditLogs}
            isLoading={auditLogsLoading}
            onFilterChange={handleFilterChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
