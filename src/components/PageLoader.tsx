import { RefreshCw } from "lucide-react";

export function PageLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={fullScreen
        ? "fixed inset-0 z-[100] flex items-center justify-center bg-background"
        : "container flex min-h-[45vh] items-center justify-center"}
      role="status"
      aria-live="polite"
      aria-label="Kraunama"
    >
      <div className="flex items-center gap-3 text-gold">
        <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">Kraunama…</span>
      </div>
    </div>
  );
}
