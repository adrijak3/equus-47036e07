import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCcw } from "lucide-react";

/** Skeleton cards that mirror the real slot card layout. */
export function ScheduleSkeleton({ days = 3, slots = 3 }: { days?: number; slots?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {Array.from({ length: days }).map((_, d) => (
        <div key={d} className="space-y-2">
          <Skeleton className="h-8 w-40 rounded-xl bg-gold/10" />
          {Array.from({ length: slots }).map((__, s) => (
            <div key={s} className="rounded-2xl border border-gold/10 bg-gradient-card p-3">
              <div className="flex items-center justify-between gap-2 border-b border-gold/10 pb-2">
                <Skeleton className="h-6 w-20 bg-gold/10" />
                <Skeleton className="h-5 w-24 rounded-full bg-gold/10" />
              </div>
              <div className="space-y-2 pt-3">
                <Skeleton className="h-4 w-3/5 bg-gold/10" />
                <Skeleton className="h-4 w-2/5 bg-gold/10" />
                <Skeleton className="h-8 w-full rounded-md bg-gold/5" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ScheduleEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gold/20 bg-card/30 px-4 py-10 text-center">
      <div className="text-2xl" aria-hidden>🐴</div>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function ScheduleError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
      <p className="mt-2 text-sm text-foreground/85">{message ?? "Nepavyko atnaujinti grafiko."}</p>
      <Button variant="ghostGold" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Bandyti dar kartą
      </Button>
    </div>
  );
}