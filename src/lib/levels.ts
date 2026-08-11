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

/** Dynamic safe capacity for a trainer group lesson (max 4, 3 with one beginner, 2 with two). */
export function trainerGroupState(levels: RidingLevel[], hardMax = 4): GroupState {
  const total = levels.length;
  const beginners = levels.filter((l) => l === "beginner").length;
  const maxAllowed = Math.min(hardMax, beginners >= 2 ? 2 : beginners === 1 ? 3 : 4);
  const free = Math.max(0, maxAllowed - total);
  return {
    total,
    beginners,
    maxAllowed,
    free,
    full: total >= maxAllowed,
    reason:
      beginners >= 2
        ? "2 pradedantieji"
        : beginners === 1
          ? "Grupėje yra pradedantysis"
          : "Grupės dydis priklauso nuo raitelių lygio",
  };
}

/** Explains why one more rider of the given level cannot join. Returns null when allowed. */
export function blockReason(levels: RidingLevel[], newLevel: RidingLevel, hardMax = 4): string | null {
  const next = [...levels, newLevel];
  const beginners = next.filter((l) => l === "beginner").length;
  if (beginners > 2) {
    return "Šioje treniruotėje jau yra 2 pradedantieji, todėl daugiau pradedančiųjų registruoti negalima.";
  }
  const max = Math.min(hardMax, beginners >= 2 ? 2 : beginners === 1 ? 3 : 4);
  if (next.length > max) {
    if (beginners >= 2) return "Šioje treniruotėje jau yra 2 pradedantieji, todėl grupės limitas yra 2.";
    if (beginners === 1) return "Grupėje yra 1 pradedantysis, todėl maksimalus dalyvių skaičius yra 3.";
    return "Grupė pilna — maksimalus dalyvių skaičius yra 4.";
  }
  return null;
}
