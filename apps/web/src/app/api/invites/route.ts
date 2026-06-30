/**
 * Invites API - List and create invites
 * GET /api/invites - List pending invites (requires moderator+)
 * POST /api/invites - Create new invite (requires moderator+)
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { validateAction, getTenantScope, canAssignRole, canAccessTenant } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { normalizeEmail } from '@/lib/utils/email';
import { sendInviteEmail, sendAddedToTenantEmail } from '@/lib/email';
import { isUserMemberOfTenant, addUserToTenant } from '@/lib/queries/user-tenants';
import { getUserByEmail, getTenantById } from '@/lib/queries/users';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type {
  Role,
  Invite,
  InviteWithStatus,
  CreateInviteRequest,
} from '@/lib/types/user-management';
import logger from '@/lib/logger';

const INVITE_EXPIRY_DAYS = 7;

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permission
    const error = validateAction(session, 'invite');
    if (error) {
      return NextResponse.json({ error }, { status: 403 });
    }

    // Get tenant scope
    const tenantIds = await getTenantScope(session);

    let rawInvites: (Invite & { TenantName?: string; InviterEmail?: string })[];
    if (pgIdentityEnabled()) {
      rawInvites = await identityPg.getPendingInvitesDetailed(tenantIds);
    } else {
      const client = getClickHouseClient();

      // Query pending invites in accessible tenants
      // Note: Explicit aliases required for all columns - ClickHouse JSONEachRow
      // may return table-prefixed names (e.g., "i.Email") without explicit aliases
      const result = await client.query({
        query: `
          SELECT
            i.InviteId AS InviteId,
            i.Email AS Email,
            i.TenantId AS TenantId,
            i.Token AS Token,
            i.Role AS Role,
            i.InvitedBy AS InvitedBy,
            i.ExpiresAt AS ExpiresAt,
            i.CreatedAt AS CreatedAt,
            i.AcceptedAt AS AcceptedAt,
            t.Name AS TenantName,
            u.Email AS InviterEmail
          FROM opengander.invites i FINAL
          LEFT JOIN opengander.tenants t FINAL ON i.TenantId = t.TenantId
          LEFT JOIN opengander.users u FINAL ON i.InvitedBy = u.UserId
          WHERE i.TenantId IN ({tenantIds:Array(String)})
            AND i.AcceptedAt IS NULL
          ORDER BY i.CreatedAt DESC
        `,
        query_params: { tenantIds },
        format: 'JSONEachRow',
      });

      rawInvites = await result.json<(Invite & { TenantName?: string; InviterEmail?: string })[]>();
    }

    // Add computed status
    const invites: InviteWithStatus[] = rawInvites.map((invite) => {
      let status: 'pending' | 'accepted' | 'expired' = 'pending';
      if (invite.AcceptedAt) {
        status = 'accepted';
      } else if (new Date(invite.ExpiresAt) < new Date()) {
        status = 'expired';
      }
      return {
        ...invite,
        status,
      };
    });

    return NextResponse.json({ invites });
  } catch (err) {
    logger.error({ err }, 'Error listing invites');
    return NextResponse.json({ error: 'Failed to list invites' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permission
    const permError = validateAction(session, 'invite');
    if (permError) {
      return NextResponse.json({ error: permError }, { status: 403 });
    }

    // Parse request body
    const body: CreateInviteRequest = await req.json();
    const { email: rawEmail, role, tenantId: targetTenantId } = body;

    if (!rawEmail || !role) {
      return NextResponse.json({ error: 'Email and role are required' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Normalize email for consistent storage and lookup
    const email = normalizeEmail(rawEmail);

    // Validate role
    const validRoles: Role[] = ['superadmin', 'admin', 'moderator', 'user'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check role escalation
    if (!canAssignRole(session.role, role)) {
      return NextResponse.json(
        { error: 'Cannot invite with a role higher than your own' },
        { status: 403 }
      );
    }

    // Determine target tenant
    const inviteTenantId = targetTenantId || session.tenantId;

    // Check tenant access
    const canAccess = await canAccessTenant(session, inviteTenantId);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied to this tenant' }, { status: 403 });
    }

    // Check if user already exists with this email
    const existingUser = await getUserByEmail(email);

    // If user exists, check if they're already a member of target tenant
    if (existingUser) {
      // Check if already a member of this tenant
      const isMember = await isUserMemberOfTenant(existingUser.UserId, inviteTenantId);
      if (isMember) {
        return NextResponse.json(
          { error: 'User is already a member of this organization' },
          { status: 400 }
        );
      }

      // Add existing user to the tenant
      await addUserToTenant(existingUser.UserId, inviteTenantId, role, session.userId);

      // Log audit event
      await logAudit(session, 'add_to_tenant', req, {
        targetUserId: existingUser.UserId,
        targetTenantId: inviteTenantId,
        metadata: {
          addedEmail: email,
          addedRole: role,
        },
      });

      // Get tenant name for email
      const tenant = await getTenantById(inviteTenantId);
      const tenantName = tenant?.Name || 'OpenGander';

      // Send notification email to existing user
      try {
        await sendAddedToTenantEmail({
          to: email,
          tenantName,
          role,
          inviterEmail: session.email,
        });
      } catch (emailErr) {
        logger.error({ err: emailErr }, 'Failed to send added-to-tenant email');
      }

      return NextResponse.json({
        success: true,
        addedExistingUser: true,
        userId: existingUser.UserId,
        tenantId: inviteTenantId,
        role,
      });
    }

    // Check for existing pending invite
    let pendingExists: boolean;
    if (pgIdentityEnabled()) {
      pendingExists = await identityPg.hasPendingInvite(email, inviteTenantId);
    } else {
      const existingInviteResult = await getClickHouseClient().query({
        query: `
          SELECT InviteId FROM opengander.invites FINAL
          WHERE Email = {email:String}
            AND TenantId = {tenantId:String}
            AND AcceptedAt IS NULL
            AND ExpiresAt > now64(3)
          LIMIT 1
        `,
        query_params: { email, tenantId: inviteTenantId },
        format: 'JSONEachRow',
      });
      pendingExists = (await existingInviteResult.json<{ InviteId: string }[]>()).length > 0;
    }
    if (pendingExists) {
      return NextResponse.json(
        { error: 'Pending invite already exists for this email' },
        { status: 400 }
      );
    }

    // Create invite
    const inviteId = `invite_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    if (pgIdentityEnabled()) {
      await identityPg.createInvite({
        inviteId,
        email,
        tenantId: inviteTenantId,
        token,
        role,
        invitedBy: session.userId,
        expiresAt,
      });
    } else {
      await getClickHouseClient().insert({
        table: 'opengander.invites',
        values: [
          {
            InviteId: inviteId,
            Email: email,
            TenantId: inviteTenantId,
            Token: token,
            Role: role,
            InvitedBy: session.userId,
            ExpiresAt: expiresAt.toISOString().replace('Z', ''),
          },
        ],
        format: 'JSONEachRow',
      });
    }

    // Log audit event
    await logAudit(session, 'invite_user', req, {
      targetTenantId: inviteTenantId,
      metadata: {
        inviteId,
        invitedEmail: email,
        invitedRole: role,
      },
    });

    // Get tenant name for email
    const tenant = await getTenantById(inviteTenantId);
    const tenantName = tenant?.Name || 'OpenGander';

    // Build invite acceptance URL and send email
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const inviteLink = `${baseUrl}/invite/accept?token=${token}`;

    try {
      await sendInviteEmail({
        to: email,
        inviteLink,
        tenantName,
        role,
        inviterEmail: session.email,
        expiresAt,
      });
    } catch (emailErr) {
      // Log but don't fail - invite is already created
      logger.error({ err: emailErr }, 'Failed to send invite email');
    }

    // Return invite with token for email sending
    return NextResponse.json({
      success: true,
      invite: {
        InviteId: inviteId,
        Email: email,
        TenantId: inviteTenantId,
        Token: token,
        Role: role,
        ExpiresAt: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Error creating invite');
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
  }
}
