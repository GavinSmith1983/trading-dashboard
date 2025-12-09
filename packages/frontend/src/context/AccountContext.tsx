import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';

/**
 * Account type for frontend
 */
export interface Account {
  accountId: string;
  name: string;
  status: 'active' | 'suspended';
}

interface AccountContextType {
  currentAccount: Account | null;
  allowedAccounts: Account[];
  isLoading: boolean;
  switchAccount: (accountId: string) => void;
  isSuperAdmin: boolean;
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
            const accounts = (data.items || []).filter(
              (a: Account) => a.status === 'active'
            );
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
          // Parse allowed accounts from JWT (custom:allowedAccounts)
          // The token payload contains this as a JSON string
          const payload = JSON.parse(atob(token.split('.')[1]));
          const allowedAccountIds: string[] = JSON.parse(
            payload['custom:allowedAccounts'] || '[]'
          );
          const defaultAccountId = payload['custom:defaultAccount'];

          // For non-super-admin, we need to fetch account details
          // In a real app, you might have a separate endpoint for this
          // For now, create simple account objects from IDs
          const accounts: Account[] = allowedAccountIds.map((id) => ({
            accountId: id,
            name: formatAccountName(id),
            status: 'active' as const,
          }));

          setAllowedAccounts(accounts);

          // Restore or use default account
          const savedAccountId = localStorage.getItem(STORAGE_KEY);
          let selectedAccount: Account | undefined;

          if (savedAccountId && allowedAccountIds.includes(savedAccountId)) {
            selectedAccount = accounts.find((a) => a.accountId === savedAccountId);
          } else if (defaultAccountId && allowedAccountIds.includes(defaultAccountId)) {
            selectedAccount = accounts.find((a) => a.accountId === defaultAccountId);
          } else if (accounts.length > 0) {
            selectedAccount = accounts[0];
          }

          if (selectedAccount) {
            setCurrentAccount(selectedAccount);
            localStorage.setItem(STORAGE_KEY, selectedAccount.accountId);
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

/**
 * Format account ID to display name
 */
function formatAccountName(accountId: string): string {
  // Convert kebab-case to Title Case
  return accountId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
