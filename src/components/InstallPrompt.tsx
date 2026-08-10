import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const DISMISS_KEY = "equus_install_dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const { language } = useLanguage();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  if (!visible || !deferred) return null;
  const lt = language === "lt";

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 sm:left-auto sm:right-4 sm:w-80">
      <div className="relative rounded-2xl border border-gold/25 bg-gradient-card p-4 shadow-elegant">
        <button
          type="button"
          onClick={dismiss}
          aria-label={lt ? "Uždaryti" : "Close"}
          className="absolute right-2 top-2 text-muted-foreground transition-colors hover:text-gold"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="font-display text-lg text-gradient-gold">
          {lt ? "Įsidiekite Equus programėlę" : "Install the Equus app"}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {lt ? "Greitesnė prieiga prie grafiko ir paskyros." : "Faster access to the schedule and your account."}
        </p>
        <Button variant="gold" size="sm" className="mt-3 w-full" onClick={install}>
          <Download className="mr-1.5 h-4 w-4" /> {lt ? "Įdiegti" : "Install"}
        </Button>
      </div>
    </div>
  );
}