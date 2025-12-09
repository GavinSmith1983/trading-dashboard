import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Package,
  FileCheck,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  PackageX,
} from 'lucide-react';
import { analyticsApi, proposalsApi } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import StatCard from '../components/StatCard';
import { Card, CardHeader, CardContent } from '../components/Card';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

export default function Dashboard() {
  const { accountId } = useAccountQuery();

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['analytics', 'summary', accountId],
    queryFn: analyticsApi.summary,
  });

  const {
    data: pendingProposals,
    isLoading: proposalsLoading,
  } = useQuery({
    queryKey: ['proposals', 'pending', accountId],
    queryFn: () => proposalsApi.list({ status: 'pending', pageSize: 5 }),
  });

  if (summaryLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading dashboard..." />
      </div>
    );
  }

  if (summaryError) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={summaryError instanceof Error ? summaryError.message : 'Failed to load dashboard'}
          onRetry={() => refetchSummary()}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of your trading performance
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Products"
          value={summary?.totalProducts || 0}
          subtitle={`${summary?.productsWithCosts || 0} with costs`}
          icon={Package}
        />
        <StatCard
          title="Pending Proposals"
          value={summary?.pendingProposals || 0}
          subtitle="Awaiting review"
          icon={FileCheck}
          variant={summary?.pendingProposals ? 'warning' : 'default'}
        />
        <StatCard
          title="Average Margin"
          value={`${(summary?.avgMargin || 0).toFixed(1)}%`}
          icon={TrendingUp}
          variant={
            (summary?.avgMargin || 0) < 15
              ? 'danger'
              : (summary?.avgMargin || 0) < 20
              ? 'warning'
              : 'success'
          }
        />
        <StatCard
          title="Out of Stock"
          value={summary?.outOfStock || 0}
          subtitle={`${summary?.lowStock || 0} low stock`}
          icon={PackageX}
          variant={(summary?.outOfStock || 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Proposals */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Pending Proposals</h2>
              <Link to="/proposals">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {proposalsLoading ? (
              <div className="p-6">
                <Loading message="Loading proposals..." />
              </div>
            ) : pendingProposals?.items.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <FileCheck className="h-12 w-12 mx-auto text-gray-300" />
                <p className="mt-2">No pending proposals</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {pendingProposals?.items.map((proposal) => (
                  <li key={proposal.proposalId} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{proposal.sku}</p>
                        <p className="text-sm text-gray-500">{proposal.productTitle}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">
                          <span className="text-gray-500">£{proposal.currentPrice.toFixed(2)}</span>
                          <span className="mx-2">→</span>
                          <span className="font-medium text-gray-900">
                            £{proposal.proposedPrice.toFixed(2)}
                          </span>
                        </p>
                        <Badge
                          variant={proposal.priceChange > 0 ? 'success' : 'danger'}
                        >
                          {proposal.priceChange > 0 ? '+' : ''}
                          {proposal.priceChangePercent.toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Link to="/proposals" className="block">
                <div className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <FileCheck className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Review Proposals</p>
                      <p className="text-sm text-gray-500">
                        Approve or reject price changes
                      </p>
                    </div>
                  </div>
                </div>
              </Link>

              <Link to="/import" className="block">
                <div className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <DollarSign className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Import Costs</p>
                      <p className="text-sm text-gray-500">
                        Upload product cost CSV file
                      </p>
                    </div>
                  </div>
                </div>
              </Link>

              <Link to="/rules" className="block">
                <div className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <TrendingUp className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Configure Rules</p>
                      <p className="text-sm text-gray-500">
                        Set up pricing rules and margins
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            </div>

            {/* Alerts */}
            {(summary?.productsWithoutCosts || 0) > 0 && (
              <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-yellow-800">Missing Cost Data</p>
                    <p className="text-sm text-yellow-700 mt-1">
                      {summary?.productsWithoutCosts} products don't have cost data.
                      <Link to="/import" className="ml-1 underline">
                        Import costs
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
