/**
 * Tenants API - List accessible tenants
 * GET /api/tenants - List tenants user has access to (via membership or hierarchy)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getClickHouseClient, isUnknownTableError } from '@/lib/clickhouse';
import { requireRole } from '@/lib/rbac';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from '@/lib/queries/identity-pg';
import type { Tenant, TenantWithChildren } from '@/lib/types/user-management';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Superadmin sees all tenants
    if (session.role === 'superadmin') {
      let allTenants: Tenant[];
      if (pgIdentityEnabled()) {
        allTenants = await identityPg.listAllTenants();
      } else {
        const result = await getClickHouseClient().query({
          query: `
            SELECT
              TenantId,
              Name,
              Slug,
              AllowedDomains,
              ParentTenantId,
              CreatedAt,
              UpdatedAt
            FROM opengander.tenants FINAL
            ORDER BY ParentTenantId NULLS FIRST, Name
          `,
          format: 'JSONEachRow',
        });
        allTenants = await result.json<Tenant[]>();
      }

      // Build hierarchy
      const tenantMap = new Map<string, TenantWithChildren>();
      const rootTenants: TenantWithChildren[] = [];

      // First pass: create all tenant objects
      for (const tenant of allTenants) {
        tenantMap.set(tenant.TenantId, { ...tenant, children: [] });
      }

      // Second pass: build hierarchy
      for (const tenant of allTenants) {
        const tenantWithChildren = tenantMap.get(tenant.TenantId)!;
        if (tenant.ParentTenantId && tenantMap.has(tenant.ParentTenantId)) {
          tenantMap.get(tenant.ParentTenantId)!.children!.push(tenantWithChildren);
        } else {
          rootTenants.push(tenantWithChildren);
        }
      }

      return NextResponse.json({ tenants: rootTenants, flat: allTenants });
    }

    // For all other users: get tenants from memberships + parent-child hierarchy
    // This combines:
    // 1. Tenants user is directly a member of (via user_tenants)
    // 2. Child tenants of tenants where user is admin (parent-child hierarchy)
    let membershipTenantIds: string[] = [];

    try {
      if (pgIdentityEnabled()) {
        membershipTenantIds = await identityPg.getUserTenantIds(session.userId);
      } else {
        const membershipResult = await getClickHouseClient().query({
          query: `
            SELECT DISTINCT TenantId
            FROM opengander.user_tenants FINAL
            WHERE UserId = {userId:String}
          `,
          query_params: { userId: session.userId },
          format: 'JSONEachRow',
        });
        const membershipRows = await membershipResult.json<{ TenantId: string }[]>();
        membershipTenantIds = membershipRows.map((r) => r.TenantId);
      }
    } catch (membershipErr) {
      // user_tenants table might not exist - fall back to session tenant only
      logger.warn({ err: membershipErr }, 'Failed to fetch memberships, using session tenant');
      membershipTenantIds = [session.tenantId];
    }

    // Always include session tenant
    if (!membershipTenantIds.includes(session.tenantId)) {
      membershipTenantIds.push(session.tenantId);
    }

    // Get all membership tenants + their children (for admins)
    let tenants: Tenant[];
    if (pgIdentityEnabled()) {
      tenants = await identityPg.listTenantsInScope(membershipTenantIds);
    } else {
      const result = await getClickHouseClient().query({
        query: `
          SELECT
            TenantId,
            Name,
            Slug,
            AllowedDomains,
            ParentTenantId,
            CreatedAt,
            UpdatedAt
          FROM opengander.tenants FINAL
          WHERE TenantId IN ({tenantIds:Array(String)})
             OR ParentTenantId IN ({tenantIds:Array(String)})
          ORDER BY ParentTenantId NULLS FIRST, Name
        `,
        query_params: { tenantIds: membershipTenantIds },
        format: 'JSONEachRow',
      });
      tenants = await result.json<Tenant[]>();
    }

    // For non-admin users, filter out child tenants they're not members of
    let filteredTenants = tenants;
    if (!requireRole(session.role, 'admin')) {
      filteredTenants = tenants.filter((t) => membershipTenantIds.includes(t.TenantId));
    }

    // Build hierarchy for response
    const tenantMap = new Map<string, TenantWithChildren>();
    const rootTenants: TenantWithChildren[] = [];

    for (const tenant of filteredTenants) {
      tenantMap.set(tenant.TenantId, { ...tenant, children: [] });
    }

    for (const tenant of filteredTenants) {
      const tenantWithChildren = tenantMap.get(tenant.TenantId)!;
      if (tenant.ParentTenantId && tenantMap.has(tenant.ParentTenantId)) {
        tenantMap.get(tenant.ParentTenantId)!.children!.push(tenantWithChildren);
      } else {
        rootTenants.push(tenantWithChildren);
      }
    }

    return NextResponse.json({ tenants: rootTenants, flat: filteredTenants });
  } catch (err) {
    // Gracefully handle missing tenants table
    if (isUnknownTableError(err)) {
      logger.warn('Tenants table does not exist yet, returning empty list');
      return NextResponse.json({ tenants: [], flat: [] });
    }
    logger.error({ err }, 'Error listing tenants');
    return NextResponse.json({ error: 'Failed to list tenants' }, { status: 500 });
  }
}
