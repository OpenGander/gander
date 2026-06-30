/**
 * DNS verification utility for domain ownership verification
 * Uses DNS TXT records to verify domain ownership
 */

import { Resolver } from 'dns/promises';
import logger from './logger';

/**
 * Verify domain ownership via DNS TXT record lookup
 *
 * Expects a TXT record at _opengander.{domain} with value:
 * opengander-verify={token}
 *
 * @param domain - The domain to verify (e.g., "example.com")
 * @param expectedToken - The verification token to match (e.g., "og_abc123xyz")
 * @returns Whether the TXT record matches
 */
export async function verifyDomainDNS(
  domain: string,
  expectedToken: string
): Promise<{ verified: boolean; error?: string }> {
  const resolver = new Resolver();

  // Construct the TXT record hostname
  // For root domain "example.com", look up "_opengander.example.com"
  // For subdomain "blog.example.com", look up "_opengander.blog.example.com"
  const txtHost = `_opengander.${domain}`;

  try {
    const records = await resolver.resolveTxt(txtHost);

    // TXT records are returned as array of string arrays (chunks for long records)
    // Flatten and check for our verification record
    const flatRecords = records.map((chunks) => chunks.join(''));

    const expectedValue = `opengander-verify=${expectedToken}`;
    const found = flatRecords.some((record) => record === expectedValue);

    if (found) {
      return { verified: true };
    }

    return {
      verified: false,
      error: `TXT record not found. Expected: ${expectedValue}`,
    };
  } catch (err) {
    // Handle DNS errors gracefully
    const error = err as NodeJS.ErrnoException;

    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return {
        verified: false,
        error: `DNS record not found at ${txtHost}. Please add the TXT record and try again.`,
      };
    }

    if (error.code === 'ETIMEOUT') {
      return {
        verified: false,
        error: 'DNS lookup timed out. Please try again.',
      };
    }

    // Log unexpected errors but return a user-friendly message
    logger.error({ err: error }, 'DNS verification error');
    return {
      verified: false,
      error: 'DNS lookup failed. Please check your DNS configuration and try again.',
    };
  }
}

/**
 * Generate DNS instruction text for displaying to users
 */
export function getDNSInstructions(
  domain: string,
  token: string
): {
  recordType: string;
  recordName: string;
  recordValue: string;
  fullName: string;
} {
  // For root domain, just use _opengander
  // For subdomain like blog.example.com, use _opengander.blog.example.com
  const recordName = '_opengander';
  const fullName = `${recordName}.${domain}`;

  return {
    recordType: 'TXT',
    recordName,
    recordValue: `opengander-verify=${token}`,
    fullName,
  };
}
