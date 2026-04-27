import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Layout from "@/components/Layout";
import RequireAuth from "@/components/RequireAuth";
import Grafikas from "./pages/Grafikas";
import Kainos from "./pages/Kainos";
import Paskyra from "./pages/Paskyra";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/** Admins don't have user-facing pages — redirect them to /admin. */
const PaskyraRoute = () => {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (isAdmin) return <Navigate to="/admin" replace />;
  return <Paskyra />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<Grafikas />} />
              <Route path="/kainos" element={<Kainos />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/paskyra" element={<RequireAuth><PaskyraRoute /></RequireAuth>} />
              <Route path="/admin" element={<RequireAuth adminOnly><Admin /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
