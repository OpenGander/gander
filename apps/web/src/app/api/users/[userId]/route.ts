/**
 * User API - Update and delete individual users
 * PATCH /api/users/[userId] - Update user role (requires admin+)
 * DELETE /api/users/[userId] - Remove user (requires moderator+)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { validateAction, canAssignRole, canAccessTenant } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type { Role, User, UpdateUserRoleRequest } from '@/lib/types/user-management';
import logger from '@/lib/logger';

interface RouteParams {
  params: Promise<{ userId: string }>;
}

async function getUser(userId: string): Promise<User | null> {
  if (pgIdentityEnabled()) return identityPg.getUserById(userId);
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT UserId, Email, TenantId, Role, CreatedAt, UpdatedAt
      FROM opengander.users FINAL
      WHERE UserId = {userId:String}
      LIMIT 1
    `,
    query_params: { userId },
    format: 'JSONEachRow',
  });
  const rows = await result.json<User[]>();
  return rows[0] || null;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;

    // Check admin permission for role changes
    const permError = validateAction(session, 'change_role');
    if (permError) {
      return NextResponse.json({ error: permError }, { status: 403 });
    }

    // Get target user
    const targetUser = await getUser(userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check tenant access
    const canAccess = await canAccessTenant(session, targetUser.TenantId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied to this user' }, { status: 403 });
    }

    // Can't modify yourself
    if (targetUser.UserId === session.userId) {
      return NextResponse.json({ error: 'Cannot modify your own role' }, { status: 400 });
    }

    // Parse request body
    const body: UpdateUserRoleRequest = await req.json();
    const { role } = body;

    if (!role) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }

    // Validate role value
    const validRoles: Role[] = ['superadmin', 'admin', 'moderator', 'user'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check role escalation
    if (!canAssignRole(session.role, role)) {
      return NextResponse.json(
        { error: 'Cannot assign a role higher than your own' },
        { status: 403 }
      );
    }

    // Update user role
    if (pgIdentityEnabled()) {
      await identityPg.updateUserRole(targetUser.UserId, role);
    } else {
      // ClickHouse ReplacingMergeTree: insert new row with the updated role
      const client = getClickHouseClient();
      await client.insert({
        table: 'opengander.users',
        values: [
          {
            UserId: targetUser.UserId,
            Email: targetUser.Email,
            TenantId: targetUser.TenantId,
            Role: role,
          },
        ],
        format: 'JSONEachRow',
      });
    }

    // Log audit event
    await logAudit(session, 'change_role', req, {
      targetUserId: targetUser.UserId,
      targetTenantId: targetUser.TenantId,
      metadata: {
        previousRole: targetUser.Role,
        newRole: role,
        targetEmail: targetUser.Email,
      },
    });

    return NextResponse.json({
      success: true,
      user: { ...targetUser, Role: role },
    });
  } catch (err) {
    logger.error({ err }, 'Error updating user');
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;

    // Check moderator permission for user removal
    const permError = validateAction(session, 'remove_user');
    if (permError) {
      return NextResponse.json({ error: permError }, { status: 403 });
    }

    // Get target user
    const targetUser = await getUser(userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check tenant access
    const canAccess = await canAccessTenant(session, targetUser.TenantId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied to this user' }, { status: 403 });
    }

    // Can't delete yourself
    if (targetUser.UserId === session.userId) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    // Can't delete users with higher roles
    if (!canAssignRole(session.role, targetUser.Role as Role)) {
      return NextResponse.json({ error: 'Cannot remove users with higher roles' }, { status: 403 });
    }

    // Delete user
    if (pgIdentityEnabled()) {
      // user_tenants rows cascade via FK ON DELETE CASCADE
      await identityPg.deleteUser(userId);
    } else {
      // ClickHouse DELETE is async, may take time to fully process
      const client = getClickHouseClient();
      await client.command({
        query: `ALTER TABLE opengander.users DELETE WHERE UserId = {userId:String}`,
        query_params: { userId },
      });
    }

    // Log audit event
    await logAudit(session, 'remove_user', req, {
      targetUserId: targetUser.UserId,
      targetTenantId: targetUser.TenantId,
      metadata: {
        removedEmail: targetUser.Email,
        removedRole: targetUser.Role,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Error deleting user');
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
