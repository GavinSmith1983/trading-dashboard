import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  Account,
  Order,
  OrderLineRecord,
} from '@repricing/core';

/**
 * V2 Order Sync Lambda - Multi-tenant
 * Loops through all active accounts and syncs orders from their ChannelEngine
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('V2 Order Sync starting', { requestId: context.awsRequestId });

  const db = createDynamoDBServiceV2();

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`Found ${accounts.length} active accounts to sync orders`);

  const results: { accountId: string; status: string; orders?: number; error?: string }[] = [];

  // Process each account
  for (const account of accounts) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Syncing orders for: ${account.name} (${account.accountId})`);
    console.log('='.repeat(60));

    try {
      const orderCount = await syncAccountOrders(db, account);
      results.push({ accountId: account.accountId, status: 'success', orders: orderCount });
      console.log(`✅ Account ${account.accountId} orders synced: ${orderCount} orders`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId: account.accountId, status: 'failed', error: errorMessage });
      console.error(`❌ Account ${account.accountId} order sync failed:`, error);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('ORDER SYNC SUMMARY');
  console.log('='.repeat(60));
  for (const result of results) {
    if (result.status === 'success') {
      console.log(`✅ ${result.accountId}: ${result.orders} orders`);
    } else {
      console.log(`❌ ${result.accountId}: ${result.error}`);
    }
  }
}

/**
 * Sync orders for a single account
 */
async function syncAccountOrders(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  account: Account
): Promise<number> {
  const accountId = account.accountId;

  // Validate account has ChannelEngine configured
  if (!account.channelEngine?.apiKey || !account.channelEngine?.tenantId) {
    throw new Error('ChannelEngine not configured for this account');
  }

  // Fetch orders from ChannelEngine (last 24 hours for hourly sync)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  console.log(`[${accountId}] Fetching orders from ${yesterday.toISOString()} to ${now.toISOString()}`);

  const orders = await fetchChannelEngineOrders(account, yesterday, now);
  console.log(`[${accountId}] Fetched ${orders.length} orders from ChannelEngine`);

  if (orders.length === 0) {
    return 0;
  }

  const timestamp = new Date().toISOString();

  // Transform orders to our format (V2 simplified structure)
  const transformedOrders: Order[] = orders.map((ceOrder) => ({
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

  // Save orders to DynamoDB
  console.log(`[${accountId}] Saving ${transformedOrders.length} orders...`);
  await db.batchPutOrders(accountId, transformedOrders);

  // Also create denormalized order lines for fast SKU-based queries
  const orderLines: OrderLineRecord[] = [];

  for (const order of transformedOrders) {
    for (const line of order.lines || []) {
      orderLines.push({
        sku: line.sku,
        orderId: order.orderId,
        orderDate: `${order.orderDate}#${order.orderId}`, // Composite sort key
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

  if (orderLines.length > 0) {
    console.log(`[${accountId}] Saving ${orderLines.length} order lines...`);
    await db.batchPutOrderLines(accountId, orderLines);
  }

  return transformedOrders.length;
}

/**
 * Fetch orders from ChannelEngine API
 */
async function fetchChannelEngineOrders(
  account: Account,
  fromDate: Date,
  toDate: Date
): Promise<any[]> {
  // Build tenant-specific URL (e.g., ku-bathrooms -> https://ku-bathrooms.channelengine.net/api/v2)
  const tenantId = account.channelEngine.tenantId;
  const baseUrl = `https://${tenantId}.channelengine.net/api/v2`;
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

    const response = await fetch(url.toString(), {
      headers: {
        'X-CE-KEY': account.channelEngine.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`ChannelEngine API error: ${response.status}`);
    }

    const data = (await response.json()) as { Content?: any[]; TotalCount?: number };
    const orders = data.Content || [];
    const totalCount = data.TotalCount || 0;

    allOrders.push(...orders);

    if (orders.length < pageSize || allOrders.length >= totalCount) {
      break;
    }

    page++;
  }

  return allOrders;
}
