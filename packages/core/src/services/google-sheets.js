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
exports.GoogleSheetsService = void 0;
exports.createGoogleSheetsService = createGoogleSheetsService;
const googleapis_1 = require("googleapis");
/**
 * Google Sheets service for reading pricing data
 */
class GoogleSheetsService {
    sheets;
    spreadsheetId;
    constructor(credentials, spreadsheetId) {
        const auth = new googleapis_1.google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        this.sheets = googleapis_1.google.sheets({ version: 'v4', auth });
        this.spreadsheetId = spreadsheetId;
    }
    /**
     * Fetch all products from the pricing sheet
     */
    async fetchProducts(sheetName = 'Sheet1') {
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${sheetName}!A:O`, // Columns A through O based on sheet structure
        });
        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            return [];
        }
        // First row is headers
        const headers = rows[0];
        const dataRows = rows.slice(1);
        return dataRows
            .filter((row) => row[1]) // Must have SKU
            .map((row) => this.parseRow(row, headers));
    }
    /**
     * Parse a single row into a GoogleSheetProduct
     */
    parseRow(row, headers) {
        const getValue = (index) => row[index]?.trim() || '';
        const getNumber = (index) => {
            const val = row[index]?.replace(/[£$,]/g, '').trim();
            return parseFloat(val) || 0;
        };
        // Map columns based on known sheet structure
        // Columns: Brand Name, Product SKU, Balterley SKU, Family Variants, MRP,
        //          B&Q Pricing, Amazon Pricing, eBay Pricing, ManoMano Pricing, Shopify Pricing,
        //          (empty), discount-start-date, discount-end-date, discount-price
        return {
            brandName: getValue(0),
            productSku: getValue(1),
            balterleySku: getValue(2),
            familyVariants: getValue(3),
            mrp: getNumber(4),
            bandqPricing: getNumber(5),
            amazonPricing: getNumber(6),
            ebayPricing: getNumber(7),
            manoManoPricing: getNumber(8),
            shopifyPricing: getNumber(9),
            discountStartDate: getValue(11) || undefined,
            discountEndDate: getValue(12) || undefined,
            discountPrice: getNumber(13) || undefined,
        };
    }
    /**
     * Transform Google Sheet product to internal Product format
     * Note: Cost and delivery data must be merged from separate sources
     */
    static toProduct(sheetProduct) {
        // For unified pricing, use Amazon price as the base (most common)
        // or calculate average of non-zero prices
        const prices = [
            sheetProduct.amazonPricing,
            sheetProduct.ebayPricing,
            sheetProduct.bandqPricing,
            sheetProduct.manoManoPricing,
            sheetProduct.shopifyPricing,
        ].filter((p) => p > 0);
        const currentPrice = prices.length > 0 ? prices[0] : sheetProduct.mrp;
        return {
            sku: sheetProduct.productSku,
            balterleySku: sheetProduct.balterleySku || undefined,
            title: sheetProduct.productSku, // Will be enriched from ChannelEngine
            brand: sheetProduct.brandName,
            familyVariants: sheetProduct.familyVariants || undefined,
            mrp: sheetProduct.mrp,
            currentPrice,
            channelPrices: {
                amazon: sheetProduct.amazonPricing || undefined,
                ebay: sheetProduct.ebayPricing || undefined,
                bandq: sheetProduct.bandqPricing || undefined,
                manomano: sheetProduct.manoManoPricing || undefined,
                shopify: sheetProduct.shopifyPricing || undefined,
            },
            discountPrice: sheetProduct.discountPrice || undefined,
            discountStartDate: sheetProduct.discountStartDate || undefined,
            discountEndDate: sheetProduct.discountEndDate || undefined,
            lastSyncedFromSheet: new Date().toISOString(),
        };
    }
    /**
     * Get sheet metadata to find available sheets
     */
    async getSheetNames() {
        const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.spreadsheetId,
        });
        return response.data.sheets?.map((s) => s.properties?.title || '') || [];
    }
}
exports.GoogleSheetsService = GoogleSheetsService;
/**
 * Factory function to create GoogleSheetsService from AWS Secrets
 */
async function createGoogleSheetsService(secretArn) {
    // Import dynamically to avoid bundling issues
    const { SecretsManagerClient, GetSecretValueCommand } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/client-secrets-manager')));
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!response.SecretString) {
        throw new Error('Google Sheets secret not found');
    }
    const secret = JSON.parse(response.SecretString);
    const credentials = JSON.parse(secret.credentials);
    return new GoogleSheetsService(credentials, secret.spreadsheetId);
}
//# sourceMappingURL=google-sheets.js.map