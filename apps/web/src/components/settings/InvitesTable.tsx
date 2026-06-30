/**
 * Invites Table Component
 * Displays pending invitations with cancel functionality
 */

'use client';

import React from 'react';
import { X, Clock, CheckCircle, XCircle } from 'lucide-react';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { cn, formatDate } from '@/lib/utils';
import { ROLE_LABELS, type InviteWithStatus } from '@/lib/types/user-management';

interface InvitesTableProps {
  invites: InviteWithStatus[];
  onCancelInvite: (inviteId: string) => Promise<void>;
  isLoading?: boolean;
}

function StatusBadge({ status }: { status: InviteWithStatus['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        status === 'pending' && 'bg-yellow-100 text-yellow-800',
        status === 'accepted' && 'bg-green-100 text-green-800',
        status === 'expired' && 'bg-red-100 text-red-800'
      )}
    >
      {status === 'pending' && <Clock className="h-3 w-3" />}
      {status === 'accepted' && <CheckCircle className="h-3 w-3" />}
      {status === 'expired' && <XCircle className="h-3 w-3" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function InvitesTable({ invites, onCancelInvite, isLoading }: InvitesTableProps) {
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

  const handleCancel = async (inviteId: string) => {
    setCancellingId(inviteId);
    try {
      await onCancelInvite(inviteId);
    } finally {
      setCancellingId(null);
    }
  };

  const columns: DataTableColumn<InviteWithStatus>[] = [
    {
      key: 'email',
      header: 'Email',
      accessor: (row) => row.Email,
      sortable: true,
    },
    {
      key: 'role',
      header: 'Role',
      accessor: (row) => row.Role,
      cell: (value) => (
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
            value === 'superadmin' &&
              'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
            value === 'admin' && 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
            value === 'moderator' &&
              'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
            value === 'user' && 'bg-muted text-muted-foreground'
          )}
        >
          {ROLE_LABELS[value as keyof typeof ROLE_LABELS]}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.status,
      cell: (value) => <StatusBadge status={value} />,
      sortable: true,
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      accessor: (row) => row.ExpiresAt,
      cell: (value, row) => {
        if (row.status === 'accepted') return '-';
        const date = new Date(value);
        const isExpired = date < new Date();
        return <span className={cn(isExpired && 'text-red-500')}>{formatDate(date)}</span>;
      },
      sortable: true,
    },
    {
      key: 'invitedBy',
      header: 'Invited By',
      accessor: (row) => row.InviterEmail || 'Unknown',
      sortable: true,
    },
    {
      key: 'actions',
      header: '',
      accessor: (row) => row.InviteId,
      cell: (_, row) => {
        if (row.status !== 'pending') return null;
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => handleCancel(row.InviteId)}
            disabled={cancellingId === row.InviteId}
          >
            <X className="h-4 w-4" />
          </Button>
        );
      },
      align: 'right',
      width: '60px',
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
    <DataTable
      data={invites}
      columns={columns}
      searchable
      searchKeys={['Email', 'Role', 'InviterEmail']}
      pageSize={10}
      emptyMessage="No pending invites"
    />
  );
}
