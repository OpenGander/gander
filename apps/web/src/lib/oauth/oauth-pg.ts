/**
 * Postgres implementations of OAuth 2.1 storage (authorization codes, refresh
 * tokens, revoked tokens, dynamic clients). Mirrors the ClickHouse modules but
 * uses real transactions + row locks where it matters:
 *
 *  - single-use authorization codes: SELECT ... FOR UPDATE, then mark used
 *  - refresh-token rotation + family theft detection: one transaction that
 *    locks the token, decides rotate vs. revoke-family, and writes atomically
 *
 * Dispatch from the ClickHouse modules is gated by pgAuthEnabled().
 */
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  oauthAuthorizationCodes,
  oauthRefreshTokens,
  oauthRevokedTokens,
  oauthClients,
} from '@/lib/db/schema';
import type { OAuthClient } from './clients';
import { DYNAMIC_CLIENT_DEFAULT_SCOPES } from './dynamic-clients';
import { formatDateTime } from './clickhouse-datetime';
import logger from '@/lib/logger';

// Mirror of the ROTATION_GRACE_PERIOD_MS constant in refresh-tokens.ts; kept in
// sync to avoid a circular import between that module and this one.
const ROTATION_GRACE_PERIOD_MS = 5000;
const EPOCH = formatDateTime(new Date(0));

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
/** Records preserve the ClickHouse string/number shapes (UInt8 flags → 0/1). */
function fdt(d: Date | null | undefined): string {
  return d ? formatDateTime(d) : EPOCH;
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export interface InsertAuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  tenantId: string;
  scope: string;
  resource: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function insertAuthorizationCode(p: InsertAuthorizationCode): Promise<void> {
  await getDb().insert(oauthAuthorizationCodes).values({
    code: p.code,
    clientId: p.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    codeChallengeMethod: p.codeChallengeMethod,
    userId: p.userId,
    tenantId: p.tenantId,
    scope: p.scope,
    resource: p.resource,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    used: false,
    updatedAt: p.createdAt,
  });
}

export interface ConsumedAuthorizationCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  tenantId: string;
  scope: string;
  resource?: string;
}
export interface CodeReplayResult {
  replay: true;
  userId: string;
  tenantId: string;
  clientId: string;
}

/** Validate + atomically mark-used a single-use authorization code. */
export async function consumeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<ConsumedAuthorizationCode | CodeReplayResult | null> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.code, code))
      .limit(1)
      .for('update');
    const r = rows[0];
    if (!r) return null;

    if (r.used) {
      logger.warn({ clientId: r.clientId, userId: r.userId }, 'Authorization code replay detected');
      return {
        replay: true as const,
        userId: r.userId,
        tenantId: r.tenantId,
        clientId: r.clientId,
      };
    }
    if (r.expiresAt <= new Date()) return null;
    if (r.clientId !== clientId) return null;
    if (r.redirectUri !== redirectUri) return null;

    await tx
      .update(oauthAuthorizationCodes)
      .set({ used: true, updatedAt: new Date() })
      .where(eq(oauthAuthorizationCodes.code, code));

    return {
      clientId: r.clientId,
      redirectUri: r.redirectUri,
      codeChallenge: r.codeChallenge,
      codeChallengeMethod: r.codeChallengeMethod,
      userId: r.userId,
      tenantId: r.tenantId,
      scope: r.scope,
      resource: r.resource || undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

export interface RefreshTokenRecord {
  TokenHash: string;
  FamilyId: string;
  UserId: string;
  TenantId: string;
  ClientId: string;
  Scope: string;
  Resource: string;
  CreatedAt: string;
  ExpiresAt: string;
  Rotated: number;
  RotatedAt: string;
  Revoked: number;
  RevokedAt: string;
  UpdatedAt: string;
}
export interface ConsumedRefreshToken {
  userId: string;
  tenantId: string;
  clientId: string;
  scope: string;
  resource?: string;
  familyId: string;
  isGracePeriodReuse?: boolean;
}

function toRecord(r: typeof oauthRefreshTokens.$inferSelect): RefreshTokenRecord {
  return {
    TokenHash: r.tokenHash,
    FamilyId: r.familyId,
    UserId: r.userId,
    TenantId: r.tenantId,
    ClientId: r.clientId,
    Scope: r.scope,
    Resource: r.resource,
    CreatedAt: fdt(r.createdAt),
    ExpiresAt: fdt(r.expiresAt),
    Rotated: r.rotated ? 1 : 0,
    RotatedAt: fdt(r.rotatedAt),
    Revoked: r.revoked ? 1 : 0,
    RevokedAt: fdt(r.revokedAt),
    UpdatedAt: fdt(r.updatedAt),
  };
}

export interface InsertRefreshToken {
  tokenHash: string;
  familyId: string;
  userId: string;
  tenantId: string;
  clientId: string;
  scope: string;
  resource: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function insertRefreshToken(p: InsertRefreshToken): Promise<void> {
  await getDb().insert(oauthRefreshTokens).values({
    tokenHash: p.tokenHash,
    familyId: p.familyId,
    userId: p.userId,
    tenantId: p.tenantId,
    clientId: p.clientId,
    scope: p.scope,
    resource: p.resource,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    rotated: false,
    revoked: false,
  });
}

/** Rotate a refresh token, detecting family theft — all in one transaction. */
export async function consumeRefreshToken(
  token: string,
  clientId: string
): Promise<ConsumedRefreshToken | null> {
  const tokenHash = sha256(token);
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for('update');
    const r = rows[0];
    if (!r) return null;
    if (r.revoked) return null;
    if (r.expiresAt <= new Date()) return null;
    if (r.clientId !== clientId) return null;

    if (r.rotated) {
      const since = Date.now() - (r.rotatedAt?.getTime() ?? 0);
      if (since <= ROTATION_GRACE_PERIOD_MS) {
        // Concurrent refresh race, not theft: hand back data but flag it so the
        // caller does NOT mint a second refresh token.
        return {
          userId: r.userId,
          tenantId: r.tenantId,
          clientId: r.clientId,
          scope: r.scope,
          resource: r.resource || undefined,
          familyId: r.familyId,
          isGracePeriodReuse: true,
        };
      }
      // Reuse beyond the grace period ⇒ theft: revoke the whole family.
      const now = new Date();
      await tx
        .update(oauthRefreshTokens)
        .set({ revoked: true, revokedAt: now, updatedAt: now })
        .where(
          and(eq(oauthRefreshTokens.familyId, r.familyId), eq(oauthRefreshTokens.revoked, false))
        );
      logger.info(
        { familyId: r.familyId, reason: 'theft_detection' },
        'Revoked refresh token family'
      );
      return null;
    }

    const now = new Date();
    await tx
      .update(oauthRefreshTokens)
      .set({ rotated: true, rotatedAt: now, updatedAt: now })
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash));

    return {
      userId: r.userId,
      tenantId: r.tenantId,
      clientId: r.clientId,
      scope: r.scope,
      resource: r.resource || undefined,
      familyId: r.familyId,
    };
  });
}

export async function revokeFamilyTokens(familyId: string, reason: string): Promise<void> {
  const now = new Date();
  const res = await getDb()
    .update(oauthRefreshTokens)
    .set({ revoked: true, revokedAt: now, updatedAt: now })
    .where(and(eq(oauthRefreshTokens.familyId, familyId), eq(oauthRefreshTokens.revoked, false)));
  if (res.rowCount) {
    logger.info({ familyId, reason, count: res.rowCount }, 'Revoked refresh tokens in family');
  }
}

export async function revokeRefreshToken(token: string, reason: string): Promise<string | null> {
  const tokenHash = sha256(token);
  const rows = await getDb()
    .select({ familyId: oauthRefreshTokens.familyId })
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (!rows[0]) return null;
  await revokeFamilyTokens(rows[0].familyId, reason);
  return rows[0].familyId;
}

export async function getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
  const rows = await getDb()
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function revokeTokensByUserAndClient(
  userId: string,
  clientId: string,
  reason: string
): Promise<number> {
  const now = new Date();
  const res = await getDb()
    .update(oauthRefreshTokens)
    .set({ revoked: true, revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(oauthRefreshTokens.userId, userId),
        eq(oauthRefreshTokens.clientId, clientId),
        eq(oauthRefreshTokens.revoked, false)
      )
    );
  const count = res.rowCount ?? 0;
  if (count)
    logger.info({ userId, clientId, reason, count }, 'Revoked refresh tokens for user/client');
  return count;
}

// ---------------------------------------------------------------------------
// Revoked access tokens (RFC 7009)
// ---------------------------------------------------------------------------

export async function insertRevokedToken(p: {
  tokenHash: string;
  revokedBy: string;
  reason: string;
  expiresAt: Date;
}): Promise<void> {
  await getDb()
    .insert(oauthRevokedTokens)
    .values({
      tokenHash: p.tokenHash,
      revokedBy: p.revokedBy,
      reason: p.reason,
      expiresAt: p.expiresAt,
    })
    .onConflictDoNothing();
}

export async function isTokenRevoked(tokenHash: string): Promise<boolean> {
  const rows = await getDb()
    .select({ tokenHash: oauthRevokedTokens.tokenHash })
    .from(oauthRevokedTokens)
    .where(eq(oauthRevokedTokens.tokenHash, tokenHash))
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Dynamic clients (RFC 7591)
// ---------------------------------------------------------------------------

export interface InsertClient {
  clientId: string;
  clientName: string;
  clientUri: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
  tokenEndpointAuthMethod: string;
  softwareId: string;
  softwareVersion: string;
  clientIdIssuedAt: Date;
}

export async function insertClient(p: InsertClient): Promise<void> {
  const now = new Date();
  await getDb().insert(oauthClients).values({
    clientId: p.clientId,
    clientName: p.clientName,
    clientUri: p.clientUri,
    redirectUris: p.redirectUris,
    grantTypes: p.grantTypes,
    responseTypes: p.responseTypes,
    scope: p.scope,
    tokenEndpointAuthMethod: p.tokenEndpointAuthMethod,
    softwareId: p.softwareId,
    softwareVersion: p.softwareVersion,
    clientIdIssuedAt: p.clientIdIssuedAt,
    isActive: true,
    lastUsedAt: now,
  });
}

export async function getClientFromDatabase(clientId: string): Promise<OAuthClient | null> {
  const rows = await getDb()
    .select()
    .from(oauthClients)
    .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.isActive, true)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    client_id: r.clientId,
    name: r.clientName || r.clientId,
    redirect_uris: r.redirectUris,
    scopes: r.scope ? r.scope.split(' ').filter(Boolean) : DYNAMIC_CLIENT_DEFAULT_SCOPES,
  };
}

export async function updateClientLastUsed(clientId: string): Promise<void> {
  const now = new Date();
  await getDb()
    .update(oauthClients)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(oauthClients.clientId, clientId));
}

export async function deactivateClient(clientId: string): Promise<boolean> {
  const res = await getDb()
    .update(oauthClients)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(oauthClients.clientId, clientId));
  return (res.rowCount ?? 0) > 0;
}
