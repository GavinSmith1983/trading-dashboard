import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface LambdaStackProps extends cdk.StackProps {
  productsTable: dynamodb.Table;
  pricingRulesTable: dynamodb.Table;
  priceProposalsTable: dynamodb.Table;
  channelConfigTable: dynamodb.Table;
  ordersTable: dynamodb.Table;
  orderLinesTable: dynamodb.Table;
}

export class LambdaStack extends cdk.Stack {
  public readonly apiHandler: lambda.Function;
  public readonly dataSyncHandler: lambda.Function;
  public readonly priceCalculatorHandler: lambda.Function;
  public readonly orderSyncHandler: lambda.Function;
  public readonly competitorScrapeHandler: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Secrets for API credentials
    const channelEngineSecret = new secretsmanager.Secret(this, 'ChannelEngineSecret', {
      secretName: 'repricing/channel-engine',
      description: 'ChannelEngine API credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          apiKey: 'REPLACE_ME',
          tenantId: 'REPLACE_ME',
        }),
        generateStringKey: 'placeholder',
      },
    });

    const googleSheetsSecret = new secretsmanager.Secret(this, 'GoogleSheetsSecret', {
      secretName: 'repricing/google-sheets',
      description: 'Google Sheets API credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          spreadsheetId: '1scr_yS-9U6x4zTN9HG3emptsqt8phQgDjYeNygB8Cs8',
          credentials: 'REPLACE_WITH_SERVICE_ACCOUNT_JSON',
        }),
        generateStringKey: 'placeholder',
      },
    });

    // Common Lambda environment variables
    const commonEnv = {
      PRODUCTS_TABLE: props.productsTable.tableName,
      PRICING_RULES_TABLE: props.pricingRulesTable.tableName,
      PRICE_PROPOSALS_TABLE: props.priceProposalsTable.tableName,
      CHANNEL_CONFIG_TABLE: props.channelConfigTable.tableName,
      ORDERS_TABLE: props.ordersTable.tableName,
      ORDER_LINES_TABLE: props.orderLinesTable.tableName,
      CHANNEL_ENGINE_SECRET_ARN: channelEngineSecret.secretArn,
      GOOGLE_SHEETS_SECRET_ARN: googleSheetsSecret.secretArn,
    };

    // Common bundling options - resolve workspace packages
    const bundlingOptions: nodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      nodeModules: ['googleapis', 'uuid'],
      // Resolve @repricing/core from the monorepo
      tsconfig: path.join(__dirname, '../../packages/lambdas/tsconfig.json'),
      esbuildArgs: {
        '--resolve-extensions': '.ts,.js',
      },
    };

    // Data Sync Lambda - Pulls data from ChannelEngine and Google Sheets
    // Increased timeout and memory for fetching 6000+ products
    this.dataSyncHandler = new nodejs.NodejsFunction(this, 'DataSyncHandler', {
      functionName: 'repricing-data-sync',
      entry: path.join(__dirname, '../../packages/lambdas/data-sync/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../..'),
    });

    // Price Calculator Lambda - Applies pricing rules
    this.priceCalculatorHandler = new nodejs.NodejsFunction(this, 'PriceCalculatorHandler', {
      functionName: 'repricing-price-calculator',
      entry: path.join(__dirname, '../../packages/lambdas/price-calculator/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../..'),
    });

    // API Handler Lambda - REST API for frontend
    // Increased timeout and memory to handle large cost imports (6000+ products)
    this.apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: 'repricing-api',
      entry: path.join(__dirname, '../../packages/lambdas/api/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../..'),
    });

    // Order Sync Lambda - Pulls order data from ChannelEngine
    // Increased timeout for backfill (13 months of data)
    this.orderSyncHandler = new nodejs.NodejsFunction(this, 'OrderSyncHandler', {
      functionName: 'repricing-order-sync',
      entry: path.join(__dirname, '../../packages/lambdas/order-sync/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../..'),
    });

    // Competitor Scrape Lambda - Scrapes competitor prices weekly
    this.competitorScrapeHandler = new nodejs.NodejsFunction(this, 'CompetitorScrapeHandler', {
      functionName: 'repricing-competitor-scrape',
      entry: path.join(__dirname, '../../packages/lambdas/competitor-scrape/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: commonEnv,
      bundling: bundlingOptions,
      projectRoot: path.join(__dirname, '../..'),
    });

    // Grant DynamoDB permissions to all Lambdas
    const allLambdas = [this.dataSyncHandler, this.priceCalculatorHandler, this.apiHandler, this.orderSyncHandler, this.competitorScrapeHandler];

    for (const fn of allLambdas) {
      props.productsTable.grantReadWriteData(fn);
      props.pricingRulesTable.grantReadWriteData(fn);
      props.priceProposalsTable.grantReadWriteData(fn);
      props.channelConfigTable.grantReadWriteData(fn);
      props.ordersTable.grantReadWriteData(fn);
      props.orderLinesTable.grantReadWriteData(fn);
      channelEngineSecret.grantRead(fn);
      googleSheetsSecret.grantRead(fn);
    }

    // EventBridge rule - Daily data sync (5am UTC - products, stock, pricing from Sheets)
    const dataSyncRule = new events.Rule(this, 'DataSyncSchedule', {
      ruleName: 'repricing-data-sync-daily',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '5',
      }),
      description: 'Daily data sync from ChannelEngine (products, stock, pricing) and Google Sheets',
    });
    dataSyncRule.addTarget(new targets.LambdaFunction(this.dataSyncHandler));

    // EventBridge rule - Hourly order sync (every hour on the hour)
    const orderSyncRule = new events.Rule(this, 'OrderSyncSchedule', {
      ruleName: 'repricing-order-sync-hourly',
      schedule: events.Schedule.cron({
        minute: '0',
      }),
      description: 'Hourly order sync from ChannelEngine',
    });
    orderSyncRule.addTarget(new targets.LambdaFunction(this.orderSyncHandler));

    // EventBridge rule - Weekly price calculation (Monday 7am UTC, after data sync completes)
    const priceCalcRule = new events.Rule(this, 'PriceCalculatorSchedule', {
      ruleName: 'repricing-price-calc-weekly',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '7',
        weekDay: 'MON',
      }),
      description: 'Weekly price calculation and proposal generation',
    });
    priceCalcRule.addTarget(new targets.LambdaFunction(this.priceCalculatorHandler));

    // EventBridge rule - Daily competitor scrape (4am UTC, before data sync)
    const competitorScrapeRule = new events.Rule(this, 'CompetitorScrapeSchedule', {
      ruleName: 'repricing-competitor-scrape-daily',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '4',
      }),
      description: 'Daily competitor price scraping',
    });
    competitorScrapeRule.addTarget(new targets.LambdaFunction(this.competitorScrapeHandler));

    // Outputs
    new cdk.CfnOutput(this, 'DataSyncFunctionArn', {
      value: this.dataSyncHandler.functionArn,
    });

    new cdk.CfnOutput(this, 'PriceCalculatorFunctionArn', {
      value: this.priceCalculatorHandler.functionArn,
    });

    new cdk.CfnOutput(this, 'ApiFunctionArn', {
      value: this.apiHandler.functionArn,
    });

    new cdk.CfnOutput(this, 'OrderSyncFunctionArn', {
      value: this.orderSyncHandler.functionArn,
    });

    new cdk.CfnOutput(this, 'CompetitorScrapeFunctionArn', {
      value: this.competitorScrapeHandler.functionArn,
    });
  }
}
