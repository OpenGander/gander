/**
 * Members Settings Page
 * Manage users and invitations
 */

'use client';

import React, { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MembersTable, InvitesTable, InviteModal } from '@/components/settings';
import { useUsers } from '@/hooks/useUsers';
import type { Role } from '@/lib/types/user-management';

export default function MembersPage() {
  const {
    users,
    usersLoading,
    usersError,
    fetchUsers,
    updateUserRole,
    removeUser,
    invites,
    invitesLoading,
    fetchInvites,
    createInvite,
    cancelInvite,
    tenants,
    fetchTenants,
  } = useUsers();

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [session, setSession] = useState<{ userId: string; role: Role; tenantId: string } | null>(
    null
  );

  // Fetch session info from /api/me
  useEffect(() => {
    const getSession = async () => {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          setSession({
            userId: data.userId,
            role: data.role as Role,
            tenantId: data.tenantId,
          });
        }
      } catch (err) {
        console.error('Failed to get session:', err);
      }
    };
    getSession();
  }, []);

  // Fetch data on mount
  useEffect(() => {
    fetchUsers();
    fetchInvites();
    fetchTenants();
  }, [fetchUsers, fetchInvites, fetchTenants]);

  const handleRoleChange = async (userId: string, newRole: Role) => {
    try {
      await updateUserRole(userId, newRole);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRemoveUser = async (userId: string) => {
    try {
      await removeUser(userId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove user');
    }
  };

  const handleInvite = async (email: string, role: Role, tenantId?: string) => {
    await createInvite(email, role, tenantId);
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      await cancelInvite(inviteId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel invite');
    }
  };

  return (
    <div className="space-y-6">
      {/* Members Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>Users who have access to your organization</CardDescription>
          </div>
          <Button onClick={() => setIsInviteModalOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite User
          </Button>
        </CardHeader>
        <CardContent>
          {usersError && <div className="text-destructive text-sm mb-4">{usersError}</div>}
          <MembersTable
            users={users}
            currentUserRole={session?.role || 'user'}
            currentUserId={session?.userId || ''}
            onRoleChange={handleRoleChange}
            onRemoveUser={handleRemoveUser}
            isLoading={usersLoading}
          />
        </CardContent>
      </Card>

      {/* Pending Invites Section */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>Invitations that have been sent but not yet accepted</CardDescription>
        </CardHeader>
        <CardContent>
          <InvitesTable
            invites={invites.filter((i) => i.status === 'pending')}
            onCancelInvite={handleCancelInvite}
            isLoading={invitesLoading}
          />
        </CardContent>
      </Card>

      {/* Invite Modal */}
      <InviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onInvite={handleInvite}
        actorRole={session?.role || 'user'}
        tenants={tenants}
        defaultTenantId={session?.tenantId}
      />
    </div>
  );
}
