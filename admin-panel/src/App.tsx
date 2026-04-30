import React, { Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import ErrorBoundary from './components/common/ErrorBoundary';
import LoadingOverlay from './components/common/LoadingOverlay';
import { hideInitialSplash, preloadTasksWhenIdle } from './utils/appBoot';
import { lazyWithPreload } from './utils/lazyWithPreload';
import { registerNativeAppBridge } from './services/native-bridge.service';

const Login = lazyWithPreload(() => import('./pages/Login'));
const Owners = lazyWithPreload(() => import('./pages/Owners'));
const Customers = lazyWithPreload(() => import('./pages/Customers'));
const Properties = lazyWithPreload(() => import('./pages/Properties'));
const Dashboard = lazyWithPreload(() => import('./pages/Dashboard'));
const Analytics = lazyWithPreload(() => import('./pages/Analytics'));
const Bookings = lazyWithPreload(() => import('./pages/Bookings'));
const Settings = lazyWithPreload(() => import('./pages/Settings'));
const Tickets = lazyWithPreload(() => import('./pages/Tickets'));
const Offers = lazyWithPreload(() => import('./pages/Offers'));
const PropertyRooms = lazyWithPreload(() => import('./pages/PropertyRooms'));
const Settlements = lazyWithPreload(() => import('./pages/Settlements'));
const Refunds = lazyWithPreload(() => import('./pages/Refunds'));
const Rent = lazyWithPreload(() => import('./pages/Rent'));
const PaymentConfirmedPage = lazyWithPreload(() => import('./pages/PaymentConfirmedPage'));
const PaymentErrorPage = lazyWithPreload(() => import('./pages/PaymentErrorPage'));
const PaymentStatusPage = lazyWithPreload(() => import('./pages/PaymentStatusPage'));
const Reports = lazyWithPreload(() => import('./pages/Reports'));
const MainLayout = lazyWithPreload(() => import('./components/layout/MainLayout'));

const RouteLoader: React.FC = () => (
  <LoadingOverlay message="Loading page..." />
);

const NativeAppBridge: React.FC = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    return registerNativeAppBridge(navigate);
  }, [navigate]);

  return null;
};

const App: React.FC = () => {
  React.useEffect(() => {
    return hideInitialSplash({
      minimumVisibleMs: 1000,
      maximumVisibleMs: 1000,
      exitAnimationMs: 220,
    });
  }, []);

  React.useEffect(() => {
    return preloadTasksWhenIdle([
      Dashboard.preload,
      Owners.preload,
      Customers.preload,
      Properties.preload,
      Bookings.preload,
      Analytics.preload,
      Tickets.preload,
      Offers.preload,
      Reports.preload,
      Settings.preload,
      MainLayout.preload,
    ], 1000);
  }, []);

  return (
    <ErrorBoundary>
      <Router>
        <NativeAppBridge />
        <AuthProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1e293b',
                color: '#fff',
                borderRadius: '16px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
              }
            }}
          />
          <Suspense fallback={<RouteLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />

              {/* Protected Routes with MainLayout */}
              <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                <Route path="/" element={<Navigate to="/dashboard" />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/owners" element={<Owners />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/properties" element={<Properties />} />
                <Route path="/property-rooms" element={<PropertyRooms />} />
                <Route path="/bookings" element={<Bookings />} />
                <Route path="/rent" element={<Rent />} />
                <Route path="/settlements" element={<Settlements />} />
                <Route path="/refunds" element={<Refunds />} />
                <Route path="/tickets" element={<Tickets />} />
                <Route path="/offers" element={<Offers />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/payment-status" element={<PaymentStatusPage />} />
                <Route path="/payment/confirmed" element={<PaymentConfirmedPage />} />
                <Route path="/payment/error" element={<PaymentErrorPage />} />
              </Route>

              {/* 404 Redirect */}
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
