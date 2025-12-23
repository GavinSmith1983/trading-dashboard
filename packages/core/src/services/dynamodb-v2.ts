import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  BatchWriteCommand,
  DeleteCommand,
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
  OrderLineRecord,
  CarrierCost,
  SkuHistoryRecord,
  Account,
  PriceChangeRecord,
} from '../types';

/**
 * V2 DynamoDB Service - Multi-tenant database operations
 * All methods require accountId for tenant isolation
 */
export class DynamoDBServiceV2 {
  private docClient: DynamoDBDocumentClient;
  private accountsTable: string;
  private productsTable: string;
  private rulesTable: string;
  private proposalsTable: string;
  private channelsTable: string;
  private ordersTable: string;
  private orderLinesTable: string;
  private carrierCostsTable: string;
  private skuHistoryTable: string;
  private priceChangesTable: string;
  private importJobsTable: string;

  // Cache for active accounts (reduces scan calls from scheduled lambdas)
  private activeAccountsCache: { data: Account[]; timestamp: number } | null = null;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: {
    accountsTable: string;
    productsTable: string;
    rulesTable: string;
    proposalsTable: string;
    channelsTable: string;
    ordersTable?: string;
    orderLinesTable?: string;
    carrierCostsTable?: string;
    skuHistoryTable?: string;
    priceChangesTable?: string;
    importJobsTable?: string;
  }) {
    const client = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });

    this.accountsTable = config.accountsTable;
    this.productsTable = config.productsTable;
    this.rulesTable = config.rulesTable;
    this.proposalsTable = config.proposalsTable;
    this.channelsTable = config.channelsTable;
    this.ordersTable = config.ordersTable || 'repricing-v2-orders';
    this.orderLinesTable = config.orderLinesTable || 'repricing-v2-order-lines';
    this.carrierCostsTable = config.carrierCostsTable || 'repricing-v2-carrier-costs';
    this.skuHistoryTable = config.skuHistoryTable || 'repricing-v2-sku-history';
    this.priceChangesTable = config.priceChangesTable || 'repricing-v2-price-changes';
    this.importJobsTable = config.importJobsTable || 'repricing-v2-import-jobs';
  }

  // ============ Accounts ============

  async getAccount(accountId: string): Promise<Account | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.accountsTable,
        Key: { accountId },
      })
    );
    return (result.Item as Account) || null;
  }

  async putAccount(account: Account): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.accountsTable,
        Item: { ...account, updatedAt: new Date().toISOString() },
      })
    );
    // Invalidate cache when account is updated
    this.invalidateAccountsCache();
  }

  async getAllAccounts(): Promise<Account[]> {
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.accountsTable,
      })
    );
    return (result.Items as Account[]) || [];
  }

  async getActiveAccounts(): Promise<Account[]> {
    // Check if cache is valid (within TTL)
    const now = Date.now();
    if (this.activeAccountsCache && (now - this.activeAccountsCache.timestamp) < DynamoDBServiceV2.CACHE_TTL_MS) {
      return this.activeAccountsCache.data;
    }

    // Fetch from database
    const result = await this.docClient.send(
      new ScanCommand({
        TableName: this.accountsTable,
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':active': 'active' },
      })
    );

    const accounts = (result.Items as Account[]) || [];

    // Update cache
    this.activeAccountsCache = { data: accounts, timestamp: now };

    return accounts;
  }

  /**
   * Invalidate the active accounts cache (call when an account is updated)
   */
  invalidateAccountsCache(): void {
    this.activeAccountsCache = null;
  }

  // ============ Products ============

  async getProduct(accountId: string, sku: string): Promise<Product | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.productsTable,
        Key: { accountId, sku },
      })
    );
    return (result.Item as Product) || null;
  }

  async putProduct(accountId: string, product: Product): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.productsTable,
        Item: { ...product, accountId, lastUpdated: new Date().toISOString() },
      })
    );
  }

  async updateProduct(
    accountId: string,
    sku: string,
    updates: Partial<Product>
  ): Promise<void> {
    // Build update expression dynamically
    const updateExpressions: string[] = ['lastUpdated = :lastUpdated'];
    const expressionAttributeValues: Record<string, unknown> = {
      ':lastUpdated': new Date().toISOString(),
    };
    const expressionAttributeNames: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'sku' && key !== 'accountId' && value !== undefined) {
        const attrName = `#${key}`;
        const attrValue = `:${key}`;
        expressionAttributeNames[attrName] = key;
        expressionAttributeValues[attrValue] = value;
        updateExpressions.push(`${attrName} = ${attrValue}`);
      }
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.productsTable,
        Key: { accountId, sku },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames:
          Object.keys(expressionAttributeNames).length > 0
            ? expressionAttributeNames
            : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  }

  async getAllProducts(accountId: string): Promise<Product[]> {
    const products: Product[] = [];
    let lastKey: Record<string, unknown> | undefined;
    let pageCount = 0;
    const startTime = Date.now();

    do {
      const pageStart = Date.now();
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.productsTable,
          KeyConditionExpression: 'accountId = :accountId',
          ExpressionAttributeValues: { ':accountId': accountId },
          ExclusiveStartKey: lastKey,
        })
      );
      pageCount++;
      console.log(`DynamoDB products page ${pageCount}: ${result.Items?.length || 0} items in ${Date.now() - pageStart}ms`);

      if (result.Items) {
        products.push(...(result.Items as Product[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    console.log(`DynamoDB getAllProducts total: ${products.length} items, ${pageCount} pages, ${Date.now() - startTime}ms`);

    return products;
  }

  async batchPutProducts(accountId: string, products: Product[]): Promise<void> {
    const timestamp = new Date().toISOString();
    const chunks = this.chunkArray(products, 25);

    for (const chunk of chunks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let requestItems: Record<string, any[]> = {
        [this.productsTable]: chunk.map((product) => ({
          PutRequest: {
            Item: { ...product, accountId, lastUpdated: timestamp },
          },
        })),
      };

      // Retry unprocessed items with exponential backoff
      let retries = 0;
      const maxRetries = 5;

      while (Object.keys(requestItems).length > 0 && retries < maxRetries) {
        const result = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: requestItems })
        );

        if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
          requestItems = result.UnprocessedItems as Record<string, any[]>;
          retries++;
          // Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms
          await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, retries)));
        } else {
          break;
        }
      }

      if (retries >= maxRetries && Object.keys(requestItems).length > 0) {
        console.error(
          `[DynamoDB] Failed to write ${Object.values(requestItems).flat().length} items after ${maxRetries} retries`
        );
      }
    }
  }

  async getProductsByBrand(accountId: string, brand: string): Promise<Product[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.productsTable,
        IndexName: 'by-account-brand',
        KeyConditionExpression: 'accountId = :accountId AND brand = :brand',
        ExpressionAttributeValues: { ':accountId': accountId, ':brand': brand },
      })
    );
    return (result.Items as Product[]) || [];
  }

  // ============ Pricing Rules ============

  async getRule(accountId: string, ruleId: string): Promise<PricingRule | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.rulesTable,
        Key: { accountId, ruleId },
      })
    );
    return (result.Item as PricingRule) || null;
  }

  async putRule(accountId: string, rule: PricingRule): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.rulesTable,
        Item: { ...rule, accountId, updatedAt: new Date().toISOString() },
      })
    );
  }

  async getAllRules(accountId: string): Promise<PricingRule[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.rulesTable,
        KeyConditionExpression: 'accountId = :accountId',
        ExpressionAttributeValues: { ':accountId': accountId },
      })
    );
    return ((result.Items as PricingRule[]) || []).sort((a, b) => a.priority - b.priority);
  }

  async deleteRule(accountId: string, ruleId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.rulesTable,
        Key: { accountId, ruleId },
      })
    );
  }

  // ============ Proposals ============

  async getProposal(accountId: string, proposalId: string): Promise<PriceProposal | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.proposalsTable,
        Key: { accountId, proposalId },
      })
    );
    return (result.Item as PriceProposal) || null;
  }

  async putProposal(accountId: string, proposal: PriceProposal): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.proposalsTable,
        Item: { ...proposal, accountId },
      })
    );
  }

  async batchPutProposals(accountId: string, proposals: PriceProposal[]): Promise<void> {
    const chunks = this.chunkArray(proposals, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.proposalsTable]: chunk.map((proposal) => ({
              PutRequest: { Item: { ...proposal, accountId } },
            })),
          },
        })
      );
    }
  }

  async getProposalsByStatus(accountId: string, status: ProposalStatus): Promise<PriceProposal[]> {
    const items: PriceProposal[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.proposalsTable,
          IndexName: 'by-account-status',
          KeyConditionExpression: 'accountId = :accountId AND #status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':accountId': accountId, ':status': status },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...((result.Items as PriceProposal[]) || []));
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  async queryProposals(
    accountId: string,
    filters: ProposalFilters,
    page: number = 1,
    pageSize: number = 50
  ): Promise<PaginatedProposals> {
    let items: PriceProposal[] = [];
    let lastKey: Record<string, unknown> | undefined;

    // Build filter expression for server-side filtering
    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {
      ':accountId': accountId,
    };

    // If single status filter, use the GSI for efficient querying
    const singleStatus = filters.status && !Array.isArray(filters.status) ? filters.status :
                         (Array.isArray(filters.status) && filters.status.length === 1 ? filters.status[0] : null);

    if (singleStatus) {
      // Use the by-account-status GSI for single status queries (most efficient)
      do {
        const result = await this.docClient.send(
          new QueryCommand({
            TableName: this.proposalsTable,
            IndexName: 'by-account-status',
            KeyConditionExpression: 'accountId = :accountId AND #status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':accountId': accountId, ':status': singleStatus },
            ExclusiveStartKey: lastKey,
          })
        );
        items = items.concat((result.Items as PriceProposal[]) || []);
        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
    } else {
      // Build filter expression for other filters
      if (filters.status && Array.isArray(filters.status) && filters.status.length > 1) {
        const statusConditions = filters.status.map((s, i) => {
          expressionAttributeValues[`:status${i}`] = s;
          return `#status = :status${i}`;
        });
        filterExpressions.push(`(${statusConditions.join(' OR ')})`);
        expressionAttributeNames['#status'] = 'status';
      }

      if (filters.brand) {
        filterExpressions.push('brand = :brand');
        expressionAttributeValues[':brand'] = filters.brand;
      }

      if (filters.batchId) {
        filterExpressions.push('batchId = :batchId');
        expressionAttributeValues[':batchId'] = filters.batchId;
      }

      // Query with server-side filtering where possible
      const filterExpression = filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined;

      do {
        const result = await this.docClient.send(
          new QueryCommand({
            TableName: this.proposalsTable,
            KeyConditionExpression: 'accountId = :accountId',
            FilterExpression: filterExpression,
            ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
            ExpressionAttributeValues: expressionAttributeValues,
            ExclusiveStartKey: lastKey,
          })
        );
        items = items.concat((result.Items as PriceProposal[]) || []);
        lastKey = result.LastEvaluatedKey;
      } while (lastKey);
    }

    // Apply remaining client-side filters that can't use FilterExpression efficiently
    if (filters.hasWarnings) {
      items = items.filter((p) => (p.warnings?.length || 0) > 0);
    }

    if (filters.appliedRuleName) {
      if (filters.appliedRuleName === '__NO_RULE__') {
        items = items.filter((p) => !p.appliedRuleName);
      } else {
        items = items.filter((p) => p.appliedRuleName === filters.appliedRuleName);
      }
    }

    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      items = items.filter(
        (p) =>
          p.sku.toLowerCase().includes(term) ||
          p.productTitle.toLowerCase().includes(term)
      );
    }

    // Sort by impact
    items.sort((a, b) => {
      const aInStock = (a.stockLevel || 0) > 0;
      const bInStock = (b.stockLevel || 0) > 0;
      const aSales = a.avgDailySales || 0;
      const bSales = b.avgDailySales || 0;

      if (aInStock && !bInStock) return -1;
      if (!aInStock && bInStock) return 1;

      if (aInStock && bInStock) {
        if (aSales !== bSales) return bSales - aSales;
      }

      const aImpact = Math.abs(a.estimatedWeeklyProfitImpact || 0);
      const bImpact = Math.abs(b.estimatedWeeklyProfitImpact || 0);
      if (aImpact !== bImpact) return bImpact - aImpact;

      return (b.stockLevel || 0) - (a.stockLevel || 0);
    });

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
    accountId: string,
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
        Key: { accountId, proposalId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  }

  async deleteAllProposals(accountId: string): Promise<number> {
    let deleted = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.proposalsTable,
          KeyConditionExpression: 'accountId = :aid',
          ExpressionAttributeValues: { ':aid': accountId },
          ProjectionExpression: 'accountId, proposalId',
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      lastEvaluatedKey = result.LastEvaluatedKey;
      const items = result.Items || [];

      if (items.length === 0) continue;

      // Delete in batches of 25 (DynamoDB limit)
      for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);
        await this.docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.proposalsTable]: batch.map((item) => ({
                DeleteRequest: {
                  Key: {
                    accountId: item.accountId as string,
                    proposalId: item.proposalId as string,
                  },
                },
              })),
            },
          })
        );
        deleted += batch.length;
      }
    } while (lastEvaluatedKey);

    return deleted;
  }

  // ============ Channels ============

  async getChannel(accountId: string, channelId: string): Promise<Channel | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.channelsTable,
        Key: { accountId, channelId },
      })
    );
    return (result.Item as Channel) || null;
  }

  async putChannel(accountId: string, channel: Channel): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.channelsTable,
        Item: { ...channel, accountId, lastUpdated: new Date().toISOString() },
      })
    );
  }

  async getAllChannels(accountId: string): Promise<Channel[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.channelsTable,
        KeyConditionExpression: 'accountId = :accountId',
        ExpressionAttributeValues: { ':accountId': accountId },
      })
    );
    return (result.Items as Channel[]) || [];
  }

  // ============ Carrier Costs ============

  async getCarrierCost(accountId: string, carrierId: string): Promise<CarrierCost | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.carrierCostsTable,
        Key: { accountId, carrierId },
      })
    );
    return (result.Item as CarrierCost) || null;
  }

  async putCarrierCost(accountId: string, carrier: CarrierCost): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.carrierCostsTable,
        Item: { ...carrier, accountId, lastUpdated: new Date().toISOString() },
      })
    );
  }

  async getAllCarrierCosts(accountId: string): Promise<CarrierCost[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.carrierCostsTable,
        KeyConditionExpression: 'accountId = :accountId',
        ExpressionAttributeValues: { ':accountId': accountId },
      })
    );
    return (result.Items as CarrierCost[]) || [];
  }

  async deleteCarrierCost(accountId: string, carrierId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.carrierCostsTable,
        Key: { accountId, carrierId },
      })
    );
  }

  // ============ Orders ============

  async batchPutOrders(accountId: string, orders: Order[]): Promise<void> {
    const chunks = this.chunkArray(orders, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.ordersTable]: chunk.map((order) => ({
              PutRequest: { Item: { ...order, accountId } },
            })),
          },
        })
      );
    }
  }

  async getOrder(accountId: string, orderId: string): Promise<Order | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.ordersTable,
        Key: { accountId, orderId },
      })
    );
    return (result.Item as Order) || null;
  }

  async getOrdersByDate(accountId: string, dateDay: string): Promise<Order[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.ordersTable,
        IndexName: 'by-account-date',
        KeyConditionExpression: 'accountId = :accountId AND orderDateDay = :dateDay',
        ExpressionAttributeValues: { ':accountId': accountId, ':dateDay': dateDay },
      })
    );
    return (result.Items as Order[]) || [];
  }

  async getAllOrders(accountId: string): Promise<Order[]> {
    const orders: Order[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.ordersTable,
          KeyConditionExpression: 'accountId = :accountId',
          ExpressionAttributeValues: { ':accountId': accountId },
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
   * Get orders by date range (using GSI by-account-date)
   * Returns full order records including buyer info
   */
  async getOrdersByDateRange(
    accountId: string,
    fromDate: string,
    toDate: string
  ): Promise<Order[]> {
    const allOrders: Order[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.ordersTable,
          IndexName: 'by-account-date',
          KeyConditionExpression: 'accountId = :accountId AND orderDateDay BETWEEN :fromDate AND :toDate',
          ExpressionAttributeValues: {
            ':accountId': accountId,
            ':fromDate': fromDate,
            ':toDate': toDate,
          },
          ExclusiveStartKey: lastKey,
        })
      );

      if (result.Items) {
        allOrders.push(...(result.Items as Order[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allOrders;
  }

  async updateOrderDelivery(
    accountId: string,
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
        Key: { accountId, orderId },
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

  async getOrdersWithDeliveryData(accountId: string): Promise<Order[]> {
    const allOrders: Order[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.ordersTable,
          KeyConditionExpression: 'accountId = :accountId',
          FilterExpression: 'attribute_exists(deliveryCarrier) AND attribute_exists(deliveryParcels)',
          ExpressionAttributeValues: {
            ':accountId': accountId,
          },
          ExclusiveStartKey: lastKey,
        })
      );

      allOrders.push(...((result.Items as Order[]) || []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allOrders;
  }

  async getOrderLinesByOrderId(accountId: string, orderId: string): Promise<OrderLineRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.orderLinesTable,
        IndexName: 'by-account-sku',
        KeyConditionExpression: 'accountId = :accountId',
        FilterExpression: 'orderId = :orderId',
        ExpressionAttributeValues: {
          ':accountId': accountId,
          ':orderId': orderId,
        },
      })
    );

    return (result.Items as OrderLineRecord[]) || [];
  }

  // ============ Order Lines ============

  async batchPutOrderLines(accountId: string, lines: OrderLineRecord[]): Promise<void> {
    const chunks = this.chunkArray(lines, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.orderLinesTable]: chunk.map((line) => ({
              PutRequest: {
                Item: {
                  ...line,
                  accountId,
                  // Composite sort key for efficient queries
                  skuOrderDate: `${line.sku}#${line.orderDate}#${line.orderId}`,
                },
              },
            })),
          },
        })
      );
    }
  }

  async getOrderLinesBySku(
    accountId: string,
    sku: string,
    fromDate?: string,
    toDate?: string
  ): Promise<OrderLineRecord[]> {
    // Use the by-account-sku GSI
    let keyCondition = 'accountId = :accountId AND begins_with(sku, :sku)';
    const expressionValues: Record<string, unknown> = {
      ':accountId': accountId,
      ':sku': sku,
    };

    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.orderLinesTable,
        IndexName: 'by-account-sku',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
        FilterExpression: fromDate && toDate
          ? 'orderDateDay >= :fromDate AND orderDateDay <= :toDate'
          : undefined,
        ...(fromDate && toDate && {
          ExpressionAttributeValues: {
            ...expressionValues,
            ':fromDate': fromDate,
            ':toDate': toDate,
          },
        }),
      })
    );

    return (result.Items as OrderLineRecord[]) || [];
  }

  async getOrderLinesByDateRange(
    accountId: string,
    fromDate: string,
    toDate: string
  ): Promise<OrderLineRecord[]> {
    const allLines: OrderLineRecord[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.orderLinesTable,
          IndexName: 'by-account-date',
          KeyConditionExpression: 'accountId = :accountId AND orderDateDay BETWEEN :fromDate AND :toDate',
          ExpressionAttributeValues: {
            ':accountId': accountId,
            ':fromDate': fromDate,
            ':toDate': toDate,
          },
          ExclusiveStartKey: lastKey,
        })
      );

      if (result.Items) {
        allLines.push(...(result.Items as OrderLineRecord[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allLines;
  }

  /**
   * Optimized version that only fetches fields needed for sales aggregation.
   * Returns ~70% less data than getOrderLinesByDateRange.
   */
  async getOrderLinesForAggregation(
    accountId: string,
    fromDate: string,
    toDate: string
  ): Promise<Pick<OrderLineRecord, 'sku' | 'channelName' | 'quantity' | 'lineTotalInclVat' | 'orderDateDay' | 'orderId' | 'orderDate'>[]> {
    const allLines: Pick<OrderLineRecord, 'sku' | 'channelName' | 'quantity' | 'lineTotalInclVat' | 'orderDateDay' | 'orderId' | 'orderDate'>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.orderLinesTable,
          IndexName: 'by-account-date',
          KeyConditionExpression: 'accountId = :accountId AND orderDateDay BETWEEN :fromDate AND :toDate',
          ExpressionAttributeValues: {
            ':accountId': accountId,
            ':fromDate': fromDate,
            ':toDate': toDate,
          },
          // Only fetch fields needed for aggregation - reduces data transfer by ~70%
          ProjectionExpression: 'sku, channelName, quantity, lineTotalInclVat, orderDateDay, orderId, orderDate',
          ExclusiveStartKey: lastKey,
        })
      );

      if (result.Items) {
        allLines.push(...(result.Items as Pick<OrderLineRecord, 'sku' | 'channelName' | 'quantity' | 'lineTotalInclVat' | 'orderDateDay' | 'orderId' | 'orderDate'>[]));
      }
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return allLines;
  }

  // ============ SKU History ============

  async putSkuHistory(accountId: string, record: SkuHistoryRecord): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.skuHistoryTable,
        Item: {
          ...record,
          accountId,
          skuDate: `${record.sku}#${record.date}`,
        },
      })
    );
  }

  async batchPutSkuHistory(accountId: string, records: SkuHistoryRecord[]): Promise<void> {
    if (records.length === 0) return;

    const chunks = this.chunkArray(records, 25);

    for (const chunk of chunks) {
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.skuHistoryTable]: chunk.map((record) => ({
              PutRequest: {
                Item: {
                  ...record,
                  accountId,
                  skuDate: `${record.sku}#${record.date}`,
                },
              },
            })),
          },
        })
      );
    }
  }

  async getSkuHistory(
    accountId: string,
    sku: string,
    fromDate?: string,
    toDate?: string
  ): Promise<SkuHistoryRecord[]> {
    let keyCondition = 'accountId = :accountId AND begins_with(skuDate, :skuPrefix)';
    const expressionValues: Record<string, unknown> = {
      ':accountId': accountId,
      ':skuPrefix': `${sku}#`,
    };

    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.skuHistoryTable,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
        ScanIndexForward: true,
      })
    );

    let records = (result.Items as SkuHistoryRecord[]) || [];

    // Filter by date range if provided
    if (fromDate && toDate) {
      records = records.filter((r) => r.date >= fromDate && r.date <= toDate);
    }

    return records;
  }

  // ============ Sales Aggregation ============

  async getSalesBySku(
    accountId: string,
    days: number = 7
  ): Promise<Map<string, { quantity: number; revenue: number }>> {
    const salesMap = new Map<string, { quantity: number; revenue: number }>();

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days);
    const fromDateStr = fromDate.toISOString().substring(0, 10);
    const toDateStr = today.toISOString().substring(0, 10);

    const lines = await this.getOrderLinesByDateRange(accountId, fromDateStr, toDateStr);

    for (const line of lines) {
      const existing = salesMap.get(line.sku) || { quantity: 0, revenue: 0 };
      existing.quantity += line.quantity;
      existing.revenue += line.lineTotalInclVat;
      salesMap.set(line.sku, existing);
    }

    return salesMap;
  }

  // ============ Price Changes (Audit Log) ============

  /**
   * Log a price change for audit trail
   */
  async logPriceChange(
    accountId: string,
    change: Omit<PriceChangeRecord, 'accountId'>
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.priceChangesTable,
        Item: {
          ...change,
          accountId,
          skuTimestamp: `${change.sku}#${change.changedAt}`,
        },
      })
    );
  }

  /**
   * Get price change history for a specific SKU
   */
  async getPriceHistory(
    accountId: string,
    sku: string,
    limit: number = 50
  ): Promise<PriceChangeRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.priceChangesTable,
        KeyConditionExpression: 'accountId = :accountId AND begins_with(skuTimestamp, :skuPrefix)',
        ExpressionAttributeValues: {
          ':accountId': accountId,
          ':skuPrefix': `${sku}#`,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (result.Items as PriceChangeRecord[]) || [];
  }

  /**
   * Get recent price changes by a specific user
   */
  async getPriceChangesByUser(
    accountId: string,
    userEmail: string,
    limit: number = 50
  ): Promise<PriceChangeRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.priceChangesTable,
        IndexName: 'by-account-user',
        KeyConditionExpression: 'accountId = :accountId AND changedBy = :userEmail',
        ExpressionAttributeValues: {
          ':accountId': accountId,
          ':userEmail': userEmail,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (result.Items as PriceChangeRecord[]) || [];
  }

  /**
   * Get recent price changes across all SKUs
   */
  async getRecentPriceChanges(
    accountId: string,
    limit: number = 100
  ): Promise<PriceChangeRecord[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.priceChangesTable,
        IndexName: 'by-account-date',
        KeyConditionExpression: 'accountId = :accountId',
        ExpressionAttributeValues: {
          ':accountId': accountId,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (result.Items as PriceChangeRecord[]) || [];
  }

  // ============ Utilities ============

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // ============ Import Jobs ============

  /**
   * Create a new import job with processing status
   */
  async createImportJob(jobId: string, type: 'costs' | 'delivery'): Promise<void> {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 24 * 60 * 60; // 24 hours from now

    await this.docClient.send(
      new PutCommand({
        TableName: this.importJobsTable,
        Item: {
          jobId,
          type,
          status: 'processing',
          createdAt: now.toISOString(),
          ttl,
        },
      })
    );
  }

  /**
   * Get an import job by ID
   */
  async getImportJob(jobId: string): Promise<{
    jobId: string;
    type: 'costs' | 'delivery';
    status: 'processing' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
    result?: Record<string, unknown>;
  } | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.importJobsTable,
        Key: { jobId },
      })
    );
    return result.Item as {
      jobId: string;
      type: 'costs' | 'delivery';
      status: 'processing' | 'completed' | 'failed';
      createdAt: string;
      completedAt?: string;
      result?: Record<string, unknown>;
    } | null;
  }

  /**
   * Update import job with completion status and result
   */
  async completeImportJob(
    jobId: string,
    status: 'completed' | 'failed',
    result: Record<string, unknown>
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.importJobsTable,
        Key: { jobId },
        UpdateExpression: 'SET #status = :status, completedAt = :completedAt, #result = :result',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':completedAt': new Date().toISOString(),
          ':result': result,
        },
      })
    );
  }
}

/**
 * Create V2 DynamoDB service from environment variables
 */
export function createDynamoDBServiceV2(): DynamoDBServiceV2 {
  return new DynamoDBServiceV2({
    accountsTable: process.env.ACCOUNTS_TABLE || 'repricing-v2-accounts',
    productsTable: process.env.PRODUCTS_TABLE || 'repricing-v2-products',
    rulesTable: process.env.PRICING_RULES_TABLE || 'repricing-v2-rules',
    proposalsTable: process.env.PRICE_PROPOSALS_TABLE || 'repricing-v2-proposals',
    channelsTable: process.env.CHANNEL_CONFIG_TABLE || 'repricing-v2-channels',
    ordersTable: process.env.ORDERS_TABLE || 'repricing-v2-orders',
    orderLinesTable: process.env.ORDER_LINES_TABLE || 'repricing-v2-order-lines',
    carrierCostsTable: process.env.CARRIER_COSTS_TABLE || 'repricing-v2-carrier-costs',
    skuHistoryTable: process.env.SKU_HISTORY_TABLE || 'repricing-v2-sku-history',
    priceChangesTable: process.env.PRICE_CHANGES_TABLE || 'repricing-v2-price-changes',
    importJobsTable: process.env.IMPORT_JOBS_TABLE || 'repricing-v2-import-jobs',
  });
}

/**
 * Import job status type
 */
export interface ImportJob {
  jobId: string;
  type: 'costs' | 'delivery';
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  result?: {
    totalUpdated?: number;
    matchedByBalterleySku?: number;
    totalRecords?: number;
    accountsProcessed?: number;
    accountResults?: Array<{ accountId: string; updated: number; matchedByBalterley: number }>;
    notFoundInAnyAccount?: number;
    sampleNotFound?: string[];
    error?: string;
  };
  ttl: number; // Auto-expire after 24 hours
}
