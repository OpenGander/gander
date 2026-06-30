/**
 * OAuth 2.1 Refresh Token Management
 *
 * Implements refresh token issuance, rotation, and theft detection
 * following OAuth 2.1 best practices:
 *
 * - Tokens are opaque strings (not JWTs) - only validated by auth server
 * - Each use rotates the token (old marked rotated, new issued)
 * - Token families track rotation chains for theft detection
 * - If a rotated token is reused, entire family is revoked
 *
 * Storage uses ClickHouse ReplacingMergeTree for efficient updates.
 */
import { randomBytes, createHash } from 'crypto';
import { getClickHouseClient } from '@/lib/clickhouse';
import logger from '@/lib/logger';
import { formatDateTime, parseDateTime } from './clickhouse-datetime';
import { pgAuthEnabled } from '@/lib/db/auth-flag';
import * as oauthPg from './oauth-pg';

/**
 * Refresh token lifetime: 30 days
 */
export const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Grace period for concurrent refresh requests: 5 seconds
 *
 * When multiple clients refresh the same token simultaneously (race condition),
 * the second request arrives after the first has already rotated the token.
 * Without a grace period, this triggers false theft detection.
 *
 * With a grace period, if a rotated token is reused within this window,
 * we assume it's a legitimate race condition rather than theft.
 */
export const ROTATION_GRACE_PERIOD_MS = 5000;

/**
 * Parameters for creating a refresh token
 */
export interface RefreshTokenParams {
  userId: string;
  tenantId: string;
  clientId: string;
  scope: string;
  resource?: string;
  familyId?: string; // Provided on rotation, generated on initial issue
}

/**
 * Refresh token record as stored in ClickHouse
 */
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

/**
 * Result of consuming a refresh token
 */
export interface ConsumedRefreshToken {
  userId: string;
  tenantId: string;
  clientId: string;
  scope: string;
  resource?: string;
  familyId: string;
  /**
   * True if this token was already rotated but within the grace period.
   * Indicates a likely race condition - caller should not issue a new
   * refresh token (the client should already have one from the first request).
   */
  isGracePeriodReuse?: boolean;
}

/**
 * Generate a cryptographically secure random token
 * Returns 32 random bytes encoded as base64url (43 characters)
 */
export function generateRefreshToken(): string {
  const bytes = randomBytes(32);
  // Base64url encoding: replace + with -, / with _, and remove =
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a unique family ID for a new token chain
 */
function generateFamilyId(): string {
  const bytes = randomBytes(16);
  return bytes.toString('hex');
}

/**
 * Hash a refresh token using SHA256
 * Tokens are never stored in raw form
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create and store a new refresh token
 *
 * @param params - Token parameters including user, tenant, client, and scope
 * @returns The raw refresh token (only returned once, store hash in DB)
 */
export async function createRefreshToken(params: RefreshTokenParams): Promise<string> {
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const familyId = params.familyId || generateFamilyId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_EXPIRY_MS);

  if (pgAuthEnabled()) {
    await oauthPg.insertRefreshToken({
      tokenHash,
      familyId,
      userId: params.userId,
      tenantId: params.tenantId,
      clientId: params.clientId,
      scope: params.scope,
      resource: params.resource || '',
      createdAt: now,
      expiresAt,
    });
    return token;
  }

  const client = getClickHouseClient();
  await client.insert({
    table: 'opengander.oauth_refresh_tokens',
    values: [
      {
        TokenHash: tokenHash,
        FamilyId: familyId,
        UserId: params.userId,
        TenantId: params.tenantId,
        ClientId: params.clientId,
        Scope: params.scope,
        Resource: params.resource || '',
        CreatedAt: formatDateTime(now),
        ExpiresAt: formatDateTime(expiresAt),
        Rotated: 0,
        RotatedAt: formatDateTime(new Date(0)),
        Revoked: 0,
        RevokedAt: formatDateTime(new Date(0)),
        UpdatedAt: formatDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });

  return token;
}

/**
 * Consume a refresh token, rotating it in the process
 *
 * Validates the token and marks it as rotated. If the token was already
 * rotated (reuse detected), revokes the entire token family for security.
 *
 * @param token - The raw refresh token
 * @param clientId - The client ID that must match
 * @returns Token metadata for issuing new tokens, or null if invalid
 */
export async function consumeRefreshToken(
  token: string,
  clientId: string
): Promise<ConsumedRefreshToken | null> {
  if (pgAuthEnabled()) return oauthPg.consumeRefreshToken(token, clientId);
  const client = getClickHouseClient();
  const tokenHash = hashRefreshToken(token);

  // Query for the refresh token using FINAL to get merged view
  const result = await client.query({
    query: `
      SELECT
        TokenHash,
        FamilyId,
        UserId,
        TenantId,
        ClientId,
        Scope,
        Resource,
        CreatedAt,
        ExpiresAt,
        Rotated,
        RotatedAt,
        Revoked,
        RevokedAt,
        UpdatedAt
      FROM opengander.oauth_refresh_tokens FINAL
      WHERE TokenHash = {tokenHash:String}
      LIMIT 1
    `,
    query_params: { tokenHash },
    format: 'JSONEachRow',
  });

  const rows = await result.json<RefreshTokenRecord[]>();

  if (rows.length === 0) {
    return null;
  }

  const record = rows[0];

  // Check if token has been revoked
  if (record.Revoked === 1) {
    return null;
  }

  // Check if token has expired
  const expiresAt = parseDateTime(record.ExpiresAt);
  if (expiresAt <= new Date()) {
    return null;
  }

  // Check client ID matches
  if (record.ClientId !== clientId) {
    return null;
  }

  // THEFT DETECTION: If token was already rotated, check if within grace period
  if (record.Rotated === 1) {
    const rotatedAt = parseDateTime(record.RotatedAt);
    const timeSinceRotation = Date.now() - rotatedAt.getTime();

    if (timeSinceRotation <= ROTATION_GRACE_PERIOD_MS) {
      // Within grace period - likely a race condition, not theft
      // Return token data but flag it so caller doesn't issue new refresh token
      return {
        userId: record.UserId,
        tenantId: record.TenantId,
        clientId: record.ClientId,
        scope: record.Scope,
        resource: record.Resource || undefined,
        familyId: record.FamilyId,
        isGracePeriodReuse: true,
      };
    }

    // Beyond grace period - this is theft
    await revokeFamilyTokens(record.FamilyId, 'theft_detection');
    return null;
  }

  // Mark the token as rotated
  const now = new Date();
  await client.insert({
    table: 'opengander.oauth_refresh_tokens',
    values: [
      {
        TokenHash: record.TokenHash,
        FamilyId: record.FamilyId,
        UserId: record.UserId,
        TenantId: record.TenantId,
        ClientId: record.ClientId,
        Scope: record.Scope,
        Resource: record.Resource,
        CreatedAt: record.CreatedAt,
        ExpiresAt: record.ExpiresAt,
        Rotated: 1,
        RotatedAt: formatDateTime(now),
        Revoked: record.Revoked,
        RevokedAt: record.RevokedAt,
        UpdatedAt: formatDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });

  return {
    userId: record.UserId,
    tenantId: record.TenantId,
    clientId: record.ClientId,
    scope: record.Scope,
    resource: record.Resource || undefined,
    familyId: record.FamilyId,
  };
}

/**
 * Revoke all tokens in a family
 *
 * Used for:
 * - Theft detection (rotated token reused)
 * - User-initiated logout
 * - Admin revocation
 *
 * @param familyId - The token family to revoke
 * @param reason - Reason for revocation (for logging)
 */
export async function revokeFamilyTokens(familyId: string, reason: string): Promise<void> {
  if (pgAuthEnabled()) return oauthPg.revokeFamilyTokens(familyId, reason);
  const client = getClickHouseClient();
  const now = new Date();

  // Find all tokens in the family that aren't already revoked
  const result = await client.query({
    query: `
      SELECT
        TokenHash,
        FamilyId,
        UserId,
        TenantId,
        ClientId,
        Scope,
        Resource,
        CreatedAt,
        ExpiresAt,
        Rotated,
        RotatedAt,
        Revoked,
        RevokedAt,
        UpdatedAt
      FROM opengander.oauth_refresh_tokens FINAL
      WHERE FamilyId = {familyId:String}
        AND Revoked = 0
    `,
    query_params: { familyId },
    format: 'JSONEachRow',
  });

  const tokens = await result.json<RefreshTokenRecord[]>();

  if (tokens.length === 0) {
    return;
  }

  // Mark all tokens as revoked
  const revokedTokens = tokens.map((token) => ({
    TokenHash: token.TokenHash,
    FamilyId: token.FamilyId,
    UserId: token.UserId,
    TenantId: token.TenantId,
    ClientId: token.ClientId,
    Scope: token.Scope,
    Resource: token.Resource,
    CreatedAt: token.CreatedAt,
    ExpiresAt: token.ExpiresAt,
    Rotated: token.Rotated,
    RotatedAt: token.RotatedAt,
    Revoked: 1,
    RevokedAt: formatDateTime(now),
    UpdatedAt: formatDateTime(now),
  }));

  await client.insert({
    table: 'opengander.oauth_refresh_tokens',
    values: revokedTokens,
    format: 'JSONEachRow',
  });

  logger.info({ familyId, reason, count: tokens.length }, 'Revoked refresh tokens in family');
}

/**
 * Revoke a specific refresh token by its raw value
 *
 * @param token - The raw refresh token
 * @param reason - Reason for revocation
 * @returns The family ID if found, null otherwise
 */
export async function revokeRefreshToken(token: string, reason: string): Promise<string | null> {
  if (pgAuthEnabled()) return oauthPg.revokeRefreshToken(token, reason);
  const client = getClickHouseClient();
  const tokenHash = hashRefreshToken(token);

  // Find the token
  const result = await client.query({
    query: `
      SELECT
        TokenHash,
        FamilyId,
        UserId,
        TenantId,
        ClientId,
        Scope,
        Resource,
        CreatedAt,
        ExpiresAt,
        Rotated,
        RotatedAt,
        Revoked,
        RevokedAt,
        UpdatedAt
      FROM opengander.oauth_refresh_tokens FINAL
      WHERE TokenHash = {tokenHash:String}
      LIMIT 1
    `,
    query_params: { tokenHash },
    format: 'JSONEachRow',
  });

  const rows = await result.json<RefreshTokenRecord[]>();

  if (rows.length === 0) {
    return null;
  }

  const record = rows[0];

  // Revoke entire family (security best practice)
  await revokeFamilyTokens(record.FamilyId, reason);

  return record.FamilyId;
}

/**
 * Get refresh token metadata by hash (for debugging/admin)
 */
export async function getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
  if (pgAuthEnabled()) return oauthPg.getRefreshTokenByHash(tokenHash);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT *
      FROM opengander.oauth_refresh_tokens FINAL
      WHERE TokenHash = {tokenHash:String}
      LIMIT 1
    `,
    query_params: { tokenHash },
    format: 'JSONEachRow',
  });

  const rows = await result.json<RefreshTokenRecord[]>();
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get refresh token metadata by raw token value
 *
 * @param token - The raw refresh token
 * @returns The token record or null if not found
 */
export async function getRefreshTokenByRawToken(token: string): Promise<RefreshTokenRecord | null> {
  return getRefreshTokenByHash(hashRefreshToken(token));
}

/**
 * Revoke all refresh tokens for a user/client combination
 *
 * Used when authorization code replay is detected (RFC 6749 Section 4.1.2).
 * This revokes ALL tokens that may have been issued from the replayed code.
 *
 * @param userId - The user whose tokens should be revoked
 * @param clientId - The client whose tokens should be revoked
 * @param reason - Reason for revocation (for logging)
 * @returns Number of tokens revoked
 */
export async function revokeTokensByUserAndClient(
  userId: string,
  clientId: string,
  reason: string
): Promise<number> {
  if (pgAuthEnabled()) return oauthPg.revokeTokensByUserAndClient(userId, clientId, reason);
  const client = getClickHouseClient();
  const now = new Date();

  // Find all non-revoked tokens for this user/client
  const result = await client.query({
    query: `
      SELECT
        TokenHash,
        FamilyId,
        UserId,
        TenantId,
        ClientId,
        Scope,
        Resource,
        CreatedAt,
        ExpiresAt,
        Rotated,
        RotatedAt,
        Revoked,
        RevokedAt,
        UpdatedAt
      FROM opengander.oauth_refresh_tokens FINAL
      WHERE UserId = {userId:String}
        AND ClientId = {clientId:String}
        AND Revoked = 0
    `,
    query_params: { userId, clientId },
    format: 'JSONEachRow',
  });

  const tokens = await result.json<RefreshTokenRecord[]>();

  if (tokens.length === 0) {
    return 0;
  }

  // Mark all tokens as revoked
  const revokedTokens = tokens.map((token) => ({
    TokenHash: token.TokenHash,
    FamilyId: token.FamilyId,
    UserId: token.UserId,
    TenantId: token.TenantId,
    ClientId: token.ClientId,
    Scope: token.Scope,
    Resource: token.Resource,
    CreatedAt: token.CreatedAt,
    ExpiresAt: token.ExpiresAt,
    Rotated: token.Rotated,
    RotatedAt: token.RotatedAt,
    Revoked: 1,
    RevokedAt: formatDateTime(now),
    UpdatedAt: formatDateTime(now),
  }));

  await client.insert({
    table: 'opengander.oauth_refresh_tokens',
    values: revokedTokens,
    format: 'JSONEachRow',
  });

  logger.info(
    { userId, clientId, reason, count: tokens.length },
    'Revoked refresh tokens for user/client'
  );

  return tokens.length;
}
