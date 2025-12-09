#!/usr/bin/env npx ts-node
/**
 * Backfill Orders Script for V2 Multi-Tenant System
 *
 * Usage: npx ts-node scripts/backfill-orders-v2.ts <accountId> <fromDate> [toDate]
 * Example: npx ts-node scripts/backfill-orders-v2.ts valquest-usa 2025-05-01 2025-12-09
 */

import {
  DynamoDBClient,
  QueryCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const REGION = 'eu-west-2';

// Table names
const ACCOUNTS_TABLE = 'repricing-v2-accounts';
const ORDERS_TABLE = 'repricing-v2-orders';
const ORDER_LINES_TABLE = 'repricing-v2-order-lines';

interface Account {
  accountId: string;
  name: string;
  channelEngine: {
    apiKey: string;
    tenantId: string;
  };
}

interface OrderLine {
  sku: string;
  skuOrderDate: string; // Composite sort key: "SKU#2024-01-15T10:30:00Z#orderId"
  orderId: string;
  orderDateDay: string;
  channelName: string;
  channelId: number;
  quantity: number;
  unitPriceInclVat: number;
  unitPriceExclVat: number;
  lineTotalInclVat: number;
  lineTotalExclVat: number;
  lineVat: number;
  vatRate: number;
  description: string;
  gtin?: string;
  syncedAt: string;
}

interface Order {
  orderId: string;
  channelOrderNo: string;
  channelName: string;
  channelId: number;
  orderDate: string;
  orderDateDay: string;
  status: string;
  subTotalInclVat: number;
  subTotalExclVat: number;
  totalVat: number;
  shippingCostsInclVat: number;
  totalInclVat: number;
  totalFee: number;
  currencyCode: string;
  lines: any[];
  syncedAt: string;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx ts-node scripts/backfill-orders-v2.ts <accountId> <fromDate> [toDate]');
    console.error('Example: npx ts-node scripts/backfill-orders-v2.ts valquest-usa 2025-05-01');
    process.exit(1);
  }

  const accountId = args[0];
  const fromDateStr = args[1];
  const toDateStr = args[2] || new Date().toISOString().substring(0, 10);

  console.log('='.repeat(60));
  console.log('V2 Order Backfill Script');
  console.log('='.repeat(60));
  console.log(`Account ID: ${accountId}`);
  console.log(`From Date: ${fromDateStr}`);
  console.log(`To Date: ${toDateStr}`);
  console.log('='.repeat(60));

  // Initialize DynamoDB client
  const client = new DynamoDBClient({ region: REGION });
  const docClient = DynamoDBDocumentClient.from(client);

  // Get account configuration
  console.log('\nFetching account configuration...');
  const account = await getAccount(docClient, accountId);

  if (!account) {
    console.error(`Account not found: ${accountId}`);
    process.exit(1);
  }

  if (!account.channelEngine?.apiKey || !account.channelEngine?.tenantId) {
    console.error('ChannelEngine not configured for this account');
    process.exit(1);
  }

  console.log(`Account: ${account.name}`);
  console.log(`Tenant: ${account.channelEngine.tenantId}`);

  // Fetch orders in monthly chunks to avoid timeouts
  const fromDate = new Date(fromDateStr);
  const toDate = new Date(toDateStr);

  let totalOrders = 0;
  let totalOrderLines = 0;

  // Process month by month
  let currentStart = new Date(fromDate);

  while (currentStart < toDate) {
    // Calculate end of current chunk (1 month or toDate, whichever is earlier)
    const currentEnd = new Date(currentStart);
    currentEnd.setMonth(currentEnd.getMonth() + 1);
    if (currentEnd > toDate) {
      currentEnd.setTime(toDate.getTime());
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Fetching orders: ${currentStart.toISOString().substring(0, 10)} to ${currentEnd.toISOString().substring(0, 10)}`);
    console.log('─'.repeat(60));

    const { orders, orderLines } = await fetchAndSaveOrders(
      docClient,
      account,
      currentStart,
      currentEnd
    );

    totalOrders += orders;
    totalOrderLines += orderLines;

    // Move to next month
    currentStart = new Date(currentEnd);
  }

  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total Orders: ${totalOrders}`);
  console.log(`Total Order Lines: ${totalOrderLines}`);
}

async function getAccount(docClient: DynamoDBDocumentClient, accountId: string): Promise<Account | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ACCOUNTS_TABLE,
      KeyConditionExpression: 'accountId = :accountId',
      ExpressionAttributeValues: marshall({ ':accountId': accountId }),
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0];
  return {
    accountId: item.accountId?.S || '',
    name: item.name?.S || '',
    channelEngine: {
      apiKey: item.channelEngine?.M?.apiKey?.S || '',
      tenantId: item.channelEngine?.M?.tenantId?.S || '',
    },
  };
}

async function fetchAndSaveOrders(
  docClient: DynamoDBDocumentClient,
  account: Account,
  fromDate: Date,
  toDate: Date
): Promise<{ orders: number; orderLines: number }> {
  const accountId = account.accountId;
  const tenantId = account.channelEngine.tenantId;
  const baseUrl = `https://${tenantId}.channelengine.net/api/v2`;

  // Fetch all orders from ChannelEngine
  const allOrders: any[] = [];
  let page = 1;
  const pageSize = 100;

  const fromDateStr = fromDate.toISOString();
  const toDateStr = toDate.toISOString();

  while (true) {
    const url = new URL(`${baseUrl}/orders`);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('pageSize', pageSize.toString());
    url.searchParams.set('fromDate', fromDateStr);
    url.searchParams.set('toDate', toDateStr);

    // Retry logic
    let response: Response | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        response = await fetch(url.toString(), {
          headers: {
            'X-CE-KEY': account.channelEngine.apiKey,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error as Error;
        console.warn(`  Attempt ${attempt}/5 failed: ${lastError.message}`);
        if (attempt < 5) {
          // Wait before retry (exponential backoff: 2s, 4s, 8s, 16s)
          const delay = 2000 * Math.pow(2, attempt - 1);
          console.log(`  Waiting ${delay/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Failed to fetch after 3 attempts');
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`ChannelEngine API error: ${response.status} - ${errorText}`);
      throw new Error(`ChannelEngine API error: ${response.status}`);
    }

    const data = (await response.json()) as { Content?: any[]; TotalCount?: number };
    const orders = data.Content || [];
    const totalCount = data.TotalCount || 0;

    allOrders.push(...orders);
    console.log(`  Page ${page}: ${orders.length} orders (${allOrders.length}/${totalCount} total)`);

    if (orders.length < pageSize || allOrders.length >= totalCount) {
      break;
    }

    page++;

    // Small delay between pages to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (allOrders.length === 0) {
    console.log('  No orders found in this period');
    return { orders: 0, orderLines: 0 };
  }

  const timestamp = new Date().toISOString();

  // Transform orders
  const transformedOrders: Order[] = allOrders.map((ceOrder) => ({
    orderId: ceOrder.ChannelOrderNo || ceOrder.MerchantOrderNo,
    channelOrderNo: ceOrder.ChannelOrderNo || ceOrder.MerchantOrderNo,
    channelName: ceOrder.ChannelName || 'Unknown',
    channelId: ceOrder.ChannelId || 0,
    orderDate: ceOrder.OrderDate || timestamp,
    orderDateDay: (ceOrder.OrderDate || timestamp).substring(0, 10),
    status: ceOrder.Status || 'NEW',
    subTotalInclVat: ceOrder.SubTotalInclVat || 0,
    subTotalExclVat: ceOrder.SubTotalExclVat || 0,
    totalVat: ceOrder.TotalVat || 0,
    shippingCostsInclVat: ceOrder.ShippingCostsInclVat || 0,
    totalInclVat: ceOrder.TotalInclVat || 0,
    totalFee: ceOrder.TotalFee || 0,
    currencyCode: ceOrder.CurrencyCode || 'GBP',
    lines: (ceOrder.Lines || []).map((line: any) => ({
      lineId: String(line.Id || ''),
      channelOrderLineNo: line.ChannelOrderLineNo || '',
      sku: line.MerchantProductNo,
      description: line.Description || line.MerchantProductNo,
      gtin: line.Gtin,
      quantity: line.Quantity || 1,
      unitPriceInclVat: line.UnitPriceInclVat || 0,
      unitPriceExclVat: line.UnitPriceExclVat || 0,
      lineTotalInclVat: line.LineTotalInclVat || (line.UnitPriceInclVat * line.Quantity),
      lineTotalExclVat: line.LineTotalExclVat || 0,
      lineVat: line.LineVat || 0,
      vatRate: line.VatRate || 0,
      feeFixed: line.FeeFixed || 0,
      feeRate: line.FeeRate || 0,
      status: line.Status || 'NEW',
    })),
    syncedAt: timestamp,
  }));

  // Create order lines
  const orderLines: OrderLine[] = [];
  for (const order of transformedOrders) {
    for (const line of order.lines || []) {
      orderLines.push({
        sku: line.sku,
        skuOrderDate: `${line.sku}#${order.orderDate}#${order.orderId}`, // Composite sort key
        orderId: order.orderId,
        orderDateDay: order.orderDateDay,
        channelName: order.channelName,
        channelId: order.channelId,
        quantity: line.quantity,
        unitPriceInclVat: line.unitPriceInclVat,
        unitPriceExclVat: line.unitPriceExclVat,
        lineTotalInclVat: line.lineTotalInclVat,
        lineTotalExclVat: line.lineTotalExclVat,
        lineVat: line.lineVat,
        vatRate: line.vatRate,
        description: line.description,
        gtin: line.gtin,
        syncedAt: timestamp,
      });
    }
  }

  // Save orders in batches
  console.log(`  Saving ${transformedOrders.length} orders...`);
  await batchPutOrders(docClient, accountId, transformedOrders);

  // Save order lines in batches
  if (orderLines.length > 0) {
    console.log(`  Saving ${orderLines.length} order lines...`);
    await batchPutOrderLines(docClient, accountId, orderLines);
  }

  return { orders: transformedOrders.length, orderLines: orderLines.length };
}

async function batchPutOrders(
  docClient: DynamoDBDocumentClient,
  accountId: string,
  orders: Order[]
): Promise<void> {
  // Process in batches of 25 (DynamoDB limit)
  for (let i = 0; i < orders.length; i += 25) {
    const batch = orders.slice(i, i + 25);

    const putRequests = batch.map((order) => ({
      PutRequest: {
        Item: {
          ...order,
          accountId,
        },
      },
    }));

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [ORDERS_TABLE]: putRequests,
        },
      })
    );
  }
}

async function batchPutOrderLines(
  docClient: DynamoDBDocumentClient,
  accountId: string,
  orderLines: OrderLine[]
): Promise<void> {
  // Process in batches of 25 (DynamoDB limit)
  for (let i = 0; i < orderLines.length; i += 25) {
    const batch = orderLines.slice(i, i + 25);

    const putRequests = batch.map((line) => ({
      PutRequest: {
        Item: {
          ...line,
          accountId,
        },
      },
    }));

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [ORDER_LINES_TABLE]: putRequests,
        },
      })
    );
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
