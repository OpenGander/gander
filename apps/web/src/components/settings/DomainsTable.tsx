/**
 * Domains Table Component
 * Displays registered website domains with management actions
 */

'use client';

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { VerificationBadge } from './VerificationBadge';
import { Button } from '@/components/ui/button';
import type { TenantDomain } from '@/lib/types/user-management';

interface DomainsTableProps {
  domains: TenantDomain[];
  onRemoveDomain: (domainId: string) => Promise<void>;
  isLoading?: boolean;
}

export function DomainsTable({ domains, onRemoveDomain, isLoading }: DomainsTableProps) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleRemove = async (domainId: string) => {
    if (confirmingId !== domainId) {
      // First click - show confirmation
      setConfirmingId(domainId);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirmingId(null), 3000);
      return;
    }

    // Second click - perform removal
    setRemovingId(domainId);
    setConfirmingId(null);
    try {
      await onRemoveDomain(domainId);
    } finally {
      setRemovingId(null);
    }
  };

  const columns: DataTableColumn<TenantDomain>[] = [
    {
      key: 'domain',
      header: 'Domain',
      accessor: (row) => row.Domain,
      cell: (value, row) => (
        <div>
          <span className="font-medium">{value}</span>
          {row.DisplayName && (
            <span className="text-muted-foreground ml-2">({row.DisplayName})</span>
          )}
        </div>
      ),
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => row.Verified,
      cell: (value) => <VerificationBadge verified={value as boolean} />,
      sortable: true,
    },
    {
      key: 'createdAt',
      header: 'Added',
      accessor: (row) => row.CreatedAt,
      cell: (value) => new Date(value).toLocaleDateString(),
      sortable: true,
    },
    {
      key: 'actions',
      header: '',
      accessor: (row) => row.DomainId,
      cell: (_, row) => (
        <Button
          variant={confirmingId === row.DomainId ? 'destructive' : 'ghost'}
          size="sm"
          onClick={() => handleRemove(row.DomainId)}
          disabled={removingId === row.DomainId}
        >
          {removingId === row.DomainId ? (
            <span className="animate-spin">...</span>
          ) : confirmingId === row.DomainId ? (
            'Confirm'
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      ),
      align: 'right',
      width: '80px',
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
      data={domains}
      columns={columns}
      searchable
      searchKeys={['Domain', 'DisplayName']}
      pageSize={10}
      emptyMessage="No domains configured"
    />
  );
}
