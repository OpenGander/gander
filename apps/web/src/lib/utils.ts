import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse a timestamp from ClickHouse as UTC
 * ClickHouse returns timestamps without timezone indicator (e.g., "2026-01-11 01:17:26")
 * JavaScript would interpret this as local time, so we append 'Z' to ensure UTC parsing
 */
export function parseUTCTimestamp(timestamp: string): Date {
  if (!timestamp) return new Date(NaN);
  // Already has timezone indicator
  if (timestamp.includes('Z') || timestamp.includes('+') || timestamp.includes('-', 10)) {
    return new Date(timestamp);
  }
  // Convert space-separated format to ISO and append Z for UTC
  return new Date(timestamp.replace(' ', 'T') + 'Z');
}

/**
 * Format a Date for display as date only (e.g., "Jan 15, 2026")
 * Pinned to en-US locale to avoid system-dependent output
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a Date for display as date + time (e.g., "Jan 15, 2026, 3:45 PM")
 * Pinned to en-US locale to avoid system-dependent output
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a Date for chart axis labels (e.g., "Jan 15")
 * Pinned to en-US locale to avoid system-dependent output
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
