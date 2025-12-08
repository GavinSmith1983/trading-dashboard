import { google, sheets_v4 } from 'googleapis';
import { GoogleSheetProduct, Product } from '../types';

/**
 * Google Sheets service for reading pricing data
 */
export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;

  constructor(credentials: object, spreadsheetId: string, readOnly: boolean = true) {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [readOnly
        ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
        : 'https://www.googleapis.com/auth/spreadsheets'
      ],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = spreadsheetId;
  }

  /**
   * Fetch all products from the pricing sheet
   */
  async fetchProducts(sheetName: string = 'Sheet1'): Promise<GoogleSheetProduct[]> {
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
      .filter((row) => row[2]) // Must have Balterley SKU (Column C) - this is what we match against ChannelEngine SKUs
      .map((row) => this.parseRow(row, headers));
  }

  /**
   * Parse a single row into a GoogleSheetProduct
   * Only reads Column C (Balterley SKU) and Columns F-J (channel pricing)
   */
  private parseRow(row: string[], headers: string[]): GoogleSheetProduct {
    const getNumber = (index: number): number => {
      const val = row[index]?.replace(/[£$,]/g, '').trim();
      return parseFloat(val) || 0;
    };

    return {
      balterleySku: row[2]?.trim() || '',  // Column C
      bandqPricing: getNumber(5),           // Column F
      amazonPricing: getNumber(6),          // Column G
      ebayPricing: getNumber(7),            // Column H
      manoManoPricing: getNumber(8),        // Column I
      shopifyPricing: getNumber(9),         // Column J
    };
  }

  /**
   * Get sheet metadata to find available sheets
   */
  async getSheetNames(): Promise<string[]> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    return response.data.sheets?.map((s) => s.properties?.title || '') || [];
  }

  /**
   * Update prices for multiple SKUs in the sheet
   * Updates all channel price columns (B&Q, Amazon, eBay, ManoMano, Shopify) to the same price
   */
  async updatePrices(
    priceUpdates: Array<{ sku: string; price: number }>,
    sheetName: string = 'Pricing'
  ): Promise<{ updated: number; notFound: string[] }> {
    // First, fetch all rows to find SKU positions
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A:J`, // Columns A through J (up to Shopify pricing)
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return { updated: 0, notFound: priceUpdates.map(p => p.sku) };
    }

    // Build SKU to row index map (1-indexed for sheets, +1 for header)
    const skuToRow = new Map<string, number>();
    for (let i = 1; i < rows.length; i++) {
      const sku = rows[i][2]?.trim(); // Column C is Balterley SKU
      if (sku) {
        skuToRow.set(sku.toUpperCase(), i + 1); // +1 because sheets are 1-indexed, case-insensitive
      }
    }

    // Prepare batch update requests
    const updates: sheets_v4.Schema$ValueRange[] = [];
    const notFound: string[] = [];

    for (const { sku, price } of priceUpdates) {
      const rowNum = skuToRow.get(sku.toUpperCase());
      if (!rowNum) {
        notFound.push(sku);
        continue;
      }

      // Update columns F through J (B&Q, Amazon, eBay, ManoMano, Shopify) with same price
      // Column F = index 6 (0-based), but in A1 notation F is column 6
      updates.push({
        range: `${sheetName}!F${rowNum}:J${rowNum}`,
        values: [[price, price, price, price, price]],
      });
    }

    if (updates.length === 0) {
      return { updated: 0, notFound };
    }

    // Execute batch update
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });

    return { updated: updates.length, notFound };
  }

  /**
   * Update a single SKU's price (all channels)
   */
  async updatePrice(sku: string, price: number, sheetName: string = 'Sheet1'): Promise<boolean> {
    const result = await this.updatePrices([{ sku, price }], sheetName);
    return result.updated > 0;
  }

  /**
   * Update a single channel's price for a SKU
   * Channel columns: F=B&Q, G=Amazon, H=eBay, I=ManoMano, J=Shopify
   */
  async updateChannelPrice(
    sku: string,
    channelId: string,
    price: number,
    sheetName: string = 'Pricing'
  ): Promise<{ success: boolean; error?: string }> {
    // Map channel IDs to column letters
    const channelColumns: Record<string, string> = {
      bandq: 'F',
      amazon: 'G',
      ebay: 'H',      // Also used for OnBuy and Debenhams
      manomano: 'I',
      shopify: 'J',
    };

    const column = channelColumns[channelId.toLowerCase()];
    if (!column) {
      return { success: false, error: `Unknown channel: ${channelId}` };
    }

    // First, fetch all rows to find SKU position
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!C:C`, // Just column C (Balterley SKU)
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return { success: false, error: 'Sheet is empty or has no data' };
    }

    // Find the row for this SKU (case-insensitive)
    let rowNum: number | null = null;
    for (let i = 1; i < rows.length; i++) {
      const rowSku = rows[i][0]?.trim();
      if (rowSku && rowSku.toUpperCase() === sku.toUpperCase()) {
        rowNum = i + 1; // +1 because sheets are 1-indexed
        break;
      }
    }

    if (!rowNum) {
      return { success: false, error: `SKU not found in sheet: ${sku}` };
    }

    // Update the specific cell
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!${column}${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[price]],
      },
    });

    return { success: true };
  }
}

/**
 * Factory function to create GoogleSheetsService from AWS Secrets
 * @param secretArn - ARN of the secret containing Google credentials
 * @param readOnly - Whether to use read-only access (default: true)
 */
export async function createGoogleSheetsService(
  secretArn: string,
  readOnly: boolean = true
): Promise<GoogleSheetsService> {
  // Import dynamically to avoid bundling issues
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('Google Sheets secret not found');
  }

  const secret = JSON.parse(response.SecretString);
  const credentials = JSON.parse(secret.credentials);

  return new GoogleSheetsService(credentials, secret.spreadsheetId, readOnly);
}
