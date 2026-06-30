import { describe, it, expect } from 'vitest';
import {
  validateRedirectUriForRegistration,
  validateDynamicClientScopes,
  isDynamicClientId,
  DYNAMIC_CLIENT_ALLOWED_SCOPES,
  DYNAMIC_CLIENT_DEFAULT_SCOPES,
} from './dynamic-clients';

describe('OAuth Dynamic Client Registration', () => {
  describe('validateRedirectUriForRegistration', () => {
    describe('localhost URIs', () => {
      it('should accept http localhost with port', () => {
        expect(validateRedirectUriForRegistration('http://localhost:3000/callback')).toEqual({
          valid: true,
        });
        expect(validateRedirectUriForRegistration('http://localhost:8080')).toEqual({ valid: true });
        expect(validateRedirectUriForRegistration('http://127.0.0.1:3000/callback')).toEqual({
          valid: true,
        });
      });

      it('should accept https localhost', () => {
        expect(validateRedirectUriForRegistration('https://localhost:3000/callback')).toEqual({
          valid: true,
        });
      });

      it('should reject localhost with fragment', () => {
        const result = validateRedirectUriForRegistration('http://localhost:3000#fragment');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Fragment');
      });
    });

    describe('non-localhost URIs', () => {
      it('should accept https URLs', () => {
        expect(validateRedirectUriForRegistration('https://example.com/callback')).toEqual({
          valid: true,
        });
        expect(validateRedirectUriForRegistration('https://app.example.com/oauth/callback')).toEqual({
          valid: true,
        });
      });

      it('should reject http non-localhost URLs', () => {
        const result = validateRedirectUriForRegistration('http://example.com/callback');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('https');
      });

      it('should reject URLs with fragments', () => {
        const result = validateRedirectUriForRegistration('https://example.com/callback#fragment');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Fragment');
      });

      it('should reject URLs with credentials', () => {
        const result = validateRedirectUriForRegistration('https://user:pass@example.com/callback');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Credentials');
      });
    });

    describe('invalid URLs', () => {
      it('should reject invalid URL format', () => {
        expect(validateRedirectUriForRegistration('not-a-url').valid).toBe(false);
        expect(validateRedirectUriForRegistration('').valid).toBe(false);
        expect(validateRedirectUriForRegistration('://missing-scheme').valid).toBe(false);
      });

      it('should reject non-http(s) schemes', () => {
        expect(validateRedirectUriForRegistration('javascript:alert(1)').valid).toBe(false);
        expect(validateRedirectUriForRegistration('data:text/html,test').valid).toBe(false);
        expect(validateRedirectUriForRegistration('file:///etc/passwd').valid).toBe(false);
      });
    });
  });

  describe('validateDynamicClientScopes', () => {
    it('should accept valid scopes', () => {
      expect(validateDynamicClientScopes('mcp:read')).toEqual({
        valid: true,
        scopes: ['mcp:read'],
      });
      expect(validateDynamicClientScopes('mcp:read schema:read')).toEqual({
        valid: true,
        scopes: ['mcp:read', 'schema:read'],
      });
      expect(validateDynamicClientScopes('health:read')).toEqual({
        valid: true,
        scopes: ['health:read'],
      });
    });

    it('should return default scopes when none provided', () => {
      const result = validateDynamicClientScopes();
      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(DYNAMIC_CLIENT_DEFAULT_SCOPES);
    });

    it('should return default scopes for empty string', () => {
      const result = validateDynamicClientScopes('');
      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(DYNAMIC_CLIENT_DEFAULT_SCOPES);
    });

    it('should reject invalid scopes', () => {
      const result = validateDynamicClientScopes('admin:write');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid scopes');
      expect(result.error).toContain('admin:write');
    });

    it('should reject if any scope is invalid', () => {
      const result = validateDynamicClientScopes('mcp:read admin:write');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('admin:write');
    });

    it('should list allowed scopes in error message', () => {
      const result = validateDynamicClientScopes('bad:scope');
      expect(result.error).toContain(DYNAMIC_CLIENT_ALLOWED_SCOPES.join(', '));
    });
  });

  describe('isDynamicClientId', () => {
    it('should identify UUID v4 format as dynamic', () => {
      expect(isDynamicClientId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
      expect(isDynamicClientId('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
      expect(isDynamicClientId('00000000-0000-4000-8000-000000000000')).toBe(true);
    });

    it('should not identify static client IDs as dynamic', () => {
      expect(isDynamicClientId('claude-desktop')).toBe(false);
      expect(isDynamicClientId('cursor')).toBe(false);
      expect(isDynamicClientId('my-app')).toBe(false);
    });

    it('should reject malformed UUIDs', () => {
      expect(isDynamicClientId('123e4567-e89b-42d3-a456')).toBe(false); // Too short
      expect(isDynamicClientId('123e4567-e89b-12d3-a456-426614174000')).toBe(false); // Version 1 not 4
      expect(isDynamicClientId('123e4567-e89b-42d3-0456-426614174000')).toBe(false); // Invalid variant
      expect(isDynamicClientId('')).toBe(false);
      expect(isDynamicClientId('not-a-uuid')).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have expected allowed scopes', () => {
      expect(DYNAMIC_CLIENT_ALLOWED_SCOPES).toContain('mcp:read');
      expect(DYNAMIC_CLIENT_ALLOWED_SCOPES).toContain('schema:read');
      expect(DYNAMIC_CLIENT_ALLOWED_SCOPES).toContain('health:read');
      // Should NOT include write scopes
      expect(DYNAMIC_CLIENT_ALLOWED_SCOPES).not.toContain('mcp:write');
      expect(DYNAMIC_CLIENT_ALLOWED_SCOPES).not.toContain('admin:write');
    });

    it('should have expected default scopes', () => {
      expect(DYNAMIC_CLIENT_DEFAULT_SCOPES).toContain('mcp:read');
      expect(DYNAMIC_CLIENT_DEFAULT_SCOPES).toContain('schema:read');
    });
  });
});
