import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
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
import { MaintenanceGate } from "@/components/MaintenanceGate";
import { WelcomeOnboarding } from "@/components/WelcomeOnboarding";
import { SeasonalParticles } from "@/components/SeasonalParticles";
import { AutoTranslate } from "@/components/AutoTranslate";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ImportantUpdatePopup } from "@/components/ImportantUpdatePopup";
import { EquusLoadingScreen } from "@/components/EquusLoadingScreen";
import { PageLoader } from "@/components/PageLoader";

const Grafikas = lazy(() => import("./pages/Grafikas"));
const Pradzia = lazy(() => import("./pages/Pradzia"));
const Kainos = lazy(() => import("./pages/Kainos"));
const Paskyra = lazy(() => import("./pages/Paskyra"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Admin = lazy(() => import("./pages/Admin"));
const Trener = lazy(() => import("./pages/Trener"));
const Informacija = lazy(() => import("./pages/Informacija"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PublicRegistration = lazy(() => import("./pages/PublicRegistration"));
const Reviews = lazy(() => import("./pages/Reviews"));
const PrivatumoPolitika = lazy(() => import("./pages/PrivatumoPolitika"));
const TaisyklesIrSalygos = lazy(() => import("./pages/TaisyklesIrSalygos"));
const QrCodePage = lazy(() => import("./pages/QrCode"));
const SlapukuPolitika = lazy(() => import("./pages/SlapukuPolitika"));

const queryClient = new QueryClient();

const HomeRoute = () => {
  const { user, loading } = useAuth();
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowLoadingScreen(false);
      return;
    }

    // Never make the branded splash screen block the app for a long auth request.
    const timer = window.setTimeout(() => setShowLoadingScreen(true), 1000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (loading && showLoadingScreen) return <EquusLoadingScreen />;

  // Let the public schedule render immediately while auth finishes in the background.
  // If the user is already known, show their normal home page instead.
  return user ? <Pradzia /> : <Grafikas />;
};

/** Administratoriai neturi įprasto vartotojo paskyros puslapio. */
const PaskyraRoute = () => {
  const { isAdmin, loading } = useAuth();

  if (loading) return <PageLoader />;

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
              <MaintenanceGate>
              <Layout>
                <SeasonalParticles />
                <WelcomeOnboarding />
                <InstallPrompt />
                <ImportantUpdatePopup />

                <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<HomeRoute />} />
                  <Route path="/grafikas" element={<Grafikas />} />
                  <Route path="/kainos" element={<Kainos />} />
                  <Route path="/informacija" element={<Informacija />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/registracija" element={<PublicRegistration />} />
                  <Route path="/registracija/:token" element={<PublicRegistration />} />
                  <Route path="/atsiliepimai" element={<Reviews />} />
                  <Route path="/privatumo-politika" element={<PrivatumoPolitika />} />
                  <Route path="/taisykles-ir-salygos" element={<TaisyklesIrSalygos />} />
                  <Route path="/slapuku-politika" element={<SlapukuPolitika />} />
                  <Route path="/mano-qr" element={<RequireAuth><QrCodePage /></RequireAuth>} />
                  <Route path="/admin/skenuoti" element={<RequireAuth><QrCodePage scanner /></RequireAuth>} />

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
                </Suspense>
              </Layout>
              </MaintenanceGate>
            </AuthProvider>
          </BrowserRouter>
          </ThemeProvider>
        </EffectsProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
