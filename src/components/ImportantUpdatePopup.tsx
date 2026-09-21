import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";

type ImportantUpdate = {
  id: string;
  title_lt: string;
  title_en: string;
  body_lt: string;
  body_en: string;
  url: string | null;
};

export function ImportantUpdatePopup() {
  const { user, isAdmin, loading } = useAuth();
  const { language } = useLanguage();
  const [update, setUpdate] = useState<ImportantUpdate | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!user || loading) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await (supabase as any)
        .from("important_notifications")
        .select("id,title_lt,title_en,body_lt,body_en,url")
        .eq("user_id", user.id)
        .is("read_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!error && data && !cancelled) setUpdate(data);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  if (!user || !update) return null;

  const title = language === "lt" ? update.title_lt : update.title_en;
  const body = language === "lt" ? update.body_lt : update.body_en;

  const dismiss = async () => {
    setClosing(true);
    const { error } = await (supabase as any)
      .from("important_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", update.id)
      .eq("user_id", user.id);

    if (!error) setUpdate(null);
    setClosing(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-background/45 p-4 pt-[5vh] sm:pt-[7vh] backdrop-blur-[2px] animate-in fade-in duration-300">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-gold/30 bg-gradient-card shadow-elegant animate-in zoom-in-95 slide-in-from-bottom-2 duration-500">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/10 blur-2xl" />
        <div className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-gold/10 blur-2xl" />

        <button
          type="button"
          aria-label={language === "lt" ? "Uždaryti" : "Close"}
          onClick={dismiss}
          disabled={closing}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-muted-foreground transition hover:bg-gold/10 hover:text-gold"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative p-6 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10 text-gold">
              <Bell className="h-6 w-6" />
              <Sparkles className="absolute -right-2 -top-2 h-4 w-4 animate-pulse text-gold" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gold/70">
                Equus
              </p>
              <h2 className="font-display text-2xl text-gradient-gold">{title}</h2>
            </div>
          </div>

          <p className="whitespace-pre-line text-sm leading-7 text-foreground/85">
            {body}
          </p>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={dismiss} disabled={closing}>
              {language === "lt" ? "Uždaryti" : "Close"}
            </Button>
            {update.url && (
              <Button asChild variant="gold" onClick={dismiss} disabled={closing}>
                <Link to={update.url}>
                  {language === "lt" ? "Peržiūrėti grafiką" : "View schedule"}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
