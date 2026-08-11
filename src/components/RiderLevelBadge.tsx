import { cn } from "@/lib/utils";
import { LEVEL_META, levelOf, type RidingLevel } from "@/lib/levels";

/** Small coloured badge showing a rider's internal skill level. */
export function RiderLevelBadge({
  level,
  compact = false,
  className,
}: { level?: string | null; compact?: boolean; className?: string }) {
  const lvl: RidingLevel = levelOf(level);
  const meta = LEVEL_META[lvl];
  if (compact) {
    return (
      <span
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", meta.dot, className)}
        title={`${meta.label} — ${meta.desc}`}
        aria-label={meta.label}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
        meta.cls,
        className,
      )}
      title={meta.desc}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

/** Select control for assigning the internal level (admin / trainer). */
export function RiderLevelSelect({
  value,
  onChange,
  disabled,
  className,
}: { value?: string | null; onChange: (v: RidingLevel) => void; disabled?: boolean; className?: string }) {
  return (
    <select
      value={levelOf(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as RidingLevel)}
      className={cn("h-9 rounded-md border border-input bg-background px-2 text-xs", className)}
      title="Vidinis raitelio lygis"
    >
      <option value="beginner">🔴 Pradedantysis</option>
      <option value="independent">🟡 Pajojantis</option>
    </select>
  );
}
