/**
 * Utility functions barrel export
 *
 * Usage:
 *   import { formatCurrency, getDateRange, calculateMargin } from '@/utils';
 *   // or import specific modules:
 *   import { formatCurrency } from '@/utils/format';
 */

// Format utilities
export {
  formatCurrency,
  formatPrice,
  formatPercent,
  formatNumber,
  formatCurrencyCompact,
  formatPriceChange,
  getCurrencySymbol,
  type CurrencyCode,
} from './format';

// Date utilities
export {
  getDateRange,
  getToday,
  toISODateString,
  formatDate,
  formatChartDate,
  formatChartTooltipDate,
  getWeekStart,
  getMonthStart,
  formatWeekRange,
  formatMonth,
  daysBetween,
  getDatesBetween,
  type DateRange,
  type DateRangePreset,
} from './dates';

// Calculation utilities
export {
  calculateProductMetrics,
  calculateMargin,
  getChannelFee,
  getMarginColor,
  getMarginBgColor,
  calculateDaysOfStock,
  getStockStatus,
  getStockStatusColor,
  DEFAULT_CHANNEL_FEES,
  DEFAULT_VAT_RATE,
  type ProductMetrics,
  type ChannelFees,
} from './calculations';

// Channel utilities
export {
  CHANNELS,
  CHANNEL_COLORS,
  CHANNEL_DISPLAY_ORDER,
  EBAY_PRICING_CHANNELS,
  getChannelColor,
  getChannelDisplayName,
  getChannelConfig,
  channelsSharePricing,
  getUniquePricingChannels,
  generateChartColors,
  type ChannelId,
  type ChannelConfig,
} from './channels';
