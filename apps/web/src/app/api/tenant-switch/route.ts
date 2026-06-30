/**
 * Tenant Switch API
 * POST /api/tenant-switch - Switch viewing tenant (sets cookie)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { canAccessTenant } from '@/lib/rbac';
import logger from '@/lib/logger';

const VIEWING_TENANT_COOKIE = 'opengander_viewing_tenant';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Validate access to requested tenant
    const hasAccess = await canAccessTenant(session, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied to tenant' }, { status: 403 });
    }

    // Set viewing tenant cookie
    const response = NextResponse.json({ success: true, tenantId });
    response.cookies.set(VIEWING_TENANT_COOKIE, tenantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch (error) {
    logger.error({ err: error }, 'Error switching tenant');
    return NextResponse.json({ error: 'Failed to switch tenant' }, { status: 500 });
  }
}
