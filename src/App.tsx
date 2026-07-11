import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Home from "./pages/Home";
import Customers from "./pages/Customers";
import CustomerNew from "./pages/CustomerNew";
import CustomerDetail from "./pages/CustomerDetail";
import Equipment from "./pages/Equipment";
import EquipmentDetail from "./pages/EquipmentDetail";
import { Billing } from "./pages/Billing";
import { Analytics } from "./pages/Analytics";
import { Complaints } from "./pages/Complaints";
import { Settings } from "./pages/Settings";
import { SettingsProvider } from "./contexts/SettingsContext";

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
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<AppLayout />}>
              <Route index element={<Home />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/new" element={<CustomerNew />} />
              {/* Redirect bare /customers/:id → overview tab so the URL is always canonical. */}
              <Route path="customers/:id" element={<Navigate to="overview" replace />} />
              <Route path="customers/:id/:tab" element={<CustomerDetail />} />
              <Route path="billing" element={<Billing />} />
              <Route path="equipment" element={<Equipment />} />
              <Route path="equipment/:serial" element={<EquipmentDetail />} />
              <Route path="analytics" element={<AnalyticsRoute />} />
              <Route path="complaints" element={<ComplaintsRoute />} />
              <Route path="settings" element={<Navigate to="/settings/company" replace />} />
              <Route path="settings/:section" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SettingsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
