import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  Account,
  CreateAccountRequest,
  UpdateAccountRequest,
  CreateUserRequest,
  UpdateUserRequest,
  AccountContext,
} from '@repricing/core';
import { v4 as uuid } from 'uuid';
import {
  extractAccountContext,
  requireAccountContext,
  requireSuperAdmin,
  requireAdmin,
  requireEditor,
} from './account-context';
import { UserManagementService } from './user-management';

const db = createDynamoDBServiceV2();
const userService = new UserManagementService();

/**
 * Extract path parameter from URL path
 * With proxy integration, pathParameters aren't populated automatically
 * @param path - The full URL path (e.g., /products/SKU123)
 * @param position - Which segment to extract (0-indexed after filtering empty strings)
 * @returns The path segment or undefined
 */
function getPathParam(path: string, position: number): string | undefined {
  const parts = path.split('/').filter(Boolean);
  return parts[position];
}

/**
 * V2 API Gateway Lambda handler
 * Multi-tenant aware - all operations scoped to account
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log('V2 API request:', {
    method: event.httpMethod,
    path: event.path,
    requestId: context.awsRequestId,
    accountId: event.headers['X-Account-Id'] || event.headers['x-account-id'],
  });

  try {
    const path = event.path;
    const method = event.httpMethod;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return response(200, null);
    }

    // Extract account context from JWT
    let ctx: AccountContext;
    try {
      ctx = extractAccountContext(event);
    } catch (error) {
      console.error('Auth error:', error);
      return response(401, { error: error instanceof Error ? error.message : 'Unauthorized' });
    }

    // Route requests
    if (path.startsWith('/accounts')) {
      return handleAccounts(event, ctx);
    }
    if (path.startsWith('/users')) {
      return handleUsers(event, ctx);
    }
    if (path.startsWith('/products')) {
      return handleProducts(event, ctx);
    }
    if (path.startsWith('/proposals')) {
      return handleProposals(event, ctx);
    }
    if (path.startsWith('/rules')) {
      return handleRules(event, ctx);
    }
    if (path.startsWith('/channels')) {
      return handleChannels(event, ctx);
    }
    if (path.startsWith('/analytics')) {
      return handleAnalytics(event, ctx);
    }
    if (path.startsWith('/carriers')) {
      return handleCarriers(event, ctx);
    }
    if (path.startsWith('/history')) {
      return handleHistory(event, ctx);
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('API error:', error);

    // Handle permission errors
    if (error instanceof Error) {
      if (error.message.includes('Access denied') || error.message.includes('required')) {
        return response(403, { error: error.message });
      }
    }

    return response(500, {
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

// ============ Account Management (Super-Admin Only) ============

async function handleAccounts(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  // Parse accountId from path: /accounts/{accountId}
  const accountId = getPathParam(event.path, 1);

  // All account operations require super-admin
  requireSuperAdmin(ctx);

  if (method === 'GET' && !accountId) {
    // List all accounts
    const accounts = await db.getAllAccounts();
    return response(200, { items: accounts, count: accounts.length });
  }

  if (method === 'GET' && accountId) {
    // Get single account
    const account = await db.getAccount(accountId);
    if (!account) {
      return response(404, { error: 'Account not found' });
    }
    return response(200, account);
  }

  if (method === 'POST' && !accountId) {
    // Create account
    const body = JSON.parse(event.body || '{}') as CreateAccountRequest;

    // Validate required fields
    if (!body.accountId || !body.name) {
      return response(400, { error: 'accountId and name are required' });
    }

    // Check if account already exists
    const existing = await db.getAccount(body.accountId);
    if (existing) {
      return response(409, { error: 'Account already exists' });
    }

    const defaultColumnMapping = {
      skuColumn: 'A',
      pricingMode: 'single' as const,
      priceColumn: 'B',
      startRow: 2,
    };

    const account: Account = {
      accountId: body.accountId,
      name: body.name,
      status: 'active',
      channelEngine: body.channelEngine || { apiKey: '', tenantId: '' },
      googleSheets: {
        spreadsheetId: body.googleSheets?.spreadsheetId || '',
        credentialsSecretArn: body.googleSheets?.credentialsSecretArn,
        columnMapping: body.googleSheets?.columnMapping || defaultColumnMapping,
      },
      settings: {
        channelFees: body.settings?.channelFees || {
          shopify: 0.15,
          amazon: 0.20,
          ebay: 0.20,
          manomano: 0.20,
          bandq: 0.20,
        },
        defaultMargin: body.settings?.defaultMargin || 0.25,
        currency: body.settings?.currency || 'GBP',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: ctx.userEmail,
    };

    await db.putAccount(account);
    return response(201, account);
  }

  if (method === 'PUT' && accountId) {
    // Update account
    const body = JSON.parse(event.body || '{}') as UpdateAccountRequest;

    const existing = await db.getAccount(accountId);
    if (!existing) {
      return response(404, { error: 'Account not found' });
    }

    const updated: Account = {
      ...existing,
      name: body.name ?? existing.name,
      status: body.status ?? existing.status,
      channelEngine: body.channelEngine
        ? { ...existing.channelEngine, ...body.channelEngine }
        : existing.channelEngine,
      googleSheets: body.googleSheets
        ? { ...existing.googleSheets, ...body.googleSheets }
        : existing.googleSheets,
      settings: body.settings
        ? { ...existing.settings, ...body.settings }
        : existing.settings,
      updatedAt: new Date().toISOString(),
    };

    await db.putAccount(updated);
    return response(200, updated);
  }

  if (method === 'DELETE' && accountId) {
    // Suspend account (soft delete)
    const existing = await db.getAccount(accountId);
    if (!existing) {
      return response(404, { error: 'Account not found' });
    }

    const updated: Account = {
      ...existing,
      status: 'suspended',
      updatedAt: new Date().toISOString(),
    };

    await db.putAccount(updated);
    return response(200, { message: 'Account suspended', account: updated });
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ User Management (Super-Admin Only) ============

async function handleUsers(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  // Parse userId from path: /users/{userId} - decode URL-encoded email
  const rawUserId = getPathParam(event.path, 1);
  const userId = rawUserId ? decodeURIComponent(rawUserId) : undefined;

  // All user operations require super-admin
  requireSuperAdmin(ctx);

  if (method === 'GET' && !userId) {
    // List all users
    const users = await userService.listUsers();
    return response(200, { items: users, count: users.length });
  }

  if (method === 'GET' && userId) {
    // Get single user (userId is actually email for Cognito)
    const user = await userService.getUserByEmail(userId);
    if (!user) {
      return response(404, { error: 'User not found' });
    }
    return response(200, user);
  }

  if (method === 'POST' && !userId) {
    // Create user
    const body = JSON.parse(event.body || '{}') as CreateUserRequest;

    if (!body.email || !body.givenName || !body.familyName) {
      return response(400, { error: 'email, givenName, and familyName are required' });
    }

    try {
      const user = await userService.createUser(body);
      return response(201, user);
    } catch (error) {
      if ((error as { name?: string }).name === 'UsernameExistsException') {
        return response(409, { error: 'User already exists' });
      }
      throw error;
    }
  }

  if (method === 'PUT' && userId) {
    // Update user
    const body = JSON.parse(event.body || '{}') as UpdateUserRequest;
    const user = await userService.updateUser(userId, body);
    return response(200, user);
  }

  if (method === 'DELETE' && userId) {
    // Disable user
    await userService.deleteUser(userId);
    return response(200, { message: 'User disabled' });
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Products (Account-Scoped) ============

async function handleProducts(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  // Parse sku from path: /products/{sku} - decode URL-encoded SKU
  const rawSku = getPathParam(event.path, 1);
  const sku = rawSku ? decodeURIComponent(rawSku) : undefined;

  if (method === 'GET' && !sku) {
    // List all products for account
    const products = await db.getAllProducts(accountId);
    return response(200, { items: products, count: products.length });
  }

  if (method === 'GET' && sku) {
    // Get single product
    const product = await db.getProduct(accountId, sku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }
    return response(200, product);
  }

  if (method === 'PUT' && sku) {
    // Update product
    requireEditor(ctx);

    const body = JSON.parse(event.body || '{}');
    const existing = await db.getProduct(accountId, sku);

    if (!existing) {
      return response(404, { error: 'Product not found' });
    }

    const updated = {
      ...existing,
      costPrice: body.costPrice ?? existing.costPrice,
      deliveryCost: body.deliveryCost ?? existing.deliveryCost,
      mrp: body.mrp ?? existing.mrp,
      category: body.category ?? existing.category,
      competitorUrls: body.competitorUrls ?? existing.competitorUrls,
    };

    await db.putProduct(accountId, updated);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Proposals (Account-Scoped) ============

async function handleProposals(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  const path = event.path;
  // Parse proposalId from path: /proposals/{proposalId}
  const proposalId = getPathParam(event.path, 1);

  if (path === '/proposals/status-counts' && method === 'GET') {
    // Get status counts
    const proposals = await db.queryProposals(accountId, {});
    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0,
      pushed: 0,
    };
    for (const p of proposals.items) {
      counts[p.status as keyof typeof counts]++;
    }
    return response(200, counts);
  }

  if (path === '/proposals/bulk-approve' && method === 'POST') {
    requireEditor(ctx);
    const body = JSON.parse(event.body || '{}');
    const proposalIds = body.proposalIds as string[];

    for (const id of proposalIds) {
      await db.updateProposalStatus(accountId, id, 'approved', ctx.userEmail);
    }

    return response(200, { approved: proposalIds.length });
  }

  if (path === '/proposals/bulk-reject' && method === 'POST') {
    requireEditor(ctx);
    const body = JSON.parse(event.body || '{}');
    const proposalIds = body.proposalIds as string[];

    for (const id of proposalIds) {
      await db.updateProposalStatus(accountId, id, 'rejected', ctx.userEmail);
    }

    return response(200, { rejected: proposalIds.length });
  }

  if (method === 'GET' && !proposalId) {
    // List proposals with filters
    const params = event.queryStringParameters || {};
    const filters = {
      status: params.status as any,
      brand: params.brand,
      batchId: params.batchId,
      hasWarnings: params.hasWarnings === 'true',
      searchTerm: params.search,
      appliedRuleName: params.ruleName,
    };
    const page = parseInt(params.page || '1', 10);
    const pageSize = parseInt(params.pageSize || '50', 10);

    const result = await db.queryProposals(accountId, filters, page, pageSize);
    return response(200, result);
  }

  if (method === 'GET' && proposalId) {
    // Get single proposal
    const proposal = await db.getProposal(accountId, proposalId);
    if (!proposal) {
      return response(404, { error: 'Proposal not found' });
    }
    return response(200, proposal);
  }

  if (method === 'PUT' && proposalId) {
    // Update proposal status
    requireEditor(ctx);
    const body = JSON.parse(event.body || '{}');

    await db.updateProposalStatus(
      accountId,
      proposalId,
      body.status,
      ctx.userEmail,
      body.notes,
      body.approvedPrice
    );

    const updated = await db.getProposal(accountId, proposalId);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Rules (Account-Scoped) ============

async function handleRules(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  // Parse ruleId from path: /rules/{ruleId}
  const ruleId = getPathParam(event.path, 1);

  if (method === 'GET' && !ruleId) {
    // List all rules
    const rules = await db.getAllRules(accountId);
    return response(200, { items: rules, count: rules.length });
  }

  if (method === 'GET' && ruleId) {
    // Get single rule
    const rule = await db.getRule(accountId, ruleId);
    if (!rule) {
      return response(404, { error: 'Rule not found' });
    }
    return response(200, rule);
  }

  if (method === 'POST' && !ruleId) {
    // Create rule
    requireAdmin(ctx);
    const body = JSON.parse(event.body || '{}');

    const rule = {
      ...body,
      ruleId: uuid(),
      createdAt: new Date().toISOString(),
    };

    await db.putRule(accountId, rule);
    return response(201, rule);
  }

  if (method === 'PUT' && ruleId) {
    // Update rule
    requireAdmin(ctx);
    const body = JSON.parse(event.body || '{}');

    const existing = await db.getRule(accountId, ruleId);
    if (!existing) {
      return response(404, { error: 'Rule not found' });
    }

    const updated = {
      ...existing,
      ...body,
      ruleId, // Preserve original ID
    };

    await db.putRule(accountId, updated);
    return response(200, updated);
  }

  if (method === 'DELETE' && ruleId) {
    // Delete rule
    requireAdmin(ctx);
    await db.deleteRule(accountId, ruleId);
    return response(200, { message: 'Rule deleted' });
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Channels (Account-Scoped) ============

async function handleChannels(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  // Parse channelId from path: /channels/{channelId}
  const channelId = getPathParam(event.path, 1);

  if (method === 'GET' && !channelId) {
    // List all channels
    const channels = await db.getAllChannels(accountId);
    return response(200, { items: channels, count: channels.length });
  }

  if (method === 'GET' && channelId) {
    // Get single channel
    const channel = await db.getChannel(accountId, channelId);
    if (!channel) {
      return response(404, { error: 'Channel not found' });
    }
    return response(200, channel);
  }

  if (method === 'PUT' && channelId) {
    // Update channel
    requireAdmin(ctx);
    const body = JSON.parse(event.body || '{}');

    const existing = await db.getChannel(accountId, channelId);
    if (!existing) {
      return response(404, { error: 'Channel not found' });
    }

    const updated = {
      ...existing,
      ...body,
      channelId, // Preserve original ID
    };

    await db.putChannel(accountId, updated);
    return response(200, updated);
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ Analytics (Account-Scoped) ============

async function handleAnalytics(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const path = event.path;

  if (path === '/analytics/summary') {
    const products = await db.getAllProducts(accountId);
    const proposals = await db.queryProposals(accountId, {});

    return response(200, {
      totalProducts: products.length,
      totalProposals: proposals.totalCount,
      pendingProposals: proposals.items.filter((p) => p.status === 'pending').length,
    });
  }

  if (path === '/analytics/sales') {
    const params = event.queryStringParameters || {};
    const days = parseInt(params.days || '30', 10);
    const includeDaily = params.includeDaily === 'true';
    const includePreviousYear = params.includePreviousYear === 'true';

    // Calculate date range
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days);
    const fromDateStr = fromDate.toISOString().substring(0, 10);
    const toDateStr = today.toISOString().substring(0, 10);

    // Get order lines for the date range
    const orderLines = await db.getOrderLinesByDateRange(accountId, fromDateStr, toDateStr);

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
      previousYearOrderLines = await db.getOrderLinesByDateRange(accountId, previousYearFromDateStr, previousYearToDateStr);
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
    if (includePreviousYear && previousYearOrderLines.length > 0) {
      previousYearDailySales = {};
      const pyOrderIdsByDate: Record<string, Set<string>> = {};
      let pyTotalQuantity = 0;
      let pyTotalRevenue = 0;
      let pyTotalOrders = 0;
      const pyAllOrderIds = new Set<string>();

      for (const line of previousYearOrderLines) {
        const dateDay = line.orderDateDay || '';
        const orderId = line.orderId || '';

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
      };
    }

    return response(200, result);
  }

  if (path === '/analytics/insights') {
    return handleInsights(accountId);
  }

  return response(404, { error: 'Endpoint not found' });
}

// ============ Insights Types ============

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
  dailyRevenueImpact?: number; // Sum of avgDailyRevenue for stock-related insights
}

// ============ Insights Handler ============

async function handleInsights(accountId: string): Promise<APIGatewayProxyResult> {
  const products = await db.getAllProducts(accountId);

  // Get 180-day sales data for calculating avg daily sales
  const salesMap = await db.getSalesBySku(accountId, 180);

  // Helper to calculate margin
  const calculateMargin = (p: { currentPrice?: number; costPrice?: number; deliveryCost?: number }): number => {
    if (!p.currentPrice || p.currentPrice <= 0) return 0;
    const priceExVat = p.currentPrice / 1.2; // Remove 20% VAT
    const channelFee = priceExVat * 0.15; // ~15% average channel fee
    const totalCost = (p.costPrice || 0) + (p.deliveryCost || 0) + channelFee;
    const profit = priceExVat - totalCost;
    return (profit / priceExVat) * 100;
  };

  // Helper to create insight product
  const toInsightProduct = (
    p: { sku: string; title?: string; brand?: string; imageUrl?: string; currentPrice?: number; costPrice?: number; deliveryCost?: number; stockLevel?: number },
    salesData?: { quantity: number; revenue: number }
  ): InsightProduct => {
    const avgDailySales = salesData ? salesData.quantity / 180 : 0;
    const avgDailyRevenue = salesData ? salesData.revenue / 180 : 0;
    const margin = calculateMargin(p);
    const stockLevel = p.stockLevel || 0;
    const daysOfStock = avgDailySales > 0 ? stockLevel / avgDailySales : null;

    return {
      sku: p.sku,
      title: p.title || '',
      brand: p.brand || '',
      imageUrl: p.imageUrl,
      currentPrice: p.currentPrice || 0,
      costPrice: p.costPrice || 0,
      deliveryCost: p.deliveryCost || 0,
      stockLevel,
      margin,
      avgDailySales,
      avgDailyRevenue,
      daysOfStock,
    };
  };

  // Build enriched product list with sales data
  const enrichedProducts = products.map((p) => {
    const salesData = salesMap.get(p.sku);
    return { product: p, salesData, insight: toInsightProduct(p, salesData) };
  });

  // Define insight categories
  const insights: InsightCategory[] = [];

  // 1. Low Sales & High Margin: Sales < 0.25/day but margin > 40% (exclude OOS)
  const lowSalesHighMargin = enrichedProducts.filter(
    ({ insight }) => insight.avgDailySales < 0.25 && insight.margin > 40 && insight.stockLevel > 0
  );
  insights.push({
    id: 'low-sales-high-margin',
    title: 'Low Sales & High Margin',
    description:
      'Products selling less than 0.25 units/day but with over 40% margin. Consider promotions or visibility improvements.',
    count: lowSalesHighMargin.length,
    severity: 'info',
    products: lowSalesHighMargin.map((e) => e.insight).slice(0, 100),
  });

  // 2. Danger Stock: Sales > 0.5/day but < 2 weeks of stock
  const dangerStock = enrichedProducts.filter(
    ({ insight }) =>
      insight.avgDailySales > 0.5 &&
      insight.daysOfStock !== null &&
      insight.daysOfStock > 0 &&
      insight.daysOfStock < 14
  );
  const dangerStockDailyImpact = dangerStock.reduce((sum, e) => sum + e.insight.avgDailyRevenue, 0);
  insights.push({
    id: 'danger-stock',
    title: 'Danger Stock',
    description:
      'Products selling over 0.5 units/day with less than 2 weeks of stock remaining. Reorder urgently.',
    count: dangerStock.length,
    severity: 'critical',
    products: dangerStock.map((e) => e.insight).slice(0, 100),
    dailyRevenueImpact: Math.round(dangerStockDailyImpact * 100) / 100,
  });

  // 3. OOS Stock: Sales > 0.5/day but 0 stock
  const oosStock = enrichedProducts.filter(
    ({ insight }) => insight.avgDailySales > 0.5 && insight.stockLevel === 0
  );
  const oosStockDailyImpact = oosStock.reduce((sum, e) => sum + e.insight.avgDailyRevenue, 0);
  insights.push({
    id: 'oos-stock',
    title: 'Out of Stock (High Demand)',
    description:
      'Products with strong sales (over 0.5 units/day) that are currently out of stock. Lost revenue opportunity.',
    count: oosStock.length,
    severity: 'critical',
    products: oosStock.map((e) => e.insight).slice(0, 100),
    dailyRevenueImpact: Math.round(oosStockDailyImpact * 100) / 100,
  });

  // 4. Low Margin: Margin below 25%
  const lowMargin = enrichedProducts.filter(
    ({ insight }) => insight.margin >= 0 && insight.margin < 25 && insight.currentPrice > 0
  );
  insights.push({
    id: 'low-margin',
    title: 'Low Margin',
    description: 'Products with margin below 25%. Review pricing or costs.',
    count: lowMargin.length,
    severity: 'warning',
    products: lowMargin.map((e) => e.insight).slice(0, 100),
  });

  // 5. Negative Margin: Products losing money
  const negativeMargin = enrichedProducts.filter(
    ({ insight }) => insight.margin < 0 && insight.currentPrice > 0
  );
  insights.push({
    id: 'negative-margin',
    title: 'Negative Margin',
    description: 'Products losing money on every sale. Immediate price increase required or delist.',
    count: negativeMargin.length,
    severity: 'critical',
    products: negativeMargin.map((e) => e.insight).slice(0, 100),
  });

  // 6. SKU with no price
  const noPrice = enrichedProducts.filter(({ product }) => !product.currentPrice || product.currentPrice <= 0);
  insights.push({
    id: 'no-price',
    title: 'Missing Price',
    description: 'Products without a valid price set. These cannot be sold.',
    count: noPrice.length,
    severity: 'critical',
    products: noPrice.map((e) => e.insight).slice(0, 100),
  });

  // 7. SKU with no title
  const noTitle = enrichedProducts.filter(({ product }) => !product.title || product.title.trim() === '');
  insights.push({
    id: 'no-title',
    title: 'Missing Title',
    description: 'Products without a title. Product data may be incomplete.',
    count: noTitle.length,
    severity: 'warning',
    products: noTitle.map((e) => e.insight).slice(0, 100),
  });

  return response(200, { insights });
}

// ============ Carriers (Account-Scoped) ============

async function handleCarriers(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  // Parse carrierId from path: /carriers/{carrierId}
  const carrierId = getPathParam(event.path, 1);

  if (method === 'GET' && !carrierId) {
    // List all carriers
    const carriers = await db.getAllCarrierCosts(accountId);
    return response(200, { items: carriers, count: carriers.length });
  }

  if (method === 'GET' && carrierId) {
    // Get single carrier
    const carrier = await db.getCarrierCost(accountId, carrierId);
    if (!carrier) {
      return response(404, { error: 'Carrier not found' });
    }
    return response(200, carrier);
  }

  if (method === 'POST' && !carrierId) {
    // Create carrier
    requireAdmin(ctx);
    const body = JSON.parse(event.body || '{}');

    const carrier = {
      ...body,
      carrierId: body.carrierId || uuid(),
    };

    await db.putCarrierCost(accountId, carrier);
    return response(201, carrier);
  }

  if (method === 'PUT' && carrierId) {
    // Update carrier
    requireAdmin(ctx);
    const body = JSON.parse(event.body || '{}');

    const existing = await db.getCarrierCost(accountId, carrierId);
    if (!existing) {
      return response(404, { error: 'Carrier not found' });
    }

    const updated = {
      ...existing,
      ...body,
      carrierId, // Preserve original ID
    };

    await db.putCarrierCost(accountId, updated);
    return response(200, updated);
  }

  if (method === 'DELETE' && carrierId) {
    // Delete carrier
    requireAdmin(ctx);
    await db.deleteCarrierCost(accountId, carrierId);
    return response(200, { message: 'Carrier deleted' });
  }

  return response(405, { error: 'Method not allowed' });
}

// ============ SKU History (Account-Scoped) ============

async function handleHistory(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
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

    const history = await db.getSkuHistory(accountId, decodedSku, from, to);

    // Also get the current product info
    const product = await db.getProduct(accountId, decodedSku);

    // Optionally fetch channel-level sales data from orders
    let channelSales: Record<string, Record<string, { quantity: number; revenue: number }>> | undefined;
    if (includeChannelSales) {
      channelSales = await getChannelSalesByDay(accountId, decodedSku, from, to);
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
 */
async function getChannelSalesByDay(
  accountId: string,
  sku: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, Record<string, { quantity: number; revenue: number }>>> {
  const orderLines = await db.getOrderLinesBySku(accountId, sku, fromDate, toDate);

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

// ============ Helpers ============

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Account-Id',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: body ? JSON.stringify(body) : '',
  };
}
