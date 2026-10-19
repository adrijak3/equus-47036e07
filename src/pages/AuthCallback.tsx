import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/PageLoader";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const finishOAuth = async () => {
      const errorDescription = params.get("error_description");
      const oauthError = params.get("error");
      if (errorDescription || oauthError) {
        if (!cancelled) {
          setMessage(
            `Google prisijungimas nepavyko: ${errorDescription || oauthError}. Patikrinkite OAuth nustatymus arba pabandykite dar kartą.`,
          );
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
              setMessage(`Nepavyko užbaigti Google prisijungimo: ${error.message}`);
            }
            return;
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMessage("Google prisijungimas nepavyko: sesija nebuvo sukurta. Patikrinkite Supabase ir Google OAuth nustatymus.");
        return;
      }

      if (!cancelled) navigate("/", { replace: true });
    };

    void finishOAuth();
    return () => { cancelled = true; };
  }, [navigate, params]);

  if (message) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="rounded-2xl border border-gold/20 bg-gradient-card px-6 py-5 text-center text-sm shadow-elegant">
          <p className="font-medium text-gold">{message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Jei klaida kartojasi, užfiksuokite šį pranešimą — pagal jį bus galima nustatyti, ką taisyti.
          </p>
          <button
            type="button"
            onClick={() => navigate("/auth", { replace: true })}
            className="mt-4 rounded-md border border-gold/30 px-4 py-2 text-sm text-gold hover:bg-gold/10"
          >
            Grįžti į prisijungimą
          </button>
        </div>
      </div>
    );
  }

  return <PageLoader fullScreen />;
}
