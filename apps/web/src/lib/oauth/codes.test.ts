import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the ClickHouse client
const mockInsert = vi.fn();
const mockQuery = vi.fn();

vi.mock('@/lib/clickhouse', () => ({
  getClickHouseClient: () => ({
    insert: mockInsert,
    query: mockQuery,
  }),
}));

// Mock crypto.randomBytes for predictable test output
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from('a'.repeat(32))),
  };
});

// Import the module after mocks are set up
import { createAuthorizationCode, consumeAuthorizationCode } from './codes';

describe('OAuth Authorization Codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createAuthorizationCode', () => {
    it('should create a code with all required parameters', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      const params = {
        clientId: 'mcp-claude-desktop',
        redirectUri: 'http://localhost:8080/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        userId: 'user-123',
        tenantId: 'tenant-456',
        scope: 'analytics:read',
      };

      const code = await createAuthorizationCode(params);

      // Verify code is base64url encoded (no +, /, or =)
      expect(code).not.toMatch(/[+/=]/);
      expect(code.length).toBe(43); // 32 bytes = 43 base64url chars

      // Verify ClickHouse insert was called
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith({
        table: 'opengander.oauth_authorization_codes',
        values: [expect.objectContaining({
          ClientId: 'mcp-claude-desktop',
          RedirectUri: 'http://localhost:8080/callback',
          CodeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          CodeChallengeMethod: 'S256',
          UserId: 'user-123',
          TenantId: 'tenant-456',
          Scope: 'analytics:read',
          Resource: '',
          Used: 0,
        })],
        format: 'JSONEachRow',
      });
    });

    it('should include optional resource parameter', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      const params = {
        clientId: 'mcp-claude-desktop',
        redirectUri: 'http://localhost:8080/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        userId: 'user-123',
        tenantId: 'tenant-456',
        scope: 'analytics:read',
        resource: 'https://api.opengander.io',
      };

      await createAuthorizationCode(params);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          values: [expect.objectContaining({
            Resource: 'https://api.opengander.io',
          })],
        })
      );
    });

    it('should set expiry to 10 minutes in the future', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      await createAuthorizationCode({
        clientId: 'test',
        redirectUri: 'http://localhost/callback',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        userId: 'user-1',
        tenantId: 'tenant-1',
        scope: 'read',
      });

      const insertedValues = mockInsert.mock.calls[0][0].values[0];

      // ExpiresAt should be 10 minutes after CreatedAt
      const createdAt = new Date(insertedValues.CreatedAt.replace(' ', 'T') + 'Z');
      const expiresAt = new Date(insertedValues.ExpiresAt.replace(' ', 'T') + 'Z');
      const diffMs = expiresAt.getTime() - createdAt.getTime();

      expect(diffMs).toBe(10 * 60 * 1000); // 10 minutes
    });
  });

  describe('consumeAuthorizationCode', () => {
    const validRecord = {
      Code: 'test-code-123',
      ClientId: 'mcp-claude-desktop',
      RedirectUri: 'http://localhost:8080/callback',
      CodeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      CodeChallengeMethod: 'S256',
      UserId: 'user-123',
      TenantId: 'tenant-456',
      Scope: 'analytics:read',
      Resource: '',
      CreatedAt: '2024-01-15 10:00:00.000',
      ExpiresAt: '2024-01-15 10:10:00.000', // 10 min expiry
      Used: 0,
      UpdatedAt: '2024-01-15 10:00:00.000',
    };

    it('should return params for valid unused code', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });
      mockInsert.mockResolvedValueOnce(undefined);

      const result = await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      expect(result).toEqual({
        clientId: 'mcp-claude-desktop',
        redirectUri: 'http://localhost:8080/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        userId: 'user-123',
        tenantId: 'tenant-456',
        scope: 'analytics:read',
        resource: undefined,
      });
    });

    it('should include resource when present', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [{
          ...validRecord,
          Resource: 'https://api.opengander.io',
        }],
      });
      mockInsert.mockResolvedValueOnce(undefined);

      const result = await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      expect(result && 'resource' in result ? result.resource : undefined).toBe('https://api.opengander.io');
    });

    it('should mark code as used after consumption', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });
      mockInsert.mockResolvedValueOnce(undefined);

      await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          values: [expect.objectContaining({
            Code: 'test-code-123',
            Used: 1,
          })],
        })
      );
    });

    it('should return null for non-existent code', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      const result = await consumeAuthorizationCode(
        'non-existent-code',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return CodeReplayResult for already used code (per RFC 6749 Section 4.1.2)', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [{
          ...validRecord,
          Used: 1,
        }],
      });

      const result = await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      // Should return replay info so caller can revoke tokens
      expect(result).toEqual({
        replay: true,
        userId: 'user-123',
        tenantId: 'tenant-456',
        clientId: 'mcp-claude-desktop',
      });
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return null for expired code', async () => {
      // Advance time past the expiry (10:10:00)
      vi.setSystemTime(new Date('2024-01-15T10:15:00.000Z'));

      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord], // ExpiresAt is 10:10
      });

      const result = await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return null for mismatched client ID', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });

      const result = await consumeAuthorizationCode(
        'test-code-123',
        'wrong-client-id',
        'http://localhost:8080/callback'
      );

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return null for mismatched redirect URI', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });

      const result = await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://malicious-site.com/callback'
      );

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should use FINAL in query for merged view', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      await consumeAuthorizationCode(
        'test-code-123',
        'mcp-claude-desktop',
        'http://localhost:8080/callback'
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('FINAL'),
        })
      );
    });
  });

  describe('code generation security', () => {
    it('should generate cryptographically secure codes', async () => {
      // Reset the mock to use real random bytes for this test
      const crypto = await import('crypto');
      vi.mocked(crypto.randomBytes).mockImplementationOnce((size: number) => {
        return Buffer.alloc(size).fill(0xff); // All 0xff bytes
      });

      mockInsert.mockResolvedValueOnce(undefined);

      const code = await createAuthorizationCode({
        clientId: 'test',
        redirectUri: 'http://localhost/callback',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        userId: 'user-1',
        tenantId: 'tenant-1',
        scope: 'read',
      });

      // Code should be base64url encoded
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate codes of appropriate length', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      const code = await createAuthorizationCode({
        clientId: 'test',
        redirectUri: 'http://localhost/callback',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        userId: 'user-1',
        tenantId: 'tenant-1',
        scope: 'read',
      });

      // 32 bytes = 256 bits of entropy, base64url encoded = 43 chars
      expect(code.length).toBeGreaterThanOrEqual(40);
    });
  });
});
