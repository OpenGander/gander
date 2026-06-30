import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, importSPKI, exportJWK, createLocalJWKSet } from 'jose';

const SESSION_COOKIE_NAME = 'opengander_session';
const PUBLIC_PATHS = [
  '/signin',
  '/signup',
  '/api/',
  '/onboarding',
  '/invite',
  '/oauth',
  '/_next',
  '/.well-known',
  '/sdk',
  '/favicon.ico',
];

// Cache the JWKS verifier for middleware (Edge Runtime)
let jwksVerifierCache: ReturnType<typeof createLocalJWKSet> | null = null;

/**
 * Parse PEM string from environment variable format
 */
function parsePemString(pem: string): string {
  return pem.replace(/\\n/g, '\n');
}

/**
 * Build a JWKS verifier with current + previous public keys (Edge Runtime compatible).
 * Uses importSPKI + exportJWK since we can't use Node.js crypto in Edge.
 */
async function getJWKSVerifierEdge(): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (jwksVerifierCache) {
    return jwksVerifierCache;
  }

  const currentPem = process.env.JWT_PUBLIC_KEY;
  if (!currentPem) {
    throw new Error('JWT_PUBLIC_KEY is required but not configured');
  }

  const keys: Record<string, unknown>[] = [];

  // Current key
  const currentKey = await importSPKI(parsePemString(currentPem), 'RS256');
  const currentJwk = await exportJWK(currentKey);
  const currentKid = process.env.JWT_KEY_ID;
  keys.push({
    ...currentJwk,
    ...(currentKid && { kid: currentKid }),
    use: 'sig',
    alg: 'RS256',
  });

  // Previous key (optional, during rotation)
  const previousPem = process.env.JWT_PREVIOUS_PUBLIC_KEY;
  if (previousPem && previousPem !== 'NONE') {
    const previousKey = await importSPKI(parsePemString(previousPem), 'RS256');
    const previousJwk = await exportJWK(previousKey);
    const previousKid = process.env.JWT_PREVIOUS_KEY_ID;
    keys.push({
      ...previousJwk,
      ...(previousKid && { kid: previousKid }),
      use: 'sig',
      alg: 'RS256',
    });
  }

  jwksVerifierCache = createLocalJWKSet({ keys });
  return jwksVerifierCache;
}

/**
 * Verify session token using RS256 with multi-key support (Edge Runtime compatible)
 */
async function verifySessionEdge(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return false;
  }

  try {
    const verifier = await getJWKSVerifierEdge();
    const { payload } = await jwtVerify(token, verifier, {
      algorithms: ['RS256'],
    });
    return payload.type === 'session';
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if path is public (skip auth)
  const isProtected = !PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!isProtected) {
    return NextResponse.next();
  }

  // Verify session
  const hasValidSession = await verifySessionEdge(request);
  if (!hasValidSession) {
    const signinUrl = new URL('/signin', request.url);
    signinUrl.searchParams.set('returnUrl', pathname);
    return NextResponse.redirect(signinUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next|\\.well-known|signin|signup|onboarding|invite|oauth|sdk|favicon\\.ico).*)',
  ],
};
