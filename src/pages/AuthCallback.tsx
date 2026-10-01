import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/PageLoader";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    const finishOAuth = async () => {
      const errorDescription = params.get("error_description");
      if (errorDescription) {
        if (!cancelled) {
          window.setTimeout(() => navigate("/auth", { replace: true }), 1200);
        }
        return;
      }

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          // Supabase may already have exchanged the code automatically.
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) {
            if (!cancelled) {
              window.setTimeout(() => navigate("/auth", { replace: true }), 1200);
            }
            return;
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMessage("Google prisijungimas nepavyko.");
        if (!cancelled) {
          window.setTimeout(() => navigate("/auth", { replace: true }), 1200);
        }
        return;
      }

      if (!cancelled) navigate("/", { replace: true });
    };

    void finishOAuth();
    return () => { cancelled = true; };
  }, [navigate, params]);

  return <PageLoader fullScreen />;
}
