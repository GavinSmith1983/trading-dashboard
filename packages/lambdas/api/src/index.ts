import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createDynamoDBService,
  createChannelEngineService,
  Product,
  PricingRule,
  Channel,
  ProposalStatus,
  BulkApprovalRequest,
  CarrierCost,
  OrderLineRecord,
  normalizeCarrierName,
  getCarrierDisplayName,
  isExcludedCarrier,
  scrapeProductCompetitors,
  getCompetitorNameFromUrl,
  CompetitorUrl,
} from '@repricing/core';
import { v4 as uuid } from 'uuid';

const db = createDynamoDBService();

/**
 * API Gateway Lambda handler
 * Routes requests to appropriate handlers
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('API request:', {
    method: event.httpMethod,
    path: event.path,
    requestId: context.awsRequestId,
  });

  try {
    const path = event.path;
    const method = event.httpMethod;

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return response(200, null);
    }

    // Route requests
    if (path.startsWith('/products')) {
      return handleProducts(event);
    }
    if (path.startsWith('/proposals')) {
      return handleProposals(event);
    }
    if (path.startsWith('/rules')) {
      return handleRules(event);
    }
    if (path.startsWith('/channels')) {
      return handleChannels(event);
    }
    if (path.startsWith('/analytics')) {
      return handleAnalytics(event);
    }
    if (path.startsWith('/import')) {
      return handleImport(event);
    }
    if (path.startsWith('/carriers')) {
      // Check for recalculate endpoint first
      if (path === '/carriers/recalculate' && method === 'POST') {
        return handleRecalculateDeliveryCosts();
      }
      return handleCarriers(event);
    }
    if (path === '/products/fill-delivery-costs' && method === 'POST') {
      return handleFillDeliveryCostsByCategory();
    }
    if (path.startsWith('/history')) {
      // Backfill endpoint must be checked before general history
      if (path === '/history/backfill' && method === 'POST') {
        return handleHistoryBackfill(event);
      }
      return handleHistory(event);
    }
    if (path === '/sync' && method === 'POST') {
      return handleManualSync(event);
    }
    if (path.startsWith('/competitors')) {
      return handleCompetitors(event);
    }
    if (path === '/order-lines/backfill' && method === 'POST') {
      return handleOrderLinesBackfill(event);
    }
    if (path.startsWith('/prices')) {
      return handlePrices(event);
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('API error:', error);
    return response(500, {
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

// ============ Products ============

async function handleProducts(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const sku = event.pathParameters?.sku;

  if (method === 'GET' && !sku) {
    // List all products
    const products = await db.getAllProducts();
    return response(200, { items: products, count: products.length });
  }

  if (method === 'GET' && sku) {
    // Get single product
    const product = await db.getProduct(sku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }
    return response(200, product);
  }

  if (method === 'PUT' && sku) {
    // Update product (costs, delivery, mrp, competitor URLs)
    const body = JSON.parse(event.body || '{}');
    const existing = await db.getProduct(sku);

    if (!existing) {
      return response(404, { error: 'Product not found' });
    }

    const updated: Product = {
      ...existing,
      costPrice: body.costPrice ?? existing.costPrice,
      deliveryCost: body.deliveryCost ?? existing.deliveryCost,
      mrp: body.mrp ?? existing.mrp,
      category: body.category ?? existing.category,
      competitorUrls: body.competitorUrls ?? existing.competitorUrls,
    };

    await db.putProduct(updated);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Fill Delivery Costs by Category ============

/**
 * Calculates delivery costs for products without them, using category averages
 * derived ONLY from real order data (orders with deliveryCarrier populated).
 */
async function handleFillDeliveryCostsByCategory(): Promise<APIGatewayProxyResult> {
  console.log('[FillDeliveryCosts] Starting category-based delivery cost fill from real order data');

  // Get all data in parallel
  const [products, allOrders, carrierCosts] = await Promise.all([
    db.getAllProducts(),
    db.getAllOrders(),
    db.getAllCarrierCosts(),
  ]);

  // Build lookups
  const productsBySku = new Map(products.map(p => [p.sku.toUpperCase(), p]));
  const carrierCostMap = new Map(carrierCosts.map(c => [c.carrierId, c.costPerParcel]));

  // Filter to orders with actual delivery data from Vector Summary
  const ordersWithDelivery = allOrders.filter(
    order => order.deliveryCarrier && order.deliveryCarrier !== 'unknown'
  );
  console.log(`[FillDeliveryCosts] Found ${ordersWithDelivery.length} orders with real delivery data`);

  // Calculate delivery cost per SKU from real orders (same logic as recalculate)
  const skuDeliveryStats = new Map<string, {
    totalDeliveryCost: number;
    totalQuantity: number;
    orderCount: number;
  }>();

  for (const order of ordersWithDelivery) {
    const carrier = order.deliveryCarrier!;
    const carrierCost = carrierCostMap.get(carrier) || 0;

    if (carrierCost === 0) continue; // Skip if carrier has no cost set

    const lines = order.lines || [];
    if (lines.length === 0) continue;

    // Delivery cost is per order
    const orderDeliveryCost = carrierCost;

    // Calculate total order value for proportional split
    const totalOrderValue = lines.reduce((sum, line) => {
      const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
      return sum + lineValue;
    }, 0);

    for (const line of lines) {
      const sku = line.sku?.toUpperCase();
      if (!sku) continue;

      if (!skuDeliveryStats.has(sku)) {
        skuDeliveryStats.set(sku, {
          totalDeliveryCost: 0,
          totalQuantity: 0,
          orderCount: 0,
        });
      }

      const stats = skuDeliveryStats.get(sku)!;

      // Split delivery cost proportionally by line value
      const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
      const valueShare = totalOrderValue > 0 ? lineValue / totalOrderValue : 1 / lines.length;
      const lineDeliveryCost = orderDeliveryCost * valueShare;

      stats.totalDeliveryCost += lineDeliveryCost;
      stats.totalQuantity += line.quantity || 1;
      stats.orderCount += 1;
    }
  }

  console.log(`[FillDeliveryCosts] Calculated delivery stats for ${skuDeliveryStats.size} SKUs from orders`);

  // Now calculate category averages from SKUs with real order-derived delivery costs
  const categoryStats = new Map<string, { total: number; count: number }>();

  for (const [sku, stats] of skuDeliveryStats) {
    if (stats.totalQuantity === 0) continue;

    const product = productsBySku.get(sku);
    if (!product || !product.category) continue;

    const deliveryCostPerUnit = stats.totalDeliveryCost / stats.totalQuantity;
    const primaryCategory = product.category.split(',')[0].trim();

    const catStats = categoryStats.get(primaryCategory) || { total: 0, count: 0 };
    catStats.total += deliveryCostPerUnit;
    catStats.count += 1;
    categoryStats.set(primaryCategory, catStats);
  }

  // Calculate category averages
  const categoryAverages = new Map<string, number>();
  for (const [category, stats] of categoryStats) {
    categoryAverages.set(category, Math.round((stats.total / stats.count) * 100) / 100);
  }

  console.log(`[FillDeliveryCosts] Calculated averages for ${categoryAverages.size} categories from real order data`);

  // Calculate overall average as fallback
  let overallTotal = 0;
  let overallCount = 0;
  for (const stats of categoryStats.values()) {
    overallTotal += stats.total;
    overallCount += stats.count;
  }
  const overallAverage = overallCount > 0 ? Math.round((overallTotal / overallCount) * 100) / 100 : 0;
  console.log(`[FillDeliveryCosts] Overall average delivery cost from orders: £${overallAverage}`);

  // Find products without delivery costs and fill them using category averages
  const productsToUpdate: Product[] = [];
  const updateDetails: Array<{ sku: string; category: string; deliveryCost: number; source: string }> = [];

  for (const product of products) {
    // Skip products that already have order-derived delivery costs
    if (skuDeliveryStats.has(product.sku.toUpperCase())) continue;

    // Only fill products with no delivery cost
    if (product.deliveryCost && product.deliveryCost > 0) continue;

    let deliveryCost = 0;
    let source = 'none';

    if (product.category) {
      const primaryCategory = product.category.split(',')[0].trim();
      const categoryAvg = categoryAverages.get(primaryCategory);

      if (categoryAvg && categoryAvg > 0) {
        deliveryCost = categoryAvg;
        source = `category avg: ${primaryCategory}`;
      } else {
        // Use overall average as fallback
        deliveryCost = overallAverage;
        source = 'overall avg (no category data)';
      }
    } else {
      // No category - use overall average
      deliveryCost = overallAverage;
      source = 'overall avg (no category)';
    }

    if (deliveryCost > 0) {
      productsToUpdate.push({
        ...product,
        deliveryCost,
      });
      updateDetails.push({
        sku: product.sku,
        category: product.category || 'none',
        deliveryCost,
        source,
      });
    }
  }

  console.log(`[FillDeliveryCosts] Updating ${productsToUpdate.length} products`);

  // Batch update products
  if (productsToUpdate.length > 0) {
    await db.batchPutProducts(productsToUpdate);
  }

  // Build category summary for response
  const categorySummary: Array<{ category: string; avgDeliveryCost: number; skusWithOrderData: number }> = [];
  for (const [category, avg] of categoryAverages) {
    const stats = categoryStats.get(category)!;
    categorySummary.push({
      category,
      avgDeliveryCost: avg,
      skusWithOrderData: stats.count,
    });
  }
  categorySummary.sort((a, b) => b.skusWithOrderData - a.skusWithOrderData);

  return response(200, {
    message: 'Delivery cost fill complete (from real order data)',
    ordersWithDeliveryData: ordersWithDelivery.length,
    skusWithOrderDerivedCosts: skuDeliveryStats.size,
    categoriesWithData: categoryAverages.size,
    overallAverageDeliveryCost: overallAverage,
    productsUpdated: productsToUpdate.length,
    categorySummary: categorySummary.slice(0, 30),
    sampleUpdates: updateDetails.slice(0, 50),
  });
}

// ============ Proposals ============

async function handleProposals(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;
  const proposalId = event.pathParameters?.proposalId;

  // Bulk approve
  if (path.endsWith('/bulk-approve') && method === 'POST') {
    const body: BulkApprovalRequest = JSON.parse(event.body || '{}');
    const results = [];

    for (const id of body.proposalIds) {
      await db.updateProposalStatus(id, 'approved', body.reviewedBy, body.notes);
      results.push({ proposalId: id, status: 'approved' });
    }

    return response(200, { results });
  }

  // Bulk reject
  if (path.endsWith('/bulk-reject') && method === 'POST') {
    const body: BulkApprovalRequest = JSON.parse(event.body || '{}');
    const results = [];

    for (const id of body.proposalIds) {
      await db.updateProposalStatus(id, 'rejected', body.reviewedBy, body.notes);
      results.push({ proposalId: id, status: 'rejected' });
    }

    return response(200, { results });
  }

  // Bulk approve all filtered proposals
  if (path.endsWith('/bulk-approve-filtered') && method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { reviewedBy, notes, filters: filterParams } = body;

    // Build filters - always filter for pending status
    const filters = {
      status: 'pending' as ProposalStatus,
      batchId: filterParams?.batchId,
      brand: filterParams?.brand,
      searchTerm: filterParams?.search,
      hasWarnings: filterParams?.hasWarnings === true,
      appliedRuleName: filterParams?.appliedRuleName,
    };

    // Get all matching proposals (fetch all pages)
    const result = await db.queryProposals(filters, 1, 10000); // Large page size to get all
    const allProposals = result.items;

    // Approve all pending proposals
    let approvedCount = 0;
    for (const proposal of allProposals) {
      if (proposal.status === 'pending') {
        await db.updateProposalStatus(proposal.proposalId, 'approved', reviewedBy || 'user', notes);
        approvedCount++;
      }
    }

    return response(200, {
      success: true,
      approvedCount,
      message: `Approved ${approvedCount} proposals`
    });
  }

  // Push approved prices to ChannelEngine
  if (path.endsWith('/push') && method === 'POST') {
    return handlePushPrices(event);
  }

  // Get status counts for all proposals
  if (path.endsWith('/status-counts') && method === 'GET') {
    const [pending, approved, modified, rejected, pushed] = await Promise.all([
      db.getProposalsByStatus('pending'),
      db.getProposalsByStatus('approved'),
      db.getProposalsByStatus('modified'),
      db.getProposalsByStatus('rejected'),
      db.getProposalsByStatus('pushed'),
    ]);
    return response(200, {
      pending: pending.length,
      approved: approved.length,
      modified: modified.length,
      rejected: rejected.length,
      pushed: pushed.length,
      totalApproved: approved.length + modified.length,
    });
  }

  if (method === 'GET' && !proposalId) {
    // List proposals with filters
    const params = event.queryStringParameters || {};
    const filters = {
      status: params.status as ProposalStatus | undefined,
      batchId: params.batchId,
      brand: params.brand,
      searchTerm: params.search,
      hasWarnings: params.hasWarnings === 'true',
      appliedRuleName: params.appliedRuleName,
    };
    const page = parseInt(params.page || '1', 10);
    const pageSize = parseInt(params.pageSize || '50', 10);

    const result = await db.queryProposals(filters, page, pageSize);
    return response(200, result);
  }

  if (method === 'GET' && proposalId) {
    // Get single proposal
    const proposal = await db.getProposal(proposalId);
    if (!proposal) {
      return response(404, { error: 'Proposal not found' });
    }
    return response(200, proposal);
  }

  if (method === 'PUT' && proposalId) {
    // Update proposal (approve/reject/modify)
    const body = JSON.parse(event.body || '{}');
    const { action, modifiedPrice, notes, reviewedBy } = body;

    if (!action || !reviewedBy) {
      return response(400, { error: 'action and reviewedBy are required' });
    }

    let status: ProposalStatus;
    let approvedPrice: number | undefined;

    switch (action) {
      case 'approve':
        status = 'approved';
        break;
      case 'reject':
        status = 'rejected';
        break;
      case 'modify':
        if (modifiedPrice === undefined) {
          return response(400, { error: 'modifiedPrice required for modify action' });
        }
        status = 'modified';
        approvedPrice = modifiedPrice;
        break;
      default:
        return response(400, { error: 'Invalid action' });
    }

    await db.updateProposalStatus(proposalId, status, reviewedBy, notes, approvedPrice);

    const updated = await db.getProposal(proposalId);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
}

async function handlePushPrices(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const dryRun = body.dryRun === true;

  // Get approved proposals
  const approvedProposals = await db.getProposalsByStatus('approved');
  const modifiedProposals = await db.getProposalsByStatus('modified');
  const allApproved = [...approvedProposals, ...modifiedProposals];

  if (allApproved.length === 0) {
    return response(200, { message: 'No approved proposals to push', count: 0 });
  }

  // Prepare price updates
  const updates = allApproved.map((p) => ({
    sku: p.sku,
    price: p.approvedPrice ?? p.proposedPrice,
  }));

  if (dryRun) {
    return response(200, {
      dryRun: true,
      count: updates.length,
      updates,
    });
  }

  // Push to Google Sheets (which syncs to ChannelEngine)
  const gsSecretArn = process.env.GOOGLE_SHEETS_SECRET_ARN;
  if (!gsSecretArn) {
    return response(500, { error: 'Google Sheets not configured' });
  }

  try {
    const { createGoogleSheetsServiceFromSecret } = await import('@repricing/core');
    const gsService = await createGoogleSheetsServiceFromSecret(gsSecretArn, false); // false = write access
    const result = await gsService.updatePrices(updates);

    console.log(`Google Sheets updated: ${result.updated} SKUs, ${result.notFound.length} not found`);

    // Update proposal statuses to 'pushed'
    if (result.updated > 0) {
      for (const proposal of allApproved) {
        // Only mark as pushed if the SKU was found in the sheet
        if (!result.notFound.includes(proposal.sku)) {
          await db.updateProposalStatus(proposal.proposalId, 'pushed', 'system', 'Pushed to Google Sheets');
        }
      }
    }

    return response(200, {
      success: result.updated > 0,
      pushed: result.updated,
      notFound: result.notFound,
      message: `Updated ${result.updated} prices in Google Sheets. ChannelEngine will sync automatically.`,
    });
  } catch (err) {
    console.error('Failed to update Google Sheets:', err);
    return response(500, {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update Google Sheets',
    });
  }
}

// ============ Rules ============

async function handleRules(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const ruleId = event.pathParameters?.ruleId;

  if (method === 'GET' && !ruleId) {
    const rules = await db.getAllRules();
    return response(200, { items: rules, count: rules.length });
  }

  if (method === 'GET' && ruleId) {
    const rule = await db.getRule(ruleId);
    if (!rule) {
      return response(404, { error: 'Rule not found' });
    }
    return response(200, rule);
  }

  if (method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const rule: PricingRule = {
      ruleId: uuid(),
      name: body.name,
      description: body.description,
      priority: body.priority ?? 100,
      isActive: body.isActive ?? true,
      conditions: body.conditions || {},
      action: body.action,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.putRule(rule);
    return response(201, rule);
  }

  if (method === 'PUT' && ruleId) {
    const existing = await db.getRule(ruleId);
    if (!existing) {
      return response(404, { error: 'Rule not found' });
    }

    const body = JSON.parse(event.body || '{}');
    const updated: PricingRule = {
      ...existing,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      priority: body.priority ?? existing.priority,
      isActive: body.isActive ?? existing.isActive,
      conditions: body.conditions ?? existing.conditions,
      action: body.action ?? existing.action,
      updatedAt: new Date().toISOString(),
    };

    await db.putRule(updated);
    return response(200, updated);
  }

  if (method === 'DELETE' && ruleId) {
    await db.deleteRule(ruleId);
    return response(204, null);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Channels ============

async function handleChannels(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const channelId = event.pathParameters?.channelId;

  if (method === 'GET' && !channelId) {
    const channels = await db.getAllChannels();
    return response(200, { items: channels, count: channels.length });
  }

  if (method === 'GET' && channelId) {
    const channel = await db.getChannel(channelId);
    if (!channel) {
      return response(404, { error: 'Channel not found' });
    }
    return response(200, channel);
  }

  if (method === 'PUT' && channelId) {
    const existing = await db.getChannel(channelId);
    const body = JSON.parse(event.body || '{}');

    const updated: Channel = {
      channelId: channelId as any,
      name: body.name ?? existing?.name ?? channelId,
      isActive: body.isActive ?? existing?.isActive ?? true,
      commissionPercent: body.commissionPercent ?? existing?.commissionPercent ?? 0,
      fixedFee: body.fixedFee ?? existing?.fixedFee,
      paymentProcessingPercent: body.paymentProcessingPercent ?? existing?.paymentProcessingPercent,
      defaultAcosPercent: body.defaultAcosPercent ?? existing?.defaultAcosPercent,
      includeAdvertisingInMargin: body.includeAdvertisingInMargin ?? existing?.includeAdvertisingInMargin ?? true,
      vatPercent: body.vatPercent ?? existing?.vatPercent ?? 20,
      pricesIncludeVat: body.pricesIncludeVat ?? existing?.pricesIncludeVat ?? true,
      channelEngineId: body.channelEngineId ?? existing?.channelEngineId,
      lastUpdated: new Date().toISOString(),
    };

    await db.putChannel(updated);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Analytics ============

async function handleAnalytics(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const params = event.queryStringParameters || {};

  if (path.endsWith('/summary')) {
    const products = await db.getAllProducts();
    const pendingProposals = await db.getProposalsByStatus('pending');

    // Calculate margin on-the-fly for products with cost data
    const productsWithCostData = products.filter((p) => p.costPrice > 0 && p.currentPrice > 0);
    let totalMargin = 0;
    for (const p of productsWithCostData) {
      const priceExVat = p.currentPrice / 1.2;
      const twentyPercent = priceExVat * 0.2;
      const ppo = priceExVat - twentyPercent - (p.deliveryCost || 0) - p.costPrice;
      const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
      totalMargin += margin;
    }

    const summary = {
      totalProducts: products.length,
      productsWithCosts: productsWithCostData.length,
      productsWithoutCosts: products.filter((p) => !p.costPrice || p.costPrice === 0).length,
      outOfStock: products.filter((p) => p.stockLevel === 0).length,
      lowStock: products.filter((p) => p.stockLevel > 0 && p.stockLevel < 10).length,
      pendingProposals: pendingProposals.length,
      avgMargin: productsWithCostData.length > 0 ? totalMargin / productsWithCostData.length : 0,
    };

    return response(200, summary);
  }

  if (path.endsWith('/margins')) {
    const products = await db.getAllProducts();

    // Calculate margin on-the-fly and group by bands
    const marginBands = { negative: 0, low: 0, target: 0, high: 0 };
    let productsWithMargin = 0;

    for (const p of products) {
      if (p.costPrice > 0 && p.currentPrice > 0) {
        const priceExVat = p.currentPrice / 1.2;
        const twentyPercent = priceExVat * 0.2;
        const ppo = priceExVat - twentyPercent - (p.deliveryCost || 0) - p.costPrice;
        const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
        productsWithMargin++;

        if (margin < 0) marginBands.negative++;
        else if (margin < 15) marginBands.low++;
        else if (margin < 30) marginBands.target++;
        else marginBands.high++;
      }
    }

    return response(200, { marginBands, total: products.length, withCostData: productsWithMargin });
  }

  if (path.endsWith('/sales')) {
    const days = parseInt(params.days || '30', 10);
    const includeDaily = params.includeDaily === 'true';
    const includePreviousYear = params.includePreviousYear === 'true';

    // Single scan to get all order lines in date range
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days);
    const fromDateStr = fromDate.toISOString().substring(0, 10);
    const toDateStr = today.toISOString().substring(0, 10);

    const orderLines = await db.getOrderLinesByDateRange(fromDateStr, toDateStr);

    // Also fetch previous year data if requested
    let previousYearOrderLines: typeof orderLines = [];
    let previousYearFromDateStr = '';
    let previousYearToDateStr = '';
    if (includePreviousYear) {
      const previousYearFromDate = new Date(fromDate);
      previousYearFromDate.setFullYear(previousYearFromDate.getFullYear() - 1);
      const previousYearToDate = new Date(today);
      previousYearToDate.setFullYear(previousYearToDate.getFullYear() - 1);
      previousYearFromDateStr = previousYearFromDate.toISOString().substring(0, 10);
      previousYearToDateStr = previousYearToDate.toISOString().substring(0, 10);
      previousYearOrderLines = await db.getOrderLinesByDateRange(previousYearFromDateStr, previousYearToDateStr);
    }

    // Aggregate by SKU, channel, and optionally by day
    const salesBySku: Record<string, { quantity: number; revenue: number }> = {};
    const totalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }> = {};
    const dailySales: Record<string, Record<string, { quantity: number; revenue: number; orders: number }>> = {};
    const orderIdsByDate: Record<string, Set<string>> = {};
    const allOrderIds = new Set<string>();

    for (const line of orderLines) {
      const sku = line.sku;
      const channel = line.channelName || 'Unknown';
      const dateDay = line.orderDateDay || '';
      const orderId = line.orderId || '';

      // SKU aggregation
      if (!salesBySku[sku]) {
        salesBySku[sku] = { quantity: 0, revenue: 0 };
      }
      salesBySku[sku].quantity += line.quantity || 0;
      salesBySku[sku].revenue += line.lineTotalInclVat || 0;

      // Channel aggregation
      if (!totalsByChannel[channel]) {
        totalsByChannel[channel] = { quantity: 0, revenue: 0, orders: 0 };
      }
      totalsByChannel[channel].quantity += line.quantity || 0;
      totalsByChannel[channel].revenue += line.lineTotalInclVat || 0;

      // Track unique orders per channel
      const orderKey = `${channel}:${orderId}`;
      if (!allOrderIds.has(orderKey)) {
        allOrderIds.add(orderKey);
        totalsByChannel[channel].orders++;
      }

      // Daily aggregation (if requested)
      if (includeDaily && dateDay) {
        if (!dailySales[dateDay]) {
          dailySales[dateDay] = {};
          orderIdsByDate[dateDay] = new Set();
        }
        if (!dailySales[dateDay][channel]) {
          dailySales[dateDay][channel] = { quantity: 0, revenue: 0, orders: 0 };
        }

        dailySales[dateDay][channel].quantity += line.quantity || 0;
        dailySales[dateDay][channel].revenue += line.lineTotalInclVat || 0;

        const dayOrderKey = `${channel}:${orderId}`;
        if (!orderIdsByDate[dateDay].has(dayOrderKey)) {
          orderIdsByDate[dateDay].add(dayOrderKey);
          dailySales[dateDay][channel].orders++;
        }
      }
    }

    // Calculate totals
    let totalQuantity = 0;
    let totalRevenue = 0;
    let totalOrders = 0;
    for (const channelData of Object.values(totalsByChannel)) {
      totalQuantity += channelData.quantity;
      totalRevenue += channelData.revenue;
      totalOrders += channelData.orders;
    }

    // Process previous year data if requested
    let previousYearDailySales: Record<string, { quantity: number; revenue: number; orders: number }> | undefined;
    let previousYearTotals: { quantity: number; revenue: number; orders: number } | undefined;
    let previousYearTotalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }> | undefined;
    if (includePreviousYear && previousYearOrderLines.length > 0) {
      previousYearDailySales = {};
      previousYearTotalsByChannel = {};
      const pyOrderIdsByDate: Record<string, Set<string>> = {};
      let pyTotalQuantity = 0;
      let pyTotalRevenue = 0;
      let pyTotalOrders = 0;
      const pyAllOrderIds = new Set<string>();
      const pyChannelOrderIds: Record<string, Set<string>> = {};

      for (const line of previousYearOrderLines) {
        const dateDay = line.orderDateDay || '';
        const orderId = line.orderId || '';
        const channel = line.channelName || 'Unknown';

        // Shift date forward by 1 year to align with current year
        if (dateDay) {
          const [year, month, day] = dateDay.split('-').map(Number);
          const shiftedDate = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          if (!previousYearDailySales[shiftedDate]) {
            previousYearDailySales[shiftedDate] = { quantity: 0, revenue: 0, orders: 0 };
            pyOrderIdsByDate[shiftedDate] = new Set();
          }

          previousYearDailySales[shiftedDate].quantity += line.quantity || 0;
          previousYearDailySales[shiftedDate].revenue += line.lineTotalInclVat || 0;

          if (!pyOrderIdsByDate[shiftedDate].has(orderId)) {
            pyOrderIdsByDate[shiftedDate].add(orderId);
            previousYearDailySales[shiftedDate].orders++;
          }
        }

        // Previous year channel aggregation
        if (!previousYearTotalsByChannel[channel]) {
          previousYearTotalsByChannel[channel] = { quantity: 0, revenue: 0, orders: 0 };
          pyChannelOrderIds[channel] = new Set();
        }
        previousYearTotalsByChannel[channel].quantity += line.quantity || 0;
        previousYearTotalsByChannel[channel].revenue += line.lineTotalInclVat || 0;

        const orderKey = `${channel}:${orderId}`;
        if (!pyChannelOrderIds[channel].has(orderKey)) {
          pyChannelOrderIds[channel].add(orderKey);
          previousYearTotalsByChannel[channel].orders++;
        }

        // Previous year totals
        pyTotalQuantity += line.quantity || 0;
        pyTotalRevenue += line.lineTotalInclVat || 0;
        if (!pyAllOrderIds.has(orderId)) {
          pyAllOrderIds.add(orderId);
          pyTotalOrders++;
        }
      }

      previousYearTotals = {
        quantity: pyTotalQuantity,
        revenue: Math.round(pyTotalRevenue * 100) / 100,
        orders: pyTotalOrders,
      };
    }

    // Build category breakdown by joining with products
    const includeCategories = params.includeCategories === 'true';
    let totalsByCategory: Record<string, { quantity: number; revenue: number; orders: number }> | undefined;
    let previousYearTotalsByCategory: Record<string, { quantity: number; revenue: number; orders: number }> | undefined;

    if (includeCategories) {
      // Get all products to map SKU -> category
      const products = await db.getAllProducts();
      const skuToCategory: Record<string, string> = {};
      for (const product of products) {
        skuToCategory[product.sku] = product.category || 'Uncategorized';
      }

      // Current year category aggregation
      totalsByCategory = {};
      const categoryOrderIds: Record<string, Set<string>> = {};

      for (const line of orderLines) {
        const category = skuToCategory[line.sku] || 'Uncategorized';
        const orderId = line.orderId || '';

        if (!totalsByCategory[category]) {
          totalsByCategory[category] = { quantity: 0, revenue: 0, orders: 0 };
          categoryOrderIds[category] = new Set();
        }
        totalsByCategory[category].quantity += line.quantity || 0;
        totalsByCategory[category].revenue += line.lineTotalInclVat || 0;

        const orderKey = `${category}:${orderId}`;
        if (!categoryOrderIds[category].has(orderKey)) {
          categoryOrderIds[category].add(orderKey);
          totalsByCategory[category].orders++;
        }
      }

      // Previous year category aggregation
      if (includePreviousYear && previousYearOrderLines.length > 0) {
        previousYearTotalsByCategory = {};
        const pyCategoryOrderIds: Record<string, Set<string>> = {};

        for (const line of previousYearOrderLines) {
          const category = skuToCategory[line.sku] || 'Uncategorized';
          const orderId = line.orderId || '';

          if (!previousYearTotalsByCategory[category]) {
            previousYearTotalsByCategory[category] = { quantity: 0, revenue: 0, orders: 0 };
            pyCategoryOrderIds[category] = new Set();
          }
          previousYearTotalsByCategory[category].quantity += line.quantity || 0;
          previousYearTotalsByCategory[category].revenue += line.lineTotalInclVat || 0;

          const orderKey = `${category}:${orderId}`;
          if (!pyCategoryOrderIds[category].has(orderKey)) {
            pyCategoryOrderIds[category].add(orderKey);
            previousYearTotalsByCategory[category].orders++;
          }
        }
      }
    }

    const result: Record<string, unknown> = {
      days,
      fromDate: fromDateStr,
      toDate: toDateStr,
      skuCount: Object.keys(salesBySku).length,
      sales: salesBySku,
      totalsByChannel,
      totals: {
        quantity: totalQuantity,
        revenue: Math.round(totalRevenue * 100) / 100,
        orders: totalOrders,
      },
      channels: Object.keys(totalsByChannel).sort(),
    };

    if (includeDaily) {
      result.dailySales = dailySales;
    }

    if (includePreviousYear) {
      result.previousYear = {
        fromDate: previousYearFromDateStr,
        toDate: previousYearToDateStr,
        dailySales: previousYearDailySales || {},
        totals: previousYearTotals || { quantity: 0, revenue: 0, orders: 0 },
        totalsByChannel: previousYearTotalsByChannel || {},
      };
    }

    if (includeCategories) {
      result.totalsByCategory = totalsByCategory || {};
      result.categories = Object.keys(totalsByCategory || {}).sort();
      if (includePreviousYear) {
        result.previousYearTotalsByCategory = previousYearTotalsByCategory || {};
      }
    }

    return response(200, result);
  }

  if (path.endsWith('/insights')) {
    return handleInsights();
  }

  return response(404, { error: 'Analytics endpoint not found' });
}

// ============ Insights ============

interface InsightProduct {
  sku: string;
  title: string;
  brand: string;
  imageUrl?: string;
  currentPrice: number;
  costPrice: number;
  deliveryCost: number;
  stockLevel: number;
  margin: number;
  avgDailySales: number;
  avgDailyRevenue: number;
  daysOfStock: number | null;
}

interface InsightCategory {
  id: string;
  title: string;
  description: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  products: InsightProduct[];
}

async function handleInsights(): Promise<APIGatewayProxyResult> {
  const products = await db.getAllProducts();

  // Get 180-day sales data for calculating avg daily sales
  const salesMap = await db.getSalesBySku(180);

  // Helper to calculate margin
  const calculateMargin = (p: Product): number => {
    if (!p.currentPrice || p.currentPrice <= 0) return 0;
    const priceExVat = p.currentPrice / 1.2; // Remove 20% VAT
    const channelFee = priceExVat * 0.15; // ~15% average channel fee
    const totalCost = (p.costPrice || 0) + (p.deliveryCost || 0) + channelFee;
    const profit = priceExVat - totalCost;
    return (profit / priceExVat) * 100;
  };

  // Helper to create insight product
  const toInsightProduct = (p: Product, salesData?: { quantity: number; revenue: number }): InsightProduct => {
    const avgDailySales = salesData ? salesData.quantity / 180 : 0;
    const avgDailyRevenue = salesData ? salesData.revenue / 180 : 0;
    const margin = calculateMargin(p);
    const daysOfStock = avgDailySales > 0 ? p.stockLevel / avgDailySales : null;

    return {
      sku: p.sku,
      title: p.title || '',
      brand: p.brand || '',
      imageUrl: p.imageUrl,
      currentPrice: p.currentPrice || 0,
      costPrice: p.costPrice || 0,
      deliveryCost: p.deliveryCost || 0,
      stockLevel: p.stockLevel || 0,
      margin,
      avgDailySales,
      avgDailyRevenue,
      daysOfStock,
    };
  };

  // Build enriched product list with sales data
  const enrichedProducts = products.map(p => {
    const salesData = salesMap.get(p.sku);
    return { product: p, salesData, insight: toInsightProduct(p, salesData) };
  });

  // Define insight categories
  const insights: InsightCategory[] = [];

  // 1. Low Sales & High Margin: Sales < 0.25/day but margin > 40% (exclude OOS)
  const lowSalesHighMargin = enrichedProducts.filter(({ insight }) =>
    insight.avgDailySales < 0.25 && insight.margin > 40 && insight.stockLevel > 0
  );
  insights.push({
    id: 'low-sales-high-margin',
    title: 'Low Sales & High Margin',
    description: 'Products selling less than 0.25 units/day but with over 40% margin. Consider promotions or visibility improvements.',
    count: lowSalesHighMargin.length,
    severity: 'info',
    products: lowSalesHighMargin.map(e => e.insight).slice(0, 100),
  });

  // 2. Danger Stock: Sales > 0.5/day but < 2 weeks of stock
  const dangerStock = enrichedProducts.filter(({ insight }) =>
    insight.avgDailySales > 0.5 &&
    insight.daysOfStock !== null &&
    insight.daysOfStock > 0 &&
    insight.daysOfStock < 14
  );
  insights.push({
    id: 'danger-stock',
    title: 'Danger Stock',
    description: 'Products selling over 0.5 units/day with less than 2 weeks of stock remaining. Reorder urgently.',
    count: dangerStock.length,
    severity: 'critical',
    products: dangerStock.map(e => e.insight).slice(0, 100),
  });

  // 3. OOS Stock: Sales > 0.5/day but 0 stock
  const oosStock = enrichedProducts.filter(({ insight }) =>
    insight.avgDailySales > 0.5 && insight.stockLevel === 0
  );
  insights.push({
    id: 'oos-stock',
    title: 'Out of Stock (High Demand)',
    description: 'Products with strong sales (over 0.5 units/day) that are currently out of stock. Lost revenue opportunity.',
    count: oosStock.length,
    severity: 'critical',
    products: oosStock.map(e => e.insight).slice(0, 100),
  });

  // 4. Low Margin: Margin below 25%
  const lowMargin = enrichedProducts.filter(({ insight }) =>
    insight.margin >= 0 && insight.margin < 25 && insight.currentPrice > 0
  );
  insights.push({
    id: 'low-margin',
    title: 'Low Margin',
    description: 'Products with margin below 25%. Review pricing or costs.',
    count: lowMargin.length,
    severity: 'warning',
    products: lowMargin.map(e => e.insight).slice(0, 100),
  });

  // 5. Negative Margin: Products losing money
  const negativeMargin = enrichedProducts.filter(({ insight }) =>
    insight.margin < 0 && insight.currentPrice > 0
  );
  insights.push({
    id: 'negative-margin',
    title: 'Negative Margin',
    description: 'Products losing money on every sale. Immediate price increase required or delist.',
    count: negativeMargin.length,
    severity: 'critical',
    products: negativeMargin.map(e => e.insight).slice(0, 100),
  });

  // 6. SKU with no price
  const noPrice = enrichedProducts.filter(({ product }) =>
    !product.currentPrice || product.currentPrice <= 0
  );
  insights.push({
    id: 'no-price',
    title: 'Missing Price',
    description: 'Products without a valid price set. These cannot be sold.',
    count: noPrice.length,
    severity: 'critical',
    products: noPrice.map(e => e.insight).slice(0, 100),
  });

  // 7. SKU with no title
  const noTitle = enrichedProducts.filter(({ product }) =>
    !product.title || product.title.trim() === ''
  );
  insights.push({
    id: 'no-title',
    title: 'Missing Title',
    description: 'Products without a title. Product data may be incomplete.',
    count: noTitle.length,
    severity: 'warning',
    products: noTitle.map(e => e.insight).slice(0, 100),
  });

  return response(200, { insights });
}

// ============ Import ============

async function handleImport(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;

  if (path.endsWith('/costs') && event.httpMethod === 'POST') {
    // Parse CSV from body
    const body = JSON.parse(event.body || '{}');
    const csvData: Array<{ sku: string; costPrice: number; deliveryCost?: number }> = body.data;

    if (!csvData || !Array.isArray(csvData)) {
      return response(400, { error: 'Invalid data format. Expected { data: [...] }' });
    }

    // Build lookup maps for case-insensitive SKU matching and Balterley SKU fallback
    const { bySku, byBalterleySku } = await db.getProductLookupMap();
    console.log(`[Import] Built lookup maps: ${bySku.size} products by SKU, ${byBalterleySku.size} by Balterley SKU`);

    let updated = 0;
    let notFound = 0;
    let matchedByBalterley = 0;
    const notFoundSkus: string[] = [];
    const productsToUpdate: Product[] = [];

    for (const row of csvData) {
      const skuUpper = row.sku.toUpperCase().trim();

      // Try matching by primary SKU first (case-insensitive)
      let product = bySku.get(skuUpper);

      // If not found, try matching by Balterley SKU
      if (!product) {
        product = byBalterleySku.get(skuUpper);
        if (product) {
          matchedByBalterley++;
        }
      }

      if (product) {
        product.costPrice = row.costPrice;
        if (row.deliveryCost !== undefined) {
          product.deliveryCost = row.deliveryCost;
        }
        productsToUpdate.push(product);
        updated++;
      } else {
        notFound++;
        if (notFoundSkus.length < 20) {
          notFoundSkus.push(row.sku);
        }
      }
    }

    // Batch write all updates for performance (instead of individual puts)
    if (productsToUpdate.length > 0) {
      console.log(`[Import] Batch writing ${productsToUpdate.length} products...`);
      await db.batchPutProducts(productsToUpdate);
    }

    // Find database SKUs that weren't in the import file (missing costs)
    const importedSkuSet = new Set(csvData.map(row => row.sku.toUpperCase().trim()));
    console.log(`[Import] importedSkuSet size: ${importedSkuSet.size}, bySku size: ${bySku.size}`);

    const dbSkusMissingFromFile: string[] = [];
    let missingCount = 0;
    for (const [skuUpper, product] of bySku) {
      if (!importedSkuSet.has(skuUpper)) {
        missingCount++;
        if (dbSkusMissingFromFile.length < 50) {
          dbSkusMissingFromFile.push(product.sku);
        }
      }
    }
    const totalDbSkusMissingFromFile = missingCount;
    console.log(`[Import] Found ${missingCount} DB SKUs missing from file, collected ${dbSkusMissingFromFile.length} samples`);

    console.log(`[Import] Complete: ${updated} updated, ${notFound} not found in DB, ${totalDbSkusMissingFromFile} DB SKUs missing from file, ${matchedByBalterley} matched by Balterley SKU`);
    if (notFoundSkus.length > 0) {
      console.log(`[Import] Sample file SKUs not in DB: ${notFoundSkus.join(', ')}`);
    }
    if (dbSkusMissingFromFile.length > 0) {
      console.log(`[Import] Sample DB SKUs missing from file: ${dbSkusMissingFromFile.join(', ')}`);
    }

    return response(200, {
      message: 'Cost import complete',
      updated,
      notFoundInDb: notFound,
      matchedByBalterleySku: matchedByBalterley,
      total: csvData.length,
      sampleNotFoundInDb: notFoundSkus.length > 0 ? notFoundSkus : undefined,
      dbProductsMissingFromFile: totalDbSkusMissingFromFile,
      sampleDbSkusMissingFromFile: dbSkusMissingFromFile.length > 0 ? dbSkusMissingFromFile : undefined,
    });
  }

  // Delivery report import (Vector Summary)
  if (path.endsWith('/delivery') && event.httpMethod === 'POST') {
    return handleDeliveryImport(event);
  }

  return response(404, { error: 'Import endpoint not found' });
}

// ============ Delivery Import ============

async function handleDeliveryImport(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const deliveryData: Array<{
    orderNumber: string;
    parcels: number;
    carrier: string;
  }> = body.data;

  if (!deliveryData || !Array.isArray(deliveryData)) {
    return response(400, { error: 'Invalid data format. Expected { data: [...] }' });
  }

  console.log(`[DeliveryImport] Processing ${deliveryData.length} delivery records`);

  // Get carrier costs for lookup
  const carrierCosts = await db.getAllCarrierCosts();
  const carrierCostMap = new Map(carrierCosts.map(c => [c.carrierId, c.costPerParcel]));
  console.log(`[DeliveryImport] Loaded ${carrierCosts.length} carrier cost configurations`);

  // Get all orders for matching
  const allOrders = await db.getAllOrders();
  console.log(`[DeliveryImport] Loaded ${allOrders.length} orders for matching`);


  // Get all products for SKU delivery cost updates
  const allProducts = await db.getAllProducts();
  const productsBySku = new Map(allProducts.map(p => [p.sku, p]));
  console.log(`[DeliveryImport] Loaded ${allProducts.length} products for delivery cost calculation`);
  // Create lookup map for orders by channelOrderNo
  // Also create a lookup by base PO number (without suffix like -A, -B, -REM)
  const orderByChannelOrderNo = new Map(allOrders.map(o => [o.channelOrderNo, o]));
  const orderByBasePoNumber = new Map<string, typeof allOrders[0]>();
  for (const order of allOrders) {
    if (order.channelOrderNo && order.channelOrderNo.includes('-')) {
      const basePo = order.channelOrderNo.split('-')[0];
      // Only add if not already present (first match wins)
      if (!orderByBasePoNumber.has(basePo)) {
        orderByBasePoNumber.set(basePo, order);
      }
    }
  }

  const carriersFound = new Set<string>();
  const excludedCarriers = new Set<string>();
  let ordersProcessed = 0;
  let ordersMatched = 0;
  let ordersSkipped = 0; // Excluded carriers
  let ordersNotFound = 0;

  // Track SKU delivery stats for calculating delivery cost per unit
  // totalDeliveryCost = sum of (parcels × carrier cost) for all orders containing this SKU
  // totalQuantity = sum of line quantities across all orders
  // deliveryCostPerUnit = totalDeliveryCost / totalQuantity
  const skuDeliveryStats = new Map<string, {
    carrierCounts: Record<string, number>;
    totalDeliveryCost: number;
    totalQuantity: number;
    orderCount: number;
  }>();

  // Process delivery records
  for (const record of deliveryData) {
    ordersProcessed++;

    // Skip excluded carriers (Hold Delivery, Consolidated Delivery, today_despatch)
    if (isExcludedCarrier(record.carrier)) {
      excludedCarriers.add(record.carrier);
      ordersSkipped++;
      continue;
    }

    const normalizedCarrier = normalizeCarrierName(record.carrier);
    if (normalizedCarrier !== 'unknown') {
      carriersFound.add(normalizedCarrier);
    }

    // Try to match order by PONumber
    // PONumber formats: "65061", "12320364167549-REM", etc.
    const poNumber = record.orderNumber.trim();

    // Try direct match first
    let matchedOrder = orderByChannelOrderNo.get(poNumber);

    // If not found, try matching by base PO number
    // Vector might send "1054423487" but DB has "1054423487-A"
    if (!matchedOrder) {
      // Strip suffix from Vector input and try base lookup
      const basePoNumber = poNumber.includes('-') ? poNumber.split('-')[0] : poNumber;
      matchedOrder = orderByBasePoNumber.get(basePoNumber);
    }

    if (matchedOrder) {
      // Update order with delivery info
      await db.updateOrderDelivery(matchedOrder.orderId, {
        deliveryCarrier: normalizedCarrier,
        deliveryCarrierRaw: record.carrier,
        deliveryParcels: record.parcels,
      });
      ordersMatched++;

      // Aggregate delivery stats by SKU from order lines
      // Split delivery cost proportionally by line value (so accessories don't get full delivery cost)
      const lines = matchedOrder.lines || [];
      const carrierCost = carrierCostMap.get(normalizedCarrier) || 0;
      // Delivery cost is per order, not per parcel (parcels is just how warehouse splits shipment)
      const orderDeliveryCost = carrierCost;

      // Calculate total order value for proportional split
      // Use lineTotalInclVat directly (it already includes quantity),
      // only multiply by quantity when falling back to unitPriceInclVat
      const totalOrderValue = lines.reduce((sum, line) => {
        const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
        return sum + lineValue;
      }, 0);

      for (const line of lines) {
        const sku = line.sku;
        if (!sku) continue;

        if (!skuDeliveryStats.has(sku)) {
          skuDeliveryStats.set(sku, {
            carrierCounts: {},
            totalDeliveryCost: 0,
            totalQuantity: 0,
            orderCount: 0,
          });
        }

        const stats = skuDeliveryStats.get(sku)!;
        stats.carrierCounts[normalizedCarrier] = (stats.carrierCounts[normalizedCarrier] || 0) + 1;

        // Split delivery cost proportionally by line value
        // Use lineTotalInclVat directly (it already includes quantity)
        const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
        const valueShare = totalOrderValue > 0 ? lineValue / totalOrderValue : 1 / lines.length;
        const lineDeliveryCost = orderDeliveryCost * valueShare;

        stats.totalDeliveryCost += lineDeliveryCost;
        stats.totalQuantity += line.quantity || 1;
        stats.orderCount += 1;
      }
    } else {
      ordersNotFound++;
    }
  }

  // Auto-create carrier cost entries for any new carriers found
  const newCarriers: CarrierCost[] = [];
  for (const carrierId of carriersFound) {
    if (!carrierCostMap.has(carrierId)) {
      const newCarrier: CarrierCost = {
        carrierId,
        carrierName: getCarrierDisplayName(carrierId),
        costPerParcel: 0, // Default cost - user needs to set
        isActive: true,
        lastUpdated: new Date().toISOString(),
      };
      newCarriers.push(newCarrier);
      // Add to map so we have it for cost calculation
      carrierCostMap.set(carrierId, 0);
    }
  }

  if (newCarriers.length > 0) {
    await db.batchPutCarrierCosts(newCarriers);
    console.log(`[DeliveryImport] Created ${newCarriers.length} new carrier entries`);
  }

  // Calculate delivery costs per SKU based on predominant carrier
  let productsUpdated = 0;
  const skuDeliveryCosts: Array<{ sku: string; carrier: string; cost: number; totalQuantity: number; totalDeliveryCost: number }> = [];

  for (const [sku, stats] of skuDeliveryStats) {
    // Find predominant carrier (most frequently used)
    let predominantCarrier = 'unknown';
    let maxCount = 0;
    for (const [carrier, count] of Object.entries(stats.carrierCounts)) {
      if (count > maxCount) {
        maxCount = count;
        predominantCarrier = carrier;
      }
    }

    // Calculate delivery cost per unit
    // deliveryCostPerUnit = totalDeliveryCost / totalQuantity
    const deliveryCost = stats.totalQuantity > 0
      ? stats.totalDeliveryCost / stats.totalQuantity
      : 0;

    // For reporting, also get the predominant carrier cost
    const carrierCostPerParcel = carrierCostMap.get(predominantCarrier) || 0;

    // Update product if it exists and has delivery cost data
    const product = productsBySku.get(sku);
    if (product && stats.totalDeliveryCost > 0) {
      // Round to 2 decimal places
      const roundedCost = Math.round(deliveryCost * 100) / 100;

      // Only update if cost has changed
      if (product.deliveryCost !== roundedCost) {
        await db.putProduct({
          ...product,
          deliveryCost: roundedCost,
        });
        productsUpdated++;
      }

      skuDeliveryCosts.push({
        sku,
        carrier: predominantCarrier,
        cost: roundedCost,
        totalQuantity: stats.totalQuantity,
        totalDeliveryCost: Math.round(stats.totalDeliveryCost * 100) / 100,
      });
    } else if (product) {
      // No delivery cost data - track for reporting
      skuDeliveryCosts.push({
        sku,
        carrier: predominantCarrier,
        cost: 0,
        totalQuantity: stats.totalQuantity,
        totalDeliveryCost: 0,
      });
    }
  }

  console.log(`[DeliveryImport] Complete: ${ordersMatched} matched, ${ordersNotFound} not found, ${ordersSkipped} skipped (excluded carriers), ${productsUpdated} products updated with delivery costs`);

  // Build note with actionable info
  let note = '';
  if (ordersMatched === 0) {
    note = 'No orders matched. Check that PONumber in Vector Summary matches your ChannelEngine order IDs.';
  } else {
    const parts = [];
    parts.push(`Updated ${ordersMatched} orders with delivery info.`);
    if (productsUpdated > 0) {
      parts.push(`Updated ${productsUpdated} products with delivery costs.`);
    }
    if (newCarriers.length > 0) {
      parts.push('New carriers created - please set costs on the Delivery Costs page.');
    }
    const carriersWithNoCost = Array.from(carriersFound).filter(c => carrierCostMap.get(c) === 0);
    if (carriersWithNoCost.length > 0) {
      parts.push(`Carriers missing costs (${carriersWithNoCost.join(', ')}) - set costs to calculate delivery cost per SKU.`);
    }
    note = parts.join(' ');
  }

  return response(200, {
    message: 'Delivery import complete',
    ordersProcessed,
    ordersMatched,
    ordersNotFound,
    ordersSkipped,
    productsUpdated,
    excludedCarriers: Array.from(excludedCarriers),
    carriersFound: Array.from(carriersFound),
    newCarriersCreated: newCarriers.map(c => c.carrierName),
    skuDeliveryCosts: skuDeliveryCosts.slice(0, 50), // Return first 50 for visibility
    note,
  });
}

// ============ Recalculate Delivery Costs ============

/**
 * Recalculates delivery costs for all products based on existing order delivery data.
 * This aggregates delivery costs from all orders that have delivery info,
 * using the corrected proportional split logic.
 */
async function handleRecalculateDeliveryCosts(): Promise<APIGatewayProxyResult> {
  console.log('[RecalculateDelivery] Starting recalculation from order history');

  // Get all orders and carrier costs
  const [allOrders, carrierCosts, allProducts] = await Promise.all([
    db.getAllOrders(),
    db.getAllCarrierCosts(),
    db.getAllProducts(),
  ]);

  // Build carrier cost lookup
  const carrierCostMap = new Map<string, number>();
  for (const carrier of carrierCosts) {
    carrierCostMap.set(carrier.carrierId, carrier.costPerParcel);
  }

  // Build product lookup by SKU
  const productsBySku = new Map<string, Product>();
  for (const product of allProducts) {
    productsBySku.set(product.sku.toUpperCase(), product);
  }

  // Filter orders that have delivery info
  const ordersWithDelivery = allOrders.filter(
    order => order.deliveryCarrier && order.deliveryParcels && order.deliveryParcels > 0
  );

  console.log(`[RecalculateDelivery] Found ${ordersWithDelivery.length} orders with delivery data out of ${allOrders.length} total`);

  // Aggregate delivery stats by SKU
  const skuDeliveryStats = new Map<string, {
    carrierCounts: Record<string, number>;
    totalDeliveryCost: number;
    totalQuantity: number;
    orderCount: number;
  }>();

  let ordersProcessed = 0;
  let ordersSkipped = 0;

  for (const order of ordersWithDelivery) {
    const carrier = order.deliveryCarrier!;
    const parcels = order.deliveryParcels!;

    // Skip excluded carriers
    if (isExcludedCarrier(carrier)) {
      ordersSkipped++;
      continue;
    }

    const lines = order.lines || [];
    if (lines.length === 0) {
      ordersSkipped++;
      continue;
    }

    const carrierCost = carrierCostMap.get(carrier) || 0;
    // Delivery cost is per order, not per parcel (parcels is just how warehouse splits shipment)
    const orderDeliveryCost = carrierCost;

    // Calculate total order value for proportional split
    // FIX: Use lineTotalInclVat directly (it already includes quantity),
    // only multiply by quantity when falling back to unitPriceInclVat
    const totalOrderValue = lines.reduce((sum, line) => {
      const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
      return sum + lineValue;
    }, 0);

    for (const line of lines) {
      const sku = line.sku?.toUpperCase();
      if (!sku) continue;

      if (!skuDeliveryStats.has(sku)) {
        skuDeliveryStats.set(sku, {
          carrierCounts: {},
          totalDeliveryCost: 0,
          totalQuantity: 0,
          orderCount: 0,
        });
      }

      const stats = skuDeliveryStats.get(sku)!;
      stats.carrierCounts[carrier] = (stats.carrierCounts[carrier] || 0) + 1;

      // Split delivery cost proportionally by line value
      // FIX: Use lineTotalInclVat directly (it already includes quantity)
      const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
      const valueShare = totalOrderValue > 0 ? lineValue / totalOrderValue : 1 / lines.length;
      const lineDeliveryCost = orderDeliveryCost * valueShare;

      stats.totalDeliveryCost += lineDeliveryCost;
      stats.totalQuantity += line.quantity || 1;
      stats.orderCount += 1;
    }

    ordersProcessed++;
  }

  console.log(`[RecalculateDelivery] Processed ${ordersProcessed} orders, skipped ${ordersSkipped}`);

  // Calculate delivery costs per SKU and update products
  let productsUpdated = 0;
  let productsUnchanged = 0;
  const updatedSkus: Array<{ sku: string; oldCost: number; newCost: number; carrier: string }> = [];

  for (const [sku, stats] of skuDeliveryStats) {
    // Find predominant carrier
    let predominantCarrier = 'unknown';
    let maxCount = 0;
    for (const [carrier, count] of Object.entries(stats.carrierCounts)) {
      if (count > maxCount) {
        maxCount = count;
        predominantCarrier = carrier;
      }
    }

    // Calculate delivery cost per unit
    const deliveryCost = stats.totalQuantity > 0
      ? stats.totalDeliveryCost / stats.totalQuantity
      : 0;

    const product = productsBySku.get(sku);
    if (product && stats.totalDeliveryCost > 0) {
      const roundedCost = Math.round(deliveryCost * 100) / 100;
      const oldCost = product.deliveryCost || 0;

      if (oldCost !== roundedCost) {
        await db.putProduct({
          ...product,
          deliveryCost: roundedCost,
        });
        productsUpdated++;
        updatedSkus.push({
          sku,
          oldCost,
          newCost: roundedCost,
          carrier: predominantCarrier,
        });
      } else {
        productsUnchanged++;
      }
    }
  }

  console.log(`[RecalculateDelivery] Complete: ${productsUpdated} products updated from orders, ${productsUnchanged} unchanged`);

  // ===== PHASE 2: Fill missing delivery costs using category averages =====
  console.log('[RecalculateDelivery] Phase 2: Filling missing delivery costs using category averages');

  // Calculate category averages from SKUs with real order-derived delivery costs
  const categoryStats = new Map<string, { total: number; count: number }>();

  for (const [sku, stats] of skuDeliveryStats) {
    if (stats.totalQuantity === 0 || stats.totalDeliveryCost === 0) continue;

    const product = productsBySku.get(sku);
    if (!product || !product.category) continue;

    const deliveryCostPerUnit = stats.totalDeliveryCost / stats.totalQuantity;
    const primaryCategory = product.category.split(',')[0].trim();

    const catStats = categoryStats.get(primaryCategory) || { total: 0, count: 0 };
    catStats.total += deliveryCostPerUnit;
    catStats.count += 1;
    categoryStats.set(primaryCategory, catStats);
  }

  // Calculate category averages
  const categoryAverages = new Map<string, number>();
  for (const [category, stats] of categoryStats) {
    categoryAverages.set(category, Math.round((stats.total / stats.count) * 100) / 100);
  }

  console.log(`[RecalculateDelivery] Calculated averages for ${categoryAverages.size} categories`);

  // Calculate overall average as fallback
  let overallTotal = 0;
  let overallCount = 0;
  for (const stats of categoryStats.values()) {
    overallTotal += stats.total;
    overallCount += stats.count;
  }
  const overallAverage = overallCount > 0 ? Math.round((overallTotal / overallCount) * 100) / 100 : 0;
  console.log(`[RecalculateDelivery] Overall average delivery cost: £${overallAverage}`);

  // Fill products without delivery costs using category averages
  // Special rule: Products with "Suite" in title or weight > 30kg get £45 delivery
  const SUITE_DELIVERY_COST = 45;
  const HEAVY_WEIGHT_THRESHOLD = 30; // kg

  let productsFilled = 0;
  let suiteProductsUpdated = 0;
  const filledSkus: Array<{ sku: string; category: string; newCost: number; source: string }> = [];

  for (const product of allProducts) {
    const skuUpper = product.sku.toUpperCase();
    const title = (product.title || '').toLowerCase();

    // Check if product is a "Suite" (large item) or heavy (>30kg)
    const isSuite = title.includes('suite');
    const isHeavy = (product.weight || 0) > HEAVY_WEIGHT_THRESHOLD;
    const needsSuiteDeliveryCost = isSuite || isHeavy;

    // For suite/heavy products, update even if they have a delivery cost (if it's too low)
    if (needsSuiteDeliveryCost) {
      const currentCost = product.deliveryCost || 0;
      if (currentCost < SUITE_DELIVERY_COST) {
        await db.putProduct({
          ...product,
          deliveryCost: SUITE_DELIVERY_COST,
        });
        suiteProductsUpdated++;
        if (filledSkus.length < 100) {
          const reason = isHeavy ? `heavy ${product.weight}kg` : 'suite in title';
          filledSkus.push({
            sku: product.sku,
            category: product.category || 'none',
            newCost: SUITE_DELIVERY_COST,
            source: `${reason} (was £${currentCost})`,
          });
        }
      }
      continue; // Skip normal category fill for suite/heavy products
    }

    // Skip products that have order-derived delivery costs
    if (skuDeliveryStats.has(skuUpper)) continue;

    // Skip products that already have a delivery cost
    if (product.deliveryCost && product.deliveryCost > 0) continue;

    let deliveryCost = 0;
    let source = 'none';

    if (product.category) {
      const primaryCategory = product.category.split(',')[0].trim();
      const categoryAvg = categoryAverages.get(primaryCategory);

      if (categoryAvg && categoryAvg > 0) {
        deliveryCost = categoryAvg;
        source = `category: ${primaryCategory}`;
      } else if (overallAverage > 0) {
        deliveryCost = overallAverage;
        source = 'overall avg';
      }
    } else if (overallAverage > 0) {
      deliveryCost = overallAverage;
      source = 'overall avg (no category)';
    }

    if (deliveryCost > 0) {
      await db.putProduct({
        ...product,
        deliveryCost,
      });
      productsFilled++;
      if (filledSkus.length < 100) {
        filledSkus.push({
          sku: product.sku,
          category: product.category || 'none',
          newCost: deliveryCost,
          source,
        });
      }
    }
  }

  console.log(`[RecalculateDelivery] Filled ${productsFilled} products with category averages, ${suiteProductsUpdated} suite products updated to £${SUITE_DELIVERY_COST}`);

  // Build category summary
  const categorySummary: Array<{ category: string; avgDeliveryCost: number; skusWithOrderData: number }> = [];
  for (const [category, avg] of categoryAverages) {
    const stats = categoryStats.get(category)!;
    categorySummary.push({
      category,
      avgDeliveryCost: avg,
      skusWithOrderData: stats.count,
    });
  }
  categorySummary.sort((a, b) => b.skusWithOrderData - a.skusWithOrderData);

  return response(200, {
    message: 'Delivery cost recalculation complete',
    ordersWithDeliveryData: ordersWithDelivery.length,
    ordersProcessed,
    ordersSkipped,
    skusAnalyzed: skuDeliveryStats.size,
    productsUpdatedFromOrders: productsUpdated,
    productsUnchanged,
    productsFilledFromCategoryAvg: productsFilled,
    suiteProductsUpdated,
    overallAverageDeliveryCost: overallAverage,
    categoriesWithData: categoryAverages.size,
    categorySummary: categorySummary.slice(0, 20),
    updatedSkus: updatedSkus.slice(0, 50),
    filledSkus: filledSkus.slice(0, 50),
  });
}

// ============ Carriers ============

async function handleCarriers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const carrierId = event.pathParameters?.carrierId;

  if (method === 'GET' && !carrierId) {
    const carriers = await db.getAllCarrierCosts();
    return response(200, { items: carriers, count: carriers.length });
  }

  if (method === 'GET' && carrierId) {
    const carrier = await db.getCarrierCost(carrierId);
    if (!carrier) {
      return response(404, { error: 'Carrier not found' });
    }
    return response(200, carrier);
  }

  if (method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const carrierId = normalizeCarrierName(body.carrierName || body.carrierId);

    const carrier: CarrierCost = {
      carrierId,
      carrierName: body.carrierName || getCarrierDisplayName(carrierId),
      costPerParcel: body.costPerParcel ?? 0,
      isActive: body.isActive ?? true,
      lastUpdated: new Date().toISOString(),
    };

    await db.putCarrierCost(carrier);
    return response(201, carrier);
  }

  if (method === 'PUT' && carrierId) {
    const existing = await db.getCarrierCost(carrierId);
    if (!existing) {
      return response(404, { error: 'Carrier not found' });
    }

    const body = JSON.parse(event.body || '{}');
    const updated: CarrierCost = {
      ...existing,
      carrierName: body.carrierName ?? existing.carrierName,
      costPerParcel: body.costPerParcel ?? existing.costPerParcel,
      isActive: body.isActive ?? existing.isActive,
      lastUpdated: new Date().toISOString(),
    };

    await db.putCarrierCost(updated);
    return response(200, updated);
  }

  if (method === 'DELETE' && carrierId) {
    await db.deleteCarrierCost(carrierId);
    return response(204, null);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ SKU History ============

async function handleHistory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  // GET /history/{sku}
  const pathParts = event.path.split('/');
  const sku = pathParts[pathParts.length - 1];

  if (method === 'GET' && sku && sku !== 'history') {
    const decodedSku = decodeURIComponent(sku);
    const fromDate = params.fromDate;
    const toDate = params.toDate;
    const includeChannelSales = params.includeChannelSales === 'true';

    // Default to last 180 days if no dates specified
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 180);
    const from = fromDate || defaultFrom.toISOString().substring(0, 10);
    const to = toDate || new Date().toISOString().substring(0, 10);

    const history = await db.getSkuHistory(decodedSku, from, to);

    // Also get the current product info
    const product = await db.getProduct(decodedSku);

    // Optionally fetch channel-level sales data from orders
    let channelSales: Record<string, Record<string, { quantity: number; revenue: number }>> | undefined;
    if (includeChannelSales) {
      channelSales = await getChannelSalesByDay(decodedSku, from, to);
    }

    return response(200, {
      sku: decodedSku,
      product,
      history,
      channelSales,
      fromDate: from,
      toDate: to,
      recordCount: history.length,
    });
  }

  return response(400, { error: 'SKU parameter required. Use GET /history/{sku}' });
}

/**
 * Get sales by channel for each day for a specific SKU
 * Uses the order-lines table for fast SKU-based queries (single query instead of 180+ queries)
 * Returns: { "2025-11-28": { "Amazon": { quantity: 5, revenue: 100 }, "eBay": { quantity: 2, revenue: 40 } }, ... }
 */
async function getChannelSalesByDay(
  sku: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, Record<string, { quantity: number; revenue: number }>>> {
  // Single query to get all order lines for this SKU in the date range
  const orderLines = await db.getOrderLinesBySku(sku, fromDate, toDate);

  const result: Record<string, Record<string, { quantity: number; revenue: number }>> = {};

  for (const line of orderLines) {
    const orderDate = line.orderDateDay;
    if (!orderDate) continue;

    const channelName = line.channelName || 'Unknown';

    if (!result[orderDate]) {
      result[orderDate] = {};
    }
    if (!result[orderDate][channelName]) {
      result[orderDate][channelName] = { quantity: 0, revenue: 0 };
    }

    result[orderDate][channelName].quantity += line.quantity || 0;
    result[orderDate][channelName].revenue += line.lineTotalInclVat || 0;
  }

  return result;
}

// ============ Manual Sync ============

async function handleManualSync(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // This would trigger the data-sync lambda
  // For now, return info about how to trigger it
  return response(200, {
    message: 'Manual sync not yet implemented. Use AWS Console to invoke data-sync Lambda.',
  });
}

// ============ History Backfill ============

async function handleHistoryBackfill(event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Starting history backfill from order data...');

  // Get all products for current price/cost info
  const products = await db.getAllProducts();
  const productMap = new Map(products.map((p) => [p.sku, p]));
  console.log(`Loaded ${products.length} products`);

  // Get date range from query params or default to 400 days (covers Nov 2024 - Dec 2025)
  const daysParam = event?.queryStringParameters?.days;
  const fromParam = event?.queryStringParameters?.from;
  const days = daysParam ? parseInt(daysParam, 10) : 400;

  const endDate = new Date();
  const startDate = fromParam ? new Date(fromParam) : new Date();
  if (!fromParam) {
    startDate.setDate(startDate.getDate() - days);
  }

  // Generate list of dates
  const dates: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(current.toISOString().substring(0, 10));
    current.setDate(current.getDate() + 1);
  }
  console.log(`Processing ${dates.length} days from ${dates[0]} to ${dates[dates.length - 1]}`);

  // Process in batches of 30 days
  const batchSize = 30;
  let totalRecords = 0;

  for (let i = 0; i < dates.length; i += batchSize) {
    const dateBatch = dates.slice(i, i + batchSize);

    // Fetch orders for all days in batch in parallel
    const orderPromises = dateBatch.map((date) => db.getOrdersByDate(date));
    const orderResults = await Promise.all(orderPromises);

    // Process each day
    const historyRecords: Array<{
      sku: string;
      date: string;
      price: number;
      costPrice?: number;
      stockLevel: number;
      dailySales: number;
      dailyRevenue: number;
      margin?: number;
      recordedAt: string;
    }> = [];

    for (let j = 0; j < dateBatch.length; j++) {
      const dateDay = dateBatch[j];
      const orders = orderResults[j];

      // Aggregate sales by SKU for this day
      const dailySales = new Map<string, { quantity: number; revenue: number }>();
      for (const order of orders) {
        if (order.lines) {
          for (const line of order.lines) {
            const existing = dailySales.get(line.sku) || { quantity: 0, revenue: 0 };
            existing.quantity += line.quantity;
            existing.revenue += line.lineTotalInclVat || 0;
            dailySales.set(line.sku, existing);
          }
        }
      }

      // Create history records for SKUs with sales that day
      // Note: We only have order data for backfill, not historical stock/price data
      // So we record sales/revenue but leave stock as 0 (unknown)
      for (const [sku, sales] of dailySales) {
        const product = productMap.get(sku);
        if (product) {
          // Use current price/cost as approximation (we don't have historical prices)
          const price = product.currentPrice || 0;
          const costPrice = product.costPrice || 0;
          const margin = price > 0 && costPrice > 0 ? ((price - costPrice) / price) * 100 : undefined;

          historyRecords.push({
            sku,
            date: dateDay,
            price,
            costPrice: costPrice || undefined,
            stockLevel: 0, // We don't have historical stock data - set to 0
            dailySales: sales.quantity,
            dailyRevenue: sales.revenue,
            margin,
            recordedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Batch write history records
    if (historyRecords.length > 0) {
      await db.batchPutSkuHistory(historyRecords);
      totalRecords += historyRecords.length;
      console.log(`Batch ${Math.floor(i / batchSize) + 1}: wrote ${historyRecords.length} records`);
    }
  }

  console.log(`Backfill complete: ${totalRecords} history records created`);

  return response(200, {
    message: 'History backfill complete',
    recordsCreated: totalRecords,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
  });
}

// ============ Competitors ============

async function handleCompetitors(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const path = event.path;
  const sku = event.pathParameters?.sku;

  // POST /competitors/scrape - Trigger manual scrape for all products
  if (path === '/competitors/scrape' && method === 'POST') {
    console.log('Starting manual competitor scrape...');

    const products = await db.getAllProducts();
    const productsWithCompetitors = products.filter(p => p.competitorUrls && p.competitorUrls.length > 0);

    if (productsWithCompetitors.length === 0) {
      return response(200, { message: 'No products with competitor URLs configured', scraped: 0 });
    }

    let successCount = 0;
    let errorCount = 0;
    const results: Array<{ sku: string; lowestPrice: number | null; errors: string[] }> = [];

    for (const product of productsWithCompetitors) {
      try {
        const result = await scrapeProductCompetitors(product);

        const updatedProduct: Product = {
          ...product,
          competitorUrls: result.updatedUrls,
          competitorFloorPrice: result.lowestPrice ?? undefined,
          competitorPricesLastUpdated: new Date().toISOString(),
        };

        await db.putProduct(updatedProduct);

        results.push({ sku: product.sku, lowestPrice: result.lowestPrice, errors: result.errors });

        if (result.lowestPrice !== null) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ sku: product.sku, lowestPrice: null, errors: [message] });
        errorCount++;
      }
    }

    return response(200, {
      message: 'Competitor scrape complete',
      totalProducts: productsWithCompetitors.length,
      successCount,
      errorCount,
      results,
    });
  }

  // POST /competitors/scrape/:sku - Scrape competitors for a single product
  if (path.match(/\/competitors\/scrape\/[^/]+/) && method === 'POST') {
    const skuFromPath = path.split('/').pop();
    if (!skuFromPath) {
      return response(400, { error: 'SKU required' });
    }

    const product = await db.getProduct(skuFromPath);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    if (!product.competitorUrls || product.competitorUrls.length === 0) {
      return response(400, { error: 'No competitor URLs configured for this product' });
    }

    const result = await scrapeProductCompetitors(product);

    const updatedProduct: Product = {
      ...product,
      competitorUrls: result.updatedUrls,
      competitorFloorPrice: result.lowestPrice ?? undefined,
      competitorPricesLastUpdated: new Date().toISOString(),
    };

    await db.putProduct(updatedProduct);

    return response(200, {
      sku: product.sku,
      lowestPrice: result.lowestPrice,
      competitorUrls: result.updatedUrls,
      errors: result.errors,
    });
  }

  // POST /competitors/add-url - Add a competitor URL to a product
  if (path === '/competitors/add-url' && method === 'POST') {
    const body = JSON.parse(event.body || '{}');
    const { sku: targetSku, url } = body;

    if (!targetSku || !url) {
      return response(400, { error: 'sku and url are required' });
    }

    const product = await db.getProduct(targetSku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    const competitorName = getCompetitorNameFromUrl(url);
    const newEntry: CompetitorUrl = {
      id: uuid(),
      competitorName,
      url,
    };

    const existingUrls = product.competitorUrls || [];

    // Check if URL already exists
    if (existingUrls.some(u => u.url === url)) {
      return response(400, { error: 'URL already exists for this product' });
    }

    const updatedProduct: Product = {
      ...product,
      competitorUrls: [...existingUrls, newEntry],
    };

    await db.putProduct(updatedProduct);

    return response(200, {
      message: 'Competitor URL added',
      sku: targetSku,
      competitorUrls: updatedProduct.competitorUrls,
    });
  }

  // DELETE /competitors/remove-url - Remove a competitor URL from a product
  if (path === '/competitors/remove-url' && method === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    const { sku: targetSku, urlId } = body;

    if (!targetSku || !urlId) {
      return response(400, { error: 'sku and urlId are required' });
    }

    const product = await db.getProduct(targetSku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    const existingUrls = product.competitorUrls || [];
    const filteredUrls = existingUrls.filter(u => u.id !== urlId);

    if (filteredUrls.length === existingUrls.length) {
      return response(404, { error: 'URL not found' });
    }

    const updatedProduct: Product = {
      ...product,
      competitorUrls: filteredUrls,
      // Recalculate floor price from remaining URLs
      competitorFloorPrice: filteredUrls.length > 0
        ? Math.min(...filteredUrls.filter(u => u.lastPrice).map(u => u.lastPrice!))
        : undefined,
    };

    await db.putProduct(updatedProduct);

    return response(200, {
      message: 'Competitor URL removed',
      sku: targetSku,
      competitorUrls: updatedProduct.competitorUrls,
    });
  }

  return response(404, { error: 'Competitor endpoint not found' });
}

// ============ Order Lines Backfill ============

// ============ Prices ============

/**
 * Handle price updates to Google Sheets
 * PUT /prices/{sku} - Update a single channel price
 * Body: { channelId: string, price: number }
 */
async function handlePrices(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const sku = event.pathParameters?.sku;

  if (method === 'PUT' && sku) {
    const body = JSON.parse(event.body || '{}');
    const { channelId, price } = body;

    if (!channelId || typeof price !== 'number') {
      return response(400, { error: 'channelId and price are required' });
    }

    if (price < 0) {
      return response(400, { error: 'Price must be non-negative' });
    }

    // Verify product exists
    const product = await db.getProduct(sku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    // Update Google Sheets
    const gsSecretArn = process.env.GOOGLE_SHEETS_SECRET_ARN;
    if (!gsSecretArn) {
      return response(500, { error: 'Google Sheets not configured' });
    }

    try {
      const { createGoogleSheetsServiceFromSecret } = await import('@repricing/core');
      const gsService = await createGoogleSheetsServiceFromSecret(gsSecretArn, false); // false = write access
      const result = await gsService.updateChannelPrice(sku, channelId, price);

      if (!result.success) {
        return response(400, { error: result.error });
      }

      // Also update DynamoDB so the UI reflects the change immediately
      const updatedProduct = {
        ...product,
        channelPrices: { ...product.channelPrices, [channelId]: price }
      };
      await db.putProduct(updatedProduct);

      console.log(`Updated price for ${sku} on ${channelId} to £${price}`);

      return response(200, {
        success: true,
        message: `Price updated for ${sku} on ${channelId}`,
        sku,
        channelId,
        price,
      });
    } catch (err) {
      console.error('Failed to update price:', err);
      return response(500, {
        error: err instanceof Error ? err.message : 'Failed to update price',
      });
    }
  }

  return response(404, { error: 'Price endpoint not found' });
}

// ============ Order Lines Backfill ============

/**
 * Backfill order-lines table from existing orders
 * POST /order-lines/backfill
 * Body: { fromDate?: "YYYY-MM-DD", toDate?: "YYYY-MM-DD" }
 */
async function handleOrderLinesBackfill(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');

  // Default to last 2 years if not specified
  const endDate = body.toDate ? new Date(body.toDate) : new Date();
  const startDate = body.fromDate
    ? new Date(body.fromDate)
    : new Date(endDate.getTime() - 730 * 24 * 60 * 60 * 1000); // 2 years

  console.log(`Backfilling order-lines from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Generate list of dates
  const dates: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(current.toISOString().substring(0, 10));
    current.setDate(current.getDate() + 1);
  }
  console.log(`Processing ${dates.length} days`);

  // Process in batches of 50 days
  const batchSize = 50;
  let totalLineRecords = 0;
  let totalOrders = 0;
  const syncedAt = new Date().toISOString();

  for (let i = 0; i < dates.length; i += batchSize) {
    const dateBatch = dates.slice(i, i + batchSize);

    // Fetch orders for all days in batch in parallel
    const orderPromises = dateBatch.map((date) => db.getOrdersByDate(date));
    const orderResults = await Promise.all(orderPromises);

    // Build order line records
    const lineRecords: OrderLineRecord[] = [];

    for (const orders of orderResults) {
      for (const order of orders) {
        totalOrders++;
        if (order.lines) {
          for (const line of order.lines) {
            lineRecords.push({
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
      }
    }

    // Batch write line records
    if (lineRecords.length > 0) {
      await db.batchPutOrderLines(lineRecords);
      totalLineRecords += lineRecords.length;
      console.log(`Batch ${Math.floor(i / batchSize) + 1}: wrote ${lineRecords.length} line records from ${dateBatch.length} days`);
    }
  }

  console.log(`Backfill complete: ${totalLineRecords} order line records from ${totalOrders} orders`);

  return response(200, {
    message: 'Order lines backfill complete',
    orderLinesCreated: totalLineRecords,
    ordersProcessed: totalOrders,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
  });
}

// ============ Helpers ============

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: body ? JSON.stringify(body) : '',
  };
}
