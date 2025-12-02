import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Product,
  Channel,
  PricingRule,
  PriceProposal,
  ProposalStatus,
  ProposalFilters,
  PaginatedProposals,
  Order,
  CarrierCost,
  SkuHistoryRecord,
} from '../types';

/**
 * DynamoDB service for all database operations
 */
export class DynamoDBService {
  private docClient: DynamoDBDocumentClient;
  private productsTable: string;
  private rulesTable: string;
  private proposalsTable: string;
  private channelsTable: string;
  private ordersTable: string;
  private carrierCostsTable: string;
  private skuHistoryTable: string;

  constructor(config: {
    productsTable: string;
    rulesTable: string;
    proposalsTable: string;
    channelsTable: string;
    ordersTable?: string;
    carrierCostsTable?: string;
    skuHistoryTable?: string;
  }) {
    const client = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });

    this.productsTable = config.productsTable;
    this.rulesTable = config.rulesTable;
    this.proposalsTable = config.proposalsTable;
    this.channelsTable = config.channelsTable;
    this.ordersTable = config.ordersTable || 'repricing-orders';
    this.carrierCostsTable = config.carrierCostsTable || 'repricing-carrier-costs';
    this.skuHistoryTable = config.skuHistoryTable || 'repricing-sku-history';
  }

  // ============ Products ============

  async getProduct(sku: string): Promise<Product | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.productsTable,
        Key: { sku },
      })
    );
    return (result.Item as Product) || null;
  }

  async putProduct(product: Product): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.productsTable,
        Item: { ...product, lastUpdated: new Date().toISOString() },
      })
    );
  }

  async getAllProducts(): Promise<Product[]> {
    const products: Product[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.productsTable,
          ExclusiveStartKey: lastKey,
        })
      );

      if (result.Items) {
        products.push(...(result.Items as Product[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return products;
  }

  async batchPutProducts(products: Product[]): Promise<void> {
    const timestamp = new Date().toISOString();

    // DynamoDB batch write limit is 25 items
    const chunks = this.chunkArray(products, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.productsTable]: chunk.map((product) => ({
              PutRequest: {
                Item: { ...product, lastUpdated: timestamp },
              },
            })),
          },
        })
      );
    }
  }

  async getProductsByBrand(brand: string): Promise<Product[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.productsTable,
        IndexName: 'by-brand',
        KeyConditionExpression: 'brand = :brand',
        ExpressionAttributeValues: { ':brand': brand },
      })
    );
    return (result.Items as Product[]) || [];
  }

  // ============ Pricing Rules ============

  async getRule(ruleId: string): Promise<PricingRule | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.rulesTable,
        Key: { ruleId },
      })
    );
    return (result.Item as PricingRule) || null;
  }

  async putRule(rule: PricingRule): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.rulesTable,
        Item: { ...rule, updatedAt: new Date().toISOString() },
      })
    );
  }

  async getAllRules(): Promise<PricingRule[]> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.rulesTable,
      })
    );
    return ((result.Items as PricingRule[]) || []).sort((a, b) => a.priority - b.priority);
  }

  async deleteRule(ruleId: string): Promise<void> {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.rulesTable,
        Key: { ruleId },
      })
    );
  }

  // ============ Proposals ============

  async getProposal(proposalId: string): Promise<PriceProposal | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.proposalsTable,
        Key: { proposalId },
      })
    );
    return (result.Item as PriceProposal) || null;
  }

  async putProposal(proposal: PriceProposal): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.proposalsTable,
        Item: proposal,
      })
    );
  }

  async batchPutProposals(proposals: PriceProposal[]): Promise<void> {
    const chunks = this.chunkArray(proposals, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.proposalsTable]: chunk.map((proposal) => ({
              PutRequest: { Item: proposal },
            })),
          },
        })
      );
    }
  }

  async getProposalsByStatus(status: ProposalStatus): Promise<PriceProposal[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.proposalsTable,
        IndexName: 'by-status',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
        ScanIndexForward: false, // Most recent first
      })
    );
    return (result.Items as PriceProposal[]) || [];
  }

  async queryProposals(
    filters: ProposalFilters,
    page: number = 1,
    pageSize: number = 50
  ): Promise<PaginatedProposals> {
    // Build filter expression
    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      if (statuses.length === 1) {
        filterExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = statuses[0];
      }
    }

    if (filters.brand) {
      filterExpressions.push('brand = :brand');
      expressionAttributeValues[':brand'] = filters.brand;
    }

    if (filters.batchId) {
      filterExpressions.push('batchId = :batchId');
      expressionAttributeValues[':batchId'] = filters.batchId;
    }

    if (filters.hasWarnings) {
      filterExpressions.push('size(warnings) > :zero');
      expressionAttributeValues[':zero'] = 0;
    }

    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.proposalsTable,
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames:
          Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues:
          Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
      })
    );

    let items = (result.Items as PriceProposal[]) || [];

    // Apply search filter (client-side for simplicity)
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      items = items.filter(
        (p) =>
          p.sku.toLowerCase().includes(term) ||
          p.productTitle.toLowerCase().includes(term)
      );
    }

    // Sort by createdAt descending
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Paginate
    const totalCount = items.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedItems = items.slice(startIndex, startIndex + pageSize);

    return {
      items: paginatedItems,
      totalCount,
      page,
      pageSize,
      hasMore: startIndex + pageSize < totalCount,
    };
  }

  async updateProposalStatus(
    proposalId: string,
    status: ProposalStatus,
    reviewedBy: string,
    notes?: string,
    approvedPrice?: number
  ): Promise<void> {
    const updateExpressions: string[] = [
      '#status = :status',
      'reviewedAt = :reviewedAt',
      'reviewedBy = :reviewedBy',
    ];
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': status,
      ':reviewedAt': new Date().toISOString(),
      ':reviewedBy': reviewedBy,
    };

    if (notes) {
      updateExpressions.push('reviewNotes = :notes');
      expressionAttributeValues[':notes'] = notes;
    }

    if (approvedPrice !== undefined) {
      updateExpressions.push('approvedPrice = :approvedPrice');
      expressionAttributeValues[':approvedPrice'] = approvedPrice;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.proposalsTable,
        Key: { proposalId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  }

  // ============ Channels ============

  async getChannel(channelId: string): Promise<Channel | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.channelsTable,
        Key: { channelId },
      })
    );
    return (result.Item as Channel) || null;
  }

  async putChannel(channel: Channel): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.channelsTable,
        Item: { ...channel, lastUpdated: new Date().toISOString() },
      })
    );
  }

  async getAllChannels(): Promise<Channel[]> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.channelsTable,
      })
    );
    return (result.Items as Channel[]) || [];
  }

  // ============ Carrier Costs ============

  async getCarrierCost(carrierId: string): Promise<CarrierCost | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.carrierCostsTable,
        Key: { carrierId },
      })
    );
    return (result.Item as CarrierCost) || null;
  }

  async putCarrierCost(carrier: CarrierCost): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.carrierCostsTable,
        Item: { ...carrier, lastUpdated: new Date().toISOString() },
      })
    );
  }

  async getAllCarrierCosts(): Promise<CarrierCost[]> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.carrierCostsTable,
      })
    );
    return (result.Items as CarrierCost[]) || [];
  }

  async deleteCarrierCost(carrierId: string): Promise<void> {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.carrierCostsTable,
        Key: { carrierId },
      })
    );
  }

  async batchPutCarrierCosts(carriers: CarrierCost[]): Promise<void> {
    const timestamp = new Date().toISOString();
    const chunks = this.chunkArray(carriers, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.carrierCostsTable]: chunk.map((carrier) => ({
              PutRequest: {
                Item: { ...carrier, lastUpdated: timestamp },
              },
            })),
          },
        })
      );
    }
  }

  // ============ Orders ============

  async batchPutOrders(orders: Order[]): Promise<void> {
    const chunks = this.chunkArray(orders, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.ordersTable]: chunk.map((order) => ({
              PutRequest: { Item: order },
            })),
          },
        })
      );
    }
  }

  async getOrdersByDate(dateDay: string): Promise<Order[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.ordersTable,
        IndexName: 'by-date',
        KeyConditionExpression: 'orderDateDay = :dateDay',
        ExpressionAttributeValues: { ':dateDay': dateDay },
      })
    );
    return (result.Items as Order[]) || [];
  }

  async getOrdersByChannel(
    channelName: string,
    fromDate: string,
    toDate: string
  ): Promise<Order[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.ordersTable,
        IndexName: 'by-channel',
        KeyConditionExpression: 'channelName = :channel AND orderDate BETWEEN :fromDate AND :toDate',
        ExpressionAttributeValues: {
          ':channel': channelName,
          ':fromDate': fromDate,
          ':toDate': toDate,
        },
      })
    );
    return (result.Items as Order[]) || [];
  }

  async getOrderCount(): Promise<number> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.ordersTable,
        Select: 'COUNT',
      })
    );
    return result.Count || 0;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.ordersTable,
        Key: { orderId },
      })
    );
    return (result.Item as Order) || null;
  }

  async updateOrderDelivery(
    orderId: string,
    deliveryInfo: {
      deliveryCarrier: string;
      deliveryCarrierRaw: string;
      deliveryParcels: number;
    }
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.ordersTable,
        Key: { orderId },
        UpdateExpression: 'SET deliveryCarrier = :carrier, deliveryCarrierRaw = :carrierRaw, deliveryParcels = :parcels, deliveryImportedAt = :importedAt',
        ExpressionAttributeValues: {
          ':carrier': deliveryInfo.deliveryCarrier,
          ':carrierRaw': deliveryInfo.deliveryCarrierRaw,
          ':parcels': deliveryInfo.deliveryParcels,
          ':importedAt': new Date().toISOString(),
        },
      })
    );
  }

  async getAllOrders(): Promise<Order[]> {
    const orders: Order[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new ScanCommand({
          TableName: this.ordersTable,
          ExclusiveStartKey: lastKey,
        })
      );
      if (result.Items) {
        orders.push(...(result.Items as Order[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return orders;
  }

  /**
   * Create a lookup map for products by SKU (case-insensitive) and Balterley SKU
   * Returns a Map where keys are uppercase SKUs and values are products
   */
  async getProductLookupMap(): Promise<{
    bySku: Map<string, Product>;
    byBalterleySku: Map<string, Product>;
  }> {
    const products = await this.getAllProducts();
    const bySku = new Map<string, Product>();
    const byBalterleySku = new Map<string, Product>();

    for (const product of products) {
      // Primary lookup by SKU (case-insensitive)
      bySku.set(product.sku.toUpperCase(), product);

      // Secondary lookup by Balterley SKU if available
      if (product.balterleySku) {
        byBalterleySku.set(product.balterleySku.toUpperCase(), product);
      }
    }

    return { bySku, byBalterleySku };
  }

  async getSalesBySku(days: number = 7): Promise<Map<string, { quantity: number; revenue: number }>> {
    const salesMap = new Map<string, { quantity: number; revenue: number }>();

    // Get orders for each day in the range
    const today = new Date();
    const dateDays: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dateDays.push(d.toISOString().substring(0, 10));
    }

    // Query orders in parallel batches (50 concurrent queries at a time)
    const batchSize = 50;
    const batches = this.chunkArray(dateDays, batchSize);

    for (const batch of batches) {
      const orderPromises = batch.map((dateDay) => this.getOrdersByDate(dateDay));
      const orderResults = await Promise.all(orderPromises);

      for (const orders of orderResults) {
        for (const order of orders) {
          if (order.lines) {
            for (const line of order.lines) {
              const existing = salesMap.get(line.sku) || { quantity: 0, revenue: 0 };
              existing.quantity += line.quantity;
              existing.revenue += line.lineTotalInclVat;
              salesMap.set(line.sku, existing);
            }
          }
        }
      }
    }

    return salesMap;
  }

  // ============ SKU History ============

  async putSkuHistory(record: SkuHistoryRecord): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.skuHistoryTable,
        Item: record,
      })
    );
  }

  async batchPutSkuHistory(records: SkuHistoryRecord[]): Promise<void> {
    const chunks = this.chunkArray(records, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.skuHistoryTable]: chunk.map((record) => ({
              PutRequest: { Item: record },
            })),
          },
        })
      );
    }
  }

  async getSkuHistory(sku: string, fromDate?: string, toDate?: string): Promise<SkuHistoryRecord[]> {
    let keyCondition = 'sku = :sku';
    const expressionValues: Record<string, unknown> = { ':sku': sku };

    if (fromDate && toDate) {
      keyCondition += ' AND #date BETWEEN :fromDate AND :toDate';
      expressionValues[':fromDate'] = fromDate;
      expressionValues[':toDate'] = toDate;
    } else if (fromDate) {
      keyCondition += ' AND #date >= :fromDate';
      expressionValues[':fromDate'] = fromDate;
    } else if (toDate) {
      keyCondition += ' AND #date <= :toDate';
      expressionValues[':toDate'] = toDate;
    }

    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.skuHistoryTable,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: expressionValues,
        ScanIndexForward: true, // Oldest first for charting
      })
    );

    return (result.Items as SkuHistoryRecord[]) || [];
  }

  // ============ Utilities ============

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

/**
 * Create DynamoDB service from environment variables
 */
export function createDynamoDBService(): DynamoDBService {
  return new DynamoDBService({
    productsTable: process.env.PRODUCTS_TABLE || 'repricing-products',
    rulesTable: process.env.PRICING_RULES_TABLE || 'repricing-rules',
    proposalsTable: process.env.PRICE_PROPOSALS_TABLE || 'repricing-proposals',
    channelsTable: process.env.CHANNEL_CONFIG_TABLE || 'repricing-channels',
    ordersTable: process.env.ORDERS_TABLE || 'repricing-orders',
    carrierCostsTable: process.env.CARRIER_COSTS_TABLE || 'repricing-carrier-costs',
  });
}
