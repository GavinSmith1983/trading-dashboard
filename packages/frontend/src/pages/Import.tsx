import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle, AlertCircle, Download, Truck, DollarSign } from 'lucide-react';
import * as XLSX from 'xlsx';
import { importApi, DeliveryImportResult } from '../api';
import { Card, CardHeader, CardContent } from '../components/Card';
import Button from '../components/Button';

interface CostParsedRow {
  sku: string;
  costPrice: number;
  deliveryCost?: number;
}

interface DeliveryParsedRow {
  orderNumber: string;
  parcels: number;
  carrier: string;
}

interface CostImportResult {
  updated: number;
  notFoundInDb: number;
  matchedByBalterleySku?: number;
  total: number;
  sampleNotFoundInDb?: string[];
  dbProductsMissingFromFile: number;
  sampleDbSkusMissingFromFile?: string[];
}

type ImportTab = 'costs' | 'delivery';

export default function Import() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ImportTab>('costs');

  // Cost import state
  const [costFile, setCostFile] = useState<File | null>(null);
  const [costParsedData, setCostParsedData] = useState<CostParsedRow[]>([]);
  const [costParseError, setCostParseError] = useState<string | null>(null);
  const [costResult, setCostResult] = useState<CostImportResult | null>(null);

  // Delivery import state
  const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
  const [deliveryParsedData, setDeliveryParsedData] = useState<DeliveryParsedRow[]>([]);
  const [deliveryParseError, setDeliveryParseError] = useState<string | null>(null);
  const [deliveryResult, setDeliveryResult] = useState<DeliveryImportResult | null>(null);

  const costImportMutation = useMutation({
    mutationFn: (data: CostParsedRow[]) => importApi.costs(data),
    onSuccess: (data) => {
      setCostResult(data);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const deliveryImportMutation = useMutation({
    mutationFn: (data: DeliveryParsedRow[]) => importApi.delivery(data),
    onSuccess: (data) => {
      setDeliveryResult(data);
      queryClient.invalidateQueries({ queryKey: ['carriers'] });
    },
  });

  /**
   * Parse a CSV line handling quoted fields properly
   */
  const parseCSVLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
  };

  /**
   * Parse a numeric value, handling currency symbols, commas, and various formats
   */
  const parseNumber = (value: string | undefined): number => {
    if (!value) return 0;
    const cleaned = value.replace(/[£$€\s,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const parseCostCSV = useCallback((text: string): CostParsedRow[] => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }

    const headerValues = parseCSVLine(lines[0]);
    const header = headerValues.map((h) => h.toLowerCase().replace(/^["']|["']$/g, '').trim());

    const skuIndex = header.findIndex((h) => h === 'sku' || h === 'product_sku' || h === 'product sku');
    const costIndex = header.findIndex((h) => h === 'cost' || h === 'cost_price' || h === 'costprice' || h === 'cost price');
    const deliveryIndex = header.findIndex((h) => h === 'delivery' || h === 'delivery_cost' || h === 'deliverycost' || h === 'delivery cost');

    if (skuIndex === -1) {
      throw new Error('CSV must have a SKU column (sku, product_sku, or product sku)');
    }
    if (costIndex === -1) {
      throw new Error('CSV must have a cost column (cost, cost_price, or costprice)');
    }

    const data: CostParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);

      const sku = values[skuIndex]?.replace(/^["']|["']$/g, '').trim();
      const costPrice = parseNumber(values[costIndex]);
      const deliveryCost = deliveryIndex >= 0 ? parseNumber(values[deliveryIndex]) : undefined;

      if (sku && costPrice > 0) {
        data.push({ sku, costPrice, deliveryCost });
      }
    }

    return data;
  }, []);

  const parseDeliveryCSV = useCallback((text: string): DeliveryParsedRow[] => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }

    const headerValues = parseCSVLine(lines[0]);
    // Clean headers: remove BOM, quotes, normalize whitespace and special chars
    const header = headerValues.map((h) =>
      h.toLowerCase()
        .replace(/^["']|["']$/g, '')
        .replace(/[\ufeff\u200b\u00a0]/g, '') // Remove BOM and zero-width chars
        .replace(/\s+/g, '') // Remove all whitespace
        .trim()
    );

    // Debug: log first 5 headers to help troubleshoot
    console.log('CSV Headers found:', header.slice(0, 40));

    // Vector Summary columns - more flexible matching
    const orderIndex = header.findIndex((h) =>
      h === 'ponumber' || h === 'po' ||
      h.includes('ponumber') || h.includes('pono')
    );
    const parcelsIndex = header.findIndex((h) =>
      h === 'noofpackages' || h === 'parcels' || h === 'packages' ||
      h.includes('noofpackages') || h.includes('numberofpackages')
    );
    const carrierIndex = header.findIndex((h) =>
      h === 'actualcarrier' || h === 'carrier' ||
      h.includes('actualcarrier') || h.includes('carrier')
    );

    if (orderIndex === -1) {
      throw new Error(`CSV must have a PONumber or OrderNumber column. Found headers: ${header.slice(0, 10).join(', ')}...`);
    }
    if (carrierIndex === -1) {
      throw new Error(`CSV must have an ActualCarrier or Carrier column. Found headers: ${header.slice(0, 10).join(', ')}...`);
    }

    const data: DeliveryParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);

      const orderNumber = values[orderIndex]?.replace(/^["']|["']$/g, '').trim();
      const parcels = parcelsIndex >= 0 ? parseInt(values[parcelsIndex]) || 1 : 1;
      const carrier = values[carrierIndex]?.replace(/^["']|["']$/g, '').trim() || '';

      if (orderNumber && carrier) {
        data.push({ orderNumber, parcels, carrier });
      }
    }

    return data;
  }, []);

  const handleCostFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setCostFile(selectedFile);
    setCostParseError(null);
    setCostParsedData([]);
    setCostResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = parseCostCSV(text);
        setCostParsedData(data);
      } catch (err) {
        setCostParseError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(selectedFile);
  };

  /**
   * Parse Excel file (XLSX) to extract delivery data
   */
  const parseDeliveryXLSX = useCallback((data: ArrayBuffer): DeliveryParsedRow[] => {
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Convert to JSON with header row
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

    if (jsonData.length === 0) {
      throw new Error('Excel file is empty or has no data rows');
    }

    // Get headers from first row keys
    const headers = Object.keys(jsonData[0]).map(h =>
      h.toLowerCase().replace(/\s+/g, '').trim()
    );

    console.log('Excel Headers found:', headers);

    // Find column indices
    const orderKey = Object.keys(jsonData[0]).find(k => {
      const h = k.toLowerCase().replace(/\s+/g, '');
      return h === 'ponumber' || h === 'po' ||
        h.includes('ponumber') || h.includes('pono');
    });

    const parcelsKey = Object.keys(jsonData[0]).find(k => {
      const h = k.toLowerCase().replace(/\s+/g, '');
      return h === 'noofpackages' || h === 'parcels' || h === 'packages' ||
        h.includes('noofpackages') || h.includes('numberofpackages');
    });

    // Prioritize ActualCarrier over generic Carrier matches
    const carrierKey = Object.keys(jsonData[0]).find(k => {
      const h = k.toLowerCase().replace(/\s+/g, '');
      return h === 'actualcarrier' || h.includes('actualcarrier');
    }) || Object.keys(jsonData[0]).find(k => {
      const h = k.toLowerCase().replace(/\s+/g, '');
      // Match "carrier" but not "carrierroute" or similar
      return h === 'carrier' || (h.includes('carrier') && !h.includes('route'));
    });

    console.log('Matched columns - Order:', orderKey, 'Parcels:', parcelsKey, 'Carrier:', carrierKey);

    if (!orderKey) {
      throw new Error(`Excel must have a PONumber or OrderNumber column. Found columns: ${Object.keys(jsonData[0]).slice(0, 15).join(', ')}...`);
    }
    if (!carrierKey) {
      throw new Error(`Excel must have an ActualCarrier or Carrier column. Found columns: ${Object.keys(jsonData[0]).slice(0, 15).join(', ')}...`);
    }

    console.log(`Using column "${carrierKey}" for carrier data`);

    const result: DeliveryParsedRow[] = [];

    for (const row of jsonData) {
      const orderNumber = String(row[orderKey] || '').trim();
      const parcels = parcelsKey ? parseInt(String(row[parcelsKey])) || 1 : 1;
      const carrier = String(row[carrierKey] || '').trim();

      if (orderNumber && carrier) {
        result.push({ orderNumber, parcels, carrier });
      }
    }

    return result;
  }, []);

  const handleDeliveryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setDeliveryFile(selectedFile);
    setDeliveryParseError(null);
    setDeliveryParsedData([]);
    setDeliveryResult(null);

    const isExcel = selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        if (isExcel) {
          const data = parseDeliveryXLSX(event.target?.result as ArrayBuffer);
          setDeliveryParsedData(data);
        } else {
          const text = event.target?.result as string;
          const data = parseDeliveryCSV(text);
          setDeliveryParsedData(data);
        }
      } catch (err) {
        setDeliveryParseError(err instanceof Error ? err.message : 'Failed to parse file');
      }
    };

    if (isExcel) {
      reader.readAsArrayBuffer(selectedFile);
    } else {
      reader.readAsText(selectedFile);
    }
  };

  const handleCostImport = () => {
    if (costParsedData.length > 0) {
      costImportMutation.mutate(costParsedData);
    }
  };

  const handleDeliveryImport = () => {
    if (deliveryParsedData.length > 0) {
      deliveryImportMutation.mutate(deliveryParsedData);
    }
  };

  const downloadCostTemplate = () => {
    const csv = 'sku,cost_price,delivery_cost\nA376,5.50,2.00\nFR201,7.25,2.50\nFR203,7.25,2.50';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cost_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Import Data</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload CSV files for product costs or delivery reports
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('costs')}
            className={`pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'costs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <DollarSign className="h-4 w-4 inline mr-2" />
            Product Costs
          </button>
          <button
            onClick={() => setActiveTab('delivery')}
            className={`pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'delivery'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Truck className="h-4 w-4 inline mr-2" />
            Delivery Report
          </button>
        </nav>
      </div>

      {/* Cost Import Tab */}
      {activeTab === 'costs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-900">Upload Cost CSV</h2>
            </CardHeader>
            <CardContent>
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">
                  Download a template to see the expected format:
                </p>
                <Button variant="secondary" size="sm" onClick={downloadCostTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
              </div>

              <div className="mb-6">
                <label className="block">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer">
                    <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-sm text-gray-600 mb-2">
                      {costFile ? costFile.name : 'Click to upload or drag and drop'}
                    </p>
                    <p className="text-xs text-gray-500">CSV files only</p>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCostFileChange}
                      className="hidden"
                    />
                  </div>
                </label>
              </div>

              {costParseError && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">Parse Error</p>
                    <p className="text-sm text-red-600">{costParseError}</p>
                  </div>
                </div>
              )}

              {costParsedData.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Preview ({costParsedData.length} rows)
                  </p>
                  <div className="max-h-48 overflow-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">SKU</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Cost</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Delivery</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {costParsedData.slice(0, 10).map((row, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono">{row.sku}</td>
                            <td className="px-3 py-2">£{row.costPrice.toFixed(2)}</td>
                            <td className="px-3 py-2">
                              {row.deliveryCost ? `£${row.deliveryCost.toFixed(2)}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {costParsedData.length > 10 && (
                      <p className="px-3 py-2 text-xs text-gray-500 bg-gray-50">
                        ... and {costParsedData.length - 10} more rows
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Button
                onClick={handleCostImport}
                disabled={costParsedData.length === 0 || costImportMutation.isPending}
                className="w-full"
              >
                {costImportMutation.isPending ? 'Importing...' : `Import ${costParsedData.length} Products`}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-900">Import Results</h2>
            </CardHeader>
            <CardContent>
              {costResult ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-4 bg-green-50 rounded-lg">
                    <CheckCircle className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="font-semibold text-green-800">Import Complete</p>
                      <p className="text-sm text-green-600">
                        Successfully processed {costResult.total} rows
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-gray-900">{costResult.total}</p>
                      <p className="text-sm text-gray-500">File Rows</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{costResult.updated}</p>
                      <p className="text-sm text-gray-500">Updated</p>
                    </div>
                    <div className="p-4 bg-yellow-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-yellow-600">{costResult.notFoundInDb}</p>
                      <p className="text-sm text-gray-500">File SKUs Not in DB</p>
                    </div>
                    <div className="p-4 bg-red-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-red-600">{costResult.dbProductsMissingFromFile}</p>
                      <p className="text-sm text-gray-500">DB SKUs Missing Costs</p>
                    </div>
                  </div>

                  {costResult.matchedByBalterleySku !== undefined && costResult.matchedByBalterleySku > 0 && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-blue-800">
                        <strong>{costResult.matchedByBalterleySku}</strong> products were matched using Balterley SKU.
                      </p>
                    </div>
                  )}

                  {costResult.dbProductsMissingFromFile > 0 && costResult.sampleDbSkusMissingFromFile && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800 mb-2">
                        <strong>{costResult.dbProductsMissingFromFile}</strong> products in the database were not in your cost file:
                      </p>
                      <div className="mt-2">
                        <p className="text-xs font-medium text-red-700 mb-1">Sample DB SKUs missing from file:</p>
                        <p className="text-xs text-red-600 font-mono break-all">
                          {costResult.sampleDbSkusMissingFromFile.slice(0, 20).join(', ')}
                          {costResult.sampleDbSkusMissingFromFile.length > 20 && '...'}
                        </p>
                      </div>
                    </div>
                  )}

                  {costResult.notFoundInDb > 0 && costResult.sampleNotFoundInDb && (
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800 mb-2">
                        <strong>{costResult.notFoundInDb}</strong> SKUs in your file were not found in the database:
                      </p>
                      <div className="mt-2">
                        <p className="text-xs font-medium text-yellow-700 mb-1">Sample file SKUs not in DB:</p>
                        <p className="text-xs text-yellow-600 font-mono break-all">
                          {costResult.sampleNotFoundInDb.slice(0, 10).join(', ')}
                          {costResult.sampleNotFoundInDb.length > 10 && '...'}
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCostFile(null);
                      setCostParsedData([]);
                      setCostResult(null);
                    }}
                    className="w-full"
                  >
                    Import Another File
                  </Button>
                </div>
              ) : (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">Upload a CSV file to see results</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delivery Import Tab */}
      {activeTab === 'delivery' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-900">Upload Vector Summary</h2>
            </CardHeader>
            <CardContent>
              <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  Upload your Vector Summary report (Excel or CSV). The system will extract carrier information
                  and create carrier entries on the Delivery Costs page.
                </p>
              </div>

              <div className="mb-6">
                <label className="block">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer">
                    <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-sm text-gray-600 mb-2">
                      {deliveryFile ? deliveryFile.name : 'Click to upload Vector Summary'}
                    </p>
                    <p className="text-xs text-gray-500">Excel (.xlsx) or CSV files</p>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleDeliveryFileChange}
                      className="hidden"
                    />
                  </div>
                </label>
              </div>

              {deliveryParseError && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">Parse Error</p>
                    <p className="text-sm text-red-600">{deliveryParseError}</p>
                  </div>
                </div>
              )}

              {deliveryParsedData.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Preview ({deliveryParsedData.length} delivery records)
                  </p>
                  <div className="max-h-48 overflow-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Parcels</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Carrier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {deliveryParsedData.slice(0, 10).map((row, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono text-xs">{row.orderNumber}</td>
                            <td className="px-3 py-2">{row.parcels}</td>
                            <td className="px-3 py-2">{row.carrier || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {deliveryParsedData.length > 10 && (
                      <p className="px-3 py-2 text-xs text-gray-500 bg-gray-50">
                        ... and {deliveryParsedData.length - 10} more records
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Button
                onClick={handleDeliveryImport}
                disabled={deliveryParsedData.length === 0 || deliveryImportMutation.isPending}
                className="w-full"
              >
                {deliveryImportMutation.isPending ? 'Processing...' : `Process ${deliveryParsedData.length} Delivery Records`}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-900">Import Results</h2>
            </CardHeader>
            <CardContent>
              {deliveryResult ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-4 bg-green-50 rounded-lg">
                    <CheckCircle className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="font-semibold text-green-800">Processing Complete</p>
                      <p className="text-sm text-green-600">
                        Matched {deliveryResult.ordersMatched} orders from {deliveryResult.ordersProcessed} records
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-gray-900">{deliveryResult.ordersProcessed}</p>
                      <p className="text-sm text-gray-500">Records Processed</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{deliveryResult.ordersMatched}</p>
                      <p className="text-sm text-gray-500">Orders Updated</p>
                    </div>
                    <div className="p-4 bg-yellow-50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-yellow-600">{deliveryResult.ordersNotFound}</p>
                      <p className="text-sm text-gray-500">Not Found</p>
                    </div>
                    <div className="p-4 bg-gray-100 rounded-lg text-center">
                      <p className="text-2xl font-bold text-gray-500">{deliveryResult.ordersSkipped}</p>
                      <p className="text-sm text-gray-500">Skipped (Excluded)</p>
                    </div>
                  </div>

                  {deliveryResult.excludedCarriers && deliveryResult.excludedCarriers.length > 0 && (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-2">Excluded Carriers (skipped):</p>
                      <div className="flex flex-wrap gap-2">
                        {deliveryResult.excludedCarriers.map((carrier) => (
                          <span
                            key={carrier}
                            className="px-2 py-1 bg-gray-200 border border-gray-300 rounded text-sm text-gray-600"
                          >
                            {carrier}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {deliveryResult.carriersFound.length > 0 && (
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-2">Carriers Found ({deliveryResult.carriersFound.length}):</p>
                      <div className="flex flex-wrap gap-2">
                        {deliveryResult.carriersFound.map((carrier) => (
                          <span
                            key={carrier}
                            className="px-2 py-1 bg-white border border-gray-200 rounded text-sm"
                          >
                            {carrier}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {deliveryResult.newCarriersCreated.length > 0 && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-800 mb-2">
                        <strong>{deliveryResult.newCarriersCreated.length}</strong> new carrier(s) added:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {deliveryResult.newCarriersCreated.map((carrier) => (
                          <span
                            key={carrier}
                            className="px-2 py-1 bg-green-100 border border-green-300 rounded text-sm text-green-800"
                          >
                            {carrier}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      {deliveryResult.note}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDeliveryFile(null);
                      setDeliveryParsedData([]);
                      setDeliveryResult(null);
                    }}
                    className="w-full"
                  >
                    Import Another File
                  </Button>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Truck className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">Upload a Vector Summary to see results</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Format Info */}
      {activeTab === 'costs' && (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Expected CSV Format</h2>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Column</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Required</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Description</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr>
                    <td className="px-4 py-2 font-mono">sku</td>
                    <td className="px-4 py-2">Yes</td>
                    <td className="px-4 py-2 text-gray-600">Product SKU (must match existing products)</td>
                    <td className="px-4 py-2 font-mono text-gray-500">A376</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono">cost_price</td>
                    <td className="px-4 py-2">Yes</td>
                    <td className="px-4 py-2 text-gray-600">Product cost (COGS)</td>
                    <td className="px-4 py-2 font-mono text-gray-500">5.50</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono">delivery_cost</td>
                    <td className="px-4 py-2">No</td>
                    <td className="px-4 py-2 text-gray-600">Fixed delivery cost per unit</td>
                    <td className="px-4 py-2 font-mono text-gray-500">2.00</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'delivery' && (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Vector Summary Format</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Export your Vector Summary report as CSV. The system looks for these columns:
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Column</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Required</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr>
                    <td className="px-4 py-2 font-mono">PONumber</td>
                    <td className="px-4 py-2">Yes</td>
                    <td className="px-4 py-2 text-gray-600">Order reference number (Column P)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono">NoOfPackages</td>
                    <td className="px-4 py-2">No</td>
                    <td className="px-4 py-2 text-gray-600">Number of parcels (Column AD)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono">ActualCarrier</td>
                    <td className="px-4 py-2">Yes</td>
                    <td className="px-4 py-2 text-gray-600">Carrier used for delivery (Column AL)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
