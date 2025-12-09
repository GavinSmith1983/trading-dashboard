/**
 * Migration Script: V1 to V2 Multi-Tenant
 *
 * This script migrates existing KU Bathrooms data from V1 tables to V2 tables
 * with the accountId field added for multi-tenant support.
 *
 * Usage:
 *   npx ts-node scripts/migrate-v1-to-v2.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Preview migration without writing to V2 tables
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

// Configuration
const ACCOUNT_ID = 'ku-bathrooms';
const ACCOUNT_NAME = 'KU Bathrooms';
const DRY_RUN = process.argv.includes('--dry-run');

// V1 table names
const V1_TABLES = {
  products: 'repricing-products',
  rules: 'repricing-rules',
  proposals: 'repricing-proposals',
  channels: 'repricing-channels',
  orders: 'repricing-orders',
  orderLines: 'repricing-order-lines',
  carrierCosts: 'repricing-carrier-costs',
  skuHistory: 'repricing-sku-history',
};

// V2 table names
const V2_TABLES = {
  accounts: 'repricing-v2-accounts',
  products: 'repricing-v2-products',
  rules: 'repricing-v2-rules',
  proposals: 'repricing-v2-proposals',
  channels: 'repricing-v2-channels',
  orders: 'repricing-v2-orders',
  orderLines: 'repricing-v2-order-lines',
  carrierCosts: 'repricing-v2-carrier-costs',
  skuHistory: 'repricing-v2-sku-history',
};

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: 'eu-west-2' });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Scan all items from a table
 */
async function scanTable(tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
      })
    );

    if (result.Items) {
      items.push(...(result.Items as Record<string, unknown>[]));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Batch write items to a table
 */
async function batchWrite(
  tableName: string,
  items: Record<string, unknown>[]
): Promise<void> {
  // DynamoDB batch write limit is 25 items
  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    chunks.push(items.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );
  }
}

/**
 * Create the KU Bathrooms account in V2
 */
async function createAccount(): Promise<void> {
  console.log('\n📝 Creating account record...');

  const account = {
    accountId: ACCOUNT_ID,
    name: ACCOUNT_NAME,
    status: 'active',
    channelEngine: {
      apiKey: process.env.KU_CHANNEL_ENGINE_API_KEY || '', // Will be configured manually via admin UI
      tenantId: process.env.KU_CHANNEL_ENGINE_TENANT_ID || '',
    },
    googleSheets: {
      spreadsheetId: '1scr_yS-9U6x4zTN9HG3emptsqt8phQgDjYeNygB8Cs8',
      columnMapping: {
        skuColumn: 'C',
        pricingMode: 'multi',
        channelPriceColumns: {
          bnq: 'F',
          amazon: 'G',
          ebay: 'H',
          manomano: 'I',
          shopify: 'J',
        },
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'migration-script',
  };

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would create account:', account.accountId);
  } else {
    await docClient.send(
      new PutCommand({
        TableName: V2_TABLES.accounts,
        Item: account,
      })
    );
    console.log('  ✅ Created account:', account.accountId);
  }
}

/**
 * Migrate products table
 */
async function migrateProducts(): Promise<number> {
  console.log('\n📦 Migrating products...');

  const items = await scanTable(V1_TABLES.products);
  console.log(`  Found ${items.length} products`);

  const v2Items = items.map((item) => ({
    ...item,
    accountId: ACCOUNT_ID,
  }));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would migrate ${v2Items.length} products`);
  } else {
    await batchWrite(V2_TABLES.products, v2Items);
    console.log(`  ✅ Migrated ${v2Items.length} products`);
  }

  return v2Items.length;
}

/**
 * Migrate pricing rules table
 */
async function migrateRules(): Promise<number> {
  console.log('\n📋 Migrating pricing rules...');

  const items = await scanTable(V1_TABLES.rules);
  console.log(`  Found ${items.length} rules`);

  const v2Items = items.map((item) => ({
    ...item,
    accountId: ACCOUNT_ID,
  }));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would migrate ${v2Items.length} rules`);
  } else {
    await batchWrite(V2_TABLES.rules, v2Items);
    console.log(`  ✅ Migrated ${v2Items.length} rules`);
  }

  return v2Items.length;
}

/**
 * Migrate proposals table
 */
async function migrateProposals(): Promise<number> {
  console.log('\n💡 Migrating proposals...');

  const items = await scanTable(V1_TABLES.proposals);
  console.log(`  Found ${items.length} proposals`);

  const v2Items = items.map((item) => ({
    ...item,
    accountId: ACCOUNT_ID,
  }));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would migrate ${v2Items.length} proposals`);
  } else {
    await batchWrite(V2_TABLES.proposals, v2Items);
    console.log(`  ✅ Migrated ${v2Items.length} proposals`);
  }

  return v2Items.length;
}

/**
 * Migrate channels table
 */
async function migrateChannels(): Promise<number> {
  console.log('\n🏪 Migrating channels...');

  const items = await scanTable(V1_TABLES.channels);
  console.log(`  Found ${items.length} channels`);

  const v2Items = items.map((item) => ({
    ...item,
    accountId: ACCOUNT_ID,
  }));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would migrate ${v2Items.length} channels`);
  } else {
    await batchWrite(V2_TABLES.channels, v2Items);
    console.log(`  ✅ Migrated ${v2Items.length} channels`);
  }

  return v2Items.length;
}

/**
 * Migrate orders table
 */
async function migrateOrders(): Promise<number> {
  console.log('\n📄 Migrating orders...');

  const items = await scanTable(V1_TABLES.orders);
  console.log(`  Found ${items.length} orders`);

  const v2Items = items.map((item) => ({
    ...item,
    accountId: ACCOUNT_ID,
  }));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would migrate ${v2Items.length} orders`);
  } else {
    await batchWrite(V2_TABLES.orders, v2Items);
    console.log(`  ✅ Migrated ${v2Items.length} orders`);
  }

  return v2Items.length;
}

/**
 * Migrate order lines table
 */
async function migrateOrderLines(): Promise<number> {
  console.log('\n📝 Migrating order lines...');

  const items = await scanTable(V1_TABLES.orderLines);
  console.log(`  Found ${items.length} order lines`);

  // V2 uses composite sort key: skuOrderDate
  const v2Items = items.map((item) => ({
    ...item,
    accountId: ACCOUNT_ID,
    skuOrderDate: `${item.sku}#${item.orderDate}#${item.orderId}`,
  }));

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would migrate ${v2Items.length} order lines`);
  } else {
    await batchWrite(V2_TABLES.orderLines, v2Items);
    console.log(`  ✅ Migrated ${v2Items.length} order lines`);
  }

  return v2Items.length;
}

/**
 * Migrate carrier costs table
 */
async function migrateCarrierCosts(): Promise<number> {
  console.log('\n🚚 Migrating carrier costs...');

  try {
    const items = await scanTable(V1_TABLES.carrierCosts);
    console.log(`  Found ${items.length} carrier costs`);

    const v2Items = items.map((item) => ({
      ...item,
      accountId: ACCOUNT_ID,
    }));

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would migrate ${v2Items.length} carrier costs`);
    } else {
      await batchWrite(V2_TABLES.carrierCosts, v2Items);
      console.log(`  ✅ Migrated ${v2Items.length} carrier costs`);
    }

    return v2Items.length;
  } catch (error) {
    console.log('  ⚠️ Carrier costs table not found or empty, skipping');
    return 0;
  }
}

/**
 * Migrate SKU history table
 */
async function migrateSkuHistory(): Promise<number> {
  console.log('\n📈 Migrating SKU history...');

  try {
    const items = await scanTable(V1_TABLES.skuHistory);
    console.log(`  Found ${items.length} history records`);

    // V2 uses composite sort key: skuDate
    const v2Items = items.map((item) => ({
      ...item,
      accountId: ACCOUNT_ID,
      skuDate: `${item.sku}#${item.date}`,
    }));

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would migrate ${v2Items.length} history records`);
    } else {
      await batchWrite(V2_TABLES.skuHistory, v2Items);
      console.log(`  ✅ Migrated ${v2Items.length} history records`);
    }

    return v2Items.length;
  } catch (error) {
    console.log('  ⚠️ SKU history table not found or empty, skipping');
    return 0;
  }
}

/**
 * Main migration function
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  V1 to V2 Multi-Tenant Migration');
  console.log('  Account: ' + ACCOUNT_ID + ' (' + ACCOUNT_NAME + ')');
  console.log('═══════════════════════════════════════════════════════════════');

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN MODE - No data will be written\n');
  }

  const startTime = Date.now();
  const counts = {
    products: 0,
    rules: 0,
    proposals: 0,
    channels: 0,
    orders: 0,
    orderLines: 0,
    carrierCosts: 0,
    skuHistory: 0,
  };

  try {
    // Create account first
    await createAccount();

    // Migrate all tables
    counts.products = await migrateProducts();
    counts.rules = await migrateRules();
    counts.proposals = await migrateProposals();
    counts.channels = await migrateChannels();
    counts.orders = await migrateOrders();
    counts.orderLines = await migrateOrderLines();
    counts.carrierCosts = await migrateCarrierCosts();
    counts.skuHistory = await migrateSkuHistory();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Migration Summary');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Products:      ${counts.products.toLocaleString()}`);
    console.log(`  Rules:         ${counts.rules.toLocaleString()}`);
    console.log(`  Proposals:     ${counts.proposals.toLocaleString()}`);
    console.log(`  Channels:      ${counts.channels.toLocaleString()}`);
    console.log(`  Orders:        ${counts.orders.toLocaleString()}`);
    console.log(`  Order Lines:   ${counts.orderLines.toLocaleString()}`);
    console.log(`  Carrier Costs: ${counts.carrierCosts.toLocaleString()}`);
    console.log(`  SKU History:   ${counts.skuHistory.toLocaleString()}`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  Total Records: ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString()}`);
    console.log(`  Duration:      ${duration}s`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (DRY_RUN) {
      console.log('\n✅ Dry run complete. Run without --dry-run to perform migration.\n');
    } else {
      console.log('\n✅ Migration complete!\n');
      console.log('Next steps:');
      console.log('  1. Configure ChannelEngine API key via admin UI');
      console.log('  2. Add users and assign them to the account');
      console.log('  3. Test the V2 system thoroughly');
      console.log('  4. Transition users from V1 to V2\n');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
main();
