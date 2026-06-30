/**
 * Me API - Get current session info
 * GET /api/me - Returns the current user's session data including tenant memberships
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getUserMemberships } from '@/lib/queries/user-tenants';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's tenant memberships
    let memberships: Array<{
      tenantId: string;
      tenantName: string;
      tenantSlug?: string;
      role: string;
      joinedAt: string;
    }> = [];

    try {
      const rawMemberships = await getUserMemberships(session.userId);
      memberships = rawMemberships.map((m) => ({
        tenantId: m.TenantId,
        tenantName: m.TenantName || 'Unknown',
        tenantSlug: m.TenantSlug,
        role: m.Role,
        joinedAt: m.JoinedAt,
      }));
    } catch (membershipErr) {
      // Log but don't fail - memberships table might not exist yet
      logger.warn({ err: membershipErr }, 'Failed to fetch memberships');
    }

    // Return session data (excluding sensitive fields like iat/exp)
    return NextResponse.json({
      userId: session.userId,
      email: session.email,
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      role: session.role,
      impersonating: session.impersonating,
      memberships,
    });
  } catch (err) {
    logger.error({ err }, 'Error getting session');
    return NextResponse.json({ error: 'Failed to get session' }, { status: 500 });
  }
}
