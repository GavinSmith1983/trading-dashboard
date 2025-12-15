/**
 * Channel-related utilities for colors, names, and grouping
 */

export type ChannelId = 'amazon' | 'bandq' | 'ebay' | 'manomano' | 'shopify' | 'onbuy' | 'debenhams';

export interface ChannelConfig {
  id: ChannelId;
  name: string;
  color: string;
  shortName?: string;
}

// Channel configuration with consistent colors
export const CHANNELS: Record<ChannelId, ChannelConfig> = {
  amazon: { id: 'amazon', name: 'Amazon', color: '#FF9900', shortName: 'AMZ' },
  bandq: { id: 'bandq', name: 'B&Q', color: '#FF6B00', shortName: 'B&Q' },
  ebay: { id: 'ebay', name: 'eBay', color: '#0064D2', shortName: 'eBay' },
  manomano: { id: 'manomano', name: 'ManoMano', color: '#00B2A9', shortName: 'MM' },
  shopify: { id: 'shopify', name: 'Shopify', color: '#96BF48', shortName: 'Shop' },
  onbuy: { id: 'onbuy', name: 'OnBuy', color: '#E91E63', shortName: 'OnBuy' },
  debenhams: { id: 'debenhams', name: 'Debenhams', color: '#9C27B0', shortName: 'Deb' },
};

// Channel colors for charts (consistent across the app)
export const CHANNEL_COLORS: Record<string, string> = {
  Amazon: CHANNELS.amazon.color,
  'B&Q': CHANNELS.bandq.color,
  eBay: CHANNELS.ebay.color,
  ManoMano: CHANNELS.manomano.color,
  Shopify: CHANNELS.shopify.color,
  OnBuy: CHANNELS.onbuy.color,
  Debenhams: CHANNELS.debenhams.color,
  // Also support lowercase keys
  amazon: CHANNELS.amazon.color,
  bandq: CHANNELS.bandq.color,
  ebay: CHANNELS.ebay.color,
  manomano: CHANNELS.manomano.color,
  shopify: CHANNELS.shopify.color,
  onbuy: CHANNELS.onbuy.color,
  debenhams: CHANNELS.debenhams.color,
};

// Channels that share eBay pricing (as documented in CLAUDE.md)
export const EBAY_PRICING_CHANNELS: ChannelId[] = ['ebay', 'onbuy', 'debenhams'];

// Display order for channels
export const CHANNEL_DISPLAY_ORDER: ChannelId[] = [
  'amazon',
  'bandq',
  'shopify',
  'manomano',
  'ebay',
];

/**
 * Get channel color by name or id
 */
export function getChannelColor(channel: string): string {
  return CHANNEL_COLORS[channel] || '#6B7280'; // Gray fallback
}

/**
 * Get channel display name
 */
export function getChannelDisplayName(channelId: string): string {
  const normalized = channelId.toLowerCase() as ChannelId;
  return CHANNELS[normalized]?.name || channelId;
}

/**
 * Get channel config by id
 */
export function getChannelConfig(channelId: string): ChannelConfig | undefined {
  const normalized = channelId.toLowerCase() as ChannelId;
  return CHANNELS[normalized];
}

/**
 * Check if two channels share pricing (e.g., eBay/OnBuy/Debenhams)
 */
export function channelsSharePricing(channel1: string, channel2: string): boolean {
  const c1 = channel1.toLowerCase() as ChannelId;
  const c2 = channel2.toLowerCase() as ChannelId;

  if (EBAY_PRICING_CHANNELS.includes(c1) && EBAY_PRICING_CHANNELS.includes(c2)) {
    return true;
  }

  return c1 === c2;
}

/**
 * Get unique channels for pricing (collapses eBay/OnBuy/Debenhams)
 */
export function getUniquePricingChannels(): ChannelId[] {
  return ['amazon', 'bandq', 'shopify', 'manomano', 'ebay'];
}

/**
 * Generate colors for a list of items (for charts with dynamic categories)
 */
export function generateChartColors(items: string[]): Record<string, string> {
  const baseColors = [
    '#FF9900', '#FF6B00', '#0064D2', '#00B2A9', '#96BF48',
    '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3',
    '#00BCD4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
    '#FFC107', '#FF5722', '#795548', '#607D8B', '#9E9E9E',
  ];

  const colors: Record<string, string> = {};
  items.forEach((item, index) => {
    // Check if we have a predefined color for this item
    if (CHANNEL_COLORS[item]) {
      colors[item] = CHANNEL_COLORS[item];
    } else {
      colors[item] = baseColors[index % baseColors.length];
    }
  });

  return colors;
}
