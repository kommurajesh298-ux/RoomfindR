import React, { Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./contexts/AuthContext";
import { useAuth } from "./hooks/useAuth";
import { useOwner } from "./hooks/useOwner";
import { OwnerProvider } from "./contexts/OwnerContext";
import { SiteProvider } from "./contexts/SiteContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import ErrorBoundary from "./components/common/ErrorBoundary";
// Layout
import Navbar from "./components/layout/Navbar";
import BottomNav from "./components/layout/BottomNav";
import Footer from "./components/layout/Footer";
import VerificationBanner from "./components/common/VerificationBanner";
import PendingApprovalPanel from "./components/common/PendingApprovalPanel";
import LoadingOverlay from "./components/common/LoadingOverlay";
import ProfilePlaceholder from "./pages/ProfilePlaceholder";
import { hideInitialSplash, preloadTasksWhenIdle } from "./utils/appBoot";
import { lazyWithPreload } from "./utils/lazyWithPreload";
import { registerNativeAppBridge } from "./services/native-bridge.service";

const Signup = lazyWithPreload(() => import("./pages/Signup"));
const Login = lazyWithPreload(() => import("./pages/Login"));
const ForgotPassword = lazyWithPreload(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyWithPreload(() => import("./pages/ResetPassword"));
const Dashboard = lazyWithPreload(() => import("./pages/Dashboard"));
const Properties = lazyWithPreload(() => import("./pages/Properties"));
const Bookings = lazyWithPreload(() => import("./pages/Bookings"));
const OwnerChat = lazyWithPreload(() => import("./pages/OwnerChat"));
const AddProperty = lazyWithPreload(() => import("./pages/AddProperty"));
const PropertyManage = lazyWithPreload(() => import("./pages/PropertyManage"));
const Settlements = lazyWithPreload(() => import("./pages/Settlements"));
const Ratings = lazyWithPreload(() => import("./pages/Ratings"));
const PrivacyPolicy = lazyWithPreload(() =>
  import("./pages/Legal").then((module) => ({ default: module.PrivacyPolicy }))
);
const TermsOfService = lazyWithPreload(() =>
  import("./pages/Legal").then((module) => ({ default: module.TermsOfService }))
);
const PaymentConfirmedPage = lazyWithPreload(() => import("./pages/PaymentConfirmedPage"));
const PaymentErrorPage = lazyWithPreload(() => import("./pages/PaymentErrorPage"));
const PaymentStatusPage = lazyWithPreload(() => import("./pages/PaymentStatusPage"));

const RouteLoader = () => (
  <LoadingOverlay message="Loading page..." />
);

const NativeAppBridge: React.FC = () => {
  const navigate = useNavigate();

  React.useEffect(() => {
    return registerNativeAppBridge(navigate);
  }, [navigate]);

  return null;
};

// Wrapper to conditionally render layout
const LayoutWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const location = useLocation();
  const { currentUser, userData, ownerData } = useAuth();
  const { verificationStatus } = useOwner();
  const isAuthPage = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ].includes(location.pathname);
  const isAddPropertyPage =
    location.pathname === "/properties/add" ||
    location.pathname.startsWith("/properties/edit/");
  const isPendingApprovalOwner =
    !!currentUser &&
    !verificationStatus &&
    (userData?.role === "owner" || !!ownerData);

  React.useEffect(() => {
    return hideInitialSplash({
      minimumVisibleMs: 2200,
      maximumVisibleMs: 2400,
      exitAnimationMs: 420,
    });
  }, []);

  return (
    <>
      {!isAuthPage && !isPendingApprovalOwner && <Navbar />}
      {!isAuthPage && !isPendingApprovalOwner && <VerificationBanner />}
      {children}
      {!isAuthPage && !isPendingApprovalOwner && <Footer />}
      {!isAuthPage && !isPendingApprovalOwner && !isAddPropertyPage && (
        <BottomNav />
      )}
    </>
  );
};

function App() {
  React.useEffect(() => {
    return preloadTasksWhenIdle([
      Dashboard.preload,
      Properties.preload,
      Bookings.preload,
      OwnerChat.preload,
      AddProperty.preload,
      PropertyManage.preload,
      Settlements.preload,
      Ratings.preload,
      PaymentStatusPage.preload,
    ], 1200);
  }, []);

  return (
    <ErrorBoundary>
      <Router>
        <NativeAppBridge />
        <SiteProvider>
          <AuthProvider>
            <OwnerProvider>
              <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
                <Toaster
                  position="top-center"
                  reverseOrder={false}
                  toastOptions={{
                    className: "premium-toast",
                    style: {
                      borderRadius: "12px",
                      background: "#fff",
                      color: "#1f2937",
                      boxShadow:
                        "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                    },
                  }}
                />
                <LayoutWrapper>
                  <Suspense fallback={<RouteLoader />}>
                    <Routes>
                    {/* Public Routes */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    {/* Protected Routes */}
                    <Route
                      path="/"
                      element={
                        <ProtectedRoute>
                          <Navigate to="/dashboard" replace />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/dashboard"
                      element={
                        <ProtectedRoute>
                          <Dashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/properties"
                      element={
                        <ProtectedRoute>
                          <Properties />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/rooms"
                      element={
                        <ProtectedRoute>
                          <Navigate to="/properties?nav=rooms" replace />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/properties/add"
                      element={
                        <ProtectedRoute>
                          <AddProperty />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/properties/:id"
                      element={
                        <ProtectedRoute>
                          <PropertyManage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/properties/edit/:id"
                      element={
                        <ProtectedRoute>
                          <AddProperty />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/bookings"
                      element={
                        <ProtectedRoute>
                          <Bookings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/payments"
                      element={
                        <ProtectedRoute>
                          <Navigate to="/settlements" replace />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/settlements"
                      element={
                        <ProtectedRoute>
                          <Settlements />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/ratings"
                      element={
                        <ProtectedRoute>
                          <Ratings />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/messages"
                      element={
                        <ProtectedRoute>
                          <Navigate to="/chat" replace />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/chat"
                      element={
                        <ProtectedRoute>
                          <OwnerChat />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/verification-status"
                      element={
                        <ProtectedRoute>
                          <PendingApprovalPanel />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/profile"
                      element={
                        <ProtectedRoute>
                          <ProfilePlaceholder />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route
                      path="/notifications"
                      element={<Navigate to="/bookings" replace />}
                    />
                    <Route
                      path="/payment-status"
                      element={
                        <ProtectedRoute>
                          <PaymentStatusPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/payment/confirmed"
                      element={
                        <ProtectedRoute>
                          <PaymentConfirmedPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/payment/error"
                      element={
                        <ProtectedRoute>
                          <PaymentErrorPage />
                        </ProtectedRoute>
                      }
                    />

                    {/* Catch all */}
                    <Route
                      path="*"
                      element={<Navigate to="/dashboard" replace />}
                    />
                    </Routes>
                  </Suspense>
                </LayoutWrapper>
              </div>
            </OwnerProvider>
          </AuthProvider>
        </SiteProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
