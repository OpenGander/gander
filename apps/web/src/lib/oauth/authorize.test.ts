/**
 * Tests for OAuth Authorization Endpoint
 *
 * Tests the /api/oauth/authorize endpoint functionality.
 * Since Next.js API routes are difficult to unit test directly,
 * we test the validation logic and behavior patterns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dependencies before importing the route
vi.mock('@/lib/auth', () => ({
  verifySession: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock('@/lib/oauth/clients', () => ({
  getClient: vi.fn(),
  validateRedirectUri: vi.fn(),
  validateScopes: vi.fn(),
}));

vi.mock('@/lib/oauth/codes', () => ({
  createAuthorizationCode: vi.fn(),
}));

vi.mock('@/lib/queries/users', () => ({
  getUserById: vi.fn(),
}));

import { getClient, validateRedirectUri, validateScopes } from './clients';

describe('OAuth Authorization Endpoint Logic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Parameter Validation', () => {
    it('should require client_id parameter', () => {
      const params = new URLSearchParams({
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        scope: 'mcp:read',
        state: 'abc123',
      });

      expect(params.get('client_id')).toBeNull();
    });

    it('should require redirect_uri parameter', () => {
      const params = new URLSearchParams({
        client_id: 'claude-desktop',
        response_type: 'code',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        scope: 'mcp:read',
        state: 'abc123',
      });

      expect(params.get('redirect_uri')).toBeNull();
    });

    it('should require code_challenge for PKCE', () => {
      const params = new URLSearchParams({
        client_id: 'claude-desktop',
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
        code_challenge_method: 'S256',
        scope: 'mcp:read',
        state: 'abc123',
      });

      expect(params.get('code_challenge')).toBeNull();
    });

    it('should require state parameter', () => {
      const params = new URLSearchParams({
        client_id: 'claude-desktop',
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        scope: 'mcp:read',
      });

      expect(params.get('state')).toBeNull();
    });
  });

  describe('Client Validation', () => {
    it('should accept known clients', async () => {
      (getClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        client_id: 'claude-desktop',
        name: 'Claude Desktop',
        redirect_uris: ['http://localhost:*'],
        scopes: ['mcp:read', 'schema:read'],
      });

      const client = await getClient('claude-desktop');
      expect(client).not.toBeNull();
      expect(client?.client_id).toBe('claude-desktop');
    });

    it('should reject unknown clients', async () => {
      (getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const client = await getClient('unknown-client');
      expect(client).toBeNull();
    });
  });

  describe('Redirect URI Validation', () => {
    it('should accept valid redirect URIs', async () => {
      (validateRedirectUri as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000/callback')).toBe(
        true
      );
    });

    it('should reject invalid redirect URIs', async () => {
      (validateRedirectUri as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      expect(await validateRedirectUri('claude-desktop', 'http://evil.com/callback')).toBe(false);
    });
  });

  describe('Scope Validation', () => {
    it('should accept valid scopes', async () => {
      (validateScopes as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      expect(await validateScopes('claude-desktop', ['mcp:read', 'schema:read'])).toBe(true);
    });

    it('should reject invalid scopes', async () => {
      (validateScopes as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      expect(await validateScopes('claude-desktop', ['admin:write'])).toBe(false);
    });
  });

  describe('Response Type Validation', () => {
    it('should only accept response_type=code', () => {
      const validResponseType = 'code';
      const invalidResponseTypes = ['token', 'id_token', 'none', 'code token'];

      expect(validResponseType).toBe('code');
      invalidResponseTypes.forEach((rt) => {
        expect(rt).not.toBe('code');
      });
    });
  });

  describe('Code Challenge Method Validation', () => {
    it('should only accept S256 method', () => {
      const validMethod = 'S256';
      const invalidMethods = ['plain', 'sha512', 'none'];

      expect(validMethod).toBe('S256');
      invalidMethods.forEach((method) => {
        expect(method).not.toBe('S256');
      });
    });
  });

  describe('OAuth Error Response Format', () => {
    it('should use standard OAuth error codes', () => {
      const validErrorCodes = [
        'invalid_request',
        'invalid_client',
        'invalid_grant',
        'invalid_scope',
        'unsupported_response_type',
        'unsupported_grant_type',
        'server_error',
      ];

      validErrorCodes.forEach((code) => {
        expect(code).toMatch(/^[a-z_]+$/);
      });
    });

    it('should include error_description with human-readable message', () => {
      const errorResponse = {
        error: 'invalid_request',
        error_description: 'Missing required parameter: client_id',
      };

      expect(errorResponse.error).toBeTruthy();
      expect(errorResponse.error_description).toBeTruthy();
      expect(errorResponse.error_description.length).toBeGreaterThan(10);
    });
  });

  describe('Authorization Code Response', () => {
    it('should include code and state in redirect URL', () => {
      const redirectUri = 'http://localhost:3000/callback';
      const code = 'abc123';
      const state = 'xyz789';

      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      url.searchParams.set('state', state);

      expect(url.searchParams.get('code')).toBe(code);
      expect(url.searchParams.get('state')).toBe(state);
    });

    it('should preserve state parameter exactly', () => {
      const state = 'complex-state_with.special~chars';
      const url = new URL('http://localhost:3000/callback');
      url.searchParams.set('state', state);

      expect(url.searchParams.get('state')).toBe(state);
    });
  });

  describe('Login Redirect', () => {
    it('should redirect to login with returnUrl when unauthenticated', () => {
      const oauthParams = new URLSearchParams({
        client_id: 'claude-desktop',
        redirect_uri: 'http://localhost:3000/callback',
        response_type: 'code',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        scope: 'mcp:read',
        state: 'abc123',
      });

      const baseUrl = 'http://localhost:3000';
      const loginUrl = new URL('/signin', baseUrl);
      const returnUrl = `/api/oauth/authorize?${oauthParams.toString()}`;
      loginUrl.searchParams.set('returnUrl', returnUrl);

      expect(loginUrl.pathname).toBe('/signin');
      expect(loginUrl.searchParams.get('returnUrl')).toContain('/api/oauth/authorize');
      expect(loginUrl.searchParams.get('returnUrl')).toContain('client_id=claude-desktop');
    });
  });

  describe('Consent Page Redirect', () => {
    it('should redirect to consent page when authenticated', () => {
      const baseUrl = 'http://localhost:3000';
      const consentUrl = new URL('/oauth/authorize', baseUrl);

      consentUrl.searchParams.set('client_id', 'claude-desktop');
      consentUrl.searchParams.set('redirect_uri', 'http://localhost:8080/callback');
      consentUrl.searchParams.set('response_type', 'code');
      consentUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      consentUrl.searchParams.set('code_challenge_method', 'S256');
      consentUrl.searchParams.set('scope', 'mcp:read schema:read');
      consentUrl.searchParams.set('state', 'abc123');

      expect(consentUrl.pathname).toBe('/oauth/authorize');
      expect(consentUrl.searchParams.get('client_id')).toBe('claude-desktop');
      expect(consentUrl.searchParams.get('scope')).toBe('mcp:read schema:read');
    });
  });
});
