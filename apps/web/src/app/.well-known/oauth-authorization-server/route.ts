import { NextResponse } from 'next/server';

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * This endpoint provides metadata about the OAuth 2.0 authorization server,
 * enabling MCP clients to discover authorization and token endpoints.
 *
 * Flow:
 * 1. MCP client gets 401 from MCP server
 * 2. Client fetches /.well-known/oauth-protected-resource from MCP server
 * 3. That response includes authorization_servers pointing to this server
 * 4. Client fetches THIS endpoint to discover where to send users for authorization
 *
 * GET /.well-known/oauth-authorization-server
 *
 * Response format (RFC 8414):
 * {
 *   "issuer": "https://app.opengander.io",
 *   "authorization_endpoint": "https://app.opengander.io/api/oauth/authorize",
 *   "token_endpoint": "https://app.opengander.io/api/oauth/token",
 *   "jwks_uri": "https://app.opengander.io/api/.well-known/jwks.json",
 *   "response_types_supported": ["code"],
 *   "grant_types_supported": ["authorization_code"],
 *   "code_challenge_methods_supported": ["S256"],
 *   "token_endpoint_auth_methods_supported": ["none"],
 *   "scopes_supported": ["mcp:read", "schema:read"]
 * }
 */
export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const metadata = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    revocation_endpoint: `${baseUrl}/api/oauth/revoke`,
    registration_endpoint: `${baseUrl}/api/oauth/register`,
    jwks_uri: `${baseUrl}/api/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:read', 'schema:read', 'health:read'],
  };

  return NextResponse.json(metadata, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    },
  });
}
