import { supabase } from "@/integrations/supabase/client";

type BookingLike = { id: string; slot_date: string; slot_time: string };

const keyOf = (date: string, time: string) => `${date}|${String(time).slice(0, 5)}`;

/**
 * Returns booking id -> horse name for the given lessons.
 *
 * 1. Exact match: a horse assignment saved against that booking row.
 * 2. Fallback: some lessons end up with their horse saved against a different
 *    booking row of the same rider (for example after a lesson was moved or
 *    re-booked). In that case we use the horse saved for the same rider, date
 *    and time, but only when
 *      - exactly one lesson and exactly one horse assignment share that slot, and
 *      - the assignment's own booking is cancelled or gone (a horse that still
 *        belongs to an active or completed booking is never reused).
 */
export async function loadHorseNamesForBookings(
  rows: BookingLike[],
  riderUserId?: string | null,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  if (!rows.length) return result;

  const ids = rows.map((r) => r.id);
  const { data: exact } = await supabase
    .from("horse_assignments")
    .select("booking_id, horse_id")
    .in("booking_id", ids);

  const horseIdByBooking: Record<string, string> = {};
  (exact ?? []).forEach((a: any) => {
    if (a.booking_id && a.horse_id) horseIdByBooking[a.booking_id] = a.horse_id;
  });

  const missing = rows.filter((r) => !horseIdByBooking[r.id]);
  if (missing.length && riderUserId) {
    const dates = Array.from(new Set(missing.map((r) => r.slot_date)));
    const { data: loose } = await supabase
      .from("horse_assignments")
      .select("booking_id, horse_id, slot_date, slot_time")
      .eq("user_id", riderUserId)
      .in("slot_date", dates);

    const candidates = ((loose ?? []) as any[]).filter(
      (a) => a.horse_id && !ids.includes(a.booking_id),
    );

    const ownerIds = Array.from(new Set(candidates.map((a) => a.booking_id).filter(Boolean))) as string[];
    const liveOwners = new Set<string>();
    if (ownerIds.length) {
      const { data: owners } = await supabase.from("bookings").select("id, status").in("id", ownerIds);
      (owners ?? []).forEach((o: any) => {
        if (o.status !== "cancelled") liveOwners.add(o.id);
      });
    }

    const free = candidates.filter((a) => !a.booking_id || !liveOwners.has(a.booking_id));

    const missingByKey = new Map<string, BookingLike[]>();
    missing.forEach((r) => {
      const k = keyOf(r.slot_date, r.slot_time);
      missingByKey.set(k, [...(missingByKey.get(k) ?? []), r]);
    });
    const freeByKey = new Map<string, any[]>();
    free.forEach((a) => {
      const k = keyOf(a.slot_date, a.slot_time);
      freeByKey.set(k, [...(freeByKey.get(k) ?? []), a]);
    });

    missingByKey.forEach((lessons, k) => {
      const assignments = freeByKey.get(k) ?? [];
      if (lessons.length === 1 && assignments.length === 1) {
        horseIdByBooking[lessons[0].id] = assignments[0].horse_id;
      }
    });
  }

  const horseIds = Array.from(new Set(Object.values(horseIdByBooking)));
  let horseNameById: Record<string, string> = {};
  if (horseIds.length) {
    const { data: horses } = await supabase.from("horses").select("id, name").in("id", horseIds);
    horseNameById = Object.fromEntries((horses ?? []).map((h: any) => [h.id, h.name]));
  }

  rows.forEach((r) => {
    const horseId = horseIdByBooking[r.id];
    result[r.id] = horseId ? horseNameById[horseId] ?? null : null;
  });
  return result;
}
