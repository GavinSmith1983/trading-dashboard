import { useState, useMemo } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Package,
  User,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { pricesApi } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/Table';
import Badge from '../components/Badge';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

// Channel display names
const CHANNEL_NAMES: Record<string, string> = {
  amazon: 'Amazon',
  ebay: 'eBay/OnBuy/Debs',
  bandq: 'B&Q',
  manomano: 'ManoMano',
  shopify: 'Shopify',
  all: 'All Channels',
};

// Reason display names and colors
const REASON_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'default' }> = {
  manual: { label: 'Manual', variant: 'info' },
  proposal_approved: { label: 'Approved', variant: 'success' },
  proposal_modified: { label: 'Modified', variant: 'warning' },
  bulk_update: { label: 'Bulk', variant: 'default' },
};

type FilterReason = 'all' | 'manual' | 'proposal_approved' | 'proposal_modified' | 'bulk_update';
type FilterDirection = 'all' | 'increase' | 'decrease';

export default function PriceChanges() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accountId } = useAccountQuery();
  const { currencySymbol } = useAccount();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterReason, setFilterReason] = useState<FilterReason>('all');
  const [filterDirection, setFilterDirection] = useState<FilterDirection>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Fetch recent price changes
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['price-changes', accountId],
    queryFn: () => pricesApi.getRecentChanges(500),
  });

  const priceChanges = data?.items || [];

  // Get unique channels from the data
  const availableChannels = useMemo(() => {
    const channels = new Set<string>();
    priceChanges.forEach(change => channels.add(change.channelId));
    return Array.from(channels).sort();
  }, [priceChanges]);

  // Filter price changes
  const filteredChanges = useMemo(() => {
    return priceChanges.filter(change => {
      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch = change.sku.toLowerCase().includes(term) ||
          change.changedBy.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      // Reason filter
      if (filterReason !== 'all' && change.reason !== filterReason) {
        return false;
      }

      // Channel filter
      if (filterChannel !== 'all' && change.channelId !== filterChannel) {
        return false;
      }

      // Direction filter
      if (filterDirection !== 'all') {
        const isIncrease = change.newPrice > change.previousPrice;
        const isDecrease = change.newPrice < change.previousPrice;
        if (filterDirection === 'increase' && !isIncrease) return false;
        if (filterDirection === 'decrease' && !isDecrease) return false;
      }

      return true;
    });
  }, [priceChanges, searchTerm, filterReason, filterChannel, filterDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredChanges.length / pageSize);
  const paginatedChanges = filteredChanges.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Reset page when filters change
  useMemo(() => {
    setCurrentPage(1);
  }, [searchTerm, filterReason, filterChannel, filterDirection]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().substring(0, 10);
    const todayChanges = priceChanges.filter(c => c.changedAt.startsWith(today));
    const increases = priceChanges.filter(c => c.newPrice > c.previousPrice).length;
    const decreases = priceChanges.filter(c => c.newPrice < c.previousPrice).length;

    return {
      total: priceChanges.length,
      today: todayChanges.length,
      increases,
      decreases,
    };
  }, [priceChanges]);

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading price changes..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load price changes'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPrice = (price: number) => {
    return `${currencySymbol}${price.toFixed(2)}`;
  };

  const getPriceChangeIcon = (prev: number, next: number) => {
    if (next > prev) {
      return <ArrowUpRight className="h-4 w-4 text-green-600" />;
    } else if (next < prev) {
      return <ArrowDownRight className="h-4 w-4 text-red-600" />;
    }
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  const getPriceChangePercent = (prev: number, next: number) => {
    if (prev === 0) return '';
    const percent = ((next - prev) / prev) * 100;
    const sign = percent > 0 ? '+' : '';
    return `${sign}${percent.toFixed(1)}%`;
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <Link
            to="/products"
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              location.pathname === '/products'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Package className="h-4 w-4 inline mr-2" />
            All Products
          </Link>
          <Link
            to="/products/price-changes"
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              location.pathname === '/products/price-changes'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <History className="h-4 w-4 inline mr-2" />
            Price Changes
          </Link>
        </nav>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Changes</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <History className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Today</p>
                <p className="text-2xl font-bold">{stats.today}</p>
              </div>
              <Calendar className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Price Increases</p>
                <p className="text-2xl font-bold text-green-600">{stats.increases}</p>
              </div>
              <ArrowUpRight className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Price Decreases</p>
                <p className="text-2xl font-bold text-red-600">{stats.decreases}</p>
              </div>
              <ArrowDownRight className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by SKU or user..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Channel filter */}
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Channels</option>
              {availableChannels.map(channel => (
                <option key={channel} value={channel}>
                  {CHANNEL_NAMES[channel] || channel}
                </option>
              ))}
            </select>

            {/* Reason filter */}
            <select
              value={filterReason}
              onChange={(e) => setFilterReason(e.target.value as FilterReason)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Reasons</option>
              <option value="manual">Manual</option>
              <option value="proposal_approved">Proposal Approved</option>
              <option value="proposal_modified">Proposal Modified</option>
              <option value="bulk_update">Bulk Update</option>
            </select>

            {/* Direction filter */}
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as FilterDirection)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Changes</option>
              <option value="increase">Increases Only</option>
              <option value="decrease">Decreases Only</option>
            </select>

            <span className="text-sm text-gray-500">
              {filteredChanges.length} of {priceChanges.length} changes
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Price Changes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Price Changes</CardTitle>
        </CardHeader>
        <CardContent>
          {paginatedChanges.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <History className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No price changes found</p>
              {searchTerm && <p className="text-sm mt-2">Try adjusting your search or filters</p>}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Changed By</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedChanges.map((change, index) => {
                    const reasonConfig = REASON_CONFIG[change.reason] || { label: change.reason, variant: 'default' as const };
                    const priceChange = change.newPrice - change.previousPrice;
                    const priceChangePercent = getPriceChangePercent(change.previousPrice, change.newPrice);

                    return (
                      <TableRow
                        key={`${change.sku}-${change.changedAt}-${index}`}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/products/${encodeURIComponent(change.sku)}`)}
                      >
                        <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                          {formatDateTime(change.changedAt)}
                        </TableCell>
                        <TableCell className="font-medium text-blue-600">
                          {change.sku}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {CHANNEL_NAMES[change.channelId] || change.channelId}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatPrice(change.previousPrice)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {formatPrice(change.newPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {getPriceChangeIcon(change.previousPrice, change.newPrice)}
                            <span className={`text-sm font-medium ${
                              priceChange > 0 ? 'text-green-600' : priceChange < 0 ? 'text-red-600' : 'text-gray-500'
                            }`}>
                              {priceChangePercent}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={reasonConfig.variant}>
                            {reasonConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <User className="h-3 w-3" />
                            {change.changedBy.split('@')[0]}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-gray-500">
                          {change.notes || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-500">
                    Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredChanges.length)} of {filteredChanges.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
