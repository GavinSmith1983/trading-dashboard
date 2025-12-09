/**
 * V2 Multi-Tenant Account Types
 */

/**
 * Account - Represents a tenant in the multi-tenant system
 */
export interface Account {
  accountId: string;                    // Unique identifier: "ku-bathrooms", "clearance", "valquest"
  name: string;                         // Display name: "KU Bathrooms"
  status: 'active' | 'suspended';       // Account status

  // ChannelEngine integration
  channelEngine: {
    apiKey: string;                     // ChannelEngine API key
    tenantId: string;                   // ChannelEngine tenant ID
  };

  // Google Sheets integration
  googleSheets: {
    spreadsheetId: string;              // Google Sheets spreadsheet ID
    credentialsSecretArn?: string;      // Optional: ARN of secret with service account JSON

    // Column mapping configuration
    columnMapping: {
      skuColumn: string;                // Column containing SKU (e.g., "A", "C")

      // Pricing mode: 'single' = one price for all channels, 'multi' = different price per channel
      pricingMode: 'single' | 'multi';

      // For single pricing mode - one column for all channels
      priceColumn?: string;             // e.g., "D" for Valquest

      // For multi-channel pricing mode (like KU Bathrooms)
      channelPriceColumns?: {
        bnq?: string;                   // B&Q pricing column
        amazon?: string;                // Amazon pricing column
        ebay?: string;                  // eBay pricing (also used for OnBuy, Debenhams)
        manomano?: string;              // ManoMano pricing column
        shopify?: string;               // Shopify pricing column
      };

      // Optional: data starts from this row (default: 2, assuming row 1 is headers)
      startRow?: number;

      // Optional: sheet name/tab (default: first sheet)
      sheetName?: string;
    };
  };

  // Account-level settings
  settings: {
    channelFees: Record<string, number>; // Channel fee percentages
    defaultMargin: number;               // Default target margin
    currency: string;                    // Currency code (GBP)
  };

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

/**
 * AccountContext - Extracted from JWT token for request handling
 */
export interface AccountContext {
  accountId: string;                    // Current account being accessed
  userId: string;                       // Cognito user sub
  userEmail: string;                    // User's email
  userName: string;                     // User's display name
  groups: string[];                     // Cognito groups: ["super-admin", "admin", "editor", "viewer"]
  isSuperAdmin: boolean;                // Is user in super-admin group
  isAdmin: boolean;                     // Is user in admin group (or super-admin)
  isEditor: boolean;                    // Is user in editor group (or admin/super-admin)
  allowedAccounts: string[];            // List of account IDs user can access
}

/**
 * CreateAccountRequest - Request to create a new account
 */
export interface CreateAccountRequest {
  accountId: string;
  name: string;
  channelEngine: {
    apiKey: string;
    tenantId: string;
  };
  googleSheets: {
    spreadsheetId: string;
    credentialsSecretArn?: string;
    columnMapping?: {
      skuColumn: string;
      pricingMode: 'single' | 'multi';
      priceColumn?: string;
      channelPriceColumns?: {
        bnq?: string;
        amazon?: string;
        ebay?: string;
        manomano?: string;
        shopify?: string;
      };
      startRow?: number;
      sheetName?: string;
    };
  };
  settings?: {
    channelFees?: Record<string, number>;
    defaultMargin?: number;
    currency?: string;
  };
}

/**
 * UpdateAccountRequest - Request to update an account
 */
export interface UpdateAccountRequest {
  name?: string;
  status?: 'active' | 'suspended';
  channelEngine?: {
    apiKey?: string;
    tenantId?: string;
  };
  googleSheets?: {
    spreadsheetId?: string;
  };
  settings?: {
    channelFees?: Record<string, number>;
    defaultMargin?: number;
    currency?: string;
  };
}

/**
 * User - Cognito user with account assignments
 */
export interface User {
  userId: string;                       // Cognito sub
  email: string;
  name: string;                         // Full name (givenName + familyName)
  givenName: string;
  familyName: string;
  groups: string[];                     // Cognito groups
  allowedAccounts: string[];            // Account IDs user can access
  defaultAccount?: string;              // Default account for user
  status: 'CONFIRMED' | 'FORCE_CHANGE_PASSWORD' | 'UNCONFIRMED';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * CreateUserRequest - Request to create a new user
 */
export interface CreateUserRequest {
  email: string;
  givenName: string;
  familyName: string;
  groups: string[];                     // Groups to add user to
  allowedAccounts: string[];            // Account IDs user can access
  defaultAccount?: string;              // Default account
  temporaryPassword?: string;           // Optional temporary password
}

/**
 * UpdateUserRequest - Request to update a user
 */
export interface UpdateUserRequest {
  givenName?: string;
  familyName?: string;
  groups?: string[];                    // Groups to set (replaces existing)
  allowedAccounts?: string[];           // Account IDs to set (replaces existing)
  defaultAccount?: string;
  enabled?: boolean;
}
