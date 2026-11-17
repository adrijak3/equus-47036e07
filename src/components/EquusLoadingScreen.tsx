import { useEffects } from "@/contexts/EffectsContext";

export function EquusLoadingScreen() {
  const { effectsEnabled } = useEffects();
  return (
    <div role="status" aria-live="polite" aria-label="Equus įkeliama" className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.07),transparent_65%)]"/>
      <div className="relative flex flex-col items-center text-center">
        <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-black shadow-xl sm:h-36 sm:w-36">
          <img src="/equus-logo-black.png" alt="Equus jojimo mokykla" draggable={false} className="h-full w-full object-contain"/>
        </div>
        <h1 className="mt-6 font-display text-5xl font-semibold tracking-[0.12em] text-foreground sm:text-6xl">EQUUS</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.28em] text-muted-foreground">Jojimo mokykla</p>
        <div className="mt-8 h-[2px] w-32 overflow-hidden rounded-full bg-primary/10">
          <div className="h-full w-1/2 rounded-full bg-primary/70" style={effectsEnabled ? {animation: "equus-loading-bar 1.5s ease-in-out infinite alternate"} : undefined}/>
        </div>
        <span className="mt-3 text-xs text-muted-foreground">Įkeliama…</span>
      </div>
      <style>{`@keyframes equus-loading-bar {from {transform:translateX(-100%)} to {transform:translateX(200%)}}@media (prefers-reduced-motion:reduce){[role="status"] div{animation:none!important}}`}</style>
    </div>
  );
}
