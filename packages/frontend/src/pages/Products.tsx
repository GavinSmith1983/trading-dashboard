import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Edit2, Save, X, Package, TrendingUp, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { productsApi, analyticsApi } from '../api';
import type { Product } from '../types';
import { Card, CardContent } from '../components/Card';
import Badge from '../components/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/Table';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

type SortField = 'sku' | 'brand' | 'price' | 'cost' | 'delivery' | 'twentyPercent' | 'ppo' | 'margin' | 'stock' | 'avgSales' | 'avgRevenue';
type SortDirection = 'asc' | 'desc';

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
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editCost, setEditCost] = useState('');
  const [editDelivery, setEditDelivery] = useState('');
  const [sortField, setSortField] = useState<SortField>('avgSales');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: productsApi.list,
  });

  const { data: salesData } = useQuery({
    queryKey: ['sales', 180],
    queryFn: () => analyticsApi.sales(180),
  });

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
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        product.sku.toLowerCase().includes(term) ||
        product.title.toLowerCase().includes(term) ||
        product.brand.toLowerCase().includes(term)
      );
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
  }, [products, searchTerm, sortField, sortDirection, sales]);

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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="mt-1 text-sm text-gray-500">
            View and manage product costs
          </p>
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
                <p className="text-2xl font-semibold">£{avgDailyRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
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

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by SKU, title, or brand..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Products Table */}
      <div className="flex-1 overflow-hidden px-8 pb-8">
      <Card className="h-full flex flex-col overflow-hidden">
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
              filteredProducts.slice(0, 100).map((product) => (
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
                    £{product.currentPrice?.toFixed(2) || '0.00'}
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
                        {product.costPrice ? `£${product.costPrice.toFixed(2)}` : 'Not set'}
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
                        {product.deliveryCost ? `£${product.deliveryCost.toFixed(2)}` : '-'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* 20% Costs: 20% of retail after VAT removed */}
                    {(() => {
                      const priceExVat = (product.currentPrice || 0) / 1.2;
                      const twentyPercent = priceExVat * 0.2;
                      return `£${twentyPercent.toFixed(2)}`;
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
                          £{ppo.toFixed(2)}
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
                      £{((sales[product.sku]?.revenue || 0) / salesDays).toFixed(0)}
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
      {filteredProducts.length > 100 && (
        <div className="mt-4 text-sm text-gray-500 text-center">
          Showing first 100 of {filteredProducts.length} products
        </div>
      )}
      </div>
    </div>
  );
}
