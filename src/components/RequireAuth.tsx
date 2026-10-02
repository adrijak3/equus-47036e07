import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function RequireAuth({ children, adminOnly = false, staffOnly = false }: { children: ReactNode; adminOnly?: boolean; staffOnly?: boolean }) {
  const { user, isAdmin, isTrainer, isHalfAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-gold/60 font-display text-lg animate-pulse">Kraunama…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (staffOnly && !isAdmin && !isTrainer && !isHalfAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
