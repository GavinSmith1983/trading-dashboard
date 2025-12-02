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
  normalizeCarrierName,
  getCarrierDisplayName,
  isExcludedCarrier,
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
      return handleCarriers(event);
    }
    if (path.startsWith('/history')) {
      // Backfill endpoint must be checked before general history
      if (path === '/history/backfill' && method === 'POST') {
        return handleHistoryBackfill();
      }
      return handleHistory(event);
    }
    if (path === '/sync' && method === 'POST') {
      return handleManualSync(event);
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
    // Update product (costs, delivery)
    const body = JSON.parse(event.body || '{}');
    const existing = await db.getProduct(sku);

    if (!existing) {
      return response(404, { error: 'Product not found' });
    }

    const updated: Product = {
      ...existing,
      costPrice: body.costPrice ?? existing.costPrice,
      deliveryCost: body.deliveryCost ?? existing.deliveryCost,
      category: body.category ?? existing.category,
    };

    await db.putProduct(updated);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
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

  // Push approved prices to ChannelEngine
  if (path.endsWith('/push') && method === 'POST') {
    return handlePushPrices(event);
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
    merchantProductNo: p.sku,
    price: p.approvedPrice ?? p.proposedPrice,
  }));

  if (dryRun) {
    return response(200, {
      dryRun: true,
      count: updates.length,
      updates,
    });
  }

  // Push to ChannelEngine
  const secretArn = process.env.CHANNEL_ENGINE_SECRET_ARN;
  if (!secretArn) {
    return response(500, { error: 'ChannelEngine not configured' });
  }

  const ceService = await createChannelEngineService(secretArn);
  const result = await ceService.updatePrices(updates);

  // Update proposal statuses to 'pushed'
  if (result.success) {
    for (const proposal of allApproved) {
      await db.updateProposalStatus(proposal.proposalId, 'pushed', 'system', 'Pushed to ChannelEngine');
    }
  }

  return response(200, {
    success: result.success,
    pushed: updates.length,
    errors: result.errors,
  });
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

    const summary = {
      totalProducts: products.length,
      productsWithCosts: products.filter((p) => p.costPrice > 0).length,
      productsWithoutCosts: products.filter((p) => !p.costPrice || p.costPrice === 0).length,
      outOfStock: products.filter((p) => p.stockLevel === 0).length,
      lowStock: products.filter((p) => p.stockLevel > 0 && p.stockLevel < 10).length,
      pendingProposals: pendingProposals.length,
      avgMargin:
        products.length > 0
          ? products.reduce((sum, p) => sum + (p.calculatedMargin || 0), 0) / products.length
          : 0,
    };

    return response(200, summary);
  }

  if (path.endsWith('/margins')) {
    const products = await db.getAllProducts();

    // Group by margin bands
    const marginBands = {
      negative: products.filter((p) => (p.calculatedMargin || 0) < 0).length,
      low: products.filter((p) => (p.calculatedMargin || 0) >= 0 && (p.calculatedMargin || 0) < 15).length,
      target: products.filter((p) => (p.calculatedMargin || 0) >= 15 && (p.calculatedMargin || 0) < 30).length,
      high: products.filter((p) => (p.calculatedMargin || 0) >= 30).length,
    };

    return response(200, { marginBands, total: products.length });
  }

  if (path.endsWith('/sales')) {
    const days = parseInt(params.days || '7', 10);
    const salesMap = await db.getSalesBySku(days);

    // Convert Map to object for JSON response
    const sales: Record<string, { quantity: number; revenue: number }> = {};
    salesMap.forEach((value, key) => {
      sales[key] = value;
    });

    return response(200, { days, skuCount: salesMap.size, sales });
  }

  return response(404, { error: 'Analytics endpoint not found' });
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
  const orderByChannelOrderNo = new Map(allOrders.map(o => [o.channelOrderNo, o]));

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

    // If not found, try stripping suffixes like "-REM"
    if (!matchedOrder && poNumber.includes('-')) {
      const basePoNumber = poNumber.split('-')[0];
      matchedOrder = orderByChannelOrderNo.get(basePoNumber);
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
      const orderDeliveryCost = record.parcels * carrierCost;

      // Calculate total order value for proportional split
      const totalOrderValue = lines.reduce((sum, line) => {
        const lineValue = (line.lineTotalInclVat || line.unitPriceInclVat || 0) * (line.quantity || 1);
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
        const lineValue = (line.lineTotalInclVat || line.unitPriceInclVat || 0) * (line.quantity || 1);
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

    // Default to last 180 days if no dates specified
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 180);
    const from = fromDate || defaultFrom.toISOString().substring(0, 10);
    const to = toDate || new Date().toISOString().substring(0, 10);

    const history = await db.getSkuHistory(decodedSku, from, to);

    // Also get the current product info
    const product = await db.getProduct(decodedSku);

    return response(200, {
      sku: decodedSku,
      product,
      history,
      fromDate: from,
      toDate: to,
      recordCount: history.length,
    });
  }

  return response(400, { error: 'SKU parameter required. Use GET /history/{sku}' });
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

async function handleHistoryBackfill(): Promise<APIGatewayProxyResult> {
  console.log('Starting history backfill from order data...');

  // Get all products for current price/cost info
  const products = await db.getAllProducts();
  const productMap = new Map(products.map((p) => [p.sku, p]));
  console.log(`Loaded ${products.length} products`);

  // Get date range - last 180 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 180);

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
      for (const [sku, sales] of dailySales) {
        const product = productMap.get(sku);
        if (product) {
          const price = product.currentPrice || 0;
          const costPrice = product.costPrice || 0;
          const margin = price > 0 && costPrice > 0 ? ((price - costPrice) / price) * 100 : undefined;

          historyRecords.push({
            sku,
            date: dateDay,
            price,
            costPrice: costPrice || undefined,
            stockLevel: product.stockLevel || 0,
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
