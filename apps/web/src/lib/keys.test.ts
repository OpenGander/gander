import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPrivateKey,
  getPublicKey,
  getPublicKeyJWK,
  getKeyId,
  getPreviousKeyId,
  getPreviousPublicKey,
  getAllPublicKeysJWK,
  initializeKeys,
  clearKeyCache,
} from './keys';

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
const TEST_PREVIOUS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl48OE0Q3Xq2nQgiVu/3N
gF8SscvxvLmo7LS21vRQJkGxb1DfcIpXjOxUFf5NwAxfFgKltLi9IaEdbfac30q4
qUc/8JpD3VAV8GsqXa3dmG98uSinIo9wG6sdnsTv9J9QYdbDSVgovyHHrX42T5+c
8a/mENaZuKUqnv3v/VFMlFWcMzUPNShMDorMrUUC+T+ptOfAfjqpwUEB36UKo1sL
8hf7j5xMU5R+Seylqg7OILDDHgIJk6gn1hJ0LXmcCe79RXFoxyYUGTbli8QeDslJ
uAF+QZTh2/7vKIhOuYB+fe5uzxgAqIT9CxLtj00U8HvIg/4cwtA0boJhEL7VVdtR
KwIDAQAB
-----END PUBLIC KEY-----`;

// Convert to single-line format with \n escapes (as stored in env vars)
const TEST_PRIVATE_KEY_ENV = TEST_PRIVATE_KEY.replace(/\n/g, '\\n');
const TEST_PUBLIC_KEY_ENV = TEST_PUBLIC_KEY.replace(/\n/g, '\\n');
const TEST_PREVIOUS_PUBLIC_KEY_ENV = TEST_PREVIOUS_PUBLIC_KEY.replace(/\n/g, '\\n');

describe('keys module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearKeyCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearKeyCache();
  });

  describe('getKeyId', () => {
    it('should return the key ID from environment', () => {
      process.env.JWT_KEY_ID = 'test-key-2025';
      expect(getKeyId()).toBe('test-key-2025');
    });

    it('should return undefined when not configured', () => {
      delete process.env.JWT_KEY_ID;
      expect(getKeyId()).toBeUndefined();
    });
  });

  describe('getPrivateKey', () => {
    it('should load private key from environment', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      const key = await getPrivateKey();
      expect(key).toBeDefined();
    });

    it('should throw when not configured', async () => {
      delete process.env.JWT_PRIVATE_KEY;

      await expect(getPrivateKey()).rejects.toThrow(
        'JWT_PRIVATE_KEY is required but not configured'
      );
    });

    it('should cache the loaded key', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      const key1 = await getPrivateKey();
      const key2 = await getPrivateKey();
      expect(key1).toBe(key2); // Same instance
    });

    it('should throw on invalid key format', async () => {
      process.env.JWT_PRIVATE_KEY = 'not-a-valid-pem-key';

      await expect(getPrivateKey()).rejects.toThrow('Failed to load RSA private key');
    });
  });

  describe('getPublicKey', () => {
    it('should load public key from environment', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      const key = await getPublicKey();
      expect(key).toBeDefined();
    });

    it('should throw when not configured', async () => {
      delete process.env.JWT_PUBLIC_KEY;

      await expect(getPublicKey()).rejects.toThrow('JWT_PUBLIC_KEY is required but not configured');
    });

    it('should cache the loaded key', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      const key1 = await getPublicKey();
      const key2 = await getPublicKey();
      expect(key1).toBe(key2); // Same instance
    });

    it('should throw on invalid key format', async () => {
      process.env.JWT_PUBLIC_KEY = 'not-a-valid-pem-key';

      await expect(getPublicKey()).rejects.toThrow('Failed to load RSA public key');
    });
  });

  describe('initializeKeys', () => {
    it('should succeed when both keys are configured', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      await expect(initializeKeys()).resolves.not.toThrow();
    });

    it('should throw when only private key is configured', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      delete process.env.JWT_PUBLIC_KEY;

      await expect(initializeKeys()).rejects.toThrow('JWT_PUBLIC_KEY is required');
    });

    it('should throw when only public key is configured', async () => {
      delete process.env.JWT_PRIVATE_KEY;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      await expect(initializeKeys()).rejects.toThrow('JWT_PRIVATE_KEY is required');
    });

    it('should throw when no keys are configured', async () => {
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;

      await expect(initializeKeys()).rejects.toThrow();
    });
  });

  describe('getPublicKeyJWK', () => {
    it('should export public key as JWK', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'test-key-2025';

      const jwk = await getPublicKeyJWK();

      expect(jwk.kty).toBe('RSA');
      expect(jwk.use).toBe('sig');
      expect(jwk.alg).toBe('RS256');
      expect(jwk.kid).toBe('test-key-2025');
      expect(jwk.n).toBeDefined(); // RSA modulus
      expect(jwk.e).toBeDefined(); // RSA exponent
    });

    it('should return JWK without kid when not configured', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      delete process.env.JWT_KEY_ID;

      const jwk = await getPublicKeyJWK();

      expect(jwk.kid).toBeUndefined();
      expect(jwk.use).toBe('sig');
      expect(jwk.alg).toBe('RS256');
    });

    it('should throw when public key not configured', async () => {
      delete process.env.JWT_PUBLIC_KEY;

      await expect(getPublicKeyJWK()).rejects.toThrow('JWT_PUBLIC_KEY is required');
    });

    it('should cache the JWK', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;

      const jwk1 = await getPublicKeyJWK();
      const jwk2 = await getPublicKeyJWK();
      expect(jwk1).toBe(jwk2); // Same instance
    });
  });

  describe('getPreviousPublicKey', () => {
    it('should return null when not configured', async () => {
      delete process.env.JWT_PREVIOUS_PUBLIC_KEY;
      const key = await getPreviousPublicKey();
      expect(key).toBeNull();
    });

    it('should return null when set to NONE sentinel', async () => {
      process.env.JWT_PREVIOUS_PUBLIC_KEY = 'NONE';
      const key = await getPreviousPublicKey();
      expect(key).toBeNull();
    });

    it('should load previous public key when configured', async () => {
      process.env.JWT_PREVIOUS_PUBLIC_KEY = TEST_PREVIOUS_PUBLIC_KEY_ENV;
      const key = await getPreviousPublicKey();
      expect(key).toBeDefined();
      expect(key).not.toBeNull();
    });

    it('should throw on invalid key format', async () => {
      process.env.JWT_PREVIOUS_PUBLIC_KEY = 'not-a-valid-pem-key';
      await expect(getPreviousPublicKey()).rejects.toThrow(
        'Failed to load previous RSA public key'
      );
    });
  });

  describe('getPreviousKeyId', () => {
    it('should return the previous key ID from environment', () => {
      process.env.JWT_PREVIOUS_KEY_ID = 'old-key-2024';
      expect(getPreviousKeyId()).toBe('old-key-2024');
    });

    it('should return undefined when not configured', () => {
      delete process.env.JWT_PREVIOUS_KEY_ID;
      expect(getPreviousKeyId()).toBeUndefined();
    });
  });

  describe('getAllPublicKeysJWK', () => {
    it('should return only current key when no previous key', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'current-key';
      delete process.env.JWT_PREVIOUS_PUBLIC_KEY;

      const keys = await getAllPublicKeysJWK();
      expect(keys).toHaveLength(1);
      expect(keys[0].kid).toBe('current-key');
      expect(keys[0].alg).toBe('RS256');
    });

    it('should return both keys when previous is configured', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_KEY_ID = 'current-key';
      process.env.JWT_PREVIOUS_PUBLIC_KEY = TEST_PREVIOUS_PUBLIC_KEY_ENV;
      process.env.JWT_PREVIOUS_KEY_ID = 'previous-key';

      const keys = await getAllPublicKeysJWK();
      expect(keys).toHaveLength(2);
      expect(keys[0].kid).toBe('current-key');
      expect(keys[1].kid).toBe('previous-key');
      // Keys should have different modulus values
      expect(keys[0].n).not.toBe(keys[1].n);
    });

    it('should return only current key when previous is NONE', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_PREVIOUS_PUBLIC_KEY = 'NONE';

      const keys = await getAllPublicKeysJWK();
      expect(keys).toHaveLength(1);
    });

    it('should cache the result', async () => {
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      delete process.env.JWT_PREVIOUS_PUBLIC_KEY;

      const keys1 = await getAllPublicKeysJWK();
      const keys2 = await getAllPublicKeysJWK();
      expect(keys1).toBe(keys2); // Same instance
    });
  });

  describe('clearKeyCache', () => {
    it('should clear all cached keys including previous', async () => {
      process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_ENV;
      process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY_ENV;
      process.env.JWT_PREVIOUS_PUBLIC_KEY = TEST_PREVIOUS_PUBLIC_KEY_ENV;

      // Load keys into cache
      const privateKey1 = await getPrivateKey();
      const publicKey1 = await getPublicKey();
      const jwk1 = await getPublicKeyJWK();
      const allKeys1 = await getAllPublicKeysJWK();
      const prevKey1 = await getPreviousPublicKey();

      // Clear cache
      clearKeyCache();

      // Load again - should be new instances
      const privateKey2 = await getPrivateKey();
      const publicKey2 = await getPublicKey();
      const jwk2 = await getPublicKeyJWK();
      const allKeys2 = await getAllPublicKeysJWK();
      const prevKey2 = await getPreviousPublicKey();

      // They should not be the same instance (cache was cleared)
      expect(privateKey1).not.toBe(privateKey2);
      expect(publicKey1).not.toBe(publicKey2);
      expect(jwk1).not.toBe(jwk2);
      expect(allKeys1).not.toBe(allKeys2);
      expect(prevKey1).not.toBe(prevKey2);
    });
  });
});
