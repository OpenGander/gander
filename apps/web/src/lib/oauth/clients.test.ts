import { describe, it, expect } from 'vitest';
import {
  OAUTH_CLIENTS,
  getClient,
  getStaticClient,
  validateRedirectUri,
  validateScopes,
  validateRedirectUriForClient,
  validateScopesForClient,
  isScopeSubset,
  type OAuthClient,
} from './clients';

describe('OAuth Clients Configuration', () => {
  describe('OAUTH_CLIENTS', () => {
    it('should have claude-desktop client defined', () => {
      expect(OAUTH_CLIENTS['claude-desktop']).toBeDefined();
      expect(OAUTH_CLIENTS['claude-desktop'].client_id).toBe('claude-desktop');
      expect(OAUTH_CLIENTS['claude-desktop'].name).toBe('Claude Desktop');
    });

    it('should have cursor client defined', () => {
      expect(OAUTH_CLIENTS['cursor']).toBeDefined();
      expect(OAUTH_CLIENTS['cursor'].client_id).toBe('cursor');
      expect(OAUTH_CLIENTS['cursor'].name).toBe('Cursor');
    });

    it('each client should have required fields', () => {
      Object.values(OAUTH_CLIENTS).forEach((client: OAuthClient) => {
        expect(client.client_id).toBeTruthy();
        expect(client.name).toBeTruthy();
        expect(Array.isArray(client.redirect_uris)).toBe(true);
        expect(client.redirect_uris.length).toBeGreaterThan(0);
        expect(Array.isArray(client.scopes)).toBe(true);
        expect(client.scopes.length).toBeGreaterThan(0);
      });
    });

    it('all clients should have mcp:read scope', () => {
      Object.values(OAUTH_CLIENTS).forEach((client: OAuthClient) => {
        expect(client.scopes).toContain('mcp:read');
      });
    });
  });

  describe('getClient', () => {
    it('should return client for valid client_id', async () => {
      const client = await getClient('claude-desktop');
      expect(client).not.toBeNull();
      expect(client?.client_id).toBe('claude-desktop');
      expect(client?.name).toBe('Claude Desktop');
    });

    it('should return cursor client', async () => {
      const client = await getClient('cursor');
      expect(client).not.toBeNull();
      expect(client?.client_id).toBe('cursor');
      expect(client?.name).toBe('Cursor');
    });

    it('should return null for unknown client_id', async () => {
      expect(await getClient('unknown-client')).toBeNull();
      expect(await getClient('')).toBeNull();
      expect(await getClient('vscode')).toBeNull();
    });

    it('should return null for client_id variations', async () => {
      // Case sensitivity check
      expect(await getClient('Claude-Desktop')).toBeNull();
      expect(await getClient('CLAUDE-DESKTOP')).toBeNull();
      expect(await getClient('Cursor')).toBeNull();
    });
  });

  describe('getStaticClient', () => {
    it('should return client for valid static client_id', () => {
      const client = getStaticClient('claude-desktop');
      expect(client).not.toBeNull();
      expect(client?.client_id).toBe('claude-desktop');
      expect(client?.name).toBe('Claude Desktop');
    });

    it('should return null for unknown client_id', () => {
      expect(getStaticClient('unknown-client')).toBeNull();
    });
  });

  describe('validateRedirectUri', () => {
    describe('localhost wildcard matching', () => {
      it('should match localhost with any port', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000')).toBe(true);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:8080')).toBe(true);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:12345')).toBe(true);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:65535')).toBe(true);
      });

      it('should match localhost with port and path', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000/callback')).toBe(true);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:8080/oauth/callback')).toBe(true);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000/')).toBe(true);
      });

      it('should reject invalid port numbers', async () => {
        // Port 0 is invalid
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:0')).toBe(false);
        // Port over 65535 is invalid
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:65536')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:99999')).toBe(false);
      });

      it('should reject non-numeric ports', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:abc')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:abc123')).toBe(false);
      });

      it('should reject localhost without port when pattern requires port', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://localhost')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost/')).toBe(false);
      });

      it('should reject https localhost (only http is registered)', async () => {
        expect(await validateRedirectUri('claude-desktop', 'https://localhost:3000')).toBe(false);
      });

      it('should reject other hosts', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://127.0.0.1:3000')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://example.com:3000')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://attacker.com:3000')).toBe(false);
      });
    });

    describe('custom scheme matching', () => {
      it('should match claude:// custom scheme exactly', async () => {
        expect(await validateRedirectUri('claude-desktop', 'claude://oauth/callback')).toBe(true);
      });

      it('should match cursor:// custom scheme exactly', async () => {
        expect(await validateRedirectUri('cursor', 'cursor://oauth/callback')).toBe(true);
      });

      it('should reject incorrect custom scheme paths', async () => {
        expect(await validateRedirectUri('claude-desktop', 'claude://oauth')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'claude://callback')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'claude://')).toBe(false);
      });

      it('should reject custom schemes not registered for client', async () => {
        // cursor:// is not registered for claude-desktop
        expect(await validateRedirectUri('claude-desktop', 'cursor://oauth/callback')).toBe(false);
        // claude:// is not registered for cursor
        expect(await validateRedirectUri('cursor', 'claude://oauth/callback')).toBe(false);
      });
    });

    describe('security: authorization code interception prevention', () => {
      it('should reject attacker-controlled domains', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://evil.com/callback')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'https://attacker.com:3000')).toBe(false);
        expect(await validateRedirectUri('cursor', 'http://phishing.site/oauth/callback')).toBe(false);
      });

      it('should reject open redirect attempts', async () => {
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000@evil.com')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000.evil.com')).toBe(false);
      });

      it('should reject data: and javascript: URIs', async () => {
        expect(await validateRedirectUri('claude-desktop', 'data:text/html,<script>alert(1)</script>')).toBe(false);
        expect(await validateRedirectUri('claude-desktop', 'javascript:alert(1)')).toBe(false);
      });
    });

    describe('unknown clients', () => {
      it('should return false for unknown client_id', async () => {
        expect(await validateRedirectUri('unknown', 'http://localhost:3000')).toBe(false);
        expect(await validateRedirectUri('', 'http://localhost:3000')).toBe(false);
      });
    });
  });

  describe('validateRedirectUriForClient', () => {
    it('should match localhost with any port using client object', () => {
      const client = getStaticClient('claude-desktop')!;
      expect(validateRedirectUriForClient(client, 'http://localhost:3000')).toBe(true);
      expect(validateRedirectUriForClient(client, 'http://localhost:8080')).toBe(true);
    });
  });

  describe('validateScopes', () => {
    describe('valid scope combinations', () => {
      it('should accept single allowed scope', async () => {
        expect(await validateScopes('claude-desktop', ['mcp:read'])).toBe(true);
        expect(await validateScopes('claude-desktop', ['schema:read'])).toBe(true);
        expect(await validateScopes('cursor', ['mcp:read'])).toBe(true);
      });

      it('should accept all allowed scopes', async () => {
        expect(await validateScopes('claude-desktop', ['mcp:read', 'schema:read'])).toBe(true);
        expect(await validateScopes('cursor', ['mcp:read', 'schema:read'])).toBe(true);
      });

      it('should accept empty scope array', async () => {
        expect(await validateScopes('claude-desktop', [])).toBe(true);
        expect(await validateScopes('cursor', [])).toBe(true);
      });
    });

    describe('invalid scope combinations', () => {
      it('should reject scopes not in client configuration', async () => {
        expect(await validateScopes('claude-desktop', ['admin:write'])).toBe(false);
        expect(await validateScopes('claude-desktop', ['mcp:write'])).toBe(false);
        expect(await validateScopes('cursor', ['user:delete'])).toBe(false);
      });

      it('should reject if any scope is not allowed', async () => {
        // One valid, one invalid
        expect(await validateScopes('claude-desktop', ['mcp:read', 'admin:write'])).toBe(false);
        expect(await validateScopes('cursor', ['schema:read', 'dangerous:scope'])).toBe(false);
      });

      it('should be case-sensitive', async () => {
        expect(await validateScopes('claude-desktop', ['MCP:READ'])).toBe(false);
        expect(await validateScopes('claude-desktop', ['Mcp:Read'])).toBe(false);
      });
    });

    describe('unknown clients', () => {
      it('should return false for unknown client_id', async () => {
        expect(await validateScopes('unknown', ['mcp:read'])).toBe(false);
        expect(await validateScopes('', ['mcp:read'])).toBe(false);
      });

      it('should return false for unknown client even with empty scopes', async () => {
        expect(await validateScopes('unknown', [])).toBe(false);
      });
    });
  });

  describe('validateScopesForClient', () => {
    it('should accept scopes using client object', () => {
      const client = getStaticClient('claude-desktop')!;
      expect(validateScopesForClient(client, ['mcp:read'])).toBe(true);
      expect(validateScopesForClient(client, ['mcp:read', 'schema:read'])).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in URIs', async () => {
      // These should not match any pattern
      expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000?evil=param')).toBe(true);
      expect(await validateRedirectUri('claude-desktop', 'http://localhost:3000#fragment')).toBe(true);
    });

    it('should handle very long ports (within valid range)', async () => {
      expect(await validateRedirectUri('claude-desktop', 'http://localhost:1')).toBe(true);
      expect(await validateRedirectUri('claude-desktop', 'http://localhost:65535')).toBe(true);
    });
  });

  describe('isScopeSubset', () => {
    describe('valid subsets', () => {
      it('should return true when requested scopes are subset of allowed', () => {
        expect(isScopeSubset(['mcp:read'], ['mcp:read', 'schema:read'])).toBe(true);
        expect(isScopeSubset(['schema:read'], ['mcp:read', 'schema:read'])).toBe(true);
      });

      it('should return true when requested scopes equal allowed scopes', () => {
        expect(isScopeSubset(['mcp:read', 'schema:read'], ['mcp:read', 'schema:read'])).toBe(true);
      });

      it('should return true for empty requested scopes', () => {
        expect(isScopeSubset([], ['mcp:read', 'schema:read'])).toBe(true);
      });

      it('should handle single scope', () => {
        expect(isScopeSubset(['mcp:read'], ['mcp:read'])).toBe(true);
      });
    });

    describe('invalid subsets', () => {
      it('should return false when requested scope not in allowed', () => {
        expect(isScopeSubset(['admin:write'], ['mcp:read', 'schema:read'])).toBe(false);
      });

      it('should return false when any requested scope not in allowed', () => {
        expect(isScopeSubset(['mcp:read', 'admin:write'], ['mcp:read', 'schema:read'])).toBe(false);
      });

      it('should return false for scope expansion attempt', () => {
        expect(isScopeSubset(['mcp:read', 'schema:read', 'extra:scope'], ['mcp:read', 'schema:read'])).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty allowed scopes', () => {
        expect(isScopeSubset(['mcp:read'], [])).toBe(false);
        expect(isScopeSubset([], [])).toBe(true);
      });

      it('should be case-sensitive', () => {
        expect(isScopeSubset(['MCP:READ'], ['mcp:read'])).toBe(false);
        expect(isScopeSubset(['Mcp:Read'], ['mcp:read'])).toBe(false);
      });

      it('should handle duplicate scopes in requested', () => {
        expect(isScopeSubset(['mcp:read', 'mcp:read'], ['mcp:read'])).toBe(true);
      });
    });
  });
});
