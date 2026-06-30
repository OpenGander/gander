/**
 * OAuth Token Revocation Endpoint (RFC 7009)
 *
 * POST /api/oauth/revoke - Revoke an access token or refresh token
 *
 * Accepts:
 * - token: The access token or refresh token to revoke
 * - token_type_hint: Optional, "access_token" or "refresh_token"
 *
 * The caller must be authenticated (via session) and can only revoke:
 * 1. Their own tokens (matching sub claim)
 * 2. Any token if they are an admin or superadmin
 *
 * For refresh tokens, revoking one token revokes the entire token family
 * for security (prevents stolen token from being used).
 *
 * Per RFC 7009, this endpoint always returns 200 OK even if the token
 * was already revoked or invalid. This prevents information leakage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeToken, getTokenSubject } from '@/lib/oauth/revocation';
import { revokeRefreshToken } from '@/lib/oauth/refresh-tokens';
import { getClient } from '@/lib/oauth/clients';
import { logAudit } from '@/lib/audit';
import logger from '@/lib/logger';

/**
 * POST /api/oauth/revoke
 */
export async function POST(req: NextRequest) {
  try {
    // Step 1: Verify caller is authenticated
    const session = await getSession();
    if (!session) {
      // RFC 7009 says we should return 401 if authentication is required
      return NextResponse.json(
        { error: 'unauthorized', error_description: 'Authentication required' },
        { status: 401 }
      );
    }

    // Step 2: Validate Content-Type
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/x-www-form-urlencoded')) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Content-Type must be application/x-www-form-urlencoded',
        },
        { status: 400 }
      );
    }

    // Step 3: Parse form data
    const formData = await req.formData();
    const token = formData.get('token') as string;
    const tokenTypeHint = formData.get('token_type_hint') as string | null;
    const client_id = formData.get('client_id') as string | null;

    // Step 4: Validate token parameter
    if (!token) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing token parameter' },
        { status: 400 }
      );
    }

    // Step 4b: Validate client_id if provided (optional per RFC 7009)
    if (client_id) {
      const client = await getClient(client_id);
      if (!client) {
        return NextResponse.json(
          { error: 'invalid_client', error_description: 'Unknown client_id' },
          { status: 400 }
        );
      }
    }

    // Step 5: Validate token_type_hint if provided
    const isRefreshTokenHint = tokenTypeHint === 'refresh_token';
    if (tokenTypeHint && tokenTypeHint !== 'access_token' && tokenTypeHint !== 'refresh_token') {
      // Unknown hint, but per RFC 7009 we should still try to revoke
      logger.debug({ tokenTypeHint }, 'Unknown token_type_hint');
    }

    // Step 6: Determine token type and extract subject
    // Refresh tokens are opaque (not JWTs), so we can't extract subject from them
    // We'll try to revoke as refresh token first if hinted, then fall back to access token
    let tokenSubject: string | null = null;
    if (!isRefreshTokenHint) {
      tokenSubject = getTokenSubject(token);
    }

    // Step 7: Authorization check for access tokens
    // For refresh tokens, we can't extract subject, so we allow the revocation attempt
    // and let the database lookup fail if the token doesn't belong to the user
    // Admins can revoke any token
    const isAdmin = session.role === 'admin' || session.role === 'superadmin';
    const isOwnToken = tokenSubject === session.userId;

    // For access tokens, verify ownership unless admin
    if (!isRefreshTokenHint && tokenSubject && !isOwnToken && !isAdmin) {
      await logAudit(session, 'token_revocation_denied', req, {
        metadata: { token_subject: tokenSubject, reason: 'unauthorized' },
      });

      return NextResponse.json(
        { error: 'unauthorized', error_description: 'Cannot revoke this token' },
        { status: 403 }
      );
    }

    // Step 8: Revoke the token
    let familyId: string | null = null;
    const reason = isOwnToken || isRefreshTokenHint ? 'user_initiated' : 'admin_revocation';

    if (isRefreshTokenHint) {
      // Try to revoke as refresh token first (revokes entire family)
      familyId = await revokeRefreshToken(token, reason);
    }

    // Always revoke as access token too (either it's an access token, or
    // we're being thorough in case the hint was wrong)
    await revokeToken(token, session.userId, reason);

    // Step 9: Log the revocation
    await logAudit(session, 'token_revoked', req, {
      metadata: {
        token_type: isRefreshTokenHint ? 'refresh_token' : 'access_token',
        token_subject: tokenSubject,
        family_id: familyId,
        revoked_by: session.userId,
        is_admin_revocation: !isOwnToken && isAdmin && !isRefreshTokenHint,
      },
    });

    // Step 10: Return success (RFC 7009 specifies 200 OK with empty body)
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Token revocation error');

    // Per RFC 7009, we should return 200 OK even on errors to prevent
    // information leakage about token validity. However, for server errors
    // a 500 is appropriate.
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 }
    );
  }
}
