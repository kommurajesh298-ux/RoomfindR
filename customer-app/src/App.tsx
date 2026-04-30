import { Suspense, useState, useEffect } from "react";
import {
  Routes,
  Route,
  useLocation,
  useNavigate,
  Navigate,
  useParams,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";
import Navbar from "./components/layout/Navbar";
import BottomNav from "./components/layout/BottomNav";
import Footer from "./components/layout/Footer";

import { useLayout } from "./hooks/useLayout";

// Page imports
import ProtectedRoute from "./components/common/ProtectedRoute";
import BookingStatusListener from "./components/common/BookingStatusListener";
import NetworkStatusListener from "./components/common/NetworkStatusListener";
import LoadingOverlay from "./components/common/LoadingOverlay";

const LocationModal = lazyWithPreload(() =>
  import("./components/home/LocationModal").then((module) => ({
    default: module.LocationModal,
  }))
);
const ProfileCompletionModal = lazyWithPreload(
  () => import("./components/auth/ProfileCompletionModal")
);
const FilterPanel = lazyWithPreload(() =>
  import("./components/home/FilterPanel").then((module) => ({
    default: module.FilterPanel,
  }))
);
import type { PropertyFilters } from "./types/property.types";
import { Capacitor } from "@capacitor/core";
import { SplashScreen as CapacitorSplashScreen } from "@capacitor/splash-screen";
import { registerNativeAppBridge } from "./services/native-bridge.service";
import { getLocationDisplayName } from "./services/location.service";
import { paymentService } from "./services/payment.service";
import { hideInitialSplash, preloadTasksWhenIdle } from "./utils/appBoot";
import { lazyWithPreload } from "./utils/lazyWithPreload";

const Home = lazyWithPreload(() => import("./pages/Home"));
const Login = lazyWithPreload(() => import("./pages/Login"));
const Signup = lazyWithPreload(() => import("./pages/Signup"));
const ForgotPassword = lazyWithPreload(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyWithPreload(() => import("./pages/ResetPassword"));
const PropertyDetails = lazyWithPreload(() => import("./pages/PropertyDetails"));
const Bookings = lazyWithPreload(() => import("./pages/Bookings"));
const Profile = lazyWithPreload(() => import("./pages/Profile"));
const Chat = lazyWithPreload(() => import("./pages/Chat"));
const Explore = lazyWithPreload(() => import("./pages/Explore"));
const PaymentPage = lazyWithPreload(() => import("./pages/PaymentPage"));
const PaymentConfirmedPage = lazyWithPreload(() => import("./pages/PaymentConfirmedPage"));
const PaymentErrorPage = lazyWithPreload(() => import("./pages/PaymentErrorPage"));
const PaymentStatusPage = lazyWithPreload(() => import("./pages/PaymentStatusPage"));
const PrivacyPolicy = lazyWithPreload(() =>
  import("./pages/Legal").then((module) => ({ default: module.PrivacyPolicy }))
);
const TermsOfService = lazyWithPreload(() =>
  import("./pages/Legal").then((module) => ({ default: module.TermsOfService }))
);
const AuthCallback = lazyWithPreload(() => import("./pages/AuthCallback"));

function RedirectToProperty() {
  const { id } = useParams();
  return <Navigate to={`/property/${id}`} replace />;
}

export default function App() {
  const {
    currentLocation,
    updateLocation,
    isFilterPanelOpen,
    setFilterPanelOpen,
    showNavbarSearch,
  } = useLayout();
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    return registerNativeAppBridge(navigate);
  }, [navigate]);

  useEffect(() => {
    const cleanupSplash = hideInitialSplash({
      minimumVisibleMs: 2200,
      maximumVisibleMs: 2400,
      exitAnimationMs: 420,
    });

    const nativeHideTimer = window.setTimeout(() => {
      if (Capacitor.isNativePlatform()) {
        void CapacitorSplashScreen.hide();
      }
    }, 260);

    return () => {
      cleanupSplash();
      window.clearTimeout(nativeHideTimer);
    };
  }, []);

  useEffect(() => {
    return preloadTasksWhenIdle([
      ProfileCompletionModal.preload,
      LocationModal.preload,
      FilterPanel.preload,
      () => paymentService.preloadProvider(),
    ], 1200);
  }, []);

  // Parse initial filters from URL
  const parseFiltersFromUrl = (search: string): PropertyFilters => {
    const params = new URLSearchParams(search);
    return {
      searchQuery: params.get("search") || undefined,
      tags: params.get("tags")?.split(",").filter(Boolean) || undefined,
      priceRange:
        params.get("minPrice") || params.get("maxPrice")
          ? {
              min: Number(params.get("minPrice") || 0),
              max: Number(params.get("maxPrice") || 100000),
            }
          : undefined,
      features:
        (params.get("features")?.split(",").filter(Boolean) as string[]) ||
        undefined,
      sortBy: (params.get("sortBy") as PropertyFilters["sortBy"]) || undefined,
      city: currentLocation?.city,
    };
  };

  // Derive filters from URL
  const filters = parseFiltersFromUrl(location.search);

  const isAuthPage = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ].includes(location.pathname);
  const isPaymentPage = location.pathname.startsWith("/payment");
  const isChatPage = location.pathname.startsWith("/chat");

  const handleFilterApply = (newFilters: PropertyFilters) => {
    setFilterPanelOpen(false);

    // Build query params from filters
    const params = new URLSearchParams();
    if (newFilters.searchQuery) params.set("search", newFilters.searchQuery);
    if (newFilters.tags && newFilters.tags.length > 0)
      params.set("tags", newFilters.tags.join(","));
    if (newFilters.priceRange?.min)
      params.set("minPrice", newFilters.priceRange.min.toString());
    if (newFilters.priceRange?.max)
      params.set("maxPrice", newFilters.priceRange.max.toString());
    if (newFilters.features && newFilters.features.length > 0)
      params.set("features", newFilters.features.join(","));
    if (newFilters.sortBy) params.set("sortBy", newFilters.sortBy);

    // Navigate to home with filters
    navigate(`/?${params.toString()}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#E9E8F4] text-[#111827]">
      {/* Global Listeners */}
      <BookingStatusListener />
      <NetworkStatusListener />

      {/* Toast Notifications */}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
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

      {/* Navbar visibility handled responsively: Hidden on Auth/Payment pages, and hidden on mobile property detail pages */}
      {!isAuthPage && !isPaymentPage && (
        <div
          className={
            location.pathname.startsWith("/property/") || location.pathname.startsWith("/chat/")
              ? "hidden md:block"
              : location.pathname === "/chat"
                ? "hidden md:block"
                : ""
          }
        >
          <Navbar
            currentLocation={getLocationDisplayName(currentLocation)}
            onLocationClick={() => setIsLocationModalOpen(true)}
          />
        </div>
      )}

      {/* Location Modal */}
      <Suspense fallback={null}>
        {isLocationModalOpen && (
          <LocationModal
            onClose={() => setIsLocationModalOpen(false)}
            onSelectLocation={(loc) => {
              updateLocation(loc);
              setIsLocationModalOpen(false);
            }}
          />
        )}
      </Suspense>

      {/* Main Content */}
        <main
        className={`flex-1 transition-all duration-300 ${
          isAuthPage
            ? "pt-0 pb-0 md:pt-0"
            : location.pathname.startsWith("/property/") ||
                location.pathname.startsWith("/payment")
              ? "pt-0 md:pt-[73px] pb-0"
              : isChatPage
                ? "min-h-[calc(100dvh-76px)] pt-0 pb-20 md:min-h-[calc(100vh-73px)]"
              : (location.pathname === "/" || location.pathname === "/explore"
                  ? (location.pathname === "/"
                      ? "pt-0"
                      : showNavbarSearch
                        ? "pt-[132px]"
                        : "pt-[76px]") + " sm:pt-0"
                  : "pt-[76px]") + " pb-16"
        } ${isAuthPage ? "" : "md:pt-[73px] sm:pb-0"}`}
      >
        <Suspense fallback={<LoadingOverlay message="Loading screen" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/property/:id" element={<PropertyDetails />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />

            {/* Protected Routes */}
            <Route
              path="/bookings"
              element={
                <ProtectedRoute>
                  <Bookings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <Chat />
                </ProtectedRoute>
              }
            />
            <Route
              path="/chat/:chatId"
              element={
                <ProtectedRoute>
                  <Chat />
                </ProtectedRoute>
              }
            />
            {/* Legacy Redirect */}
            <Route path="/properties/:id" element={<RedirectToProperty />} />

            <Route
              path="/payment"
              element={
                <ProtectedRoute>
                  <PaymentPage />
                </ProtectedRoute>
              }
            />
            <Route path="/payment-status" element={<PaymentStatusPage />} />
            <Route
              path="/payment/confirmed"
              element={<PaymentConfirmedPage />}
            />
            <Route path="/payment/error" element={<PaymentErrorPage />} />
          </Routes>
        </Suspense>
      </main>

      {/* Footer - Hidden on Auth and Chat Pages */}
      {!isAuthPage && !isChatPage && !isPaymentPage && <Footer />}

      {/* Mobile Bottom Navigation - Hidden on Auth, Payment and Property Pages */}
      {!isAuthPage &&
        !isPaymentPage &&
        !location.pathname.startsWith("/property/") && <BottomNav />}

      {/* Global Profile Completion Modal (Force Open if User Auth but No Data) */}
      <Suspense fallback={null}>
        {!isAuthPage && <ProfileCompletionModal isOpen={true} />}
      </Suspense>

      {/* Global Filter Panel */}
      <Suspense fallback={null}>
        {isFilterPanelOpen && (
          <FilterPanel
            currentFilters={filters}
            onApply={handleFilterApply}
            onClose={() => setFilterPanelOpen(false)}
            isOpen={isFilterPanelOpen}
          />
        )}
      </Suspense>
    </div>
  );
}

