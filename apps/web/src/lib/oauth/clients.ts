/**
 * OAuth 2.1 Client Management
 *
 * Supports both:
 * 1. Pre-registered static clients (Claude Desktop, Cursor) - highest trust
 * 2. Dynamically registered clients (RFC 7591) - limited scopes
 *
 * Static clients are checked first for performance, then database fallback
 * for dynamic clients.
 */

import { getClientFromDatabase, isDynamicClientId } from './dynamic-clients';

export interface OAuthClient {
  client_id: string;
  name: string;
  redirect_uris: string[]; // Support wildcards like 'http://localhost:*'
  scopes: string[];
}

/**
 * Pre-registered OAuth clients for MCP server access
 *
 * These clients are trusted AI platforms that can access analytics data
 * via the Model Context Protocol.
 */
export const OAUTH_CLIENTS: Record<string, OAuthClient> = {
  'claude-desktop': {
    client_id: 'claude-desktop',
    name: 'Claude Desktop',
    redirect_uris: ['http://localhost:*', 'claude://oauth/callback'],
    scopes: ['mcp:read', 'schema:read'],
  },
  cursor: {
    client_id: 'cursor',
    name: 'Cursor',
    redirect_uris: ['cursor://oauth/callback', 'http://localhost:*'],
    scopes: ['mcp:read', 'schema:read'],
  },
};

/**
 * Get a client by its ID (sync version for static clients only)
 *
 * For internal use when you know the client is static.
 * Use getClient() for the async version that checks database.
 *
 * @param client_id - The client ID to look up
 * @returns The OAuth client or null if not found
 */
export function getStaticClient(client_id: string): OAuthClient | null {
  return OAUTH_CLIENTS[client_id] ?? null;
}

/**
 * Get a client by its ID
 *
 * Checks static clients first (Claude Desktop, Cursor), then falls back
 * to database lookup for dynamically registered clients.
 *
 * @param client_id - The client ID to look up
 * @returns The OAuth client or null if not found
 */
export async function getClient(client_id: string): Promise<OAuthClient | null> {
  // Check static clients first (fast path)
  const staticClient = OAUTH_CLIENTS[client_id];
  if (staticClient) {
    return staticClient;
  }

  // Only query database for UUID-format client IDs (dynamic clients)
  if (isDynamicClientId(client_id)) {
    return getClientFromDatabase(client_id);
  }

  return null;
}

/**
 * Check if a redirect_uri matches a registered pattern
 *
 * Supports wildcards for localhost ports:
 * - 'http://localhost:*' matches 'http://localhost:12345' or 'http://localhost:12345/callback'
 * - Exact match for non-wildcard URIs
 *
 * Security-critical: This prevents authorization code interception attacks.
 *
 * @param pattern - The registered redirect_uri pattern (may contain wildcards)
 * @param uri - The actual redirect_uri from the authorization request
 * @returns true if the URI matches the pattern
 */
function matchesRedirectUri(pattern: string, uri: string): boolean {
  // Check for localhost wildcard pattern: http://localhost:*
  if (pattern.includes('localhost:*')) {
    // Extract the base (before the wildcard) and any path after
    const wildcardIndex = pattern.indexOf(':*');
    const base = pattern.substring(0, wildcardIndex + 1); // 'http://localhost:'

    // Check if the URI starts with the base
    if (!uri.startsWith(base)) {
      return false;
    }

    // Get the part after the base (e.g., '12345/callback' from 'http://localhost:12345/callback')
    const afterBase = uri.substring(base.length);

    // The port must be numeric (at least start with digits)
    // Match digits until we hit a non-digit or end of string
    const portMatch = afterBase.match(/^(\d+)(.*)/);
    if (!portMatch) {
      return false;
    }

    const port = portMatch[1];
    const pathPart = portMatch[2]; // Could be '', '/', '/callback', etc.

    // Validate it's a valid port number (1-65535)
    const portNum = parseInt(port, 10);
    if (portNum < 1 || portNum > 65535) {
      return false;
    }

    // Security: Reject open redirect attempts via @ or . characters before path
    // These could be interpreted as userinfo (user@host) or subdomain (port.evil.com)
    // Only allow: empty string, /, /path, ?query, #fragment after port
    if (pathPart && !pathPart.match(/^[/?#]/)) {
      return false;
    }

    // If the pattern has a path after the wildcard (e.g., 'http://localhost:*/callback'),
    // we need to check that the path matches
    const patternPathStart = pattern.indexOf('*') + 1;
    const patternPath = pattern.substring(patternPathStart); // '' or '/callback'

    if (patternPath) {
      // Pattern has a path requirement, URI path must match or start with it
      return pathPart === patternPath || pathPart.startsWith(patternPath);
    }

    // No path requirement in pattern, any path (or no path) is acceptable
    return true;
  }

  // Exact match for non-wildcard URIs (custom schemes like claude://)
  return pattern === uri;
}

/**
 * Validate that a redirect_uri matches any of the client's registered patterns
 *
 * @param client - The OAuth client
 * @param redirect_uri - The redirect_uri to validate
 * @returns true if the redirect_uri matches any registered pattern
 */
export function validateRedirectUriForClient(
  client: OAuthClient,
  redirect_uri: string
): boolean {
  return client.redirect_uris.some((pattern) =>
    matchesRedirectUri(pattern, redirect_uri)
  );
}

/**
 * Validate that a redirect_uri is allowed for a client
 *
 * Security-critical: This prevents authorization code interception attacks.
 * The redirect_uri from the authorization request must match one of the
 * client's registered URIs.
 *
 * @param client_id - The client ID
 * @param redirect_uri - The redirect_uri to validate
 * @returns true if the redirect_uri is valid for this client
 */
export async function validateRedirectUri(
  client_id: string,
  redirect_uri: string
): Promise<boolean> {
  const client = await getClient(client_id);
  if (!client) {
    return false;
  }

  return validateRedirectUriForClient(client, redirect_uri);
}

/**
 * Validate that all requested scopes are allowed for a client
 *
 * @param client - The OAuth client
 * @param requestedScopes - Array of requested scope strings
 * @returns true if all requested scopes are allowed for this client
 */
export function validateScopesForClient(
  client: OAuthClient,
  requestedScopes: string[]
): boolean {
  return requestedScopes.every((scope) => client.scopes.includes(scope));
}

/**
 * Validate that all requested scopes are allowed for a client
 *
 * @param client_id - The client ID
 * @param requestedScopes - Array of requested scope strings
 * @returns true if all requested scopes are allowed for this client
 */
export async function validateScopes(
  client_id: string,
  requestedScopes: string[]
): Promise<boolean> {
  const client = await getClient(client_id);
  if (!client) {
    return false;
  }

  return validateScopesForClient(client, requestedScopes);
}

/**
 * Check if requested scopes are a subset of allowed scopes
 *
 * Used during refresh token grants to validate scope reduction.
 * OAuth 2.1 allows clients to request a subset of originally granted scopes.
 *
 * @param requested - Array of requested scope strings
 * @param allowed - Array of allowed (originally granted) scope strings
 * @returns true if all requested scopes are in the allowed set
 */
export function isScopeSubset(requested: string[], allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return requested.every((scope) => allowedSet.has(scope));
}
