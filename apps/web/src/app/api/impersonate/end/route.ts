/**
 * Impersonation End API
 * POST /api/impersonate/end - End impersonation and restore original session
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, generateSessionToken, getSessionCookieOptions } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { logAudit } from '@/lib/audit';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type { Role, User } from '@/lib/types/user-management';
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

    // Check if currently impersonating
    if (!session.impersonating) {
      return NextResponse.json({ error: 'Not currently impersonating' }, { status: 400 });
    }

    const { impersonating } = session;

    // Get original user's current data (in case it changed)
    const originalUser = await getUser(impersonating.originalUserId);
    if (!originalUser) {
      return NextResponse.json({ error: 'Original user not found' }, { status: 404 });
    }

    // Log audit event (using current session which has impersonation context)
    await logAudit(session, 'impersonate_end', req, {
      targetUserId: session.userId,
      targetTenantId: session.tenantId,
      metadata: {
        impersonatedEmail: session.email,
        impersonatedRole: session.role,
        duration: new Date().getTime() - new Date(impersonating.startedAt).getTime(),
      },
    });

    // Generate new session token WITHOUT impersonation context
    const sessionToken = await generateSessionToken(
      originalUser.UserId,
      originalUser.Email,
      originalUser.TenantId,
      originalUser.TenantName,
      originalUser.Role as Role
      // No impersonation context - restores normal session
    );

    // Create response
    const response = NextResponse.json({
      success: true,
      restored: {
        UserId: originalUser.UserId,
        Email: originalUser.Email,
        TenantId: originalUser.TenantId,
        TenantName: originalUser.TenantName,
        Role: originalUser.Role,
      },
    });

    // Set restored session cookie
    const cookieOptions = getSessionCookieOptions();
    response.cookies.set({
      ...cookieOptions,
      value: sessionToken,
    });

    return response;
  } catch (err) {
    logger.error({ err }, 'Error ending impersonation');
    return NextResponse.json({ error: 'Failed to end impersonation' }, { status: 500 });
  }
}
