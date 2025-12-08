import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Insights from './pages/Insights';
import Proposals from './pages/Proposals';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Channels from './pages/Channels';
import DeliveryCosts from './pages/DeliveryCosts';
import Rules from './pages/Rules';
import Import from './pages/Import';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="sales" element={<Sales />} />
            <Route path="insights" element={<Insights />} />
            <Route path="proposals" element={<Proposals />} />
            <Route path="products" element={<Products />} />
            <Route path="products/:sku" element={<ProductDetail />} />
            <Route path="channels" element={<Channels />} />
            <Route path="delivery-costs" element={<DeliveryCosts />} />
            <Route
              path="rules"
              element={
                <ProtectedRoute requiredRole="admin">
                  <Rules />
                </ProtectedRoute>
              }
            />
            <Route
              path="import"
              element={
                <ProtectedRoute requiredRole="admin">
                  <Import />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
