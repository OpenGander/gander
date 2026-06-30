/**
 * OAuth 2.1 Token Endpoint
 *
 * POST /api/oauth/token - Exchange authorization code or refresh token for access token
 *
 * Implements OAuth 2.1 Authorization Code Grant with PKCE:
 * 1. Client sends code, client_id, redirect_uri, code_verifier
 * 2. Validate grant_type=authorization_code or grant_type=refresh_token
 * 3. Consume authorization code (single-use) or refresh token (with rotation)
 * 4. Verify PKCE: SHA256(code_verifier) == stored code_challenge
 * 5. Issue RS256-signed access token (and refresh token for authorization_code grant)
 *
 * Refresh Token Features:
 * - Tokens are rotated on each use (old token invalidated, new issued)
 * - Token families track rotation chains for theft detection
 * - Reusing a rotated token revokes the entire family
 */
import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth';
import { getClient, isScopeSubset } from '@/lib/oauth/clients';
import { consumeAuthorizationCode, isCodeReplay } from '@/lib/oauth/codes';
import { verifyCodeChallenge, isValidCodeVerifier } from '@/lib/oauth/pkce';
import { getUserById } from '@/lib/queries/users';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import {
  createRefreshToken,
  consumeRefreshToken,
  revokeTokensByUserAndClient,
} from '@/lib/oauth/refresh-tokens';
import { updateClientLastUsed, isDynamicClientId } from '@/lib/oauth/dynamic-clients';
import logger from '@/lib/logger';

/**
 * Access token expiration time in seconds (1 hour)
 */
const ACCESS_TOKEN_EXPIRY = 3600;

/**
 * Rate limit configuration for the token endpoint
 * 100 requests per minute per IP address
 */
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Standard OAuth error response
 */
function oauthError(error: string, errorDescription: string, status: number = 400): NextResponse {
  return NextResponse.json(
    {
      error,
      error_description: errorDescription,
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }
  );
}

/**
 * POST /api/oauth/token
 *
 * Token endpoint for exchanging authorization code for access token.
 */
export async function POST(req: NextRequest) {
  try {
    // Step 0: Rate limiting
    const clientIp = getClientIP(req);
    const rateLimitKey = `oauth_token:${clientIp}`;
    const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          error: 'rate_limit_exceeded',
          error_description: 'Too many token requests. Please try again later.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, retryAfter)),
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(rateLimitResult.resetAt / 1000)),
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    // Step 1: Validate Content-Type
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/x-www-form-urlencoded')) {
      return oauthError(
        'invalid_request',
        'Content-Type must be application/x-www-form-urlencoded'
      );
    }

    // Step 2: Parse form data
    const formData = await req.formData();
    const grant_type = formData.get('grant_type') as string;
    const code = formData.get('code') as string;
    const client_id = formData.get('client_id') as string;
    const redirect_uri = formData.get('redirect_uri') as string;
    const code_verifier = formData.get('code_verifier') as string;

    // Step 3: Validate grant_type
    if (!grant_type) {
      return oauthError('invalid_request', 'Missing grant_type');
    }
    if (grant_type !== 'authorization_code' && grant_type !== 'refresh_token') {
      return oauthError(
        'unsupported_grant_type',
        'Only grant_type=authorization_code and grant_type=refresh_token are supported'
      );
    }

    // Handle refresh_token grant type
    if (grant_type === 'refresh_token') {
      return handleRefreshTokenGrant(formData);
    }

    // Step 4: Validate required parameters
    if (!code) {
      return oauthError('invalid_request', 'Missing code');
    }
    if (!client_id) {
      return oauthError('invalid_request', 'Missing client_id');
    }
    if (!redirect_uri) {
      return oauthError('invalid_request', 'Missing redirect_uri');
    }
    if (!code_verifier) {
      return oauthError('invalid_request', 'Missing code_verifier');
    }

    // Step 5: Validate client exists
    const client = await getClient(client_id);
    if (!client) {
      return oauthError('invalid_client', 'Unknown client_id');
    }

    // Step 6: Validate code_verifier format
    if (!isValidCodeVerifier(code_verifier)) {
      return oauthError(
        'invalid_request',
        'Invalid code_verifier format (must be 43-128 chars, [A-Za-z0-9-._~])'
      );
    }

    // Step 7: Consume authorization code (validates client_id and redirect_uri)
    const codeResult = await consumeAuthorizationCode(code, client_id, redirect_uri);

    // Handle code replay attack (RFC 6749 Section 4.1.2)
    // If a code is used more than once, revoke ALL tokens issued from it
    if (isCodeReplay(codeResult)) {
      // Revoke all refresh tokens for this user/client
      await revokeTokensByUserAndClient(
        codeResult.userId,
        codeResult.clientId,
        'authorization_code_replay'
      );
      logger.warn(
        { userId: codeResult.userId },
        'Authorization code replay attack detected and mitigated'
      );
      return oauthError('invalid_grant', 'Authorization code has already been used');
    }

    if (!codeResult) {
      return oauthError('invalid_grant', 'Authorization code is invalid, expired, or already used');
    }

    const codeParams = codeResult;

    // Step 8: Verify PKCE - SHA256(code_verifier) must equal code_challenge
    if (!verifyCodeChallenge(code_verifier, codeParams.codeChallenge)) {
      return oauthError(
        'invalid_grant',
        'PKCE verification failed: code_verifier does not match code_challenge'
      );
    }

    // Step 9: Get user details for token claims
    const user = await getUserById(codeParams.userId);
    if (!user) {
      return oauthError('invalid_grant', 'User not found');
    }

    // Step 10: Build access token claims
    const issuer = process.env.NEXT_PUBLIC_APP_URL || 'https://app.opengander.io';
    const audience = codeParams.resource || 'https://mcp.opengander.io';

    logger.info(
      {
        sub: codeParams.userId,
        issuer,
        audience,
        resource_from_code: codeParams.resource || '(not set)',
        scope: codeParams.scope,
      },
      'Issuing OAuth token'
    );

    const tokenPayload = {
      sub: codeParams.userId,
      scope: codeParams.scope,
      tenant_id: codeParams.tenantId,
      role: user.Role,
    };

    // Step 11: Sign access token with RS256
    const accessToken = await signToken(tokenPayload, ACCESS_TOKEN_EXPIRY, {
      iss: issuer,
      aud: audience,
    });

    // Step 12: Issue refresh token
    const refreshToken = await createRefreshToken({
      userId: codeParams.userId,
      tenantId: codeParams.tenantId,
      clientId: client_id,
      scope: codeParams.scope,
      resource: codeParams.resource,
    });

    // Step 13: Update LastUsedAt for dynamic clients (non-blocking)
    if (isDynamicClientId(client_id)) {
      updateClientLastUsed(client_id).catch((err) => {
        logger.error({ err }, 'Failed to update client LastUsedAt');
      });
    }

    // Step 14: Return token response with refresh token
    return NextResponse.json(
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY,
        refresh_token: refreshToken,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    const diagnostics = {
      err: error,
      has_private_key: !!process.env.JWT_PRIVATE_KEY,
      has_public_key: !!process.env.JWT_PUBLIC_KEY,
      has_key_id: !!process.env.JWT_KEY_ID,
      clickhouse_host: process.env.CLICKHOUSE_HOST || '(not set)',
    };
    logger.error(diagnostics, 'OAuth token error');
    return oauthError('server_error', 'Internal server error', 500);
  }
}

/**
 * Handle refresh_token grant type
 *
 * Validates and rotates the refresh token, then issues new access and refresh tokens.
 * If the token was already used (replay attack), revokes the entire token family.
 */
async function handleRefreshTokenGrant(formData: FormData): Promise<NextResponse> {
  const refresh_token = formData.get('refresh_token') as string;
  const client_id = formData.get('client_id') as string;

  // Validate required parameters
  if (!refresh_token) {
    return oauthError('invalid_request', 'Missing refresh_token');
  }
  if (!client_id) {
    return oauthError('invalid_request', 'Missing client_id');
  }

  // Validate client exists
  const client = await getClient(client_id);
  if (!client) {
    return oauthError('invalid_client', 'Unknown client_id');
  }

  // Consume the refresh token (validates and rotates)
  const tokenData = await consumeRefreshToken(refresh_token, client_id);
  if (!tokenData) {
    return oauthError(
      'invalid_grant',
      'Refresh token is invalid, expired, revoked, or already used'
    );
  }

  // Get user details for token claims
  const user = await getUserById(tokenData.userId);
  if (!user) {
    return oauthError('invalid_grant', 'User not found');
  }

  // Handle optional scope reduction (OAuth 2.1 allows requesting fewer scopes)
  const requested_scope = formData.get('scope') as string | null;
  let effectiveScope = tokenData.scope;

  if (requested_scope) {
    const requestedScopes = requested_scope.split(' ').filter(Boolean);
    const originalScopes = tokenData.scope.split(' ').filter(Boolean);

    if (!isScopeSubset(requestedScopes, originalScopes)) {
      return oauthError('invalid_scope', 'Requested scope exceeds originally granted scope');
    }

    effectiveScope = requestedScopes.join(' ');
  }

  // Build access token claims
  const issuer = process.env.NEXT_PUBLIC_APP_URL || 'https://app.opengander.io';
  const audience = tokenData.resource || 'https://mcp.opengander.io';

  const tokenPayload = {
    sub: tokenData.userId,
    scope: effectiveScope,
    tenant_id: tokenData.tenantId,
    role: user.Role,
  };

  // Sign new access token
  const accessToken = await signToken(tokenPayload, ACCESS_TOKEN_EXPIRY, {
    iss: issuer,
    aud: audience,
  });

  const responseHeaders = {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  };

  // Handle grace period reuse (concurrent refresh race condition)
  // Don't issue new refresh token - client should have one from first request
  if (tokenData.isGracePeriodReuse) {
    return NextResponse.json(
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY,
        // Note: no refresh_token - client should use the one from first request
      },
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  }

  // Issue new refresh token (same family for rotation tracking)
  // Use effectiveScope to persist scope reduction per OAuth 2.1
  const newRefreshToken = await createRefreshToken({
    userId: tokenData.userId,
    tenantId: tokenData.tenantId,
    clientId: client_id,
    scope: effectiveScope,
    resource: tokenData.resource,
    familyId: tokenData.familyId, // Same family for theft detection
  });

  // Update LastUsedAt for dynamic clients (non-blocking)
  if (isDynamicClientId(client_id)) {
    updateClientLastUsed(client_id).catch((err) => {
      logger.error({ err }, 'Failed to update client LastUsedAt');
    });
  }

  // Return token response
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_EXPIRY,
      refresh_token: newRefreshToken,
    },
    {
      status: 200,
      headers: responseHeaders,
    }
  );
}
