import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/PageLoader";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";

/**
 * Global maintenance gate.
 *
 * - Fetches the single site_settings row (maintenance_mode) from the backend.
 * - Never renders the normal app before the state is known (no flash for visitors).
 * - While ON: non-admin visitors see MaintenanceScreen.
 * - The normal /auth route remains reachable so an administrator can authenticate
 *   and then pass the gate. Authentication and the admin role check are still
 *   enforced by Supabase + RequireAuth; this route does not bypass maintenance.
 * - Subscribes to realtime changes and refetches on window focus.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();
  const [maintenance, setMaintenance] = useState<boolean | null>(null);

  const fetchMode = useCallback(async () => {
    const { data, error } = await supabase
      .from("site_settings" as any)
      .select("maintenance_mode")
      .eq("id", 1)
      .maybeSingle();

    if (!error && data) setMaintenance(Boolean((data as any).maintenance_mode));
    else if (error?.code === "PGRST116" || !data) setMaintenance(false);
    // On transient network errors keep the previous state (or loading) rather
    // than showing maintenance incorrectly.
  }, []);

  useEffect(() => {
    fetchMode();

    const channel = (supabase as any)
      .channel("site-settings-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "site_settings" },
        (payload: any) => setMaintenance(Boolean(payload?.new?.maintenance_mode)),
      )
      .subscribe();

    const onFocus = () => fetchMode();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      (supabase as any).removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [fetchMode]);

  if (maintenance === null) return <PageLoader fullScreen />;

  // The login page must remain reachable while maintenance is active.
  // Once an admin authenticates, isAdmin becomes true and the normal app renders.
  if (maintenance && !isAdmin && pathname !== "/auth") {
    return <MaintenanceScreen />;
  }

  return <>{children}</>;
}
