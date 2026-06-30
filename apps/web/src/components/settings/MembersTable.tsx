/**
 * Members Table Component
 * Displays users in the organization with role management
 */

'use client';

import React from 'react';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { RoleSelector } from './RoleSelector';
import { RemoveUserDialog } from './RemoveUserDialog';
import type { UserWithTenant, Role } from '@/lib/types/user-management';
import { formatDate } from '@/lib/utils';

interface MembersTableProps {
  users: UserWithTenant[];
  currentUserRole: Role;
  currentUserId: string;
  onRoleChange: (userId: string, newRole: Role) => Promise<void>;
  onRemoveUser: (userId: string) => Promise<void>;
  isLoading?: boolean;
}

export function MembersTable({
  users,
  currentUserRole,
  currentUserId,
  onRoleChange,
  onRemoveUser,
  isLoading,
}: MembersTableProps) {
  const columns: DataTableColumn<UserWithTenant>[] = [
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
      cell: (value, row) => (
        <RoleSelector
          currentRole={value as Role}
          actorRole={currentUserRole}
          disabled={row.UserId === currentUserId}
          onChange={(newRole) => onRoleChange(row.UserId, newRole)}
        />
      ),
      sortable: true,
    },
    {
      key: 'tenant',
      header: 'Organization',
      accessor: (row) => row.TenantName || row.TenantId,
      sortable: true,
    },
    {
      key: 'createdAt',
      header: 'Joined',
      accessor: (row) => row.CreatedAt,
      cell: (value) => formatDate(value),
      sortable: true,
    },
    {
      key: 'actions',
      header: '',
      accessor: (row) => row.UserId,
      cell: (_, row) => (
        <RemoveUserDialog
          user={row}
          disabled={row.UserId === currentUserId}
          onConfirm={() => onRemoveUser(row.UserId)}
        />
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
      data={users}
      columns={columns}
      searchable
      searchKeys={['Email', 'Role', 'TenantName']}
      pageSize={10}
      emptyMessage="No members found"
    />
  );
}
