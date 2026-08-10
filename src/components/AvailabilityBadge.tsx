import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  taken: number;
  capacity: number;
  className?: string;
}

function placesLabel(free: number, lt: boolean) {
  if (!lt) return free === 1 ? "1 place left" : `${free} places left`;
  const last = free % 10;
  const teens = free % 100 >= 11 && free % 100 <= 19;
  if (last === 1 && !teens) return `${free} vieta`;
  if (last === 0 || teens) return `${free} vietų`;
  return `${free} vietos`;
}

/** Clear, colour-coded remaining-places indicator (no mental math for users). */
export function AvailabilityBadge({ taken, capacity, className }: Props) {
  const { language } = useLanguage();
  const lt = language === "lt";
  const free = Math.max(0, capacity - taken);
  const state = free <= 0 ? "full" : free === 1 ? "low" : "free";

  const label =
    state === "full" ? (lt ? "Pilna" : "Full") : placesLabel(free, lt);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        state === "free" && "border-avail-free/40 bg-avail-free/10 text-avail-free",
        state === "low" && "border-avail-low/45 bg-avail-low/12 text-avail-low",
        state === "full" && "border-avail-full/45 bg-avail-full/12 text-avail-full",
        className,
      )}
      title={`${taken}/${capacity}`}
      aria-label={label}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          state === "free" && "bg-avail-free",
          state === "low" && "bg-avail-low",
          state === "full" && "bg-avail-full",
        )}
      />
      {label}
    </span>
  );
}