import { ChannelEngineProduct, ChannelEngineSalesData, ChannelEngineOrder } from '../types';
/**
 * ChannelEngine API configuration
 */
interface ChannelEngineConfig {
    apiKey: string;
    tenantId: string;
    baseUrl?: string;
}
/**
 * ChannelEngine service for inventory and sales data
 */
export declare class ChannelEngineService {
    private apiKey;
    private tenantId;
    private baseUrl;
    constructor(config: ChannelEngineConfig);
    /**
     * Make authenticated request to ChannelEngine API
     * Authentication is via apikey query parameter (not header)
     */
    private request;
    /**
     * Fetch all products with full details (stock, price, name, brand, etc.)
     * Calls onBatch callback after each page to allow incremental processing/saving
     */
    fetchProducts(onBatch?: (products: ChannelEngineProduct[], page: number, total: number) => Promise<void>): Promise<ChannelEngineProduct[]>;
    /**
     * Fetch sales data for products over a date range
     */
    fetchSalesData(fromDate: Date, toDate: Date): Promise<Map<string, {
        quantity: number;
        revenue: number;
    }>>;
    /**
     * Calculate sales metrics for last 7 and 30 days
     */
    fetchSalesMetrics(): Promise<ChannelEngineSalesData[]>;
    /**
     * Fetch all orders from a given date with incremental batch processing
     * @param fromDate Start date to fetch orders from
     * @param onBatch Callback called after each page for incremental saving
     */
    fetchOrders(fromDate: Date, onBatch?: (orders: ChannelEngineOrder[], page: number, total: number) => Promise<void>): Promise<ChannelEngineOrder[]>;
    /**
     * Update product prices in ChannelEngine
     */
    updatePrices(updates: Array<{
        merchantProductNo: string;
        price: number;
    }>): Promise<{
        success: boolean;
        errors: string[];
    }>;
    /**
     * Update stock levels in ChannelEngine
     */
    updateStock(updates: Array<{
        merchantProductNo: string;
        stock: number;
    }>): Promise<{
        success: boolean;
        errors: string[];
    }>;
}
/**
 * Factory function to create ChannelEngineService from AWS Secrets
 */
export declare function createChannelEngineService(secretArn: string): Promise<ChannelEngineService>;
export {};
//# sourceMappingURL=channel-engine.d.ts.map