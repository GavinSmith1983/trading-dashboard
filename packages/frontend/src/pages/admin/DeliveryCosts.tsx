import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Truck, Plus, Trash2, RefreshCw } from 'lucide-react';
import { carriersApi, accountsApi } from '../../api';
import { useAuth } from '../../context/AuthContext';
import type { CarrierCost, RecalculateResult, Account } from '../../api';
import { Card, CardHeader, CardContent } from '../../components/Card';
import Button from '../../components/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/Table';
import Loading from '../../components/Loading';
import ErrorMessage from '../../components/ErrorMessage';

/**
 * Admin page for managing delivery costs across all accounts
 * Super-admin only
 */
export default function DeliveryCostsAdmin() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [editingCarrier, setEditingCarrier] = useState<CarrierCost | null>(null);
  const [formData, setFormData] = useState<Partial<CarrierCost>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCarrier, setNewCarrier] = useState({ carrierName: '', costPerParcel: 0 });
  const [recalculateResult, setRecalculateResult] = useState<RecalculateResult | null>(null);

  // Load accounts
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    enabled: isAdmin,
  });

  const accounts = accountsData?.items || [];

  // Auto-select first account on load
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].accountId);
    }
  }, [accounts, selectedAccountId]);

  // Get selected account details
  const selectedAccount = accounts.find((a: Account) => a.accountId === selectedAccountId);
  const currencySymbol = selectedAccount?.settings.currency === 'GBP' ? '£' : '$';

  // Load carriers for selected account
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['carriers', selectedAccountId],
    queryFn: () => carriersApi.listForAccount(selectedAccountId),
    enabled: !!selectedAccountId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ carrierId, data }: { carrierId: string; data: Partial<CarrierCost> }) =>
      carriersApi.updateForAccount(carrierId, data, selectedAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers', selectedAccountId] });
      setEditingCarrier(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<CarrierCost, 'lastUpdated'>) =>
      carriersApi.createForAccount(data, selectedAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers', selectedAccountId] });
      setShowAddForm(false);
      setNewCarrier({ carrierName: '', costPerParcel: 0 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (carrierId: string) =>
      carriersApi.deleteForAccount(carrierId, selectedAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers', selectedAccountId] });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: () => carriersApi.recalculateForAccount(selectedAccountId),
    onSuccess: (result) => {
      setRecalculateResult(result);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const handleEdit = (carrier: CarrierCost) => {
    setEditingCarrier(carrier);
    setFormData({
      carrierName: carrier.carrierName,
      costPerParcel: carrier.costPerParcel,
      isActive: carrier.isActive,
    });
  };

  const handleSave = () => {
    if (editingCarrier) {
      updateMutation.mutate({
        carrierId: editingCarrier.carrierId,
        data: formData,
      });
    }
  };

  const handleCreate = () => {
    createMutation.mutate({
      carrierId: newCarrier.carrierName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      carrierName: newCarrier.carrierName,
      costPerParcel: newCarrier.costPerParcel,
      isActive: true,
    });
  };

  const handleDelete = (carrierId: string, carrierName: string) => {
    if (confirm(`Are you sure you want to delete ${carrierName}?`)) {
      deleteMutation.mutate(carrierId);
    }
  };

  // Handle status change (inline dropdown)
  const handleStatusChange = (carrier: CarrierCost, newIsActive: boolean) => {
    updateMutation.mutate({
      carrierId: carrier.carrierId,
      data: { isActive: newIsActive },
    });
  };

  // Handle inline cost editing
  const handleCostChange = (carrier: CarrierCost, newCost: number) => {
    updateMutation.mutate({
      carrierId: carrier.carrierId,
      data: { costPerParcel: newCost },
    });
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <ErrorMessage message="Access denied. Super-admin role required." />
      </div>
    );
  }

  if (accountsLoading) {
    return <Loading />;
  }

  if (accounts.length === 0) {
    return (
      <div className="p-8">
        <ErrorMessage message="No accounts found. Please create an account first." />
      </div>
    );
  }

  const carriers = data?.items || [];
  const totalCarriers = carriers.length;
  const activeCarriers = carriers.filter((c) => c.isActive).length;
  const carriersWithCosts = carriers.filter((c) => c.costPerParcel > 0).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Delivery Costs - Admin</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure delivery costs per carrier for margin calculations across all accounts
        </p>
      </div>

      {/* Account Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Account
        </label>
        <select
          value={selectedAccountId}
          onChange={(e) => {
            setSelectedAccountId(e.target.value);
            setEditingCarrier(null);
            setShowAddForm(false);
            setRecalculateResult(null);
          }}
          className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          {accounts.map((account: Account) => (
            <option key={account.accountId} value={account.accountId}>
              {account.name} ({account.accountId})
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-8">
          <Loading message="Loading carriers..." />
        </div>
      ) : error ? (
        <div className="p-8">
          <ErrorMessage
            message={error instanceof Error ? error.message : 'Failed to load carriers'}
            onRetry={() => refetch()}
          />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Truck className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">{totalCarriers}</p>
                    <p className="text-sm text-gray-500">Total Carriers</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Truck className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">{activeCarriers}</p>
                    <p className="text-sm text-gray-500">Active Carriers</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <Truck className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">{totalCarriers - carriersWithCosts}</p>
                    <p className="text-sm text-gray-500">Missing Costs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="mb-6 flex gap-3">
            <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
              <Plus className="h-4 w-4 mr-1" />
              Add Carrier
            </Button>
            <Button
              variant="secondary"
              onClick={() => recalculateMutation.mutate()}
              disabled={recalculateMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${recalculateMutation.isPending ? 'animate-spin' : ''}`} />
              {recalculateMutation.isPending ? 'Recalculating...' : 'Recalculate All Delivery Costs'}
            </Button>
          </div>

          {/* Recalculation Results */}
          {recalculateResult && (
            <Card className="mb-6 border-green-200 bg-green-50">
              <CardHeader className="flex flex-row items-center justify-between">
                <h3 className="font-semibold text-green-900">Recalculation Complete</h3>
                <button
                  onClick={() => setRecalculateResult(null)}
                  className="text-green-600 hover:text-green-800 text-sm"
                >
                  Dismiss
                </button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-green-700">Orders Analyzed</p>
                    <p className="text-lg font-semibold text-green-900">{recalculateResult.ordersProcessed}</p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">SKUs Analyzed</p>
                    <p className="text-lg font-semibold text-green-900">{recalculateResult.skusAnalyzed}</p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">Products Updated</p>
                    <p className="text-lg font-semibold text-green-900">{recalculateResult.productsUpdated}</p>
                  </div>
                  <div>
                    <p className="text-sm text-green-700">Unchanged</p>
                    <p className="text-lg font-semibold text-green-900">{recalculateResult.productsUnchanged}</p>
                  </div>
                </div>
                {recalculateResult.updatedSkus && recalculateResult.updatedSkus.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-green-800 mb-2">Updated Products:</p>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-green-700">
                            <th className="pb-1">SKU</th>
                            <th className="pb-1">Old Cost</th>
                            <th className="pb-1">New Cost</th>
                            <th className="pb-1">Carrier</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recalculateResult.updatedSkus.map((item) => (
                            <tr key={item.sku} className="border-t border-green-200">
                              <td className="py-1 font-mono text-xs">{item.sku}</td>
                              <td className="py-1">{currencySymbol}{item.oldCost.toFixed(2)}</td>
                              <td className="py-1 font-medium">{currencySymbol}{item.newCost.toFixed(2)}</td>
                              <td className="py-1">{item.carrier}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Add New Carrier Form */}
          {showAddForm && (
            <Card className="mb-6">
              <CardHeader>
                <h3 className="font-semibold text-gray-900">Add New Carrier</h3>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Carrier Name
                    </label>
                    <input
                      type="text"
                      value={newCarrier.carrierName}
                      onChange={(e) => setNewCarrier({ ...newCarrier, carrierName: e.target.value })}
                      placeholder="e.g., DPD, DX, HomeFleet"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="w-40">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Cost per Parcel
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newCarrier.costPerParcel}
                      onChange={(e) =>
                        setNewCarrier({ ...newCarrier, costPerParcel: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleCreate} disabled={!newCarrier.carrierName || createMutation.isPending}>
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Carriers Table */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Carrier</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Cost per Parcel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carriers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-gray-500">
                      No carriers configured. Upload a delivery report to auto-discover carriers.
                    </TableCell>
                  </TableRow>
                ) : (
                  carriers.map((carrier) => (
                    <TableRow key={carrier.carrierId}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gray-100 rounded-lg">
                            <Truck className="h-4 w-4 text-gray-600" />
                          </div>
                          {editingCarrier?.carrierId === carrier.carrierId ? (
                            <input
                              type="text"
                              value={formData.carrierName || ''}
                              onChange={(e) => setFormData({ ...formData, carrierName: e.target.value })}
                              className="border border-gray-300 rounded px-2 py-1 text-sm w-40"
                            />
                          ) : (
                            <span className="font-medium text-gray-900">{carrier.carrierName}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded">{carrier.carrierId}</code>
                      </TableCell>
                      <TableCell>
                        {editingCarrier?.carrierId === carrier.carrierId ? (
                          <input
                            type="number"
                            step="0.01"
                            value={formData.costPerParcel || 0}
                            onChange={(e) =>
                              setFormData({ ...formData, costPerParcel: parseFloat(e.target.value) || 0 })
                            }
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-24"
                          />
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            value={carrier.costPerParcel}
                            onChange={(e) => handleCostChange(carrier, parseFloat(e.target.value) || 0)}
                            onBlur={(e) => {
                              const newValue = parseFloat(e.target.value) || 0;
                              if (newValue !== carrier.costPerParcel) {
                                handleCostChange(carrier, newValue);
                              }
                            }}
                            disabled={updateMutation.isPending}
                            className={`border border-gray-300 rounded px-2 py-1 text-sm w-24 ${
                              carrier.costPerParcel === 0 ? 'border-red-300 text-red-500' : ''
                            }`}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <select
                          value={carrier.isActive ? 'active' : 'inactive'}
                          onChange={(e) => {
                            const newIsActive = e.target.value === 'active';
                            handleStatusChange(carrier, newIsActive);
                          }}
                          disabled={updateMutation.isPending}
                          className={`text-sm border rounded-lg px-2 py-1 cursor-pointer ${
                            carrier.isActive
                              ? 'bg-green-50 border-green-300 text-green-700'
                              : 'bg-gray-50 border-gray-300 text-gray-500'
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(carrier.lastUpdated).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {editingCarrier?.carrierId === carrier.carrierId ? (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditingCarrier(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" variant="secondary" onClick={() => handleEdit(carrier)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => handleDelete(carrier.carrierId, carrier.carrierName)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Info Box */}
          <Card className="mt-6">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Truck className="h-5 w-5 text-blue-500" />
                </div>
                <div className="text-sm text-gray-600">
                  <p className="font-medium text-gray-900 mb-1">How delivery costs work</p>
                  <p>
                    Upload a Vector Summary report on the Import page to auto-discover carriers used for
                    your orders. The system will create carrier entries automatically. Set the cost per
                    parcel for each carrier, and the predominant carrier will be used to calculate
                    delivery costs for each product.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
