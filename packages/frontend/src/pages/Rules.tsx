import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Save, Settings, GripVertical } from 'lucide-react';
import { rulesApi } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import type { PricingRule, PricingRuleAction } from '../types';
import { Card, CardHeader, CardContent } from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

const actionTypes: { value: PricingRuleAction['type']; label: string; description: string }[] = [
  { value: 'set_margin', label: 'Set Margin %', description: 'Price to achieve target margin' },
  { value: 'set_markup', label: 'Set Markup', description: 'Cost × multiplier' },
  { value: 'adjust_percent', label: 'Adjust by %', description: 'Increase/decrease by percentage' },
  { value: 'adjust_fixed', label: 'Adjust by £', description: 'Increase/decrease by amount' },
  { value: 'discount_from_mrp', label: 'Discount from MRP', description: 'Set % below MRP' },
  { value: 'match_mrp', label: 'Match MRP', description: 'Set price to MRP' },
];

const emptyRule: Omit<PricingRule, 'ruleId' | 'createdAt' | 'updatedAt'> = {
  name: '',
  description: '',
  priority: 100,
  isActive: true,
  conditions: {},
  action: { type: 'set_margin', value: 20 },
};

export default function Rules() {
  const queryClient = useQueryClient();
  const { accountId } = useAccountQuery();
  const [editingRule, setEditingRule] = useState<Partial<PricingRule> | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rules', accountId],
    queryFn: rulesApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (rule: Omit<PricingRule, 'ruleId' | 'createdAt' | 'updatedAt'>) =>
      rulesApi.create(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setIsCreating(false);
      setEditingRule(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ ruleId, data }: { ruleId: string; data: Partial<PricingRule> }) =>
      rulesApi.update(ruleId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setEditingRule(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => rulesApi.delete(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const handleSave = () => {
    if (!editingRule) return;

    if (isCreating) {
      createMutation.mutate(editingRule as Omit<PricingRule, 'ruleId' | 'createdAt' | 'updatedAt'>);
    } else if (editingRule.ruleId) {
      updateMutation.mutate({ ruleId: editingRule.ruleId, data: editingRule });
    }
  };

  const handleDelete = (ruleId: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
      deleteMutation.mutate(ruleId);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading rules..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load rules'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const rules = data?.items || [];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Rules</h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure automated pricing rules
          </p>
        </div>
        <Button
          onClick={() => {
            setIsCreating(true);
            setEditingRule({ ...emptyRule });
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Rule
        </Button>
      </div>

      {/* Rule Editor Modal */}
      {editingRule && (
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardHeader>
            <h3 className="font-semibold text-gray-900">
              {isCreating ? 'Create New Rule' : 'Edit Rule'}
            </h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rule Name *
                  </label>
                  <input
                    type="text"
                    value={editingRule.name || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g., Minimum 20% Margin"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editingRule.description || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Optional description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Priority
                    </label>
                    <input
                      type="number"
                      value={editingRule.priority || 100}
                      onChange={(e) =>
                        setEditingRule({ ...editingRule, priority: parseInt(e.target.value) })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Lower = higher priority</p>
                  </div>
                  <div className="flex items-center pt-6">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={editingRule.isActive !== false}
                      onChange={(e) =>
                        setEditingRule({ ...editingRule, isActive: e.target.checked })
                      }
                      className="rounded border-gray-300 mr-2"
                    />
                    <label htmlFor="isActive" className="text-sm text-gray-700">
                      Rule Active
                    </label>
                  </div>
                </div>
              </div>

              {/* Action */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Action Type *
                  </label>
                  <select
                    value={editingRule.action?.type || 'set_margin'}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        action: {
                          type: e.target.value as PricingRuleAction['type'],
                          value: editingRule.action?.value || 0,
                        },
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    {actionTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label} - {type.description}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Value
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingRule.action?.value || ''}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        action: {
                          type: editingRule.action?.type || 'set_margin',
                          value: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="e.g., 20 for 20%"
                  />
                </div>
              </div>

              {/* Conditions */}
              <div className="md:col-span-2">
                <h4 className="font-medium text-gray-900 mb-3">Conditions (Optional)</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Brands (comma sep.)</label>
                    <input
                      type="text"
                      value={editingRule.conditions?.brands?.join(', ') || ''}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          conditions: {
                            ...editingRule.conditions,
                            brands: e.target.value ? e.target.value.split(',').map((s) => s.trim()) : undefined,
                          },
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="Nuie, Other"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Margin Below %</label>
                    <input
                      type="number"
                      value={editingRule.conditions?.marginBelow ?? ''}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          conditions: {
                            ...editingRule.conditions,
                            marginBelow: e.target.value ? parseFloat(e.target.value) : undefined,
                          },
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Stock Below</label>
                    <input
                      type="number"
                      value={editingRule.conditions?.stockBelow ?? ''}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          conditions: {
                            ...editingRule.conditions,
                            stockBelow: e.target.value ? parseInt(e.target.value) : undefined,
                          },
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Stock Above</label>
                    <input
                      type="number"
                      value={editingRule.conditions?.stockAbove ?? ''}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          conditions: {
                            ...editingRule.conditions,
                            stockAbove: e.target.value ? parseInt(e.target.value) : undefined,
                          },
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="md:col-span-2 flex gap-2 pt-4 border-t border-blue-200">
                <Button onClick={handleSave} disabled={!editingRule.name}>
                  <Save className="h-4 w-4 mr-1" />
                  {isCreating ? 'Create Rule' : 'Save Changes'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingRule(null);
                    setIsCreating(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules List */}
      <div className="space-y-4">
        {rules.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Settings className="h-12 w-12 mx-auto text-gray-300" />
              <p className="mt-4 text-gray-500">No pricing rules configured</p>
              <p className="text-sm text-gray-400">
                Create rules to automatically adjust prices
              </p>
              <Button
                className="mt-4"
                onClick={() => {
                  setIsCreating(true);
                  setEditingRule({ ...emptyRule });
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First Rule
              </Button>
            </CardContent>
          </Card>
        ) : (
          rules.map((rule) => (
            <Card key={rule.ruleId}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2 text-gray-400 cursor-move">
                      <GripVertical className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                        <Badge variant={rule.isActive ? 'success' : 'default'}>
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        <span className="text-sm text-gray-500">Priority: {rule.priority}</span>
                      </div>
                      {rule.description && (
                        <p className="text-sm text-gray-500 mt-1">{rule.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="info">
                          {actionTypes.find((t) => t.value === rule.action.type)?.label}:{' '}
                          {rule.action.value}
                        </Badge>
                        {rule.conditions.brands?.length && (
                          <Badge>Brands: {rule.conditions.brands.join(', ')}</Badge>
                        )}
                        {rule.conditions.marginBelow !== undefined && (
                          <Badge>Margin &lt; {rule.conditions.marginBelow}%</Badge>
                        )}
                        {rule.conditions.stockBelow !== undefined && (
                          <Badge>Stock &lt; {rule.conditions.stockBelow}</Badge>
                        )}
                        {rule.conditions.stockAbove !== undefined && (
                          <Badge>Stock &gt; {rule.conditions.stockAbove}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setIsCreating(false);
                        setEditingRule(rule);
                      }}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded"
                      title="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.ruleId)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
