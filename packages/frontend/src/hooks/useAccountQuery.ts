import { useAccount } from '../context/AccountContext';

/**
 * Hook to get the current account ID for use in React Query keys.
 * This ensures queries are refetched when the account changes.
 *
 * Usage:
 * const { accountId } = useAccountQuery();
 * const { data } = useQuery({
 *   queryKey: ['sales', accountId, selectedTimeRange],
 *   queryFn: () => analyticsApi.sales(selectedTimeRange),
 * });
 */
export function useAccountQuery() {
  const { currentAccount } = useAccount();
  return {
    accountId: currentAccount?.accountId || 'no-account',
    currentAccount,
  };
}
