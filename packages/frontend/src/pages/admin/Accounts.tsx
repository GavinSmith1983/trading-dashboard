import { useState, useEffect } from 'react';
import { Building2, Plus, Edit2, Trash2, Check, X, Key, Table } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { accountsApi, Account, GoogleSheetsColumnMapping } from '../../api';
import Loading from '../../components/Loading';
import ErrorMessage from '../../components/ErrorMessage';
import Button from '../../components/Button';

interface AccountFormData {
  accountId: string;
  name: string;
  channelEngineApiKey: string;
  channelEngineTenantId: string;
  googleSheetsId: string;
  defaultMargin: number;
  // Column mapping
  skuColumn: string;
  pricingMode: 'single' | 'multi';
  priceColumn: string;
  bnqColumn: string;
  amazonColumn: string;
  ebayColumn: string;
  manomanoColumn: string;
  shopifyColumn: string;
  startRow: number;
  sheetName: string;
}

const defaultFormData: AccountFormData = {
  accountId: '',
  name: '',
  channelEngineApiKey: '',
  channelEngineTenantId: '',
  googleSheetsId: '',
  defaultMargin: 25,
  skuColumn: 'A',
  pricingMode: 'single',
  priceColumn: 'B',
  bnqColumn: 'F',
  amazonColumn: 'G',
  ebayColumn: 'H',
  manomanoColumn: 'I',
  shopifyColumn: 'J',
  startRow: 2,
  sheetName: '',
};

/**
 * Admin page for managing accounts
 * Super-admin only
 */
export default function AccountsAdmin() {
  const { isAdmin } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState<AccountFormData>(defaultFormData);

  // Load accounts
  useEffect(() => {
    async function loadAccounts() {
      try {
        const response = await accountsApi.list();
        setAccounts(response.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load accounts');
      } finally {
        setIsLoading(false);
      }
    }

    loadAccounts();
  }, []);

  // Build column mapping from form data
  const buildColumnMapping = (): GoogleSheetsColumnMapping => {
    const mapping: GoogleSheetsColumnMapping = {
      skuColumn: formData.skuColumn,
      pricingMode: formData.pricingMode,
      startRow: formData.startRow,
    };

    if (formData.sheetName) {
      mapping.sheetName = formData.sheetName;
    }

    if (formData.pricingMode === 'single') {
      mapping.priceColumn = formData.priceColumn;
    } else {
      mapping.channelPriceColumns = {
        bnq: formData.bnqColumn || undefined,
        amazon: formData.amazonColumn || undefined,
        ebay: formData.ebayColumn || undefined,
        manomano: formData.manomanoColumn || undefined,
        shopify: formData.shopifyColumn || undefined,
      };
    }

    return mapping;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const columnMapping = buildColumnMapping();

      if (editingAccount) {
        // Update existing account
        await accountsApi.update(editingAccount.accountId, {
          name: formData.name,
          channelEngine: {
            apiKey: formData.channelEngineApiKey,
            tenantId: formData.channelEngineTenantId,
          },
          googleSheets: {
            spreadsheetId: formData.googleSheetsId,
            columnMapping,
          },
          settings: {
            ...editingAccount.settings,
            defaultMargin: formData.defaultMargin / 100,
          },
        });
      } else {
        // Create new account
        await accountsApi.create({
          accountId: formData.accountId.toLowerCase().replace(/\s+/g, '-'),
          name: formData.name,
          status: 'active',
          channelEngine: {
            apiKey: formData.channelEngineApiKey,
            tenantId: formData.channelEngineTenantId,
          },
          googleSheets: {
            spreadsheetId: formData.googleSheetsId,
            columnMapping,
          },
          settings: {
            channelFees: {},
            defaultMargin: formData.defaultMargin / 100,
            currency: 'GBP',
          },
        });
      }

      // Reload accounts
      const response = await accountsApi.list();
      setAccounts(response.items || []);

      // Reset form
      setShowCreateForm(false);
      setEditingAccount(null);
      setFormData(defaultFormData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    }
  };

  // Handle delete (suspend)
  const handleDelete = async (accountId: string) => {
    if (!confirm('Are you sure you want to suspend this account?')) return;

    try {
      await accountsApi.delete(accountId);
      const response = await accountsApi.list();
      setAccounts(response.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to suspend account');
    }
  };

  // Start editing
  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    const mapping = account.googleSheets?.columnMapping;
    setFormData({
      accountId: account.accountId,
      name: account.name,
      channelEngineApiKey: account.channelEngine?.apiKey || '',
      channelEngineTenantId: account.channelEngine?.tenantId || '',
      googleSheetsId: account.googleSheets?.spreadsheetId || '',
      defaultMargin: (account.settings.defaultMargin || 0.25) * 100,
      // Column mapping
      skuColumn: mapping?.skuColumn || 'A',
      pricingMode: mapping?.pricingMode || 'single',
      priceColumn: mapping?.priceColumn || 'B',
      bnqColumn: mapping?.channelPriceColumns?.bnq || 'F',
      amazonColumn: mapping?.channelPriceColumns?.amazon || 'G',
      ebayColumn: mapping?.channelPriceColumns?.ebay || 'H',
      manomanoColumn: mapping?.channelPriceColumns?.manomano || 'I',
      shopifyColumn: mapping?.channelPriceColumns?.shopify || 'J',
      startRow: mapping?.startRow || 2,
      sheetName: mapping?.sheetName || '',
    });
    setShowCreateForm(true);
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <ErrorMessage message="Access denied. Super-admin role required." />
      </div>
    );
  }

  if (isLoading) {
    return <Loading />;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account Management</h1>
          <p className="text-gray-600 mt-1">Manage trading accounts and their integrations</p>
        </div>
        <Button
          onClick={() => {
            setEditingAccount(null);
            setFormData(defaultFormData);
            setShowCreateForm(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      {error && <ErrorMessage message={error} className="mb-4" />}

      {/* Account Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 my-8">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editingAccount ? 'Edit Account' : 'Create Account'}
              </h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {!editingAccount && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Account ID
                  </label>
                  <input
                    type="text"
                    value={formData.accountId}
                    onChange={(e) =>
                      setFormData({ ...formData, accountId: e.target.value })
                    }
                    placeholder="e.g., ku-bathrooms"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Lowercase with hyphens, no spaces
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., KU Bathrooms"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  ChannelEngine Integration
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={formData.channelEngineApiKey}
                      onChange={(e) =>
                        setFormData({ ...formData, channelEngineApiKey: e.target.value })
                      }
                      placeholder="Enter ChannelEngine API key"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tenant ID
                    </label>
                    <input
                      type="text"
                      value={formData.channelEngineTenantId}
                      onChange={(e) =>
                        setFormData({ ...formData, channelEngineTenantId: e.target.value })
                      }
                      placeholder="Enter ChannelEngine tenant ID"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <Table className="h-4 w-4" />
                  Google Sheets Integration
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Spreadsheet ID
                    </label>
                    <input
                      type="text"
                      value={formData.googleSheetsId}
                      onChange={(e) =>
                        setFormData({ ...formData, googleSheetsId: e.target.value })
                      }
                      placeholder="Enter Google Sheets spreadsheet ID"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sheet Name (optional)
                    </label>
                    <input
                      type="text"
                      value={formData.sheetName}
                      onChange={(e) =>
                        setFormData({ ...formData, sheetName: e.target.value })
                      }
                      placeholder="Leave empty for first sheet"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        SKU Column
                      </label>
                      <input
                        type="text"
                        value={formData.skuColumn}
                        onChange={(e) =>
                          setFormData({ ...formData, skuColumn: e.target.value.toUpperCase() })
                        }
                        placeholder="e.g., A or C"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        maxLength={2}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Data Start Row
                      </label>
                      <input
                        type="number"
                        value={formData.startRow}
                        onChange={(e) =>
                          setFormData({ ...formData, startRow: parseInt(e.target.value) || 2 })
                        }
                        min="1"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pricing Mode
                    </label>
                    <select
                      value={formData.pricingMode}
                      onChange={(e) =>
                        setFormData({ ...formData, pricingMode: e.target.value as 'single' | 'multi' })
                      }
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="single">Single Price (same price for all channels)</option>
                      <option value="multi">Multi-Channel (different price per channel)</option>
                    </select>
                  </div>

                  {formData.pricingMode === 'single' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Price Column
                      </label>
                      <input
                        type="text"
                        value={formData.priceColumn}
                        onChange={(e) =>
                          setFormData({ ...formData, priceColumn: e.target.value.toUpperCase() })
                        }
                        placeholder="e.g., D"
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        maxLength={2}
                      />
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-sm text-gray-600 mb-3">Channel Price Columns</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            B&Q
                          </label>
                          <input
                            type="text"
                            value={formData.bnqColumn}
                            onChange={(e) =>
                              setFormData({ ...formData, bnqColumn: e.target.value.toUpperCase() })
                            }
                            placeholder="e.g., F"
                            className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                            maxLength={2}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Amazon
                          </label>
                          <input
                            type="text"
                            value={formData.amazonColumn}
                            onChange={(e) =>
                              setFormData({ ...formData, amazonColumn: e.target.value.toUpperCase() })
                            }
                            placeholder="e.g., G"
                            className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                            maxLength={2}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            eBay/OnBuy/Debenhams
                          </label>
                          <input
                            type="text"
                            value={formData.ebayColumn}
                            onChange={(e) =>
                              setFormData({ ...formData, ebayColumn: e.target.value.toUpperCase() })
                            }
                            placeholder="e.g., H"
                            className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                            maxLength={2}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            ManoMano
                          </label>
                          <input
                            type="text"
                            value={formData.manomanoColumn}
                            onChange={(e) =>
                              setFormData({ ...formData, manomanoColumn: e.target.value.toUpperCase() })
                            }
                            placeholder="e.g., I"
                            className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                            maxLength={2}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Shopify
                          </label>
                          <input
                            type="text"
                            value={formData.shopifyColumn}
                            onChange={(e) =>
                              setFormData({ ...formData, shopifyColumn: e.target.value.toUpperCase() })
                            }
                            placeholder="e.g., J"
                            className="w-full px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                            maxLength={2}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-gray-900 mb-3">Settings</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Margin (%)
                  </label>
                  <input
                    type="number"
                    value={formData.defaultMargin}
                    onChange={(e) =>
                      setFormData({ ...formData, defaultMargin: parseFloat(e.target.value) })
                    }
                    min="0"
                    max="100"
                    step="1"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingAccount ? 'Save Changes' : 'Create Account'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accounts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Account
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ChannelEngine
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Google Sheets
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {accounts.map((account) => (
              <tr key={account.accountId} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Building2 className="h-5 w-5 text-gray-400 mr-3" />
                    <div>
                      <div className="font-medium text-gray-900">{account.name}</div>
                      <div className="text-sm text-gray-500">{account.accountId}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      account.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {account.status === 'active' ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    {account.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {account.channelEngine?.tenantId ? (
                    <span className="text-green-600">Connected</span>
                  ) : (
                    <span className="text-gray-400">Not configured</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {account.googleSheets?.spreadsheetId ? (
                    <div>
                      <span className="text-green-600">Connected</span>
                      {account.googleSheets?.columnMapping && (
                        <div className="text-xs text-gray-400">
                          SKU: {account.googleSheets.columnMapping.skuColumn} |{' '}
                          {account.googleSheets.columnMapping.pricingMode === 'single'
                            ? `Price: ${account.googleSheets.columnMapping.priceColumn}`
                            : 'Multi-channel'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">Not configured</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(account.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleEdit(account)}
                    className="text-blue-600 hover:text-blue-900 mr-4"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  {account.status === 'active' && (
                    <button
                      onClick={() => handleDelete(account.accountId)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {accounts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No accounts found. Click "Add Account" to create one.
          </div>
        )}
      </div>
    </div>
  );
}
