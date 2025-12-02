import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Proposals from './pages/Proposals';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Channels from './pages/Channels';
import DeliveryCosts from './pages/DeliveryCosts';
import Rules from './pages/Rules';
import Import from './pages/Import';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="proposals" element={<Proposals />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:sku" element={<ProductDetail />} />
          <Route path="channels" element={<Channels />} />
          <Route path="delivery-costs" element={<DeliveryCosts />} />
          <Route path="rules" element={<Rules />} />
          <Route path="import" element={<Import />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
