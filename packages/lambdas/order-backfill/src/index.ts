import { Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  CSCartService,
  Account,
  Order,
  OrderLineRecord,
} from '@repricing/core';

interface BackfillEvent {
  accountId: string;
  fromDate: string; // ISO date string (e.g., "2025-09-15")
  toDate?: string;  // ISO date string, defaults to today
}

/**
 * Order Backfill Lambda - Fetches historical orders for a specific account
 * Supports both ChannelEngine and CS-Cart data sources
 * Usage: Invoke with { "accountId": "nuie-marketplace", "fromDate": "2025-12-08" }
 */
export async function handler(event: BackfillEvent, context: Context): Promise<{ status: string; orders: number; orderLines: number }> {
  console.log('Order Backfill starting', { requestId: context.awsRequestId, event });

  const { accountId, fromDate, toDate } = event;

  if (!accountId || !fromDate) {
    throw new Error('Missing required parameters: accountId and fromDate');
  }

  const db = createDynamoDBServiceV2();

  // Get account configuration
  const account = await db.getAccount(accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  const dataSource = account.dataSource || 'channelengine';

  // Validate account configuration based on data source
  if (dataSource === 'cscart') {
    if (!account.csCart?.apiKey || !account.csCart?.baseUrl || !account.csCart?.email) {
      throw new Error('CS-Cart not configured for this account');
    }
    console.log(`[${accountId}] Using CS-Cart data source`);
  } else {
    if (!account.channelEngine?.apiKey || !account.channelEngine?.tenantId) {
      throw new Error('ChannelEngine not configured for this account');
    }
    console.log(`[${accountId}] Using ChannelEngine data source`);
  }

  console.log(`Backfilling orders for: ${account.name} (${accountId})`);

  const fromDateObj = new Date(fromDate);
  const toDateObj = toDate ? new Date(toDate) : new Date();

  let totalOrders = 0;
  let totalOrderLines = 0;

  // Process month by month to avoid Lambda timeout
  let currentStart = new Date(fromDateObj);

  while (currentStart < toDateObj) {
    // Calculate end of current chunk (1 month or toDate, whichever is earlier)
    const currentEnd = new Date(currentStart);
    currentEnd.setMonth(currentEnd.getMonth() + 1);
    if (currentEnd > toDateObj) {
      currentEnd.setTime(toDateObj.getTime());
    }

    console.log(`\nFetching orders: ${currentStart.toISOString().substring(0, 10)} to ${currentEnd.toISOString().substring(0, 10)}`);

    let result: { orders: number; orderLines: number };
    if (dataSource === 'cscart') {
      result = await fetchAndSaveCSCartOrders(db, account, currentStart, currentEnd);
    } else {
      result = await fetchAndSaveChannelEngineOrders(db, account, currentStart, currentEnd);
    }

    totalOrders += result.orders;
    totalOrderLines += result.orderLines;

    // Move to next month
    currentStart = new Date(currentEnd);
  }

  console.log(`\nBackfill complete: ${totalOrders} orders, ${totalOrderLines} order lines`);

  return {
    status: 'success',
    orders: totalOrders,
    orderLines: totalOrderLines,
  };
}

/**
 * Fetch and save orders from CS-Cart
 */
async function fetchAndSaveCSCartOrders(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  account: Account,
  fromDate: Date,
  toDate: Date
): Promise<{ orders: number; orderLines: number }> {
  const accountId = account.accountId;
  const csCart = account.csCart!;
  const orderPrefix = account.orderNumberPrefix || '';

  const service = new CSCartService({
    baseUrl: csCart.baseUrl,
    email: csCart.email,
    apiKey: csCart.apiKey,
    companyId: csCart.companyId,
  });

  // Fetch orders from CS-Cart (returns ChannelEngine-compatible format)
  // fetchFullDetails=true to get order line items (individual API call per order)
  const allOrders: any[] = [];
  await service.fetchOrders(fromDate, async (orders: any[], _page: number, _total: number) => {
    allOrders.push(...orders);
  }, toDate, true);

  if (allOrders.length === 0) {
    console.log('  No orders found in this period');
    return { orders: 0, orderLines: 0 };
  }

  const timestamp = new Date().toISOString();

  // Transform orders (apply prefix for Vector report matching)
  const transformedOrders: Order[] = allOrders.map((ceOrder) => {
    const rawOrderNo = ceOrder.ChannelOrderNo || ceOrder.MerchantOrderNo;
    const prefixedOrderNo = orderPrefix ? `${orderPrefix}${rawOrderNo}` : rawOrderNo;
    return {
      orderId: prefixedOrderNo,
      channelOrderNo: prefixedOrderNo,
      channelName: ceOrder.ChannelName || 'Nuie',
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
      // Buyer info for sales breakdown
      buyerName: ceOrder.BuyerName,
      buyerEmail: ceOrder.BuyerEmail,
      buyerCompany: ceOrder.BuyerCompany,
      buyerUserId: ceOrder.BuyerUserId,
      // Discount
      discount: ceOrder.Discount,
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
    };
  });

  // Create order lines
  const orderLines: OrderLineRecord[] = [];
  for (const order of transformedOrders) {
    for (const line of order.lines || []) {
      orderLines.push({
        sku: line.sku,
        orderId: order.orderId,
        orderDate: `${order.orderDate}#${order.orderId}`,
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

  // Save orders
  console.log(`  Saving ${transformedOrders.length} orders...`);
  await db.batchPutOrders(accountId, transformedOrders);

  // Save order lines
  if (orderLines.length > 0) {
    console.log(`  Saving ${orderLines.length} order lines...`);
    await db.batchPutOrderLines(accountId, orderLines);
  }

  return { orders: transformedOrders.length, orderLines: orderLines.length };
}

/**
 * Fetch and save orders from ChannelEngine
 */
async function fetchAndSaveChannelEngineOrders(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  account: Account,
  fromDate: Date,
  toDate: Date
): Promise<{ orders: number; orderLines: number }> {
  const accountId = account.accountId;
  const channelEngine = account.channelEngine!;
  const tenantId = channelEngine.tenantId;
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

    let response: Response | null = null;
    let lastError: Error | null = null;

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        response = await fetch(url.toString(), {
          headers: {
            'X-CE-KEY': channelEngine.apiKey,
            'Content-Type': 'application/json',
          },
        });
        break;
      } catch (error) {
        lastError = error as Error;
        console.warn(`Attempt ${attempt}/5 failed: ${lastError.message}`);
        if (attempt < 5) {
          const delay = 2000 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Failed to fetch after 5 attempts');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ChannelEngine API error: ${response.status} - ${errorText}`);
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

    // Small delay between pages
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
  const orderLines: OrderLineRecord[] = [];
  for (const order of transformedOrders) {
    for (const line of order.lines || []) {
      orderLines.push({
        sku: line.sku,
        orderId: order.orderId,
        orderDate: `${order.orderDate}#${order.orderId}`,
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

  // Save orders
  console.log(`  Saving ${transformedOrders.length} orders...`);
  await db.batchPutOrders(accountId, transformedOrders);

  // Save order lines
  if (orderLines.length > 0) {
    console.log(`  Saving ${orderLines.length} order lines...`);
    await db.batchPutOrderLines(accountId, orderLines);
  }

  return { orders: transformedOrders.length, orderLines: orderLines.length };
}
