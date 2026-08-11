import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, X, Plus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { promptInstall, rememberDismissal, useInstallState } from "@/lib/install";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Floating, non-nagging install banner. Appears as soon as the browser allows it. */
export function InstallPrompt() {
  const { language } = useLanguage();
  const lt = language === "lt";
  const { canInstall, dismissed, installed } = useInstallState();
  const [hidden, setHidden] = useState(false);

  // Small delay so the banner never fights with the first paint.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!ready || hidden || installed || dismissed || !canInstall) return null;

  const dismiss = () => { rememberDismissal(); setHidden(true); };

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
        <Button
          variant="gold"
          size="sm"
          className="mt-3 w-full"
          onClick={() => { void promptInstall().then(() => setHidden(true)); }}
        >
          <Download className="mr-1.5 h-4 w-4" /> {lt ? "Įdiegti" : "Install"}
        </Button>
      </div>
    </div>
  );
}

/** Menu entry — only visible when installing is actually possible (or on iOS, with instructions). */
export function InstallMenuAction({ onDone }: { onDone?: () => void }) {
  const { language } = useLanguage();
  const lt = language === "lt";
  const { canInstall, iosInstructions, installed } = useInstallState();
  const [iosOpen, setIosOpen] = useState(false);

  if (installed || (!canInstall && !iosInstructions)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canInstall) {
            void promptInstall().then(() => onDone?.());
          } else {
            setIosOpen(true);
          }
        }}
        className="flex w-full items-center gap-4 rounded-md border-l-2 border-transparent px-4 py-3.5 text-left text-foreground/85 transition-all hover:bg-gold/5 hover:text-gold"
      >
        <Download className="h-4 w-4" />
        <span className="font-display text-base tracking-wide">
          {lt ? "Įdiegti Equus programėlę" : "Install the Equus app"}
        </span>
      </button>

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        <DialogContent className="rounded-3xl border-gold/20 bg-gradient-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-gradient-gold">
              {lt ? "Pridėti į pradžios ekraną" : "Add to Home Screen"}
            </DialogTitle>
          </DialogHeader>
          <ol className="space-y-3 text-sm text-foreground/85">
            <li className="flex items-start gap-2">
              <Share className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              {lt ? "Paspauskite „Bendrinti“ (Share) mygtuką naršyklės apačioje." : "Tap the Share button in Safari."}
            </li>
            <li className="flex items-start gap-2">
              <Plus className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              {lt ? "Pasirinkite „Įtraukti į pagrindinį ekraną“." : "Choose “Add to Home Screen”."}
            </li>
            <li className="flex items-start gap-2">
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              {lt ? "Patvirtinkite — Equus atsiras tarp programėlių." : "Confirm — Equus will appear with your apps."}
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
