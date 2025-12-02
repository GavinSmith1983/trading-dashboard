/**
 * Channel configuration - fees and settings per sales channel
 */
export interface Channel {
  channelId: ChannelId;
  name: string;
  isActive: boolean;

  // Fee structure
  commissionPercent: number; // Platform commission (e.g., 15% for Amazon)
  fixedFee?: number; // Per-transaction fixed fee
  paymentProcessingPercent?: number; // Payment processing fee (e.g., 2.9% for Shopify)

  // Advertising
  defaultAcosPercent?: number; // Default advertising cost of sale
  includeAdvertisingInMargin: boolean; // Whether to factor ads into margin calc

  // VAT handling
  vatPercent: number; // Usually 20% in UK
  pricesIncludeVat: boolean;

  // ChannelEngine mapping
  channelEngineId?: number; // ID in ChannelEngine system

  // Metadata
  lastUpdated: string;
}

/**
 * Supported channel identifiers
 */
export type ChannelId = 'amazon' | 'ebay' | 'bandq' | 'manomano' | 'shopify';

/**
 * Default channel configurations
 */
export const DEFAULT_CHANNEL_CONFIGS: Record<ChannelId, Omit<Channel, 'lastUpdated'>> = {
  amazon: {
    channelId: 'amazon',
    name: 'Amazon UK',
    isActive: true,
    commissionPercent: 15,
    fixedFee: 0,
    paymentProcessingPercent: 0,
    defaultAcosPercent: 15,
    includeAdvertisingInMargin: true,
    vatPercent: 20,
    pricesIncludeVat: true,
  },
  ebay: {
    channelId: 'ebay',
    name: 'eBay UK',
    isActive: true,
    commissionPercent: 12.8,
    fixedFee: 0.30,
    paymentProcessingPercent: 0,
    defaultAcosPercent: 10,
    includeAdvertisingInMargin: true,
    vatPercent: 20,
    pricesIncludeVat: true,
  },
  bandq: {
    channelId: 'bandq',
    name: 'B&Q',
    isActive: true,
    commissionPercent: 15, // Adjust based on actual agreement
    fixedFee: 0,
    paymentProcessingPercent: 0,
    defaultAcosPercent: 0,
    includeAdvertisingInMargin: false,
    vatPercent: 20,
    pricesIncludeVat: true,
  },
  manomano: {
    channelId: 'manomano',
    name: 'ManoMano',
    isActive: true,
    commissionPercent: 15, // Adjust based on actual agreement
    fixedFee: 0,
    paymentProcessingPercent: 0,
    defaultAcosPercent: 10,
    includeAdvertisingInMargin: true,
    vatPercent: 20,
    pricesIncludeVat: true,
  },
  shopify: {
    channelId: 'shopify',
    name: 'Shopify (Direct)',
    isActive: true,
    commissionPercent: 0, // No marketplace commission
    fixedFee: 0,
    paymentProcessingPercent: 2.9, // Shopify Payments
    defaultAcosPercent: 5, // Google/Facebook ads
    includeAdvertisingInMargin: true,
    vatPercent: 20,
    pricesIncludeVat: true,
  },
};

/**
 * Per-product channel overrides
 */
export interface ProductChannelOverride {
  sku: string;
  channelId: ChannelId;
  customAcosPercent?: number; // Override default ACOS for this product
  customCommissionPercent?: number; // Override commission if negotiated
  isListed: boolean; // Whether product is listed on this channel
}
