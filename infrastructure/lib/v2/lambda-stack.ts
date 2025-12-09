import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface LambdaStackV2Props extends cdk.StackProps {
  accountsTable: dynamodb.Table;
  productsTable: dynamodb.Table;
  pricingRulesTable: dynamodb.Table;
  priceProposalsTable: dynamodb.Table;
  channelConfigTable: dynamodb.Table;
  ordersTable: dynamodb.Table;
  orderLinesTable: dynamodb.Table;
  carrierCostsTable: dynamodb.Table;
  skuHistoryTable: dynamodb.Table;
  userPool: cognito.UserPool;
}

/**
 * V2 Lambda Stack - Multi-tenant aware Lambda functions
 * All functions are account-aware and fetch credentials per account
 */
export class LambdaStackV2 extends cdk.Stack {
  public readonly apiHandler: lambda.Function;
  public readonly dataSyncHandler: lambda.Function;
  public readonly priceCalculatorHandler: lambda.Function;
  public readonly orderSyncHandler: lambda.Function;
  public readonly competitorScrapeHandler: lambda.Function;
  public readonly akeneoSyncHandler: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaStackV2Props) {
    super(scope, id, props);

    // Google Sheets secret ARN (shared across accounts for now)
    const googleSheetsSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:repricing/google-sheets-ojtIAq`;

    // Common Lambda environment variables
    const commonEnv = {
      // V2 Tables
      ACCOUNTS_TABLE: props.accountsTable.tableName,
      PRODUCTS_TABLE: props.productsTable.tableName,
      PRICING_RULES_TABLE: props.pricingRulesTable.tableName,
      PRICE_PROPOSALS_TABLE: props.priceProposalsTable.tableName,
      CHANNEL_CONFIG_TABLE: props.channelConfigTable.tableName,
      ORDERS_TABLE: props.ordersTable.tableName,
      ORDER_LINES_TABLE: props.orderLinesTable.tableName,
      CARRIER_COSTS_TABLE: props.carrierCostsTable.tableName,
      SKU_HISTORY_TABLE: props.skuHistoryTable.tableName,
      // Multi-tenant mode flag
      MULTI_TENANT: 'true',
      // Cognito for user management
      USER_POOL_ID: props.userPool.userPoolId,
      // Google Sheets credentials (default, can be overridden per account)
      GOOGLE_SHEETS_SECRET_ARN: googleSheetsSecretArn,
    };

    // Common bundling options
    const bundlingOptions: nodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      nodeModules: ['googleapis', 'uuid'],
      tsconfig: path.join(__dirname, '../../../packages/lambdas/tsconfig.json'),
      esbuildArgs: {
        '--resolve-extensions': '.ts,.js',
      },
    };

    // ============================================================
    // API HANDLER - V2
    // ============================================================
    this.apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: 'repricing-v2-api',
      entry: path.join(__dirname, '../../../packages/lambdas/api-v2/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../../..'),
    });

    // ============================================================
    // DATA SYNC HANDLER - V2
    // Loops through all active accounts and syncs each
    // ============================================================
    this.dataSyncHandler = new nodejs.NodejsFunction(this, 'DataSyncHandler', {
      functionName: 'repricing-v2-data-sync',
      entry: path.join(__dirname, '../../../packages/lambdas/data-sync-v2/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../../..'),
    });

    // ============================================================
    // ORDER SYNC HANDLER - V2
    // Loops through all active accounts and syncs orders
    // ============================================================
    this.orderSyncHandler = new nodejs.NodejsFunction(this, 'OrderSyncHandler', {
      functionName: 'repricing-v2-order-sync',
      entry: path.join(__dirname, '../../../packages/lambdas/order-sync-v2/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../../..'),
    });

    // ============================================================
    // PRICE CALCULATOR HANDLER - V2
    // Calculates prices per account
    // ============================================================
    this.priceCalculatorHandler = new nodejs.NodejsFunction(this, 'PriceCalculatorHandler', {
      functionName: 'repricing-v2-price-calculator',
      entry: path.join(__dirname, '../../../packages/lambdas/price-calculator-v2/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../../..'),
    });

    // ============================================================
    // COMPETITOR SCRAPE HANDLER - V2
    // Scrapes competitor prices per account
    // ============================================================
    this.competitorScrapeHandler = new nodejs.NodejsFunction(this, 'CompetitorScrapeHandler', {
      functionName: 'repricing-v2-competitor-scrape',
      entry: path.join(__dirname, '../../../packages/lambdas/competitor-scrape-v2/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../../..'),
    });

    // ============================================================
    // AKENEO SYNC HANDLER - V2
    // Syncs product Family data from Akeneo PIM
    // Runs every 15 mins, only syncs products with no family or stale data
    // ============================================================
    const akeneoSecretArn = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:repricing/akeneo-zpSy5q`;

    this.akeneoSyncHandler = new nodejs.NodejsFunction(this, 'AkeneoSyncHandler', {
      functionName: 'repricing-v2-akeneo-sync',
      entry: path.join(__dirname, '../../../packages/lambdas/akeneo-sync/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...commonEnv,
        AKENEO_SECRET_ARN: akeneoSecretArn,
        AKENEO_REFRESH_DAYS: '7',
        MAX_PRODUCTS_PER_RUN: '500',
        REQUESTS_PER_SECOND: '10', // Conservative rate limit
      },
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../../..'),
    });

    // ============================================================
    // PERMISSIONS - Grant all Lambdas access to tables
    // ============================================================
    const allLambdas = [
      this.apiHandler,
      this.dataSyncHandler,
      this.orderSyncHandler,
      this.priceCalculatorHandler,
      this.competitorScrapeHandler,
      this.akeneoSyncHandler,
    ];

    const allTables = [
      props.accountsTable,
      props.productsTable,
      props.pricingRulesTable,
      props.priceProposalsTable,
      props.channelConfigTable,
      props.ordersTable,
      props.orderLinesTable,
      props.carrierCostsTable,
      props.skuHistoryTable,
    ];

    for (const fn of allLambdas) {
      // DynamoDB permissions
      for (const table of allTables) {
        table.grantReadWriteData(fn);
      }

      // Secrets Manager permissions (for per-account credentials and shared secrets)
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
          ],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:repricing-v2/*`,
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:repricing/*`,
          ],
        })
      );
    }

    // Cognito admin permissions for API handler (user management)
    this.apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:ListUsers',
          'cognito-idp:ListUsersInGroup',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    // ============================================================
    // EVENTBRIDGE SCHEDULES
    // ============================================================

    // Daily data sync (5am UTC)
    const dataSyncRule = new events.Rule(this, 'DataSyncSchedule', {
      ruleName: 'repricing-v2-data-sync-daily',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '5',
      }),
      description: 'V2: Daily data sync for all accounts',
    });
    dataSyncRule.addTarget(new targets.LambdaFunction(this.dataSyncHandler));

    // Hourly order sync
    const orderSyncRule = new events.Rule(this, 'OrderSyncSchedule', {
      ruleName: 'repricing-v2-order-sync-hourly',
      schedule: events.Schedule.cron({
        minute: '0',
      }),
      description: 'V2: Hourly order sync for all accounts',
    });
    orderSyncRule.addTarget(new targets.LambdaFunction(this.orderSyncHandler));

    // Weekly price calculation (Monday 7am UTC)
    const priceCalcRule = new events.Rule(this, 'PriceCalculatorSchedule', {
      ruleName: 'repricing-v2-price-calc-weekly',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '7',
        weekDay: 'MON',
      }),
      description: 'V2: Weekly price calculation for all accounts',
    });
    priceCalcRule.addTarget(new targets.LambdaFunction(this.priceCalculatorHandler));

    // Daily competitor scrape (4am UTC)
    const competitorScrapeRule = new events.Rule(this, 'CompetitorScrapeSchedule', {
      ruleName: 'repricing-v2-competitor-scrape-daily',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '4',
      }),
      description: 'V2: Daily competitor price scraping for all accounts',
    });
    competitorScrapeRule.addTarget(new targets.LambdaFunction(this.competitorScrapeHandler));

    // Akeneo sync every 15 minutes
    // Only syncs products with no family or family data older than 7 days
    const akeneoSyncRule = new events.Rule(this, 'AkeneoSyncSchedule', {
      ruleName: 'repricing-v2-akeneo-sync-15min',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: 'V2: Sync product Family data from Akeneo PIM every 15 minutes',
    });
    akeneoSyncRule.addTarget(new targets.LambdaFunction(this.akeneoSyncHandler));

    // ============================================================
    // OUTPUTS
    // ============================================================
    new cdk.CfnOutput(this, 'ApiFunctionArn', {
      value: this.apiHandler.functionArn,
      exportName: 'RepricingV2ApiFunctionArn',
    });

    new cdk.CfnOutput(this, 'DataSyncFunctionArn', {
      value: this.dataSyncHandler.functionArn,
      exportName: 'RepricingV2DataSyncFunctionArn',
    });

    new cdk.CfnOutput(this, 'OrderSyncFunctionArn', {
      value: this.orderSyncHandler.functionArn,
      exportName: 'RepricingV2OrderSyncFunctionArn',
    });

    new cdk.CfnOutput(this, 'PriceCalculatorFunctionArn', {
      value: this.priceCalculatorHandler.functionArn,
      exportName: 'RepricingV2PriceCalculatorFunctionArn',
    });

    new cdk.CfnOutput(this, 'CompetitorScrapeFunctionArn', {
      value: this.competitorScrapeHandler.functionArn,
      exportName: 'RepricingV2CompetitorScrapeFunctionArn',
    });

    new cdk.CfnOutput(this, 'AkeneoSyncFunctionArn', {
      value: this.akeneoSyncHandler.functionArn,
      exportName: 'RepricingV2AkeneoSyncFunctionArn',
    });
  }
}
