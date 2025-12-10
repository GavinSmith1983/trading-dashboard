import { useState, useMemo } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Edit2, Save, X, Package, TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown, Filter, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { productsApi, analyticsApi } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import type { Product } from '../types';
import { Card, CardContent } from '../components/Card';
import Badge from '../components/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/Table';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

type SortField = 'sku' | 'brand' | 'price' | 'cost' | 'delivery' | 'twentyPercent' | 'ppo' | 'margin' | 'stock' | 'avgSales' | 'avgRevenue';
type SortDirection = 'asc' | 'desc';
type StockFilter = 'all' | 'in-stock' | 'out-of-stock';
type MarginFilter = 'all' | 'negative' | 'low' | 'good';

// Helper function to calculate derived values for a product
const getProductMetrics = (product: Product) => {
  const priceExVat = (product.currentPrice || 0) / 1.2;
  const twentyPercent = priceExVat * 0.2;
  const delivery = product.deliveryCost || 0;
  const cost = product.costPrice || 0;
  const ppo = priceExVat - twentyPercent - delivery - cost;
  const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
  return { priceExVat, twentyPercent, ppo, margin };
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
  const { currencySymbol } = useAccount();
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

  const { data, isLoading: productsLoading, error, refetch } = useQuery({
    queryKey: ['products', accountId],
    queryFn: productsApi.list,
  });

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['sales', accountId, 180],
    queryFn: () => analyticsApi.sales({ days: 180 }),
  });

  // Wait for both products and sales data before showing content
  const isLoading = productsLoading || salesLoading;

  // Calculate average daily sales from 6-month data
  const salesDays = salesData?.days || 180;

  const updateMutation = useMutation({
    mutationFn: ({ sku, data }: { sku: string; data: Partial<Product> }) =>
      productsApi.update(sku, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setEditingProduct(null);
    },
  });

  const products = data?.items || [];
  const sales = salesData?.sales || {};

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
        const { margin } = getProductMetrics(product);
        if (marginFilter === 'negative' && margin >= 0) return false;
        if (marginFilter === 'low' && (margin < 0 || margin >= 20)) return false;
        if (marginFilter === 'good' && margin < 20) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      let valueA: number | string;
      let valueB: number | string;

      switch (sortField) {
        case 'sku':
          valueA = a.sku.toLowerCase();
          valueB = b.sku.toLowerCase();
          break;
        case 'brand':
          valueA = (a.brand || '').toLowerCase();
          valueB = (b.brand || '').toLowerCase();
          break;
        case 'price':
          valueA = a.currentPrice || 0;
          valueB = b.currentPrice || 0;
          break;
        case 'cost':
          valueA = a.costPrice || 0;
          valueB = b.costPrice || 0;
          break;
        case 'delivery':
          valueA = a.deliveryCost || 0;
          valueB = b.deliveryCost || 0;
          break;
        case 'twentyPercent':
          valueA = getProductMetrics(a).twentyPercent;
          valueB = getProductMetrics(b).twentyPercent;
          break;
        case 'ppo':
          valueA = getProductMetrics(a).ppo;
          valueB = getProductMetrics(b).ppo;
          break;
        case 'margin':
          valueA = getProductMetrics(a).margin;
          valueB = getProductMetrics(b).margin;
          break;
        case 'stock':
          valueA = a.stockLevel || 0;
          valueB = b.stockLevel || 0;
          break;
        case 'avgSales':
          valueA = (sales[a.sku]?.quantity || 0) / salesDays;
          valueB = (sales[b.sku]?.quantity || 0) / salesDays;
          break;
        case 'avgRevenue':
          valueA = (sales[a.sku]?.revenue || 0) / salesDays;
          valueB = (sales[b.sku]?.revenue || 0) / salesDays;
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
    });
  }, [products, searchTerm, sortField, sortDirection, sales, stockFilter, missingCostFilter, marginFilter]);

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
  const totalSales = Object.values(sales).reduce((sum, s) => sum + s.quantity, 0);
  const totalRevenue = Object.values(sales).reduce((sum, s) => sum + s.revenue, 0);
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

            {/* Listing count */}
            <div className="text-sm text-gray-600">
              <span className="font-medium">{filteredProducts.length.toLocaleString()}</span>
              {filteredProducts.length !== products.length && (
                <span> of {products.length.toLocaleString()}</span>
              )}
              {' '}products
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
                  onClick={() => handleSort('twentyPercent')}
                  className="flex items-center gap-1 hover:text-blue-600 transition-colors"
                >
                  20% Costs {renderSortIcon('twentyPercent', sortField, sortDirection)}
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
            ) : (
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
                    {/* 20% Costs: 20% of retail after VAT removed */}
                    {(() => {
                      const priceExVat = (product.currentPrice || 0) / 1.2;
                      const twentyPercent = priceExVat * 0.2;
                      return `${currencySymbol}${twentyPercent.toFixed(2)}`;
                    })()}
                  </TableCell>
                  <TableCell>
                    {/* PPO: Retail - VAT - 20% Clawback - Delivery - Product Cost */}
                    {(() => {
                      const priceExVat = (product.currentPrice || 0) / 1.2;
                      const clawback = priceExVat * 0.2;
                      const delivery = product.deliveryCost || 0;
                      const cost = product.costPrice || 0;
                      const ppo = priceExVat - clawback - delivery - cost;
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
                      const priceExVat = (product.currentPrice || 0) / 1.2;
                      const clawback = priceExVat * 0.2;
                      const delivery = product.deliveryCost || 0;
                      const cost = product.costPrice || 0;
                      const ppo = priceExVat - clawback - delivery - cost;
                      const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
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
                      {((sales[product.sku]?.quantity || 0) / salesDays).toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {currencySymbol}{((sales[product.sku]?.revenue || 0) / salesDays).toFixed(0)}
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
      {filteredProducts.length > 0 && (
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
            Showing {startIndex + 1}-{Math.min(endIndex, filteredProducts.length)} of {filteredProducts.length.toLocaleString()}
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
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
