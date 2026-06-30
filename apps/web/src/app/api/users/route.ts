/**
 * Users API - List users in scope
 * GET /api/users - List users (requires moderator+)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient } from '@/lib/clickhouse';
import { validateAction, getTenantScope } from '@/lib/rbac';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type { UserWithTenant } from '@/lib/types/user-management';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check permission
    const error = validateAction(session, 'invite'); // moderator+ can view users
    if (error) {
      return NextResponse.json({ error }, { status: 403 });
    }

    // Get tenant scope
    const tenantIds = await getTenantScope(session);

    let users: UserWithTenant[];
    if (pgIdentityEnabled()) {
      users = await identityPg.listUsersInScope(tenantIds);
    } else {
      // Query users in accessible tenants
      const result = await getClickHouseClient().query({
        query: `
          SELECT
            u.UserId,
            u.Email,
            u.TenantId,
            u.Role,
            u.CreatedAt,
            u.UpdatedAt,
            t.Name AS TenantName,
            t.Slug AS TenantSlug
          FROM opengander.users u FINAL
          LEFT JOIN opengander.tenants t FINAL ON u.TenantId = t.TenantId
          WHERE u.TenantId IN ({tenantIds:Array(String)})
          ORDER BY u.CreatedAt DESC
        `,
        query_params: { tenantIds },
        format: 'JSONEachRow',
      });
      users = await result.json<UserWithTenant[]>();
    }

    return NextResponse.json({ users });
  } catch (err) {
    logger.error({ err }, 'Error listing users');
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}
