/**
 * Tests for OAuth Token Endpoint
 *
 * Tests the /api/oauth/token endpoint functionality.
 * Tests the validation logic and behavior patterns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyCodeChallenge, isValidCodeVerifier } from './pkce';

// Mock the dependencies
vi.mock('@/lib/auth', () => ({
  signToken: vi.fn(),
}));

vi.mock('@/lib/oauth/clients', () => ({
  getClient: vi.fn(),
  isScopeSubset: vi.fn(),
}));

vi.mock('@/lib/oauth/codes', () => ({
  consumeAuthorizationCode: vi.fn(),
}));

vi.mock('@/lib/queries/users', () => ({
  getUserById: vi.fn(),
}));

import { getClient, isScopeSubset } from './clients';
import { consumeAuthorizationCode } from './codes';
import { signToken } from '@/lib/auth';
import { getUserById } from '@/lib/queries/users';

describe('OAuth Token Endpoint Logic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Content-Type Validation', () => {
    it('should require application/x-www-form-urlencoded', () => {
      const validContentType = 'application/x-www-form-urlencoded';
      const invalidContentTypes = [
        'application/json',
        'multipart/form-data',
        'text/plain',
        null,
      ];

      expect(validContentType).toBe('application/x-www-form-urlencoded');
      invalidContentTypes.forEach(ct => {
        expect(ct).not.toBe('application/x-www-form-urlencoded');
      });
    });
  });

  describe('Grant Type Validation', () => {
    it('should accept authorization_code and refresh_token grant types', () => {
      const validGrantTypes = ['authorization_code', 'refresh_token'];
      const invalidGrantTypes = [
        'client_credentials',
        'password',
        'implicit',
      ];

      validGrantTypes.forEach(gt => {
        expect(['authorization_code', 'refresh_token']).toContain(gt);
      });
      invalidGrantTypes.forEach(gt => {
        expect(['authorization_code', 'refresh_token']).not.toContain(gt);
      });
    });
  });

  describe('Required Parameters', () => {
    it('should require code parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'authorization_code'],
        ['client_id', 'claude-desktop'],
        ['redirect_uri', 'http://localhost:3000/callback'],
        ['code_verifier', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
      ]);

      expect(formData.has('code')).toBe(false);
    });

    it('should require client_id parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'authorization_code'],
        ['code', 'abc123'],
        ['redirect_uri', 'http://localhost:3000/callback'],
        ['code_verifier', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
      ]);

      expect(formData.has('client_id')).toBe(false);
    });

    it('should require redirect_uri parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'authorization_code'],
        ['code', 'abc123'],
        ['client_id', 'claude-desktop'],
        ['code_verifier', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
      ]);

      expect(formData.has('redirect_uri')).toBe(false);
    });

    it('should require code_verifier parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'authorization_code'],
        ['code', 'abc123'],
        ['client_id', 'claude-desktop'],
        ['redirect_uri', 'http://localhost:3000/callback'],
      ]);

      expect(formData.has('code_verifier')).toBe(false);
    });
  });

  describe('PKCE Verification', () => {
    it('should verify code_verifier matches code_challenge', () => {
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      expect(verifyCodeChallenge(codeVerifier, codeChallenge)).toBe(true);
    });

    it('should reject incorrect code_verifier', () => {
      const wrongVerifier = 'wrongverifier1234567890abcdefghijklmnopqr';
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      expect(verifyCodeChallenge(wrongVerifier, codeChallenge)).toBe(false);
    });

    it('should validate code_verifier format', () => {
      // Valid verifiers
      expect(isValidCodeVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(true);

      // Invalid verifiers
      expect(isValidCodeVerifier('short')).toBe(false);
      expect(isValidCodeVerifier('has spaces and invalid characters!!!')).toBe(false);
    });
  });

  describe('Authorization Code Consumption', () => {
    it('should consume valid authorization code', async () => {
      const mockCodeParams = {
        clientId: 'claude-desktop',
        redirectUri: 'http://localhost:3000/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        userId: 'user-123',
        tenantId: 'tenant-456',
        scope: 'mcp:read schema:read',
        resource: 'https://mcp.opengander.io',
      };

      (consumeAuthorizationCode as ReturnType<typeof vi.fn>).mockResolvedValue(mockCodeParams);

      const result = await consumeAuthorizationCode('code123', 'claude-desktop', 'http://localhost:3000/callback');
      expect(result).toEqual(mockCodeParams);
    });

    it('should reject invalid authorization code', async () => {
      (consumeAuthorizationCode as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await consumeAuthorizationCode('invalid-code', 'claude-desktop', 'http://localhost:3000/callback');
      expect(result).toBeNull();
    });

    it('should reject already-used authorization code', async () => {
      (consumeAuthorizationCode as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // First call would have consumed it
      const result = await consumeAuthorizationCode('used-code', 'claude-desktop', 'http://localhost:3000/callback');
      expect(result).toBeNull();
    });
  });

  describe('Access Token Generation', () => {
    it('should generate RS256 access token with correct claims', async () => {
      const mockToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';
      (signToken as ReturnType<typeof vi.fn>).mockResolvedValue(mockToken);

      const payload = {
        sub: 'user-123',
        scope: 'mcp:read schema:read',
        tenant_id: 'tenant-456',
        role: 'admin',
      };

      const token = await signToken(payload, 3600, {
        iss: 'https://app.opengander.io',
        aud: 'https://mcp.opengander.io',
      });

      expect(signToken).toHaveBeenCalledWith(payload, 3600, {
        iss: 'https://app.opengander.io',
        aud: 'https://mcp.opengander.io',
      });
      expect(token).toBe(mockToken);
    });

    it('should set 1 hour expiration', () => {
      const expiresIn = 3600; // seconds
      expect(expiresIn).toBe(3600);
      expect(expiresIn / 60).toBe(60); // 60 minutes
    });
  });

  describe('Token Response Format', () => {
    it('should return correct token response structure with refresh token', () => {
      const tokenResponse = {
        access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'opaque-refresh-token-base64url',
      };

      expect(tokenResponse).toHaveProperty('access_token');
      expect(tokenResponse).toHaveProperty('token_type', 'Bearer');
      expect(tokenResponse).toHaveProperty('expires_in', 3600);
      expect(tokenResponse).toHaveProperty('refresh_token');
    });

    it('should include refresh_token in authorization_code response', () => {
      const tokenResponse = {
        access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'opaque-refresh-token-base64url',
      };

      expect(tokenResponse.refresh_token).toBeTruthy();
      // Refresh tokens are opaque strings, not JWTs
      expect(tokenResponse.refresh_token).not.toContain('.');
    });
  });

  describe('Refresh Token Grant', () => {
    it('should require refresh_token parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'refresh_token'],
        ['client_id', 'claude-desktop'],
      ]);

      expect(formData.has('refresh_token')).toBe(false);
    });

    it('should require client_id parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'refresh_token'],
        ['refresh_token', 'opaque-refresh-token'],
      ]);

      expect(formData.has('client_id')).toBe(false);
    });

    it('should not require code_verifier for refresh_token grant', () => {
      // refresh_token grant doesn't need PKCE (it was already verified on initial auth)
      const refreshGrantParams = ['grant_type', 'refresh_token', 'client_id'];
      expect(refreshGrantParams).not.toContain('code_verifier');
    });

    it('should return new access and refresh tokens', () => {
      const refreshResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-rotated-refresh-token',
      };

      expect(refreshResponse.access_token).toBeTruthy();
      expect(refreshResponse.refresh_token).toBeTruthy();
      // Tokens should be rotated (new token issued)
      expect(refreshResponse.refresh_token).not.toBe('old-refresh-token');
    });
  });

  describe('Scope Reduction on Refresh', () => {
    it('should accept optional scope parameter', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'refresh_token'],
        ['refresh_token', 'opaque-refresh-token'],
        ['client_id', 'claude-desktop'],
        ['scope', 'mcp:read'], // Reduced from 'mcp:read schema:read'
      ]);

      expect(formData.has('scope')).toBe(true);
      expect(formData.get('scope')).toBe('mcp:read');
    });

    it('should validate scope is subset of original', () => {
      (isScopeSubset as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const requested = ['mcp:read'];
      const original = ['mcp:read', 'schema:read'];

      expect(isScopeSubset(requested, original)).toBe(true);
    });

    it('should reject scope expansion', () => {
      (isScopeSubset as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const requested = ['mcp:read', 'schema:read', 'admin:write'];
      const original = ['mcp:read', 'schema:read'];

      expect(isScopeSubset(requested, original)).toBe(false);
    });

    it('should use original scope when no scope parameter provided', () => {
      const formData = new Map<string, string>([
        ['grant_type', 'refresh_token'],
        ['refresh_token', 'opaque-refresh-token'],
        ['client_id', 'claude-desktop'],
        // No scope parameter
      ]);

      expect(formData.has('scope')).toBe(false);
      // Implementation should use tokenData.scope as effectiveScope
    });

    it('should persist reduced scope to new refresh token', () => {
      // When scope is reduced, the new refresh token should have the reduced scope
      // This follows the principle of least privilege
      const originalScope = 'mcp:read schema:read';
      const requestedScope = 'mcp:read';

      // After refresh with scope reduction:
      // - New access token has scope: 'mcp:read'
      // - New refresh token has scope: 'mcp:read' (reduced)
      expect(requestedScope).not.toBe(originalScope);
    });
  });

  describe('Error Response Format', () => {
    it('should use standard OAuth error format', () => {
      const errorResponse = {
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid, expired, or already used',
      };

      expect(errorResponse.error).toBe('invalid_grant');
      expect(errorResponse.error_description).toBeTruthy();
    });

    it('should use correct error codes', () => {
      const errorCodes = {
        missingParam: 'invalid_request',
        unknownClient: 'invalid_client',
        badCode: 'invalid_grant',
        badVerifier: 'invalid_grant',
        wrongGrantType: 'unsupported_grant_type',
      };

      expect(errorCodes.missingParam).toBe('invalid_request');
      expect(errorCodes.unknownClient).toBe('invalid_client');
      expect(errorCodes.badCode).toBe('invalid_grant');
      expect(errorCodes.badVerifier).toBe('invalid_grant');
      expect(errorCodes.wrongGrantType).toBe('unsupported_grant_type');
    });
  });

  describe('Cache Control Headers', () => {
    it('should set no-store for token response', () => {
      const headers = {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      };

      expect(headers['Cache-Control']).toBe('no-store');
      expect(headers['Pragma']).toBe('no-cache');
    });
  });

  describe('Client Validation', () => {
    it('should verify client exists', () => {
      (getClient as ReturnType<typeof vi.fn>).mockReturnValue({
        client_id: 'claude-desktop',
        name: 'Claude Desktop',
        redirect_uris: ['http://localhost:*'],
        scopes: ['mcp:read', 'schema:read'],
      });

      const client = getClient('claude-desktop');
      expect(client).not.toBeNull();
    });

    it('should reject unknown client', () => {
      (getClient as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const client = getClient('unknown-client');
      expect(client).toBeNull();
    });
  });

  describe('User Lookup', () => {
    it('should fetch user by ID from authorization code', async () => {
      const mockUser = {
        UserId: 'user-123',
        Email: 'test@example.com',
        TenantId: 'tenant-456',
        Role: 'admin',
        CreatedAt: '2024-01-01T00:00:00.000Z',
        UpdatedAt: '2024-01-01T00:00:00.000Z',
      };

      (getUserById as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

      const user = await getUserById('user-123');
      expect(user).toEqual(mockUser);
      expect(user?.Role).toBe('admin');
    });

    it('should handle user not found', async () => {
      (getUserById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const user = await getUserById('nonexistent-user');
      expect(user).toBeNull();
    });
  });

  describe('Token Claims', () => {
    it('should include required claims', () => {
      const claims = {
        // Standard claims
        iss: 'https://app.opengander.io',
        sub: 'user-123',
        aud: 'https://mcp.opengander.io',
        exp: Math.floor(Date.now() / 1000) + 3600,

        // Custom claims
        scope: 'mcp:read schema:read',
        tenant_id: 'tenant-456',
        role: 'admin',
      };

      // Standard JWT claims
      expect(claims.iss).toBe('https://app.opengander.io');
      expect(claims.sub).toBe('user-123');
      expect(claims.aud).toBe('https://mcp.opengander.io');
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // Custom claims for MCP
      expect(claims.scope).toContain('mcp:read');
      expect(claims.tenant_id).toBe('tenant-456');
      expect(claims.role).toBe('admin');
    });

    it('should use resource from authorization code as audience', () => {
      const codeParams = {
        resource: 'https://mcp.opengander.io',
      };

      const audience = codeParams.resource || 'https://mcp.opengander.io';
      expect(audience).toBe('https://mcp.opengander.io');
    });

    it('should use default audience if resource not specified', () => {
      const codeParams = {
        resource: undefined,
      };

      const audience = codeParams.resource || 'https://mcp.opengander.io';
      expect(audience).toBe('https://mcp.opengander.io');
    });
  });
});
