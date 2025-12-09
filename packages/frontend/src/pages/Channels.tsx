import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Store } from 'lucide-react';
import { channelsApi } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import type { Channel } from '../types';
import { Card, CardHeader, CardContent } from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

export default function Channels() {
  const queryClient = useQueryClient();
  const { accountId } = useAccountQuery();
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [formData, setFormData] = useState<Partial<Channel>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['channels', accountId],
    queryFn: channelsApi.list,
  });

  const updateMutation = useMutation({
    mutationFn: ({ channelId, data }: { channelId: string; data: Partial<Channel> }) =>
      channelsApi.update(channelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      setEditingChannel(null);
    },
  });

  const handleEdit = (channel: Channel) => {
    setEditingChannel(channel);
    setFormData({
      commissionPercent: channel.commissionPercent,
      fixedFee: channel.fixedFee,
      paymentProcessingPercent: channel.paymentProcessingPercent,
      defaultAcosPercent: channel.defaultAcosPercent,
      vatPercent: channel.vatPercent,
      isActive: channel.isActive,
    });
  };

  const handleSave = () => {
    if (editingChannel) {
      updateMutation.mutate({
        channelId: editingChannel.channelId,
        data: formData,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading channels..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load channels'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const channels = data?.items || [];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Sales Channels</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure fees and settings for each sales channel
        </p>
      </div>

      {/* Channels Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {channels.map((channel) => (
          <Card key={channel.channelId}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Store className="h-5 w-5 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{channel.name}</h3>
                    <p className="text-sm text-gray-500">{channel.channelId}</p>
                  </div>
                </div>
                <Badge variant={channel.isActive ? 'success' : 'default'}>
                  {channel.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {editingChannel?.channelId === channel.channelId ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Commission %
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.commissionPercent || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, commissionPercent: parseFloat(e.target.value) })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fixed Fee (£)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.fixedFee || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, fixedFee: parseFloat(e.target.value) })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Payment Processing %
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.paymentProcessingPercent || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          paymentProcessingPercent: parseFloat(e.target.value),
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Default ACOS %
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.defaultAcosPercent || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, defaultAcosPercent: parseFloat(e.target.value) })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">VAT %</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.vatPercent || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, vatPercent: parseFloat(e.target.value) })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`active-${channel.channelId}`}
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <label
                      htmlFor={`active-${channel.channelId}`}
                      className="text-sm text-gray-700"
                    >
                      Channel Active
                    </label>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleSave} disabled={updateMutation.isPending}>
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setEditingChannel(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Commission</span>
                    <span className="font-medium">{channel.commissionPercent}%</span>
                  </div>
                  {channel.fixedFee ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Fixed Fee</span>
                      <span className="font-medium">£{channel.fixedFee.toFixed(2)}</span>
                    </div>
                  ) : null}
                  {channel.paymentProcessingPercent ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Payment Processing</span>
                      <span className="font-medium">{channel.paymentProcessingPercent}%</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Default ACOS</span>
                    <span className="font-medium">{channel.defaultAcosPercent || 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">VAT</span>
                    <span className="font-medium">{channel.vatPercent}%</span>
                  </div>
                  <div className="pt-3 border-t border-gray-200">
                    <p className="text-sm text-gray-500">
                      Total Fees: ~
                      <span className="font-medium text-gray-900">
                        {(
                          channel.commissionPercent +
                          (channel.paymentProcessingPercent || 0) +
                          (channel.defaultAcosPercent || 0)
                        ).toFixed(1)}
                        %
                      </span>
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full mt-4"
                    onClick={() => handleEdit(channel)}
                  >
                    Edit Channel
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {channels.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Store className="h-12 w-12 mx-auto text-gray-300" />
            <p className="mt-4 text-gray-500">No channels configured</p>
            <p className="text-sm text-gray-400">
              Channels will be created automatically when the system first runs
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
