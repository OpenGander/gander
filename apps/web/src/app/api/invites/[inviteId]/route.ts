/**
 * Individual Invite API - Cancel invite
 * DELETE /api/invites/[inviteId] - Cancel pending invite (requires moderator+)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { validateAction, canAccessTenant } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type { Invite } from '@/lib/types/user-management';
import logger from '@/lib/logger';

interface RouteParams {
  params: Promise<{ inviteId: string }>;
}

async function getInvite(inviteId: string): Promise<Invite | null> {
  if (pgIdentityEnabled()) return identityPg.getInviteById(inviteId);
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT InviteId, Email, TenantId, Token, Role, InvitedBy, ExpiresAt, CreatedAt, AcceptedAt
      FROM opengander.invites FINAL
      WHERE InviteId = {inviteId:String}
      LIMIT 1
    `,
    query_params: { inviteId },
    format: 'JSONEachRow',
  });
  const rows = await result.json<Invite[]>();
  return rows[0] || null;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { inviteId } = await params;

    // Check permission
    const permError = validateAction(session, 'invite');
    if (permError) {
      return NextResponse.json({ error: permError }, { status: 403 });
    }

    // Get invite
    const invite = await getInvite(inviteId);
    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    // Check if already accepted
    if (invite.AcceptedAt) {
      return NextResponse.json({ error: 'Invite has already been accepted' }, { status: 400 });
    }

    // Check tenant access
    const canAccess = await canAccessTenant(session, invite.TenantId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied to this invite' }, { status: 403 });
    }

    // Delete invite
    if (pgIdentityEnabled()) {
      await identityPg.deleteInvite(inviteId);
    } else {
      const client = getClickHouseClient();
      await client.command({
        query: `ALTER TABLE opengander.invites DELETE WHERE InviteId = {inviteId:String}`,
        query_params: { inviteId },
      });
    }

    // Log audit event
    await logAudit(session, 'invite_cancel', req, {
      targetTenantId: invite.TenantId,
      metadata: {
        inviteId,
        cancelledEmail: invite.Email,
        cancelledRole: invite.Role,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Error cancelling invite');
    return NextResponse.json({ error: 'Failed to cancel invite' }, { status: 500 });
  }
}
