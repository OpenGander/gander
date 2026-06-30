/**
 * OAuth Token Revocation (RFC 7009)
 *
 * Handles token revocation by storing SHA256 hashes of revoked tokens.
 * The MCP server checks this table before processing authenticated requests.
 */
import { createHash } from 'crypto';
import { decodeJwt } from 'jose';
import { getClickHouseClient } from '@/lib/clickhouse';
import { formatDateTime } from './clickhouse-datetime';
import { pgAuthEnabled } from '@/lib/db/auth-flag';
import * as oauthPg from './oauth-pg';

/**
 * Hash a token using SHA256
 * We never store raw tokens - only hashes
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Extract expiration time from a JWT without verifying it
 * Returns null if token is malformed or has no exp claim
 */
export function getTokenExpiry(token: string): Date | null {
  try {
    const payload = decodeJwt(token);
    if (typeof payload.exp === 'number') {
      return new Date(payload.exp * 1000);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract subject (user ID) from a JWT without verifying it
 */
export function getTokenSubject(token: string): string | null {
  try {
    const payload = decodeJwt(token);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Revoke an access token
 *
 * Stores the token hash in the revocation table. The token will be
 * rejected on subsequent use until it naturally expires (plus 1 day TTL buffer).
 *
 * @param token - The access token to revoke
 * @param revokedBy - User ID of the person revoking the token
 * @param reason - Optional reason for revocation
 */
export async function revokeToken(
  token: string,
  revokedBy: string,
  reason: string = ''
): Promise<void> {
  const tokenHash = hashToken(token);
  const now = new Date();

  // Get token expiry for TTL cleanup
  // If we can't determine expiry, use 1 hour from now as a safeguard
  const tokenExpiry = getTokenExpiry(token);
  const expiresAt = tokenExpiry || new Date(now.getTime() + 60 * 60 * 1000);

  if (pgAuthEnabled()) {
    await oauthPg.insertRevokedToken({ tokenHash, revokedBy, reason, expiresAt });
    return;
  }

  const client = getClickHouseClient();
  await client.insert({
    table: 'opengander.oauth_revoked_tokens',
    values: [
      {
        TokenHash: tokenHash,
        RevokedAt: formatDateTime(now),
        RevokedBy: revokedBy,
        Reason: reason,
        ExpiresAt: formatDateTime(expiresAt),
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Check if a token has been revoked
 *
 * @param token - The access token to check
 * @returns true if the token has been revoked
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  if (pgAuthEnabled()) return oauthPg.isTokenRevoked(tokenHash);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT 1
      FROM opengander.oauth_revoked_tokens
      WHERE TokenHash = {tokenHash:String}
      LIMIT 1
    `,
    query_params: { tokenHash },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ '1': number }[]>();
  return rows.length > 0;
}
