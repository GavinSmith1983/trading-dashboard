/**
 * Hook for managing date range selection state
 */
import { useState, useMemo } from 'react';
import { getDateRange, type DateRange, type DateRangePreset } from '../utils';

export type TimeRangeValue = number | DateRangePreset;

export interface TimeRangeOption {
  label: string;
  value: TimeRangeValue;
}

// Default time range options
export const DEFAULT_TIME_RANGES: TimeRangeOption[] = [
  { label: '1W', value: 7 },
  { label: '1M', value: 30 },
  { label: '3M', value: 90 },
  { label: '6M', value: 180 },
  { label: '12M', value: 365 },
];

// Extended time range options including calendar-based
export const EXTENDED_TIME_RANGES: TimeRangeOption[] = [
  { label: '1W', value: 7 },
  { label: 'This Month', value: 'thisMonth' },
  { label: 'Last Month', value: 'lastMonth' },
  { label: '1M', value: 30 },
  { label: '3M', value: 90 },
  { label: '6M', value: 180 },
  { label: '12M', value: 365 },
  { label: '18M', value: 548 },
];

export interface UseDateRangeOptions {
  defaultValue?: TimeRangeValue;
  ranges?: TimeRangeOption[];
}

export interface UseDateRangeReturn {
  /** Currently selected time range value */
  selectedRange: TimeRangeValue;
  /** Set the selected time range */
  setSelectedRange: (value: TimeRangeValue) => void;
  /** Computed date range for API calls */
  dateRange: DateRange;
  /** Available time range options */
  options: TimeRangeOption[];
  /** Number of days in current range (for display) */
  days: number;
}

/**
 * Hook for managing date range selection with computed API parameters
 */
export function useDateRange(options: UseDateRangeOptions = {}): UseDateRangeReturn {
  const {
    defaultValue = 30,
    ranges = DEFAULT_TIME_RANGES,
  } = options;

  const [selectedRange, setSelectedRange] = useState<TimeRangeValue>(defaultValue);

  const dateRange = useMemo(() => {
    if (typeof selectedRange === 'number') {
      return getDateRange(selectedRange);
    }
    return getDateRange(selectedRange);
  }, [selectedRange]);

  const days = useMemo(() => {
    if (typeof selectedRange === 'number') {
      return selectedRange;
    }
    // Calculate days from date range for calendar-based ranges
    const from = new Date(dateRange.from);
    const to = new Date(dateRange.to);
    return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
  }, [selectedRange, dateRange]);

  return {
    selectedRange,
    setSelectedRange,
    dateRange,
    options: ranges,
    days,
  };
}

export default useDateRange;
