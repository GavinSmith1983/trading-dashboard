/**
 * Core product data structure
 * Combines data from Google Sheets, ChannelEngine, and manual configuration
 */
export interface Product {
    sku: string;
    balterleySku?: string;
    title: string;
    brand: string;
    category?: string;
    familyVariants?: string;
    mrp: number;
    currentPrice: number;
    channelPrices?: ChannelPrices;
    discountPrice?: number;
    discountStartDate?: string;
    discountEndDate?: string;
    costPrice: number;
    deliveryCost: number;
    stockLevel: number;
    stockLastUpdated?: string;
    salesLast7Days: number;
    salesLast30Days: number;
    salesLastUpdated?: string;
    calculatedMargin?: number;
    calculatedProfit?: number;
    lastUpdated: string;
    lastSyncedFromSheet?: string;
    lastSyncedFromChannelEngine?: string;
}
/**
 * Per-channel pricing (for future multi-channel pricing)
 */
export interface ChannelPrices {
    amazon?: number;
    ebay?: number;
    bandq?: number;
    manomano?: number;
    shopify?: number;
}
/**
 * Product data as it comes from the Google Sheet
 */
export interface GoogleSheetProduct {
    brandName: string;
    productSku: string;
    balterleySku: string;
    familyVariants: string;
    mrp: number;
    bandqPricing: number;
    amazonPricing: number;
    ebayPricing: number;
    manoManoPricing: number;
    shopifyPricing: number;
    discountStartDate?: string;
    discountEndDate?: string;
    discountPrice?: number;
}
/**
 * Product cost data from CSV upload
 */
export interface ProductCostData {
    sku: string;
    costPrice: number;
    deliveryCost: number;
}
/**
 * Product data from ChannelEngine (full product details)
 */
export interface ChannelEngineProduct {
    merchantProductNo: string;
    name: string;
    description?: string;
    brand?: string;
    ean?: string;
    stock: number;
    price: number;
    categoryTrail?: string;
}
/**
 * Sales data from ChannelEngine
 */
export interface ChannelEngineSalesData {
    merchantProductNo: string;
    salesLast7Days: number;
    salesLast30Days: number;
}
/**
 * Summary stats for dashboard
 */
export interface ProductSummary {
    totalProducts: number;
    productsWithCosts: number;
    productsWithoutCosts: number;
    averageMargin: number;
    lowMarginCount: number;
    outOfStockCount: number;
    lowStockCount: number;
}
//# sourceMappingURL=product.d.ts.map