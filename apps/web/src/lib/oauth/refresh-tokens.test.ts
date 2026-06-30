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
    randomBytes: vi.fn((size: number) => Buffer.from('a'.repeat(size))),
  };
});

// Import the module after mocks are set up
import {
  createRefreshToken,
  consumeRefreshToken,
  revokeFamilyTokens,
  revokeRefreshToken,
  revokeTokensByUserAndClient,
  hashRefreshToken,
  generateRefreshToken,
  REFRESH_TOKEN_EXPIRY_MS,
  ROTATION_GRACE_PERIOD_MS,
} from './refresh-tokens';

describe('OAuth Refresh Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateRefreshToken', () => {
    it('should generate a base64url-encoded token', () => {
      const token = generateRefreshToken();

      // Verify token is base64url encoded (no +, /, or =)
      expect(token).not.toMatch(/[+/=]/);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate tokens of appropriate length', () => {
      const token = generateRefreshToken();

      // 32 bytes = 43 base64url chars
      expect(token.length).toBe(43);
    });
  });

  describe('hashRefreshToken', () => {
    it('should produce consistent SHA256 hashes', () => {
      const token = 'test-token-123';
      const hash1 = hashRefreshToken(token);
      const hash2 = hashRefreshToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = hashRefreshToken('token-1');
      const hash2 = hashRefreshToken('token-2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createRefreshToken', () => {
    it('should create a token with all required parameters', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      const params = {
        userId: 'user-123',
        tenantId: 'tenant-456',
        clientId: 'claude-desktop',
        scope: 'analytics:read',
      };

      const token = await createRefreshToken(params);

      // Verify token is returned
      expect(token).toBeDefined();
      expect(token.length).toBe(43);

      // Verify ClickHouse insert was called
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith({
        table: 'opengander.oauth_refresh_tokens',
        values: [
          expect.objectContaining({
            UserId: 'user-123',
            TenantId: 'tenant-456',
            ClientId: 'claude-desktop',
            Scope: 'analytics:read',
            Resource: '',
            Rotated: 0,
            Revoked: 0,
          }),
        ],
        format: 'JSONEachRow',
      });
    });

    it('should include optional resource parameter', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      await createRefreshToken({
        userId: 'user-123',
        tenantId: 'tenant-456',
        clientId: 'claude-desktop',
        scope: 'analytics:read',
        resource: 'https://mcp.opengander.io',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          values: [
            expect.objectContaining({
              Resource: 'https://mcp.opengander.io',
            }),
          ],
        })
      );
    });

    it('should use provided familyId for rotation', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      await createRefreshToken({
        userId: 'user-123',
        tenantId: 'tenant-456',
        clientId: 'claude-desktop',
        scope: 'analytics:read',
        familyId: 'existing-family-id',
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          values: [
            expect.objectContaining({
              FamilyId: 'existing-family-id',
            }),
          ],
        })
      );
    });

    it('should set expiry to 30 days in the future', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      await createRefreshToken({
        userId: 'user-123',
        tenantId: 'tenant-456',
        clientId: 'claude-desktop',
        scope: 'analytics:read',
      });

      const insertedValues = mockInsert.mock.calls[0][0].values[0];

      // ExpiresAt should be 30 days after CreatedAt
      const createdAt = new Date(
        insertedValues.CreatedAt.replace(' ', 'T') + 'Z'
      );
      const expiresAt = new Date(
        insertedValues.ExpiresAt.replace(' ', 'T') + 'Z'
      );
      const diffMs = expiresAt.getTime() - createdAt.getTime();

      expect(diffMs).toBe(REFRESH_TOKEN_EXPIRY_MS); // 30 days
    });
  });

  describe('consumeRefreshToken', () => {
    const validRecord = {
      TokenHash: hashRefreshToken(generateRefreshToken()),
      FamilyId: 'family-123',
      UserId: 'user-123',
      TenantId: 'tenant-456',
      ClientId: 'claude-desktop',
      Scope: 'analytics:read',
      Resource: '',
      CreatedAt: '2024-01-15 10:00:00.000',
      ExpiresAt: '2024-02-14 10:00:00.000', // 30 days expiry
      Rotated: 0,
      RotatedAt: '1970-01-01 00:00:00.000',
      Revoked: 0,
      RevokedAt: '1970-01-01 00:00:00.000',
      UpdatedAt: '2024-01-15 10:00:00.000',
    };

    it('should return token data for valid unused token', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });
      mockInsert.mockResolvedValueOnce(undefined);

      const result = await consumeRefreshToken('test-token', 'claude-desktop');

      expect(result).toEqual({
        userId: 'user-123',
        tenantId: 'tenant-456',
        clientId: 'claude-desktop',
        scope: 'analytics:read',
        resource: undefined,
        familyId: 'family-123',
      });
    });

    it('should include resource when present', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [
          {
            ...validRecord,
            Resource: 'https://mcp.opengander.io',
          },
        ],
      });
      mockInsert.mockResolvedValueOnce(undefined);

      const result = await consumeRefreshToken('test-token', 'claude-desktop');

      expect(result?.resource).toBe('https://mcp.opengander.io');
    });

    it('should mark token as rotated after consumption', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });
      mockInsert.mockResolvedValueOnce(undefined);

      await consumeRefreshToken('test-token', 'claude-desktop');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          values: [
            expect.objectContaining({
              Rotated: 1,
            }),
          ],
        })
      );
    });

    it('should return null for non-existent token', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      const result = await consumeRefreshToken(
        'non-existent-token',
        'claude-desktop'
      );

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return null for revoked token', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [
          {
            ...validRecord,
            Revoked: 1,
          },
        ],
      });

      const result = await consumeRefreshToken('test-token', 'claude-desktop');

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return null for expired token', async () => {
      // Advance time past the expiry (30 days)
      vi.setSystemTime(new Date('2024-03-01T10:00:00.000Z'));

      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });

      const result = await consumeRefreshToken('test-token', 'claude-desktop');

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should return null for mismatched client ID', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [validRecord],
      });

      const result = await consumeRefreshToken('test-token', 'wrong-client');

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    describe('theft detection', () => {
      it('should revoke family when rotated token is reused beyond grace period', async () => {
        // Token was rotated 1 hour ago (well beyond grace period)
        mockQuery
          .mockResolvedValueOnce({
            json: async () => [
              {
                ...validRecord,
                Rotated: 1,
                RotatedAt: '2024-01-15 09:00:00.000', // 1 hour before current time
              },
            ],
          })
          // Query for family tokens during revocation
          .mockResolvedValueOnce({
            json: async () => [
              {
                ...validRecord,
                Rotated: 1,
              },
            ],
          });
        mockInsert.mockResolvedValue(undefined);

        const result = await consumeRefreshToken('reused-token', 'claude-desktop');

        // Should return null (token rejected)
        expect(result).toBeNull();

        // Should have queried for family tokens to revoke
        expect(mockQuery).toHaveBeenCalledTimes(2);
      });
    });

    describe('grace period for concurrent refresh', () => {
      it('should return token data with grace period flag when reused within grace period', async () => {
        // Token was rotated 2 seconds ago (within 5-second grace period)
        const twoSecondsAgo = new Date(Date.now() - 2000);
        const rotatedAtStr = twoSecondsAgo
          .toISOString()
          .replace('T', ' ')
          .replace('Z', '');

        mockQuery.mockResolvedValueOnce({
          json: async () => [
            {
              ...validRecord,
              Rotated: 1,
              RotatedAt: rotatedAtStr,
            },
          ],
        });

        const result = await consumeRefreshToken('race-condition-token', 'claude-desktop');

        // Should return token data (not rejected)
        expect(result).not.toBeNull();
        expect(result?.userId).toBe('user-123');
        expect(result?.isGracePeriodReuse).toBe(true);

        // Should NOT have inserted anything (no rotation needed)
        expect(mockInsert).not.toHaveBeenCalled();

        // Should NOT have queried for family tokens (no revocation)
        expect(mockQuery).toHaveBeenCalledTimes(1);
      });

      it('should revoke family when reused just beyond grace period', async () => {
        // Token was rotated 6 seconds ago (just beyond 5-second grace period)
        const sixSecondsAgo = new Date(Date.now() - 6000);
        const rotatedAtStr = sixSecondsAgo
          .toISOString()
          .replace('T', ' ')
          .replace('Z', '');

        mockQuery
          .mockResolvedValueOnce({
            json: async () => [
              {
                ...validRecord,
                Rotated: 1,
                RotatedAt: rotatedAtStr,
              },
            ],
          })
          .mockResolvedValueOnce({
            json: async () => [{ ...validRecord, Rotated: 1 }],
          });
        mockInsert.mockResolvedValue(undefined);

        const result = await consumeRefreshToken('theft-token', 'claude-desktop');

        // Should return null (theft detected)
        expect(result).toBeNull();

        // Should have queried for family tokens to revoke
        expect(mockQuery).toHaveBeenCalledTimes(2);
      });

      it('should use correct grace period constant', () => {
        // Verify the constant is 5 seconds
        expect(ROTATION_GRACE_PERIOD_MS).toBe(5000);
      });
    });

    it('should use FINAL in query for merged view', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      await consumeRefreshToken('test-token', 'claude-desktop');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('FINAL'),
        })
      );
    });
  });

  describe('revokeFamilyTokens', () => {
    it('should mark all family tokens as revoked', async () => {
      const familyTokens = [
        {
          TokenHash: 'hash-1',
          FamilyId: 'family-123',
          UserId: 'user-123',
          TenantId: 'tenant-456',
          ClientId: 'claude-desktop',
          Scope: 'analytics:read',
          Resource: '',
          CreatedAt: '2024-01-15 10:00:00.000',
          ExpiresAt: '2024-02-14 10:00:00.000',
          Rotated: 1,
          RotatedAt: '2024-01-15 09:00:00.000',
          Revoked: 0,
          RevokedAt: '1970-01-01 00:00:00.000',
          UpdatedAt: '2024-01-15 09:00:00.000',
        },
        {
          TokenHash: 'hash-2',
          FamilyId: 'family-123',
          UserId: 'user-123',
          TenantId: 'tenant-456',
          ClientId: 'claude-desktop',
          Scope: 'analytics:read',
          Resource: '',
          CreatedAt: '2024-01-15 09:00:00.000',
          ExpiresAt: '2024-02-14 09:00:00.000',
          Rotated: 0,
          RotatedAt: '1970-01-01 00:00:00.000',
          Revoked: 0,
          RevokedAt: '1970-01-01 00:00:00.000',
          UpdatedAt: '2024-01-15 09:00:00.000',
        },
      ];

      mockQuery.mockResolvedValueOnce({
        json: async () => familyTokens,
      });
      mockInsert.mockResolvedValueOnce(undefined);

      await revokeFamilyTokens('family-123', 'theft_detection');

      // Should insert revoked versions of all tokens
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertedValues = mockInsert.mock.calls[0][0].values;
      expect(insertedValues).toHaveLength(2);
      expect(insertedValues[0].Revoked).toBe(1);
      expect(insertedValues[1].Revoked).toBe(1);
    });

    it('should not insert anything if family has no tokens', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      await revokeFamilyTokens('empty-family', 'user_initiated');

      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe('revokeRefreshToken', () => {
    it('should revoke token family and return family ID', async () => {
      const tokenRecord = {
        TokenHash: 'hash-123',
        FamilyId: 'family-456',
        UserId: 'user-123',
        TenantId: 'tenant-456',
        ClientId: 'claude-desktop',
        Scope: 'analytics:read',
        Resource: '',
        CreatedAt: '2024-01-15 10:00:00.000',
        ExpiresAt: '2024-02-14 10:00:00.000',
        Rotated: 0,
        RotatedAt: '1970-01-01 00:00:00.000',
        Revoked: 0,
        RevokedAt: '1970-01-01 00:00:00.000',
        UpdatedAt: '2024-01-15 10:00:00.000',
      };

      mockQuery
        .mockResolvedValueOnce({
          json: async () => [tokenRecord],
        })
        .mockResolvedValueOnce({
          json: async () => [tokenRecord],
        });
      mockInsert.mockResolvedValue(undefined);

      const familyId = await revokeRefreshToken('test-token', 'user_initiated');

      expect(familyId).toBe('family-456');
    });

    it('should return null if token not found', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      const familyId = await revokeRefreshToken(
        'non-existent-token',
        'user_initiated'
      );

      expect(familyId).toBeNull();
    });
  });

  describe('revokeTokensByUserAndClient', () => {
    it('should revoke all tokens for user/client (RFC 6749 Section 4.1.2)', async () => {
      const tokensToRevoke = [
        {
          TokenHash: 'hash-1',
          FamilyId: 'family-1',
          UserId: 'user-123',
          TenantId: 'tenant-456',
          ClientId: 'claude-desktop',
          Scope: 'analytics:read',
          Resource: '',
          CreatedAt: '2024-01-14 10:00:00.000',
          ExpiresAt: '2024-02-13 10:00:00.000',
          Rotated: 0,
          RotatedAt: '1970-01-01 00:00:00.000',
          Revoked: 0,
          RevokedAt: '1970-01-01 00:00:00.000',
          UpdatedAt: '2024-01-14 10:00:00.000',
        },
        {
          TokenHash: 'hash-2',
          FamilyId: 'family-2',
          UserId: 'user-123',
          TenantId: 'tenant-456',
          ClientId: 'claude-desktop',
          Scope: 'analytics:read',
          Resource: '',
          CreatedAt: '2024-01-15 08:00:00.000',
          ExpiresAt: '2024-02-14 08:00:00.000',
          Rotated: 0,
          RotatedAt: '1970-01-01 00:00:00.000',
          Revoked: 0,
          RevokedAt: '1970-01-01 00:00:00.000',
          UpdatedAt: '2024-01-15 08:00:00.000',
        },
      ];

      mockQuery.mockResolvedValueOnce({
        json: async () => tokensToRevoke,
      });
      mockInsert.mockResolvedValue(undefined);

      const count = await revokeTokensByUserAndClient(
        'user-123',
        'claude-desktop',
        'authorization_code_replay'
      );

      expect(count).toBe(2);

      // Verify insert was called with revoked tokens
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'opengander.oauth_refresh_tokens',
          values: expect.arrayContaining([
            expect.objectContaining({
              TokenHash: 'hash-1',
              Revoked: 1,
            }),
            expect.objectContaining({
              TokenHash: 'hash-2',
              Revoked: 1,
            }),
          ]),
        })
      );
    });

    it('should return 0 when no tokens found', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      const count = await revokeTokensByUserAndClient(
        'non-existent-user',
        'claude-desktop',
        'authorization_code_replay'
      );

      expect(count).toBe(0);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should only revoke tokens for matching user AND client', async () => {
      mockQuery.mockResolvedValueOnce({
        json: async () => [],
      });

      await revokeTokensByUserAndClient(
        'user-123',
        'different-client',
        'authorization_code_replay'
      );

      // Query should filter by both userId AND clientId
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('UserId ='),
          query_params: expect.objectContaining({
            userId: 'user-123',
            clientId: 'different-client',
          }),
        })
      );
    });
  });
});
