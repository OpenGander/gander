/**
 * Role-Based Access Control (RBAC) Utilities
 * Handles permission checks, role hierarchy, and tenant scope
 */

import { getClickHouseClient } from './clickhouse';
import type { SessionPayload } from './auth';
import type { Role, Tenant } from './types/user-management';
import { ROLE_HIERARCHY } from './types/user-management';
import { pgIdentityEnabled } from './db/identity-flag';
import * as identityPg from './queries/identity-pg';

// Re-export for convenience
export { ROLE_HIERARCHY };

/**
 * Check if an actor's role meets the minimum required role
 * @param actorRole - The role of the actor
 * @param minimumRole - The minimum role required
 * @returns true if actor has sufficient permissions
 */
export function requireRole(actorRole: Role, minimumRole: Role): boolean {
  return ROLE_HIERARCHY[actorRole] >= ROLE_HIERARCHY[minimumRole];
}

/**
 * Check if an actor can assign a specific role to another user
 * Prevents role escalation (can't assign a role higher than your own)
 * @param actorRole - The role of the actor
 * @param targetRole - The role to be assigned
 * @returns true if the actor can assign this role
 */
export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  // Can only assign roles at or below your level
  // Exception: superadmin can assign any role
  if (actorRole === 'superadmin') {
    return true;
  }
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * Get all tenant IDs that a user has access to based on memberships and role
 * - superadmin: all tenants
 * - admin: all memberships + child tenants of home tenant
 * - moderator/user: all memberships only
 *
 * @param session - The user's session
 * @returns Array of accessible tenant IDs
 */
export async function getTenantScope(session: SessionPayload): Promise<string[]> {
  const { userId, tenantId, role } = session;

  if (pgIdentityEnabled()) {
    if (role === 'superadmin') return identityPg.getAllTenantIds();
    const memberTenantIds = new Set(await identityPg.getUserTenantIds(userId));
    if (role === 'admin') {
      for (const id of await identityPg.getChildTenantIds(tenantId)) memberTenantIds.add(id);
    }
    memberTenantIds.add(tenantId);
    return Array.from(memberTenantIds);
  }

  const client = getClickHouseClient();

  // Superadmin can access all tenants
  if (role === 'superadmin') {
    const result = await client.query({
      query: 'SELECT TenantId FROM opengander.tenants FINAL',
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ TenantId: string }[]>();
    return rows.map((r) => r.TenantId);
  }

  // Get all tenants user is a member of
  const membershipResult = await client.query({
    query: `
      SELECT TenantId FROM opengander.user_tenants FINAL
      WHERE UserId = {userId:String}
    `,
    query_params: { userId },
    format: 'JSONEachRow',
  });
  const membershipRows = await membershipResult.json<{ TenantId: string }[]>();
  const memberTenantIds = new Set(membershipRows.map((r) => r.TenantId));

  // Admin also gets access to child tenants of their home tenant
  if (role === 'admin') {
    const childResult = await client.query({
      query: `
        SELECT TenantId FROM opengander.tenants FINAL
        WHERE ParentTenantId = {tenantId:String}
      `,
      query_params: { tenantId },
      format: 'JSONEachRow',
    });
    const childRows = await childResult.json<{ TenantId: string }[]>();
    for (const row of childRows) {
      memberTenantIds.add(row.TenantId);
    }
  }

  // Ensure home tenant is always included (backward compatibility)
  memberTenantIds.add(tenantId);

  return Array.from(memberTenantIds);
}

/**
 * Check if a user can access a specific tenant
 * @param session - The user's session
 * @param targetTenantId - The tenant to check access for
 * @returns true if the user can access the tenant
 */
export async function canAccessTenant(
  session: SessionPayload,
  targetTenantId: string
): Promise<boolean> {
  const scope = await getTenantScope(session);
  return scope.includes(targetTenantId);
}

/**
 * Check if a user can access a tenant and return their effective role there
 * @param session - The user's session
 * @param targetTenantId - The tenant to check access for
 * @returns Object with canAccess boolean and effectiveRole, or null if no access
 */
export async function canAccessTenantWithRole(
  session: SessionPayload,
  targetTenantId: string
): Promise<{ canAccess: boolean; effectiveRole: Role | null }> {
  const { userId, tenantId, role } = session;

  // Superadmin has access to all tenants with superadmin role
  if (role === 'superadmin') {
    return { canAccess: true, effectiveRole: 'superadmin' };
  }

  if (pgIdentityEnabled()) {
    const memberRole = await identityPg.getUserRoleInTenant(userId, targetTenantId);
    if (memberRole) return { canAccess: true, effectiveRole: memberRole };
    if (role === 'admin' && (await identityPg.isChildTenant(targetTenantId, tenantId))) {
      return { canAccess: true, effectiveRole: 'admin' };
    }
    if (targetTenantId === tenantId) return { canAccess: true, effectiveRole: role };
    return { canAccess: false, effectiveRole: null };
  }

  const client = getClickHouseClient();

  // Check direct membership first
  const membershipResult = await client.query({
    query: `
      SELECT Role FROM opengander.user_tenants FINAL
      WHERE UserId = {userId:String}
        AND TenantId = {targetTenantId:String}
      LIMIT 1
    `,
    query_params: { userId, targetTenantId },
    format: 'JSONEachRow',
  });
  const membershipRows = await membershipResult.json<{ Role: Role }[]>();

  if (membershipRows.length > 0) {
    return { canAccess: true, effectiveRole: membershipRows[0].Role };
  }

  // Admin can access child tenants of home tenant with admin role
  if (role === 'admin') {
    const childResult = await client.query({
      query: `
        SELECT 1 FROM opengander.tenants FINAL
        WHERE TenantId = {targetTenantId:String}
          AND ParentTenantId = {tenantId:String}
        LIMIT 1
      `,
      query_params: { targetTenantId, tenantId },
      format: 'JSONEachRow',
    });
    const childRows = await childResult.json<{ 1: number }[]>();

    if (childRows.length > 0) {
      return { canAccess: true, effectiveRole: 'admin' };
    }
  }

  // Check if this is the user's home tenant (backward compatibility)
  if (targetTenantId === tenantId) {
    return { canAccess: true, effectiveRole: role };
  }

  return { canAccess: false, effectiveRole: null };
}

/**
 * Check if a user can manage another user
 * @param session - The actor's session
 * @param targetUserId - The user to be managed
 * @param targetTenantId - The target user's tenant
 * @returns true if the actor can manage the target user
 */
export async function canManageUser(
  session: SessionPayload,
  targetUserId: string,
  targetTenantId: string
): Promise<boolean> {
  // Can't manage yourself (use separate profile endpoint)
  if (session.userId === targetUserId) {
    return false;
  }

  // Must have at least moderator role
  if (!requireRole(session.role, 'moderator')) {
    return false;
  }

  // Must have access to the target user's tenant
  return canAccessTenant(session, targetTenantId);
}

/**
 * Get tenant details by ID
 * @param tenantId - The tenant ID
 * @returns Tenant object or null if not found
 */
export async function getTenant(tenantId: string): Promise<Tenant | null> {
  if (pgIdentityEnabled()) return identityPg.getTenant(tenantId);
  const client = getClickHouseClient();
  const result = await client.query({
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
      WHERE TenantId = {tenantId:String}
      LIMIT 1
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });
  const rows = await result.json<Tenant[]>();
  return rows[0] || null;
}

/**
 * Get child tenants for a parent tenant
 * @param parentTenantId - The parent tenant ID
 * @returns Array of child tenants
 */
export async function getChildTenants(parentTenantId: string): Promise<Tenant[]> {
  if (pgIdentityEnabled()) return identityPg.getChildTenants(parentTenantId);
  const client = getClickHouseClient();
  const result = await client.query({
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
      WHERE ParentTenantId = {parentTenantId:String}
      ORDER BY Name
    `,
    query_params: { parentTenantId },
    format: 'JSONEachRow',
  });
  return result.json<Tenant[]>();
}

/**
 * Check if a tenant is an agency (has no parent)
 * @param tenant - The tenant to check
 * @returns true if the tenant is a top-level agency
 */
export function isAgency(tenant: Tenant): boolean {
  return tenant.ParentTenantId === null;
}

/**
 * Check if a tenant is a client (has a parent)
 * @param tenant - The tenant to check
 * @returns true if the tenant is a client under an agency
 */
export function isClient(tenant: Tenant): boolean {
  return tenant.ParentTenantId !== null;
}

/**
 * Get the effective tenant ID for the current session
 * If impersonating, returns the impersonated user's tenant
 * @param session - The user's session
 * @returns The effective tenant ID
 */
export function getEffectiveTenantId(session: SessionPayload): string {
  return session.tenantId;
}

/**
 * Get the real actor (original user if impersonating)
 * @param session - The user's session
 * @returns Object with the real actor's userId, email, and tenantId
 */
export function getRealActor(session: SessionPayload): {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
} {
  if (session.impersonating) {
    return {
      userId: session.impersonating.originalUserId,
      email: session.impersonating.originalEmail,
      tenantId: session.impersonating.originalTenantId,
      role: session.impersonating.originalRole,
    };
  }
  return {
    userId: session.userId,
    email: session.email,
    tenantId: session.tenantId,
    role: session.role,
  };
}

/**
 * Validate that a session can perform an action
 * Returns an error message if the action is not allowed, null if allowed
 */
export function validateAction(
  session: SessionPayload,
  action: 'invite' | 'remove_user' | 'change_role' | 'manage_tenant' | 'view_audit' | 'impersonate'
): string | null {
  switch (action) {
    case 'invite':
    case 'remove_user':
      if (!requireRole(session.role, 'moderator')) {
        return 'Requires moderator role or higher';
      }
      break;
    case 'change_role':
    case 'manage_tenant':
    case 'view_audit':
      if (!requireRole(session.role, 'admin')) {
        return 'Requires admin role or higher';
      }
      break;
    case 'impersonate':
      if (session.role !== 'superadmin') {
        return 'Requires superadmin role';
      }
      if (session.impersonating) {
        return 'Cannot start impersonation while already impersonating';
      }
      break;
  }
  return null;
}
