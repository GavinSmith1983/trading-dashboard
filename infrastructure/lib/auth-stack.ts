import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'RepricingUserPool', {
      userPoolName: 'repricing-users',
      selfSignUpEnabled: false, // Admin creates users
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        role: new cognito.StringAttribute({
          mutable: true,
        }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create Admin group
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrators with full access',
      precedence: 0,
    });

    // Create Editor group (can approve/reject proposals, edit products)
    new cognito.CfnUserPoolGroup(this, 'EditorGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'editor',
      description: 'Editors who can approve proposals and edit products',
      precedence: 1,
    });

    // Create Viewer group (read-only access)
    new cognito.CfnUserPoolGroup(this, 'ViewerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'viewer',
      description: 'Viewers with read-only access',
      precedence: 2,
    });

    // Create User Pool Client for the web app
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'repricing-web',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false, // No secret for browser-based apps
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Create a domain for hosted UI (optional, but useful for password reset)
    const domainPrefix = `repricing-${cdk.Aws.ACCOUNT_ID}`;
    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'RepricingUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'RepricingUserPoolClientId',
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: `${domainPrefix}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      exportName: 'RepricingUserPoolDomain',
    });

    new cdk.CfnOutput(this, 'CognitoRegion', {
      value: cdk.Aws.REGION,
      exportName: 'RepricingCognitoRegion',
    });
  }
}
