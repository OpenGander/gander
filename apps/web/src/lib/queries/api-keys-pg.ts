/**
 * Postgres implementation of MCP API key storage. Mirrors the inline ClickHouse
 * access in the /api/mcp-keys routes: list (non-revoked), create, fetch-by-id,
 * and revoke (a real UPDATE instead of a ReplacingMergeTree re-insert).
 * Dispatch is gated by pgAuthEnabled().
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { formatDateTime } from '@/lib/oauth/clickhouse-datetime';

/** Matches the row shape the routes already build from ClickHouse. */
export interface ApiKeyRow {
  KeyId: string;
  KeyHash: string;
  KeyPrefix: string;
  Name: string;
  UserId: string;
  TenantId: string;
  Role: string;
  AllowedTenants: string[];
  AllowedTools: string[];
  ExpiresAt: string | null;
  LastUsedAt: string | null;
  RevokedAt: string | null;
  CreatedAt: string;
}

function fdtOrNull(d: Date | null): string | null {
  return d ? formatDateTime(d) : null;
}

function toRow(r: typeof apiKeys.$inferSelect): ApiKeyRow {
  return {
    KeyId: r.keyId,
    KeyHash: r.keyHash,
    KeyPrefix: r.keyPrefix,
    Name: r.name,
    UserId: r.userId,
    TenantId: r.tenantId,
    Role: r.role,
    AllowedTenants: r.allowedTenants,
    AllowedTools: r.allowedTools,
    ExpiresAt: fdtOrNull(r.expiresAt),
    LastUsedAt: fdtOrNull(r.lastUsedAt),
    RevokedAt: fdtOrNull(r.revokedAt),
    CreatedAt: formatDateTime(r.createdAt),
  };
}

/** Active (non-revoked) keys for a user, newest first. */
export async function listActiveApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(sql`${apiKeys.createdAt} DESC`);
  return rows.map(toRow);
}

export async function getApiKeyById(keyId: string): Promise<ApiKeyRow | null> {
  const rows = await getDb().select().from(apiKeys).where(eq(apiKeys.keyId, keyId)).limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

export interface CreateApiKey {
  keyId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  userId: string;
  tenantId: string;
  role: string;
  allowedTenants: string[];
  allowedTools: string[];
  expiresAt: Date | null;
}

export async function createApiKey(p: CreateApiKey): Promise<void> {
  await getDb().insert(apiKeys).values({
    keyId: p.keyId,
    keyHash: p.keyHash,
    keyPrefix: p.keyPrefix,
    name: p.name,
    userId: p.userId,
    tenantId: p.tenantId,
    role: p.role,
    allowedTenants: p.allowedTenants,
    allowedTools: p.allowedTools,
    expiresAt: p.expiresAt,
  });
}

/** Soft-delete: set revoked_at (a real UPDATE). */
export async function revokeApiKey(keyId: string): Promise<void> {
  await getDb().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.keyId, keyId));
}
