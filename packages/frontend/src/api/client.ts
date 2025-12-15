import {
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Storage key for current account (shared with AccountContext)
const ACCOUNT_STORAGE_KEY = 'repricing-v2-current-account';

/**
 * Get the current account ID from localStorage
 * This allows the API client to include the X-Account-Id header
 */
function getCurrentAccountId(): string | null {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY);
}

// Cognito configuration
const COGNITO_CONFIG = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'eu-west-2_t4tJsxt3z',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '7c3s7gtdskn3nhpbivmsapgk74',
};

const userPool = new CognitoUserPool(COGNITO_CONFIG);

export async function getIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      resolve(null);
      return;
    }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  overrideAccountId?: string
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  // Get the auth token
  const token = await getIdToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add Authorization header if we have a token
  if (token) {
    (headers as Record<string, string>)['Authorization'] = token;
  }

  // Add X-Account-Id header for V2 multi-tenant API
  const accountId = overrideAccountId || getCurrentAccountId();
  if (accountId) {
    (headers as Record<string, string>)['X-Account-Id'] = accountId;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // Handle 401 Unauthorized by redirecting to login
    if (response.status === 401) {
      // Clear session and redirect to login
      const cognitoUser = userPool.getCurrentUser();
      if (cognitoUser) {
        cognitoUser.signOut();
      }
      window.location.href = '/login';
      throw new Error('Session expired. Please log in again.');
    }

    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),

  // Methods with account override for admin operations
  getWithAccount: <T>(endpoint: string, accountId: string) =>
    request<T>(endpoint, {}, accountId),

  postWithAccount: <T>(endpoint: string, data: unknown, accountId: string) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }, accountId),

  putWithAccount: <T>(endpoint: string, data: unknown, accountId: string) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }, accountId),

  deleteWithAccount: <T>(endpoint: string, accountId: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }, accountId),
};
