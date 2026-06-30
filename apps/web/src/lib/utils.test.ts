import { describe, it, expect } from 'vitest';
import { parseUTCTimestamp, formatDate, formatDateTime, formatShortDate } from './utils';

describe('parseUTCTimestamp', () => {
  it('appends Z to ClickHouse-style timestamps', () => {
    const result = parseUTCTimestamp('2026-01-15 10:30:45');
    expect(result.toISOString()).toBe('2026-01-15T10:30:45.000Z');
  });

  it('handles timestamps already with Z', () => {
    const result = parseUTCTimestamp('2026-01-15T10:30:45Z');
    expect(result.toISOString()).toBe('2026-01-15T10:30:45.000Z');
  });

  it('handles timestamps with timezone offset', () => {
    const result = parseUTCTimestamp('2026-01-15T10:30:45+00:00');
    expect(result.toISOString()).toBe('2026-01-15T10:30:45.000Z');
  });

  it('returns invalid date for empty string', () => {
    const result = parseUTCTimestamp('');
    expect(isNaN(result.getTime())).toBe(true);
  });
});

describe('formatDate', () => {
  it('formats Date object as "Mon DD, YYYY"', () => {
    // Use noon UTC to avoid timezone-shift issues
    const result = formatDate(new Date('2026-01-15T12:00:00Z'));
    expect(result).toMatch(/Jan 15, 2026/);
  });

  it('formats string input', () => {
    const result = formatDate('2026-12-25T12:00:00Z');
    expect(result).toMatch(/Dec 25, 2026/);
  });
});

describe('formatDateTime', () => {
  it('formats Date with time', () => {
    const result = formatDateTime(new Date('2026-01-15T15:45:00Z'));
    // Exact output depends on timezone, but should contain month and time parts
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  it('formats string input', () => {
    const result = formatDateTime('2026-06-01T09:30:00Z');
    expect(result).toContain('Jun');
    expect(result).toContain('2026');
  });
});

describe('formatShortDate', () => {
  it('formats as "Jan 15" style', () => {
    const result = formatShortDate(new Date('2026-01-15T12:00:00Z'));
    expect(result).toMatch(/Jan 15/);
  });

  it('formats string input', () => {
    const result = formatShortDate('2026-03-29T00:00:00Z');
    expect(result).toMatch(/Mar 2[89]/); // timezone can shift the day
  });
});
