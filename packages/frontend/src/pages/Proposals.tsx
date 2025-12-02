import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  X,
  Edit2,
  AlertTriangle,
  Upload,
  Filter,
} from 'lucide-react';
import { proposalsApi, type ProposalFilters } from '../api';
import type { ProposalStatus, PriceProposal } from '../types';
import { Card, CardContent } from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/Table';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

const statusOptions: { value: ProposalStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'modified', label: 'Modified' },
  { value: 'pushed', label: 'Pushed' },
];

const statusBadgeVariant: Record<ProposalStatus, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  modified: 'info',
  pushed: 'default',
};

export default function Proposals() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ProposalFilters>({ status: 'pending' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingProposal, setEditingProposal] = useState<PriceProposal | null>(null);
  const [editPrice, setEditPrice] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['proposals', filters],
    queryFn: () => proposalsApi.list(filters),
  });

  const approveMutation = useMutation({
    mutationFn: (proposalId: string) => proposalsApi.approve(proposalId, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => proposalsApi.reject(proposalId, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const modifyMutation = useMutation({
    mutationFn: ({ proposalId, price }: { proposalId: string; price: number }) =>
      proposalsApi.modify(proposalId, price, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      setEditingProposal(null);
      setEditPrice('');
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => proposalsApi.bulkApprove(ids, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      setSelectedIds(new Set());
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (ids: string[]) => proposalsApi.bulkReject(ids, 'user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      setSelectedIds(new Set());
    },
  });

  const pushMutation = useMutation({
    mutationFn: () => proposalsApi.push(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked && data?.items) {
      setSelectedIds(new Set(data.items.map((p) => p.proposalId)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (proposalId: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(proposalId);
    } else {
      newSelected.delete(proposalId);
    }
    setSelectedIds(newSelected);
  };

  const handleModifySubmit = () => {
    if (editingProposal && editPrice) {
      modifyMutation.mutate({
        proposalId: editingProposal.proposalId,
        price: parseFloat(editPrice),
      });
    }
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

  const proposals = data?.items || [];
  const allSelected = proposals.length > 0 && selectedIds.size === proposals.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Price Proposals</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review and approve price changes
        </p>
      </div>

      {/* Filters and Actions */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <select
                  value={filters.status || ''}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value as ProposalStatus || undefined })
                  }
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                placeholder="Search SKU or title..."
                value={filters.search || ''}
                onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              {someSelected && (
                <>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
                    disabled={bulkApproveMutation.isPending}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve ({selectedIds.size})
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => bulkRejectMutation.mutate(Array.from(selectedIds))}
                    disabled={bulkRejectMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject ({selectedIds.size})
                  </Button>
                </>
              )}

              <Button
                variant="primary"
                size="sm"
                onClick={() => pushMutation.mutate()}
                disabled={pushMutation.isPending}
              >
                <Upload className="h-4 w-4 mr-1" />
                Push to ChannelEngine
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Proposals Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="rounded border-gray-300"
                />
              </TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Current Price</TableHead>
              <TableHead>Proposed Price</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Margin</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                  No proposals found
                </TableCell>
              </TableRow>
            ) : (
              proposals.map((proposal) => (
                <TableRow key={proposal.proposalId}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(proposal.proposalId)}
                      onChange={(e) => handleSelectOne(proposal.proposalId, e.target.checked)}
                      className="rounded border-gray-300"
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-gray-900">{proposal.sku}</p>
                      <p className="text-sm text-gray-500 truncate max-w-xs">
                        {proposal.productTitle}
                      </p>
                      {proposal.warnings.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <AlertTriangle className="h-3 w-3 text-yellow-500" />
                          <span className="text-xs text-yellow-600">
                            {proposal.warnings.length} warning(s)
                          </span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-900">
                    £{proposal.currentPrice.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {editingProposal?.proposalId === proposal.proposalId ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                          autoFocus
                        />
                        <Button size="sm" onClick={handleModifySubmit}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingProposal(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium text-gray-900">
                        £{(proposal.approvedPrice ?? proposal.proposedPrice).toFixed(2)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={proposal.priceChange > 0 ? 'success' : 'danger'}>
                      {proposal.priceChange > 0 ? '+' : ''}
                      {proposal.priceChangePercent.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="text-gray-500">{proposal.currentMargin.toFixed(1)}%</span>
                      <span className="mx-1">→</span>
                      <span
                        className={
                          proposal.proposedMargin < 15
                            ? 'text-red-600 font-medium'
                            : 'text-green-600 font-medium'
                        }
                      >
                        {proposal.proposedMargin.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant[proposal.status]}>
                      {proposal.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {proposal.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => approveMutation.mutate(proposal.proposalId)}
                          className="p-1 text-green-600 hover:bg-green-50 rounded"
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(proposal.proposalId)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingProposal(proposal);
                            setEditPrice(proposal.proposedPrice.toFixed(2));
                          }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          title="Modify price"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination info */}
      {data && (
        <div className="mt-4 text-sm text-gray-500 text-center">
          Showing {proposals.length} of {data.totalCount} proposals
        </div>
      )}
    </div>
  );
}
