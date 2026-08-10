import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { EffectsProvider } from "@/contexts/EffectsContext";

import Layout from "@/components/Layout";
import RequireAuth from "@/components/RequireAuth";
import { WelcomeOnboarding } from "@/components/WelcomeOnboarding";
import { SeasonalParticles } from "@/components/SeasonalParticles";
import { AutoTranslate } from "@/components/AutoTranslate";
import { InstallPrompt } from "@/components/InstallPrompt";
import { EquusLoadingScreen } from "@/components/EquusLoadingScreen";

import Grafikas from "./pages/Grafikas";
import Pradzia from "./pages/Pradzia";
import Kainos from "./pages/Kainos";
import Paskyra from "./pages/Paskyra";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Trener from "./pages/Trener";
import Informacija from "./pages/Informacija";
import NotFound from "./pages/NotFound";
import PublicRegistration from "./pages/PublicRegistration";
import Reviews from "./pages/Reviews";

const queryClient = new QueryClient();

const HomeRoute = () => {
  const { user, loading } = useAuth();

  if (loading) return <EquusLoadingScreen />;

  return user ? <Pradzia /> : <Grafikas />;
};

/** Administratoriai neturi įprasto vartotojo paskyros puslapio. */
const PaskyraRoute = () => {
  const { isAdmin, loading } = useAuth();

  if (loading) return <EquusLoadingScreen />;

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <Paskyra />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />

      <LanguageProvider>
        <EffectsProvider>
          <ThemeProvider>
          <AutoTranslate />

          <BrowserRouter>
            <AuthProvider>
              <Layout>
                <SeasonalParticles />
                <WelcomeOnboarding />
                <InstallPrompt />

                <Routes>
                  <Route path="/" element={<HomeRoute />} />
                  <Route path="/grafikas" element={<Grafikas />} />
                  <Route path="/kainos" element={<Kainos />} />
                  <Route path="/informacija" element={<Informacija />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/registracija" element={<PublicRegistration />} />
                  <Route path="/registracija/:token" element={<PublicRegistration />} />
                  <Route path="/atsiliepimai" element={<Reviews />} />

                  <Route
                    path="/paskyra"
                    element={
                      <RequireAuth>
                        <PaskyraRoute />
                      </RequireAuth>
                    }
                  />

                  <Route
                    path="/admin"
                    element={
                      <RequireAuth adminOnly>
                        <Admin />
                      </RequireAuth>
                    }
                  />

                  <Route
                    path="/trener"
                    element={
                      <RequireAuth>
                        <Trener />
                      </RequireAuth>
                    }
                  />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Layout>
            </AuthProvider>
          </BrowserRouter>
          </ThemeProvider>
        </EffectsProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
