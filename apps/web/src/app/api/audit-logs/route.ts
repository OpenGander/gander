/**
 * Audit Logs API - View security audit trail
 * GET /api/audit-logs - List audit logs (admin+ only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { validateAction, getTenantScope } from '@/lib/rbac';
import { queryAuditLogs } from '@/lib/audit';
import type { AuditAction } from '@/lib/types/user-management';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permission (admin+ only)
    const permError = validateAction(session, 'view_audit');
    if (permError) {
      return NextResponse.json({ error: permError }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') as AuditAction | null;
    const actorUserId = searchParams.get('actorUserId');
    const targetUserId = searchParams.get('targetUserId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const limitStr = searchParams.get('limit');
    const offsetStr = searchParams.get('offset');

    // Parse dates
    const startDate = startDateStr ? new Date(startDateStr) : undefined;
    const endDate = endDateStr ? new Date(endDateStr) : undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    // Get tenant scope
    const tenantIds = await getTenantScope(session);

    // For non-superadmins, filter to their tenant scope
    // Superadmins can see all logs, others see logs where actor or target is in their tenant
    let actorTenantId: string | undefined;
    if (session.role !== 'superadmin') {
      // Filter to own tenant's logs only
      actorTenantId = session.tenantId;
    }

    const { logs, total } = await queryAuditLogs({
      actorTenantId,
      action: action || undefined,
      actorUserId: actorUserId || undefined,
      targetUserId: targetUserId || undefined,
      startDate,
      endDate,
      limit,
      offset,
    });

    // For non-superadmins, also filter logs to only show those relevant to their tenant scope
    const filteredLogs =
      session.role === 'superadmin'
        ? logs
        : logs.filter(
            (log) =>
              tenantIds.includes(log.ActorTenantId) ||
              (log.TargetTenantId && tenantIds.includes(log.TargetTenantId))
          );

    return NextResponse.json({
      logs: filteredLogs,
      total,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, 'Error listing audit logs');
    return NextResponse.json({ error: 'Failed to list audit logs' }, { status: 500 });
  }
}
