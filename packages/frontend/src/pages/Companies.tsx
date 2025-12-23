import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, Search, ChevronLeft, ChevronRight, TrendingUp, ShoppingCart, Package, Percent } from 'lucide-react';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import { analyticsApi } from '../api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

// Time range options
type TimeRangeOption = { label: string; days: number | 'thisMonth' | 'lastMonth' };

const TIME_RANGES: TimeRangeOption[] = [
  { label: 'This Month', days: 'thisMonth' },
  { label: 'Last Month', days: 'lastMonth' },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
  { label: '18M', days: 548 },
];

// Helper to calculate date range for API call
function getDateRangeParams(range: number | 'thisMonth' | 'lastMonth'): { days?: number; fromDate?: string; toDate?: string } {
  if (typeof range === 'number') {
    return { days: range };
  }

  const now = new Date();
  const formatDate = (d: Date) => d.toISOString().substring(0, 10);

  if (range === 'thisMonth') {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      fromDate: formatDate(firstOfMonth),
      toDate: formatDate(now),
    };
  } else if (range === 'lastMonth') {
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      fromDate: formatDate(firstOfLastMonth),
      toDate: formatDate(lastOfLastMonth),
    };
  }
  return { days: 30 };
}

// Revenue display component
function Revenue({ value, symbol, className = '' }: { value: number; symbol: string; className?: string }) {
  const roundedValue = Math.round(value);
  const preciseValue = value.toFixed(2);
  return (
    <span className={className} title={`${symbol}${preciseValue}`}>
      {symbol}{roundedValue.toLocaleString()}
    </span>
  );
}

export default function Companies() {
  const navigate = useNavigate();
  const { accountId } = useAccountQuery();
  const { currencySymbol } = useAccount();
  const hasAccount = accountId !== 'no-account';

  // State
  const [selectedTimeRange, setSelectedTimeRange] = useState<number | 'thisMonth' | 'lastMonth'>('thisMonth');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Date range params
  const dateParams = getDateRangeParams(selectedTimeRange);

  // Fetch companies data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['companies', accountId, selectedTimeRange, page, search],
    queryFn: () => analyticsApi.companies(dateParams, page, 25, search || undefined),
    enabled: hasAccount,
  });

  // Handle time range change
  const handleTimeRangeChange = (range: number | 'thisMonth' | 'lastMonth') => {
    setSelectedTimeRange(range);
    setPage(1); // Reset to first page
  };

  // Handle search
  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  // Handle clear search
  const handleClearSearch = () => {
    setSearch('');
    setSearchInput('');
    setPage(1);
  };

  // Navigate to company detail
  const handleCompanyClick = (companyName: string) => {
    const encodedName = encodeURIComponent(companyName);
    navigate(`/companies/${encodedName}`);
  };

  if (!hasAccount) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Account Selected</h2>
          <p className="text-gray-500">Please select an account to view company data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
            <p className="text-sm text-gray-500">B2B customer analytics and breakdown</p>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className="flex items-center gap-2">
          {TIME_RANGES.map((range) => (
            <button
              key={range.label}
              onClick={() => handleTimeRangeChange(range.days)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                selectedTimeRange === range.days
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <ErrorMessage
          message="Failed to load company data"
          onRetry={refetch}
        />
      )}

      {isLoading ? (
        <Loading message="Loading company data..." />
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Revenue</p>
                    <p className="text-xl font-bold">
                      <Revenue value={data.totals.revenue} symbol={currencySymbol} />
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Percent className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Discount</p>
                    <p className="text-xl font-bold">
                      {currencySymbol}{data.totals.discount.toFixed(2)}
                    </p>
                    {data.totals.revenue > 0 && (
                      <p className="text-xs text-gray-400">
                        {((data.totals.discount / data.totals.revenue) * 100).toFixed(1)}% of revenue
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <ShoppingCart className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Orders</p>
                    <p className="text-xl font-bold">{data.totals.orders.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Package className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Unique Companies</p>
                    <p className="text-xl font-bold">{data.pagination.totalCount.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Companies Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-gray-500" />
                  <CardTitle>All Companies</CardTitle>
                  <span className="text-sm text-gray-500">
                    ({data.pagination.totalCount} companies)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search companies..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSearch();
                        }
                      }}
                      className="pl-9 pr-3 py-1.5 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Search
                  </button>
                  {search && (
                    <button
                      onClick={handleClearSearch}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">#</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Company</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Discount</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Discount %</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.companies.map((company, index) => {
                      const rank = ((data.pagination.page - 1) * data.pagination.pageSize) + index + 1;
                      const percentOfTotal = data.totals.revenue > 0
                        ? (company.revenue / data.totals.revenue) * 100
                        : 0;
                      const discountPercent = company.revenue > 0
                        ? (company.discount / company.revenue) * 100
                        : 0;

                      return (
                        <tr
                          key={company.company}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() => handleCompanyClick(company.company)}
                        >
                          <td className="py-3 px-4 text-gray-400">{rank}</td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-blue-600 hover:text-blue-800 hover:underline">
                              {company.company}
                            </span>
                          </td>
                          <td className="text-right py-3 px-4 font-medium">
                            <Revenue value={company.revenue} symbol={currencySymbol} />
                          </td>
                          <td className="text-right py-3 px-4 text-gray-500">
                            {company.discount > 0 ? `${currencySymbol}${company.discount.toFixed(2)}` : '-'}
                          </td>
                          <td className="text-right py-3 px-4 text-gray-500">
                            {discountPercent > 0 ? `${discountPercent.toFixed(1)}%` : '-'}
                          </td>
                          <td className="text-right py-3 px-4 text-gray-500">
                            {percentOfTotal.toFixed(1)}%
                          </td>
                          <td className="text-right py-3 px-4">{company.quantity.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{company.orders.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{currencySymbol}{company.avgOrderValue.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="py-3 px-4"></td>
                      <td className="py-3 px-4">Total</td>
                      <td className="text-right py-3 px-4">
                        <Revenue value={data.totals.revenue} symbol={currencySymbol} />
                      </td>
                      <td className="text-right py-3 px-4 text-gray-600">
                        {data.totals.discount > 0 ? `${currencySymbol}${data.totals.discount.toFixed(2)}` : '-'}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-600">
                        {data.totals.revenue > 0
                          ? `${((data.totals.discount / data.totals.revenue) * 100).toFixed(1)}%`
                          : '-'}
                      </td>
                      <td className="text-right py-3 px-4">100%</td>
                      <td className="text-right py-3 px-4">{data.totals.quantity.toLocaleString()}</td>
                      <td className="text-right py-3 px-4">{data.totals.orders.toLocaleString()}</td>
                      <td className="text-right py-3 px-4">
                        {currencySymbol}
                        {data.totals.orders > 0
                          ? (data.totals.revenue / data.totals.orders).toFixed(2)
                          : '0'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-gray-500">
                    Showing {((data.pagination.page - 1) * data.pagination.pageSize) + 1} to{' '}
                    {Math.min(
                      data.pagination.page * data.pagination.pageSize,
                      data.pagination.totalCount
                    )}{' '}
                    of {data.pagination.totalCount} companies
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm">
                      Page {data.pagination.page} of {data.pagination.totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))}
                      disabled={page >= data.pagination.totalPages}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
