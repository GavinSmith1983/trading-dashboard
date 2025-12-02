import { GoogleSheetProduct, Product } from '../types';
/**
 * Google Sheets service for reading pricing data
 */
export declare class GoogleSheetsService {
    private sheets;
    private spreadsheetId;
    constructor(credentials: object, spreadsheetId: string);
    /**
     * Fetch all products from the pricing sheet
     */
    fetchProducts(sheetName?: string): Promise<GoogleSheetProduct[]>;
    /**
     * Parse a single row into a GoogleSheetProduct
     */
    private parseRow;
    /**
     * Transform Google Sheet product to internal Product format
     * Note: Cost and delivery data must be merged from separate sources
     */
    static toProduct(sheetProduct: GoogleSheetProduct): Partial<Product>;
    /**
     * Get sheet metadata to find available sheets
     */
    getSheetNames(): Promise<string[]>;
}
/**
 * Factory function to create GoogleSheetsService from AWS Secrets
 */
export declare function createGoogleSheetsService(secretArn: string): Promise<GoogleSheetsService>;
//# sourceMappingURL=google-sheets.d.ts.map