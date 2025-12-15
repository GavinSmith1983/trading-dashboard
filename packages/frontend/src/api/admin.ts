import { api } from './client';

// Accounts
export interface GoogleSheetsColumnMapping {
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
}

export interface Account {
  accountId: string;
  name: string;
  status: 'active' | 'suspended';
  channelEngine?: {
    apiKey: string;
    tenantId: string;
  };
  googleSheets?: {
    spreadsheetId: string;
    columnMapping?: GoogleSheetsColumnMapping;
  };
  settings: {
    channelFees: Record<string, number>;
    defaultMargin: number;
    currency: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const accountsApi = {
  list: () => api.get<{ items: Account[]; count: number }>('/accounts'),

  get: (accountId: string) => api.get<Account>(`/accounts/${encodeURIComponent(accountId)}`),

  create: (data: Omit<Account, 'createdAt' | 'updatedAt'>) =>
    api.post<Account>('/accounts', data),

  update: (accountId: string, data: Partial<Account>) =>
    api.put<Account>(`/accounts/${encodeURIComponent(accountId)}`, data),

  delete: (accountId: string) =>
    api.delete(`/accounts/${encodeURIComponent(accountId)}`),
};

// Users
export interface User {
  userId: string;
  email: string;
  name: string;
  groups: string[];
  allowedAccounts: string[];
  defaultAccount?: string;
  enabled: boolean;
  status: 'CONFIRMED' | 'FORCE_CHANGE_PASSWORD' | 'RESET_REQUIRED' | 'UNCONFIRMED';
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  email: string;
  givenName: string;
  familyName: string;
  groups: string[];
  allowedAccounts: string[];
  defaultAccount?: string;
  temporaryPassword?: string;
}

export interface UpdateUserRequest {
  name?: string;
  groups?: string[];
  allowedAccounts?: string[];
  defaultAccount?: string;
  enabled?: boolean;
}

export const usersApi = {
  list: () => api.get<{ items: User[]; count: number }>('/users'),

  get: (userId: string) => api.get<User>(`/users/${encodeURIComponent(userId)}`),

  create: (data: CreateUserRequest) => api.post<User>('/users', data),

  update: (userId: string, data: UpdateUserRequest) =>
    api.put<User>(`/users/${encodeURIComponent(userId)}`, data),

  delete: (userId: string) =>
    api.delete(`/users/${encodeURIComponent(userId)}`),

  enable: (userId: string) =>
    api.post<{ message: string }>(`/users/${encodeURIComponent(userId)}/enable`),

  resendInvitation: (userId: string) =>
    api.post<{ message: string }>(`/users/${encodeURIComponent(userId)}/resend-invitation`),

  resetPassword: (userId: string) =>
    api.post<{ message: string }>(`/users/${encodeURIComponent(userId)}/reset-password`),
};
