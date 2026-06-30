/**
 * OAuth 2.1 Dynamic Client Registration (RFC 7591)
 *
 * Manages dynamically registered OAuth clients stored in ClickHouse.
 * These clients are registered at runtime via the /api/oauth/register endpoint.
 *
 * Security:
 * - All dynamic clients are public (no client_secret) - PKCE required
 * - Limited to safe scopes: mcp:read, schema:read, health:read
 * - Redirect URIs must be HTTPS (except localhost for development)
 * - Inactive clients are cleaned up after 365 days
 */
import { randomUUID } from 'crypto';
import { getClickHouseClient } from '@/lib/clickhouse';
import type { OAuthClient } from './clients';
import { formatDateTime } from './clickhouse-datetime';
import { pgAuthEnabled } from '@/lib/db/auth-flag';
import * as oauthPg from './oauth-pg';

/**
 * Allowed scopes for dynamically registered clients
 * These are safe read-only scopes that don't grant write access
 */
export const DYNAMIC_CLIENT_ALLOWED_SCOPES = ['mcp:read', 'schema:read', 'health:read'];

/**
 * Default scopes granted to dynamic clients if none specified
 */
export const DYNAMIC_CLIENT_DEFAULT_SCOPES = ['mcp:read', 'schema:read'];

/**
 * RFC 7591 Client Registration Metadata
 * https://tools.ietf.org/html/rfc7591#section-2
 */
export interface ClientRegistrationMetadata {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  scope?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  software_id?: string;
  software_version?: string;
}

/**
 * RFC 7591 Client Information Response
 * https://tools.ietf.org/html/rfc7591#section-3.2.1
 */
export interface ClientRegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  scope?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  software_id?: string;
  software_version?: string;
}

/**
 * Database record for oauth_clients table
 */
interface OAuthClientRecord {
  ClientId: string;
  ClientName: string;
  ClientUri: string;
  RedirectUris: string[];
  GrantTypes: string[];
  ResponseTypes: string[];
  Scope: string;
  TokenEndpointAuthMethod: string;
  SoftwareId: string;
  SoftwareVersion: string;
  ClientIdIssuedAt: string;
  IsActive: number;
  LastUsedAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}

/**
 * Validate that a redirect URI is allowed for dynamic registration
 *
 * Security requirements:
 * - HTTPS required for non-localhost URIs
 * - No fragments allowed
 * - localhost HTTP allowed for development
 * - Reject suspicious patterns (open redirect attempts)
 */
export function validateRedirectUriForRegistration(uri: string): {
  valid: boolean;
  error?: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // No fragments allowed (RFC 6749 Section 3.1.2)
  if (parsed.hash) {
    return { valid: false, error: 'Fragment not allowed in redirect_uri' };
  }

  // localhost HTTP is allowed for development
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (isLocalhost) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'localhost redirect_uri must use http or https' };
    }
    return { valid: true };
  }

  // Non-localhost must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'redirect_uri must use https (except localhost)' };
  }

  // Reject suspicious patterns
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Credentials not allowed in redirect_uri' };
  }

  return { valid: true };
}

/**
 * Validate requested scopes against allowed scopes for dynamic clients
 */
export function validateDynamicClientScopes(requestedScope?: string): {
  valid: boolean;
  scopes: string[];
  error?: string;
} {
  if (!requestedScope) {
    return { valid: true, scopes: DYNAMIC_CLIENT_DEFAULT_SCOPES };
  }

  const requested = requestedScope.split(' ').filter(Boolean);
  const invalid = requested.filter((s) => !DYNAMIC_CLIENT_ALLOWED_SCOPES.includes(s));

  if (invalid.length > 0) {
    return {
      valid: false,
      scopes: [],
      error: `Invalid scopes: ${invalid.join(', ')}. Allowed: ${DYNAMIC_CLIENT_ALLOWED_SCOPES.join(', ')}`,
    };
  }

  return { valid: true, scopes: requested };
}

/**
 * Register a new OAuth client (RFC 7591)
 *
 * @param metadata - Client registration metadata from the request
 * @returns Client registration response with client_id
 */
export async function registerClient(
  metadata: ClientRegistrationMetadata
): Promise<ClientRegistrationResponse> {
  const client = getClickHouseClient();
  const clientId = randomUUID();
  const now = new Date();
  const clientIdIssuedAt = Math.floor(now.getTime() / 1000);

  // Validate and normalize grant_types (default to authorization_code)
  const grantTypes = metadata.grant_types || ['authorization_code'];
  if (!grantTypes.includes('authorization_code')) {
    throw new Error('grant_types must include authorization_code');
  }

  // Validate and normalize response_types (default to code)
  const responseTypes = metadata.response_types || ['code'];
  if (!responseTypes.includes('code')) {
    throw new Error('response_types must include code');
  }

  // Validate scopes
  const scopeValidation = validateDynamicClientScopes(metadata.scope);
  if (!scopeValidation.valid) {
    throw new Error(scopeValidation.error);
  }

  // Token endpoint auth method is always 'none' for public clients
  const tokenEndpointAuthMethod = 'none';

  if (pgAuthEnabled()) {
    await oauthPg.insertClient({
      clientId,
      clientName: metadata.client_name || '',
      clientUri: metadata.client_uri || '',
      redirectUris: metadata.redirect_uris,
      grantTypes,
      responseTypes,
      scope: scopeValidation.scopes.join(' '),
      tokenEndpointAuthMethod,
      softwareId: metadata.software_id || '',
      softwareVersion: metadata.software_version || '',
      clientIdIssuedAt: now,
    });
  } else {
    await client.insert({
      table: 'opengander.oauth_clients',
      values: [
        {
          ClientId: clientId,
          ClientName: metadata.client_name || '',
          ClientUri: metadata.client_uri || '',
          RedirectUris: metadata.redirect_uris,
          GrantTypes: grantTypes,
          ResponseTypes: responseTypes,
          Scope: scopeValidation.scopes.join(' '),
          TokenEndpointAuthMethod: tokenEndpointAuthMethod,
          SoftwareId: metadata.software_id || '',
          SoftwareVersion: metadata.software_version || '',
          ClientIdIssuedAt: formatDateTime(now),
          IsActive: 1,
          LastUsedAt: formatDateTime(now),
          CreatedAt: formatDateTime(now),
          UpdatedAt: formatDateTime(now),
        },
      ],
      format: 'JSONEachRow',
    });
  }

  // Build response (echo back registered metadata per RFC 7591)
  const response: ClientRegistrationResponse = {
    client_id: clientId,
    client_id_issued_at: clientIdIssuedAt,
    redirect_uris: metadata.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    scope: scopeValidation.scopes.join(' '),
  };

  if (metadata.client_name) {
    response.client_name = metadata.client_name;
  }
  if (metadata.client_uri) {
    response.client_uri = metadata.client_uri;
  }
  if (metadata.software_id) {
    response.software_id = metadata.software_id;
  }
  if (metadata.software_version) {
    response.software_version = metadata.software_version;
  }

  return response;
}

/**
 * Get a dynamically registered client from the database
 *
 * @param clientId - The client_id to look up
 * @returns OAuthClient or null if not found/inactive
 */
export async function getClientFromDatabase(clientId: string): Promise<OAuthClient | null> {
  if (pgAuthEnabled()) return oauthPg.getClientFromDatabase(clientId);
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        ClientId,
        ClientName,
        ClientUri,
        RedirectUris,
        GrantTypes,
        ResponseTypes,
        Scope,
        TokenEndpointAuthMethod,
        SoftwareId,
        SoftwareVersion,
        ClientIdIssuedAt,
        IsActive,
        LastUsedAt,
        CreatedAt,
        UpdatedAt
      FROM opengander.oauth_clients FINAL
      WHERE ClientId = {clientId:String}
        AND IsActive = 1
      LIMIT 1
    `,
    query_params: { clientId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<OAuthClientRecord[]>();

  if (rows.length === 0) {
    return null;
  }

  const record = rows[0];

  // Convert to OAuthClient format
  return {
    client_id: record.ClientId,
    name: record.ClientName || record.ClientId,
    redirect_uris: record.RedirectUris,
    scopes: record.Scope ? record.Scope.split(' ').filter(Boolean) : DYNAMIC_CLIENT_DEFAULT_SCOPES,
  };
}

/**
 * Update the LastUsedAt timestamp for a client
 *
 * Called on successful token grant to keep active clients from being TTL'd.
 *
 * @param clientId - The client_id to update
 */
export async function updateClientLastUsed(clientId: string): Promise<void> {
  if (pgAuthEnabled()) return oauthPg.updateClientLastUsed(clientId);
  const client = getClickHouseClient();

  // Fetch current record
  const result = await client.query({
    query: `
      SELECT *
      FROM opengander.oauth_clients FINAL
      WHERE ClientId = {clientId:String}
      LIMIT 1
    `,
    query_params: { clientId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<OAuthClientRecord[]>();

  if (rows.length === 0) {
    return; // Client not found, nothing to update
  }

  const record = rows[0];
  const now = new Date();

  // Insert updated record (ReplacingMergeTree will handle deduplication)
  await client.insert({
    table: 'opengander.oauth_clients',
    values: [
      {
        ClientId: record.ClientId,
        ClientName: record.ClientName,
        ClientUri: record.ClientUri,
        RedirectUris: record.RedirectUris,
        GrantTypes: record.GrantTypes,
        ResponseTypes: record.ResponseTypes,
        Scope: record.Scope,
        TokenEndpointAuthMethod: record.TokenEndpointAuthMethod,
        SoftwareId: record.SoftwareId,
        SoftwareVersion: record.SoftwareVersion,
        ClientIdIssuedAt: record.ClientIdIssuedAt,
        IsActive: record.IsActive,
        LastUsedAt: formatDateTime(now),
        CreatedAt: record.CreatedAt,
        UpdatedAt: formatDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });
}

/**
 * Deactivate a client (soft delete)
 *
 * @param clientId - The client_id to deactivate
 * @returns true if client was found and deactivated, false otherwise
 */
export async function deactivateClient(clientId: string): Promise<boolean> {
  if (pgAuthEnabled()) return oauthPg.deactivateClient(clientId);
  const client = getClickHouseClient();

  // Fetch current record
  const result = await client.query({
    query: `
      SELECT *
      FROM opengander.oauth_clients FINAL
      WHERE ClientId = {clientId:String}
      LIMIT 1
    `,
    query_params: { clientId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<OAuthClientRecord[]>();

  if (rows.length === 0) {
    return false;
  }

  const record = rows[0];
  const now = new Date();

  // Insert updated record with IsActive = 0
  await client.insert({
    table: 'opengander.oauth_clients',
    values: [
      {
        ClientId: record.ClientId,
        ClientName: record.ClientName,
        ClientUri: record.ClientUri,
        RedirectUris: record.RedirectUris,
        GrantTypes: record.GrantTypes,
        ResponseTypes: record.ResponseTypes,
        Scope: record.Scope,
        TokenEndpointAuthMethod: record.TokenEndpointAuthMethod,
        SoftwareId: record.SoftwareId,
        SoftwareVersion: record.SoftwareVersion,
        ClientIdIssuedAt: record.ClientIdIssuedAt,
        IsActive: 0,
        LastUsedAt: record.LastUsedAt,
        CreatedAt: record.CreatedAt,
        UpdatedAt: formatDateTime(now),
      },
    ],
    format: 'JSONEachRow',
  });

  return true;
}

/**
 * Check if a client_id is a dynamic client (UUID format)
 *
 * Static clients have human-readable IDs like 'claude-desktop' or 'cursor'.
 * Dynamic clients have UUID format IDs.
 */
export function isDynamicClientId(clientId: string): boolean {
  // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(clientId);
}
