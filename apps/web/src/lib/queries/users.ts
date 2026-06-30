/**
 * User lookup queries for multi-tenant authentication
 */
import { getClickHouseClient } from '@/lib/clickhouse';
import type { User, Tenant, Role } from '@/lib/types/user-management';
import { normalizeEmail } from '@/lib/utils/email';
import { pgIdentityEnabled } from '@/lib/db/identity-flag';
import * as identityPg from './identity-pg';

// Re-export types for backwards compatibility
export type { User, Tenant };

/**
 * Look up a user by email address
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  if (pgIdentityEnabled()) return identityPg.getUserByEmail(email);
  const client = getClickHouseClient();
  const normalizedEmail = normalizeEmail(email);

  const result = await client.query({
    query: `
      SELECT UserId, Email, TenantId, Role, CreatedAt, UpdatedAt
      FROM opengander.users
      WHERE Email = {email:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { email: normalizedEmail },
    format: 'JSONEachRow',
  });

  const rows = await result.json<User[]>();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Look up a user by user ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  if (pgIdentityEnabled()) return identityPg.getUserById(userId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT UserId, Email, TenantId, Role, CreatedAt, UpdatedAt
      FROM opengander.users FINAL
      WHERE UserId = {userId:String}
      LIMIT 1
    `,
    query_params: { userId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<User[]>();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get tenant details by tenant ID
 */
export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  if (pgIdentityEnabled()) return identityPg.getTenantById(tenantId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT TenantId, Name, Slug, AllowedDomains, CreatedAt, UpdatedAt
      FROM opengander.tenants
      WHERE TenantId = {tenantId:String}
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Tenant[]>();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Match an email domain to a tenant's AllowedDomains
 * Returns the first matching tenant, or null if no match
 */
export async function getTenantByDomain(emailDomain: string): Promise<Tenant | null> {
  if (pgIdentityEnabled()) return identityPg.getTenantByDomain(emailDomain);
  const client = getClickHouseClient();

  // Query all tenants and check domain match in ClickHouse
  // Using hasAny to check if the domain is in the AllowedDomains array
  const result = await client.query({
    query: `
      SELECT TenantId, Name, Slug, AllowedDomains, CreatedAt, UpdatedAt
      FROM opengander.tenants
      WHERE has(AllowedDomains, {domain:String})
      ORDER BY UpdatedAt DESC
      LIMIT 1
    `,
    query_params: { domain: emailDomain },
    format: 'JSONEachRow',
  });

  const rows = await result.json<Tenant[]>();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Create or update a user record
 * Uses ReplacingMergeTree semantics - inserts new row, FINAL query returns latest
 */
export async function upsertUser(
  userId: string,
  email: string,
  tenantId: string,
  role: Role = 'user'
): Promise<void> {
  if (pgIdentityEnabled()) return identityPg.upsertUser(userId, email, tenantId, role);
  const client = getClickHouseClient();
  const normalizedEmail = normalizeEmail(email);

  await client.insert({
    table: 'opengander.users',
    values: [
      {
        UserId: userId,
        Email: normalizedEmail,
        TenantId: tenantId,
        Role: role,
        // Let ClickHouse use DEFAULT now64(3) for CreatedAt/UpdatedAt
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Extract domain from email address
 */
export function extractDomain(email: string): string {
  const parts = email.split('@');
  return parts.length > 1 ? parts[1].toLowerCase() : '';
}
