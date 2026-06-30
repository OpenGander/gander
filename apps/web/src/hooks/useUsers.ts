/**
 * useUsers Hook
 * Manages users, invites, and related state for settings pages
 */

'use client';

import { useState, useCallback } from 'react';
import type { UserWithTenant, InviteWithStatus, Role, Tenant, AuditLogParsed, AuditAction } from '@/lib/types/user-management';

interface UseUsersReturn {
  // Users
  users: UserWithTenant[];
  usersLoading: boolean;
  usersError: string | null;
  fetchUsers: () => Promise<void>;
  updateUserRole: (userId: string, role: Role) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;

  // Invites
  invites: InviteWithStatus[];
  invitesLoading: boolean;
  invitesError: string | null;
  fetchInvites: () => Promise<void>;
  createInvite: (email: string, role: Role, tenantId?: string) => Promise<void>;
  cancelInvite: (inviteId: string) => Promise<void>;

  // Tenants
  tenants: Tenant[];
  tenantsLoading: boolean;
  fetchTenants: () => Promise<void>;

  // Audit Logs
  auditLogs: AuditLogParsed[];
  auditLogsLoading: boolean;
  auditLogsTotal: number;
  fetchAuditLogs: (action?: AuditAction | null) => Promise<void>;
}

export function useUsers(): UseUsersReturn {
  // Users state
  const [users, setUsers] = useState<UserWithTenant[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Invites state
  const [invites, setInvites] = useState<InviteWithStatus[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);

  // Tenants state
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<AuditLogParsed[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch users');
      setUsers(data.users);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Update user role
  const updateUserRole = useCallback(async (userId: string, role: Role) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update role');

    // Update local state
    setUsers((prev) =>
      prev.map((u) => (u.UserId === userId ? { ...u, Role: role } : u))
    );
  }, []);

  // Remove user
  const removeUser = useCallback(async (userId: string) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove user');

    // Update local state
    setUsers((prev) => prev.filter((u) => u.UserId !== userId));
  }, []);

  // Fetch invites
  const fetchInvites = useCallback(async () => {
    setInvitesLoading(true);
    setInvitesError(null);
    try {
      const res = await fetch('/api/invites');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch invites');
      setInvites(data.invites);
    } catch (err) {
      setInvitesError(err instanceof Error ? err.message : 'Failed to fetch invites');
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  // Create invite
  const createInvite = useCallback(async (email: string, role: Role, tenantId?: string) => {
    const res = await fetch('/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role, tenantId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create invite');

    // Refresh invites list
    await fetchInvites();
  }, [fetchInvites]);

  // Cancel invite
  const cancelInvite = useCallback(async (inviteId: string) => {
    const res = await fetch(`/api/invites/${inviteId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to cancel invite');

    // Update local state
    setInvites((prev) => prev.filter((i) => i.InviteId !== inviteId));
  }, []);

  // Fetch tenants
  const fetchTenants = useCallback(async () => {
    setTenantsLoading(true);
    try {
      const res = await fetch('/api/tenants');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch tenants');
      setTenants(data.flat || []);
    } catch (err) {
      console.error('Failed to fetch tenants:', err);
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  // Fetch audit logs
  const fetchAuditLogs = useCallback(async (action?: AuditAction | null) => {
    setAuditLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      params.set('limit', '100');

      const res = await fetch(`/api/audit-logs?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch audit logs');
      setAuditLogs(data.logs);
      setAuditLogsTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setAuditLogsLoading(false);
    }
  }, []);

  return {
    users,
    usersLoading,
    usersError,
    fetchUsers,
    updateUserRole,
    removeUser,
    invites,
    invitesLoading,
    invitesError,
    fetchInvites,
    createInvite,
    cancelInvite,
    tenants,
    tenantsLoading,
    fetchTenants,
    auditLogs,
    auditLogsLoading,
    auditLogsTotal,
    fetchAuditLogs,
  };
}
