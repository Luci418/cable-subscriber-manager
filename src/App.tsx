import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import AppLayout from "./components/AppLayout";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Home from "./pages/Home";
import Customers from "./pages/Customers";
import CustomerNew from "./pages/CustomerNew";
import CustomerDetail from "./pages/CustomerDetail";
import Equipment from "./pages/Equipment";
import { Billing } from "./pages/Billing";
import { Analytics } from "./pages/Analytics";
import { Complaints } from "./pages/Complaints";
import { Settings } from "./pages/Settings";
import { SettingsProvider } from "./contexts/SettingsContext";

const queryClient = new QueryClient();

/**
 * App routing (Batch 2, Phase 6.5).
 *
 * Routing decisions:
 *  - Kept react-router-dom (already in the project). No new dependency.
 *  - Routes are organised around ENTITIES: /customers, /customers/:id,
 *    /equipment. Actions (pair, collect, archive) remain contextual to
 *    those pages, not top-level routes.
 *  - Only modules that exist today get routes; placeholder routes for
 *    future modules (technician credentials, field ops, warehouse) are
 *    intentionally deferred.
 *  - Filter/tab state moves to URL params inside each page, not here.
 */
const BillingRoute = () => {
  const navigate = useNavigate();
  return <Billing onBack={() => navigate('/')} />;
};
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
const SettingsRoute = () => {
  const navigate = useNavigate();
  return <Settings onBack={() => navigate('/')} />;
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
              <Route path="customers/:id" element={<CustomerDetail />} />
              <Route path="billing" element={<BillingRoute />} />
              <Route path="equipment" element={<Equipment />} />
              <Route path="analytics" element={<AnalyticsRoute />} />
              <Route path="complaints" element={<ComplaintsRoute />} />
              <Route path="settings" element={<SettingsRoute />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SettingsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
