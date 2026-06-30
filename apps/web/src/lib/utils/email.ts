/**
 * Email normalization utilities
 *
 * Emails are normalized to lowercase before storage and lookup
 * to ensure case-insensitive matching (standard practice per RFC 5321)
 */

/**
 * Normalize an email address to lowercase
 * @param email - The email address to normalize
 * @returns The normalized (lowercase, trimmed) email
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
