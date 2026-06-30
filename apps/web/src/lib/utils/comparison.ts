/**
 * Utility functions for time-over-time metric comparisons
 */

/**
 * Calculate percentage change between two values
 * @param current - Current period value
 * @param previous - Previous period value
 * @returns Percentage change (positive for growth, negative for decline)
 */
export function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    // If previous is 0 and current is positive, it's infinite growth
    // Return 100 as a reasonable cap for "new" metrics
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

/**
 * Format percentage change for display
 * @param percentChange - The percentage change value
 * @returns Formatted string like "+45.2%" or "-12.5%"
 */
export function formatPercentageChange(percentChange: number): string {
  const abs = Math.abs(percentChange);

  // Cap at ±999% for readability
  const capped = Math.min(abs, 999);

  // Use 1 decimal place for values < 10, otherwise no decimals
  const rounded = capped < 10 ? capped.toFixed(1) : Math.round(capped).toString();

  // Add + sign for positive changes
  const sign = percentChange > 0 ? '+' : '';

  return `${sign}${percentChange < 0 ? '-' : ''}${rounded}%`;
}

/**
 * Get comparison status for styling
 * @param percentChange - The percentage change value
 * @returns Status indicating direction and significance of change
 */
export function getComparisonStatus(percentChange: number): 'positive' | 'negative' | 'neutral' {
  // Consider changes < 1% as neutral (no significant change)
  if (Math.abs(percentChange) < 1) {
    return 'neutral';
  }
  return percentChange > 0 ? 'positive' : 'negative';
}

/**
 * Format time in milliseconds to human-readable format
 * Used for displaying time on page metrics
 * @param ms - Time in milliseconds
 * @returns Formatted string like "1m 23s" or "45s"
 */
export function formatTimeMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}
