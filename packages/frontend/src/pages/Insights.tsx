import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  TrendingDown,
  Package,
  DollarSign,
  Tag,
  FileQuestion,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ArrowRight,
  ListChecks,
} from 'lucide-react';
import { analyticsApi, proposalsApi, type InsightCategory, type InsightProduct } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

const severityColors = {
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-800',
    icon: 'text-red-500',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800',
    icon: 'text-amber-500',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-800',
    icon: 'text-blue-500',
  },
};

const insightIcons: Record<string, React.ElementType> = {
  'low-sales-high-margin': TrendingUp,
  'danger-stock': AlertTriangle,
  'oos-stock': Package,
  'low-margin': TrendingDown,
  'negative-margin': DollarSign,
  'no-price': Tag,
  'no-title': FileQuestion,
};

// Suggested actions for each insight type
const insightActions: Record<string, { action: string; suggestion: string }> = {
  'low-sales-high-margin': {
    action: 'Consider price reduction',
    suggestion: 'These products have high margins but low sales. Reducing prices could increase volume.',
  },
  'danger-stock': {
    action: 'Consider price increase',
    suggestion: 'Fast-selling items with low stock. Raising prices can protect margins while stock is limited.',
  },
  'oos-stock': {
    action: 'Restock urgently',
    suggestion: 'High-demand products with no stock. Prioritize restocking to capture lost sales.',
  },
  'low-margin': {
    action: 'Review pricing',
    suggestion: 'Margins are below target. Consider price increases or cost reductions.',
  },
  'negative-margin': {
    action: 'Increase prices immediately',
    suggestion: 'These products are losing money on every sale. Urgent price correction needed.',
  },
  'no-price': {
    action: 'Set prices',
    suggestion: 'Products without prices cannot be sold. Set prices to activate listings.',
  },
  'no-title': {
    action: 'Add product titles',
    suggestion: 'Missing titles affect search visibility and customer experience.',
  },
};

function InsightCard({
  insight,
  isExpanded,
  onToggle,
  currencySymbol,
}: {
  insight: InsightCategory;
  isExpanded: boolean;
  onToggle: () => void;
  currencySymbol: string;
}) {
  const colors = severityColors[insight.severity];
  const Icon = insightIcons[insight.id] || AlertTriangle;
  const actionInfo = insightActions[insight.id];

  if (insight.count === 0) {
    return null;
  }

  return (
    <Card className={`${colors.bg} ${colors.border} border-2`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${colors.badge}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className={`text-lg ${colors.text}`}>{insight.title}</CardTitle>
              <p className="text-sm text-gray-600 mt-1">{insight.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className={`text-2xl font-bold ${colors.text}`}>{insight.count}</span>
              {insight.dailyRevenueImpact !== undefined && insight.dailyRevenueImpact > 0 && (
                <p className={`text-sm font-medium ${colors.text}`}>
                  {currencySymbol}{insight.dailyRevenueImpact.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/day at risk
                </p>
              )}
            </div>
            <button
              onClick={onToggle}
              className="p-1 hover:bg-white/50 rounded-lg transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              )}
            </button>
          </div>
        </div>
        {/* Suggested Action */}
        {actionInfo && (
          <div className="mt-3 flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <ArrowRight className={`h-4 w-4 ${colors.icon}`} />
              <span className="text-sm font-medium text-gray-700">{actionInfo.action}</span>
              <span className="text-xs text-gray-500">— {actionInfo.suggestion}</span>
            </div>
            <Link
              to="/proposals"
              className={`flex items-center gap-1 text-sm font-medium ${colors.text} hover:underline`}
            >
              <ListChecks className="h-4 w-4" />
              View Proposals
            </Link>
          </div>
        )}
      </CardHeader>

      {isExpanded && insight.products.length > 0 && (
        <CardContent className="pt-0">
          <div className="mt-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Product
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Price
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Margin
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Sales/Day
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Stock
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Days Stock
                  </th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {insight.products.slice(0, 20).map((product) => (
                  <ProductRow key={product.sku} product={product} currencySymbol={currencySymbol} />
                ))}
              </tbody>
            </table>
            {insight.products.length > 20 && (
              <div className="px-4 py-2 bg-gray-50 text-sm text-gray-500 text-center">
                Showing 20 of {insight.count} products
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ProductRow({ product, currencySymbol }: { product: InsightProduct; currencySymbol: string }) {
  const marginColor =
    product.margin < 0
      ? 'text-red-600'
      : product.margin < 25
        ? 'text-amber-600'
        : 'text-green-600';

  const stockColor =
    product.stockLevel === 0
      ? 'text-red-600'
      : product.stockLevel < 10
        ? 'text-amber-600'
        : 'text-gray-900';

  const daysStockColor =
    product.daysOfStock === null
      ? 'text-gray-400'
      : product.daysOfStock < 14
        ? 'text-red-600'
        : product.daysOfStock < 30
          ? 'text-amber-600'
          : 'text-green-600';

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {product.imageUrl && (
            <img
              src={product.imageUrl}
              alt=""
              className="w-10 h-10 object-cover rounded"
            />
          )}
          <div className="min-w-0">
            <p className="font-medium text-gray-900 truncate max-w-xs">{product.sku}</p>
            <p className="text-sm text-gray-500 truncate max-w-xs">
              {product.title || 'No title'}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right text-gray-900">
        {product.currentPrice > 0 ? `${currencySymbol}${product.currentPrice.toFixed(2)}` : '-'}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${marginColor}`}>
        {product.margin.toFixed(1)}%
      </td>
      <td className="px-4 py-3 text-right text-gray-900">
        {product.avgDailySales.toFixed(2)}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${stockColor}`}>
        {product.stockLevel}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${daysStockColor}`}>
        {product.daysOfStock !== null ? Math.round(product.daysOfStock) : '-'}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={`/products/${encodeURIComponent(product.sku)}`}
          className="text-blue-600 hover:text-blue-800"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  );
}

export default function Insights() {
  const { accountId } = useAccountQuery();
  const { currencySymbol } = useAccount();
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['insights', accountId],
    queryFn: () => analyticsApi.insights(),
  });

  const { data: proposalsData } = useQuery({
    queryKey: ['proposals', accountId, { status: 'pending' }],
    queryFn: () => proposalsApi.list({ status: 'pending', pageSize: 1 }),
  });

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Analyzing product data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load insights'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const insights = data?.insights || [];
  const criticalCount = insights
    .filter((i) => i.severity === 'critical')
    .reduce((sum, i) => sum + i.count, 0);
  const warningCount = insights
    .filter((i) => i.severity === 'warning')
    .reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Product Insights</h1>
        <p className="mt-1 text-sm text-gray-500">
          Actionable insights to optimize your product catalog
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="bg-red-50 border-red-200 border">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
                <p className="text-sm text-red-600">Critical Issues</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200 border">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold text-amber-700">{warningCount}</p>
                <p className="text-sm text-amber-600">Warnings</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200 border">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold text-green-700">
                  {insights.filter((i) => i.count === 0).length}
                </p>
                <p className="text-sm text-green-600">Categories Clear</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Link to="/proposals">
          <Card className="bg-purple-50 border-purple-200 border hover:bg-purple-100 transition-colors cursor-pointer h-full">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <ListChecks className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold text-purple-700">
                    {proposalsData?.totalCount || 0}
                  </p>
                  <p className="text-sm text-purple-600">Pending Proposals</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Insight Cards */}
      <div className="space-y-4">
        {insights
          .filter((insight) => insight.count > 0)
          .sort((a, b) => {
            // Sort by severity first (critical > warning > info)
            const severityOrder = { critical: 0, warning: 1, info: 2 };
            if (severityOrder[a.severity] !== severityOrder[b.severity]) {
              return severityOrder[a.severity] - severityOrder[b.severity];
            }
            // Then by count descending
            return b.count - a.count;
          })
          .map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              isExpanded={expandedCards.has(insight.id)}
              onToggle={() => toggleCard(insight.id)}
              currencySymbol={currencySymbol}
            />
          ))}

        {insights.every((i) => i.count === 0) && (
          <Card className="bg-green-50 border-green-200 border-2">
            <CardContent className="py-8 text-center">
              <Package className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-green-700">All Clear!</h3>
              <p className="text-sm text-green-600 mt-1">
                No issues found in your product catalog.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
