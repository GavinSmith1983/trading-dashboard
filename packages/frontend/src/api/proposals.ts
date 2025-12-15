import { api } from './client';
import type { PriceProposal, PaginatedResponse, ProposalStatus } from '../types';

export interface ProposalFilters {
  status?: ProposalStatus;
  batchId?: string;
  brand?: string;
  search?: string;
  hasWarnings?: boolean;
  appliedRuleName?: string;
  page?: number;
  pageSize?: number;
}

export const proposalsApi = {
  list: (filters: ProposalFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.batchId) params.set('batchId', filters.batchId);
    if (filters.brand) params.set('brand', filters.brand);
    if (filters.search) params.set('search', filters.search);
    if (filters.hasWarnings) params.set('hasWarnings', 'true');
    if (filters.appliedRuleName) params.set('appliedRuleName', filters.appliedRuleName);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

    const query = params.toString();
    return api.get<PaginatedResponse<PriceProposal>>(`/proposals${query ? `?${query}` : ''}`);
  },

  get: (proposalId: string) => api.get<PriceProposal>(`/proposals/${proposalId}`),

  approve: (proposalId: string, reviewedBy: string, notes?: string) =>
    api.put<PriceProposal>(`/proposals/${proposalId}`, {
      action: 'approve',
      reviewedBy,
      notes,
    }),

  reject: (proposalId: string, reviewedBy: string, notes?: string) =>
    api.put<PriceProposal>(`/proposals/${proposalId}`, {
      action: 'reject',
      reviewedBy,
      notes,
    }),

  modify: (proposalId: string, modifiedPrice: number, reviewedBy: string, notes?: string) =>
    api.put<PriceProposal>(`/proposals/${proposalId}`, {
      action: 'modify',
      modifiedPrice,
      reviewedBy,
      notes,
    }),

  bulkApprove: (proposalIds: string[], reviewedBy: string, notes?: string) =>
    api.post('/proposals/bulk-approve', { proposalIds, reviewedBy, notes }),

  bulkReject: (proposalIds: string[], reviewedBy: string, notes?: string) =>
    api.post('/proposals/bulk-reject', { proposalIds, reviewedBy, notes }),

  bulkApproveFiltered: (filters: Omit<ProposalFilters, 'page' | 'pageSize'>, reviewedBy: string, notes?: string) =>
    api.post<{ success: boolean; approvedCount: number; message: string }>('/proposals/bulk-approve-filtered', {
      filters,
      reviewedBy,
      notes,
    }),

  statusCounts: () =>
    api.get<{
      pending: number;
      approved: number;
      modified: number;
      rejected: number;
      pushed: number;
      totalApproved: number;
    }>('/proposals/status-counts'),

  push: (dryRun = false) =>
    api.post<{ success: boolean; pushed: number; errors: string[] }>('/proposals/push', { dryRun }),
};
