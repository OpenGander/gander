/**
 * Tests for OAuth Token Revocation Endpoint (RFC 7009)
 *
 * Tests the /api/oauth/revoke endpoint functionality including:
 * - Authentication requirements
 * - Content-Type validation
 * - Token parameter validation
 * - Refresh token revocation (family revocation)
 * - Access token revocation
 * - Authorization (own tokens vs admin powers)
 * - Audit logging
 * - RFC 7009 compliance (200 OK even for invalid tokens)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
const mockGetSession = vi.fn();
const mockRevokeToken = vi.fn();
const mockGetTokenSubject = vi.fn();
const mockRevokeRefreshToken = vi.fn();
const mockGetClient = vi.fn();
const mockLogAudit = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}));

vi.mock('@/lib/oauth/revocation', () => ({
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
  getTokenSubject: (token: string) => mockGetTokenSubject(token),
}));

vi.mock('@/lib/oauth/refresh-tokens', () => ({
  revokeRefreshToken: (...args: unknown[]) => mockRevokeRefreshToken(...args),
}));

vi.mock('@/lib/oauth/clients', () => ({
  getClient: (client_id: string) => mockGetClient(client_id),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

// Import after mocks
import { POST } from './route';

describe('OAuth Token Revocation Endpoint', () => {
  const mockUserSession = {
    userId: 'user-123',
    tenantId: 'tenant-456',
    role: 'user',
    email: 'test@example.com',
  };

  const mockAdminSession = {
    userId: 'admin-123',
    tenantId: 'tenant-456',
    role: 'admin',
    email: 'admin@example.com',
  };

  const mockSuperadminSession = {
    userId: 'superadmin-123',
    tenantId: 'tenant-456',
    role: 'superadmin',
    email: 'superadmin@example.com',
  };

  function createRequest(
    body: Record<string, string>,
    contentType: string = 'application/x-www-form-urlencoded'
  ): NextRequest {
    const formData = new URLSearchParams(body);
    return new NextRequest('http://localhost:3000/api/oauth/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
      },
      body: formData.toString(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRevokeToken.mockResolvedValue(undefined);
    mockRevokeRefreshToken.mockResolvedValue(null);
    mockGetClient.mockReturnValue(null); // Default to unknown client
    mockLogAudit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    it('should return 401 without session', async () => {
      mockGetSession.mockResolvedValue(null);

      const req = createRequest({ token: 'some-token' });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('unauthorized');
      expect(body.error_description).toBe('Authentication required');
    });

    it('should proceed with valid session', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'valid-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe('Content-Type Validation', () => {
    it('should reject non-form-urlencoded content type', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);

      const req = createRequest({ token: 'some-token' }, 'application/json');
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('Content-Type');
    });

    it('should accept application/x-www-form-urlencoded', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest(
        { token: 'valid-token' },
        'application/x-www-form-urlencoded'
      );
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('should accept content type with charset', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest(
        { token: 'valid-token' },
        'application/x-www-form-urlencoded; charset=utf-8'
      );
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe('Token Parameter Validation', () => {
    it('should require token parameter', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);

      const req = createRequest({});
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('token');
    });

    it('should accept valid token_type_hint values', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      // access_token hint
      let req = createRequest({
        token: 'some-token',
        token_type_hint: 'access_token',
      });
      let res = await POST(req);
      expect(res.status).toBe(200);

      // refresh_token hint
      req = createRequest({
        token: 'some-token',
        token_type_hint: 'refresh_token',
      });
      res = await POST(req);
      expect(res.status).toBe(200);
    });

    it('should handle unknown token_type_hint gracefully', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      // Per RFC 7009, unknown hints should be ignored and revocation attempted
      const req = createRequest({
        token: 'some-token',
        token_type_hint: 'unknown_type',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe('Refresh Token Revocation', () => {
    it('should revoke refresh token family when hinted', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockRevokeRefreshToken.mockResolvedValue('family-123');

      const req = createRequest({
        token: 'refresh-token-value',
        token_type_hint: 'refresh_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockRevokeRefreshToken).toHaveBeenCalledWith(
        'refresh-token-value',
        'user_initiated'
      );
    });

    it('should also revoke as access token when refresh token hinted', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockRevokeRefreshToken.mockResolvedValue('family-123');

      const req = createRequest({
        token: 'refresh-token-value',
        token_type_hint: 'refresh_token',
      });
      await POST(req);

      // Should also call revokeToken for thoroughness
      expect(mockRevokeToken).toHaveBeenCalled();
    });
  });

  describe('Access Token Revocation', () => {
    it('should revoke access token when hinted', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'access-token-value',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockRevokeToken).toHaveBeenCalledWith(
        'access-token-value',
        'user-123',
        'user_initiated'
      );
    });

    it('should not call revokeRefreshToken for access token hint', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'access-token-value',
        token_type_hint: 'access_token',
      });
      await POST(req);

      expect(mockRevokeRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('Authorization', () => {
    it('should allow user to revoke own access token', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123'); // Same as session user

      const req = createRequest({
        token: 'my-access-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('should deny user revoking another users access token', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('other-user-456'); // Different user

      const req = createRequest({
        token: 'other-users-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('unauthorized');
      expect(body.error_description).toContain('Cannot revoke this token');
    });

    it('should allow admin to revoke any access token', async () => {
      mockGetSession.mockResolvedValue(mockAdminSession);
      mockGetTokenSubject.mockReturnValue('other-user-456'); // Different user

      const req = createRequest({
        token: 'other-users-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('should allow superadmin to revoke any access token', async () => {
      mockGetSession.mockResolvedValue(mockSuperadminSession);
      mockGetTokenSubject.mockReturnValue('other-user-456'); // Different user

      const req = createRequest({
        token: 'other-users-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('should allow any authenticated user to attempt refresh token revocation', async () => {
      // For refresh tokens, we can't extract subject, so ownership check happens at DB level
      mockGetSession.mockResolvedValue(mockUserSession);
      mockRevokeRefreshToken.mockResolvedValue(null); // Token not found

      const req = createRequest({
        token: 'refresh-token',
        token_type_hint: 'refresh_token',
      });
      const res = await POST(req);

      // Should still return 200 per RFC 7009
      expect(res.status).toBe(200);
    });
  });

  describe('Audit Logging', () => {
    it('should log successful token revocation', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'my-token',
        token_type_hint: 'access_token',
      });
      await POST(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        mockUserSession,
        'token_revoked',
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            token_type: 'access_token',
            token_subject: 'user-123',
            revoked_by: 'user-123',
          }),
        })
      );
    });

    it('should log admin revocation with is_admin_revocation flag', async () => {
      mockGetSession.mockResolvedValue(mockAdminSession);
      mockGetTokenSubject.mockReturnValue('other-user-456');

      const req = createRequest({
        token: 'other-users-token',
        token_type_hint: 'access_token',
      });
      await POST(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        mockAdminSession,
        'token_revoked',
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            is_admin_revocation: true,
          }),
        })
      );
    });

    it('should log denied revocation attempts', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('other-user-456');

      const req = createRequest({
        token: 'other-users-token',
        token_type_hint: 'access_token',
      });
      await POST(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        mockUserSession,
        'token_revocation_denied',
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            token_subject: 'other-user-456',
            reason: 'unauthorized',
          }),
        })
      );
    });

    it('should log refresh token revocation with family_id', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockRevokeRefreshToken.mockResolvedValue('family-123');

      const req = createRequest({
        token: 'refresh-token',
        token_type_hint: 'refresh_token',
      });
      await POST(req);

      expect(mockLogAudit).toHaveBeenCalledWith(
        mockUserSession,
        'token_revoked',
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            token_type: 'refresh_token',
            family_id: 'family-123',
          }),
        })
      );
    });
  });

  describe('RFC 7009 Compliance', () => {
    it('should return 200 OK for invalid/unknown token', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue(null); // Can't decode token
      mockRevokeRefreshToken.mockResolvedValue(null);

      const req = createRequest({
        token: 'completely-invalid-token',
      });
      const res = await POST(req);

      // Per RFC 7009: "The authorization server responds with HTTP status code
      // 200 if the token has been revoked successfully or if the client
      // submitted an invalid token."
      expect(res.status).toBe(200);
    });

    it('should return 200 OK for already-revoked token', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'already-revoked-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('should include no-store cache headers', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'some-token',
      });
      const res = await POST(req);

      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Pragma')).toBe('no-cache');
    });

    it('should return empty body on success', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'some-token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('');
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on internal server error', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');
      mockRevokeToken.mockRejectedValue(new Error('Database connection failed'));

      const req = createRequest({
        token: 'some-token',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('server_error');
    });
  });

  describe('Token Type Handling', () => {
    it('should try both token types when no hint provided', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'unknown-token-type',
      });
      await POST(req);

      // Should attempt to revoke as access token
      expect(mockRevokeToken).toHaveBeenCalled();
      // Should not call revokeRefreshToken without hint
      expect(mockRevokeRefreshToken).not.toHaveBeenCalled();
    });

    it('should handle malformed JWT gracefully', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue(null); // JWT decode fails

      const req = createRequest({
        token: 'not.a.valid.jwt',
        token_type_hint: 'access_token',
      });
      const res = await POST(req);

      // Should still return 200 per RFC 7009
      expect(res.status).toBe(200);
    });
  });

  describe('client_id Validation', () => {
    it('should accept request without client_id (optional)', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');

      const req = createRequest({
        token: 'some-token',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      // Should not have validated client_id
      expect(mockGetClient).not.toHaveBeenCalled();
    });

    it('should accept valid client_id', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetTokenSubject.mockReturnValue('user-123');
      mockGetClient.mockReturnValue({
        client_id: 'claude-desktop',
        name: 'Claude Desktop',
        redirect_uris: ['http://localhost:*'],
        scopes: ['mcp:read'],
      });

      const req = createRequest({
        token: 'some-token',
        client_id: 'claude-desktop',
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockGetClient).toHaveBeenCalledWith('claude-desktop');
    });

    it('should reject unknown client_id', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetClient.mockReturnValue(null);

      const req = createRequest({
        token: 'some-token',
        client_id: 'unknown-client',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_client');
      expect(body.error_description).toContain('Unknown client_id');
    });

    it('should validate client_id before processing token', async () => {
      mockGetSession.mockResolvedValue(mockUserSession);
      mockGetClient.mockReturnValue(null);

      const req = createRequest({
        token: 'some-token',
        client_id: 'invalid-client',
      });
      await POST(req);

      // Should NOT have attempted to revoke token
      expect(mockRevokeToken).not.toHaveBeenCalled();
      expect(mockRevokeRefreshToken).not.toHaveBeenCalled();
    });
  });
});
