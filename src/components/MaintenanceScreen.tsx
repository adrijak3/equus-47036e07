import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

/**
 * Full-screen technical maintenance page shown to all non-admin visitors
 * while maintenance mode is enabled. Themed entirely with the existing
 * Equus design tokens so it adapts to every theme (Vandenynas, Levanda,
 * Vidurnaktis, …) and both light/dark modes.
 */
export function MaintenanceScreen() {
  const { lang } = useLanguageSafe();

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-background text-foreground">
      <div
        className="min-h-[100dvh] flex items-center px-5 sm:px-10"
        style={{
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-8 md:gap-14 items-center">
          {/* Text column */}
          <main className="text-center md:text-left space-y-10">
            {/* Stable sign */}
            <section aria-label="Equus" className="flex flex-col items-center md:items-start gap-1.5">
              <span className="flex items-center gap-3 text-gold/80">
                <Horseshoe className="w-4 h-4 rotate-[-20deg]" />
                <span className="font-display text-2xl sm:text-3xl tracking-[0.35em] text-gradient-gold">EQUUS</span>
                <Horseshoe className="w-4 h-4 rotate-[20deg] -scale-x-100" />
              </span>
              <span className="text-xs uppercase tracking-[0.4em] text-muted-foreground/70">♡ jojimo mokykla ♡</span>
            </section>

            {/* Lithuanian — always first */}
            <section lang="lt" className="space-y-4">
              <h1 className="font-display text-[clamp(1.7rem,5.5vw,2.6rem)] leading-snug text-gradient-gold">
                Svetainėje atliekami techniniai atnaujinimai
              </h1>
              <p className="text-[clamp(0.95rem,2.8vw,1.05rem)] leading-relaxed text-foreground/85 max-w-prose mx-auto md:mx-0">
                Šiuo metu mūsų svetainėje vyksta techniniai darbai, kurie padės mums
                suteikti dar patogesnę naudojimosi patirtį.
              </p>
              <p className="text-foreground/80">Ačiū už kantrybę! ♡</p>
              <p className="font-display italic text-gold/90 text-[clamp(1rem,3vw,1.15rem)]">
                Greitai sugrįšime! ♡
              </p>
            </section>

            <div className="gold-divider max-w-[120px] mx-auto md:mx-0" aria-hidden="true" />

            {/* English */}
            <section lang="en" className="space-y-4">
              <h2 className="font-display text-[clamp(1.4rem,4.5vw,2rem)] leading-snug text-foreground">
                Technical updates are in progress
              </h2>
              <p className="text-[clamp(0.9rem,2.6vw,1rem)] leading-relaxed text-muted-foreground max-w-prose mx-auto md:mx-0">
                Our website is currently undergoing technical maintenance to make
                your experience even better.
              </p>
              <p className="text-muted-foreground">Thank you for your patience! ♡</p>
              <p className="font-display italic text-gold/70 text-[clamp(0.95rem,2.8vw,1.1rem)]">
                We&rsquo;ll be back soon! ♡
              </p>
            </section>
          </main>

          {/* Artwork column */}
          <aside
            aria-hidden="false"
            className={cn(
              "flex justify-center md:justify-end items-center order-first md:order-last",
            )}
          >
            <img
              src="/maintenance-horse.png"
              alt="Šiltas arklys tvarte — Equus jojimo mokykla / A warm horse in the stable — Equus riding school"
              width={372}
              height={809}
              className="w-auto max-w-[46vw] sm:max-w-[300px] md:max-w-full max-h-[38dvh] md:max-h-[70dvh] object-contain drop-shadow-elegant motion-safe:animate-maintenance-float select-none pointer-events-none"
              draggable={false}
            />
          </aside>
        </div>
      </div>
      {/* Screen-reader hint so visitors know this is temporary */}
      <p className="sr-only" lang={lang === "en" ? "en" : "lt"}>
        {lang === "en"
          ? "The site is temporarily unavailable due to maintenance. Please check back soon."
          : "Svetainė laikinai nepasiekiama dėl techninių darbų. Užsukite vėliau."}
      </p>
    </div>
  );
}

function useLanguageSafe(): { lang: string } {
  try {
    // Imported lazily to keep the screen standalone
    const mod = require_lang();
    const ctx = mod.useLanguage?.();
    return { lang: ctx?.lang ?? "lt" };
  } catch {
    return { lang: "lt" };
  }
}

function require_lang() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return langModule;
}

import * as langModule from "@/contexts/LanguageContext";

function Horseshoe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M5 21c-1.5-3-2-5.5-2-8a9 9 0 0 1 18 0c0 2.5-.5 5-2 8" />
      <path d="M8.5 3.5 9 6.5M15.5 3.5 15 6.5M4.2 9.5l2.6 1M19.8 9.5l-2.6 1M4.6 15l2.7.3M19.4 15l-2.7.3" />
    </svg>
  );
}
