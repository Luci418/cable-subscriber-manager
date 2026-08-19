import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Home from "./pages/Home";
import Customers from "./pages/Customers";
import { SettingsProvider } from "./contexts/SettingsContext";

/**
 * Route-level code splitting. Home, Customers, Auth and the shell stay in the
 * main bundle (they are the first paint for nearly every session); everything
 * heavier — charts, PDF/statement tooling, the provider import pipeline — is
 * fetched only when its route is first visited.
 */
const importOAuthConsent = () => import("./pages/OAuthConsent");
const importCustomerNew = () => import("./pages/CustomerNew");
const importCustomerDetail = () => import("./pages/CustomerDetail");
const importEquipment = () => import("./pages/Equipment");
const importEquipmentDetail = () => import("./pages/EquipmentDetail");
const importCatalog = () => import("./pages/Catalog");
const importProviderImport = () => import("./pages/ProviderImport");
const importBilling = () => import("./pages/Billing");
const importAnalytics = () => import("./pages/Analytics");
const importComplaints = () => import("./pages/Complaints");
const importSettings = () => import("./pages/Settings");

const OAuthConsent = lazy(importOAuthConsent);
const CustomerNew = lazy(importCustomerNew);
const CustomerDetail = lazy(importCustomerDetail);
const Equipment = lazy(importEquipment);
const EquipmentDetail = lazy(importEquipmentDetail);
const Catalog = lazy(importCatalog);
const ProviderImport = lazy(importProviderImport);
const Billing = lazy(() => importBilling().then((m) => ({ default: m.Billing })));
const Analytics = lazy(() => importAnalytics().then((m) => ({ default: m.Analytics })));
const Complaints = lazy(() => importComplaints().then((m) => ({ default: m.Complaints })));
const Settings = lazy(() => importSettings().then((m) => ({ default: m.Settings })));

/**
 * Warm the route chunks once the first screen is idle. Code splitting keeps
 * the initial bundle small, but without prefetching every first navigation
 * paid a network round-trip and showed the fallback spinner. Prefetching on
 * idle makes those navigations feel instant while keeping first paint light.
 */
function usePrefetchRoutes() {
  useEffect(() => {
    const warm = () => {
      [
        importCustomerDetail,
        importBilling,
        importEquipment,
        importCatalog,
        importAnalytics,
        importComplaints,
        importSettings,
        importCustomerNew,
        importEquipmentDetail,
        importProviderImport,
      ].forEach((load) => {
        void load().catch(() => {});
      });
    };
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    if (ric) {
      const id = ric(warm, { timeout: 3000 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(t);
  }, []);
}

const RouteFallback = () => (
  <div className="flex items-center justify-center py-24">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

const queryClient = new QueryClient();



/**
 * App routing (Phase 6.5).
 *
 * Batch 3 additions:
 *  - /customers/:id/:tab — tabbed subscriber workspace (overview |
 *    subscriptions | devices | ledger | credentials). `overview` is the
 *    default tab and receives a redirect when the tab segment is missing.
 *  - /equipment/:serial   — per-device page. Assigned-to links from the
 *    equipment list resolve to this route.
 *  - /settings/*          — settings has its own nested sub-routes
 *    (company, payment, services, receipts, roles) with a shared layout.
 *
 * No placeholder routes for future modules.
 */
const AnalyticsRoute = () => {
  const navigate = useNavigate();
  return (
    <Analytics
      onBack={() => navigate('/')}
      onFilterPack={(p) => navigate(`/customers?pack=${encodeURIComponent(p)}`)}
      onFilterRegion={(r) => navigate(`/customers?region=${encodeURIComponent(r)}`)}
      onFilterBalance={(b) => navigate(`/customers?balance=${encodeURIComponent(b)}`)}
    />
  );
};
const ComplaintsRoute = () => {
  const navigate = useNavigate();
  return <Complaints onBack={() => navigate('/')} />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SettingsProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
              <Route element={<AppLayout />}>
                <Route index element={<Home />} />
                <Route path="customers" element={<Customers />} />
                <Route path="customers/new" element={<CustomerNew />} />
                {/* Redirect bare /customers/:id → overview tab so the URL is always canonical. */}
                <Route path="customers/:id" element={<Navigate to="overview" replace />} />
                <Route path="customers/:id/:tab" element={<CustomerDetail />} />
                <Route path="billing" element={<Billing />} />
                <Route path="catalog" element={<Catalog />} />
                <Route path="equipment" element={<Equipment />} />
                <Route path="equipment/:serial" element={<EquipmentDetail />} />
                <Route path="analytics" element={<AnalyticsRoute />} />
                <Route path="complaints" element={<ComplaintsRoute />} />
                <Route path="integrations/hathway" element={<ProviderImport />} />
                <Route path="settings" element={<Navigate to="/settings/company" replace />} />
                <Route path="settings/:section" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>

        </SettingsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
