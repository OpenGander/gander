import { describe, it, expect } from 'vitest';
import { formatDateTime, parseDateTime } from './clickhouse-datetime';

describe('formatDateTime', () => {
  it('formats Date as ClickHouse DateTime64(3) string', () => {
    const date = new Date('2024-01-15T10:30:45.123Z');
    expect(formatDateTime(date)).toBe('2024-01-15 10:30:45.123');
  });

  it('replaces T with space and removes Z', () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    const result = formatDateTime(date);
    expect(result).not.toContain('T');
    expect(result).not.toContain('Z');
    expect(result).toBe('2026-06-01 00:00:00.000');
  });
});

describe('parseDateTime', () => {
  it('parses ClickHouse DateTime64(3) string as UTC', () => {
    const result = parseDateTime('2024-01-15 10:30:45.123');
    expect(result.toISOString()).toBe('2024-01-15T10:30:45.123Z');
  });

  it('roundtrips with formatDateTime', () => {
    const original = new Date('2026-03-29T14:22:33.456Z');
    const formatted = formatDateTime(original);
    const parsed = parseDateTime(formatted);
    expect(parsed.getTime()).toBe(original.getTime());
  });
});
