/**
 * Audit Logs Table Component
 * Displays security audit trail with filtering
 */

'use client';

import React, { useState } from 'react';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { cn, formatDate } from '@/lib/utils';
import {
  AUDIT_ACTION_LABELS,
  type AuditLogParsed,
  type AuditAction,
} from '@/lib/types/user-management';

interface AuditLogsTableProps {
  logs: AuditLogParsed[];
  isLoading?: boolean;
  onFilterChange?: (action: AuditAction | null) => void;
}

function ActionBadge({ action }: { action: AuditAction }) {
  const colorMap: Record<string, string> = {
    impersonate_start: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    impersonate_end: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    invite_user: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    invite_accept: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    invite_cancel: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    change_role: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    remove_user: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    create_tenant: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
    update_tenant: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
    delete_tenant: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        colorMap[action] || 'bg-muted text-muted-foreground'
      )}
    >
      {AUDIT_ACTION_LABELS[action] || action}
    </span>
  );
}

export function AuditLogsTable({ logs, isLoading, onFilterChange }: AuditLogsTableProps) {
  const [selectedAction, setSelectedAction] = useState<AuditAction | null>(null);

  const actionOptions: (AuditAction | null)[] = [
    null,
    'impersonate_start',
    'impersonate_end',
    'invite_user',
    'invite_accept',
    'invite_cancel',
    'change_role',
    'remove_user',
    'create_tenant',
    'update_tenant',
  ];

  const handleActionFilter = (action: AuditAction | null) => {
    setSelectedAction(action);
    onFilterChange?.(action);
  };

  const columns: DataTableColumn<AuditLogParsed>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      accessor: (row) => row.Timestamp,
      cell: (value) => {
        const date = new Date(value);
        return (
          <div className="text-sm">
            <div>{formatDate(date)}</div>
            <div className="text-muted-foreground text-xs">{date.toLocaleTimeString('en-US')}</div>
          </div>
        );
      },
      sortable: true,
      width: '140px',
    },
    {
      key: 'action',
      header: 'Action',
      accessor: (row) => row.Action,
      cell: (value) => <ActionBadge action={value} />,
      sortable: true,
    },
    {
      key: 'actor',
      header: 'Actor',
      accessor: (row) => row.ActorEmail,
      cell: (value, row) => {
        const impersonatingData = row.Metadata?.impersonating as { email: string } | undefined;
        return (
          <div className="text-sm">
            <div>{String(value)}</div>
            {impersonatingData && (
              <div className="text-xs text-purple-600">
                (impersonating {impersonatingData.email})
              </div>
            )}
          </div>
        );
      },
      sortable: true,
    },
    {
      key: 'target',
      header: 'Target',
      accessor: (row) => row.TargetUserId || row.TargetTenantId || '-',
      cell: (_, row) => {
        const meta = row.Metadata;
        if (meta?.targetEmail) {
          return <span className="text-sm">{meta.targetEmail as string}</span>;
        }
        if (meta?.invitedEmail) {
          return <span className="text-sm">{meta.invitedEmail as string}</span>;
        }
        if (meta?.removedEmail) {
          return <span className="text-sm">{meta.removedEmail as string}</span>;
        }
        if (row.TargetUserId) {
          return <span className="text-sm text-muted-foreground">{row.TargetUserId}</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: 'details',
      header: 'Details',
      accessor: (row) => row.Metadata,
      cell: (value) => {
        if (!value || Object.keys(value).length === 0) {
          return <span className="text-muted-foreground">-</span>;
        }

        const details: string[] = [];
        if (value.previousRole && value.newRole) {
          details.push(`${value.previousRole} -> ${value.newRole}`);
        }
        if (value.invitedRole) {
          details.push(`Role: ${value.invitedRole}`);
        }

        return <span className="text-sm text-muted-foreground">{details.join(', ') || '-'}</span>;
      },
    },
    {
      key: 'ipAddress',
      header: 'IP',
      accessor: (row) => row.IpAddress,
      cell: (value) => (
        <span className="text-xs text-muted-foreground font-mono">
          {value === 'unknown' ? '-' : value}
        </span>
      ),
      width: '120px',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Filter by action:</span>
        {actionOptions.map((action) => (
          <button
            key={action || 'all'}
            className={cn(
              'px-2 py-1 text-xs rounded-md border transition-colors',
              selectedAction === action
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            )}
            onClick={() => handleActionFilter(action)}
          >
            {action ? AUDIT_ACTION_LABELS[action] : 'All'}
          </button>
        ))}
      </div>

      <DataTable
        data={logs}
        columns={columns}
        searchable
        searchKeys={['ActorEmail', 'Action']}
        pageSize={20}
        emptyMessage="No audit logs found"
      />
    </div>
  );
}
