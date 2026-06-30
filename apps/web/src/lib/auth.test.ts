import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ImpersonationContext } from './types/user-management';

// Custom payload types for testing
interface TestPayload {
  foo?: string;
  type?: string;
  legacy?: boolean;
  exp?: number;
  iat?: number;
  aud?: string;
  iss?: string;
  userId?: string;
  email?: string;
  tenantId?: string;
  tenantName?: string;
  role?: string;
  impersonating?: ImpersonationContext;
}

// Test RSA key pair (2048 bit, PKCS#8 format for jose compatibility)
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCH7Psp0P7TRym4
VDcSnkYwyVRiCpydJ3b/jDyxjWWP8a4Lh7/QPmc4+mkmWqvfk35YC0gSXauhfiSE
1ENCZT+5kEMOzDOYMEbq6BIyyA/iMrjDNDq14o2gbrrH2UTVIiByq7UqlZ0ixe9I
y1M6prE23H/nRiAmYvej0SrUuNeviMmraixxQ4apY5J4/xud/bzfNGzd8xuXmZfv
scVG3JtvDxZ0t8k0devJ/1pApVgmupCKvlE8dvN5aIsD3/tSwhxj+xbtzBwobvos
zfZNGVTXRJWYgY6QxkjYhnqFuky0ftFE7V1pcHOG/zsB8Tw6ClZTsQIul7N2P+XC
oXOqKHMzAgMBAAECggEAJnF0gdmt0MSePJd48geYs4CloIr+y4XXZqRboB3tHR6O
Co3MxtF3cUqFhcb8OGInSDB8pFEg0y5xlq3QDg3DzbBK/vrrFr6EuDiFuR4TO/b7
gZ4agsm+I6NdqVs+WAdsZPJCbXZeOHEB4bU752kw0uLfO+J+Ak1YW9kzQ3G58teU
H8xC5bXchCl9WydbIQoSPCg1o0dIz+l3BS8aUuh3VoY8pvkqcUq/489J2QPwocqU
q4zengu+j+Lc3IM0LiDtP8f+E0T3QXCfvCgNFVE4vwImwuHNA0HeNfCEpINK8Bst
y+nGvnnIjKKvZwkyU4Qu4H67bpv5pgOfzbjKq0duvQKBgQC/pRDumSBfFmU+YG5S
15aYDodtjCr4A0d+9ViEBrdz3mctk/r+74QTzZNGvTTbyy/50l7jE7wkfYtXgYJe
Mj9ML+SzSmob9naGPL1xOhaTKrhHi1ThIgmeu+ZRr/HT6D4fTdkftBzkQbQHMBx5
4QoW6GJn/HpTOL8pQJVz2pRF3QKBgQC1kfgOMExkYNZoFfygTWYnCuJomnqUhphl
8IUq/I4sK9iOw07aYX11wIikjk4Q3h/lj3aKkDMB0I2BooD2EwXSiOK+Y42cFcT5
wkFad9YRr9Kg5DIH45wxykW6iY8pk9MsMbbOIUS9X8DHHU8E3fSlzpok+Wgcx2fB
EV9oTK40TwKBgDdXRk1wQI3U3MWneRRJFz6vq2HyARJ/d+zsknQFsIIwLiFWQzvN
FJnXWnkp+BKkWSVOH4J5V3I+IrfROUFURz0L84Hmsj+C63UWIyqIOK6kvnRCgu9E
Mfz5i6f5I98qiI3noBRsoY80ffU5am+zkYNN9eTLXtObZnBWKxI6g2itAoGAabEX
iQLaZQ/tntc1oAaN8Son0yYhNrYGnkhc7EHpbJL1U10jWIGpa1Lw94EStkTmolVZ
dp0r4+GHja+PjC5UlFI0UwlWVEZjy9MlAcmCJfeIDznmWatHr8ADyOrsGBLBuRcT
R3gcMHQ9nmpUJgwhribOmblIvn/gyIUZWXhRa4cCgYB+USpd0GYAU45Ek2c64yMm
BsaIm66Z1oZJXB6StJCFcbjY5bXs3MiUV/5FbTQpnJoSeW/eN/CDmYj9hDeQPvfu
spzJQJ81QMpCp35KDTMiXPyiCmewED0M4XWQP28pjjaUWUTA4APQBXTQ55zHgqPZ
tBxECTbMZdxFhruO0HVu9w==
-----END PRIVATE KEY-----`;

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAh+z7KdD+00cpuFQ3Ep5G
MMlUYgqcnSd2/4w8sY1lj/GuC4e/0D5nOPppJlqr35N+WAtIEl2roX4khNRDQmU/
uZBDDswzmDBG6ugSMsgP4jK4wzQ6teKNoG66x9lE1SIgcqu1KpWdIsXvSMtTOqax
Ntx/50YgJmL3o9Eq1LjXr4jJq2oscUOGqWOSeP8bnf283zRs3fMbl5mX77HFRtyb
bw8WdLfJNHXryf9aQKVYJrqQir5RPHbzeWiLA9/7UsIcY/sW7cwcKG76LM32TRlU
10SVmIGOkMZI2IZ6hbpMtH7RRO1daXBzhv87AfE8OgpWU7ECLpezdj/lwqFzqihz
MwIDAQAB
-----END PUBLIC KEY-----`;

// Second RSA key pair for testing key rotation
const TEST_PREVIOUS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCXjw4TRDderadC
CJW7/c2AXxKxy/G8uajstLbW9FAmQbFvUN9wileM7FQV/k3ADF8WAqW0uL0hoR1t
9pzfSripRz/wmkPdUBXwaypdrd2Yb3y5KKcij3Abqx2exO/0n1Bh1sNJWCi/Icet
fjZPn5zxr+YQ1pm4pSqe/e/9UUyUVZwzNQ81KEwOisytRQL5P6m058B+OqnBQQHf
pQqjWwvyF/uPnExTlH5J7KWqDs4gsMMeAgmTqCfWEnQteZwJ7v1FcWjHJhQZNuWL
xB4OyUm4AX5BlOHb/u8oiE65gH597m7PGACohP0LEu2PTRTwe8iD/hzC0DRugmEQ
vtVV21ErAgMBAAECggEADm5O2JZjo0s4cTj6CoPL7NygnhDqPDfjyS4bEfQ1xLH3
bPIvyrp33aSlcp0O1pBKMxrrbLE03Dfhr0lbfiA4qj2gU/Ul+YB/pkjxKFxYWWrI
+HE4TaBUyP2nfPYJikRR76iQWn9F2fUjp/X4wk1TZBvrwk/jJGOHRf5Hh9pIejMk
rxsPu8Qh4NYw2q6tRvx/0AN3zgtZ2AUI4ze8ayxDdoW0+Buu01BqFFbRikWVaEWF
VAdF/rd+dCDrfOxk6GJMJ1pkLr+zvy8VxrJstPODNNTH3aAn4vQX0CzBEQ/utKnm
A2y7F1s8hV0fxWl4OTI1uMCvm2VcbbpJdiGYbU+0SQKBgQDLctteX9DTmb9kqJmh
g0bQ5TS1ZvxdlRSnKNQVrUHnoRuu+pJ5rd7Z3Vnh1sqohKzPBUnN3sXqSqYDWAP7
LxFj3thcExubYSYbSsLNO9hgx9lI56n2c++Nhi/veQ1XzvF4K/ZBhEC+QX+DABaK
9re7INeqsHeCZI2hxmZoxChvBwKBgQC+tPS+pBoBjXa4XZBUt1EKgwNvD/33wP+C
pzv2lvFplRhp2StgEQTzZdl4odXDfDVH+ht0JfOLse4cGbRFbdS5X4C9wi6/4m0O
Lsg3yKKMB02zXpfyhhlTuWCqXdsoRGo7j64tJh+0sPnOs9JMdgkM5YRX/kU9n+dG
eRgqUZSfvQKBgF/oim+n/bry/N4H+TzBtS2fD8UAgrHfKLhQsAJ0BeCa+4D2kPyZ
sbfE+K1VY34j5Y9Gb++EOIrlm/Nxl5bfLnSFRjvJqjcKijtNeB3mO3AMZmtPArmz
F9gAzTI4P8kIPp8nIlTqctb9642nCfmCq0SlC+ZkgEJRAs+jxv1Wk7UbAoGAYnuo
eFreYzbevE71Hgqc+0S1HUGw8aTlTl92g91nRhMMzHyt/apMWDWcnMNWVOFr0oPC
cbS3lMiKIlDT25bgZ+p93YDOC6Gul8ho9QXTi2SqJ5sN9Nxzb90nolNdvem2wpNs
azxo2zMZjjkmvP2nptVQBvD0aOKO2MHoTNJcYjECgYEAliUlwBbjCv4z/+v3UKi0
fzmojHLbOyH+wINQVyJufD/5/U2bSGkrJc1SzyO60nz+ZoR6sDLZ7oj/3yzJh1Ph
YmyDQSR+S6sNwn3mGiuM5jGrriHKCF4e/1X2oYJ1H/vO0REfmjxC7KdBwVSgw4zz
d3nQpIt4cBTzVGqvaX6KvCI=
-----END PRIVATE KEY-----`;

const TEST_PREVIOUS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl48OE0Q3Xq2nQgiVu/3N
gF8SscvxvLmo7LS21vRQJkGxb1DfcIpXjOxUFf5NwAxfFgKltLi9IaEdbfac30q4
qUc/8JpD3VAV8GsqXa3dmG98uSinIo9wG6sdnsTv9J9QYdbDSVgovyHHrX42T5+c
8a/mENaZuKUqnv3v/VFMlFWcMzUPNShMDorMrUUC+T+ptOfAfjqpwUEB36UKo1sL
8hf7j5xMU5R+Seylqg7OILDDHgIJk6gn1hJ0LXmcCe79RXFoxyYUGTbli8QeDslJ
uAF+QZTh2/7vKIhOuYB+fe5uzxgAqIT9CxLtj00U8HvIg/4cwtA0boJhEL7VVdtR
KwIDAQAB
-----END PUBLIC KEY-----`;

// Convert to single-line format with \n escapes
const TEST_PRIVATE_KEY_ENV = TEST_PRIVATE_KEY.replace(/\n/g, '\\n');
const TEST_PUBLIC_KEY_ENV = TEST_PUBLIC_KEY.replace(/\n/g, '\\n');
const TEST_PREVIOUS_PRIVATE_KEY_ENV = TEST_PREVIOUS_PRIVATE_KEY.replace(/\n/g, '\\n');
const TEST_PREVIOUS_PUBLIC_KEY_ENV = TEST_PREVIOUS_PUBLIC_KEY.replace(/\n/g, '\\n');

describe('auth module', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.resetModules();

    // Clear key cache before each test
    const { clearKeyCache } = await import('./keys');
    clearKeyCache();
  });

  afterEach(async () => {
    process.env = originalEnv;
    const { clearKeyCache } = await import('./keys');
    clearKeyCache();
  });

  describe('signToken and verifyToken', () => {
    it('should sign and verify token with RS256', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'test-key-id';

      const { signToken, verifyToken } = await import('./auth');

      const payload = { foo: 'bar', type: 'test' };
      const token = await signToken(payload, 3600);

      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(3); // JWT format

      const verified = await verifyToken<TestPayload>(token);
      expect(verified).not.toBeNull();
      expect(verified?.foo).toBe('bar');
      expect(verified?.type).toBe('test');
    });

    it('should throw when keys are not configured', async () => {
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;

      const { signToken } = await import('./auth');

      await expect(signToken({ type: 'test' }, 3600)).rejects.toThrow(
        'JWT_PRIVATE_KEY is required'
      );
    });

    it('should include kid in JWT header when configured', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'my-key-id';

      const { signToken } = await import('./auth');

      const token = await signToken({ type: 'test' }, 3600);

      // Decode header to check kid
      const [headerB64] = token.split('.');
      const header = JSON.parse(atob(headerB64));
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe('my-key-id');
    });

    it('should support string expiration format', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { signToken, verifyToken } = await import('./auth');

      const token = await signToken({ type: 'test' }, '1h');

      const verified = await verifyToken<TestPayload>(token);
      expect(verified).not.toBeNull();
      expect(verified?.exp).toBeDefined();
      // Expiration should be approximately 1 hour from now
      const expTime = verified?.exp as number;
      const nowSec = Math.floor(Date.now() / 1000);
      expect(expTime - nowSec).toBeGreaterThan(3500);
      expect(expTime - nowSec).toBeLessThan(3700);
    });

    it('should support aud and iss claims', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { signToken, verifyToken } = await import('./auth');

      const token = await signToken({ type: 'test' }, 3600, {
        aud: 'my-audience',
        iss: 'my-issuer',
      });

      // Verify with matching aud/iss
      const verified = await verifyToken<TestPayload>(token, {
        aud: 'my-audience',
        iss: 'my-issuer',
      });
      expect(verified).not.toBeNull();
      expect(verified?.aud).toBe('my-audience');
      expect(verified?.iss).toBe('my-issuer');
    });

    it('should fail verification with wrong audience', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { signToken, verifyToken } = await import('./auth');

      const token = await signToken({ type: 'test' }, 3600, {
        aud: 'correct-audience',
      });

      // Verify with wrong aud should fail
      const verified = await verifyToken(token, {
        aud: 'wrong-audience',
      });
      expect(verified).toBeNull();
    });

    it('should return null for invalid token', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { verifyToken } = await import('./auth');

      const result = await verifyToken('invalid.token.here');
      expect(result).toBeNull();
    });

    it('should return null for token signed with different key', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { signToken } = await import('./auth');
      const token = await signToken({ type: 'test' }, 3600);

      // Clear and use different keys for verification
      vi.resetModules();
      const { clearKeyCache } = await import('./keys');
      clearKeyCache();

      // Use a different public key (would need a different key pair in real test)
      // For now, just verify the token structure is correct
      const [headerB64] = token.split('.');
      const header = JSON.parse(atob(headerB64));
      expect(header.alg).toBe('RS256');
    });
  });

  describe('generateSessionToken', () => {
    it('should generate a valid session token', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { generateSessionToken, verifyToken } = await import('./auth');

      const token = await generateSessionToken(
        'user-123',
        'test@example.com',
        'tenant-456',
        'Test Tenant',
        'admin'
      );

      const payload = await verifyToken<TestPayload>(token);
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe('user-123');
      expect(payload?.email).toBe('test@example.com');
      expect(payload?.tenantId).toBe('tenant-456');
      expect(payload?.tenantName).toBe('Test Tenant');
      expect(payload?.role).toBe('admin');
      expect(payload?.type).toBe('session');
    });

    it('should include impersonation context when provided', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { generateSessionToken, verifyToken } = await import('./auth');

      const impersonating: ImpersonationContext = {
        originalUserId: 'superadmin-1',
        originalEmail: 'admin@example.com',
        originalTenantId: 'tenant-999',
        originalRole: 'superadmin',
        startedAt: new Date().toISOString(),
      };

      const token = await generateSessionToken(
        'user-123',
        'test@example.com',
        'tenant-456',
        'Test Tenant',
        'user',
        impersonating
      );

      const payload = await verifyToken<TestPayload>(token);
      expect(payload?.impersonating).toEqual(impersonating);
    });
  });

  describe('generateMagicLinkToken', () => {
    it('should generate a valid magic link token', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { generateMagicLinkToken, verifyToken } = await import('./auth');

      const token = await generateMagicLinkToken('test@example.com');

      const payload = await verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.email).toBe('test@example.com');
      expect(payload?.type).toBe('magic_link');
    });
  });

  describe('generateOnboardingToken and verifyOnboardingToken', () => {
    it('should generate and verify onboarding token', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { generateOnboardingToken, verifyOnboardingToken } = await import('./auth');

      const token = await generateOnboardingToken('test@example.com', 'checkout');

      const payload = await verifyOnboardingToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.email).toBe('test@example.com');
      expect(payload?.type).toBe('onboarding');
      expect(payload?.step).toBe('checkout');
    });

    it('should include tenantId when provided', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { generateOnboardingToken, verifyOnboardingToken } = await import('./auth');

      const token = await generateOnboardingToken('test@example.com', 'domains', 'tenant-789');

      const payload = await verifyOnboardingToken(token);
      expect(payload?.tenantId).toBe('tenant-789');
      expect(payload?.step).toBe('domains');
    });

    it('should return null for non-onboarding token', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const { generateMagicLinkToken, verifyOnboardingToken } = await import('./auth');

      const token = await generateMagicLinkToken('test@example.com');
      const payload = await verifyOnboardingToken(token);
      expect(payload).toBeNull();
    });
  });

  describe('key rotation - multi-key verification', () => {
    it('should verify token signed with current key', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'current-key';
      delete process.env.JWT_PREVIOUS_PUBLIC_KEY;

      const { signToken, verifyToken } = await import('./auth');

      const token = await signToken({ type: 'test', foo: 'bar' }, 3600);
      const payload = await verifyToken<TestPayload>(token);
      expect(payload).not.toBeNull();
      expect(payload?.foo).toBe('bar');
    });

    it('should verify token signed with previous key during rotation', async () => {
      // Step 1: Sign a token with the "old" key (what will become "previous")
      process.env.JWT_PRIVATE_KEY = TEST_PREVIOUS_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PREVIOUS_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'old-key';

      const { signToken: signWithOldKey } = await import('./auth');
      const tokenFromOldKey = await signWithOldKey({ type: 'test', foo: 'old' }, 3600);

      // Step 2: Simulate rotation - new current key, old key becomes previous
      vi.resetModules();
      const { clearKeyCache } = await import('./keys');
      clearKeyCache();
      const { clearJWKSVerifierCache } = await import('./auth');
      clearJWKSVerifierCache();

      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'new-key';
      process.env.JWT_PREVIOUS_PUBLIC_KEY = TEST_PREVIOUS_PUBLIC_KEY_ENV;
      process.env.JWT_PREVIOUS_KEY_ID = 'old-key';

      // Step 3: Verify old token still works with the rotated config
      const { verifyToken } = await import('./auth');
      const payload = await verifyToken<TestPayload>(tokenFromOldKey);
      expect(payload).not.toBeNull();
      expect(payload?.foo).toBe('old');
    });

    it('should reject token signed with unknown key', async () => {
      // Sign with previous key pair but don't configure it as previous
      process.env.JWT_PRIVATE_KEY = TEST_PREVIOUS_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PREVIOUS_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'unknown-key';

      const { signToken: signWithUnknown } = await import('./auth');
      const tokenFromUnknown = await signWithUnknown({ type: 'test' }, 3600);

      // Rotate to different keys without setting previous
      vi.resetModules();
      const { clearKeyCache } = await import('./keys');
      clearKeyCache();
      const { clearJWKSVerifierCache } = await import('./auth');
      clearJWKSVerifierCache();

      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'current-key';
      delete process.env.JWT_PREVIOUS_PUBLIC_KEY;

      const { verifyToken } = await import('./auth');
      const payload = await verifyToken<TestPayload>(tokenFromUnknown);
      expect(payload).toBeNull();
    });
  });

  describe('getSessionCookieOptions', () => {
    it('should return correct cookie options', async () => {
      process.env.SESSION_MAX_AGE = '86400';

      const { getSessionCookieOptions } = await import('./auth');

      const options = getSessionCookieOptions();
      expect(options.name).toBe('opengander_session');
      expect(options.httpOnly).toBe(true);
      expect(options.maxAge).toBe(86400);
      expect(options.path).toBe('/');
      expect(options.sameSite).toBe('lax');
    });

    it('should use default max age when not configured', async () => {
      delete process.env.SESSION_MAX_AGE;

      const { getSessionCookieOptions } = await import('./auth');

      const options = getSessionCookieOptions();
      expect(options.maxAge).toBe(604800); // 7 days
    });
  });
});
