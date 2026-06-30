/**
 * ClickHouse DateTime64(3) formatting and parsing utilities.
 * Shared across OAuth modules that store timestamps in ClickHouse.
 */

/**
 * Format a Date as ClickHouse DateTime64(3) string in UTC
 * Example: "2024-01-15 10:30:45.123"
 */
export function formatDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Parse a ClickHouse DateTime64(3) string as UTC
 * ClickHouse stores dates in UTC, so we need to parse them correctly
 * Example input: "2024-01-15 10:30:45.123"
 */
export function parseDateTime(dateStr: string): Date {
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}
