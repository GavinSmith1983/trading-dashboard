/**
 * Business calculation utilities for margin, PPO, and product metrics
 */

export interface ProductMetrics {
  priceExVat: number;
  channelFee: number;
  totalCost: number;
  ppo: number;        // Profit Per Order
  margin: number;     // Margin percentage
}

export interface ChannelFees {
  shopify: number;
  amazon: number;
  ebay: number;
  manomano: number;
  bandq: number;
  [key: string]: number;
}

// Default channel fees (percentage as decimal, e.g., 0.15 = 15%)
export const DEFAULT_CHANNEL_FEES: ChannelFees = {
  shopify: 0.15,
  amazon: 0.20,
  ebay: 0.20,
  manomano: 0.20,
  bandq: 0.20,
};

// Default VAT rate (UK standard)
export const DEFAULT_VAT_RATE = 0.20;

/**
 * Get channel fee percentage for a channel
 * @param channelId - Channel identifier (lowercase)
 * @param customFees - Optional custom fee structure
 * @returns Fee as decimal (e.g., 0.15 for 15%)
 */
export function getChannelFee(
  channelId: string | null,
  customFees?: Partial<ChannelFees>
): number {
  if (!channelId) return DEFAULT_CHANNEL_FEES.amazon; // Default to 20%

  const fees = { ...DEFAULT_CHANNEL_FEES, ...customFees };
  const normalizedChannel = channelId.toLowerCase();

  return fees[normalizedChannel] ?? DEFAULT_CHANNEL_FEES.amazon;
}

/**
 * Calculate product metrics (PPO, margin, etc.)
 * @param sellingPrice - Selling price including VAT
 * @param costPrice - Product cost price
 * @param deliveryCost - Delivery cost per unit
 * @param channelId - Channel for fee calculation
 * @param vatRate - VAT rate as decimal (default 0.20)
 * @param customFees - Optional custom channel fees
 */
export function calculateProductMetrics(
  sellingPrice: number,
  costPrice: number,
  deliveryCost: number = 0,
  channelId: string | null = null,
  vatRate: number = DEFAULT_VAT_RATE,
  customFees?: Partial<ChannelFees>
): ProductMetrics {
  // Calculate price excluding VAT
  const priceExVat = sellingPrice / (1 + vatRate);

  // Get channel fee
  const channelFeeRate = getChannelFee(channelId, customFees);
  const channelFee = priceExVat * channelFeeRate;

  // Total costs
  const totalCost = costPrice + deliveryCost + channelFee;

  // Profit Per Order
  const ppo = priceExVat - totalCost;

  // Margin percentage
  const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;

  return {
    priceExVat,
    channelFee,
    totalCost,
    ppo,
    margin,
  };
}

/**
 * Calculate simple margin percentage
 * Used for quick calculations when full metrics aren't needed
 */
export function calculateMargin(
  sellingPrice: number,
  costPrice: number,
  deliveryCost: number = 0,
  channelFeeRate: number = 0.20,
  vatRate: number = DEFAULT_VAT_RATE
): number {
  if (sellingPrice <= 0 || costPrice <= 0) return 0;

  const priceExVat = sellingPrice / (1 + vatRate);
  const channelFee = priceExVat * channelFeeRate;
  const ppo = priceExVat - channelFee - costPrice - deliveryCost;

  return priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
}

/**
 * Get margin color class based on margin percentage
 */
export function getMarginColor(margin: number): string {
  if (margin < 0) return 'text-red-600';
  if (margin < 15) return 'text-red-500';
  if (margin < 25) return 'text-yellow-600';
  if (margin < 35) return 'text-green-500';
  return 'text-green-600';
}

/**
 * Get margin background color class
 */
export function getMarginBgColor(margin: number): string {
  if (margin < 0) return 'bg-red-50';
  if (margin < 15) return 'bg-red-50';
  if (margin < 25) return 'bg-yellow-50';
  if (margin < 35) return 'bg-green-50';
  return 'bg-green-50';
}

/**
 * Calculate days of stock remaining
 */
export function calculateDaysOfStock(
  stockLevel: number,
  avgDailySales: number
): number | null {
  if (avgDailySales <= 0) return null;
  return Math.round(stockLevel / avgDailySales);
}

/**
 * Get stock status based on days of stock
 */
export function getStockStatus(
  stockLevel: number,
  daysOfStock: number | null
): 'out' | 'danger' | 'low' | 'ok' {
  if (stockLevel === 0) return 'out';
  if (daysOfStock !== null && daysOfStock < 14) return 'danger';
  if (stockLevel < 10) return 'low';
  return 'ok';
}

/**
 * Get stock status color class
 */
export function getStockStatusColor(status: 'out' | 'danger' | 'low' | 'ok'): string {
  const colors = {
    out: 'text-red-600',
    danger: 'text-orange-600',
    low: 'text-yellow-600',
    ok: 'text-green-600',
  };
  return colors[status];
}
