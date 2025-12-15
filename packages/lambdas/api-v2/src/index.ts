import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  Account,
  CreateAccountRequest,
  UpdateAccountRequest,
  CreateUserRequest,
  UpdateUserRequest,
  AccountContext,
  Product,
  normalizeCarrierName,
  isExcludedCarrier,
  CarrierCost,
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
    if (path.startsWith('/prices')) {
      return handlePrices(event, ctx);
    }
    if (path.startsWith('/import')) {
      return handleImport(event, ctx);
    }

    return response(404, { error: 'Not found' });
  } catch (error) {
    console.error('API error:', error);

    // Handle permission errors with generic messages
    if (error instanceof Error) {
      if (error.message.includes('Access denied') || error.message.includes('required')) {
        return response(403, { error: 'Insufficient permissions' });
      }
    }

    // Never expose internal error details to clients
    return response(500, { error: 'Internal server error' });
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

  // GET requests: super-admin gets all, regular users get their allowed accounts
  if (method === 'GET' && !accountId) {
    if (ctx.isSuperAdmin) {
      // Super-admin: list all accounts
      const accounts = await db.getAllAccounts();
      return response(200, { items: accounts, count: accounts.length });
    } else {
      // Regular user: list only their allowed accounts
      const allowedAccountIds = ctx.allowedAccounts || [];
      if (allowedAccountIds.length === 0) {
        return response(200, { items: [], count: 0 });
      }
      // Fetch each allowed account
      const accounts = await Promise.all(
        allowedAccountIds.map((id) => db.getAccount(id))
      );
      // Filter out nulls (accounts that don't exist) and return safe view
      const validAccounts = accounts
        .filter((a): a is Account => a !== null)
        .map((a) => ({
          accountId: a.accountId,
          name: a.name,
          status: a.status,
          settings: a.settings,
          // Don't expose sensitive config like API keys
        }));
      return response(200, { items: validAccounts, count: validAccounts.length });
    }
  }

  if (method === 'GET' && accountId) {
    // Check access: super-admin can access any, others only their allowed accounts
    if (!ctx.isSuperAdmin && !ctx.allowedAccounts.includes(accountId)) {
      return response(403, { error: 'Access denied to this account' });
    }
    const account = await db.getAccount(accountId);
    if (!account) {
      return response(404, { error: 'Account not found' });
    }
    // For non-super-admin, return safe view without sensitive data
    if (!ctx.isSuperAdmin) {
      return response(200, {
        accountId: account.accountId,
        name: account.name,
        status: account.status,
        settings: account.settings,
      });
    }
    return response(200, account);
  }

  // All write operations require super-admin
  requireSuperAdmin(ctx);

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
  // Parse userId from path: /users/{userId} or /users/{userId}/action
  const rawUserId = getPathParam(event.path, 1);
  const userId = rawUserId ? decodeURIComponent(rawUserId) : undefined;
  const action = getPathParam(event.path, 2); // e.g., 'resend-invitation' or 'enable'

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

  // POST /users/{email}/resend-invitation - Resend invitation email
  if (method === 'POST' && userId && action === 'resend-invitation') {
    await userService.resendInvitation(userId);
    return response(200, { message: 'Invitation email sent' });
  }

  // POST /users/{email}/enable - Enable a disabled user
  if (method === 'POST' && userId && action === 'enable') {
    await userService.enableUser(userId);
    return response(200, { message: 'User enabled' });
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
    const params = event.queryStringParameters || {};
    const includeSales = params.includeSales === 'true';
    const salesDays = parseInt(params.salesDays || '90', 10);

    const startTime = Date.now();
    const products = await db.getAllProducts(accountId);
    console.log(`getAllProducts took ${Date.now() - startTime}ms for ${products.length} products`);

    // If includeSales=true, fetch sales data and merge it with products
    let salesBySku: Record<string, { quantity: number; revenue: number }> = {};
    if (includeSales) {
      const salesStart = Date.now();
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - salesDays);
      const fromDateStr = fromDate.toISOString().substring(0, 10);
      const toDateStr = today.toISOString().substring(0, 10);

      const orderLines = await db.getOrderLinesByDateRange(accountId, fromDateStr, toDateStr);
      console.log(`getOrderLinesByDateRange took ${Date.now() - salesStart}ms for ${orderLines.length} lines`);

      // Aggregate by SKU
      for (const line of orderLines) {
        const lineSku = line.sku;
        if (!salesBySku[lineSku]) {
          salesBySku[lineSku] = { quantity: 0, revenue: 0 };
        }
        salesBySku[lineSku].quantity += line.quantity || 0;
        salesBySku[lineSku].revenue += line.lineTotalInclVat || 0;
      }
    }

    // Return products with optional sales data embedded
    const lightProducts = products.map(p => ({
      sku: p.sku,
      title: p.title,
      brand: p.brand,
      currentPrice: p.currentPrice,
      costPrice: p.costPrice,
      deliveryCost: p.deliveryCost,
      stockLevel: p.stockLevel,
      imageUrl: p.imageUrl,
      ...(includeSales && salesBySku[p.sku] ? {
        salesQuantity: salesBySku[p.sku].quantity,
        salesRevenue: salesBySku[p.sku].revenue,
      } : {}),
    }));

    return response(200, {
      items: lightProducts,
      count: lightProducts.length,
      ...(includeSales ? { salesDays } : {}),
    });
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
      family: body.family ?? existing.family,
      subcategory: body.subcategory ?? existing.subcategory,
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
      // Get proposal to log price change
      const proposal = await db.getProposal(accountId, id);
      if (proposal) {
        await db.updateProposalStatus(accountId, id, 'approved', ctx.userEmail);

        // Log the price change
        await db.logPriceChange(accountId, {
          sku: proposal.sku,
          channelId: 'all',
          previousPrice: proposal.currentPrice,
          newPrice: proposal.proposedPrice,
          changedBy: ctx.userEmail,
          changedAt: new Date().toISOString(),
          reason: 'proposal_approved',
          source: 'Proposals',
          proposalId: id,
        });
      }
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

    // Get current proposal before update
    const proposal = await db.getProposal(accountId, proposalId);
    if (!proposal) {
      return response(404, { error: 'Proposal not found' });
    }

    await db.updateProposalStatus(
      accountId,
      proposalId,
      body.status,
      ctx.userEmail,
      body.notes,
      body.approvedPrice
    );

    // Log price change if approved or modified
    if (body.status === 'approved' || body.status === 'modified') {
      const newPrice = body.approvedPrice !== undefined ? body.approvedPrice : proposal.proposedPrice;
      const reason = body.approvedPrice !== undefined ? 'proposal_modified' : 'proposal_approved';

      await db.logPriceChange(accountId, {
        sku: proposal.sku,
        channelId: 'all',
        previousPrice: proposal.currentPrice,
        newPrice,
        changedBy: ctx.userEmail,
        changedAt: new Date().toISOString(),
        reason,
        source: 'Proposals',
        notes: body.notes,
        proposalId,
      });

      console.log(`Price change logged from proposal: ${proposal.sku} ${proposal.currentPrice} -> ${newPrice} by ${ctx.userEmail}`);
    }

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

    // Calculate products with/without costs
    const productsWithCosts = products.filter((p) => p.costPrice && p.costPrice > 0).length;
    const productsWithoutCosts = products.length - productsWithCosts;

    // Calculate stock metrics
    const outOfStock = products.filter((p) => p.stockLevel === 0 || p.stockLevel === undefined).length;
    const lowStock = products.filter((p) => p.stockLevel !== undefined && p.stockLevel > 0 && p.stockLevel < 10).length;

    // Calculate average margin for products with costs and prices
    const calculateMargin = (p: { currentPrice?: number; costPrice?: number; deliveryCost?: number }): number => {
      if (!p.currentPrice || p.currentPrice <= 0) return 0;
      if (!p.costPrice || p.costPrice <= 0) return 0;
      const priceExVat = p.currentPrice / 1.2; // Remove 20% VAT
      const channelFee = priceExVat * 0.15; // ~15% average channel fee
      const totalCost = (p.costPrice || 0) + (p.deliveryCost || 0) + channelFee;
      const profit = priceExVat - totalCost;
      return (profit / priceExVat) * 100;
    };

    const productsWithValidMargins = products.filter(
      (p) => p.costPrice && p.costPrice > 0 && p.currentPrice && p.currentPrice > 0
    );
    const avgMargin =
      productsWithValidMargins.length > 0
        ? productsWithValidMargins.reduce((sum, p) => sum + calculateMargin(p), 0) / productsWithValidMargins.length
        : 0;

    return response(200, {
      totalProducts: products.length,
      productsWithCosts,
      productsWithoutCosts,
      outOfStock,
      lowStock,
      totalProposals: proposals.totalCount,
      pendingProposals: proposals.items.filter((p) => p.status === 'pending').length,
      avgMargin,
    });
  }

  if (path === '/analytics/sales') {
    const params = event.queryStringParameters || {};
    const includeDaily = params.includeDaily === 'true';
    const includePreviousYear = params.includePreviousYear === 'true';
    const includePreviousMonth = params.includePreviousMonth === 'true';

    // Calculate date range - use fromDate/toDate if provided, otherwise calculate from days
    const today = new Date();
    let fromDateStr: string;
    let toDateStr: string;
    let days: number;

    if (params.fromDate && params.toDate) {
      // Use explicit date range
      fromDateStr = params.fromDate;
      toDateStr = params.toDate;
      // Calculate days for the response
      const from = new Date(fromDateStr);
      const to = new Date(toDateStr);
      days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    } else {
      // Fall back to days parameter
      days = parseInt(params.days || '30', 10);
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - days);
      fromDateStr = fromDate.toISOString().substring(0, 10);
      toDateStr = today.toISOString().substring(0, 10);
    }

    // Get order lines for the date range
    const orderLines = await db.getOrderLinesByDateRange(accountId, fromDateStr, toDateStr);

    // Also fetch previous year data if requested
    let previousYearOrderLines: typeof orderLines = [];
    let previousYearFromDateStr = '';
    let previousYearToDateStr = '';
    if (includePreviousYear) {
      const previousYearFromDate = new Date(fromDateStr);
      previousYearFromDate.setFullYear(previousYearFromDate.getFullYear() - 1);
      const previousYearToDate = new Date(toDateStr);
      previousYearToDate.setFullYear(previousYearToDate.getFullYear() - 1);
      previousYearFromDateStr = previousYearFromDate.toISOString().substring(0, 10);
      previousYearToDateStr = previousYearToDate.toISOString().substring(0, 10);
      previousYearOrderLines = await db.getOrderLinesByDateRange(accountId, previousYearFromDateStr, previousYearToDateStr);
    }

    // Also fetch previous month data if requested
    let previousMonthOrderLines: typeof orderLines = [];
    let previousMonthFromDateStr = '';
    let previousMonthToDateStr = '';
    if (includePreviousMonth) {
      const previousMonthFromDate = new Date(fromDateStr);
      previousMonthFromDate.setMonth(previousMonthFromDate.getMonth() - 1);
      const previousMonthToDate = new Date(toDateStr);
      previousMonthToDate.setMonth(previousMonthToDate.getMonth() - 1);
      previousMonthFromDateStr = previousMonthFromDate.toISOString().substring(0, 10);
      previousMonthToDateStr = previousMonthToDate.toISOString().substring(0, 10);
      previousMonthOrderLines = await db.getOrderLinesByDateRange(accountId, previousMonthFromDateStr, previousMonthToDateStr);
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

    // Process previous month data if requested
    let previousMonthDailySales: Record<string, { quantity: number; revenue: number; orders: number }> | undefined;
    let previousMonthTotals: { quantity: number; revenue: number; orders: number } | undefined;
    let previousMonthTotalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }> | undefined;
    if (includePreviousMonth && previousMonthOrderLines.length > 0) {
      previousMonthDailySales = {};
      previousMonthTotalsByChannel = {};
      const pmOrderIdsByDate: Record<string, Set<string>> = {};
      let pmTotalQuantity = 0;
      let pmTotalRevenue = 0;
      let pmTotalOrders = 0;
      const pmAllOrderIds = new Set<string>();
      const pmChannelOrderIds: Record<string, Set<string>> = {};

      for (const line of previousMonthOrderLines) {
        const dateDay = line.orderDateDay || '';
        const orderId = line.orderId || '';
        const channel = line.channelName || 'Unknown';

        // Shift date forward by 1 month to align with current period
        if (dateDay) {
          const [year, month, day] = dateDay.split('-').map(Number);
          const shiftedDateObj = new Date(Date.UTC(year, month - 1 + 1, day)); // Add 1 month
          const shiftedDate = shiftedDateObj.toISOString().substring(0, 10);

          if (!previousMonthDailySales[shiftedDate]) {
            previousMonthDailySales[shiftedDate] = { quantity: 0, revenue: 0, orders: 0 };
            pmOrderIdsByDate[shiftedDate] = new Set();
          }

          previousMonthDailySales[shiftedDate].quantity += line.quantity || 0;
          previousMonthDailySales[shiftedDate].revenue += line.lineTotalInclVat || 0;

          if (!pmOrderIdsByDate[shiftedDate].has(orderId)) {
            pmOrderIdsByDate[shiftedDate].add(orderId);
            previousMonthDailySales[shiftedDate].orders++;
          }
        }

        // Previous month channel aggregation
        if (!previousMonthTotalsByChannel[channel]) {
          previousMonthTotalsByChannel[channel] = { quantity: 0, revenue: 0, orders: 0 };
          pmChannelOrderIds[channel] = new Set();
        }
        previousMonthTotalsByChannel[channel].quantity += line.quantity || 0;
        previousMonthTotalsByChannel[channel].revenue += line.lineTotalInclVat || 0;

        const orderKey = `${channel}:${orderId}`;
        if (!pmChannelOrderIds[channel].has(orderKey)) {
          pmChannelOrderIds[channel].add(orderKey);
          previousMonthTotalsByChannel[channel].orders++;
        }

        // Previous month totals
        pmTotalQuantity += line.quantity || 0;
        pmTotalRevenue += line.lineTotalInclVat || 0;
        if (!pmAllOrderIds.has(orderId)) {
          pmAllOrderIds.add(orderId);
          pmTotalOrders++;
        }
      }

      previousMonthTotals = {
        quantity: pmTotalQuantity,
        revenue: Math.round(pmTotalRevenue * 100) / 100,
        orders: pmTotalOrders,
      };
    }

    // Build family/category breakdown by joining with products
    // Family = primary categorisation from Akeneo PIM (e.g., "Furniture", "Showers")
    // Category = subcategory (e.g., "Vanity Units", "Mirror Cabinets")
    const includeCategories = params.includeCategories === 'true';
    let totalsByFamily: Record<string, {
      quantity: number;
      revenue: number;
      orders: number;
      categories: Record<string, { quantity: number; revenue: number; orders: number }>;
    }> | undefined;
    let dailySalesByFamily: Record<string, Record<string, { quantity: number; revenue: number }>> | undefined;
    let previousYearTotalsByFamily: Record<string, {
      quantity: number;
      revenue: number;
      orders: number;
      categories: Record<string, { quantity: number; revenue: number; orders: number }>;
    }> | undefined;
    let previousMonthTotalsByFamily: Record<string, {
      quantity: number;
      revenue: number;
      orders: number;
      categories: Record<string, { quantity: number; revenue: number; orders: number }>;
    }> | undefined;

    if (includeCategories) {
      // Get all products to map SKU -> family and category
      const products = await db.getAllProducts(accountId);
      const skuToFamilyCategory: Record<string, { family: string; category: string }> = {};
      for (const product of products) {
        skuToFamilyCategory[product.sku] = {
          family: product.family || 'Uncategorized',
          category: product.subcategory || product.category || 'Other',
        };
      }

      // Current period family aggregation with nested categories
      totalsByFamily = {};
      const familyOrderIds: Record<string, Set<string>> = {};
      const categoryOrderIds: Record<string, Record<string, Set<string>>> = {};

      // Daily sales by family (same structure as dailySales but by family)
      if (includeDaily) {
        dailySalesByFamily = {};
      }

      for (const line of orderLines) {
        const { family, category } = skuToFamilyCategory[line.sku] || { family: 'Uncategorized', category: 'Other' };
        const orderId = line.orderId || '';
        const dateDay = line.orderDateDay || '';

        // Initialize family if needed
        if (!totalsByFamily[family]) {
          totalsByFamily[family] = { quantity: 0, revenue: 0, orders: 0, categories: {} };
          familyOrderIds[family] = new Set();
          categoryOrderIds[family] = {};
        }

        // Initialize category within family if needed
        if (!totalsByFamily[family].categories[category]) {
          totalsByFamily[family].categories[category] = { quantity: 0, revenue: 0, orders: 0 };
          categoryOrderIds[family][category] = new Set();
        }

        // Aggregate at family level
        totalsByFamily[family].quantity += line.quantity || 0;
        totalsByFamily[family].revenue += line.lineTotalInclVat || 0;

        // Aggregate at category level
        totalsByFamily[family].categories[category].quantity += line.quantity || 0;
        totalsByFamily[family].categories[category].revenue += line.lineTotalInclVat || 0;

        // Count unique orders at family level
        const familyOrderKey = `${family}:${orderId}`;
        if (!familyOrderIds[family].has(familyOrderKey)) {
          familyOrderIds[family].add(familyOrderKey);
          totalsByFamily[family].orders++;
        }

        // Count unique orders at category level
        const catOrderKey = `${category}:${orderId}`;
        if (!categoryOrderIds[family][category].has(catOrderKey)) {
          categoryOrderIds[family][category].add(catOrderKey);
          totalsByFamily[family].categories[category].orders++;
        }

        // Daily aggregation by family (for chart - keep flat by family only)
        if (includeDaily && dateDay && dailySalesByFamily) {
          if (!dailySalesByFamily[dateDay]) {
            dailySalesByFamily[dateDay] = {};
          }
          if (!dailySalesByFamily[dateDay][family]) {
            dailySalesByFamily[dateDay][family] = { quantity: 0, revenue: 0 };
          }
          dailySalesByFamily[dateDay][family].quantity += line.quantity || 0;
          dailySalesByFamily[dateDay][family].revenue += line.lineTotalInclVat || 0;
        }
      }

      // Previous year family aggregation with nested categories
      if (includePreviousYear && previousYearOrderLines.length > 0) {
        previousYearTotalsByFamily = {};
        const pyFamilyOrderIds: Record<string, Set<string>> = {};
        const pyCategoryOrderIds: Record<string, Record<string, Set<string>>> = {};

        for (const line of previousYearOrderLines) {
          const { family, category } = skuToFamilyCategory[line.sku] || { family: 'Uncategorized', category: 'Other' };
          const orderId = line.orderId || '';

          if (!previousYearTotalsByFamily[family]) {
            previousYearTotalsByFamily[family] = { quantity: 0, revenue: 0, orders: 0, categories: {} };
            pyFamilyOrderIds[family] = new Set();
            pyCategoryOrderIds[family] = {};
          }

          if (!previousYearTotalsByFamily[family].categories[category]) {
            previousYearTotalsByFamily[family].categories[category] = { quantity: 0, revenue: 0, orders: 0 };
            pyCategoryOrderIds[family][category] = new Set();
          }

          previousYearTotalsByFamily[family].quantity += line.quantity || 0;
          previousYearTotalsByFamily[family].revenue += line.lineTotalInclVat || 0;
          previousYearTotalsByFamily[family].categories[category].quantity += line.quantity || 0;
          previousYearTotalsByFamily[family].categories[category].revenue += line.lineTotalInclVat || 0;

          const familyOrderKey = `${family}:${orderId}`;
          if (!pyFamilyOrderIds[family].has(familyOrderKey)) {
            pyFamilyOrderIds[family].add(familyOrderKey);
            previousYearTotalsByFamily[family].orders++;
          }

          const catOrderKey = `${category}:${orderId}`;
          if (!pyCategoryOrderIds[family][category].has(catOrderKey)) {
            pyCategoryOrderIds[family][category].add(catOrderKey);
            previousYearTotalsByFamily[family].categories[category].orders++;
          }
        }
      }

      // Previous month family aggregation with nested categories
      if (includePreviousMonth && previousMonthOrderLines.length > 0) {
        previousMonthTotalsByFamily = {};
        const pmFamilyOrderIds: Record<string, Set<string>> = {};
        const pmCategoryOrderIds: Record<string, Record<string, Set<string>>> = {};

        for (const line of previousMonthOrderLines) {
          const { family, category } = skuToFamilyCategory[line.sku] || { family: 'Uncategorized', category: 'Other' };
          const orderId = line.orderId || '';

          if (!previousMonthTotalsByFamily[family]) {
            previousMonthTotalsByFamily[family] = { quantity: 0, revenue: 0, orders: 0, categories: {} };
            pmFamilyOrderIds[family] = new Set();
            pmCategoryOrderIds[family] = {};
          }

          if (!previousMonthTotalsByFamily[family].categories[category]) {
            previousMonthTotalsByFamily[family].categories[category] = { quantity: 0, revenue: 0, orders: 0 };
            pmCategoryOrderIds[family][category] = new Set();
          }

          previousMonthTotalsByFamily[family].quantity += line.quantity || 0;
          previousMonthTotalsByFamily[family].revenue += line.lineTotalInclVat || 0;
          previousMonthTotalsByFamily[family].categories[category].quantity += line.quantity || 0;
          previousMonthTotalsByFamily[family].categories[category].revenue += line.lineTotalInclVat || 0;

          const familyOrderKey = `${family}:${orderId}`;
          if (!pmFamilyOrderIds[family].has(familyOrderKey)) {
            pmFamilyOrderIds[family].add(familyOrderKey);
            previousMonthTotalsByFamily[family].orders++;
          }

          const catOrderKey = `${category}:${orderId}`;
          if (!pmCategoryOrderIds[family][category].has(catOrderKey)) {
            pmCategoryOrderIds[family][category].add(catOrderKey);
            previousMonthTotalsByFamily[family].categories[category].orders++;
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

    if (includePreviousMonth) {
      result.previousMonth = {
        fromDate: previousMonthFromDateStr,
        toDate: previousMonthToDateStr,
        dailySales: previousMonthDailySales || {},
        totals: previousMonthTotals || { quantity: 0, revenue: 0, orders: 0 },
        totalsByChannel: previousMonthTotalsByChannel || {},
      };
    }

    if (includeCategories) {
      result.totalsByFamily = totalsByFamily || {};
      result.families = Object.keys(totalsByFamily || {}).sort();
      if (includeDaily) {
        result.dailySalesByFamily = dailySalesByFamily || {};
      }
      if (includePreviousYear) {
        result.previousYearTotalsByFamily = previousYearTotalsByFamily || {};
      }
      if (includePreviousMonth) {
        result.previousMonthTotalsByFamily = previousMonthTotalsByFamily || {};
      }
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

  // POST /carriers/recalculate - Recalculate delivery costs for all products
  if (method === 'POST' && carrierId === 'recalculate') {
    requireAdmin(ctx);
    const result = await recalculateDeliveryCosts(accountId);
    return response(200, result);
  }

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

/**
 * Recalculate delivery costs for all products based on order delivery data
 */
async function recalculateDeliveryCosts(accountId: string): Promise<{
  ordersWithDeliveryData: number;
  ordersProcessed: number;
  ordersSkipped: number;
  skusAnalyzed: number;
  productsUpdated: number;
  productsUnchanged: number;
  updatedSkus: Array<{ sku: string; oldCost: number; newCost: number; carrier: string }>;
}> {
  // Get all orders with delivery data
  const orders = await db.getOrdersWithDeliveryData(accountId);
  const ordersWithDeliveryData = orders.length;

  // Get all carrier costs
  const carriers = await db.getAllCarrierCosts(accountId);
  const carrierCostMap = new Map<string, number>();
  for (const carrier of carriers) {
    if (carrier.isActive) {
      carrierCostMap.set(carrier.carrierName.toLowerCase(), carrier.costPerParcel);
    }
  }

  // Aggregate delivery costs by SKU
  const skuDeliveryCosts: Record<string, { totalCost: number; orderCount: number; carrier: string }> = {};

  let ordersProcessed = 0;
  let ordersSkipped = 0;

  for (const order of orders) {
    const carrierName = order.deliveryCarrier?.toLowerCase();
    const carrierCost = carrierName ? carrierCostMap.get(carrierName) : undefined;

    if (!carrierCost || !order.deliveryParcels) {
      ordersSkipped++;
      continue;
    }

    ordersProcessed++;
    const deliveryCost = carrierCost * order.deliveryParcels;

    // Get order lines to attribute cost to SKUs
    const orderLines = await db.getOrderLinesByOrderId(accountId, order.orderId);
    if (orderLines.length === 0) continue;

    // Distribute delivery cost across SKUs in the order
    const costPerLine = deliveryCost / orderLines.length;

    for (const line of orderLines) {
      if (!skuDeliveryCosts[line.sku]) {
        skuDeliveryCosts[line.sku] = { totalCost: 0, orderCount: 0, carrier: order.deliveryCarrier || '' };
      }
      skuDeliveryCosts[line.sku].totalCost += costPerLine;
      skuDeliveryCosts[line.sku].orderCount++;
    }
  }

  // Update products with new average delivery costs
  const skusAnalyzed = Object.keys(skuDeliveryCosts).length;
  let productsUpdated = 0;
  let productsUnchanged = 0;
  const updatedSkus: Array<{ sku: string; oldCost: number; newCost: number; carrier: string }> = [];

  for (const [sku, data] of Object.entries(skuDeliveryCosts)) {
    const avgDeliveryCost = data.orderCount > 0 ? data.totalCost / data.orderCount : 0;
    const roundedCost = Math.round(avgDeliveryCost * 100) / 100;

    // Get current product
    const product = await db.getProduct(accountId, sku);
    if (!product) continue;

    const oldCost = product.deliveryCost || 0;

    // Only update if cost changed significantly (> 0.01)
    if (Math.abs(roundedCost - oldCost) > 0.01) {
      await db.updateProduct(accountId, sku, { deliveryCost: roundedCost });
      productsUpdated++;
      updatedSkus.push({ sku, oldCost, newCost: roundedCost, carrier: data.carrier });
    } else {
      productsUnchanged++;
    }
  }

  return {
    ordersWithDeliveryData,
    ordersProcessed,
    ordersSkipped,
    skusAnalyzed,
    productsUpdated,
    productsUnchanged,
    updatedSkus: updatedSkus.slice(0, 50), // Limit to first 50 for response size
  };
}

// ============ Prices (Account-Scoped) ============

async function handlePrices(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  const params = event.queryStringParameters || {};

  // Parse path: /prices/{sku} or /prices/{sku}/history
  const pathParts = event.path.split('/').filter(Boolean);
  const sku = pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined;
  const isHistory = pathParts[2] === 'history';

  // GET /prices/{sku}/history - Get price change history
  if (method === 'GET' && sku && isHistory) {
    const limit = params.limit ? parseInt(params.limit, 10) : 50;
    const history = await db.getPriceHistory(accountId, sku, limit);

    return response(200, {
      items: history,
      count: history.length,
      sku,
    });
  }

  // GET /prices/recent - Get recent price changes across all SKUs
  if (method === 'GET' && pathParts[1] === 'recent') {
    const limit = params.limit ? parseInt(params.limit, 10) : 100;
    const changes = await db.getRecentPriceChanges(accountId, limit);

    return response(200, {
      items: changes,
      count: changes.length,
    });
  }

  // PUT /prices/{sku} - Update price and log the change
  if (method === 'PUT' && sku) {
    requireEditor(ctx);

    const body = JSON.parse(event.body || '{}');
    const { channelId, price, notes } = body;

    if (!channelId || price === undefined || price === null) {
      return response(400, { error: 'channelId and price are required' });
    }

    if (typeof price !== 'number' || price < 0) {
      return response(400, { error: 'price must be a non-negative number' });
    }

    // Get current product to record previous price
    const product = await db.getProduct(accountId, sku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    // Get previous price
    let previousPrice = 0;
    if (channelId === 'all') {
      previousPrice = product.currentPrice || 0;
    } else if (product.channelPrices) {
      const channelKey = channelId as keyof typeof product.channelPrices;
      if (product.channelPrices[channelKey]) {
        previousPrice = product.channelPrices[channelKey]!;
      }
    }

    // Update the product price
    const updates: Record<string, unknown> = {};
    if (channelId === 'all') {
      updates.currentPrice = price;
    } else {
      const channelPrices: Record<string, number | undefined> = { ...(product.channelPrices || {}) };
      channelPrices[channelId] = price;
      updates.channelPrices = channelPrices;
    }

    await db.updateProduct(accountId, sku, updates);

    // Log the price change
    await db.logPriceChange(accountId, {
      sku,
      channelId,
      previousPrice,
      newPrice: price,
      changedBy: ctx.userEmail,
      changedAt: new Date().toISOString(),
      reason: 'manual',
      source: 'ProductDetail',
      notes,
    });

    console.log(`Price change logged: ${sku} ${channelId} ${previousPrice} -> ${price} by ${ctx.userEmail}`);

    return response(200, {
      success: true,
      message: 'Price updated successfully',
      sku,
      channelId,
      price,
      previousPrice,
    });
  }

  return response(400, { error: 'Invalid request' });
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
 * Uses the efficient by-account-date GSI and filters by SKU in memory
 */
async function getChannelSalesByDay(
  accountId: string,
  sku: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, Record<string, { quantity: number; revenue: number }>>> {
  // Use the efficient date-range query (uses by-account-date GSI)
  // then filter by SKU in memory - much faster than FilterExpression
  const allOrderLines = await db.getOrderLinesByDateRange(accountId, fromDate, toDate);

  // Filter to just this SKU (case-insensitive match)
  const skuUpper = sku.toUpperCase();
  const orderLines = allOrderLines.filter(line => line.sku.toUpperCase() === skuUpper);

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

// ============ Import Handlers ============

async function handleImport(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const ctxWithAccount = requireAccountContext(ctx);
  const accountId = ctxWithAccount.accountId;

  // Cost import - requires at least editor role
  if (path.endsWith('/costs') && event.httpMethod === 'POST') {
    requireEditor(ctx);
    return handleCostImport(event, accountId);
  }

  // Delivery import - requires at least editor role
  if (path.endsWith('/delivery') && event.httpMethod === 'POST') {
    requireEditor(ctx);
    return handleDeliveryImport(event, accountId);
  }

  return response(404, { error: 'Import endpoint not found' });
}

async function handleCostImport(
  event: APIGatewayProxyEvent,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  // Validate and sanitize input data
  if (!body.data || !Array.isArray(body.data)) {
    return response(400, { error: 'Invalid data format. Expected { data: [...] }' });
  }

  // Validate each row
  const validationErrors: string[] = [];
  const csvData: Array<{ sku: string; costPrice: number; deliveryCost?: number }> = [];

  for (let i = 0; i < body.data.length; i++) {
    const row = body.data[i];

    // Validate SKU
    if (!row.sku || typeof row.sku !== 'string') {
      validationErrors.push(`Row ${i + 1}: Invalid or missing SKU`);
      continue;
    }
    if (row.sku.length > 100) {
      validationErrors.push(`Row ${i + 1}: SKU exceeds maximum length (100 chars)`);
      continue;
    }

    // Validate costPrice
    if (typeof row.costPrice !== 'number' || !isFinite(row.costPrice)) {
      validationErrors.push(`Row ${i + 1}: costPrice must be a valid number`);
      continue;
    }
    if (row.costPrice < 0) {
      validationErrors.push(`Row ${i + 1}: costPrice cannot be negative`);
      continue;
    }
    if (row.costPrice > 1000000) {
      validationErrors.push(`Row ${i + 1}: costPrice exceeds maximum value`);
      continue;
    }

    // Validate deliveryCost if provided
    if (row.deliveryCost !== undefined && row.deliveryCost !== null) {
      if (typeof row.deliveryCost !== 'number' || !isFinite(row.deliveryCost)) {
        validationErrors.push(`Row ${i + 1}: deliveryCost must be a valid number`);
        continue;
      }
      if (row.deliveryCost < 0) {
        validationErrors.push(`Row ${i + 1}: deliveryCost cannot be negative`);
        continue;
      }
    }

    // Sanitize and add to valid data
    csvData.push({
      sku: row.sku.trim(),
      costPrice: Math.round(row.costPrice * 100) / 100, // Round to 2 decimal places
      deliveryCost: row.deliveryCost !== undefined ? Math.round(row.deliveryCost * 100) / 100 : undefined,
    });
  }

  // Return validation errors if any
  if (validationErrors.length > 0) {
    return response(400, {
      error: 'Validation errors in import data',
      validationErrors: validationErrors.slice(0, 20), // Limit to first 20 errors
      totalErrors: validationErrors.length,
    });
  }

  console.log(`[Import:${accountId}] Processing ${csvData.length} cost records`);

  // Get all products for this account
  const existingProducts = await db.getAllProducts(accountId);
  const productsBySku = new Map<string, Product>();
  const productsByBalterleySku = new Map<string, Product>();

  for (const product of existingProducts) {
    productsBySku.set(product.sku.toUpperCase(), product);
    if (product.balterleySku) {
      productsByBalterleySku.set(product.balterleySku.toUpperCase(), product);
    }
  }

  console.log(`[Import:${accountId}] Loaded ${existingProducts.length} products`);

  let updated = 0;
  let notFound = 0;
  let matchedByBalterley = 0;
  const notFoundSkus: string[] = [];
  const productsToUpdate: Product[] = [];

  for (const row of csvData) {
    const skuUpper = row.sku.toUpperCase().trim();

    // Try matching by primary SKU first (case-insensitive)
    let product = productsBySku.get(skuUpper);

    // If not found, try matching by Balterley SKU
    if (!product) {
      product = productsByBalterleySku.get(skuUpper);
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

  // Batch write all updates
  if (productsToUpdate.length > 0) {
    console.log(`[Import:${accountId}] Batch writing ${productsToUpdate.length} products...`);
    await db.batchPutProducts(accountId, productsToUpdate);
  }

  // Find database SKUs that weren't in the import file
  const importedSkuSet = new Set(csvData.map(row => row.sku.toUpperCase().trim()));
  const dbSkusMissingFromFile: string[] = [];
  let missingCount = 0;

  for (const [skuUpper, product] of productsBySku) {
    if (!importedSkuSet.has(skuUpper)) {
      missingCount++;
      if (dbSkusMissingFromFile.length < 50) {
        dbSkusMissingFromFile.push(product.sku);
      }
    }
  }

  console.log(`[Import:${accountId}] Complete: ${updated} updated, ${notFound} not found in DB, ${missingCount} DB SKUs missing from file, ${matchedByBalterley} matched by Balterley SKU`);

  return response(200, {
    message: 'Cost import complete',
    updated,
    notFoundInDb: notFound,
    matchedByBalterleySku: matchedByBalterley,
    total: csvData.length,
    sampleNotFoundInDb: notFoundSkus.length > 0 ? notFoundSkus : undefined,
    dbProductsMissingFromFile: missingCount,
    sampleDbSkusMissingFromFile: dbSkusMissingFromFile.length > 0 ? dbSkusMissingFromFile : undefined,
  });
}

async function handleDeliveryImport(
  event: APIGatewayProxyEvent,
  accountId: string
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const deliveryData: Array<{
    orderNumber: string;
    parcels: number;
    carrier: string;
  }> = body.data;

  if (!deliveryData || !Array.isArray(deliveryData)) {
    return response(400, { error: 'Invalid data format. Expected { data: [...] }' });
  }

  console.log(`[DeliveryImport:${accountId}] Processing ${deliveryData.length} delivery records`);

  // Get carrier costs for lookup
  const carrierCosts = await db.getAllCarrierCosts(accountId);
  const carrierCostMap = new Map(carrierCosts.map(c => [c.carrierId, c.costPerParcel]));
  console.log(`[DeliveryImport:${accountId}] Loaded ${carrierCosts.length} carrier cost configurations`);

  // Get all orders for matching
  const allOrders = await db.getAllOrders(accountId);
  console.log(`[DeliveryImport:${accountId}] Loaded ${allOrders.length} orders for matching`);

  // Get all products for SKU delivery cost updates
  const allProducts = await db.getAllProducts(accountId);
  const productsBySku = new Map(allProducts.map(p => [p.sku, p]));
  console.log(`[DeliveryImport:${accountId}] Loaded ${allProducts.length} products for delivery cost calculation`);

  // Create lookup map for orders by channelOrderNo
  const orderByChannelOrderNo = new Map(allOrders.map(o => [o.channelOrderNo, o]));
  const orderByBasePoNumber = new Map<string, typeof allOrders[0]>();
  for (const order of allOrders) {
    if (order.channelOrderNo && order.channelOrderNo.includes('-')) {
      const basePo = order.channelOrderNo.split('-')[0];
      if (!orderByBasePoNumber.has(basePo)) {
        orderByBasePoNumber.set(basePo, order);
      }
    }
  }

  const carriersFound = new Set<string>();
  const excludedCarriers = new Set<string>();
  let ordersProcessed = 0;
  let ordersMatched = 0;
  let ordersSkipped = 0;
  let ordersNotFound = 0;

  // Track SKU delivery stats
  const skuDeliveryStats = new Map<string, {
    carrierCounts: Record<string, number>;
    totalDeliveryCost: number;
    totalQuantity: number;
    orderCount: number;
  }>();

  // Process delivery records
  for (const record of deliveryData) {
    ordersProcessed++;

    // Skip excluded carriers
    if (isExcludedCarrier(record.carrier)) {
      excludedCarriers.add(record.carrier);
      ordersSkipped++;
      continue;
    }

    const normalizedCarrier = normalizeCarrierName(record.carrier);
    if (normalizedCarrier !== 'unknown') {
      carriersFound.add(normalizedCarrier);
    }

    const poNumber = record.orderNumber.trim();
    let matchedOrder = orderByChannelOrderNo.get(poNumber);

    if (!matchedOrder) {
      const basePoNumber = poNumber.includes('-') ? poNumber.split('-')[0] : poNumber;
      matchedOrder = orderByBasePoNumber.get(basePoNumber);
    }

    if (matchedOrder) {
      await db.updateOrderDelivery(accountId, matchedOrder.orderId, {
        deliveryCarrier: normalizedCarrier,
        deliveryCarrierRaw: record.carrier,
        deliveryParcels: record.parcels,
      });
      ordersMatched++;

      // Aggregate delivery stats by SKU
      const lines = matchedOrder.lines || [];
      const carrierCost = carrierCostMap.get(normalizedCarrier) || 0;
      const orderDeliveryCost = carrierCost;

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
        carrierName: carrierId.charAt(0).toUpperCase() + carrierId.slice(1).replace(/_/g, ' '),
        costPerParcel: 0,
        isActive: true,
        lastUpdated: new Date().toISOString(),
      };
      newCarriers.push(newCarrier);
      await db.putCarrierCost(accountId, newCarrier);
    }
  }

  // Update product delivery costs based on aggregated stats
  const productsUpdated: Product[] = [];
  for (const [sku, stats] of skuDeliveryStats) {
    const product = productsBySku.get(sku);
    if (product && stats.totalQuantity > 0) {
      const deliveryCostPerUnit = stats.totalDeliveryCost / stats.totalQuantity;
      product.deliveryCost = Math.round(deliveryCostPerUnit * 100) / 100;
      // Store carrier breakdown as additional field (DynamoDB is schema-less)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (product as any).deliveryCarrierBreakdown = stats.carrierCounts;
      productsUpdated.push(product);
    }
  }

  if (productsUpdated.length > 0) {
    console.log(`[DeliveryImport:${accountId}] Updating delivery costs for ${productsUpdated.length} products`);
    await db.batchPutProducts(accountId, productsUpdated);
  }

  console.log(`[DeliveryImport:${accountId}] Complete: ${ordersMatched} matched, ${ordersNotFound} not found, ${ordersSkipped} skipped (excluded carriers)`);

  return response(200, {
    message: 'Delivery import complete',
    ordersProcessed,
    ordersMatched,
    ordersNotFound,
    ordersSkipped,
    excludedCarriers: Array.from(excludedCarriers),
    carriersFound: Array.from(carriersFound),
    newCarriersCreated: newCarriers.length,
    productsUpdated: productsUpdated.length,
  });
}
