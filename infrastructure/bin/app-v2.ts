#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStackV2 } from '../lib/v2/database-stack';
import { AuthStackV2 } from '../lib/v2/auth-stack';
import { LambdaStackV2 } from '../lib/v2/lambda-stack';
import { ApiStackV2 } from '../lib/v2/api-stack';
import { FrontendStackV2 } from '../lib/v2/frontend-stack';

/**
 * V2 Multi-Tenant Trading Dashboard
 *
 * This creates a parallel infrastructure alongside V1 with:
 * - Multi-tenant DynamoDB tables (accountId partition key)
 * - Cognito User Pool with super-admin group
 * - Account-aware Lambda functions
 * - API Gateway with account context
 * - Separate frontend deployment
 *
 * Deploy with: npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2*
 */

const app = new cdk.App();

const env = {
  account: '610274502245',
  region: 'eu-west-2', // London region
};

// ============================================================
// V2 AUTH STACK - Cognito User Pool with multi-tenant support
// ============================================================
const authStack = new AuthStackV2(app, 'RepricingV2AuthStack', { env });

// ============================================================
// V2 DATABASE STACK - DynamoDB tables with accountId partition
// ============================================================
const databaseStack = new DatabaseStackV2(app, 'RepricingV2DatabaseStack', { env });

// ============================================================
// V2 LAMBDA STACK - Account-aware Lambda functions
// ============================================================
const lambdaStack = new LambdaStackV2(app, 'RepricingV2LambdaStack', {
  env,
  accountsTable: databaseStack.accountsTable,
  productsTable: databaseStack.productsTable,
  pricingRulesTable: databaseStack.pricingRulesTable,
  priceProposalsTable: databaseStack.priceProposalsTable,
  channelConfigTable: databaseStack.channelConfigTable,
  ordersTable: databaseStack.ordersTable,
  orderLinesTable: databaseStack.orderLinesTable,
  carrierCostsTable: databaseStack.carrierCostsTable,
  skuHistoryTable: databaseStack.skuHistoryTable,
  userPool: authStack.userPool,
});

// ============================================================
// V2 API STACK - REST API Gateway with account context
// ============================================================
const apiStack = new ApiStackV2(app, 'RepricingV2ApiStack', {
  env,
  apiHandler: lambdaStack.apiHandler,
  userPool: authStack.userPool,
});

// ============================================================
// V2 FRONTEND STACK - S3 + CloudFront
// ============================================================
new FrontendStackV2(app, 'RepricingV2FrontendStack', {
  env,
  apiUrl: apiStack.apiUrl,
});

app.synth();
