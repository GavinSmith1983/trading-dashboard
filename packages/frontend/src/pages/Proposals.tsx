import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Check,
  X,
  Edit3,
  Send,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Package,
  RefreshCw,
} from 'lucide-react';
import { proposalsApi, rulesApi, type ProposalFilters } from '../api';
import type { PriceProposal, ProposalStatus } from '../types';
import { Card, CardContent } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

const PAGE_SIZE = 50;

const statusConfig: Record<ProposalStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-100' },
  approved: { label: 'Approved', color: 'text-green-700', bg: 'bg-green-100' },
  rejected: { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-100' },
  modified: { label: 'Modified', color: 'text-blue-700', bg: 'bg-blue-100' },
  pushed: { label: 'Pushed', color: 'text-purple-700', bg: 'bg-purple-100' },
};

function PriceChangeBadge({ change, percent }: { change: number; percent: number }) {
  const isIncrease = change > 0;
  const isDecrease = change < 0;

  if (Math.abs(change) < 0.01) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Minus className="h-3 w-3" />
        <span>No change</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 ${
        isIncrease ? 'text-green-600' : isDecrease ? 'text-red-600' : 'text-gray-500'
      }`}
    >
      {isIncrease ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      <span>
        {isIncrease ? '+' : ''}£{change.toFixed(2)} ({isIncrease ? '+' : ''}
        {percent.toFixed(1)}%)
      </span>
    </span>
  );
}

function MarginChangeBadge({ current, proposed, change }: { current: number; proposed: number; change: number }) {
  const isImprovement = change > 0;
  const isDecline = change < 0;

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <span className={current < 10 ? 'text-red-600' : current < 20 ? 'text-amber-600' : 'text-gray-600'}>
          {current.toFixed(1)}%
        </span>
        <span className="text-gray-400">→</span>
        <span
          className={`font-medium ${
            proposed < 10 ? 'text-red-600' : proposed < 20 ? 'text-amber-600' : 'text-green-600'
          }`}
        >
          {proposed.toFixed(1)}%
        </span>
      </div>
      <span
        className={`text-xs ${isImprovement ? 'text-green-600' : isDecline ? 'text-red-600' : 'text-gray-500'}`}
      >
        {isImprovement ? '+' : ''}
        {change.toFixed(1)}pp
      </span>
    </div>
  );
}

function ModifyPriceModal({
  proposal,
  onClose,
  onSubmit,
}: {
  proposal: PriceProposal;
  onClose: () => void;
  onSubmit: (price: number, notes: string) => void;
}) {
  const [price, setPrice] = useState(proposal.proposedPrice.toFixed(2));
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(parseFloat(price), notes);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Modify Price</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
            <p className="text-gray-900">{proposal.sku}</p>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Price</label>
            <p className="text-gray-900">£{proposal.currentPrice.toFixed(2)}</p>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Suggested Price</label>
            <p className="text-gray-500">£{proposal.proposedPrice.toFixed(2)}</p>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">New Price (£)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save Modified Price
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Proposals() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ProposalFilters>({
    status: undefined,
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modifyingProposal, setModifyingProposal] = useState<PriceProposal | null>(null);

  // Fetch proposals
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['proposals', filters],
    queryFn: () => proposalsApi.list({ ...filters, search: searchTerm || undefined }),
  });

  // Fetch rules for the reason filter dropdown
  const { data: rulesData } = useQuery({
    queryKey: ['rules'],
    queryFn: () => rulesApi.list(),
  });

  // Mutations
  const approveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      proposalsApi.approve(id, 'user', notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
    onError: (error) => {
      console.error('Approve failed:', error);
      alert(`Failed to approve: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      proposalsApi.reject(id, 'user', notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
    onError: (error) => {
      console.error('Reject failed:', error);
      alert(`Failed to reject: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const modifyMutation = useMutation({
    mutationFn: ({ id, price, notes }: { id: string; price: number; notes?: string }) =>
      proposalsApi.modify(id, price, 'user', notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      setModifyingProposal(null);
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => proposalsApi.bulkApprove(ids, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      setSelectedIds(new Set());
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (ids: string[]) => proposalsApi.bulkReject(ids, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      setSelectedIds(new Set());
    },
  });

  const pushMutation = useMutation({
    mutationFn: () => proposalsApi.push(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const proposals = data?.items || [];
  const totalCount = data?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Calculate summary stats from current data
  const pendingCount = proposals.filter((p) => p.status === 'pending').length;
  const approvedCount = proposals.filter((p) => p.status === 'approved' || p.status === 'modified').length;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({ ...prev, page: 1 }));
    refetch();
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === proposals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(proposals.filter((p) => p.status === 'pending').map((p) => p.proposalId)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading proposals..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load proposals'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Price Proposals</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review and approve pricing suggestions based on rules and market conditions
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card
          className={`cursor-pointer transition-all ${filters.status === 'pending' ? 'ring-2 ring-amber-400' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, status: prev.status === 'pending' ? undefined : 'pending', page: 1 }))}
        >
          <CardContent className="py-3">
            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
            <p className="text-xs text-gray-500">Pending Review</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${filters.status === 'approved' ? 'ring-2 ring-green-400' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, status: prev.status === 'approved' ? undefined : 'approved', page: 1 }))}
        >
          <CardContent className="py-3">
            <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
            <p className="text-xs text-gray-500">Approved</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${filters.status === 'rejected' ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, status: prev.status === 'rejected' ? undefined : 'rejected', page: 1 }))}
        >
          <CardContent className="py-3">
            <p className="text-2xl font-bold text-red-600">
              {proposals.filter((p) => p.status === 'rejected').length}
            </p>
            <p className="text-xs text-gray-500">Rejected</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-all ${filters.status === 'pushed' ? 'ring-2 ring-purple-400' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, status: prev.status === 'pushed' ? undefined : 'pushed', page: 1 }))}
        >
          <CardContent className="py-3">
            <p className="text-2xl font-bold text-purple-600">
              {proposals.filter((p) => p.status === 'pushed').length}
            </p>
            <p className="text-xs text-gray-500">Pushed</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="py-3">
            <p className="text-2xl font-bold text-gray-700">{totalCount}</p>
            <p className="text-xs text-gray-500">Total</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <form onSubmit={handleSearch} className="flex-1 min-w-[200px] max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search SKU or title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </form>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={filters.status || ''}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                status: (e.target.value as ProposalStatus) || undefined,
                page: 1,
              }))
            }
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="modified">Modified</option>
            <option value="rejected">Rejected</option>
            <option value="pushed">Pushed</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filters.appliedRuleName || ''}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                appliedRuleName: e.target.value || undefined,
                page: 1,
              }))
            }
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Reasons</option>
            {rulesData?.items?.map((rule) => (
              <option key={rule.ruleId} value={rule.name}>
                {rule.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-800 border rounded-lg"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-4 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <span className="text-sm font-medium text-blue-700">{selectedIds.size} selected</span>
          <button
            onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
            disabled={bulkApproveMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Approve All
          </button>
          <button
            onClick={() => bulkRejectMutation.mutate(Array.from(selectedIds))}
            disabled={bulkRejectMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Reject All
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Push Button */}
      {approvedCount > 0 && (
        <div className="mb-4">
          <button
            onClick={() => pushMutation.mutate()}
            disabled={pushMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {pushMutation.isPending ? 'Exporting...' : `Export ${approvedCount} Price Changes`}
          </button>
        </div>
      )}

      {/* Proposals Table */}
      {proposals.length === 0 ? (
        <Card className="bg-gray-50">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700">No Proposals</h3>
            <p className="text-sm text-gray-500 mt-1">
              {filters.status
                ? `No ${filters.status} proposals found.`
                : 'No pricing proposals have been generated yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === proposals.filter((p) => p.status === 'pending').length && selectedIds.size > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price Change
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Margin
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Context
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Est. Impact
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {proposals.map((proposal) => (
                  <tr key={proposal.proposalId} className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      {proposal.status === 'pending' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(proposal.proposalId)}
                          onChange={() => toggleSelect(proposal.proposalId)}
                          className="rounded border-gray-300"
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="min-w-0">
                        <Link
                          to={`/products/${encodeURIComponent(proposal.sku)}`}
                          className="font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {proposal.sku}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        <p
                          className="text-xs text-gray-500 truncate max-w-[200px]"
                          title={proposal.productTitle || 'No title'}
                        >
                          {proposal.productTitle || 'No title'}
                        </p>
                        <p className="text-xs text-gray-400">{proposal.brand}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-600">£{proposal.currentPrice.toFixed(2)}</span>
                          <span className="text-gray-400">→</span>
                          <span className="font-medium text-gray-900">
                            £{(proposal.approvedPrice || proposal.proposedPrice).toFixed(2)}
                          </span>
                        </div>
                        <PriceChangeBadge change={proposal.priceChange} percent={proposal.priceChangePercent} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <MarginChangeBadge
                        current={proposal.currentMargin}
                        proposed={proposal.proposedMargin}
                        change={proposal.marginChange}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs text-gray-500 space-y-1">
                        <div className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          <span>Stock: {proposal.stockLevel}</span>
                        </div>
                        <div>Sales: {proposal.avgDailySales?.toFixed(2) || (proposal.salesLast7Days / 7).toFixed(2)}/day</div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs space-y-1">
                        <div className={`font-medium ${(proposal.estimatedWeeklyProfitImpact || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {(proposal.estimatedWeeklyProfitImpact || 0) >= 0 ? '+' : ''}
                          £{(proposal.estimatedWeeklyProfitImpact || 0).toFixed(2)}/wk
                        </div>
                        <div className="text-gray-400">
                          Rev: {(proposal.estimatedWeeklyRevenueImpact || 0) >= 0 ? '+' : ''}
                          £{(proposal.estimatedWeeklyRevenueImpact || 0).toFixed(2)}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="max-w-[150px]">
                        {proposal.appliedRuleName && (
                          <p
                            className="text-xs font-medium text-gray-700 truncate"
                            title={proposal.appliedRuleName}
                          >
                            {proposal.appliedRuleName}
                          </p>
                        )}
                        <p
                          className="text-xs text-gray-500 truncate"
                          title={proposal.reason}
                        >
                          {proposal.reason}
                        </p>
                        {proposal.warnings.length > 0 && (
                          <div
                            className="flex items-center gap-1 text-amber-600 mt-1 cursor-help"
                            title={proposal.warnings.join('\n')}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            <span className="text-xs">{proposal.warnings.length} warning(s)</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          statusConfig[proposal.status].bg
                        } ${statusConfig[proposal.status].color}`}
                      >
                        {statusConfig[proposal.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {proposal.status === 'pending' && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => approveMutation.mutate({ id: proposal.proposalId })}
                            disabled={approveMutation.isPending}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                            title="Approve"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => rejectMutation.mutate({ id: proposal.proposalId })}
                            disabled={rejectMutation.isPending}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                            title="Reject"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setModifyingProposal(proposal)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                            title="Modify"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <p className="text-sm text-gray-500">
                Showing {((filters.page || 1) - 1) * PAGE_SIZE + 1} to{' '}
                {Math.min((filters.page || 1) * PAGE_SIZE, totalCount)} of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) - 1 }))}
                  disabled={(filters.page || 1) <= 1}
                  className="p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-gray-600">
                  Page {filters.page || 1} of {totalPages}
                </span>
                <button
                  onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
                  disabled={(filters.page || 1) >= totalPages}
                  className="p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modify Modal */}
      {modifyingProposal && (
        <ModifyPriceModal
          proposal={modifyingProposal}
          onClose={() => setModifyingProposal(null)}
          onSubmit={(price, notes) =>
            modifyMutation.mutate({ id: modifyingProposal.proposalId, price, notes })
          }
        />
      )}
    </div>
  );
}
