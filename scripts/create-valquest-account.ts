/**
 * Create Valquest Account in V2
 *
 * This script creates the Valquest account with the correct Google Sheets column mapping.
 *
 * Usage:
 *   npx ts-node scripts/create-valquest-account.ts
 *
 * Environment variables (optional):
 *   VALQUEST_SPREADSHEET_ID - Google Sheets spreadsheet ID
 *   VALQUEST_CHANNEL_ENGINE_API_KEY - ChannelEngine API key
 *   VALQUEST_CHANNEL_ENGINE_TENANT_ID - ChannelEngine tenant ID
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// Configuration
const ACCOUNT_ID = 'valquest';
const ACCOUNT_NAME = 'Valquest';
const V2_ACCOUNTS_TABLE = 'repricing-v2-accounts';

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: 'eu-west-2' });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Create Valquest Account');
  console.log('═══════════════════════════════════════════════════════════════');

  // Check if account already exists
  const existing = await docClient.send(
    new GetCommand({
      TableName: V2_ACCOUNTS_TABLE,
      Key: { accountId: ACCOUNT_ID },
    })
  );

  if (existing.Item) {
    console.log('\n⚠️  Account already exists. Updating...\n');
  }

  const account = {
    accountId: ACCOUNT_ID,
    name: ACCOUNT_NAME,
    status: 'active',
    channelEngine: {
      apiKey: process.env.VALQUEST_CHANNEL_ENGINE_API_KEY || '',
      tenantId: process.env.VALQUEST_CHANNEL_ENGINE_TENANT_ID || '',
    },
    googleSheets: {
      spreadsheetId: process.env.VALQUEST_SPREADSHEET_ID || '',
      columnMapping: {
        skuColumn: 'A',
        pricingMode: 'single',
        priceColumn: 'D',
        startRow: 2,
      },
    },
    settings: {
      channelFees: {
        shopify: 0.15,
        amazon: 0.2,
        ebay: 0.2,
        manomano: 0.2,
        bandq: 0.2,
      },
      defaultMargin: 0.25,
      currency: 'GBP',
    },
    createdAt: existing.Item?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: existing.Item?.createdBy || 'setup-script',
  };

  await docClient.send(
    new PutCommand({
      TableName: V2_ACCOUNTS_TABLE,
      Item: account,
    })
  );

  console.log('\n✅ Valquest account created/updated successfully!\n');
  console.log('Account Configuration:');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  Account ID:       ${account.accountId}`);
  console.log(`  Name:             ${account.name}`);
  console.log(`  Status:           ${account.status}`);
  console.log(`  Spreadsheet ID:   ${account.googleSheets.spreadsheetId || '(not set)'}`);
  console.log(`  SKU Column:       ${account.googleSheets.columnMapping.skuColumn}`);
  console.log(`  Pricing Mode:     ${account.googleSheets.columnMapping.pricingMode}`);
  console.log(`  Price Column:     ${account.googleSheets.columnMapping.priceColumn}`);
  console.log(`  Start Row:        ${account.googleSheets.columnMapping.startRow}`);
  console.log(`  ChannelEngine:    ${account.channelEngine.apiKey ? 'Configured' : '(not set)'}`);
  console.log('───────────────────────────────────────────────────────────────');

  if (!account.googleSheets.spreadsheetId || !account.channelEngine.apiKey) {
    console.log('\n⚠️  Next steps:');
    if (!account.googleSheets.spreadsheetId) {
      console.log('  - Set VALQUEST_SPREADSHEET_ID and re-run, or update via admin UI');
    }
    if (!account.channelEngine.apiKey) {
      console.log('  - Set VALQUEST_CHANNEL_ENGINE_API_KEY and VALQUEST_CHANNEL_ENGINE_TENANT_ID');
      console.log('    and re-run, or update via admin UI');
    }
  }

  console.log('\n');
}

main().catch(console.error);
