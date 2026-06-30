/**
 * OAuth 2.1 Authorization Code Storage
 *
 * Handles creation and consumption of authorization codes for the OAuth PKCE flow.
 * Codes are single-use, short-lived (10 minutes), and stored in ClickHouse.
 *
 * Uses ReplacingMergeTree with UpdatedAt for proper "mark as used" semantics.
 * Queries use FINAL to get the merged view ensuring used codes are rejected.
 */
import { randomBytes } from 'crypto';
import { getClickHouseClient } from '@/lib/clickhouse';
import logger from '@/lib/logger';
import { formatDateTime, parseDateTime } from './clickhouse-datetime';
import { pgAuthEnabled } from '@/lib/db/auth-flag';
import * as oauthPg from './oauth-pg';

/**
 * Normalize a resource URI for consistent storage and comparison.
 * Per RFC 8707, resource URIs should be absolute URIs without fragments.
 * We also strip trailing slashes for canonical form.
 */
function normalizeResourceUri(resource: string | undefined): string {
  if (!resource) return '';
  // Strip trailing slashes for canonical form
  return resource.replace(/\/+$/, '');
}

/**
 * Parameters for creating an authorization code
 */
export interface AuthorizationCodeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  tenantId: string;
  scope: string;
  resource?: string;
}

/**
 * Result when code replay is detected
 * Per RFC 6749 Section 4.1.2: If an authorization code is used more than once,
 * the authorization server MUST revoke all tokens previously issued.
 */
export interface CodeReplayResult {
  replay: true;
  userId: string;
  tenantId: string;
  clientId: string;
}

/**
 * Authorization code record as stored in ClickHouse
 */
interface AuthorizationCodeRecord {
  Code: string;
  ClientId: string;
  RedirectUri: string;
  CodeChallenge: string;
  CodeChallengeMethod: string;
  UserId: string;
  TenantId: string;
  Scope: string;
  Resource: string;
  CreatedAt: string;
  ExpiresAt: string;
  Used: number;
  UpdatedAt: string;
}

/**
 * Code expiration time in milliseconds (10 minutes)
 */
const CODE_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Generate a cryptographically secure random code
 * Returns 32 random bytes encoded as base64url (43 characters)
 */
function generateSecureCode(): string {
  const bytes = randomBytes(32);
  // Base64url encoding: replace + with -, / with _, and remove =
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate and store an authorization code
 *
 * Creates a cryptographically secure code with a 10-minute expiry
 * and stores it in ClickHouse for later validation.
 *
 * @param params - Authorization code parameters including client, user, and PKCE details
 * @returns The generated authorization code
 */
export async function createAuthorizationCode(params: AuthorizationCodeParams): Promise<string> {
  const code = generateSecureCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_EXPIRY_MS);

  if (pgAuthEnabled()) {
    await oauthPg.insertAuthorizationCode({
      code,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      userId: params.userId,
      tenantId: params.tenantId,
      scope: params.scope,
      resource: normalizeResourceUri(params.resource),
      createdAt: now,
      expiresAt,
    });
    return code;
  }

  const client = getClickHouseClient();
  await client.insert({
    table: 'opengander.oauth_authorization_codes',
    values: [
      {
        Code: code,
        ClientId: params.clientId,
        RedirectUri: params.redirectUri,
        CodeChallenge: params.codeChallenge,
        CodeChallengeMethod: params.codeChallengeMethod,
        UserId: params.userId,
        TenantId: params.tenantId,
        Scope: params.scope,
        Resource: normalizeResourceUri(params.resource),
        CreatedAt: formatDateTime(now),
        ExpiresAt: formatDateTime(expiresAt),
        Used: 0,
        UpdatedAt: formatDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });

  return code;
}

/**
 * Validate and consume an authorization code
 *
 * Retrieves the code from storage, validates it against the provided
 * client ID and redirect URI, marks it as used, and returns the
 * authorization parameters.
 *
 * Uses FINAL to get the merged view from ReplacingMergeTree, ensuring
 * that used codes (with higher UpdatedAt) are properly seen as used.
 *
 * SECURITY: If code replay is detected (code already used), returns
 * CodeReplayResult so the caller can revoke all tokens issued from this code.
 * This follows RFC 6749 Section 4.1.2 and both Ory Hydra and node-oidc-provider.
 *
 * @param code - The authorization code to consume
 * @param clientId - The client ID that must match the stored code
 * @param redirectUri - The redirect URI that must match the stored code
 * @returns The authorization code parameters if valid, CodeReplayResult if replayed, null otherwise
 */
export async function consumeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<AuthorizationCodeParams | CodeReplayResult | null> {
  if (pgAuthEnabled()) return oauthPg.consumeAuthorizationCode(code, clientId, redirectUri);
  const client = getClickHouseClient();

  // Query for the authorization code using FINAL to get merged view
  // This ensures we see the latest state (including Used=1 if marked)
  const result = await client.query({
    query: `
      SELECT
        Code,
        ClientId,
        RedirectUri,
        CodeChallenge,
        CodeChallengeMethod,
        UserId,
        TenantId,
        Scope,
        Resource,
        CreatedAt,
        ExpiresAt,
        Used,
        UpdatedAt
      FROM opengander.oauth_authorization_codes FINAL
      WHERE Code = {code:String}
      LIMIT 1
    `,
    query_params: { code },
    format: 'JSONEachRow',
  });

  const rows = await result.json<AuthorizationCodeRecord[]>();

  if (rows.length === 0) {
    return null;
  }

  const record = rows[0];

  // CODE REPLAY DETECTION: If code was already used, return replay info
  // Per RFC 6749 Section 4.1.2: If an authorization code is used more than once,
  // the authorization server MUST deny the request and SHOULD revoke all tokens
  // previously issued based on that authorization code.
  if (record.Used === 1) {
    logger.warn(
      { clientId: record.ClientId, userId: record.UserId },
      'Authorization code replay detected'
    );
    return {
      replay: true,
      userId: record.UserId,
      tenantId: record.TenantId,
      clientId: record.ClientId,
    };
  }

  // Validate code hasn't expired
  const expiresAt = parseDateTime(record.ExpiresAt);
  if (expiresAt <= new Date()) {
    return null;
  }

  // Validate client ID matches
  if (record.ClientId !== clientId) {
    return null;
  }

  // Validate redirect URI matches
  if (record.RedirectUri !== redirectUri) {
    return null;
  }

  // Mark the code as used by inserting a new row with Used=1 and later UpdatedAt
  // ReplacingMergeTree will keep the row with the highest UpdatedAt (the used one)
  const now = new Date();
  await client.insert({
    table: 'opengander.oauth_authorization_codes',
    values: [
      {
        Code: record.Code,
        ClientId: record.ClientId,
        RedirectUri: record.RedirectUri,
        CodeChallenge: record.CodeChallenge,
        CodeChallengeMethod: record.CodeChallengeMethod,
        UserId: record.UserId,
        TenantId: record.TenantId,
        Scope: record.Scope,
        Resource: record.Resource,
        CreatedAt: record.CreatedAt,
        ExpiresAt: record.ExpiresAt,
        Used: 1,
        UpdatedAt: formatDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });

  return {
    clientId: record.ClientId,
    redirectUri: record.RedirectUri,
    codeChallenge: record.CodeChallenge,
    codeChallengeMethod: record.CodeChallengeMethod,
    userId: record.UserId,
    tenantId: record.TenantId,
    scope: record.Scope,
    resource: record.Resource || undefined,
  };
}

/**
 * Type guard to check if the result is a code replay detection
 */
export function isCodeReplay(
  result: AuthorizationCodeParams | CodeReplayResult | null
): result is CodeReplayResult {
  return result !== null && 'replay' in result && result.replay === true;
}
