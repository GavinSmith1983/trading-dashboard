const fs = require('fs');
const path = require('path');
const response = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'products-full.json'), 'utf8'));
const body = JSON.parse(response.body);
const products = body.items;

// Filter products with sales and sort by revenue
const productsWithSales = products
  .filter(p => p.salesQuantity > 0 || p.salesRevenue > 0)
  .sort((a, b) => (b.salesRevenue || 0) - (a.salesRevenue || 0));

console.log('=== TOP 50 SELLING PRODUCTS (Last 90 Days) ===\n');
console.log('Total products with sales:', productsWithSales.length);
console.log('\n');

productsWithSales.slice(0, 50).forEach((p, i) => {
  console.log(`${i+1}. SKU: ${p.sku}`);
  console.log(`   Title: ${p.title}`);
  console.log(`   Brand: ${p.brand || 'N/A'}`);
  console.log(`   Price: £${p.currentPrice?.toFixed(2) || 'N/A'}`);
  console.log(`   Qty Sold: ${p.salesQuantity || 0} | Revenue: £${(p.salesRevenue || 0).toFixed(2)}`);
  console.log('');
});
