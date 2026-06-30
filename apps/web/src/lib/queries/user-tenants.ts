/**
 * User-Tenant Membership Queries
 * Functions for managing multi-tenant user memberships
 */

import { getClickHouseClient } from '@/lib/clickhouse';
import type { Role, UserTenantMembership, MembershipWithTenant } from '@/lib/types/user-management';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from './identity-pg';

/**
 * Get all tenant memberships for a user
 * @param userId - The user ID to look up
 * @returns Array of memberships with tenant info
 */
export async function getUserMemberships(userId: string): Promise<MembershipWithTenant[]> {
  if (pgIdentityEnabled()) return identityPg.getUserMemberships(userId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        ut.UserId AS UserId,
        ut.TenantId AS TenantId,
        ut.Role AS Role,
        ut.JoinedAt AS JoinedAt,
        ut.InvitedBy AS InvitedBy,
        ut.UpdatedAt AS UpdatedAt,
        t.Name AS TenantName,
        t.Slug AS TenantSlug
      FROM opengander.user_tenants ut FINAL
      LEFT JOIN opengander.tenants t FINAL ON ut.TenantId = t.TenantId
      WHERE ut.UserId = {userId:String}
      ORDER BY ut.JoinedAt ASC
    `,
    query_params: { userId },
    format: 'JSONEachRow',
  });

  return result.json<MembershipWithTenant[]>();
}

/**
 * Check if a user is a member of a specific tenant
 * @param userId - The user ID
 * @param tenantId - The tenant ID to check
 * @returns true if user is a member
 */
export async function isUserMemberOfTenant(userId: string, tenantId: string): Promise<boolean> {
  if (pgIdentityEnabled()) return identityPg.isUserMemberOfTenant(userId, tenantId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT 1
      FROM opengander.user_tenants FINAL
      WHERE UserId = {userId:String}
        AND TenantId = {tenantId:String}
      LIMIT 1
    `,
    query_params: { userId, tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ 1: number }[]>();
  return rows.length > 0;
}

/**
 * Get a user's role in a specific tenant
 * @param userId - The user ID
 * @param tenantId - The tenant ID
 * @returns The user's role in that tenant, or null if not a member
 */
export async function getUserRoleInTenant(userId: string, tenantId: string): Promise<Role | null> {
  if (pgIdentityEnabled()) return identityPg.getUserRoleInTenant(userId, tenantId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT Role
      FROM opengander.user_tenants FINAL
      WHERE UserId = {userId:String}
        AND TenantId = {tenantId:String}
      LIMIT 1
    `,
    query_params: { userId, tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ Role: Role }[]>();
  return rows.length > 0 ? rows[0].Role : null;
}

/**
 * Add a user to a tenant with a specific role
 * @param userId - The user ID to add
 * @param tenantId - The tenant to add them to
 * @param role - The role to assign
 * @param invitedBy - Optional user ID of who invited them
 */
export async function addUserToTenant(
  userId: string,
  tenantId: string,
  role: Role,
  invitedBy?: string
): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.addUserToTenant(userId, tenantId, role, invitedBy);
  const client = getClickHouseClient();

  await client.insert({
    table: 'opengander.user_tenants',
    values: [
      {
        UserId: userId,
        TenantId: tenantId,
        Role: role,
        InvitedBy: invitedBy || null,
        // JoinedAt and UpdatedAt use ClickHouse DEFAULT now64(3)
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Remove a user from a tenant
 * Note: Uses ReplacingMergeTree deletion pattern - inserts with special marker
 * For hard delete, would need ALTER TABLE DELETE
 * @param userId - The user ID to remove
 * @param tenantId - The tenant to remove them from
 */
export async function removeUserFromTenant(userId: string, tenantId: string): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.removeUserFromTenant(userId, tenantId);
  const client = getClickHouseClient();

  // For ReplacingMergeTree, we use ALTER TABLE DELETE for actual removal
  await client.command({
    query: `
      ALTER TABLE opengander.user_tenants
      DELETE WHERE UserId = {userId:String} AND TenantId = {tenantId:String}
    `,
    query_params: { userId, tenantId },
  });
}

/**
 * Update a user's role in a specific tenant
 * @param userId - The user ID
 * @param tenantId - The tenant ID
 * @param newRole - The new role to assign
 */
export async function updateUserRoleInTenant(
  userId: string,
  tenantId: string,
  newRole: Role
): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.updateUserRoleInTenant(userId, tenantId, newRole);
  const client = getClickHouseClient();

  // ReplacingMergeTree: insert new row with updated values
  // The FINAL query will return only the latest version
  await client.insert({
    table: 'opengander.user_tenants',
    values: [
      {
        UserId: userId,
        TenantId: tenantId,
        Role: newRole,
        // Preserve JoinedAt by not setting it (will use previous or default)
        // UpdatedAt uses DEFAULT now64(3)
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Get all members of a tenant
 * @param tenantId - The tenant ID
 * @returns Array of memberships with user info
 */
export async function getTenantMembers(
  tenantId: string
): Promise<(UserTenantMembership & { Email: string })[]> {
  if (pgIdentityEnabled()) return identityPg.getTenantMembers(tenantId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        ut.UserId AS UserId,
        ut.TenantId AS TenantId,
        ut.Role AS Role,
        ut.JoinedAt AS JoinedAt,
        ut.InvitedBy AS InvitedBy,
        ut.UpdatedAt AS UpdatedAt,
        u.Email AS Email
      FROM opengander.user_tenants ut FINAL
      INNER JOIN opengander.users u FINAL ON ut.UserId = u.UserId
      WHERE ut.TenantId = {tenantId:String}
      ORDER BY ut.Role DESC, u.Email ASC
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  return result.json<(UserTenantMembership & { Email: string })[]>();
}

/**
 * Get all tenant IDs where a user has membership
 * @param userId - The user ID
 * @returns Array of tenant IDs
 */
export async function getUserTenantIds(userId: string): Promise<string[]> {
  if (pgIdentityEnabled()) return identityPg.getUserTenantIds(userId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT TenantId
      FROM opengander.user_tenants FINAL
      WHERE UserId = {userId:String}
    `,
    query_params: { userId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ TenantId: string }[]>();
  return rows.map((r) => r.TenantId);
}
