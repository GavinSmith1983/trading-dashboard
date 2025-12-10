import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';

/**
 * Account type for frontend
 */
export interface Account {
  accountId: string;
  name: string;
  status: 'active' | 'suspended';
  settings?: {
    currency?: string;
    pricingMode?: 'single' | 'multi';
  };
}

interface AccountContextType {
  currentAccount: Account | null;
  allowedAccounts: Account[];
  isLoading: boolean;
  switchAccount: (accountId: string) => void;
  isSuperAdmin: boolean;
  currency: string;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

// Storage key for persisted account
const STORAGE_KEY = 'repricing-v2-current-account';

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, getIdToken } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [allowedAccounts, setAllowedAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Check if user is super-admin
  const isSuperAdmin = user?.groups?.includes('super-admin') || false;

  // Currency helpers
  const currency = currentAccount?.settings?.currency || 'GBP';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  const formatCurrency = useCallback((value: number) => {
    return `${currencySymbol}${value.toFixed(2)}`;
  }, [currencySymbol]);

  // Load accounts when user authenticates
  useEffect(() => {
    async function loadAccounts() {
      if (!isAuthenticated || !user) {
        setCurrentAccount(null);
        setAllowedAccounts([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const token = await getIdToken();
        if (!token) {
          setIsLoading(false);
          return;
        }

        // For super-admin, fetch all accounts from API
        // For regular users, parse allowedAccounts from token
        if (isSuperAdmin) {
          // Fetch all accounts from API
          const apiUrl = import.meta.env.VITE_API_URL || '';
          const response = await fetch(`${apiUrl}/accounts`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Map API response to frontend Account type, extracting settings
            const accounts = (data.items || [])
              .filter((a: any) => a.status === 'active')
              .map((a: any) => ({
                accountId: a.accountId,
                name: a.name,
                status: a.status,
                settings: {
                  currency: a.settings?.currency || 'GBP',
                  pricingMode: a.googleSheets?.columnMapping?.pricingMode || 'multi',
                },
              })) as Account[];
            setAllowedAccounts(accounts);

            // Restore previously selected account or use first one
            const savedAccountId = localStorage.getItem(STORAGE_KEY);
            const savedAccount = accounts.find(
              (a: Account) => a.accountId === savedAccountId
            );

            if (savedAccount) {
              setCurrentAccount(savedAccount);
            } else if (accounts.length > 0) {
              setCurrentAccount(accounts[0]);
              localStorage.setItem(STORAGE_KEY, accounts[0].accountId);
            }
          }
        } else {
          // Non-super-admin: fetch allowed accounts from API
          // The API now returns only accounts the user has access to
          const payload = JSON.parse(atob(token.split('.')[1]));
          const defaultAccountId = payload['custom:defaultAccount'];

          const apiUrl = import.meta.env.VITE_API_URL || '';
          const response = await fetch(`${apiUrl}/accounts`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Map API response to frontend Account type
            const accounts = (data.items || [])
              .filter((a: any) => a.status === 'active')
              .map((a: any) => ({
                accountId: a.accountId,
                name: a.name,
                status: a.status,
                settings: {
                  currency: a.settings?.currency || 'GBP',
                  pricingMode: a.settings?.pricingMode || a.googleSheets?.columnMapping?.pricingMode || 'multi',
                },
              })) as Account[];

            setAllowedAccounts(accounts);

            // Restore or use default account
            const savedAccountId = localStorage.getItem(STORAGE_KEY);
            let selectedAccount: Account | undefined;

            const accountIds = accounts.map((a) => a.accountId);
            if (savedAccountId && accountIds.includes(savedAccountId)) {
              selectedAccount = accounts.find((a) => a.accountId === savedAccountId);
            } else if (defaultAccountId && accountIds.includes(defaultAccountId)) {
              selectedAccount = accounts.find((a) => a.accountId === defaultAccountId);
            } else if (accounts.length > 0) {
              selectedAccount = accounts[0];
            }

            if (selectedAccount) {
              setCurrentAccount(selectedAccount);
              localStorage.setItem(STORAGE_KEY, selectedAccount.accountId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load accounts:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadAccounts();
  }, [isAuthenticated, user, isSuperAdmin, getIdToken]);

  // Switch to a different account
  const switchAccount = useCallback(
    (accountId: string) => {
      const account = allowedAccounts.find((a) => a.accountId === accountId);
      if (account) {
        setCurrentAccount(account);
        localStorage.setItem(STORAGE_KEY, accountId);
      }
    },
    [allowedAccounts]
  );

  return (
    <AccountContext.Provider
      value={{
        currentAccount,
        allowedAccounts,
        isLoading,
        switchAccount,
        isSuperAdmin,
        currency,
        currencySymbol,
        formatCurrency,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
