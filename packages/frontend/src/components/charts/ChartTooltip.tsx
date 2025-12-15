/**
 * Shared chart tooltip component for consistent styling across all charts
 */
import { formatPrice, formatPercent, formatNumber } from '../../utils';
import type { CurrencyCode } from '../../utils';

export interface TooltipEntry {
  name: string;
  value: number | null | undefined;
  color: string;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  dateFormat?: 'day' | 'week' | 'month';
  currency?: CurrencyCode;
  title?: string;
  children?: React.ReactNode;
}

/**
 * Format a date label based on the period type
 */
export function formatDateLabel(date: Date, format: 'day' | 'week' | 'month'): string {
  if (format === 'week') {
    const endOfWeek = new Date(date);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    return `Week of ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${endOfWeek.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  if (format === 'month') {
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format a tooltip value based on its name/type
 */
export function formatTooltipValue(
  value: number | null | undefined,
  name: string,
  currency: CurrencyCode = 'GBP'
): string {
  if (value === null || value === undefined) return '-';

  const lowerName = name.toLowerCase();

  // Currency values
  if (lowerName.includes('price') || lowerName.includes('revenue') || lowerName.includes('cost') || lowerName.includes('ppo')) {
    return formatPrice(value, currency);
  }

  // Percentage values
  if (lowerName.includes('margin') || lowerName.includes('%')) {
    return formatPercent(value);
  }

  // Integer values (quantities, stock, etc.)
  if (lowerName.includes('quantity') || lowerName.includes('stock') || lowerName.includes('units')) {
    return formatNumber(value, 0);
  }

  // Decimal values (sales per day, etc.)
  if (Number.isInteger(value)) {
    return formatNumber(value, 0);
  }

  return formatNumber(value, 2);
}

/**
 * Shared chart tooltip component
 */
export function ChartTooltip({
  active,
  payload,
  label,
  dateFormat = 'day',
  currency = 'GBP',
  title,
  children,
}: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const date = label ? new Date(label) : null;
  const dateLabel = date ? formatDateLabel(date, dateFormat) : title || '';

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        padding: '10px 12px',
        fontSize: '12px',
      }}
    >
      {dateLabel && (
        <div style={{ fontWeight: 600, marginBottom: '8px', color: '#374151' }}>
          {dateLabel}
        </div>
      )}

      {payload.map((entry, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '16px',
            marginBottom: '2px',
          }}
        >
          <span style={{ color: entry.color }}>{entry.name}:</span>
          <span style={{ fontWeight: 500 }}>
            {formatTooltipValue(entry.value, entry.name, currency)}
          </span>
        </div>
      ))}

      {children}
    </div>
  );
}

export default ChartTooltip;
