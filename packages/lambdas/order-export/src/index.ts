import { ScheduledEvent, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ACCOUNT_ID = 'valquest-usa';
const EXPORT_STATUSES = ['NEW', 'IN_PROGRESS'];
const S3_BUCKET = process.env.EXPORT_BUCKET || 'repricing-v2-exports';
const S3_KEY = 'valquest-usa-orders.csv';
const ACCOUNTS_TABLE = process.env.ACCOUNTS_TABLE || 'repricing-v2-accounts';

interface Account {
  accountId: string;
  channelEngine: {
    apiKey: string;
    tenantId: string;
  };
}

interface AddressInfo {
  FirstName?: string;
  LastName?: string;
  CompanyName?: string;
  StreetName?: string;
  HouseNr?: string;
  HouseNrAddition?: string;
  City?: string;
  Region?: string;
  ZipCode?: string;
  CountryIso?: string;
  Phone?: string;
  Email?: string;
}

interface ChannelEngineOrder {
  Id: number;
  ChannelOrderNo: string;
  MerchantOrderNo: string;
  Status: string;
  Phone?: string;
  Email?: string;
  ShippingAddress?: AddressInfo;
  BillingAddress?: AddressInfo;
  Lines: Array<{
    MerchantProductNo: string;
    Quantity: number;
  }>;
  ExtraData?: Record<string, string>;
}

/**
 * Order Export Lambda
 * Fetches orders directly from ChannelEngine API for Valquest USA
 * Exports orders with status NEW or IN_PROGRESS to CSV in S3
 * Schedule: Daily at 12pm UTC
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('Order Export starting', { requestId: context.awsRequestId });

  const s3 = new S3Client({});
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  try {
    // Get account credentials from DynamoDB
    console.log(`Fetching account credentials for ${ACCOUNT_ID}...`);
    const accountResult = await docClient.send(
      new GetCommand({
        TableName: ACCOUNTS_TABLE,
        Key: { accountId: ACCOUNT_ID },
      })
    );

    const account = accountResult.Item as Account | undefined;
    if (!account?.channelEngine?.apiKey || !account?.channelEngine?.tenantId) {
      throw new Error(`Account ${ACCOUNT_ID} not found or missing ChannelEngine configuration`);
    }

    // Fetch orders directly from ChannelEngine API
    console.log('Fetching orders from ChannelEngine API...');
    const orders = await fetchChannelEngineOrders(account);
    console.log(`Fetched ${orders.length} total orders from ChannelEngine`);

    // Log first order structure to debug phone field
    if (orders.length > 0) {
      const sampleOrder = orders[0];
      console.log('Sample order structure:', JSON.stringify({
        ChannelOrderNo: sampleOrder.ChannelOrderNo,
        Phone: sampleOrder.Phone,
        Email: sampleOrder.Email,
        ShippingAddress: sampleOrder.ShippingAddress,
        BillingAddress: sampleOrder.BillingAddress,
        ExtraData: sampleOrder.ExtraData,
      }, null, 2));
    }

    // Filter for NEW and IN_PROGRESS status
    const filteredOrders = orders.filter((order) => {
      const status = (order.Status || '').toUpperCase().replace(/[_\s-]/g, '');
      return status === 'NEW' || status === 'INPROGRESS';
    });
    console.log(`Filtered to ${filteredOrders.length} orders with status NEW or IN_PROGRESS`);

    // Generate CSV
    const csvRows: string[] = [];

    // Header row matching the sample format
    csvRows.push('order_ref,shipping_method,firstname,lastname,company,street1,city,region,postcode,country,telephone,sku,qty');

    // Process each order
    for (const order of filteredOrders) {
      const shippingAddr = order.ShippingAddress || {};
      const billingAddr = order.BillingAddress || {};

      // Build street address (combine street name and house number)
      let street1 = '';
      if (shippingAddr.StreetName) {
        street1 = shippingAddr.StreetName;
        if (shippingAddr.HouseNr) {
          street1 += ` ${shippingAddr.HouseNr}`;
        }
        if (shippingAddr.HouseNrAddition) {
          street1 += shippingAddr.HouseNrAddition;
        }
      }

      // Get shipping method from ExtraData if available
      const shippingMethod = order.ExtraData?.ShippingMethod || order.ExtraData?.shipping_method || '';

      // Get phone from multiple possible sources (order level, shipping address, billing address)
      const phone = order.Phone || shippingAddr.Phone || billingAddr.Phone || '';

      // Each order line becomes a row
      for (const line of order.Lines || []) {
        const row = [
          escapeCSV(order.ChannelOrderNo || order.MerchantOrderNo),
          escapeCSV(shippingMethod),
          escapeCSV(shippingAddr.FirstName),
          escapeCSV(shippingAddr.LastName),
          escapeCSV(shippingAddr.CompanyName),
          escapeCSV(street1),
          escapeCSV(shippingAddr.City),
          escapeCSV(shippingAddr.Region),
          escapeCSV(shippingAddr.ZipCode),
          escapeCSV(shippingAddr.CountryIso || 'US'),
          escapeCSV(phone),
          escapeCSV(line.MerchantProductNo),
          String(line.Quantity || 1),
        ].join(',');

        csvRows.push(row);
      }
    }

    const csvContent = csvRows.join('\n');
    console.log(`Generated CSV with ${csvRows.length - 1} line items`);

    // Upload to S3
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: S3_KEY,
        Body: csvContent,
        ContentType: 'text/csv',
      })
    );

    console.log(`Successfully uploaded CSV to s3://${S3_BUCKET}/${S3_KEY}`);
    console.log(`Public URL: https://${S3_BUCKET}.s3.eu-west-2.amazonaws.com/${encodeURIComponent(S3_KEY)}`);
    console.log(`Export complete: ${filteredOrders.length} orders, ${csvRows.length - 1} line items`);
  } catch (error) {
    console.error('Order export failed:', error);
    throw error;
  }
}

/**
 * Fetch orders from ChannelEngine API
 * Gets all orders with status NEW or IN_PROGRESS
 */
async function fetchChannelEngineOrders(account: Account): Promise<ChannelEngineOrder[]> {
  const tenantId = account.channelEngine.tenantId;
  const baseUrl = `https://${tenantId}.channelengine.net/api/v2`;
  const allOrders: ChannelEngineOrder[] = [];

  // Fetch orders for each status we're interested in
  for (const status of EXPORT_STATUSES) {
    let page = 1;
    const pageSize = 100;

    while (true) {
      const url = new URL(`${baseUrl}/orders`);
      url.searchParams.set('page', page.toString());
      url.searchParams.set('pageSize', pageSize.toString());
      url.searchParams.set('statuses', status);

      console.log(`Fetching ${status} orders, page ${page}...`);

      const response = await fetch(url.toString(), {
        headers: {
          'X-CE-KEY': account.channelEngine.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ChannelEngine API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as { Content?: ChannelEngineOrder[]; TotalCount?: number };
      const orders = data.Content || [];
      const totalCount = data.TotalCount || 0;

      console.log(`Page ${page}: Got ${orders.length} orders (total: ${totalCount})`);
      allOrders.push(...orders);

      if (orders.length < pageSize || allOrders.length >= totalCount) {
        break;
      }

      page++;
    }
  }

  return allOrders;
}

/**
 * Escape a value for CSV format
 */
function escapeCSV(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  // If value contains comma, newline, or quote, wrap in quotes and escape internal quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
