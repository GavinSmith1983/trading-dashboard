import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { User, CreateUserRequest, UpdateUserRequest } from '@repricing/core';

const cognitoClient = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

/**
 * User Management Service - Cognito admin operations
 */
export class UserManagementService {
  /**
   * List all users in the user pool
   */
  async listUsers(): Promise<User[]> {
    const users: User[] = [];
    let paginationToken: string | undefined;

    do {
      const response = await cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          PaginationToken: paginationToken,
        })
      );

      for (const cognitoUser of response.Users || []) {
        const user = await this.mapCognitoUser(cognitoUser as any);
        if (user) {
          users.push(user);
        }
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return users;
  }

  /**
   * Get a single user by ID (Cognito sub)
   */
  async getUser(userId: string): Promise<User | null> {
    try {
      // Find user by sub (need to search)
      const users = await this.listUsers();
      return users.find((u) => u.userId === userId) || null;
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Get a user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const response = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
        })
      );

      return this.mapCognitoUserResponse(response as any, email);
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'UserNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async createUser(request: CreateUserRequest): Promise<User> {
    // Create the user in Cognito
    const createResponse = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: request.email,
        UserAttributes: [
          { Name: 'email', Value: request.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'given_name', Value: request.givenName },
          { Name: 'family_name', Value: request.familyName },
          { Name: 'custom:allowedAccounts', Value: JSON.stringify(request.allowedAccounts) },
          ...(request.defaultAccount
            ? [{ Name: 'custom:defaultAccount', Value: request.defaultAccount }]
            : []),
        ],
        TemporaryPassword: request.temporaryPassword || undefined,
        // Always send welcome email with temporary password
      })
    );

    // Add user to groups
    for (const group of request.groups) {
      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: request.email,
          GroupName: group,
        })
      );
    }

    // Return the created user
    const user = await this.getUserByEmail(request.email);
    if (!user) {
      throw new Error('Failed to create user');
    }

    return user;
  }

  /**
   * Update an existing user
   */
  async updateUser(email: string, request: UpdateUserRequest & { name?: string }): Promise<User> {
    // Update basic attributes
    const attributes: { Name: string; Value: string }[] = [];

    // Handle name field (split into given_name and family_name)
    if (request.name) {
      const nameParts = request.name.trim().split(' ');
      const givenName = nameParts[0] || '';
      const familyName = nameParts.slice(1).join(' ') || '';
      if (givenName) {
        attributes.push({ Name: 'given_name', Value: givenName });
      }
      if (familyName) {
        attributes.push({ Name: 'family_name', Value: familyName });
      }
    }

    // Also support individual name fields
    if (request.givenName) {
      attributes.push({ Name: 'given_name', Value: request.givenName });
    }
    if (request.familyName) {
      attributes.push({ Name: 'family_name', Value: request.familyName });
    }
    if (request.allowedAccounts) {
      attributes.push({
        Name: 'custom:allowedAccounts',
        Value: JSON.stringify(request.allowedAccounts),
      });
    }
    if (request.defaultAccount !== undefined) {
      attributes.push({ Name: 'custom:defaultAccount', Value: request.defaultAccount });
    }

    if (attributes.length > 0) {
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          UserAttributes: attributes,
        })
      );
    }

    // Update groups if specified
    if (request.groups) {
      // Get current groups
      const currentGroupsResponse = await cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
        })
      );

      const currentGroups = (currentGroupsResponse.Groups || []).map((g: { GroupName?: string }) => g.GroupName!);

      // Remove from groups not in the new list
      for (const group of currentGroups) {
        if (!request.groups.includes(group)) {
          await cognitoClient.send(
            new AdminRemoveUserFromGroupCommand({
              UserPoolId: USER_POOL_ID,
              Username: email,
              GroupName: group,
            })
          );
        }
      }

      // Add to new groups
      for (const group of request.groups) {
        if (!currentGroups.includes(group)) {
          await cognitoClient.send(
            new AdminAddUserToGroupCommand({
              UserPoolId: USER_POOL_ID,
              Username: email,
              GroupName: group,
            })
          );
        }
      }
    }

    // Enable/disable user
    if (request.enabled !== undefined) {
      if (request.enabled) {
        await cognitoClient.send(
          new AdminEnableUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
          })
        );
      } else {
        await cognitoClient.send(
          new AdminDisableUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
          })
        );
      }
    }

    // Return updated user
    const user = await this.getUserByEmail(email);
    if (!user) {
      throw new Error('Failed to update user');
    }

    return user;
  }

  /**
   * Delete (disable) a user
   */
  async deleteUser(email: string): Promise<void> {
    await cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
  }

  /**
   * Permanently delete a user
   */
  async permanentlyDeleteUser(email: string): Promise<void> {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
  }

  /**
   * Enable a disabled user
   */
  async enableUser(email: string): Promise<void> {
    await cognitoClient.send(
      new AdminEnableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
  }

  /**
   * Resend invitation email with new temporary password
   * This enables the user, sets a new temp password, and forces password change
   */
  async resendInvitation(email: string): Promise<void> {
    // First enable the user if disabled
    await cognitoClient.send(
      new AdminEnableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );

    // Generate a random temporary password
    const tempPassword = this.generateTempPassword();

    // Set a new temporary password (this triggers the welcome email)
    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: tempPassword,
        Permanent: false, // This forces password change on next login
      })
    );

    // Re-create the user to trigger the invitation email
    // Unfortunately AdminSetUserPassword doesn't send an email
    // So we need to use AdminCreateUser with RESEND
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      })
    );
  }

  /**
   * Generate a random temporary password meeting Cognito requirements
   */
  private generateTempPassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    const all = upper + lower + numbers + special;

    let password = '';
    // Ensure at least one of each required type
    password += upper[Math.floor(Math.random() * upper.length)];
    password += lower[Math.floor(Math.random() * lower.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];

    // Fill the rest randomly
    for (let i = 0; i < 8; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Map Cognito user to our User type
   */
  private async mapCognitoUser(cognitoUser: {
    Username?: string;
    Attributes?: { Name: string; Value?: string }[];
    UserStatus?: string;
    Enabled?: boolean;
    UserCreateDate?: Date;
    UserLastModifiedDate?: Date;
  }): Promise<User | null> {
    if (!cognitoUser.Username) return null;

    const attrs = new Map(
      (cognitoUser.Attributes || []).map((a) => [a.Name, a.Value])
    );

    // Get user groups
    const groupsResponse = await cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: cognitoUser.Username,
      })
    );

    const groups = (groupsResponse.Groups || []).map((g: { GroupName?: string }) => g.GroupName!);

    // Parse allowed accounts
    let allowedAccounts: string[] = [];
    const allowedAccountsStr = attrs.get('custom:allowedAccounts');
    if (allowedAccountsStr) {
      try {
        allowedAccounts = JSON.parse(allowedAccountsStr);
      } catch {
        // Ignore parse errors
      }
    }

    const givenName = attrs.get('given_name') || '';
    const familyName = attrs.get('family_name') || '';
    const name = `${givenName} ${familyName}`.trim() || attrs.get('email') || cognitoUser.Username || '';

    return {
      userId: attrs.get('sub') || '',
      email: attrs.get('email') || cognitoUser.Username,
      name,
      givenName,
      familyName,
      groups,
      allowedAccounts,
      defaultAccount: attrs.get('custom:defaultAccount'),
      status: cognitoUser.UserStatus as User['status'],
      enabled: cognitoUser.Enabled ?? true,
      createdAt: cognitoUser.UserCreateDate?.toISOString() || '',
      updatedAt: cognitoUser.UserLastModifiedDate?.toISOString() || '',
    };
  }

  /**
   * Map AdminGetUser response to User type
   */
  private async mapCognitoUserResponse(
    response: {
      Username?: string;
      UserAttributes?: { Name: string; Value?: string }[];
      UserStatus?: string;
      Enabled?: boolean;
      UserCreateDate?: Date;
      UserLastModifiedDate?: Date;
    },
    email: string
  ): Promise<User> {
    const attrs = new Map(
      (response.UserAttributes || []).map((a) => [a.Name, a.Value])
    );

    // Get user groups
    const groupsResponse = await cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );

    const groups = (groupsResponse.Groups || []).map((g: { GroupName?: string }) => g.GroupName!);

    // Parse allowed accounts
    let allowedAccounts: string[] = [];
    const allowedAccountsStr = attrs.get('custom:allowedAccounts');
    if (allowedAccountsStr) {
      try {
        allowedAccounts = JSON.parse(allowedAccountsStr);
      } catch {
        // Ignore parse errors
      }
    }

    const givenName = attrs.get('given_name') || '';
    const familyName = attrs.get('family_name') || '';
    const name = `${givenName} ${familyName}`.trim() || attrs.get('email') || email;

    return {
      userId: attrs.get('sub') || '',
      email: attrs.get('email') || email,
      name,
      givenName,
      familyName,
      groups,
      allowedAccounts,
      defaultAccount: attrs.get('custom:defaultAccount'),
      status: response.UserStatus as User['status'],
      enabled: response.Enabled ?? true,
      createdAt: response.UserCreateDate?.toISOString() || '',
      updatedAt: response.UserLastModifiedDate?.toISOString() || '',
    };
  }
}
