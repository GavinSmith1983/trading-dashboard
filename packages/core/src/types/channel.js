"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CHANNEL_CONFIGS = void 0;
/**
 * Default channel configurations
 */
exports.DEFAULT_CHANNEL_CONFIGS = {
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
//# sourceMappingURL=channel.js.map