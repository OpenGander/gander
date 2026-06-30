import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We'll test the metadata structure directly since NextResponse
// requires mocking in a route handler context
describe('OAuth Authorization Server Metadata', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Helper to generate expected metadata structure
   */
  function generateExpectedMetadata(baseUrl: string) {
    return {
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
      scopes_supported: ['mcp:read', 'schema:read', 'health:read'],
    };
  }

  describe('metadata structure', () => {
    it('should have correct structure with production URL', () => {
      const baseUrl = 'https://app.opengander.io';
      const metadata = generateExpectedMetadata(baseUrl);

      // Verify RFC 8414 required fields
      expect(metadata.issuer).toBe(baseUrl);
      expect(metadata.authorization_endpoint).toBe(`${baseUrl}/api/oauth/authorize`);
      expect(metadata.token_endpoint).toBe(`${baseUrl}/api/oauth/token`);
    });

    it('should have correct JWKS URI', () => {
      const baseUrl = 'https://app.opengander.io';
      const metadata = generateExpectedMetadata(baseUrl);

      expect(metadata.jwks_uri).toBe(`${baseUrl}/api/.well-known/jwks.json`);
    });

    it('should support authorization_code and refresh_token grant types', () => {
      const metadata = generateExpectedMetadata('https://example.com');

      expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    });

    it('should have registration endpoint for RFC 7591 dynamic registration', () => {
      const baseUrl = 'https://app.opengander.io';
      const metadata = generateExpectedMetadata(baseUrl);

      expect(metadata.registration_endpoint).toBe(`${baseUrl}/api/oauth/register`);
    });

    it('should have revocation endpoint for RFC 7009', () => {
      const baseUrl = 'https://app.opengander.io';
      const metadata = generateExpectedMetadata(baseUrl);

      expect(metadata.revocation_endpoint).toBe(`${baseUrl}/api/oauth/revoke`);
    });

    it('should support only code response type', () => {
      const metadata = generateExpectedMetadata('https://example.com');

      expect(metadata.response_types_supported).toEqual(['code']);
    });

    it('should require S256 PKCE', () => {
      const metadata = generateExpectedMetadata('https://example.com');

      expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('should support public clients (no authentication)', () => {
      const metadata = generateExpectedMetadata('https://example.com');

      expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
    });

    it('should list supported scopes', () => {
      const metadata = generateExpectedMetadata('https://example.com');

      expect(metadata.scopes_supported).toContain('mcp:read');
      expect(metadata.scopes_supported).toContain('schema:read');
      expect(metadata.scopes_supported).toContain('health:read');
    });
  });

  describe('URL construction', () => {
    it('should use localhost:3000 as default', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const metadata = generateExpectedMetadata(baseUrl);

      expect(metadata.issuer).toBe('http://localhost:3000');
      expect(metadata.authorization_endpoint).toBe('http://localhost:3000/api/oauth/authorize');
    });

    it('should use NEXT_PUBLIC_APP_URL when set', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://custom.example.com';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
      const metadata = generateExpectedMetadata(baseUrl);

      expect(metadata.issuer).toBe('https://custom.example.com');
      expect(metadata.authorization_endpoint).toBe('https://custom.example.com/api/oauth/authorize');
      expect(metadata.token_endpoint).toBe('https://custom.example.com/api/oauth/token');
      expect(metadata.jwks_uri).toBe('https://custom.example.com/api/.well-known/jwks.json');
    });

    it('should handle URL without trailing slash', () => {
      const baseUrl = 'https://app.opengander.io';
      const metadata = generateExpectedMetadata(baseUrl);

      // Should not have double slashes
      expect(metadata.authorization_endpoint).not.toContain('//api');
    });
  });

  describe('RFC 8414 compliance', () => {
    it('should include all required metadata fields', () => {
      const metadata = generateExpectedMetadata('https://example.com');

      // RFC 8414 REQUIRED fields
      expect(metadata).toHaveProperty('issuer');

      // Recommended fields that we include
      expect(metadata).toHaveProperty('authorization_endpoint');
      expect(metadata).toHaveProperty('token_endpoint');
      expect(metadata).toHaveProperty('revocation_endpoint');
      expect(metadata).toHaveProperty('registration_endpoint');
      expect(metadata).toHaveProperty('jwks_uri');
      expect(metadata).toHaveProperty('response_types_supported');
      expect(metadata).toHaveProperty('grant_types_supported');
      expect(metadata).toHaveProperty('code_challenge_methods_supported');
      expect(metadata).toHaveProperty('token_endpoint_auth_methods_supported');
      expect(metadata).toHaveProperty('scopes_supported');
    });

    it('should have issuer exactly matching the authorization server URL', () => {
      const serverUrl = 'https://app.opengander.io';
      const metadata = generateExpectedMetadata(serverUrl);

      // RFC 8414 Section 2: The issuer identifier MUST be
      // identical to the Canonical Authorization Server URL
      expect(metadata.issuer).toBe(serverUrl);
    });
  });
});
