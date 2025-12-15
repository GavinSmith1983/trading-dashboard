/**
 * Formatting utilities for currency, percentages, and numbers
 */

export type CurrencyCode = 'GBP' | 'USD' | 'EUR';

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
};

/**
 * Get currency symbol for a currency code
 */
export function getCurrencySymbol(currency: CurrencyCode = 'GBP'): string {
  return CURRENCY_SYMBOLS[currency] || '£';
}

/**
 * Format a number as currency with symbol
 * @param value - The numeric value
 * @param currency - Currency code (GBP, USD, EUR)
 * @param decimals - Number of decimal places (default 2)
 */
export function formatCurrency(
  value: number | undefined | null,
  currency: CurrencyCode = 'GBP',
  decimals: number = 2
): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${value.toFixed(decimals)}`;
}

/**
 * Format a number as currency for display in tables (compact)
 */
export function formatPrice(
  value: number | undefined | null,
  currency: CurrencyCode = 'GBP'
): string {
  return formatCurrency(value, currency, 2);
}

/**
 * Format a percentage value
 * @param value - The numeric value (already as percentage, e.g., 25 for 25%)
 * @param decimals - Number of decimal places (default 1)
 * @param showSign - Whether to show + for positive values
 */
export function formatPercent(
  value: number | undefined | null,
  decimals: number = 1,
  showSign: boolean = false
): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Format a large number with locale-specific separators
 * @param value - The numeric value
 * @param decimals - Number of decimal places (default 0)
 */
export function formatNumber(
  value: number | undefined | null,
  decimals: number = 0
): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a currency value with locale-specific separators (for large numbers)
 */
export function formatCurrencyCompact(
  value: number | undefined | null,
  currency: CurrencyCode = 'GBP',
  decimals: number = 0
): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }
  const symbol = getCurrencySymbol(currency);
  const formatted = value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted}`;
}

/**
 * Format price change with direction indicator
 */
export function formatPriceChange(
  previousPrice: number,
  newPrice: number,
  currency: CurrencyCode = 'GBP'
): { formatted: string; direction: 'up' | 'down' | 'same'; percentChange: number } {
  const diff = newPrice - previousPrice;
  const percentChange = previousPrice > 0 ? (diff / previousPrice) * 100 : 0;
  const symbol = getCurrencySymbol(currency);

  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const sign = diff > 0 ? '+' : '';
  const formatted = `${sign}${symbol}${diff.toFixed(2)} (${sign}${percentChange.toFixed(1)}%)`;

  return { formatted, direction, percentChange };
}
