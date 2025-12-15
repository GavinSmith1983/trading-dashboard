import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface ApiStackV2Props extends cdk.StackProps {
  apiHandler: lambda.Function;
  userPool: cognito.UserPool;
}

/**
 * V2 API Stack - REST API Gateway with multi-tenant support
 * Uses proxy integration to avoid Lambda permission policy size limits
 * All endpoints require X-Account-Id header and validate access
 */
export class ApiStackV2 extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackV2Props) {
    super(scope, id, props);

    // REST API Gateway
    const api = new apigateway.RestApi(this, 'RepricingV2Api', {
      restApiName: 'Repricing V2 API',
      description: 'Multi-tenant API for the repricing approval workflow',
      deployOptions: {
        stageName: 'prod',
        // Security: Reduced rate limits to prevent brute force attacks
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10,
      },
      defaultCorsPreflightOptions: {
        // Security: Restrict CORS to known frontend domains only
        allowOrigins: [
          'https://d1stq5bxiu9ds3.cloudfront.net',  // Production CloudFront
          'http://localhost:5173',                   // Local dev (Vite default)
          'http://localhost:3000',                   // Local dev (alternative)
        ],
        allowMethods: [
          'GET',
          'POST',
          'PUT',
          'DELETE',
          'OPTIONS',
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Account-Id'],
      },
    });

    // Cognito authorizer for protected endpoints
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'RepricingV2Authorizer',
      identitySource: 'method.request.header.Authorization',
    });

    // Lambda integration with proxy
    const lambdaIntegration = new apigateway.LambdaIntegration(props.apiHandler, {
      allowTestInvoke: false,
      proxy: true,
    });

    // Method options for protected endpoints
    const protectedMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // ============================================================
    // USE PROXY RESOURCE FOR ALL ROUTES
    // This avoids the Lambda permission policy size limit by using
    // a single {proxy+} resource instead of individual routes
    // ============================================================

    // Add a proxy resource that catches all paths
    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', lambdaIntegration, protectedMethodOptions);

    // Also add root method for requests to /
    api.root.addMethod('ANY', lambdaIntegration, protectedMethodOptions);

    this.apiUrl = api.url;

    // ============================================================
    // OUTPUTS
    // ============================================================
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      exportName: 'RepricingV2ApiEndpoint',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: api.restApiId,
      exportName: 'RepricingV2ApiId',
    });
  }
}
