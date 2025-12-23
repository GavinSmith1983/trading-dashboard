import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
  scrapeProductCompetitors,
} from '@repricing/core';
import { v4 as uuid } from 'uuid';

const lambdaClient = new LambdaClient({});
const s3Client = new S3Client({});
const IMPORT_DATA_BUCKET = process.env.IMPORT_DATA_BUCKET || 'repricing-v2-exports-610274502245';

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
  event: APIGatewayProxyEvent & { asyncImport?: { jobId: string; type: 'costs' } },
  context: Context
): Promise<APIGatewayProxyResult> {
  // Handle async import invocation (triggered by self-invoke)
  if (event.asyncImport) {
    const { jobId, type } = event.asyncImport;
    console.log(`[AsyncImport] Processing job ${jobId}`);
    try {
      // Fetch import data from S3
      const s3Key = `import-jobs/${jobId}.json`;
      const getResponse = await s3Client.send(new GetObjectCommand({
        Bucket: IMPORT_DATA_BUCKET,
        Key: s3Key,
      }));
      const csvData = JSON.parse(await getResponse.Body!.transformToString());
      console.log(`[AsyncImport] Loaded ${csvData.length} records from S3`);

      const result = await processAsyncCostImport(csvData, jobId);
      await db.completeImportJob(jobId, 'completed', result);
      console.log(`[AsyncImport] Job ${jobId} completed. S3 file kept for debugging: s3://${IMPORT_DATA_BUCKET}/${s3Key}`);
    } catch (error) {
      console.error(`[AsyncImport] Job ${jobId} failed:`, error);
      await db.completeImportJob(jobId, 'failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    // Return empty response for async invocation
    return response(200, { message: 'Async import processed' });
  }

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
    if (path.startsWith('/competitors')) {
      return handleCompetitors(event, ctx);
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
      dataSource: body.dataSource ?? existing.dataSource,
      channelEngine: body.channelEngine && existing.channelEngine
        ? { ...existing.channelEngine, ...body.channelEngine }
        : body.channelEngine
          ? { apiKey: body.channelEngine.apiKey!, tenantId: body.channelEngine.tenantId! }
          : existing.channelEngine,
      csCart: body.csCart && existing.csCart
        ? { ...existing.csCart, ...body.csCart }
        : body.csCart
          ? { baseUrl: body.csCart.baseUrl!, email: body.csCart.email!, apiKey: body.csCart.apiKey!, companyId: body.csCart.companyId }
          : existing.csCart,
      googleSheets: body.googleSheets && existing.googleSheets
        ? { ...existing.googleSheets, ...body.googleSheets }
        : existing.googleSheets,
      settings: body.settings
        ? { ...existing.settings, ...body.settings }
        : existing.settings,
      orderNumberPrefix: body.orderNumberPrefix ?? existing.orderNumberPrefix,
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

      const orderLines = await db.getOrderLinesForAggregation(accountId, fromDateStr, toDateStr);
      console.log(`getOrderLinesForAggregation took ${Date.now() - salesStart}ms for ${orderLines.length} lines`);

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
    // Get status counts - fetch ALL proposals (not paginated) to get accurate counts
    const proposals = await db.queryProposals(accountId, {}, 1, 100000);
    const counts = {
      pending: 0,
      approved: 0,
      modified: 0,
      rejected: 0,
      pushed: 0,
      totalApproved: 0, // approved + modified combined for the "Approved" card
    };
    for (const p of proposals.items) {
      if (p.status === 'approved' || p.status === 'modified') {
        counts.totalApproved++;
      }
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
    const [products, proposals, account] = await Promise.all([
      db.getAllProducts(accountId),
      db.queryProposals(accountId, {}),
      db.getAccount(accountId),
    ]);

    // Get channel fee percentage from account settings (default: 15%)
    const channelFeePercent = account?.settings?.defaultChannelFeePercent ?? 15;

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
      const channelFee = priceExVat * (channelFeePercent / 100); // Use account-specific channel fee
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
    const includePreviousWeek = params.includePreviousWeek === 'true';
    const includeAvgSameWeekday = params.includeAvgSameWeekday === 'true';
    const includeBrands = params.includeBrands === 'true';
    const includeCategories = params.includeCategories === 'true';
    const includeDrilldown = params.includeDrilldown === 'true';
    const includeStockCodes = params.includeStockCodes === 'true';

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
    const orderLines = await db.getOrderLinesForAggregation(accountId, fromDateStr, toDateStr);

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
      previousYearOrderLines = await db.getOrderLinesForAggregation(accountId, previousYearFromDateStr, previousYearToDateStr);
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
      previousMonthOrderLines = await db.getOrderLinesForAggregation(accountId, previousMonthFromDateStr, previousMonthToDateStr);
    }

    // Also fetch previous week data if requested
    let previousWeekOrderLines: typeof orderLines = [];
    let previousWeekFromDateStr = '';
    let previousWeekToDateStr = '';
    if (includePreviousWeek) {
      const previousWeekFromDate = new Date(fromDateStr);
      previousWeekFromDate.setDate(previousWeekFromDate.getDate() - 7);
      const previousWeekToDate = new Date(toDateStr);
      previousWeekToDate.setDate(previousWeekToDate.getDate() - 7);
      previousWeekFromDateStr = previousWeekFromDate.toISOString().substring(0, 10);
      previousWeekToDateStr = previousWeekToDate.toISOString().substring(0, 10);
      previousWeekOrderLines = await db.getOrderLinesForAggregation(accountId, previousWeekFromDateStr, previousWeekToDateStr);
    }

    // Also fetch average same weekday data if requested (last 6 occurrences of same weekday)
    // Pro-rated: only include orders from before the current time of day
    let avgSameWeekdayOrderLines: typeof orderLines = [];
    let avgSameWeekdayDates: string[] = [];
    if (includeAvgSameWeekday) {
      // Get current time to filter historical orders (pro-rated comparison)
      const now = new Date();
      const currentTimeStr = now.toISOString().substring(11, 19); // HH:MM:SS
      console.log('AvgSameWeekday: Current time filter:', currentTimeStr);

      // Get data from last 6 same weekdays (going back 7, 14, 21, 28, 35, 42 days)
      const fromDate = new Date(fromDateStr);
      for (let i = 1; i <= 6; i++) {
        const pastDate = new Date(fromDate);
        pastDate.setDate(pastDate.getDate() - (7 * i));
        const pastDateStr = pastDate.toISOString().substring(0, 10);
        avgSameWeekdayDates.push(pastDateStr);
        const pastOrderLines = await db.getOrderLinesForAggregation(accountId, pastDateStr, pastDateStr);

        // Filter to only include orders that occurred before the current time of day
        // orderDate format: "ISO-timestamp#orderId" e.g. "2025-01-15T14:30:00.000Z#12345"
        const filteredLines = pastOrderLines.filter(line => {
          if (!line.orderDate || line.orderDate.length < 19) {
            return true; // Include if no timestamp available
          }
          const orderTimeStr = line.orderDate.substring(11, 19); // Extract HH:MM:SS
          return orderTimeStr <= currentTimeStr;
        });

        console.log(`AvgSameWeekday: ${pastDateStr} - ${pastOrderLines.length} total, ${filteredLines.length} after time filter`);
        avgSameWeekdayOrderLines = avgSameWeekdayOrderLines.concat(filteredLines);
      }
    }

    // Build SKU maps for brand, family/category, and title
    // Fetch products if any feature needs them
    let skuToBrand: Record<string, string> = {};
    let skuToProduct: Record<string, { title: string; family: string; category: string; brand: string; stockCode?: string }> = {};
    const needsProducts = includeBrands || includeCategories || includeDrilldown || includeStockCodes;

    if (needsProducts) {
      const products = await db.getAllProducts(accountId);
      for (const product of products) {
        if (product.sku) {
          if (product.brand) {
            skuToBrand[product.sku] = product.brand;
          }
          skuToProduct[product.sku] = {
            title: product.title || product.sku,
            family: product.familyLabel || product.family || 'Uncategorized',
            category: product.subcategory || product.category || 'Other',
            brand: product.brand || 'Unknown',
            stockCode: product.stockCode,
          };
        }
      }
    }

    // Aggregate by SKU, channel, brand, stockCode, and optionally by day
    const salesBySku: Record<string, { quantity: number; revenue: number }> = {};
    const totalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }> = {};
    const totalsByBrand: Record<string, { quantity: number; revenue: number; orders: number }> = {};
    const totalsByStockCode: Record<string, { stockCode: string; quantity: number; revenue: number; orders: number; skus: string[] }> = {};
    const dailySales: Record<string, Record<string, { quantity: number; revenue: number; orders: number }>> = {};
    const dailySalesByBrand: Record<string, Record<string, { quantity: number; revenue: number; orders: number }>> = {};
    const dailySalesByStockCode: Record<string, Record<string, { quantity: number; revenue: number; orders: number }>> = {};
    const orderIdsByDate: Record<string, Set<string>> = {};
    const allOrderIds = new Set<string>();
    const brandOrderIds = new Set<string>();
    const stockCodeOrderIds = new Set<string>();
    const stockCodeSkus: Record<string, Set<string>> = {};

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

      // Brand aggregation (if requested)
      if (includeBrands) {
        const brand = skuToBrand[sku] || 'Unknown';
        if (!totalsByBrand[brand]) {
          totalsByBrand[brand] = { quantity: 0, revenue: 0, orders: 0 };
        }
        totalsByBrand[brand].quantity += line.quantity || 0;
        totalsByBrand[brand].revenue += line.lineTotalInclVat || 0;

        // Track unique orders per brand
        const brandOrderKey = `${brand}:${orderId}`;
        if (!brandOrderIds.has(brandOrderKey)) {
          brandOrderIds.add(brandOrderKey);
          totalsByBrand[brand].orders++;
        }

        // Daily brand aggregation (if daily is also requested)
        if (includeDaily && dateDay) {
          if (!dailySalesByBrand[dateDay]) {
            dailySalesByBrand[dateDay] = {};
          }
          if (!dailySalesByBrand[dateDay][brand]) {
            dailySalesByBrand[dateDay][brand] = { quantity: 0, revenue: 0, orders: 0 };
          }
          dailySalesByBrand[dateDay][brand].quantity += line.quantity || 0;
          dailySalesByBrand[dateDay][brand].revenue += line.lineTotalInclVat || 0;
          // Orders tracked at brand level above
        }
      }

      // Stock Code aggregation (if requested) - groups Sales Codes under their parent Stock Code
      if (includeStockCodes) {
        const productInfo = skuToProduct[sku];
        const stockCode = productInfo?.stockCode || sku; // Fall back to SKU if no stockCode

        if (!totalsByStockCode[stockCode]) {
          totalsByStockCode[stockCode] = { stockCode, quantity: 0, revenue: 0, orders: 0, skus: [] };
          stockCodeSkus[stockCode] = new Set();
        }
        totalsByStockCode[stockCode].quantity += line.quantity || 0;
        totalsByStockCode[stockCode].revenue += line.lineTotalInclVat || 0;

        // Track unique SKUs under this stockCode
        if (!stockCodeSkus[stockCode].has(sku)) {
          stockCodeSkus[stockCode].add(sku);
        }

        // Track unique orders per stockCode
        const stockCodeOrderKey = `${stockCode}:${orderId}`;
        if (!stockCodeOrderIds.has(stockCodeOrderKey)) {
          stockCodeOrderIds.add(stockCodeOrderKey);
          totalsByStockCode[stockCode].orders++;
        }

        // Daily stockCode aggregation (if daily is also requested)
        if (includeDaily && dateDay) {
          if (!dailySalesByStockCode[dateDay]) {
            dailySalesByStockCode[dateDay] = {};
          }
          if (!dailySalesByStockCode[dateDay][stockCode]) {
            dailySalesByStockCode[dateDay][stockCode] = { quantity: 0, revenue: 0, orders: 0 };
          }
          dailySalesByStockCode[dateDay][stockCode].quantity += line.quantity || 0;
          dailySalesByStockCode[dateDay][stockCode].revenue += line.lineTotalInclVat || 0;
        }
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

    // Process previous week data if requested
    let previousWeekTotals: { quantity: number; revenue: number; orders: number } | undefined;
    if (includePreviousWeek && previousWeekOrderLines.length > 0) {
      let pwTotalQuantity = 0;
      let pwTotalRevenue = 0;
      let pwTotalOrders = 0;
      const pwAllOrderIds = new Set<string>();

      for (const line of previousWeekOrderLines) {
        const orderId = line.orderId || '';
        pwTotalQuantity += line.quantity || 0;
        pwTotalRevenue += line.lineTotalInclVat || 0;
        if (!pwAllOrderIds.has(orderId)) {
          pwAllOrderIds.add(orderId);
          pwTotalOrders++;
        }
      }

      previousWeekTotals = {
        quantity: pwTotalQuantity,
        revenue: Math.round(pwTotalRevenue * 100) / 100,
        orders: pwTotalOrders,
      };
    }

    // Process average same weekday data if requested (average of last 6 same weekdays)
    let avgSameWeekdayTotals: { quantity: number; revenue: number; orders: number } | undefined;
    if (includeAvgSameWeekday && avgSameWeekdayOrderLines.length > 0) {
      let totalQuantity = 0;
      let totalRevenue = 0;
      let totalOrders = 0;
      const allOrderIds = new Set<string>();

      for (const line of avgSameWeekdayOrderLines) {
        const orderId = line.orderId || '';
        totalQuantity += line.quantity || 0;
        totalRevenue += line.lineTotalInclVat || 0;
        if (!allOrderIds.has(orderId)) {
          allOrderIds.add(orderId);
          totalOrders++;
        }
      }

      // Divide by 6 to get average
      avgSameWeekdayTotals = {
        quantity: Math.round(totalQuantity / 6),
        revenue: Math.round((totalRevenue / 6) * 100) / 100,
        orders: Math.round(totalOrders / 6),
      };
    }

    // Build family/category breakdown by joining with products
    // Family = primary categorisation from Akeneo PIM (e.g., "Furniture", "Showers")
    // Category = subcategory (e.g., "Vanity Units", "Mirror Cabinets")

    // SKU summary type for drilldown
    interface SkuSummary {
      sku: string;
      title: string;
      quantity: number;
      revenue: number;
      orders: number;
    }

    // Category type with optional SKUs
    interface CategoryData {
      quantity: number;
      revenue: number;
      orders: number;
      skus?: SkuSummary[];
      totalSkuCount?: number;
    }

    // Family type
    interface FamilyData {
      quantity: number;
      revenue: number;
      orders: number;
      categories: Record<string, CategoryData>;
    }

    // Channel drilldown type
    interface ChannelDrilldownData {
      quantity: number;
      revenue: number;
      orders: number;
      families: Record<string, FamilyData>;
    }

    let totalsByFamily: Record<string, FamilyData> | undefined;
    let dailySalesByFamily: Record<string, Record<string, { quantity: number; revenue: number }>> | undefined;
    let previousYearTotalsByFamily: Record<string, FamilyData> | undefined;
    let previousMonthTotalsByFamily: Record<string, FamilyData> | undefined;
    let totalsByChannelDrilldown: Record<string, ChannelDrilldownData> | undefined;

    // Helper to get or create a SKU map for tracking during aggregation
    type SkuTracker = Map<string, { sku: string; title: string; quantity: number; revenue: number; orderIds: Set<string> }>;

    if (includeCategories || includeDrilldown) {
      // Current period family aggregation with nested categories
      totalsByFamily = {};
      const familyOrderIds: Record<string, Set<string>> = {};
      const categoryOrderIds: Record<string, Record<string, Set<string>>> = {};

      // SKU tracking for drilldown (family -> category -> SKU map)
      const categorySkuTrackers: Record<string, Record<string, SkuTracker>> = {};

      // Daily sales by family (same structure as dailySales but by family)
      if (includeDaily) {
        dailySalesByFamily = {};
      }

      // Channel drilldown tracking
      if (includeDrilldown) {
        totalsByChannelDrilldown = {};
      }
      const channelOrderIds: Record<string, Set<string>> = {};
      const channelFamilyOrderIds: Record<string, Record<string, Set<string>>> = {};
      const channelCategoryOrderIds: Record<string, Record<string, Record<string, Set<string>>>> = {};
      const channelCategorySkuTrackers: Record<string, Record<string, Record<string, SkuTracker>>> = {};

      for (const line of orderLines) {
        const productInfo = skuToProduct[line.sku] || { title: line.sku, family: 'Uncategorized', category: 'Other', brand: 'Unknown' };
        const { family, category, title } = productInfo;
        const orderId = line.orderId || '';
        const dateDay = line.orderDateDay || '';
        const channel = line.channelName || 'Unknown';
        const sku = line.sku;

        // Initialize family if needed
        if (!totalsByFamily[family]) {
          totalsByFamily[family] = { quantity: 0, revenue: 0, orders: 0, categories: {} };
          familyOrderIds[family] = new Set();
          categoryOrderIds[family] = {};
          categorySkuTrackers[family] = {};
        }

        // Initialize category within family if needed
        if (!totalsByFamily[family].categories[category]) {
          totalsByFamily[family].categories[category] = { quantity: 0, revenue: 0, orders: 0 };
          categoryOrderIds[family][category] = new Set();
          categorySkuTrackers[family][category] = new Map();
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

        // SKU aggregation within category (for drilldown)
        if (includeDrilldown) {
          const skuTracker = categorySkuTrackers[family][category];
          if (!skuTracker.has(sku)) {
            skuTracker.set(sku, { sku, title, quantity: 0, revenue: 0, orderIds: new Set() });
          }
          const skuData = skuTracker.get(sku)!;
          skuData.quantity += line.quantity || 0;
          skuData.revenue += line.lineTotalInclVat || 0;
          skuData.orderIds.add(orderId);
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

        // Channel drilldown aggregation (Channel -> Family -> Category -> SKU)
        if (includeDrilldown && totalsByChannelDrilldown) {
          // Initialize channel
          if (!totalsByChannelDrilldown[channel]) {
            totalsByChannelDrilldown[channel] = { quantity: 0, revenue: 0, orders: 0, families: {} };
            channelOrderIds[channel] = new Set();
            channelFamilyOrderIds[channel] = {};
            channelCategoryOrderIds[channel] = {};
            channelCategorySkuTrackers[channel] = {};
          }

          // Initialize family within channel
          if (!totalsByChannelDrilldown[channel].families[family]) {
            totalsByChannelDrilldown[channel].families[family] = { quantity: 0, revenue: 0, orders: 0, categories: {} };
            channelFamilyOrderIds[channel][family] = new Set();
            channelCategoryOrderIds[channel][family] = {};
            channelCategorySkuTrackers[channel][family] = {};
          }

          // Initialize category within channel family
          if (!totalsByChannelDrilldown[channel].families[family].categories[category]) {
            totalsByChannelDrilldown[channel].families[family].categories[category] = { quantity: 0, revenue: 0, orders: 0 };
            channelCategoryOrderIds[channel][family][category] = new Set();
            channelCategorySkuTrackers[channel][family][category] = new Map();
          }

          // Aggregate at channel level
          totalsByChannelDrilldown[channel].quantity += line.quantity || 0;
          totalsByChannelDrilldown[channel].revenue += line.lineTotalInclVat || 0;
          if (!channelOrderIds[channel].has(orderId)) {
            channelOrderIds[channel].add(orderId);
            totalsByChannelDrilldown[channel].orders++;
          }

          // Aggregate at channel->family level
          totalsByChannelDrilldown[channel].families[family].quantity += line.quantity || 0;
          totalsByChannelDrilldown[channel].families[family].revenue += line.lineTotalInclVat || 0;
          const chFamilyKey = `${channel}:${family}:${orderId}`;
          if (!channelFamilyOrderIds[channel][family].has(chFamilyKey)) {
            channelFamilyOrderIds[channel][family].add(chFamilyKey);
            totalsByChannelDrilldown[channel].families[family].orders++;
          }

          // Aggregate at channel->family->category level
          totalsByChannelDrilldown[channel].families[family].categories[category].quantity += line.quantity || 0;
          totalsByChannelDrilldown[channel].families[family].categories[category].revenue += line.lineTotalInclVat || 0;
          const chCatKey = `${channel}:${family}:${category}:${orderId}`;
          if (!channelCategoryOrderIds[channel][family][category].has(chCatKey)) {
            channelCategoryOrderIds[channel][family][category].add(chCatKey);
            totalsByChannelDrilldown[channel].families[family].categories[category].orders++;
          }

          // Track SKU within channel->family->category
          const chSkuTracker = channelCategorySkuTrackers[channel][family][category];
          if (!chSkuTracker.has(sku)) {
            chSkuTracker.set(sku, { sku, title, quantity: 0, revenue: 0, orderIds: new Set() });
          }
          const chSkuData = chSkuTracker.get(sku)!;
          chSkuData.quantity += line.quantity || 0;
          chSkuData.revenue += line.lineTotalInclVat || 0;
          chSkuData.orderIds.add(orderId);
        }
      }

      // Convert SKU trackers to sorted arrays (limit to top 50 by revenue)
      const MAX_SKUS_PER_CATEGORY = 50;

      if (includeDrilldown) {
        // Convert family->category SKU trackers
        for (const family of Object.keys(totalsByFamily)) {
          for (const category of Object.keys(totalsByFamily[family].categories)) {
            const tracker = categorySkuTrackers[family]?.[category];
            if (tracker && tracker.size > 0) {
              const allSkus = Array.from(tracker.values())
                .map(s => ({ sku: s.sku, title: s.title, quantity: s.quantity, revenue: s.revenue, orders: s.orderIds.size }))
                .sort((a, b) => b.revenue - a.revenue);
              totalsByFamily[family].categories[category].skus = allSkus.slice(0, MAX_SKUS_PER_CATEGORY);
              totalsByFamily[family].categories[category].totalSkuCount = allSkus.length;
            }
          }
        }

        // Convert channel->family->category SKU trackers
        if (totalsByChannelDrilldown) {
          for (const channel of Object.keys(totalsByChannelDrilldown)) {
            for (const family of Object.keys(totalsByChannelDrilldown[channel].families)) {
              for (const category of Object.keys(totalsByChannelDrilldown[channel].families[family].categories)) {
                const tracker = channelCategorySkuTrackers[channel]?.[family]?.[category];
                if (tracker && tracker.size > 0) {
                  const allSkus = Array.from(tracker.values())
                    .map(s => ({ sku: s.sku, title: s.title, quantity: s.quantity, revenue: s.revenue, orders: s.orderIds.size }))
                    .sort((a, b) => b.revenue - a.revenue);
                  totalsByChannelDrilldown[channel].families[family].categories[category].skus = allSkus.slice(0, MAX_SKUS_PER_CATEGORY);
                  totalsByChannelDrilldown[channel].families[family].categories[category].totalSkuCount = allSkus.length;
                }
              }
            }
          }
        }
      }

      // Previous year family aggregation with nested categories
      if (includePreviousYear && previousYearOrderLines.length > 0) {
        previousYearTotalsByFamily = {};
        const pyFamilyOrderIds: Record<string, Set<string>> = {};
        const pyCategoryOrderIds: Record<string, Record<string, Set<string>>> = {};

        for (const line of previousYearOrderLines) {
          const productInfo = skuToProduct[line.sku] || { title: line.sku, family: 'Uncategorized', category: 'Other', brand: 'Unknown' };
          const { family, category } = productInfo;
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
          const productInfo = skuToProduct[line.sku] || { title: line.sku, family: 'Uncategorized', category: 'Other', brand: 'Unknown' };
          const { family, category } = productInfo;
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

    if (includeBrands) {
      result.totalsByBrand = totalsByBrand;
      result.brands = Object.keys(totalsByBrand).sort();
      if (includeDaily) {
        result.dailySalesByBrand = dailySalesByBrand;
      }
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

    if (includePreviousWeek) {
      result.previousWeek = {
        fromDate: previousWeekFromDateStr,
        toDate: previousWeekToDateStr,
        totals: previousWeekTotals || { quantity: 0, revenue: 0, orders: 0 },
      };
    }

    if (includeAvgSameWeekday) {
      result.avgSameWeekday = {
        dates: avgSameWeekdayDates,
        totals: avgSameWeekdayTotals || { quantity: 0, revenue: 0, orders: 0 },
      };
    }

    if (includeCategories || includeDrilldown) {
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

    if (includeDrilldown) {
      result.totalsByChannelDrilldown = totalsByChannelDrilldown || {};
    }

    // Stock Code aggregation response
    if (includeStockCodes) {
      // Finalize SKUs array for each stockCode
      for (const stockCode of Object.keys(totalsByStockCode)) {
        totalsByStockCode[stockCode].skus = Array.from(stockCodeSkus[stockCode] || []);
      }
      result.totalsByStockCode = totalsByStockCode;
      result.stockCodes = Object.keys(totalsByStockCode).sort();
      if (includeDaily) {
        result.dailySalesByStockCode = dailySalesByStockCode;
      }
    }

    return response(200, result);
  }

  // Company breakdown endpoint (for Nuie Marketplace - aggregates by buyer)
  if (path === '/analytics/companies') {
    const params = event.queryStringParameters || {};

    // Calculate date range
    const today = new Date();
    let fromDateStr: string;
    let toDateStr: string;
    let days: number;

    if (params.fromDate && params.toDate) {
      fromDateStr = params.fromDate;
      toDateStr = params.toDate;
      const from = new Date(fromDateStr);
      const to = new Date(toDateStr);
      days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    } else {
      days = parseInt(params.days || '30', 10);
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - days);
      fromDateStr = fromDate.toISOString().substring(0, 10);
      toDateStr = today.toISOString().substring(0, 10);
    }

    // Pagination params
    const page = parseInt(params.page || '1', 10);
    const pageSize = parseInt(params.pageSize || '25', 10);
    const search = params.search || '';
    const includePreviousYear = params.includePreviousYear === 'true';
    const includePreviousMonth = params.includePreviousMonth === 'true';

    // Helper function to aggregate orders by company
    const aggregateByCompany = (ordersList: Array<{ buyerCompany?: string; buyerName?: string; orderId: string; totalInclVat?: number; discount?: number; lines?: Array<{ quantity?: number }> }>) => {
      const companyTotals: Record<string, {
        company: string;
        quantity: number;
        revenue: number;
        discount: number;
        orders: number;
        orderIds: Set<string>;
      }> = {};

      let totalQuantity = 0;
      let totalRevenue = 0;
      let totalDiscount = 0;

      for (const order of ordersList) {
        const company = order.buyerCompany || order.buyerName || 'Unknown Customer';

        if (!companyTotals[company]) {
          companyTotals[company] = {
            company,
            quantity: 0,
            revenue: 0,
            discount: 0,
            orders: 0,
            orderIds: new Set(),
          };
        }

        const orderQuantity = order.lines?.reduce((sum: number, line: { quantity?: number }) => sum + (line.quantity || 0), 0) || 0;
        companyTotals[company].quantity += orderQuantity;
        companyTotals[company].revenue += order.totalInclVat || 0;
        companyTotals[company].discount += order.discount || 0;

        if (!companyTotals[company].orderIds.has(order.orderId)) {
          companyTotals[company].orderIds.add(order.orderId);
          companyTotals[company].orders++;
        }

        totalQuantity += orderQuantity;
        totalRevenue += order.totalInclVat || 0;
        totalDiscount += order.discount || 0;
      }

      const uniqueOrderIds = new Set(ordersList.map((o) => o.orderId));
      return { companyTotals, totals: { quantity: totalQuantity, revenue: totalRevenue, discount: totalDiscount, orders: uniqueOrderIds.size } };
    };

    // Get orders for the date range (includes buyer info)
    const orders = await db.getOrdersByDateRange(accountId, fromDateStr, toDateStr);
    const { companyTotals, totals: currentTotals } = aggregateByCompany(orders);

    let grandTotalQuantity = currentTotals.quantity;
    let grandTotalRevenue = currentTotals.revenue;
    let grandTotalDiscount = currentTotals.discount;
    let grandTotalOrders = currentTotals.orders;

    // Fetch comparison period data if requested
    let previousYearData: { companyTotals: Record<string, { company: string; quantity: number; revenue: number; discount: number; orders: number; orderIds: Set<string> }>; totals: { quantity: number; revenue: number; discount: number; orders: number } } | undefined;
    let previousMonthData: { companyTotals: Record<string, { company: string; quantity: number; revenue: number; discount: number; orders: number; orderIds: Set<string> }>; totals: { quantity: number; revenue: number; discount: number; orders: number } } | undefined;

    if (includePreviousYear) {
      const pyFromDate = new Date(fromDateStr);
      const pyToDate = new Date(toDateStr);
      pyFromDate.setFullYear(pyFromDate.getFullYear() - 1);
      pyToDate.setFullYear(pyToDate.getFullYear() - 1);
      const pyOrders = await db.getOrdersByDateRange(accountId, pyFromDate.toISOString().substring(0, 10), pyToDate.toISOString().substring(0, 10));
      previousYearData = aggregateByCompany(pyOrders);
    }

    if (includePreviousMonth) {
      const pmFromDate = new Date(fromDateStr);
      const pmToDate = new Date(toDateStr);
      pmFromDate.setMonth(pmFromDate.getMonth() - 1);
      pmToDate.setMonth(pmToDate.getMonth() - 1);
      const pmOrders = await db.getOrdersByDateRange(accountId, pmFromDate.toISOString().substring(0, 10), pmToDate.toISOString().substring(0, 10));
      previousMonthData = aggregateByCompany(pmOrders);
    }

    // Convert to array and sort by revenue
    let companiesArray = Object.values(companyTotals)
      .map(({ company, quantity, revenue, discount, orders }) => {
        const result: {
          company: string;
          quantity: number;
          revenue: number;
          discount: number;
          orders: number;
          avgOrderValue: number;
          previousYear?: { quantity: number; revenue: number; discount: number; orders: number };
          previousMonth?: { quantity: number; revenue: number; discount: number; orders: number };
        } = {
          company,
          quantity,
          revenue: Math.round(revenue * 100) / 100,
          discount: Math.round(discount * 100) / 100,
          orders,
          avgOrderValue: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0,
        };

        if (previousYearData && previousYearData.companyTotals[company]) {
          const py = previousYearData.companyTotals[company];
          result.previousYear = {
            quantity: py.quantity,
            revenue: Math.round(py.revenue * 100) / 100,
            discount: Math.round(py.discount * 100) / 100,
            orders: py.orders,
          };
        }

        if (previousMonthData && previousMonthData.companyTotals[company]) {
          const pm = previousMonthData.companyTotals[company];
          result.previousMonth = {
            quantity: pm.quantity,
            revenue: Math.round(pm.revenue * 100) / 100,
            discount: Math.round(pm.discount * 100) / 100,
            orders: pm.orders,
          };
        }

        return result;
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      companiesArray = companiesArray.filter(c =>
        c.company.toLowerCase().includes(searchLower)
      );

      // Recalculate totals based on filtered companies
      grandTotalQuantity = companiesArray.reduce((sum, c) => sum + c.quantity, 0);
      grandTotalRevenue = companiesArray.reduce((sum, c) => sum + c.revenue, 0);
      grandTotalDiscount = companiesArray.reduce((sum, c) => sum + c.discount, 0);
      grandTotalOrders = companiesArray.reduce((sum, c) => sum + c.orders, 0);
    }

    // Paginate
    const totalCount = companiesArray.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const pagedCompanies = companiesArray.slice(startIndex, startIndex + pageSize);

    // Build response
    const responseData: {
      days: number;
      fromDate: string;
      toDate: string;
      companies: typeof pagedCompanies;
      totals: { quantity: number; revenue: number; discount: number; orders: number };
      pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
      previousYear?: { totals: { quantity: number; revenue: number; discount: number; orders: number; companyCount: number } };
      previousMonth?: { totals: { quantity: number; revenue: number; discount: number; orders: number; companyCount: number } };
    } = {
      days,
      fromDate: fromDateStr,
      toDate: toDateStr,
      companies: pagedCompanies,
      totals: {
        quantity: grandTotalQuantity,
        revenue: Math.round(grandTotalRevenue * 100) / 100,
        discount: Math.round(grandTotalDiscount * 100) / 100,
        orders: grandTotalOrders,
      },
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
    };

    if (previousYearData) {
      responseData.previousYear = {
        totals: {
          quantity: previousYearData.totals.quantity,
          revenue: Math.round(previousYearData.totals.revenue * 100) / 100,
          discount: Math.round(previousYearData.totals.discount * 100) / 100,
          orders: previousYearData.totals.orders,
          companyCount: Object.keys(previousYearData.companyTotals).length,
        },
      };
    }

    if (previousMonthData) {
      responseData.previousMonth = {
        totals: {
          quantity: previousMonthData.totals.quantity,
          revenue: Math.round(previousMonthData.totals.revenue * 100) / 100,
          discount: Math.round(previousMonthData.totals.discount * 100) / 100,
          orders: previousMonthData.totals.orders,
          companyCount: Object.keys(previousMonthData.companyTotals).length,
        },
      };
    }

    return response(200, responseData);
  }

  // Single company detail endpoint
  if (path.startsWith('/analytics/company/')) {
    const companyNameEncoded = getPathParam(path, 2);
    if (!companyNameEncoded) {
      return response(400, { error: 'Company name required' });
    }
    const companyName = decodeURIComponent(companyNameEncoded);
    const params = event.queryStringParameters || {};

    // Calculate date range
    const today = new Date();
    let fromDateStr: string;
    let toDateStr: string;
    let days: number;

    if (params.fromDate && params.toDate) {
      fromDateStr = params.fromDate;
      toDateStr = params.toDate;
      const from = new Date(fromDateStr);
      const to = new Date(toDateStr);
      days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    } else {
      days = parseInt(params.days || '30', 10);
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - days);
      fromDateStr = fromDate.toISOString().substring(0, 10);
      toDateStr = today.toISOString().substring(0, 10);
    }

    // Fetch orders and products in parallel
    const [orders, products] = await Promise.all([
      db.getOrdersByDateRange(accountId, fromDateStr, toDateStr),
      db.getAllProducts(accountId),
    ]);

    // Build SKU to product info map
    const skuToProduct: Record<string, { title: string; brand: string; family?: string; category?: string }> = {};
    for (const product of products) {
      if (product.sku) {
        skuToProduct[product.sku] = {
          title: product.title || product.sku,
          brand: product.brand || 'Unknown',
          family: product.familyLabel || product.family,
          category: product.subcategory || product.category, // subcategory is the actual field from data sync
        };
      }
    }

    // Filter orders for this company
    const companyOrders = orders.filter((order: { buyerCompany?: string; buyerName?: string }) => {
      const orderCompany = order.buyerCompany || order.buyerName || 'Unknown Customer';
      return orderCompany === companyName;
    });

    // Aggregate totals, daily sales, and products
    let totalRevenue = 0;
    let totalDiscount = 0;
    let totalQuantity = 0;
    const uniqueOrderIds = new Set<string>();
    const dailySales: Record<string, { revenue: number; discount: number; orders: number; quantity: number }> = {};
    const productTotals: Record<string, { sku: string; quantity: number; revenue: number; orders: Set<string> }> = {};
    const familyTotals: Record<string, {
      revenue: number;
      quantity: number;
      orders: Set<string>;
      categories: Record<string, {
        revenue: number;
        quantity: number;
        orders: Set<string>;
        products: Record<string, { sku: string; quantity: number; revenue: number; orders: Set<string> }>;
      }>;
    }> = {};

    for (const order of companyOrders) {
      const orderId = order.orderId;
      const orderDate = order.orderDate?.substring(0, 10) || '';
      const orderDiscount = order.discount || 0;

      uniqueOrderIds.add(orderId);
      totalRevenue += order.totalInclVat || 0;
      totalDiscount += orderDiscount;

      // Daily aggregation
      if (orderDate) {
        if (!dailySales[orderDate]) {
          dailySales[orderDate] = { revenue: 0, discount: 0, orders: 0, quantity: 0 };
        }
        dailySales[orderDate].revenue += order.totalInclVat || 0;
        dailySales[orderDate].discount += orderDiscount;
        dailySales[orderDate].orders++;
      }

      // Product and family aggregation from order lines
      const lines = order.lines || [];
      for (const line of lines) {
        const sku = line.sku || 'Unknown';
        const lineQuantity = line.quantity || 0;
        const lineRevenue = line.lineTotalInclVat || 0;

        totalQuantity += lineQuantity;
        if (orderDate) {
          dailySales[orderDate].quantity += lineQuantity;
        }

        // Product aggregation
        if (!productTotals[sku]) {
          productTotals[sku] = { sku, quantity: 0, revenue: 0, orders: new Set() };
        }
        productTotals[sku].quantity += lineQuantity;
        productTotals[sku].revenue += lineRevenue;
        productTotals[sku].orders.add(orderId);

        // Family/category aggregation
        const productInfo = skuToProduct[sku];
        const family = productInfo?.family || 'Unknown Family';
        const category = productInfo?.category || 'Unknown Category';

        if (!familyTotals[family]) {
          familyTotals[family] = { revenue: 0, quantity: 0, orders: new Set(), categories: {} };
        }
        familyTotals[family].revenue += lineRevenue;
        familyTotals[family].quantity += lineQuantity;
        familyTotals[family].orders.add(orderId);

        if (!familyTotals[family].categories[category]) {
          familyTotals[family].categories[category] = { revenue: 0, quantity: 0, orders: new Set(), products: {} };
        }
        familyTotals[family].categories[category].revenue += lineRevenue;
        familyTotals[family].categories[category].quantity += lineQuantity;
        familyTotals[family].categories[category].orders.add(orderId);

        // Product within category
        if (!familyTotals[family].categories[category].products[sku]) {
          familyTotals[family].categories[category].products[sku] = { sku, quantity: 0, revenue: 0, orders: new Set() };
        }
        familyTotals[family].categories[category].products[sku].quantity += lineQuantity;
        familyTotals[family].categories[category].products[sku].revenue += lineRevenue;
        familyTotals[family].categories[category].products[sku].orders.add(orderId);
      }
    }

    // Build top products list (sorted by revenue)
    const topProducts = Object.values(productTotals)
      .map(({ sku, quantity, revenue, orders }) => {
        const productInfo = skuToProduct[sku];
        return {
          sku,
          title: productInfo?.title || sku,
          brand: productInfo?.brand || 'Unknown',
          family: productInfo?.family,
          quantity,
          revenue: Math.round(revenue * 100) / 100,
          orders: orders.size,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50); // Top 50 products

    // Build family breakdown (convert Sets to counts)
    const familyBreakdown: Record<string, {
      revenue: number;
      quantity: number;
      orders: number;
      categories: Record<string, {
        revenue: number;
        quantity: number;
        orders: number;
        products: Array<{ sku: string; title: string; quantity: number; revenue: number; orders: number }>;
      }>;
    }> = {};
    for (const [family, data] of Object.entries(familyTotals)) {
      const categories: Record<string, {
        revenue: number;
        quantity: number;
        orders: number;
        products: Array<{ sku: string; title: string; quantity: number; revenue: number; orders: number }>;
      }> = {};
      for (const [cat, catData] of Object.entries(data.categories)) {
        // Convert products to sorted array
        const products = Object.values(catData.products)
          .map(p => ({
            sku: p.sku,
            title: skuToProduct[p.sku]?.title || p.sku,
            quantity: p.quantity,
            revenue: Math.round(p.revenue * 100) / 100,
            orders: p.orders.size,
          }))
          .sort((a, b) => b.revenue - a.revenue);

        categories[cat] = {
          revenue: Math.round(catData.revenue * 100) / 100,
          quantity: catData.quantity,
          orders: catData.orders.size,
          products,
        };
      }
      familyBreakdown[family] = {
        revenue: Math.round(data.revenue * 100) / 100,
        quantity: data.quantity,
        orders: data.orders.size,
        categories,
      };
    }

    // Calculate totals
    const totalOrders = uniqueOrderIds.size;
    const discountPercent = totalRevenue > 0 ? (totalDiscount / totalRevenue) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return response(200, {
      company: companyName,
      dateRange: { fromDate: fromDateStr, toDate: toDateStr, days },
      totals: {
        revenue: Math.round(totalRevenue * 100) / 100,
        discount: Math.round(totalDiscount * 100) / 100,
        discountPercent: Math.round(discountPercent * 100) / 100,
        orders: totalOrders,
        quantity: totalQuantity,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      },
      dailySales,
      familyBreakdown,
      topProducts,
    });
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
  const [products, salesMap, account] = await Promise.all([
    db.getAllProducts(accountId),
    db.getSalesBySku(accountId, 180),
    db.getAccount(accountId),
  ]);

  // Get channel fee percentage from account settings (default: 15%)
  const channelFeePercent = account?.settings?.defaultChannelFeePercent ?? 15;

  // Helper to calculate margin
  const calculateMargin = (p: { currentPrice?: number; costPrice?: number; deliveryCost?: number }): number => {
    if (!p.currentPrice || p.currentPrice <= 0) return 0;
    const priceExVat = p.currentPrice / 1.2; // Remove 20% VAT
    const channelFee = priceExVat * (channelFeePercent / 100); // Use account-specific channel fee
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

  // POST /carriers/recalculate - Recalculate delivery costs for all products across all accounts
  if (method === 'POST' && carrierId === 'recalculate') {
    requireAdmin(ctx);
    const result = await recalculateDeliveryCostsAllAccounts();
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
 * Recalculate delivery costs for all products across ALL accounts
 * Uses ku-bathrooms as the master source for carrier costs
 */
async function recalculateDeliveryCostsAllAccounts(): Promise<{
  ordersProcessed: number;
  ordersSkipped: number;
  skusAnalyzed: number;
  productsUpdated: number;
  productsUnchanged: number;
  accountsProcessed: number;
  updatedSkus: Array<{ sku: string; oldCost: number; newCost: number; carrier: string; account: string }>;
}> {
  const MASTER_CARRIER_ACCOUNT = 'ku-bathrooms';

  // Load carrier costs from master account only
  const carriers = await db.getAllCarrierCosts(MASTER_CARRIER_ACCOUNT);
  const carrierCostMap = new Map<string, number>();
  for (const carrier of carriers) {
    if (carrier.isActive) {
      // Map by both carrierId and carrierName (lowercase)
      carrierCostMap.set(carrier.carrierId.toLowerCase(), carrier.costPerParcel);
      carrierCostMap.set(carrier.carrierName.toLowerCase(), carrier.costPerParcel);
    }
  }
  console.log(`[Recalculate] Loaded ${carriers.length} carriers from ${MASTER_CARRIER_ACCOUNT}`);

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`[Recalculate] Processing ${accounts.length} accounts`);

  let totalOrdersProcessed = 0;
  let totalOrdersSkipped = 0;
  let totalSkusAnalyzed = 0;
  let totalProductsUpdated = 0;
  let totalProductsUnchanged = 0;
  const allUpdatedSkus: Array<{ sku: string; oldCost: number; newCost: number; carrier: string; account: string }> = [];

  // Process each account
  for (const account of accounts) {
    const accountId = account.accountId;

    // Get orders with delivery data for this account
    const orders = await db.getOrdersWithDeliveryData(accountId);
    console.log(`[Recalculate:${accountId}] Found ${orders.length} orders with delivery data`);

    // Aggregate delivery costs by SKU for this account
    const skuDeliveryCosts: Record<string, { totalCost: number; totalQuantity: number; carrier: string }> = {};

    for (const order of orders) {
      const carrierName = (order.deliveryCarrier || '').toLowerCase();
      const carrierCost = carrierCostMap.get(carrierName);

      if (!carrierCost || !order.deliveryParcels) {
        totalOrdersSkipped++;
        continue;
      }

      totalOrdersProcessed++;
      const deliveryCost = carrierCost * order.deliveryParcels;

      // Use order.lines if available (embedded), otherwise get from order lines table
      const lines = order.lines || [];
      if (lines.length === 0) continue;

      // Calculate total order value for proportional cost distribution
      const totalOrderValue = lines.reduce((sum: number, line: any) => {
        const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
        return sum + lineValue;
      }, 0);

      for (const line of lines) {
        const sku = line.sku;
        if (!sku) continue;

        const lineValue = line.lineTotalInclVat || ((line.unitPriceInclVat || 0) * (line.quantity || 1));
        const valueShare = totalOrderValue > 0 ? lineValue / totalOrderValue : 1 / lines.length;
        const lineDeliveryCost = deliveryCost * valueShare;
        const lineQuantity = line.quantity || 1;

        if (!skuDeliveryCosts[sku]) {
          skuDeliveryCosts[sku] = { totalCost: 0, totalQuantity: 0, carrier: order.deliveryCarrier || '' };
        }
        skuDeliveryCosts[sku].totalCost += lineDeliveryCost;
        skuDeliveryCosts[sku].totalQuantity += lineQuantity;
      }
    }

    // Update products with new average delivery costs
    const skusInAccount = Object.keys(skuDeliveryCosts).length;
    totalSkusAnalyzed += skusInAccount;

    // Batch get all products for this account
    const products = await db.getAllProducts(accountId);
    const productMap = new Map(products.map(p => [p.sku, p]));

    const productsToUpdate: Array<{ sku: string; deliveryCost: number }> = [];

    for (const [sku, data] of Object.entries(skuDeliveryCosts)) {
      const avgDeliveryCost = data.totalQuantity > 0 ? data.totalCost / data.totalQuantity : 0;
      const roundedCost = Math.round(avgDeliveryCost * 100) / 100;

      const product = productMap.get(sku);
      if (!product) continue;

      const oldCost = product.deliveryCost || 0;

      // Only update if cost changed significantly (> 0.01)
      if (Math.abs(roundedCost - oldCost) > 0.01) {
        productsToUpdate.push({ sku, deliveryCost: roundedCost });
        allUpdatedSkus.push({ sku, oldCost, newCost: roundedCost, carrier: data.carrier, account: accountId });
        totalProductsUpdated++;
      } else {
        totalProductsUnchanged++;
      }
    }

    // Batch update products
    for (const { sku, deliveryCost } of productsToUpdate) {
      await db.updateProduct(accountId, sku, { deliveryCost });
    }

    console.log(`[Recalculate:${accountId}] Updated ${productsToUpdate.length} products`);
  }

  return {
    ordersProcessed: totalOrdersProcessed,
    ordersSkipped: totalOrdersSkipped,
    skusAnalyzed: totalSkusAnalyzed,
    productsUpdated: totalProductsUpdated,
    productsUnchanged: totalProductsUnchanged,
    accountsProcessed: accounts.length,
    updatedSkus: allUpdatedSkus.slice(0, 50), // Limit to first 50 for response size
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
    const includeCompanySales = params.includeCompanySales === 'true';

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

    // Optionally fetch company-level sales data (for B2B accounts)
    let companySales: Record<string, Record<string, { quantity: number; revenue: number }>> | undefined;
    if (includeCompanySales) {
      companySales = await getCompanySalesByDay(accountId, decodedSku, from, to);
    }

    return response(200, {
      sku: decodedSku,
      product,
      history,
      channelSales,
      companySales,
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
  const allOrderLines = await db.getOrderLinesForAggregation(accountId, fromDate, toDate);

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

/**
 * Get sales by company for each day for a specific SKU (for B2B accounts)
 * Uses the orders table which has buyerCompany info
 */
async function getCompanySalesByDay(
  accountId: string,
  sku: string,
  fromDate: string,
  toDate: string
): Promise<Record<string, Record<string, { quantity: number; revenue: number }>>> {
  // Get full orders (which have buyerCompany info and nested lines)
  const orders = await db.getOrdersByDateRange(accountId, fromDate, toDate);

  const result: Record<string, Record<string, { quantity: number; revenue: number }>> = {};
  const skuUpper = sku.toUpperCase();

  for (const order of orders) {
    const orderDate = order.orderDateDay;
    if (!orderDate) continue;

    // Filter lines for this SKU
    const matchingLines = order.lines?.filter(line => line.sku.toUpperCase() === skuUpper) || [];
    if (matchingLines.length === 0) continue;

    // Use buyerCompany, fall back to buyerName, then 'Unknown'
    const companyName = order.buyerCompany || order.buyerName || 'Unknown Customer';

    if (!result[orderDate]) {
      result[orderDate] = {};
    }
    if (!result[orderDate][companyName]) {
      result[orderDate][companyName] = { quantity: 0, revenue: 0 };
    }

    for (const line of matchingLines) {
      result[orderDate][companyName].quantity += line.quantity || 0;
      result[orderDate][companyName].revenue += line.lineTotalInclVat || 0;
    }
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

  // Job status check - GET /import/jobs/{jobId}
  const jobMatch = path.match(/\/import\/jobs\/([^/]+)$/);
  if (jobMatch && event.httpMethod === 'GET') {
    const jobId = jobMatch[1];
    const job = await db.getImportJob(jobId);
    if (!job) {
      return response(404, { error: 'Job not found' });
    }
    return response(200, job);
  }

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
  _accountId: string // Unused - imports apply to all accounts
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

  // Generate job ID and create job record
  const jobId = uuid();
  await db.createImportJob(jobId, 'costs');

  console.log(`[Import:Async] Created job ${jobId} for ${csvData.length} cost records`);

  // Store import data in S3 (too large for Lambda payload)
  const s3Key = `import-jobs/${jobId}.json`;
  await s3Client.send(new PutObjectCommand({
    Bucket: IMPORT_DATA_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(csvData),
    ContentType: 'application/json',
  }));
  console.log(`[Import:Async] Stored ${csvData.length} records in S3`);

  // Invoke self asynchronously to process the import (only pass job ID)
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || 'repricing-v2-api';
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        asyncImport: {
          jobId,
          type: 'costs',
        },
      }),
    })
  );

  console.log(`[Import:Async] Triggered async processing for job ${jobId}`);

  // Return immediately with job ID
  return response(202, {
    status: 'processing',
    jobId,
    message: 'Import started. Poll /import/jobs/{jobId} for status.',
    totalRecords: csvData.length,
  });
}

/**
 * Process cost import asynchronously (called by self-invoke)
 */
async function processAsyncCostImport(
  csvData: Array<{ sku: string; costPrice: number; deliveryCost?: number }>,
  jobId: string
): Promise<Record<string, unknown>> {
  console.log(`[Import:${jobId}] Processing ${csvData.length} cost records across all accounts`);

  // Log first 5 records for debugging
  console.log(`[Import:${jobId}] First 5 records:`, JSON.stringify(csvData.slice(0, 5)));

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`[Import:${jobId}] Found ${accounts.length} active accounts`);

  // Create SKU lookup map for fast matching
  // Also create a map without leading zeros for fuzzy matching
  const csvDataBySku = new Map<string, { costPrice: number; deliveryCost?: number; originalSku: string }>();
  const csvDataBySkuNoLeadingZeros = new Map<string, { costPrice: number; deliveryCost?: number; originalSku: string }>();
  for (const row of csvData) {
    const normalizedSku = row.sku.toUpperCase().trim();
    const data = {
      costPrice: row.costPrice,
      deliveryCost: row.deliveryCost,
      originalSku: row.sku,
    };
    csvDataBySku.set(normalizedSku, data);
    // Also index by SKU with leading zeros stripped
    const skuNoLeadingZeros = normalizedSku.replace(/^0+/, '');
    if (skuNoLeadingZeros !== normalizedSku) {
      csvDataBySkuNoLeadingZeros.set(skuNoLeadingZeros, data);
    }
  }

  // Debug: Check for CAR870 and any similar SKUs
  const debugSkus = ['CAR870', 'CAR 870', ' CAR870', 'CAR870 '];
  for (const testSku of debugSkus) {
    const data = csvDataBySku.get(testSku.toUpperCase().trim());
    if (data) {
      console.log(`[Import:${jobId}] FOUND "${testSku}": ${JSON.stringify(data)}`);
    }
  }

  // Find any SKUs containing "CAR870"
  const car870Matches: string[] = [];
  for (const [key, value] of csvDataBySku.entries()) {
    if (key.includes('CAR870') || value.originalSku.includes('CAR870')) {
      car870Matches.push(`${key} => ${JSON.stringify(value)}`);
    }
  }
  console.log(`[Import:${jobId}] SKUs containing CAR870:`, car870Matches.length > 0 ? car870Matches : 'NONE FOUND');

  // Process each account
  const accountResults: { accountId: string; updated: number; matchedByBalterley: number; skipped: number }[] = [];
  let totalUpdated = 0;
  let totalMatchedByBalterley = 0;
  const allNotFoundSkus = new Set<string>();
  const skippedProducts: Array<{ accountId: string; sku: string; reason: string }> = [];

  for (const account of accounts) {
    const existingProducts = await db.getAllProducts(account.accountId);
    const productsToUpdate: Product[] = [];
    let accountUpdated = 0;
    let accountMatchedByBalterley = 0;
    let accountSkipped = 0;

    // Check if CAR870 exists in this account's products
    const car870Product = existingProducts.find(p => p.sku.toUpperCase() === 'CAR870');
    if (car870Product) {
      console.log(`[Import:${jobId}] CAR870 exists in ${account.accountId}: currentCostPrice=${car870Product.costPrice}`);
    }

    for (const product of existingProducts) {
      const skuUpper = product.sku.toUpperCase().trim();
      const skuNoLeadingZeros = skuUpper.replace(/^0+/, '');

      // Try matching by primary SKU first
      let costData = csvDataBySku.get(skuUpper);

      // If not found, try matching with leading zeros stripped from product SKU
      if (!costData && skuNoLeadingZeros !== skuUpper) {
        costData = csvDataBySku.get(skuNoLeadingZeros);
      }

      // If not found, try matching CSV SKU (with leading zeros stripped) to product SKU
      if (!costData) {
        costData = csvDataBySkuNoLeadingZeros.get(skuNoLeadingZeros);
      }

      // If not found, try matching by Balterley SKU
      if (!costData && product.balterleySku) {
        costData = csvDataBySku.get(product.balterleySku.toUpperCase().trim());
        if (costData) {
          accountMatchedByBalterley++;
        }
      }

      if (costData) {
        // Debug CAR870 specifically
        if (skuUpper === 'CAR870') {
          console.log(`[Import:${jobId}] MATCHED CAR870 in ${account.accountId}: newCostPrice=${costData.costPrice}, newDeliveryCost=${costData.deliveryCost}`);
        }

        product.costPrice = costData.costPrice;
        if (costData.deliveryCost !== undefined) {
          product.deliveryCost = costData.deliveryCost;
        }
        productsToUpdate.push(product);
        accountUpdated++;
      } else {
        // Track first 10 unmatched products per account for debugging
        if (accountSkipped < 10) {
          skippedProducts.push({
            accountId: account.accountId,
            sku: product.sku,
            reason: 'Not found in CSV',
          });
        }
        accountSkipped++;
      }
    }

    // Batch write updates for this account
    if (productsToUpdate.length > 0) {
      console.log(`[Import:${jobId}:${account.accountId}] Writing ${productsToUpdate.length} products to DB...`);
      await db.batchPutProducts(account.accountId, productsToUpdate);
      console.log(`[Import:${jobId}:${account.accountId}] Write complete`);
    }

    accountResults.push({
      accountId: account.accountId,
      updated: accountUpdated,
      matchedByBalterley: accountMatchedByBalterley,
      skipped: accountSkipped,
    });
    totalUpdated += accountUpdated;
    totalMatchedByBalterley += accountMatchedByBalterley;

    console.log(`[Import:${jobId}:${account.accountId}] Complete: ${accountUpdated} updated, ${accountMatchedByBalterley} by Balterley, ${accountSkipped} skipped`);
  }

  // Track SKUs not found in any account (for reporting)
  const allProductSkus = new Set<string>();
  for (const account of accounts) {
    const products = await db.getAllProducts(account.accountId);
    for (const product of products) {
      allProductSkus.add(product.sku.toUpperCase().trim());
      if (product.balterleySku) {
        allProductSkus.add(product.balterleySku.toUpperCase().trim());
      }
    }
  }
  for (const row of csvData) {
    const normalizedSku = row.sku.toUpperCase().trim();
    if (!allProductSkus.has(normalizedSku)) {
      allNotFoundSkus.add(row.sku);
    }
  }

  console.log(`[Import:${jobId}] Complete: ${totalUpdated} total updated across ${accounts.length} accounts`);
  console.log(`[Import:${jobId}] Sample skipped products:`, JSON.stringify(skippedProducts.slice(0, 20)));

  return {
    message: 'Cost import complete (applied to all accounts)',
    jobId,
    totalUpdated,
    matchedByBalterleySku: totalMatchedByBalterley,
    totalRecords: csvData.length,
    accountsProcessed: accounts.length,
    accountResults,
    notFoundInAnyAccount: allNotFoundSkus.size,
    sampleNotFound: allNotFoundSkus.size > 0 ? Array.from(allNotFoundSkus).slice(0, 20) : undefined,
  };
}

async function handleDeliveryImport(
  event: APIGatewayProxyEvent,
  _accountId: string // Unused - imports apply to all accounts
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

  console.log(`[DeliveryImport:CrossAccount] Processing ${deliveryData.length} delivery records across all accounts`);

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`[DeliveryImport:CrossAccount] Found ${accounts.length} active accounts`);

  // Only load orders from last 90 days to speed up import (delivery data is typically recent)
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromDateStr = fromDate.toISOString().substring(0, 10);
  const toDateStr = toDate.toISOString().substring(0, 10);
  console.log(`[DeliveryImport:CrossAccount] Loading orders from ${fromDateStr} to ${toDateStr}`);

  // Load orders from all accounts into a unified lookup
  // Map: orderNumber -> { accountId, order }
  const orderByChannelOrderNo = new Map<string, { accountId: string; order: any }>();
  const orderByBasePoNumber = new Map<string, { accountId: string; order: any }>();

  // Load carrier costs from ku-bathrooms only (single source of truth for all accounts)
  const MASTER_CARRIER_ACCOUNT = 'ku-bathrooms';
  const masterCarrierCosts = await db.getAllCarrierCosts(MASTER_CARRIER_ACCOUNT);
  const carrierCostMap = new Map<string, number>();
  for (const cc of masterCarrierCosts) {
    carrierCostMap.set(cc.carrierId, cc.costPerParcel);
  }
  console.log(`[DeliveryImport:CrossAccount] Loaded ${masterCarrierCosts.length} carrier costs from ${MASTER_CARRIER_ACCOUNT}`);

  // Load products by SKU per account
  const productsBySkuPerAccount = new Map<string, Map<string, Product>>();

  // Track SKU delivery stats per account
  const skuDeliveryStatsPerAccount = new Map<string, Map<string, {
    carrierCounts: Record<string, number>;
    totalDeliveryCost: number;
    totalQuantity: number;
    orderCount: number;
  }>>();

  // Load data from all accounts in parallel for speed
  const accountDataPromises = accounts.map(async (account) => {
    const [orders, products] = await Promise.all([
      db.getOrdersByDateRange(account.accountId, fromDateStr, toDateStr),
      db.getAllProducts(account.accountId),
    ]);
    return { account, orders, products };
  });

  const accountsData = await Promise.all(accountDataPromises);

  for (const { account, orders, products } of accountsData) {

    console.log(`[DeliveryImport:${account.accountId}] Loaded ${orders.length} orders, ${products.length} products`);

    // Add orders to global lookup
    for (const order of orders) {
      if (order.channelOrderNo) {
        orderByChannelOrderNo.set(order.channelOrderNo, { accountId: account.accountId, order });

        // Also add base PO number for fallback matching (other accounts may use different formats)
        if (order.channelOrderNo.includes('-')) {
          const basePo = order.channelOrderNo.split('-')[0];
          if (!orderByBasePoNumber.has(basePo)) {
            orderByBasePoNumber.set(basePo, { accountId: account.accountId, order });
          }
        }
      }
    }

    // Store products per account
    productsBySkuPerAccount.set(account.accountId, new Map(products.map(p => [p.sku, p])));

    // Initialize SKU stats for this account
    skuDeliveryStatsPerAccount.set(account.accountId, new Map());
  }

  const carriersFound = new Set<string>();
  const excludedCarriers = new Set<string>();
  let ordersProcessed = 0;
  let ordersMatched = 0;
  let ordersSkipped = 0;
  let ordersNotFound = 0;
  const accountMatchCounts = new Map<string, number>();

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
    let matchedData = orderByChannelOrderNo.get(poNumber);

    if (!matchedData) {
      const basePoNumber = poNumber.includes('-') ? poNumber.split('-')[0] : poNumber;
      matchedData = orderByBasePoNumber.get(basePoNumber);
    }

    if (matchedData) {
      const { accountId, order } = matchedData;

      await db.updateOrderDelivery(accountId, order.orderId, {
        deliveryCarrier: normalizedCarrier,
        deliveryCarrierRaw: record.carrier,
        deliveryParcels: record.parcels,
      });
      ordersMatched++;
      accountMatchCounts.set(accountId, (accountMatchCounts.get(accountId) || 0) + 1);

      // Aggregate delivery stats by SKU for this account
      const skuDeliveryStats = skuDeliveryStatsPerAccount.get(accountId)!;
      const lines = order.lines || [];
      const carrierCost = carrierCostMap.get(normalizedCarrier) || 0;
      const orderDeliveryCost = carrierCost;

      const totalOrderValue = lines.reduce((sum: number, line: any) => {
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

  // Auto-create carrier cost entries for any new carriers found (in master account only)
  let newCarriersCreated = 0;
  const existingCarrierIds = new Set(masterCarrierCosts.map(c => c.carrierId));

  for (const carrierId of carriersFound) {
    if (!existingCarrierIds.has(carrierId)) {
      const newCarrier: CarrierCost = {
        carrierId,
        carrierName: carrierId.charAt(0).toUpperCase() + carrierId.slice(1).replace(/_/g, ' '),
        costPerParcel: 0,
        isActive: true,
        lastUpdated: new Date().toISOString(),
      };
      await db.putCarrierCost(MASTER_CARRIER_ACCOUNT, newCarrier);
      newCarriersCreated++;
      console.log(`[DeliveryImport] Created new carrier "${newCarrier.carrierName}" in ${MASTER_CARRIER_ACCOUNT}`);
    }
  }

  // Update product delivery costs based on aggregated stats (per account)
  let totalProductsUpdated = 0;
  for (const account of accounts) {
    const skuDeliveryStats = skuDeliveryStatsPerAccount.get(account.accountId)!;
    const productsBySku = productsBySkuPerAccount.get(account.accountId)!;
    const productsUpdated: Product[] = [];

    for (const [sku, stats] of skuDeliveryStats) {
      const product = productsBySku.get(sku);
      if (product && stats.totalQuantity > 0) {
        const deliveryCostPerUnit = stats.totalDeliveryCost / stats.totalQuantity;
        product.deliveryCost = Math.round(deliveryCostPerUnit * 100) / 100;
        // Store carrier breakdown as additional field
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (product as any).deliveryCarrierBreakdown = stats.carrierCounts;
        productsUpdated.push(product);
      }
    }

    if (productsUpdated.length > 0) {
      console.log(`[DeliveryImport:${account.accountId}] Updating delivery costs for ${productsUpdated.length} products`);
      await db.batchPutProducts(account.accountId, productsUpdated);
      totalProductsUpdated += productsUpdated.length;
    }
  }

  // Build account results
  const accountResults = accounts.map(a => ({
    accountId: a.accountId,
    ordersMatched: accountMatchCounts.get(a.accountId) || 0,
  }));

  console.log(`[DeliveryImport:CrossAccount] Complete: ${ordersMatched} matched across ${accounts.length} accounts, ${ordersNotFound} not found`);

  return response(200, {
    message: 'Delivery import complete (applied to all accounts)',
    ordersProcessed,
    ordersMatched,
    ordersNotFound,
    ordersSkipped,
    excludedCarriers: Array.from(excludedCarriers),
    carriersFound: Array.from(carriersFound),
    newCarriersCreated,
    productsUpdated: totalProductsUpdated,
    accountsProcessed: accounts.length,
    accountResults,
  });
}

// ============ Competitor Price Scraping ============

async function handleCompetitors(
  event: APIGatewayProxyEvent,
  ctx: AccountContext
): Promise<APIGatewayProxyResult> {
  const { accountId } = requireAccountContext(ctx);
  const method = event.httpMethod;
  const path = event.path;

  // POST /competitors/scrape/{sku} - Scrape competitor prices for a product
  if (path.match(/^\/competitors\/scrape\//) && method === 'POST') {
    const sku = getPathParam(path, 2);
    if (!sku) {
      return response(400, { error: 'SKU is required' });
    }

    const product = await db.getProduct(accountId, sku);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    if (!product.competitorUrls || product.competitorUrls.length === 0) {
      return response(400, { error: 'No competitor URLs configured for this product' });
    }

    // Scrape all competitor URLs
    const result = await scrapeProductCompetitors(product);

    // Update the product with scraped prices
    const updatedProduct = {
      ...product,
      competitorUrls: result.updatedUrls,
      competitorFloorPrice: result.lowestPrice ?? undefined,
      competitorPricesLastUpdated: new Date().toISOString(),
    };

    await db.putProduct(accountId, updatedProduct);

    return response(200, {
      sku,
      competitorUrls: result.updatedUrls,
      lowestPrice: result.lowestPrice,
      errors: result.errors,
      scrapedAt: updatedProduct.competitorPricesLastUpdated,
    });
  }

  return response(404, { error: 'Not found' });
}
