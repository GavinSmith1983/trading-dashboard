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
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
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
