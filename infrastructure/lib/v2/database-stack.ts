import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * V2 Database Stack - Multi-tenant DynamoDB tables
 * All tables use accountId as partition key for tenant isolation
 */
export class DatabaseStackV2 extends cdk.Stack {
  public readonly accountsTable: dynamodb.Table;
  public readonly productsTable: dynamodb.Table;
  public readonly pricingRulesTable: dynamodb.Table;
  public readonly priceProposalsTable: dynamodb.Table;
  public readonly channelConfigTable: dynamodb.Table;
  public readonly ordersTable: dynamodb.Table;
  public readonly orderLinesTable: dynamodb.Table;
  public readonly carrierCostsTable: dynamodb.Table;
  public readonly skuHistoryTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================================
    // ACCOUNTS TABLE - Core multi-tenant configuration
    // ============================================================
    this.accountsTable = new dynamodb.Table(this, 'AccountsTable', {
      tableName: 'repricing-v2-accounts',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // ============================================================
    // PRODUCTS TABLE - Products per account
    // ============================================================
    this.productsTable = new dynamodb.Table(this, 'ProductsTable', {
      tableName: 'repricing-v2-products',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI for querying by brand within an account
    this.productsTable.addGlobalSecondaryIndex({
      indexName: 'by-account-brand',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'brand', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying by category within an account
    this.productsTable.addGlobalSecondaryIndex({
      indexName: 'by-account-category',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'category', type: dynamodb.AttributeType.STRING },
    });

    // ============================================================
    // PRICING RULES TABLE - Rules per account
    // ============================================================
    this.pricingRulesTable = new dynamodb.Table(this, 'PricingRulesTable', {
      tableName: 'repricing-v2-rules',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ruleId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================================
    // PRICE PROPOSALS TABLE - Proposals per account
    // ============================================================
    this.priceProposalsTable = new dynamodb.Table(this, 'PriceProposalsTable', {
      tableName: 'repricing-v2-proposals',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'proposalId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // GSI for querying proposals by status within an account
    this.priceProposalsTable.addGlobalSecondaryIndex({
      indexName: 'by-account-status',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying proposals by SKU within an account
    this.priceProposalsTable.addGlobalSecondaryIndex({
      indexName: 'by-account-sku',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
    });

    // ============================================================
    // CHANNEL CONFIG TABLE - Channel settings per account
    // ============================================================
    this.channelConfigTable = new dynamodb.Table(this, 'ChannelConfigTable', {
      tableName: 'repricing-v2-channels',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'channelId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================================
    // ORDERS TABLE - Orders per account
    // ============================================================
    this.ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'repricing-v2-orders',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI for querying orders by date within an account
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-account-date',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderDateDay', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying orders by channel within an account
    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-account-channel',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'channelName', type: dynamodb.AttributeType.STRING },
    });

    // ============================================================
    // ORDER LINES TABLE - Denormalized order lines per account
    // Composite sort key for efficient SKU + date queries
    // ============================================================
    this.orderLinesTable = new dynamodb.Table(this, 'OrderLinesTable', {
      tableName: 'repricing-v2-order-lines',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'skuOrderDate', type: dynamodb.AttributeType.STRING }, // "SKU#2024-01-15T10:30:00Z#orderId"
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // GSI for querying order lines by date within an account
    this.orderLinesTable.addGlobalSecondaryIndex({
      indexName: 'by-account-date',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'orderDateDay', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying order lines by SKU within an account
    this.orderLinesTable.addGlobalSecondaryIndex({
      indexName: 'by-account-sku',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
    });

    // ============================================================
    // CARRIER COSTS TABLE - Delivery carrier costs per account
    // ============================================================
    this.carrierCostsTable = new dynamodb.Table(this, 'CarrierCostsTable', {
      tableName: 'repricing-v2-carrier-costs',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'carrierId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================================
    // SKU HISTORY TABLE - Historical pricing/stock data per account
    // ============================================================
    this.skuHistoryTable = new dynamodb.Table(this, 'SkuHistoryTable', {
      tableName: 'repricing-v2-sku-history',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'skuDate', type: dynamodb.AttributeType.STRING }, // "SKU#2024-01-15"
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // ============================================================
    // OUTPUTS
    // ============================================================
    new cdk.CfnOutput(this, 'AccountsTableName', {
      value: this.accountsTable.tableName,
      exportName: 'RepricingV2AccountsTableName',
    });

    new cdk.CfnOutput(this, 'ProductsTableName', {
      value: this.productsTable.tableName,
      exportName: 'RepricingV2ProductsTableName',
    });

    new cdk.CfnOutput(this, 'PricingRulesTableName', {
      value: this.pricingRulesTable.tableName,
      exportName: 'RepricingV2PricingRulesTableName',
    });

    new cdk.CfnOutput(this, 'PriceProposalsTableName', {
      value: this.priceProposalsTable.tableName,
      exportName: 'RepricingV2PriceProposalsTableName',
    });

    new cdk.CfnOutput(this, 'ChannelConfigTableName', {
      value: this.channelConfigTable.tableName,
      exportName: 'RepricingV2ChannelConfigTableName',
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: this.ordersTable.tableName,
      exportName: 'RepricingV2OrdersTableName',
    });

    new cdk.CfnOutput(this, 'OrderLinesTableName', {
      value: this.orderLinesTable.tableName,
      exportName: 'RepricingV2OrderLinesTableName',
    });

    new cdk.CfnOutput(this, 'CarrierCostsTableName', {
      value: this.carrierCostsTable.tableName,
      exportName: 'RepricingV2CarrierCostsTableName',
    });

    new cdk.CfnOutput(this, 'SkuHistoryTableName', {
      value: this.skuHistoryTable.tableName,
      exportName: 'RepricingV2SkuHistoryTableName',
    });
  }
}
