/**
 * Setup Super Admin Users
 *
 * This script adds specified users to the super-admin group in the V2 Cognito User Pool.
 * It also sets their allowedAccounts to include all accounts.
 *
 * Usage:
 *   npx ts-node scripts/setup-super-admins.ts
 *
 * Environment:
 *   USER_POOL_ID - The V2 Cognito User Pool ID
 */

import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Configuration - Update these with your actual values
const USER_POOL_ID = process.env.USER_POOL_ID || 'YOUR_V2_USER_POOL_ID';
const REGION = 'eu-west-2';

// Super admin emails to configure
const SUPER_ADMIN_EMAILS = [
  'gavin@kubathrooms.co.uk',  // Update with actual email
  'courtney@kubathrooms.co.uk', // Update with actual email
];

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Get all account IDs from the V2 accounts table
 */
async function getAllAccountIds(): Promise<string[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: 'repricing-v2-accounts',
      ProjectionExpression: 'accountId',
    })
  );

  return (result.Items || []).map((item) => item.accountId as string);
}

/**
 * Check if a user exists in the user pool
 */
async function userExists(email: string): Promise<boolean> {
  try {
    await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
    return true;
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'UserNotFoundException') {
      return false;
    }
    throw error;
  }
}

/**
 * Add user to super-admin group
 */
async function addToSuperAdminGroup(email: string): Promise<void> {
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: 'super-admin',
    })
  );
}

/**
 * Set user's allowed accounts to all accounts
 */
async function setAllowedAccounts(email: string, accountIds: string[]): Promise<void> {
  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        {
          Name: 'custom:allowedAccounts',
          Value: JSON.stringify(accountIds),
        },
        {
          Name: 'custom:defaultAccount',
          Value: accountIds[0] || '',
        },
      ],
    })
  );
}

/**
 * Main setup function
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Super Admin Setup Script');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nUser Pool ID: ${USER_POOL_ID}`);
  console.log(`Region: ${REGION}`);
  console.log(`\nSuper Admin Users:`);
  SUPER_ADMIN_EMAILS.forEach((email) => console.log(`  - ${email}`));

  // Check if USER_POOL_ID is set
  if (USER_POOL_ID === 'YOUR_V2_USER_POOL_ID') {
    console.error('\n❌ Error: Please set the USER_POOL_ID environment variable');
    console.log('   Export USER_POOL_ID=<your-v2-user-pool-id>');
    process.exit(1);
  }

  // Get all account IDs
  console.log('\n📝 Fetching account IDs from DynamoDB...');
  let accountIds: string[] = [];
  try {
    accountIds = await getAllAccountIds();
    console.log(`   Found ${accountIds.length} accounts: ${accountIds.join(', ')}`);
  } catch (error) {
    console.warn('   ⚠️ Could not fetch accounts (table may not exist yet)');
    console.warn('   Super admins will have access once accounts are created');
  }

  // Process each super admin
  console.log('\n🔐 Setting up super admin users...\n');

  for (const email of SUPER_ADMIN_EMAILS) {
    console.log(`Processing: ${email}`);

    // Check if user exists
    const exists = await userExists(email);
    if (!exists) {
      console.log(`   ⚠️ User does not exist in pool - they need to be created first`);
      console.log(`   Run: aws cognito-idp admin-create-user --user-pool-id ${USER_POOL_ID} --username ${email}`);
      continue;
    }

    try {
      // Add to super-admin group
      console.log('   Adding to super-admin group...');
      await addToSuperAdminGroup(email);
      console.log('   ✅ Added to super-admin group');

      // Set allowed accounts
      if (accountIds.length > 0) {
        console.log('   Setting allowed accounts...');
        await setAllowedAccounts(email, accountIds);
        console.log(`   ✅ Access granted to ${accountIds.length} accounts`);
      }

      console.log(`   ✅ ${email} is now a super admin\n`);
    } catch (error) {
      console.error(`   ❌ Error setting up ${email}:`, error);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Setup Complete');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\nNext steps:');
  console.log('  1. If any users need to be created, run the admin-create-user command shown above');
  console.log('  2. Users will receive a temporary password via email');
  console.log('  3. They can then log in to the V2 dashboard and access all accounts');
  console.log('');
}

// Run setup
main().catch(console.error);
