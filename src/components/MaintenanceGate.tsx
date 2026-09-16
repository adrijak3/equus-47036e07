import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EquusLoadingScreen } from "@/components/EquusLoadingScreen";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";

/**
 * Global maintenance gate.
 *
 * - Fetches the single `site_settings` row (maintenance_mode) from the backend.
 * - Never renders the normal app before the state is known (no flash for visitors).
 * - While ON: non-admin visitors see <MaintenanceScreen />; admins keep full access.
 * - Subscribes to realtime changes and refetches on window focus so the state
 *   updates without a manual refresh. The value is never cached in localStorage.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
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

    // Realtime: reflect changes without a refresh.
    const channel = (supabase as any)
      .channel("site-settings-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "site_settings" },
        (payload: any) => setMaintenance(Boolean(payload?.new?.maintenance_mode)),
      )
      .subscribe();

    // Safety net: refetch when the tab regains focus/visibility.
    const onFocus = () => fetchMode();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      (supabase as any).removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [fetchMode]);

  // Still checking — small Equus loading state, no app flash.
  if (maintenance === null) return <EquusLoadingScreen />;

  if (maintenance && !isAdmin) return <MaintenanceScreen />;

  return <>{children}</>;
}
