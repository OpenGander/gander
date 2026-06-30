import { NextResponse } from 'next/server';
import { getAllPublicKeysJWK } from '@/lib/keys';
import logger from '@/lib/logger';

/**
 * JWKS (JSON Web Key Set) endpoint
 *
 * Returns the public key(s) used to verify JWTs signed by this server.
 * During key rotation, both current and previous keys are included so
 * tokens signed with the old key remain valid until they expire.
 *
 * GET /api/.well-known/jwks.json
 */
export async function GET() {
  try {
    const keys = await getAllPublicKeysJWK();

    return NextResponse.json(
      { keys },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      }
    );
  } catch (error) {
    logger.error({ err: error }, 'JWKS endpoint error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
