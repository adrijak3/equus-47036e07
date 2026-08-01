import { Gauge, Sparkles } from "lucide-react";
import { useEffects } from "@/contexts/EffectsContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

export default function EffectsToggle() {
  const { effectsEnabled, setEffectsEnabled } = useEffects();
  const { language } = useLanguage();

  const title = language === "lt" ? "Vaizdo efektai" : "Visual effects";
  const hint = effectsEnabled
    ? language === "lt"
      ? "Animacijos ir sezoniniai efektai įjungti"
      : "Animations and seasonal effects are on"
    : language === "lt"
      ? "Greitesnis režimas silpnesniam įrenginiui"
      : "Faster mode for lower-end devices";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={effectsEnabled}
      onClick={() => setEffectsEnabled(!effectsEnabled)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-gold/40"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gold/10 text-gold">
          {effectsEnabled ? <Sparkles className="h-4 w-4" /> : <Gauge className="h-4 w-4" />}
        </span>

        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        </span>
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 flex-none rounded-full border transition-colors",
          effectsEnabled
            ? "border-gold/60 bg-gold/30"
            : "border-border bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-foreground shadow-sm transition-transform",
            effectsEnabled ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
