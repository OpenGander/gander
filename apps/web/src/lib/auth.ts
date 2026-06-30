import { SignJWT, createLocalJWKSet, jwtVerify, type JWTPayload } from 'jose';
import logger from './logger';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import type { Role, ImpersonationContext } from './types/user-management';
import { getPrivateKey, getKeyId, getAllPublicKeysJWK } from './keys';

const SESSION_COOKIE_NAME = 'opengander_session';

export interface SessionPayload {
  userId: string;
  email: string;
  tenantId: string;
  tenantName?: string;
  role: Role;
  type: 'session';
  /** Present when superadmin is impersonating another user */
  impersonating?: ImpersonationContext;
  iat: number;
  exp: number;
}

export interface MagicLinkPayload {
  email: string;
  type: 'magic_link';
  iat: number;
  exp: number;
}

export interface OnboardingPayload {
  email: string;
  type: 'onboarding';
  step: 'checkout' | 'payment' | 'domains' | 'snippet';
  tenantId?: string; // Set after checkout
  iat: number;
  exp: number;
}

/**
 * Options for JWT signing
 */
export interface SignTokenOptions {
  /** JWT audience claim */
  aud?: string;
  /** JWT issuer claim */
  iss?: string;
}

/**
 * Sign a JWT token using RS256
 *
 * Requires JWT_PRIVATE_KEY to be configured.
 */
export async function signToken(
  payload: Record<string, unknown>,
  expiresIn: string | number,
  options: SignTokenOptions = {}
): Promise<string> {
  const privateKey = await getPrivateKey();
  const keyId = getKeyId();

  // Calculate expiration time
  let expirationTime: Date | string;
  if (typeof expiresIn === 'number') {
    expirationTime = new Date(Date.now() + expiresIn * 1000);
  } else {
    expirationTime = expiresIn;
  }

  const jwt = new SignJWT(payload as JWTPayload).setIssuedAt().setExpirationTime(expirationTime);

  // Add optional claims
  if (options.aud) {
    jwt.setAudience(options.aud);
  }
  if (options.iss) {
    jwt.setIssuer(options.iss);
  }

  // Sign with RS256
  jwt.setProtectedHeader({ alg: 'RS256', ...(keyId && { kid: keyId }) });
  return jwt.sign(privateKey);
}

/**
 * Options for JWT verification
 */
export interface VerifyTokenOptions {
  /** Expected JWT audience claim */
  aud?: string;
  /** Expected JWT issuer claim */
  iss?: string;
}

// Cached JWKS verifier function
let jwksVerifier: ReturnType<typeof createLocalJWKSet> | null = null;

/**
 * Get (or build) the JWKS verifier that checks both current and previous keys.
 * Cached until clearKeyCache() is called.
 */
async function getJWKSVerifier(): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (jwksVerifier) {
    return jwksVerifier;
  }
  const keys = await getAllPublicKeysJWK();
  jwksVerifier = createLocalJWKSet({ keys });
  return jwksVerifier;
}

/**
 * Clear the cached JWKS verifier (called by clearKeyCache via module reload in tests,
 * or directly when keys change).
 */
export function clearJWKSVerifierCache(): void {
  jwksVerifier = null;
}

/**
 * Verify a JWT token using RS256 with multi-key support.
 *
 * Checks against both the current key and the previous key (if configured
 * during key rotation). Uses a local JWKS to resolve the correct key by kid.
 */
export async function verifyToken<T = SessionPayload | MagicLinkPayload>(
  token: string,
  options: VerifyTokenOptions = {}
): Promise<T | null> {
  try {
    const verifier = await getJWKSVerifier();

    // Build verification options
    const verifyOptions: {
      algorithms?: string[];
      audience?: string;
      issuer?: string;
    } = {};

    if (options.aud) {
      verifyOptions.audience = options.aud;
    }
    if (options.iss) {
      verifyOptions.issuer = options.iss;
    }

    const { payload } = await jwtVerify(token, verifier, {
      ...verifyOptions,
      algorithms: ['RS256'],
    });
    return payload as T;
  } catch (error) {
    logger.error({ err: error }, 'Token verification failed');
    return null;
  }
}

// Generate a session JWT token
export async function generateSessionToken(
  userId: string,
  email: string,
  tenantId: string,
  tenantName: string | undefined,
  role: Role = 'user',
  impersonating?: ImpersonationContext
): Promise<string> {
  const maxAge = parseInt(process.env.SESSION_MAX_AGE || '604800', 10); // 7 days default

  const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
    userId,
    email,
    tenantId,
    tenantName,
    role,
    type: 'session',
    ...(impersonating && { impersonating }),
  };

  return signToken(payload, maxAge);
}

// Generate a magic link JWT token
export async function generateMagicLinkToken(email: string): Promise<string> {
  const payload: Omit<MagicLinkPayload, 'iat' | 'exp'> = {
    email,
    type: 'magic_link',
  };

  return signToken(payload, '15m'); // Magic links expire in 15 minutes
}

// Generate an onboarding JWT token
export async function generateOnboardingToken(
  email: string,
  step: OnboardingPayload['step'],
  tenantId?: string
): Promise<string> {
  const payload: Omit<OnboardingPayload, 'iat' | 'exp'> = {
    email,
    type: 'onboarding',
    step,
    ...(tenantId && { tenantId }),
  };

  return signToken(payload, '1h'); // Onboarding tokens expire in 1 hour
}

// Verify an onboarding token
export async function verifyOnboardingToken(token: string): Promise<OnboardingPayload | null> {
  const payload = await verifyToken<OnboardingPayload>(token);

  if (!payload || payload.type !== 'onboarding') {
    return null;
  }

  return payload;
}

// Verify session token from request
export async function verifySession(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const payload = await verifyToken<SessionPayload>(token);

  if (!payload || payload.type !== 'session') {
    return null;
  }

  return payload;
}

// Get current session from cookies (server components)
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const payload = await verifyToken<SessionPayload>(token);

  if (!payload || payload.type !== 'session') {
    return null;
  }

  return payload;
}

// Session cookie options
export function getSessionCookieOptions() {
  const maxAge = parseInt(process.env.SESSION_MAX_AGE || '604800', 10);

  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}
