import { randomBytes } from 'crypto';

/**
 * Generate a unique tenant ID
 * Format: tenant_<16 hex characters>
 */
export function generateTenantId(): string {
  const hex = randomBytes(8).toString('hex');
  return `tenant_${hex}`;
}

/**
 * Generate a unique user ID
 * Format: user_<16 hex characters>
 */
export function generateUserId(): string {
  const hex = randomBytes(8).toString('hex');
  return `user_${hex}`;
}

/**
 * Generate a URL-safe slug from a name
 * - Converts to lowercase
 * - Replaces spaces and special characters with hyphens
 * - Removes consecutive hyphens
 * - Trims leading/trailing hyphens
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a tenant name from an email domain
 * Capitalizes the domain name (without TLD)
 * e.g., "acme.com" -> "Acme"
 */
export function generateTenantNameFromDomain(domain: string): string {
  const parts = domain.split('.');
  const name = parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
