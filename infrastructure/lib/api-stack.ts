import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  apiHandler: lambda.Function;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // REST API Gateway
    const api = new apigateway.RestApi(this, 'RepricingApi', {
      restApiName: 'Repricing API',
      description: 'API for the repricing approval workflow',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda integration - disable per-method permissions to avoid policy size limit
    // We'll add a single wildcard permission instead
    const lambdaIntegration = new apigateway.LambdaIntegration(props.apiHandler, {
      allowTestInvoke: false, // Reduces policy entries
    });

    // Add single Lambda permission for all API Gateway methods (avoids 20KB policy limit)
    props.apiHandler.addPermission('ApiGatewayInvoke', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi('*', '/*', '*'),
    });

    // Products endpoints
    const products = api.root.addResource('products');
    products.addMethod('GET', lambdaIntegration); // List products

    const product = products.addResource('{sku}');
    product.addMethod('GET', lambdaIntegration); // Get single product
    product.addMethod('PUT', lambdaIntegration); // Update product (costs, delivery)

    // Proposals endpoints
    const proposals = api.root.addResource('proposals');
    proposals.addMethod('GET', lambdaIntegration); // List proposals (filter by status)
    proposals.addMethod('POST', lambdaIntegration); // Create manual proposal

    const proposal = proposals.addResource('{proposalId}');
    proposal.addMethod('GET', lambdaIntegration); // Get single proposal
    proposal.addMethod('PUT', lambdaIntegration); // Update (approve/reject/modify)

    // Bulk operations
    const bulkApprove = proposals.addResource('bulk-approve');
    bulkApprove.addMethod('POST', lambdaIntegration);

    const bulkReject = proposals.addResource('bulk-reject');
    bulkReject.addMethod('POST', lambdaIntegration);

    // Push approved prices to ChannelEngine
    const pushPrices = proposals.addResource('push');
    pushPrices.addMethod('POST', lambdaIntegration);

    // Pricing rules endpoints
    const rules = api.root.addResource('rules');
    rules.addMethod('GET', lambdaIntegration); // List rules
    rules.addMethod('POST', lambdaIntegration); // Create rule

    const rule = rules.addResource('{ruleId}');
    rule.addMethod('GET', lambdaIntegration);
    rule.addMethod('PUT', lambdaIntegration);
    rule.addMethod('DELETE', lambdaIntegration);

    // Channel configuration endpoints
    const channels = api.root.addResource('channels');
    channels.addMethod('GET', lambdaIntegration); // List channels

    const channel = channels.addResource('{channelId}');
    channel.addMethod('GET', lambdaIntegration);
    channel.addMethod('PUT', lambdaIntegration); // Update channel config

    // Data sync trigger (manual)
    const sync = api.root.addResource('sync');
    sync.addMethod('POST', lambdaIntegration); // Trigger data sync

    // Analytics/dashboard endpoints
    const analytics = api.root.addResource('analytics');

    const summary = analytics.addResource('summary');
    summary.addMethod('GET', lambdaIntegration); // Dashboard summary

    const margins = analytics.addResource('margins');
    margins.addMethod('GET', lambdaIntegration); // Margin analysis

    const sales = analytics.addResource('sales');
    sales.addMethod('GET', lambdaIntegration); // 7-day sales by SKU

    // Import endpoints
    const importResource = api.root.addResource('import');

    const importCosts = importResource.addResource('costs');
    importCosts.addMethod('POST', lambdaIntegration); // Upload cost CSV

    const importDelivery = importResource.addResource('delivery');
    importDelivery.addMethod('POST', lambdaIntegration); // Upload delivery report

    // Carrier costs endpoints
    const carriers = api.root.addResource('carriers');
    carriers.addMethod('GET', lambdaIntegration); // List carriers
    carriers.addMethod('POST', lambdaIntegration); // Create carrier

    const carrier = carriers.addResource('{carrierId}');
    carrier.addMethod('GET', lambdaIntegration); // Get single carrier
    carrier.addMethod('PUT', lambdaIntegration); // Update carrier
    carrier.addMethod('DELETE', lambdaIntegration); // Delete carrier

    this.apiUrl = api.url;

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      exportName: 'RepricingApiEndpoint',
    });
  }
}
