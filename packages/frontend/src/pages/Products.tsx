import { useState, useMemo } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Edit2, Save, X, Package, TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown, Filter, ChevronLeft, ChevronRight, History, Layers } from 'lucide-react';
import { productsApi, type ProductWithSales } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import type { Product } from '../types';
import { Card, CardContent } from '../components/Card';
import Badge from '../components/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/Table';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

type SortField = 'sku' | 'brand' | 'price' | 'cost' | 'delivery' | 'channelFee' | 'ppo' | 'margin' | 'stock' | 'avgSales' | 'avgRevenue';
type SortDirection = 'asc' | 'desc';
type StockFilter = 'all' | 'in-stock' | 'out-of-stock';
type MarginFilter = 'all' | 'negative' | 'low' | 'good';

// Helper function to calculate derived values for a product
// channelFeePercent is 0-100 (e.g., 15 for 15%), defaults to 15%
const getProductMetrics = (product: Product, channelFeePercent: number = 15) => {
  const priceExVat = (product.currentPrice || 0) / 1.2;
  const channelFeeRate = channelFeePercent / 100;
  const channelFee = priceExVat * channelFeeRate;
  const delivery = product.deliveryCost || 0;
  const cost = product.costPrice || 0;
  const ppo = priceExVat - channelFee - delivery - cost;
  const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
  return { priceExVat, channelFee, ppo, margin };
};

// Sort icon renderer (not a component to avoid hook issues)
const renderSortIcon = (field: SortField, sortField: SortField, sortDirection: SortDirection) => {
  if (sortField !== field) {
    return <ChevronsUpDown className="h-4 w-4 text-gray-400" />;
  }
  return sortDirection === 'asc'
    ? <ChevronUp className="h-4 w-4 text-blue-600" />
    : <ChevronDown className="h-4 w-4 text-blue-600" />;
};

export default function Products() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { accountId } = useAccountQuery();
  const { currencySymbol, currentAccount } = useAccount();
  const channelFeePercent = currentAccount?.settings?.defaultChannelFeePercent ?? 15;
  const [searchTerm, setSearchTerm] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editCost, setEditCost] = useState('');
  const [editDelivery, setEditDelivery] = useState('');
  const [sortField, setSortField] = useState<SortField>('avgSales');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [missingCostFilter, setMissingCostFilter] = useState(false);
  const [marginFilter, setMarginFilter] = useState<MarginFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [showStockCodes, setShowStockCodes] = useState(false);
  const [expandedStockCodes, setExpandedStockCodes] = useState<Set<string>>(new Set());

  const hasAccount = accountId !== 'no-account';
  const salesDays = 90;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products-with-sales', accountId, salesDays],
    queryFn: () => productsApi.listWithSales(salesDays),
    enabled: hasAccount,
  });

  const updateMutation = useMutation({
    mutationFn: ({ sku, data }: { sku: string; data: Partial<Product> }) =>
      productsApi.update(sku, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setEditingProduct(null);
    },
  });

  const products = data?.items || [] as ProductWithSales[];

  // Filter and sort products - must be before early returns to maintain hook order
  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch = (
          product.sku.toLowerCase().includes(term) ||
          product.title.toLowerCase().includes(term) ||
          product.brand.toLowerCase().includes(term)
        );
        if (!matchesSearch) return false;
      }

      // Stock filter
      if (stockFilter === 'in-stock' && (product.stockLevel || 0) <= 0) return false;
      if (stockFilter === 'out-of-stock' && (product.stockLevel || 0) > 0) return false;

      // Missing cost filter
      if (missingCostFilter && (product.costPrice || 0) > 0) return false;

      // Margin filter
      if (marginFilter !== 'all') {
        const { margin } = getProductMetrics(product, channelFeePercent);
        if (marginFilter === 'negative' && margin >= 0) return false;
        if (marginFilter === 'low' && (margin < 0 || margin >= 20)) return false;
        if (marginFilter === 'good' && margin < 20) return false;
      }

      return true;
    });

    // Precompute metrics once before sorting to avoid redundant calculations
    const productsWithMetrics = filtered.map(product => ({
      product,
      metrics: getProductMetrics(product, channelFeePercent)
    }));

    return productsWithMetrics.sort((a, b) => {
      let valueA: number | string;
      let valueB: number | string;

      switch (sortField) {
        case 'sku':
          valueA = a.product.sku.toLowerCase();
          valueB = b.product.sku.toLowerCase();
          break;
        case 'brand':
          valueA = (a.product.brand || '').toLowerCase();
          valueB = (b.product.brand || '').toLowerCase();
          break;
        case 'price':
          valueA = a.product.currentPrice || 0;
          valueB = b.product.currentPrice || 0;
          break;
        case 'cost':
          valueA = a.product.costPrice || 0;
          valueB = b.product.costPrice || 0;
          break;
        case 'delivery':
          valueA = a.product.deliveryCost || 0;
          valueB = b.product.deliveryCost || 0;
          break;
        case 'channelFee':
          valueA = a.metrics.channelFee;
          valueB = b.metrics.channelFee;
          break;
        case 'ppo':
          valueA = a.metrics.ppo;
          valueB = b.metrics.ppo;
          break;
        case 'margin':
          valueA = a.metrics.margin;
          valueB = b.metrics.margin;
          break;
        case 'stock':
          valueA = a.product.stockLevel || 0;
          valueB = b.product.stockLevel || 0;
          break;
        case 'avgSales':
          valueA = (a.product.salesQuantity || 0) / salesDays;
          valueB = (b.product.salesQuantity || 0) / salesDays;
          break;
        case 'avgRevenue':
          valueA = (a.product.salesRevenue || 0) / salesDays;
          valueB = (b.product.salesRevenue || 0) / salesDays;
          break;
        default:
          return 0;
      }

      if (typeof valueA === 'string' && typeof valueB === 'string') {
        return sortDirection === 'asc'
          ? valueA.localeCompare(valueB)
          : valueB.localeCompare(valueA);
      }

      return sortDirection === 'asc'
        ? (valueA as number) - (valueB as number)
        : (valueB as number) - (valueA as number);
    }).map(pm => pm.product);
  }, [products, searchTerm, sortField, sortDirection, stockFilter, missingCostFilter, marginFilter, channelFeePercent]);

  // Calculate pagination values
  const totalPages = Math.ceil(filteredProducts.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const resetPage = () => setCurrentPage(1);

  const handleSave = () => {
    if (editingProduct) {
      updateMutation.mutate({
        sku: editingProduct.sku,
        data: {
          costPrice: parseFloat(editCost) || 0,
          deliveryCost: parseFloat(editDelivery) || 0,
        },
      });
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setEditCost(product.costPrice?.toString() || '');
    setEditDelivery(product.deliveryCost?.toString() || '');
  };

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Toggle expanded Stock Code
  const toggleExpandedStockCode = (stockCode: string) => {
    setExpandedStockCodes(prev => {
      const next = new Set(prev);
      if (next.has(stockCode)) {
        next.delete(stockCode);
      } else {
        next.add(stockCode);
      }
      return next;
    });
  };

  // Group products by Stock Code for aggregated view
  interface StockCodeGroup {
    stockCode: string;
    products: ProductWithSales[];
    totalStock: number;
    totalSalesQuantity: number;
    totalSalesRevenue: number;
    avgDailySales: number;
    avgDailyRevenue: number;
    avgPrice: number;
    avgCost: number;
    avgMargin: number;
  }

  const stockCodeGroups = useMemo(() => {
    if (!showStockCodes) return [];

    // Group products by stockCode (use SKU as fallback if no stockCode)
    const groups = new Map<string, ProductWithSales[]>();
    for (const product of filteredProducts) {
      const stockCode = product.stockCode || product.sku;
      if (!groups.has(stockCode)) {
        groups.set(stockCode, []);
      }
      groups.get(stockCode)!.push(product);
    }

    // Calculate aggregated metrics for each group
    const groupsArray: StockCodeGroup[] = [];
    for (const [stockCode, products] of groups) {
      const totalStock = products.reduce((sum, p) => sum + (p.stockLevel || 0), 0);
      const totalSalesQuantity = products.reduce((sum, p) => sum + (p.salesQuantity || 0), 0);
      const totalSalesRevenue = products.reduce((sum, p) => sum + (p.salesRevenue || 0), 0);
      const avgDailySales = totalSalesQuantity / salesDays;
      const avgDailyRevenue = totalSalesRevenue / salesDays;

      // Calculate weighted average price and cost (weighted by stock level)
      const totalStockForAvg = totalStock > 0 ? totalStock : products.length;
      const weightedPrice = products.reduce((sum, p) => {
        const weight = totalStock > 0 ? (p.stockLevel || 0) : 1;
        return sum + (p.currentPrice || 0) * weight;
      }, 0) / totalStockForAvg;
      const weightedCost = products.reduce((sum, p) => {
        const weight = totalStock > 0 ? (p.stockLevel || 0) : 1;
        return sum + (p.costPrice || 0) * weight;
      }, 0) / totalStockForAvg;

      // Calculate average margin
      const margins = products.map(p => getProductMetrics(p, channelFeePercent).margin);
      const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;

      groupsArray.push({
        stockCode,
        products,
        totalStock,
        totalSalesQuantity,
        totalSalesRevenue,
        avgDailySales,
        avgDailyRevenue,
        avgPrice: weightedPrice,
        avgCost: weightedCost,
        avgMargin,
      });
    }

    // Sort groups by avgDailySales descending (same as default sort)
    return groupsArray.sort((a, b) => {
      switch (sortField) {
        case 'stock':
          return sortDirection === 'asc' ? a.totalStock - b.totalStock : b.totalStock - a.totalStock;
        case 'avgSales':
          return sortDirection === 'asc' ? a.avgDailySales - b.avgDailySales : b.avgDailySales - a.avgDailySales;
        case 'avgRevenue':
          return sortDirection === 'asc' ? a.avgDailyRevenue - b.avgDailyRevenue : b.avgDailyRevenue - a.avgDailyRevenue;
        case 'price':
          return sortDirection === 'asc' ? a.avgPrice - b.avgPrice : b.avgPrice - a.avgPrice;
        case 'cost':
          return sortDirection === 'asc' ? a.avgCost - b.avgCost : b.avgCost - a.avgCost;
        case 'margin':
          return sortDirection === 'asc' ? a.avgMargin - b.avgMargin : b.avgMargin - a.avgMargin;
        default:
          return b.avgDailySales - a.avgDailySales;
      }
    });
  }, [showStockCodes, filteredProducts, salesDays, sortField, sortDirection, channelFeePercent]);

  // Paginate Stock Code groups
  const paginatedStockCodeGroups = useMemo(() => {
    if (!showStockCodes) return [];
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return stockCodeGroups.slice(startIndex, endIndex);
  }, [showStockCodes, stockCodeGroups, currentPage, pageSize]);

  const totalStockCodePages = Math.ceil(stockCodeGroups.length / pageSize);

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading products..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load products'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const productsWithCosts = products.filter((p) => p.costPrice > 0).length;
  const totalSales = products.reduce((sum, p) => sum + (p.salesQuantity || 0), 0);
  const totalRevenue = products.reduce((sum, p) => sum + (p.salesRevenue || 0), 0);
  const avgDailySales = totalSales / salesDays;
  const avgDailyRevenue = totalRevenue / salesDays;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-8 pb-0">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="mt-1 text-sm text-gray-500">
            View and manage product costs
          </p>
        </div>

        {/* Sub-navigation tabs */}
        <div className="border-b border-gray-200 mb-6">
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

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{products.length}</p>
                <p className="text-sm text-gray-500">Total Products</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{avgDailySales.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p>
                <p className="text-sm text-gray-500">Avg Daily Sales</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-purple-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{currencySymbol}{avgDailyRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                <p className="text-sm text-gray-500">Avg Daily Revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Package className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{products.length - productsWithCosts}</p>
                <p className="text-sm text-gray-500">Missing Costs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Search - narrower */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search SKU, title, brand..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div className="h-8 w-px bg-gray-200" />

            {/* Stock Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Stock:</span>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  onClick={() => { setStockFilter('all'); resetPage(); }}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    stockFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => { setStockFilter('in-stock'); resetPage(); }}
                  className={`px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${
                    stockFilter === 'in-stock'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  In Stock
                </button>
                <button
                  onClick={() => { setStockFilter('out-of-stock'); resetPage(); }}
                  className={`px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${
                    stockFilter === 'out-of-stock'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Out of Stock
                </button>
              </div>
            </div>

            {/* Missing Cost Filter */}
            <button
              onClick={() => { setMissingCostFilter(!missingCostFilter); resetPage(); }}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                missingCostFilter
                  ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Filter className="h-4 w-4" />
              Missing Cost
            </button>

            {/* Margin Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Margin:</span>
              <select
                value={marginFilter}
                onChange={(e) => { setMarginFilter(e.target.value as MarginFilter); resetPage(); }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="negative">Negative (&lt;0%)</option>
                <option value="low">Low (0-20%)</option>
                <option value="good">Good (&gt;20%)</option>
              </select>
            </div>

            {/* Active filters count */}
            {(stockFilter !== 'all' || missingCostFilter || marginFilter !== 'all') && (
              <button
                onClick={() => {
                  setStockFilter('all');
                  setMissingCostFilter(false);
                  setMarginFilter('all');
                  resetPage();
                }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear filters
              </button>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* SKU/Stock Code Toggle */}
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-gray-400" />
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  onClick={() => { setShowStockCodes(false); resetPage(); setExpandedStockCodes(new Set()); }}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    !showStockCodes
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  SKU
                </button>
                <button
                  onClick={() => { setShowStockCodes(true); resetPage(); }}
                  className={`px-3 py-1.5 text-sm border-l border-gray-300 transition-colors ${
                    showStockCodes
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Stock Code
                </button>
              </div>
            </div>

            {/* Listing count */}
            <div className="text-sm text-gray-600">
              {showStockCodes ? (
                <>
                  <span className="font-medium">{stockCodeGroups.length.toLocaleString()}</span> stock codes
                  <span className="text-gray-400"> ({filteredProducts.length.toLocaleString()} SKUs)</span>
                </>
              ) : (
                <>
                  <span className="font-medium">{filteredProducts.length.toLocaleString()}</span>
                  {filteredProducts.length !== products.length && (
                    <span> of {products.length.toLocaleString()}</span>
                  )}
                  {' '}products
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Products Table */}
      <div className="flex-1 flex flex-col overflow-hidden px-8 pb-8">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  onClick={() => handleSort('sku')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  SKU {renderSortIcon('sku', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('brand')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Brand {renderSortIcon('brand', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('price')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Price {renderSortIcon('price', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('cost')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Cost {renderSortIcon('cost', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('delivery')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Delivery {renderSortIcon('delivery', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('channelFee')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  {channelFeePercent}% Fee {renderSortIcon('channelFee', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('ppo')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  PPO {renderSortIcon('ppo', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('margin')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Margin % {renderSortIcon('margin', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('stock')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Stock {renderSortIcon('stock', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('avgSales')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Avg Daily Sales {renderSortIcon('avgSales', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  onClick={() => handleSort('avgRevenue')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  Avg Daily Revenue {renderSortIcon('avgRevenue', sortField, sortDirection)}
                </button>
              </TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-gray-500">
                  No products found
                </TableCell>
              </TableRow>
            ) : showStockCodes ? (
              /* Stock Code grouped view */
              paginatedStockCodeGroups.flatMap((group) => {
                const isExpanded = expandedStockCodes.has(group.stockCode);
                const hasMultipleProducts = group.products.length > 1;

                const rows = [
                  // Stock Code group row
                  <TableRow
                    key={group.stockCode}
                    className={`${hasMultipleProducts ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-gray-50'}`}
                    onClick={() => hasMultipleProducts && toggleExpandedStockCode(group.stockCode)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {hasMultipleProducts && (
                          isExpanded
                            ? <ChevronDown className="h-4 w-4 text-gray-400" />
                            : <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                        {!hasMultipleProducts && <span className="w-4" />}
                        <div className="w-10 h-10 bg-purple-100 rounded border border-purple-200 flex items-center justify-center">
                          <Layers className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                          <p className="font-medium font-mono text-purple-700">{group.stockCode}</p>
                          <p className="text-sm text-gray-500">
                            {group.products.length} variant{group.products.length > 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge>{group.products[0]?.brand || 'Unknown'}</Badge>
                    </TableCell>
                    <TableCell className="font-medium text-gray-500">
                      ~{currencySymbol}{group.avgPrice.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      ~{currencySymbol}{group.avgCost.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-gray-400">-</TableCell>
                    <TableCell className="text-gray-400">-</TableCell>
                    <TableCell className="text-gray-400">-</TableCell>
                    <TableCell>
                      <span className={group.avgMargin < 0 ? 'text-red-600 font-medium' : group.avgMargin > 20 ? 'text-green-600 font-medium' : group.avgMargin > 0 ? 'text-yellow-600' : ''}>
                        ~{group.avgMargin.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={group.totalStock === 0 ? 'text-red-600 font-medium' : group.totalStock < 10 ? 'text-yellow-600' : 'text-gray-900'}>
                        {group.totalStock >= 200 ? '>200' : group.totalStock}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{group.avgDailySales.toFixed(2)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{currencySymbol}{group.avgDailyRevenue.toFixed(0)}</span>
                    </TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ];

                // Child product rows (when expanded)
                if (isExpanded && hasMultipleProducts) {
                  group.products.forEach((product) => {
                    const metrics = getProductMetrics(product, channelFeePercent);
                    rows.push(
                      <TableRow
                        key={`${group.stockCode}-${product.sku}`}
                        className="bg-gray-50/50 hover:bg-gray-100 cursor-pointer"
                        onClick={() => navigate(`/products/${encodeURIComponent(product.sku)}`)}
                      >
                        <TableCell className="pl-16">
                          <div className="flex items-center gap-3">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.title}
                                loading="lazy"
                                className="w-8 h-8 object-cover rounded border border-gray-200"
                              />
                            ) : (
                              <div className="w-8 h-8 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                                <Package className="h-4 w-4 text-gray-400" />
                              </div>
                            )}
                            <div>
                              <p className="font-mono text-sm text-blue-600">{product.sku}</p>
                              <p className="text-xs text-gray-500 truncate max-w-xs">{product.title}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><span className="text-xs text-gray-500">{product.brand || 'Unknown'}</span></TableCell>
                        <TableCell className="text-sm">{currencySymbol}{product.currentPrice?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell className="text-sm">
                          <span className={!product.costPrice ? 'text-red-500' : ''}>
                            {product.costPrice ? `${currencySymbol}${product.costPrice.toFixed(2)}` : 'Not set'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{product.deliveryCost ? `${currencySymbol}${product.deliveryCost.toFixed(2)}` : '-'}</TableCell>
                        <TableCell className="text-sm">{currencySymbol}{metrics.channelFee.toFixed(2)}</TableCell>
                        <TableCell className="text-sm">
                          <span className={metrics.ppo < 0 ? 'text-red-600' : metrics.ppo > 0 ? 'text-green-600' : ''}>
                            {currencySymbol}{metrics.ppo.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className={metrics.margin < 0 ? 'text-red-600' : metrics.margin > 20 ? 'text-green-600' : metrics.margin > 0 ? 'text-yellow-600' : ''}>
                            {metrics.margin.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className={product.stockLevel === 0 ? 'text-red-600' : product.stockLevel < 10 ? 'text-yellow-600' : ''}>
                            {product.stockLevel >= 200 ? '>200' : product.stockLevel}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{((product.salesQuantity || 0) / salesDays).toFixed(2)}</TableCell>
                        <TableCell className="text-sm">{currencySymbol}{((product.salesRevenue || 0) / salesDays).toFixed(0)}</TableCell>
                        <TableCell>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(product); }}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit costs"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  });
                }

                return rows;
              })
            ) : (
              /* Regular SKU view */
              paginatedProducts.map((product) => (
                <TableRow key={product.sku}>
                  <TableCell>
                    <button
                      onClick={() => navigate(`/products/${encodeURIComponent(product.sku)}`)}
                      className="flex items-center gap-3 text-left hover:bg-gray-50 -m-2 p-2 rounded transition-colors"
                    >
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          loading="lazy"
                          className="w-10 h-10 object-cover rounded border border-gray-200"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                          <Package className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-blue-600 hover:text-blue-800">{product.sku}</p>
                        <p className="text-sm text-gray-500 truncate max-w-xs">
                          {product.title}
                        </p>
                      </div>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge>{product.brand || 'Unknown'}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {currencySymbol}{product.currentPrice?.toFixed(2) || '0.00'}
                  </TableCell>
                  <TableCell>
                    {editingProduct?.sku === product.sku ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editCost}
                        onChange={(e) => setEditCost(e.target.value)}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                        autoFocus
                      />
                    ) : (
                      <span className={!product.costPrice ? 'text-red-500' : ''}>
                        {product.costPrice ? `${currencySymbol}${product.costPrice.toFixed(2)}` : 'Not set'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingProduct?.sku === product.sku ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editDelivery}
                        onChange={(e) => setEditDelivery(e.target.value)}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    ) : (
                      <span>
                        {product.deliveryCost ? `${currencySymbol}${product.deliveryCost.toFixed(2)}` : '-'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Channel Fee: % of retail after VAT removed */}
                    {(() => {
                      const { channelFee } = getProductMetrics(product, channelFeePercent);
                      return `${currencySymbol}${channelFee.toFixed(2)}`;
                    })()}
                  </TableCell>
                  <TableCell>
                    {/* PPO: Retail - VAT - Channel Fee - Delivery - Product Cost */}
                    {(() => {
                      const { ppo } = getProductMetrics(product, channelFeePercent);
                      return (
                        <span className={ppo < 0 ? 'text-red-600 font-medium' : ppo > 0 ? 'text-green-600 font-medium' : ''}>
                          {currencySymbol}{ppo.toFixed(2)}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {/* Margin %: PPO / Price ex VAT * 100 */}
                    {(() => {
                      const { margin } = getProductMetrics(product, channelFeePercent);
                      return (
                        <span className={margin < 0 ? 'text-red-600 font-medium' : margin > 20 ? 'text-green-600 font-medium' : margin > 0 ? 'text-yellow-600' : ''}>
                          {margin.toFixed(1)}%
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        product.stockLevel === 0
                          ? 'text-red-600 font-medium'
                          : product.stockLevel < 10
                          ? 'text-yellow-600'
                          : 'text-gray-900'
                      }
                    >
                      {product.stockLevel >= 200 ? '>200' : product.stockLevel}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {((product.salesQuantity || 0) / salesDays).toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {currencySymbol}{((product.salesRevenue || 0) / salesDays).toFixed(0)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {editingProduct?.sku === product.sku ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleSave}
                          className="p-1 text-green-600 hover:bg-green-50 rounded"
                          title="Save"
                        >
                          <Save className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setEditingProduct(null)}
                          className="p-1 text-gray-600 hover:bg-gray-50 rounded"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleEdit(product)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit costs"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination Controls */}
      {filteredProducts.length > 0 && (() => {
        const effectiveTotalPages = showStockCodes ? totalStockCodePages : totalPages;
        const effectiveTotalItems = showStockCodes ? stockCodeGroups.length : filteredProducts.length;
        const effectiveEndIndex = Math.min(startIndex + pageSize, effectiveTotalItems);
        return (
        <div className="flex-shrink-0 mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="px-2 py-1 border border-gray-300 rounded bg-white text-sm"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
            <span>per page</span>
          </div>

          <div className="text-sm text-gray-600">
            Showing {startIndex + 1}-{effectiveEndIndex} of {effectiveTotalItems.toLocaleString()}
            {showStockCodes && <span className="text-gray-400"> stock codes</span>}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <span className="px-3 py-1 text-sm">
              Page {currentPage} of {effectiveTotalPages || 1}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(effectiveTotalPages, p + 1))}
              disabled={currentPage === effectiveTotalPages || effectiveTotalPages === 0}
              className="p-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage(effectiveTotalPages)}
              disabled={currentPage === effectiveTotalPages || effectiveTotalPages === 0}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
        );
      })()}
      </div>
    </div>
  );
}
