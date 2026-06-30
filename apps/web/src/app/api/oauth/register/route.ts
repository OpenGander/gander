/**
 * OAuth 2.1 Dynamic Client Registration Endpoint (RFC 7591)
 *
 * POST /api/oauth/register - Register a new OAuth client
 *
 * Allows MCP clients (like mcp-remote) to self-register without
 * pre-configuration. All dynamically registered clients are public
 * (no client_secret) and require PKCE.
 *
 * Request body (application/json):
 * {
 *   "redirect_uris": ["http://localhost:3000/callback"],  // Required
 *   "client_name": "My MCP Client",                       // Optional
 *   "client_uri": "https://example.com",                  // Optional
 *   "scope": "mcp:read schema:read",                      // Optional, defaults to mcp:read schema:read
 *   "grant_types": ["authorization_code"],                // Optional, defaults to authorization_code
 *   "response_types": ["code"],                           // Optional, defaults to code
 *   "software_id": "mcp-remote",                          // Optional, for tracking
 *   "software_version": "1.0.0"                           // Optional
 * }
 *
 * Response (201 Created):
 * {
 *   "client_id": "uuid",
 *   "client_id_issued_at": 1234567890,
 *   "redirect_uris": [...],
 *   ...
 * }
 *
 * Security:
 * - Rate limited: 10 registrations per minute per IP
 * - Redirect URIs: HTTPS required (except localhost)
 * - Scopes: Limited to mcp:read, schema:read, health:read
 * - All clients are public (PKCE required)
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import {
  registerClient,
  validateRedirectUriForRegistration,
  type ClientRegistrationMetadata,
} from '@/lib/oauth/dynamic-clients';
import logger from '@/lib/logger';

/**
 * Rate limit: 10 registrations per minute per IP
 */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * RFC 7591 Error Response
 */
function registrationError(
  error: string,
  errorDescription: string,
  status: number = 400
): NextResponse {
  return NextResponse.json(
    {
      error,
      error_description: errorDescription,
    },
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * POST /api/oauth/register
 *
 * Register a new OAuth client dynamically.
 */
export async function POST(req: NextRequest) {
  try {
    // Step 1: Rate limiting
    const clientIp = getClientIP(req);
    const rateLimitKey = `oauth_register:${clientIp}`;
    const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          error: 'rate_limit_exceeded',
          error_description: 'Too many registration requests. Please try again later.',
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

    // Step 2: Validate Content-Type
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return registrationError('invalid_request', 'Content-Type must be application/json');
    }

    // Step 3: Parse request body
    let metadata: ClientRegistrationMetadata;
    try {
      metadata = await req.json();
    } catch {
      return registrationError('invalid_request', 'Invalid JSON in request body');
    }

    // Step 4: Validate redirect_uris (required)
    if (!metadata.redirect_uris || !Array.isArray(metadata.redirect_uris)) {
      return registrationError(
        'invalid_redirect_uri',
        'redirect_uris is required and must be an array'
      );
    }

    if (metadata.redirect_uris.length === 0) {
      return registrationError('invalid_redirect_uri', 'At least one redirect_uri is required');
    }

    // Step 5: Validate each redirect URI
    for (const uri of metadata.redirect_uris) {
      if (typeof uri !== 'string') {
        return registrationError('invalid_redirect_uri', 'Each redirect_uri must be a string');
      }

      const validation = validateRedirectUriForRegistration(uri);
      if (!validation.valid) {
        return registrationError('invalid_redirect_uri', validation.error!);
      }
    }

    // Step 6: Validate optional fields
    if (metadata.client_name !== undefined && typeof metadata.client_name !== 'string') {
      return registrationError('invalid_client_metadata', 'client_name must be a string');
    }

    if (metadata.client_uri !== undefined) {
      if (typeof metadata.client_uri !== 'string') {
        return registrationError('invalid_client_metadata', 'client_uri must be a string');
      }
      // Validate client_uri is a valid URL
      try {
        const url = new URL(metadata.client_uri);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return registrationError('invalid_client_metadata', 'client_uri must use http or https');
        }
      } catch {
        return registrationError('invalid_client_metadata', 'client_uri must be a valid URL');
      }
    }

    // Step 7: Validate grant_types if provided
    if (metadata.grant_types !== undefined) {
      if (!Array.isArray(metadata.grant_types)) {
        return registrationError('invalid_client_metadata', 'grant_types must be an array');
      }
      // Only authorization_code is supported
      const unsupported = metadata.grant_types.filter(
        (g) => g !== 'authorization_code' && g !== 'refresh_token'
      );
      if (unsupported.length > 0) {
        return registrationError(
          'invalid_client_metadata',
          `Unsupported grant_types: ${unsupported.join(', ')}. Only authorization_code and refresh_token are supported.`
        );
      }
    }

    // Step 8: Validate response_types if provided
    if (metadata.response_types !== undefined) {
      if (!Array.isArray(metadata.response_types)) {
        return registrationError('invalid_client_metadata', 'response_types must be an array');
      }
      // Only code is supported
      const unsupported = metadata.response_types.filter((r) => r !== 'code');
      if (unsupported.length > 0) {
        return registrationError(
          'invalid_client_metadata',
          `Unsupported response_types: ${unsupported.join(', ')}. Only code is supported.`
        );
      }
    }

    // Step 9: token_endpoint_auth_method must be 'none' (public clients only)
    if (
      metadata.token_endpoint_auth_method !== undefined &&
      metadata.token_endpoint_auth_method !== 'none'
    ) {
      return registrationError(
        'invalid_client_metadata',
        'Only public clients are supported (token_endpoint_auth_method must be none)'
      );
    }

    // Step 10: Register the client
    const response = await registerClient(metadata);

    // Step 11: Return success response (201 Created per RFC 7591)
    return NextResponse.json(response, {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Client registration error');

    // Check for validation errors from registerClient
    if (error instanceof Error) {
      if (error.message.includes('grant_types') || error.message.includes('response_types')) {
        return registrationError('invalid_client_metadata', error.message);
      }
      if (error.message.includes('scope')) {
        return registrationError('invalid_scope', error.message);
      }
    }

    return registrationError('server_error', 'Internal server error', 500);
  }
}
