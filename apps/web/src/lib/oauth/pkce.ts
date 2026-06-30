/**
 * PKCE (Proof Key for Code Exchange) Utilities
 *
 * Implements SHA256 code challenge verification for OAuth 2.1 PKCE flow.
 * The code_verifier is a random string sent during token exchange.
 * The code_challenge is the SHA256 hash of the verifier, sent during authorization.
 */
import crypto, { timingSafeEqual } from 'crypto';

/**
 * Encode a buffer as base64url (RFC 4648 Section 5)
 * - Replace + with -
 * - Replace / with _
 * - Remove = padding
 */
function base64url(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Verify that a code_verifier matches a code_challenge using SHA256
 *
 * Uses timing-safe comparison to prevent timing attacks where an attacker
 * could measure response times to deduce the correct code_challenge.
 *
 * @param codeVerifier - The original random string (43-128 chars, [A-Za-z0-9-._~])
 * @param codeChallenge - The stored code_challenge from authorization request
 * @returns true if SHA256(code_verifier) matches code_challenge
 */
export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string
): boolean {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const computed = base64url(hash);

  // Timing-safe comparison with length padding to prevent timing attacks
  // Both strings are padded to the same length before comparison
  const maxLen = Math.max(computed.length, codeChallenge.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(computed);
  bufB.write(codeChallenge);

  // Length must match AND contents must match (timing-safe)
  return computed.length === codeChallenge.length && timingSafeEqual(bufA, bufB);
}

/**
 * Generate a code_challenge from a code_verifier
 *
 * This is primarily useful for testing. In production, the client
 * generates both the verifier and challenge.
 *
 * @param codeVerifier - The random string to hash
 * @returns The base64url-encoded SHA256 hash
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  return base64url(hash);
}

/**
 * Validate code_verifier format per RFC 7636 Section 4.1
 *
 * code_verifier must be:
 * - 43-128 characters long
 * - Only contain: [A-Za-z0-9-._~]
 *
 * @param codeVerifier - The verifier to validate
 * @returns true if the verifier meets PKCE requirements
 */
export function isValidCodeVerifier(codeVerifier: string): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  // RFC 7636: unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
  return /^[A-Za-z0-9\-._~]+$/.test(codeVerifier);
}
