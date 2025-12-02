import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly productsTable: dynamodb.Table;
  public readonly pricingRulesTable: dynamodb.Table;
  public readonly priceProposalsTable: dynamodb.Table;
  public readonly channelConfigTable: dynamodb.Table;
  public readonly ordersTable: dynamodb.Table;
  public readonly orderLinesTable: dynamodb.Table; // Deprecated - will be removed after Lambda stack update
  // Note: carrierCostsTable was created manually via CLI (repricing-carrier-costs)

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Products table - Core product data with costs and current prices
    this.productsTable = new dynamodb.Table(this, 'ProductsTable', {
      tableName: 'repricing-products',
      partitionKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // Cost-optimized
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete data on stack removal
      pointInTimeRecovery: true,
    });

    // GSI for querying by brand
    this.productsTable.addGlobalSecondaryIndex({
      indexName: 'by-brand',
      partitionKey: { name: 'brand', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying by category
    this.productsTable.addGlobalSecondaryIndex({
      indexName: 'by-category',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
    });

    // Pricing rules table - Configurable repricing rules
    this.pricingRulesTable = new dynamodb.Table(this, 'PricingRulesTable', {
      tableName: 'repricing-rules',
      partitionKey: { name: 'ruleId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Price proposals table - Pending price changes for approval
    this.priceProposalsTable = new dynamodb.Table(this, 'PriceProposalsTable', {
      tableName: 'repricing-proposals',
      partitionKey: { name: 'proposalId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl', // Auto-delete old proposals
    });

    // GSI for querying proposals by status
    this.priceProposalsTable.addGlobalSecondaryIndex({
      indexName: 'by-status',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying proposals by SKU
    this.priceProposalsTable.addGlobalSecondaryIndex({
      indexName: 'by-sku',
      partitionKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Channel configuration table - Channel fees, settings
    this.channelConfigTable = new dynamodb.Table(this, 'ChannelConfigTable', {
      tableName: 'repricing-channels',
      partitionKey: { name: 'channelId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Orders table - Order header data
    this.ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'repricing-orders',
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI for querying orders by channel
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-channel',
      partitionKey: { name: 'channelName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderDate', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying orders by date (for daily reporting)
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-date',
      partitionKey: { name: 'orderDateDay', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
    });

    // Deprecated - Order Lines table (keeping reference to avoid CloudFormation export issues)
    // The table was deleted from AWS but we need the CDK reference for clean removal
    this.orderLinesTable = new dynamodb.Table(this, 'OrderLinesTable', {
      tableName: 'repricing-order-lines',
      partitionKey: { name: 'orderLineId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Note: Carrier costs table (repricing-carrier-costs) was created manually via CLI

    // Outputs
    new cdk.CfnOutput(this, 'ProductsTableName', {
      value: this.productsTable.tableName,
      exportName: 'ProductsTableName',
    });

    new cdk.CfnOutput(this, 'PricingRulesTableName', {
      value: this.pricingRulesTable.tableName,
      exportName: 'PricingRulesTableName',
    });

    new cdk.CfnOutput(this, 'PriceProposalsTableName', {
      value: this.priceProposalsTable.tableName,
      exportName: 'PriceProposalsTableName',
    });

    new cdk.CfnOutput(this, 'ChannelConfigTableName', {
      value: this.channelConfigTable.tableName,
      exportName: 'ChannelConfigTableName',
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: this.ordersTable.tableName,
      exportName: 'OrdersTableName',
    });

    new cdk.CfnOutput(this, 'OrderLinesTableName', {
      value: this.orderLinesTable.tableName,
      exportName: 'OrderLinesTableName',
    });

  }
}
