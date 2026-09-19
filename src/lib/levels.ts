/**
 * Internal (staff-only) rider skill classification used for safe group composition
 * in trainer-led group lessons. Separate from the public registration experience levels.
 */
export type RidingLevel = "beginner" | "independent";

export const LEVEL_META: Record<RidingLevel, {
  emoji: string; label: string; labelEn: string; desc: string; descEn: string;
  cls: string; dot: string;
}> = {
  beginner: {
    emoji: "🔴",
    label: "Pradedantysis",
    labelEn: "Beginner",
    desc: "Naujokas / dar nemoka savarankiškai joti.",
    descEn: "Newcomer / cannot ride independently yet.",
    cls: "border-avail-full/45 bg-avail-full/12 text-avail-full",
    dot: "bg-avail-full",
  },
  independent: {
    emoji: "🟡",
    label: "Pajojantis",
    labelEn: "Independent",
    desc: "Savarankiškai jojantis raitelis.",
    descEn: "Rides independently.",
    cls: "border-avail-low/45 bg-avail-low/12 text-avail-low",
    dot: "bg-avail-low",
  },
};

/** Riders without an assigned level are treated conservatively as beginners. */
export function levelOf(value?: string | null): RidingLevel {
  return value === "independent" ? "independent" : "beginner";
}

export interface GroupState {
  total: number;
  beginners: number;
  maxAllowed: number;
  free: number;
  full: boolean;
  reason: string;
}

/** Group capacity for a trainer lesson — flat limit, rider levels no longer restrict it. */
export function trainerGroupState(levels: RidingLevel[], hardMax = 4): GroupState {
  const total = levels.length;
  const beginners = levels.filter((l) => l === "beginner").length;
  const maxAllowed = Math.min(hardMax, 4);
  const free = Math.max(0, maxAllowed - total);
  return {
    total,
    beginners,
    maxAllowed,
    free,
    full: total >= maxAllowed,
    reason: `Maksimalus dalyvių skaičius — ${maxAllowed}`,
  };
}

/** Explains why one more rider cannot join. Returns null when allowed. */
export function blockReason(levels: RidingLevel[], _newLevel: RidingLevel, hardMax = 4): string | null {
  const max = Math.min(hardMax, 4);
  if (levels.length + 1 > max) {
    return `Grupė pilna — maksimalus dalyvių skaičius yra ${max}.`;
  }
  return null;
}
