/**
 * Impersonation Start API
 * POST /api/impersonate/start - Start impersonating a user (superadmin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, generateSessionToken, getSessionCookieOptions } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { validateAction } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type {
  Role,
  User,
  StartImpersonationRequest,
  ImpersonationContext,
} from '@/lib/types/user-management';
import logger from '@/lib/logger';

async function getUser(userId: string): Promise<(User & { TenantName?: string }) | null> {
  if (pgIdentityEnabled()) return identityPg.getUserWithTenantName(userId);
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        u.UserId,
        u.Email,
        u.TenantId,
        u.Role,
        u.CreatedAt,
        u.UpdatedAt,
        t.Name AS TenantName
      FROM opengander.users u FINAL
      LEFT JOIN opengander.tenants t FINAL ON u.TenantId = t.TenantId
      WHERE u.UserId = {userId:String}
      LIMIT 1
    `,
    query_params: { userId },
    format: 'JSONEachRow',
  });
  const rows = await result.json<(User & { TenantName?: string })[]>();
  return rows[0] || null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permission (superadmin only)
    const permError = validateAction(session, 'impersonate');
    if (permError) {
      return NextResponse.json({ error: permError }, { status: 403 });
    }

    // Parse request body
    const body: StartImpersonationRequest = await req.json();
    const { targetUserId } = body;

    if (!targetUserId) {
      return NextResponse.json({ error: 'Target user ID is required' }, { status: 400 });
    }

    // Can't impersonate yourself
    if (targetUserId === session.userId) {
      return NextResponse.json({ error: 'Cannot impersonate yourself' }, { status: 400 });
    }

    // Get target user
    const targetUser = await getUser(targetUserId);
    if (!targetUser) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Create impersonation context
    const impersonationContext: ImpersonationContext = {
      originalUserId: session.userId,
      originalEmail: session.email,
      originalTenantId: session.tenantId,
      originalRole: session.role,
      startedAt: new Date().toISOString(),
    };

    // Generate new session token with impersonation context
    const sessionToken = await generateSessionToken(
      targetUser.UserId,
      targetUser.Email,
      targetUser.TenantId,
      targetUser.TenantName,
      targetUser.Role as Role,
      impersonationContext
    );

    // Log audit event
    await logAudit(session, 'impersonate_start', req, {
      targetUserId: targetUser.UserId,
      targetTenantId: targetUser.TenantId,
      metadata: {
        targetEmail: targetUser.Email,
        targetRole: targetUser.Role,
      },
    });

    // Create response with new session cookie
    const response = NextResponse.json({
      success: true,
      impersonating: {
        UserId: targetUser.UserId,
        Email: targetUser.Email,
        TenantId: targetUser.TenantId,
        TenantName: targetUser.TenantName,
        Role: targetUser.Role,
      },
    });

    // Set new session cookie
    const cookieOptions = getSessionCookieOptions();
    response.cookies.set({
      ...cookieOptions,
      value: sessionToken,
    });

    return response;
  } catch (err) {
    logger.error({ err }, 'Error starting impersonation');
    return NextResponse.json({ error: 'Failed to start impersonation' }, { status: 500 });
  }
}
