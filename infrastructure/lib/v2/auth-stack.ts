import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * V2 Auth Stack - Multi-tenant Cognito User Pool
 * Includes super-admin group and custom attributes for account access
 */
export class AuthStackV2 extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Cognito User Pool for V2
    this.userPool = new cognito.UserPool(this, 'RepricingV2UserPool', {
      userPoolName: 'repricing-v2-users',
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
        // Existing role attribute
        role: new cognito.StringAttribute({
          mutable: true,
        }),
        // NEW: JSON array of allowed account IDs
        // e.g., '["ku-bathrooms", "clearance", "valquest"]'
        allowedAccounts: new cognito.StringAttribute({
          mutable: true,
        }),
        // NEW: Default account ID when user logs in
        // e.g., 'ku-bathrooms'
        defaultAccount: new cognito.StringAttribute({
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

    // ============================================================
    // USER GROUPS - Role-based access control
    // ============================================================

    // Super Admin group - Can access ALL accounts and manage users
    new cognito.CfnUserPoolGroup(this, 'SuperAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'super-admin',
      description: 'Super administrators with access to all accounts and user management',
      precedence: 0, // Highest precedence
    });

    // Admin group - Account-level administrators
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Account administrators with full access within their accounts',
      precedence: 1,
    });

    // Editor group - Can approve/reject proposals, edit products
    new cognito.CfnUserPoolGroup(this, 'EditorGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'editor',
      description: 'Editors who can approve proposals and edit products within their accounts',
      precedence: 2,
    });

    // Viewer group - Read-only access
    new cognito.CfnUserPoolGroup(this, 'ViewerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'viewer',
      description: 'Viewers with read-only access within their accounts',
      precedence: 3,
    });

    // ============================================================
    // USER POOL CLIENT
    // ============================================================

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'repricing-v2-web',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false, // No secret for browser-based apps
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      // Read custom attributes in tokens
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          givenName: true,
          familyName: true,
        })
        .withCustomAttributes('role', 'allowedAccounts', 'defaultAccount'),
    });

    // ============================================================
    // USER POOL DOMAIN
    // ============================================================

    const domainPrefix = `repricing-v2-${cdk.Aws.ACCOUNT_ID}`;
    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix,
      },
    });

    // ============================================================
    // OUTPUTS
    // ============================================================

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'RepricingV2UserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'RepricingV2UserPoolClientId',
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: `${domainPrefix}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      exportName: 'RepricingV2UserPoolDomain',
    });

    new cdk.CfnOutput(this, 'CognitoRegion', {
      value: cdk.Aws.REGION,
      exportName: 'RepricingV2CognitoRegion',
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: 'RepricingV2UserPoolArn',
    });
  }
}
