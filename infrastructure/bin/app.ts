#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { LambdaStack } from '../lib/lambda-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { AuthStack } from '../lib/auth-stack';

const app = new cdk.App();

const env = {
  account: '610274502245',
  region: 'eu-west-2', // London region - adjust if needed
};

// Auth stack - Cognito User Pool
const authStack = new AuthStack(app, 'RepricingAuthStack', { env });

// Database stack - DynamoDB tables
const databaseStack = new DatabaseStack(app, 'RepricingDatabaseStack', { env });

// Lambda stack - All Lambda functions
const lambdaStack = new LambdaStack(app, 'RepricingLambdaStack', {
  env,
  productsTable: databaseStack.productsTable,
  pricingRulesTable: databaseStack.pricingRulesTable,
  priceProposalsTable: databaseStack.priceProposalsTable,
  channelConfigTable: databaseStack.channelConfigTable,
  ordersTable: databaseStack.ordersTable,
  orderLinesTable: databaseStack.orderLinesTable,
});

// API Gateway stack
const apiStack = new ApiStack(app, 'RepricingApiStack', {
  env,
  apiHandler: lambdaStack.apiHandler,
  userPool: authStack.userPool,
});

// Frontend stack - S3 + CloudFront
new FrontendStack(app, 'RepricingFrontendStack', {
  env,
  apiUrl: apiStack.apiUrl,
});

app.synth();
