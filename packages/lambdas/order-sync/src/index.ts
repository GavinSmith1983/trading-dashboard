import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createChannelEngineService,
  createDynamoDBService,
  Order,
  OrderLine,
} from '@repricing/core';

/**
 * Order Sync Lambda
 * Fetches orders from ChannelEngine and stores them in DynamoDB
 *
 * Can be invoked with:
 * - No payload: fetches orders from last 30 days
 * - { fromDate: "2024-11-01" }: fetches from specific date (for backfill)
 */
export async function handler(
  event: ScheduledEvent & { fromDate?: string },
  context: Context
): Promise<void> {
  console.log('Starting order sync', { event, requestId: context.awsRequestId });

  const db = createDynamoDBService();
  let totalOrdersSaved = 0;

  try {
    // Determine start date
    let fromDate: Date;
    if (event.fromDate) {
      fromDate = new Date(event.fromDate);
      console.log(`[ORDERS] Backfill mode: fetching from ${event.fromDate}`);
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

    // Fetch orders with incremental saving
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

      // Save to DynamoDB
      if (orders.length > 0) {
        await db.batchPutOrders(orders);
        totalOrdersSaved += orders.length;
      }

      console.log(
        `[DB] Saved batch ${page}: ${orders.length} orders ` +
        `(${totalOrdersSaved}/${total} total saved)`
      );
    });

    console.log(`[DONE] Order sync complete: ${totalOrdersSaved} orders saved`);

  } catch (error) {
    console.error(`[ERROR] Order sync failed after saving ${totalOrdersSaved} orders:`, error);
    throw error;
  }
}
