"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelEngineService = void 0;
exports.createChannelEngineService = createChannelEngineService;
/**
 * ChannelEngine service for inventory and sales data
 */
class ChannelEngineService {
    apiKey;
    tenantId;
    baseUrl;
    constructor(config) {
        this.apiKey = config.apiKey;
        this.tenantId = config.tenantId;
        this.baseUrl = config.baseUrl || 'https://api.channelengine.net/api/v2';
    }
    /**
     * Make authenticated request to ChannelEngine API
     * Authentication is via apikey query parameter (not header)
     */
    async request(endpoint, method = 'GET', body, queryParams = {}) {
        // Add API key to query parameters (ChannelEngine's authentication method)
        const params = new URLSearchParams();
        params.set('apikey', this.apiKey);
        for (const [key, value] of Object.entries(queryParams)) {
            params.set(key, String(value));
        }
        const url = `${this.baseUrl}${endpoint}?${params.toString()}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ChannelEngine API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        return response.json();
    }
    /**
     * Fetch all products with full details (stock, price, name, brand, etc.)
     * Calls onBatch callback after each page to allow incremental processing/saving
     */
    async fetchProducts(onBatch) {
        const allProducts = [];
        let page = 1;
        const pageSize = 100;
        let hasMore = true;
        let totalCount = 0;
        console.log(`[CE] Starting product fetch from ${this.baseUrl}/products`);
        while (hasMore) {
            console.log(`[CE] Fetching page ${page}...`);
            try {
                const response = await this.request('/products', 'GET', undefined, { page, pageSize });
                totalCount = response.TotalCount || totalCount;
                if (response.Content && response.Content.length > 0) {
                    const batchProducts = [];
                    for (const product of response.Content) {
                        batchProducts.push({
                            merchantProductNo: product.MerchantProductNo,
                            name: product.Name,
                            description: product.Description,
                            brand: product.Brand,
                            ean: product.Ean,
                            stock: product.Stock,
                            price: product.Price,
                            categoryTrail: product.CategoryTrail,
                        });
                    }
                    allProducts.push(...batchProducts);
                    console.log(`[CE] Page ${page}: Got ${batchProducts.length} products (${allProducts.length}/${totalCount})`);
                    // Call batch callback to save immediately
                    if (onBatch) {
                        await onBatch(batchProducts, page, totalCount);
                    }
                    page++;
                    hasMore = response.Content.length === pageSize;
                }
                else {
                    console.log(`[CE] Page ${page}: No more products`);
                    hasMore = false;
                }
            }
            catch (error) {
                console.error(`[CE] Error fetching page ${page}:`, error);
                throw error;
            }
        }
        console.log(`[CE] Completed: Fetched ${allProducts.length} total products`);
        return allProducts;
    }
    /**
     * Fetch sales data for products over a date range
     */
    async fetchSalesData(fromDate, toDate) {
        const salesMap = new Map();
        let page = 1;
        const pageSize = 100;
        let hasMore = true;
        const fromStr = fromDate.toISOString();
        const toStr = toDate.toISOString();
        while (hasMore) {
            const response = await this.request('/orders', 'GET', undefined, { fromDate: fromStr, toDate: toStr, page, pageSize });
            if (response.Content && response.Content.length > 0) {
                for (const order of response.Content) {
                    if (order.Lines) {
                        for (const line of order.Lines) {
                            const existing = salesMap.get(line.MerchantProductNo) || {
                                quantity: 0,
                                revenue: 0,
                            };
                            existing.quantity += line.Quantity;
                            existing.revenue += line.UnitPriceInclVat * line.Quantity;
                            salesMap.set(line.MerchantProductNo, existing);
                        }
                    }
                }
                page++;
                hasMore = response.Content.length === pageSize;
            }
            else {
                hasMore = false;
            }
        }
        return salesMap;
    }
    /**
     * Calculate sales metrics for last 7 and 30 days
     */
    async fetchSalesMetrics() {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const [sales7Days, sales30Days] = await Promise.all([
            this.fetchSalesData(sevenDaysAgo, now),
            this.fetchSalesData(thirtyDaysAgo, now),
        ]);
        // Combine all SKUs from both periods
        const allSkus = new Set([...sales7Days.keys(), ...sales30Days.keys()]);
        return Array.from(allSkus).map((sku) => ({
            merchantProductNo: sku,
            salesLast7Days: sales7Days.get(sku)?.quantity || 0,
            salesLast30Days: sales30Days.get(sku)?.quantity || 0,
        }));
    }
    /**
     * Fetch all orders from a given date with incremental batch processing
     * @param fromDate Start date to fetch orders from
     * @param onBatch Callback called after each page for incremental saving
     */
    async fetchOrders(fromDate, onBatch) {
        const allOrders = [];
        let page = 1;
        const pageSize = 100;
        let hasMore = true;
        let totalCount = 0;
        const fromStr = fromDate.toISOString();
        console.log(`[CE] Starting order fetch from ${fromStr}`);
        while (hasMore) {
            console.log(`[CE] Fetching orders page ${page}...`);
            try {
                const response = await this.request('/orders', 'GET', undefined, { fromDate: fromStr, page, pageSize });
                totalCount = response.TotalCount || totalCount;
                if (response.Content && response.Content.length > 0) {
                    allOrders.push(...response.Content);
                    console.log(`[CE] Page ${page}: Got ${response.Content.length} orders (${allOrders.length}/${totalCount})`);
                    // Call batch callback to save immediately
                    if (onBatch) {
                        await onBatch(response.Content, page, totalCount);
                    }
                    page++;
                    hasMore = response.Content.length === pageSize;
                }
                else {
                    console.log(`[CE] Page ${page}: No more orders`);
                    hasMore = false;
                }
            }
            catch (error) {
                console.error(`[CE] Error fetching orders page ${page}:`, error);
                throw error;
            }
        }
        console.log(`[CE] Completed: Fetched ${allOrders.length} total orders`);
        return allOrders;
    }
    /**
     * Update product prices in ChannelEngine
     */
    async updatePrices(updates) {
        const errors = [];
        // ChannelEngine API typically accepts batch updates
        // Update in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < updates.length; i += chunkSize) {
            const chunk = updates.slice(i, i + chunkSize);
            try {
                const payload = chunk.map((u) => ({
                    MerchantProductNo: u.merchantProductNo,
                    Price: u.price,
                }));
                const response = await this.request('/products/bulk', 'PUT', payload);
                if (!response.Success) {
                    errors.push(`Batch ${i / chunkSize + 1}: ${response.Message}`);
                }
            }
            catch (error) {
                errors.push(`Batch ${i / chunkSize + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        return {
            success: errors.length === 0,
            errors,
        };
    }
    /**
     * Update stock levels in ChannelEngine
     */
    async updateStock(updates) {
        const errors = [];
        const chunkSize = 100;
        for (let i = 0; i < updates.length; i += chunkSize) {
            const chunk = updates.slice(i, i + chunkSize);
            try {
                const payload = chunk.map((u) => ({
                    MerchantProductNo: u.merchantProductNo,
                    Stock: u.stock,
                }));
                const response = await this.request('/offer/stock', 'PUT', payload);
                if (!response.Success) {
                    errors.push(`Batch ${i / chunkSize + 1}: ${response.Message}`);
                }
            }
            catch (error) {
                errors.push(`Batch ${i / chunkSize + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        return {
            success: errors.length === 0,
            errors,
        };
    }
}
exports.ChannelEngineService = ChannelEngineService;
/**
 * Factory function to create ChannelEngineService from AWS Secrets
 */
async function createChannelEngineService(secretArn) {
    const { SecretsManagerClient, GetSecretValueCommand } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/client-secrets-manager')));
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!response.SecretString) {
        throw new Error('ChannelEngine secret not found');
    }
    const secret = JSON.parse(response.SecretString);
    return new ChannelEngineService({
        apiKey: secret.apiKey,
        tenantId: secret.tenantId,
        baseUrl: secret.baseUrl,
    });
}
//# sourceMappingURL=channel-engine.js.map