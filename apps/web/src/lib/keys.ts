/**
 * RSA Key Management for JWT RS256 signing and verification
 *
 * This module handles loading RSA keys from environment variables
 * and exporting them in JWK format for the JWKS endpoint.
 */

import { importPKCS8, importSPKI, exportJWK } from 'jose';
import logger from './logger';

// Type for RSA key that can be used for signing/verification
type RSAKey = Awaited<ReturnType<typeof importPKCS8>>;

// JWK type used for JWKS endpoint responses
export type JWKEntry = {
  kty: string;
  n: string;
  e: string;
  kid?: string;
  use?: string;
  alg?: string;
};

// Cache loaded keys to avoid repeated parsing
let privateKeyCache: RSAKey | null = null;
let publicKeyCache: RSAKey | null = null;
let previousPublicKeyCache: RSAKey | null = null;
let previousPublicKeyLoaded = false;
let keysInitialized = false;
let jwkCache: JWKEntry | null = null;
let allKeysJWKCache: JWKEntry[] | null = null;

/**
 * Get the configured key ID for JWT signing
 */
export function getKeyId(): string | undefined {
  return process.env.JWT_KEY_ID;
}

/**
 * Parse PEM string from environment variable format
 * Environment variables store PEM keys with literal \n characters
 * that need to be converted to actual newlines
 */
function parsePemString(pem: string): string {
  // Replace literal \n with actual newlines
  return pem.replace(/\\n/g, '\n');
}

/**
 * Load the RSA private key from JWT_PRIVATE_KEY environment variable
 * Throws if not configured - RS256 is required
 */
export async function getPrivateKey(): Promise<RSAKey> {
  if (privateKeyCache) {
    return privateKeyCache;
  }

  const pemString = process.env.JWT_PRIVATE_KEY;
  if (!pemString) {
    throw new Error('JWT_PRIVATE_KEY is required but not configured. RS256 signing is mandatory.');
  }

  try {
    const pem = parsePemString(pemString);
    privateKeyCache = await importPKCS8(pem, 'RS256');
    if (!keysInitialized) {
      logger.info('RSA private key loaded');
    }
    return privateKeyCache;
  } catch (error) {
    throw new Error(`Failed to load RSA private key: ${error}`);
  }
}

/**
 * Load the RSA public key from JWT_PUBLIC_KEY environment variable
 * Throws if not configured - RS256 is required
 */
export async function getPublicKey(): Promise<RSAKey> {
  if (publicKeyCache) {
    return publicKeyCache;
  }

  const pemString = process.env.JWT_PUBLIC_KEY;
  if (!pemString) {
    throw new Error(
      'JWT_PUBLIC_KEY is required but not configured. RS256 verification is mandatory.'
    );
  }

  try {
    const pem = parsePemString(pemString);
    publicKeyCache = await importSPKI(pem, 'RS256');
    if (!keysInitialized) {
      logger.info('RSA public key loaded');
      keysInitialized = true;
    }
    return publicKeyCache;
  } catch (error) {
    throw new Error(`Failed to load RSA public key: ${error}`);
  }
}

/**
 * Initialize and validate RS256 keys
 * Call this at startup to fail fast if keys are misconfigured
 */
export async function initializeKeys(): Promise<void> {
  await Promise.all([getPrivateKey(), getPublicKey()]);
}

/**
 * Export the public key in JWK format for the JWKS endpoint
 * Throws if public key is not configured
 */
export async function getPublicKeyJWK(): Promise<{
  kty: string;
  n: string;
  e: string;
  kid?: string;
  use?: string;
  alg?: string;
}> {
  if (jwkCache) {
    return jwkCache;
  }

  const publicKey = await getPublicKey();
  const jwk = await exportJWK(publicKey);

  // Add standard JWK properties for JWKS endpoint
  const keyId = getKeyId();
  const result = {
    ...jwk,
    ...(keyId && { kid: keyId }),
    use: 'sig',
    alg: 'RS256',
  } as {
    kty: string;
    n: string;
    e: string;
    kid?: string;
    use?: string;
    alg?: string;
  };

  jwkCache = result;
  return result;
}

/**
 * Get the configured previous key ID (used during key rotation)
 */
export function getPreviousKeyId(): string | undefined {
  return process.env.JWT_PREVIOUS_KEY_ID;
}

/**
 * Load the previous RSA public key from JWT_PREVIOUS_PUBLIC_KEY environment variable.
 * Returns null if not configured (no rotation in progress).
 */
export async function getPreviousPublicKey(): Promise<RSAKey | null> {
  if (previousPublicKeyLoaded) {
    return previousPublicKeyCache;
  }

  const pemString = process.env.JWT_PREVIOUS_PUBLIC_KEY;
  if (!pemString || pemString === 'NONE') {
    previousPublicKeyLoaded = true;
    return null;
  }

  try {
    const pem = parsePemString(pemString);
    previousPublicKeyCache = await importSPKI(pem, 'RS256');
    previousPublicKeyLoaded = true;
    logger.info('Previous RSA public key loaded for rotation');
    return previousPublicKeyCache;
  } catch (error) {
    throw new Error(`Failed to load previous RSA public key: ${error}`);
  }
}

/**
 * Export all public keys in JWK format for the JWKS endpoint.
 * Returns current key, plus previous key if configured (during rotation).
 */
export async function getAllPublicKeysJWK(): Promise<JWKEntry[]> {
  if (allKeysJWKCache) {
    return allKeysJWKCache;
  }

  const keys: JWKEntry[] = [];

  // Current key (always present)
  const currentJWK = await getPublicKeyJWK();
  keys.push(currentJWK);

  // Previous key (only during rotation)
  const previousKey = await getPreviousPublicKey();
  if (previousKey) {
    const prevJwk = await exportJWK(previousKey);
    const prevKeyId = getPreviousKeyId();
    keys.push({
      ...prevJwk,
      ...(prevKeyId && { kid: prevKeyId }),
      use: 'sig',
      alg: 'RS256',
    } as JWKEntry);
  }

  allKeysJWKCache = keys;
  return keys;
}

/**
 * Clear the key caches (useful for testing)
 */
export function clearKeyCache(): void {
  privateKeyCache = null;
  publicKeyCache = null;
  previousPublicKeyCache = null;
  previousPublicKeyLoaded = false;
  keysInitialized = false;
  jwkCache = null;
  allKeysJWKCache = null;
}
