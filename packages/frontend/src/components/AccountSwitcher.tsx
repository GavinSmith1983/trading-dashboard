import { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';
import { useAccount } from '../context/AccountContext';

/**
 * AccountSwitcher - Dropdown to switch between accounts
 * Shows in the header for users with access to multiple accounts
 */
export default function AccountSwitcher() {
  const { currentAccount, allowedAccounts, switchAccount, isLoading } = useAccount();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Don't show if only one account
  if (allowedAccounts.length <= 1) {
    return currentAccount ? (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300">
        <Building2 className="h-4 w-4 text-gray-400" />
        <span>{currentAccount.name}</span>
      </div>
    ) : null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
          'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700',
          isLoading && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Building2 className="h-4 w-4 text-green-400" />
        <span className="max-w-[150px] truncate">
          {currentAccount?.name || 'Select Account'}
        </span>
        <ChevronDown
          className={clsx(
            'h-4 w-4 text-gray-400 transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 right-0 z-50 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden">
          <div className="py-1">
            {allowedAccounts.map((account) => (
              <button
                key={account.accountId}
                onClick={() => {
                  switchAccount(account.accountId);
                  setIsOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center justify-between px-4 py-2 text-sm transition-colors',
                  account.accountId === currentAccount?.accountId
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                )}
              >
                <span>{account.name}</span>
                {account.accountId === currentAccount?.accountId && (
                  <Check className="h-4 w-4 text-green-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
