import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  apiHandler: lambda.Function;
  userPool: cognito.UserPool;
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

    // Cognito authorizer for protected endpoints
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'RepricingAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });

    // Lambda integration - disable per-method permissions to avoid policy size limit
    const lambdaIntegration = new apigateway.LambdaIntegration(props.apiHandler, {
      allowTestInvoke: false, // Reduces policy entries
      proxy: true,
    });

    // Method options for protected endpoints (require auth)
    const protectedMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Products endpoints - GET is protected (requires login), PUT requires editor role
    const products = api.root.addResource('products');
    products.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    const product = products.addResource('{sku}');
    product.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    product.addMethod('PUT', lambdaIntegration, protectedMethodOptions); // Editor+

    // Proposals endpoints - all protected
    const proposals = api.root.addResource('proposals');
    proposals.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    proposals.addMethod('POST', lambdaIntegration, protectedMethodOptions); // Editor+

    const proposal = proposals.addResource('{proposalId}');
    proposal.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    proposal.addMethod('PUT', lambdaIntegration, protectedMethodOptions); // Editor+

    // Bulk operations - Editor+
    const bulkApprove = proposals.addResource('bulk-approve');
    bulkApprove.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    const bulkReject = proposals.addResource('bulk-reject');
    bulkReject.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    const bulkApproveFiltered = proposals.addResource('bulk-approve-filtered');
    bulkApproveFiltered.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    const statusCounts = proposals.addResource('status-counts');
    statusCounts.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    // Push approved prices to ChannelEngine - Admin only (enforced in Lambda)
    const pushPrices = proposals.addResource('push');
    pushPrices.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    // Pricing rules endpoints - Admin only for modifications
    const rules = api.root.addResource('rules');
    rules.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    rules.addMethod('POST', lambdaIntegration, protectedMethodOptions); // Admin

    const rule = rules.addResource('{ruleId}');
    rule.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    rule.addMethod('PUT', lambdaIntegration, protectedMethodOptions); // Admin
    rule.addMethod('DELETE', lambdaIntegration, protectedMethodOptions); // Admin

    // Channel configuration endpoints - Admin only for modifications
    const channels = api.root.addResource('channels');
    channels.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    const channel = channels.addResource('{channelId}');
    channel.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    channel.addMethod('PUT', lambdaIntegration, protectedMethodOptions); // Admin

    // Data sync trigger (manual) - Admin only
    const sync = api.root.addResource('sync');
    sync.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    // Analytics/dashboard endpoints - all users can view
    const analytics = api.root.addResource('analytics');

    const summary = analytics.addResource('summary');
    summary.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    const margins = analytics.addResource('margins');
    margins.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    const sales = analytics.addResource('sales');
    sales.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    // Import endpoints - Admin only
    const importResource = api.root.addResource('import');

    const importCosts = importResource.addResource('costs');
    importCosts.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    const importDelivery = importResource.addResource('delivery');
    importDelivery.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    // Carrier costs endpoints - Admin only for modifications
    const carriers = api.root.addResource('carriers');
    carriers.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    carriers.addMethod('POST', lambdaIntegration, protectedMethodOptions); // Admin

    const carriersRecalculate = carriers.addResource('recalculate');
    carriersRecalculate.addMethod('POST', lambdaIntegration, protectedMethodOptions); // Admin

    const carrier = carriers.addResource('{carrierId}');
    carrier.addMethod('GET', lambdaIntegration, protectedMethodOptions);
    carrier.addMethod('PUT', lambdaIntegration, protectedMethodOptions); // Admin
    carrier.addMethod('DELETE', lambdaIntegration, protectedMethodOptions); // Admin

    // Competitor monitoring endpoints - Editor+ for modifications
    const competitors = api.root.addResource('competitors');
    const competitorsScrape = competitors.addResource('scrape');
    competitorsScrape.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    const competitorAddUrl = competitors.addResource('add-url');
    competitorAddUrl.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    const competitorRemoveUrl = competitors.addResource('remove-url');
    competitorRemoveUrl.addMethod('DELETE', lambdaIntegration, protectedMethodOptions);

    // Scrape single SKU: /competitors/scrape/{sku}
    const competitorScrapeSku = competitorsScrape.addResource('{sku}');
    competitorScrapeSku.addMethod('POST', lambdaIntegration, protectedMethodOptions);

    // History endpoints
    const history = api.root.addResource('history');
    const historyBackfill = history.addResource('backfill');
    historyBackfill.addMethod('POST', lambdaIntegration, protectedMethodOptions); // Admin
    const historySku = history.addResource('{sku}');
    historySku.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    // Insights endpoint
    const insights = analytics.addResource('insights');
    insights.addMethod('GET', lambdaIntegration, protectedMethodOptions);

    // Prices endpoint - for updating channel prices in Google Sheet
    const prices = api.root.addResource('prices');
    const priceSku = prices.addResource('{sku}');
    priceSku.addMethod('PUT', lambdaIntegration, protectedMethodOptions); // Editor+

    // Order lines backfill endpoint - Admin only
    const orderLines = api.root.addResource('order-lines');
    const orderLinesBackfill = orderLines.addResource('backfill');
    orderLinesBackfill.addMethod('POST', lambdaIntegration, protectedMethodOptions); // Admin

    this.apiUrl = api.url;

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      exportName: 'RepricingApiEndpoint',
    });
  }
}
