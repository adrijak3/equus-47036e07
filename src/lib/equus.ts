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
  const day = d.getDay();
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

/**
 * Historic data can contain more than one booking row for the same date+time
 * (e.g. a cancelled row plus a re-created active one). For display and counters
 * we keep a single canonical row per date+time.
 */
export function canonicalBookings<T extends {
  slot_date: string;
  slot_time: string;
  status: string;
  counts_in_subscription?: boolean;
  subscription_id?: string | null;
}>(rows: T[]): T[] {
  const rank = (b: T) => {
    const statusRank = b.status === "completed" ? 4 : b.status === "active" ? 3 : b.status === "pending_cancel" ? 2 : 1;
    return statusRank * 10 + (b.subscription_id ? 2 : 0) + (b.counts_in_subscription ? 1 : 0);
  };
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.slot_date}|${row.slot_time}`;
    const current = best.get(key);
    if (!current || rank(row) > rank(current)) best.set(key, row);
  }
  return Array.from(best.values()).sort(
    (a, b) => a.slot_date.localeCompare(b.slot_date) || a.slot_time.localeCompare(b.slot_time),
  );
}

export function formatTime(t: string): string {
  return t.slice(0, 5);
}

export function formatBookedName(fullName: string, displayName?: string | null): string {
  void displayName;
  const name = (fullName ?? "").trim();
  if (!name) return "—";
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const surname = parts[parts.length - 1];
  return `${first} ${surname.slice(0, 2)}`;
}

export const TIME_SLOT_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 22; h++) {
    for (const m of [0, 30]) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
})();

export const TIME_SLOT_OPTIONS_FINE: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 22; h++) {
    for (const m of [0, 15, 30, 45]) out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
})();

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Legacy generic auto-pricing kept for compatibility with older callers. */
export function calculateSubscriptionPrice(lessons: number): number {
  if (lessons <= 0) return 0;
  return lessons >= 8 ? lessons * 30 : lessons * 35;
}

export type LessonType = "sportine" | "nesportine" | "vienkartine" | "sportine_po2" | "nuosavu_zirgu";

export const LESSON_TYPE_LABEL: Record<LessonType, string> = {
  sportine: "Sportinė (grupinė)",
  nesportine: "Nesportinė",
  vienkartine: "Vienkartinė",
  sportine_po2: "Sportinė (po 2)",
  nuosavu_zirgu: "Jojant nuosavu žirgu",
};

/** Returns total price for a given lesson count + type using the current published price list. */
export function calculateSubPriceByType(lessons: number, type: LessonType): number {
  if (lessons <= 0) return 0;

  if (type === "vienkartine") return 40;

  if (type === "nesportine") {
    if (lessons === 8) return 200;
    if (lessons === 4) return 120;
    if (lessons === 1) return 35;
    return lessons * 35;
  }

  if (type === "sportine_po2") {
    if (lessons === 4) return 160;
    if (lessons === 8) return 320;
    return lessons * 45;
  }

  if (type === "nuosavu_zirgu") {
    if (lessons === 4) return 140;
    if (lessons === 8) return 240;
    if (lessons === 12) return 340;
    return lessons * 35;
  }

  if (lessons === 4) return 140;
  if (lessons === 8) return 280;
  if (lessons === 12) return 400;
  return lessons * 40;
}

export function slotDateTime(slot_date: string, slot_time: string): Date {
  return new Date(`${slot_date}T${slot_time.length === 5 ? slot_time + ":00" : slot_time}`);
}

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
