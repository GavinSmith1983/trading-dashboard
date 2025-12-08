import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createChannelEngineService,
  createDynamoDBService,
  Order,
  OrderLine,
  OrderLineRecord,
} from '@repricing/core';

/**
 * Order Sync Lambda
 * Fetches orders from ChannelEngine and stores them in DynamoDB
 *
 * Can be invoked with:
 * - No payload: fetches orders from last 30 days (incremental sync)
 * - { fromDate: "2024-11-01" }: fetches from specific date (for backfill)
 * - { fromDate: "2024-11-01", continueFromEarliest: true }: backfill continuing from earliest order in DB
 */
export async function handler(
  event: ScheduledEvent & { fromDate?: string; continueFromEarliest?: boolean },
  context: Context
): Promise<void> {
  console.log('Starting order sync', { event, requestId: context.awsRequestId });

  const db = createDynamoDBService();
  let totalOrdersSaved = 0;

  try {
    // Determine start date
    let fromDate: Date;
    const targetFromDate = event.fromDate ? new Date(event.fromDate) : null;

    // Track toDate for limiting the fetch range
    let toDate: Date | undefined;

    if (event.continueFromEarliest || event.fromDate) {
      // Find the earliest order in the database to continue from there
      const earliestOrder = await db.getEarliestOrder();

      if (earliestOrder && targetFromDate) {
        // Check if we've reached the target date
        const earliestDate = new Date(earliestOrder.orderDate);

        if (earliestDate <= targetFromDate) {
          // We've reached or passed the target date - backfill complete!
          console.log(`[ORDERS] Backfill complete! Earliest order (${earliestOrder.orderDate}) is at or before target (${event.fromDate})`);
          return;
        }

        // Fetch orders from target date UP TO the day of earliest order
        // This fills the gap between target and what we already have
        fromDate = targetFromDate;
        toDate = earliestDate; // Fetch up to (and including) the earliest order date
        console.log(`[ORDERS] Continuing backfill: earliest order is ${earliestOrder.orderDate}`);
        console.log(`[ORDERS] Fetching from ${fromDate.toISOString()} to ${toDate.toISOString()}`);
      } else if (targetFromDate) {
        // No orders in DB yet, start from target date
        fromDate = targetFromDate;
        console.log(`[ORDERS] Backfill mode (no existing orders): fetching from ${event.fromDate}`);
      } else {
        // Default: last 30 days
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        console.log(`[ORDERS] Incremental mode: fetching from ${fromDate.toISOString()}`);
      }
    } else {
      // Default: last 30 days for incremental sync
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      console.log(`[ORDERS] Incremental mode: fetching from ${fromDate.toISOString()}`);
    }

    const secretArn = process.env.CHANNEL_ENGINE_SECRET_ARN;
    if (!secretArn) {
      throw new Error('CHANNEL_ENGINE_SECRET_ARN not configured');
    }

    const ceService = await createChannelEngineService(secretArn);
    const syncedAt = new Date().toISOString();

    // Fetch orders with incremental saving (with optional toDate for backfill)
    await ceService.fetchOrders(fromDate, async (ceOrders, page, total) => {
      const orders: Order[] = [];

      for (const ceOrder of ceOrders) {
        const orderDate = ceOrder.OrderDate;
        const orderDateDay = orderDate.substring(0, 10); // YYYY-MM-DD

        // Build nested order lines array
        const lines: OrderLine[] = (ceOrder.Lines || []).map((ceLine) => ({
          lineId: String(ceLine.Id),
          channelOrderLineNo: ceLine.ChannelOrderLineNo,
          sku: ceLine.MerchantProductNo || 'UNKNOWN',
          description: ceLine.Description || '',
          gtin: ceLine.Gtin,
          quantity: ceLine.Quantity,
          unitPriceInclVat: ceLine.UnitPriceInclVat,
          unitPriceExclVat: ceLine.UnitPriceExclVat,
          lineTotalInclVat: ceLine.LineTotalInclVat,
          lineTotalExclVat: ceLine.LineTotalExclVat,
          lineVat: ceLine.LineVat,
          vatRate: ceLine.VatRate,
          feeFixed: ceLine.FeeFixed,
          feeRate: ceLine.FeeRate,
          shippingMethod: ceLine.ShippingMethod,
          shippingServiceLevel: ceLine.ShippingServiceLevel,
          status: ceLine.Status,
        }));

        // Get shipping method from first line (order-level)
        const firstLine = ceOrder.Lines?.[0];

        // Create order record with nested lines
        const order: Order = {
          orderId: String(ceOrder.Id),
          channelOrderNo: ceOrder.ChannelOrderNo,
          channelName: ceOrder.ChannelName || 'Unknown',
          channelId: ceOrder.ChannelId,
          orderDate,
          orderDateDay,
          status: ceOrder.Status,
          subTotalInclVat: ceOrder.SubTotalInclVat,
          subTotalExclVat: ceOrder.SubTotalInclVat - ceOrder.SubTotalVat,
          totalVat: ceOrder.TotalVat,
          shippingCostsInclVat: ceOrder.ShippingCostsInclVat,
          totalInclVat: ceOrder.TotalInclVat,
          totalFee: ceOrder.TotalFee,
          currencyCode: ceOrder.CurrencyCode,
          shippingMethod: firstLine?.ShippingMethod,
          shippingServiceLevel: firstLine?.ShippingServiceLevel,
          lines,
          syncedAt,
        };
        orders.push(order);
      }

      // Build denormalized order line records for fast SKU queries
      const orderLineRecords: OrderLineRecord[] = [];
      for (const order of orders) {
        for (const line of order.lines) {
          orderLineRecords.push({
            sku: line.sku,
            orderDate: `${order.orderDate}#${order.orderId}`, // Composite key for uniqueness
            orderId: order.orderId,
            channelName: order.channelName,
            channelId: order.channelId,
            orderDateDay: order.orderDateDay,
            quantity: line.quantity,
            unitPriceInclVat: line.unitPriceInclVat,
            unitPriceExclVat: line.unitPriceExclVat,
            lineTotalInclVat: line.lineTotalInclVat,
            lineTotalExclVat: line.lineTotalExclVat,
            lineVat: line.lineVat,
            vatRate: line.vatRate,
            description: line.description,
            gtin: line.gtin,
            syncedAt,
          });
        }
      }

      // Save to DynamoDB (both tables)
      if (orders.length > 0) {
        await Promise.all([
          db.batchPutOrders(orders),
          db.batchPutOrderLines(orderLineRecords),
        ]);
        totalOrdersSaved += orders.length;
      }

      console.log(
        `[DB] Saved batch ${page}: ${orders.length} orders, ${orderLineRecords.length} line records ` +
        `(${totalOrdersSaved}/${total} total saved)`
      );
    }, toDate);

    console.log(`[DONE] Order sync complete: ${totalOrdersSaved} orders saved`);

  } catch (error) {
    console.error(`[ERROR] Order sync failed after saving ${totalOrdersSaved} orders:`, error);
    throw error;
  }
}
