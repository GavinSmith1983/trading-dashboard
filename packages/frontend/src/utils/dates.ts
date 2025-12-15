/**
 * Date utilities for date range calculations and formatting
 */

export type DateRangePreset = 'thisMonth' | 'lastMonth' | '1M' | '3M' | '6M' | '12M';

export interface DateRange {
  from: string; // ISO date string YYYY-MM-DD
  to: string;   // ISO date string YYYY-MM-DD
}

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
export function getToday(): string {
  return new Date().toISOString().substring(0, 10);
}

/**
 * Format a date as ISO string (YYYY-MM-DD)
 */
export function toISODateString(date: Date): string {
  return date.toISOString().substring(0, 10);
}

/**
 * Get date range based on preset or number of days
 * @param range - Number of days back, or preset like 'thisMonth', 'lastMonth'
 */
export function getDateRange(range: number | DateRangePreset): DateRange {
  const now = new Date();

  if (range === 'thisMonth') {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from: toISODateString(firstOfMonth),
      to: toISODateString(now),
    };
  }

  if (range === 'lastMonth') {
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      from: toISODateString(firstOfLastMonth),
      to: toISODateString(lastOfLastMonth),
    };
  }

  // Handle string presets like '1M', '3M', etc.
  let days: number;
  if (typeof range === 'string') {
    const daysMap: Record<string, number> = {
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '12M': 365,
    };
    days = daysMap[range] || 30;
  } else {
    days = range;
  }

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  return {
    from: toISODateString(fromDate),
    to: toISODateString(now),
  };
}

/**
 * Format a date for display
 * @param date - Date object or ISO string
 * @param format - 'short' (15 Dec), 'medium' (15 Dec 2024), 'long' (15 December 2024)
 */
export function formatDate(
  date: Date | string,
  format: 'short' | 'medium' | 'long' = 'short'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: format === 'long' ? 'long' : 'short',
    ...(format !== 'short' && { year: 'numeric' }),
  };

  return d.toLocaleDateString('en-GB', options);
}

/**
 * Format a date for chart axis labels
 */
export function formatChartDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Format a date for chart tooltips (more detailed)
 */
export function formatChartTooltipDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Get the Monday of the week containing the given date (for weekly grouping)
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
}

/**
 * Get the first day of the month containing the given date (for monthly grouping)
 */
export function getMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Format a week range for display
 */
export function formatWeekRange(startDate: Date): string {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

  const startStr = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const endStr = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return `${startStr} - ${endStr}`;
}

/**
 * Format a month for display
 */
export function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/**
 * Calculate days between two dates
 */
export function daysBetween(from: Date | string, to: Date | string): number {
  const fromDate = typeof from === 'string' ? new Date(from) : from;
  const toDate = typeof to === 'string' ? new Date(to) : to;
  const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get an array of dates between from and to (inclusive)
 */
export function getDatesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from);
  const end = new Date(to);

  while (current <= end) {
    dates.push(toISODateString(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
