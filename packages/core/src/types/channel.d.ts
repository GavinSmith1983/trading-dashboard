/**
 * Channel configuration - fees and settings per sales channel
 */
export interface Channel {
    channelId: ChannelId;
    name: string;
    isActive: boolean;
    commissionPercent: number;
    fixedFee?: number;
    paymentProcessingPercent?: number;
    defaultAcosPercent?: number;
    includeAdvertisingInMargin: boolean;
    vatPercent: number;
    pricesIncludeVat: boolean;
    channelEngineId?: number;
    lastUpdated: string;
}
/**
 * Supported channel identifiers
 */
export type ChannelId = 'amazon' | 'ebay' | 'bandq' | 'manomano' | 'shopify';
/**
 * Default channel configurations
 */
export declare const DEFAULT_CHANNEL_CONFIGS: Record<ChannelId, Omit<Channel, 'lastUpdated'>>;
/**
 * Per-product channel overrides
 */
export interface ProductChannelOverride {
    sku: string;
    channelId: ChannelId;
    customAcosPercent?: number;
    customCommissionPercent?: number;
    isListed: boolean;
}
//# sourceMappingURL=channel.d.ts.map