// Equus shared utilities — dates, pricing, name formatting (Vilnius timezone)

export const VILNIUS_TZ = "Europe/Vilnius";

export const WEEKDAYS_LT = [
  "Pirmadienis",
  "Antradienis",
  "Trečiadienis",
  "Ketvirtadienis",
  "Penktadienis",
  "Šeštadienis",
  "Sekmadienis",
];

export const WEEKDAYS_LT_SHORT = ["Pir", "Ant", "Tre", "Ket", "Pen", "Šeš", "Sek"];

export const MONTHS_LT = [
  "Sausio", "Vasario", "Kovo", "Balandžio", "Gegužės", "Birželio",
  "Liepos", "Rugpjūčio", "Rugsėjo", "Spalio", "Lapkričio", "Gruodžio",
];

export const MONTHS_LT_NOM = [
  "Sausis", "Vasaris", "Kovas", "Balandis", "Gegužė", "Birželis",
  "Liepa", "Rugpjūtis", "Rugsėjis", "Spalis", "Lapkritis", "Gruodis",
];

/** Get Monday of the week containing `date` (in local time). */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** day_of_week in DB convention: 1=Mon..7=Sun */
export function dbDayOfWeek(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export function formatTime(t: string): string {
  // "16:00:00" → "16:00"
  return t.slice(0, 5);
}

/** Format full name → "Vardas Pav" (first 3 letters of surname) */
export function formatBookedName(fullName: string, displayName?: string | null): string {
  // Display rule (forced for everyone): "Vardas Pa" — first 2 letters of surname.
  // displayName is intentionally ignored to keep the schedule consistent.
  void displayName;
  const name = (fullName ?? "").trim();
  if (!name) return "—";
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const surname = parts[parts.length - 1];
  return `${first} ${surname.slice(0, 2)}`;
}

/** Half-hour time slot options for admin pickers (08:00 → 22:00) */
export const TIME_SLOT_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 22; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Quarter-hour suggestions for admin pickers (08:00 → 22:00, every 15 min) */
export const TIME_SLOT_OPTIONS_FINE: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 22; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Validate any HH:MM string admin types in. */
export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Auto-pricing: <8 → 35€/lesson, >=8 → 30€/lesson */
export function calculateSubscriptionPrice(lessons: number): number {
  if (lessons <= 0) return 0;
  return lessons >= 8 ? lessons * 30 : lessons * 35;
}

/** Lesson types for subscriptions */
export type LessonType = "sportine" | "nesportine" | "vienkartine";

export const LESSON_TYPE_LABEL: Record<LessonType, string> = {
  sportine: "Sportinė",
  nesportine: "Nesportinė",
  vienkartine: "Vienkartinė",
};

/** Returns total price for a given lesson count + type. */
export function calculateSubPriceByType(lessons: number, type: LessonType): number {
  if (lessons <= 0) return 0;
  if (type === "vienkartine") return 35; // single lesson, fixed
  if (type === "nesportine") {
    // Tiered: 8-card 200€, 4-card 120€, 1 lesson 35€; otherwise per-lesson 35€
    if (lessons === 8) return 200;
    if (lessons === 4) return 120;
    if (lessons === 1) return 35;
    return lessons * 35;
  }
  // sportine (default existing rule)
  return lessons >= 8 ? lessons * 30 : lessons * 35;
}

/** Build a Date in local TZ from slot_date (YYYY-MM-DD) + slot_time (HH:MM[:SS]) */
export function slotDateTime(slot_date: string, slot_time: string): Date {
  return new Date(`${slot_date}T${slot_time.length === 5 ? slot_time + ":00" : slot_time}`);
}

/** Hours until slot starts (negative if in past) */
export function hoursUntil(slot_date: string, slot_time: string): number {
  const slot = slotDateTime(slot_date, slot_time);
  return (slot.getTime() - Date.now()) / 36e5;
}

export function formatDateLong(date: Date): string {
  return `${date.getDate()} ${MONTHS_LT[date.getMonth()].toLowerCase()}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function expiryFromPurchase(purchaseDateISO: string): string {
  const d = new Date(purchaseDateISO);
  d.setDate(d.getDate() + 30);
  return formatDateISO(d);
}
