import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Truck, Plus, Trash2 } from 'lucide-react';
import { carriersApi } from '../api';
import type { CarrierCost } from '../api';
import { Card, CardHeader, CardContent } from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/Table';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

export default function DeliveryCosts() {
  const queryClient = useQueryClient();
  const [editingCarrier, setEditingCarrier] = useState<CarrierCost | null>(null);
  const [formData, setFormData] = useState<Partial<CarrierCost>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCarrier, setNewCarrier] = useState({ carrierName: '', costPerParcel: 0 });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['carriers'],
    queryFn: carriersApi.list,
  });

  const updateMutation = useMutation({
    mutationFn: ({ carrierId, data }: { carrierId: string; data: Partial<CarrierCost> }) =>
      carriersApi.update(carrierId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers'] });
      setEditingCarrier(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<CarrierCost, 'lastUpdated'>) => carriersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers'] });
      setShowAddForm(false);
      setNewCarrier({ carrierName: '', costPerParcel: 0 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (carrierId: string) => carriersApi.delete(carrierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carriers'] });
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

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading carriers..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load carriers'}
          onRetry={() => refetch()}
        />
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
        <h1 className="text-2xl font-bold text-gray-900">Delivery Costs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure delivery costs per carrier for margin calculations
        </p>
      </div>

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

      {/* Add New Carrier Button */}
      <div className="mb-6">
        <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
          <Plus className="h-4 w-4 mr-1" />
          Add Carrier
        </Button>
      </div>

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
                      <span className={carrier.costPerParcel === 0 ? 'text-red-500' : 'font-medium'}>
                        {carrier.costPerParcel > 0 ? `£${carrier.costPerParcel.toFixed(2)}` : 'Not set'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingCarrier?.carrierId === carrier.carrierId ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.isActive}
                          onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm">Active</span>
                      </label>
                    ) : (
                      <Badge variant={carrier.isActive ? 'success' : 'default'}>
                        {carrier.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    )}
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
    </div>
  );
}
