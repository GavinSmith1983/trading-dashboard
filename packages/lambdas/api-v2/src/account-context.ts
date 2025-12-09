import { APIGatewayProxyEvent } from 'aws-lambda';
import { AccountContext } from '@repricing/core';

/**
 * Extract account context from API Gateway event
 * Validates JWT claims and X-Account-Id header
 */
export function extractAccountContext(event: APIGatewayProxyEvent): AccountContext {
  // Extract claims from Cognito authorizer
  const claims = event.requestContext.authorizer?.claims;

  if (!claims) {
    throw new Error('No authorization claims found');
  }

  // Parse user info from JWT claims
  const userId = claims.sub as string;
  const userEmail = claims.email as string;
  const givenName = (claims.given_name as string) || '';
  const familyName = (claims.family_name as string) || '';
  const userName = `${givenName} ${familyName}`.trim() || userEmail;

  // Parse groups from cognito:groups claim (comma-separated string or array)
  let groups: string[] = [];
  const groupsClaim = claims['cognito:groups'];
  if (typeof groupsClaim === 'string') {
    groups = groupsClaim.split(',').map((g) => g.trim());
  } else if (Array.isArray(groupsClaim)) {
    groups = groupsClaim;
  }

  // Parse allowed accounts from custom attribute
  let allowedAccounts: string[] = [];
  const allowedAccountsClaim = claims['custom:allowedAccounts'];
  if (allowedAccountsClaim) {
    try {
      allowedAccounts = JSON.parse(allowedAccountsClaim as string);
    } catch {
      console.warn('Failed to parse allowedAccounts claim:', allowedAccountsClaim);
    }
  }

  // Determine roles
  const isSuperAdmin = groups.includes('super-admin');
  const isAdmin = isSuperAdmin || groups.includes('admin');
  const isEditor = isAdmin || groups.includes('editor');

  // Get requested account from header
  const requestedAccountId = event.headers['X-Account-Id'] || event.headers['x-account-id'];

  // Super admins can access any account
  // Regular users must have the account in their allowedAccounts list
  if (!requestedAccountId) {
    // For endpoints that don't require an account (e.g., /accounts list for super-admin)
    // We'll set accountId to empty and let the handler decide
    return {
      accountId: '',
      userId,
      userEmail,
      userName,
      groups,
      isSuperAdmin,
      isAdmin,
      isEditor,
      allowedAccounts,
    };
  }

  // Validate access to requested account
  if (!isSuperAdmin && !allowedAccounts.includes(requestedAccountId)) {
    throw new Error(`Access denied to account: ${requestedAccountId}`);
  }

  return {
    accountId: requestedAccountId,
    userId,
    userEmail,
    userName,
    groups,
    isSuperAdmin,
    isAdmin,
    isEditor,
    allowedAccounts,
  };
}

/**
 * Require account context - throws if accountId is not set
 */
export function requireAccountContext(ctx: AccountContext): AccountContext & { accountId: string } {
  if (!ctx.accountId) {
    throw new Error('X-Account-Id header is required');
  }
  return ctx as AccountContext & { accountId: string };
}

/**
 * Require super-admin role
 */
export function requireSuperAdmin(ctx: AccountContext): void {
  if (!ctx.isSuperAdmin) {
    throw new Error('Super admin access required');
  }
}

/**
 * Require admin role (includes super-admin)
 */
export function requireAdmin(ctx: AccountContext): void {
  if (!ctx.isAdmin) {
    throw new Error('Admin access required');
  }
}

/**
 * Require editor role (includes admin and super-admin)
 */
export function requireEditor(ctx: AccountContext): void {
  if (!ctx.isEditor) {
    throw new Error('Editor access required');
  }
}
