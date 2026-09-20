import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const WEEKDAYS = ["Sekmadienis", "Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis", "Šeštadienis"];

export default defineTool({
  name: "schedule_for_date",
  title: "Schedule for a date",
  description: "List the Equus riding school lesson times and how many riders are booked on a given date (YYYY-MM-DD).",
  inputSchema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date in YYYY-MM-DD format."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

    const [slotsRes, bookingsRes] = await Promise.all([
      supabase
        .from("time_slots")
        .select("id, slot_time, max_capacity, trainer_name, one_off_date, day_of_week, active")
        .eq("active", true)
        .eq("day_of_week", dayOfWeek)
        .order("slot_time"),
      supabase.from("bookings").select("slot_time, status").eq("slot_date", date).neq("status", "cancelled"),
    ]);

    if (slotsRes.error) return { content: [{ type: "text", text: slotsRes.error.message }], isError: true };
    if (bookingsRes.error) return { content: [{ type: "text", text: bookingsRes.error.message }], isError: true };

    const slots = (slotsRes.data ?? [])
      .filter((s) => !s.one_off_date || s.one_off_date === date)
      .map((s) => {
        const booked = (bookingsRes.data ?? []).filter((b) => b.slot_time === s.slot_time).length;
        return {
          time: s.slot_time,
          trainer: s.trainer_name,
          capacity: s.max_capacity,
          booked,
          free: Math.max(0, s.max_capacity - booked),
        };
      });

    const summary = { date, weekday: WEEKDAYS[dayOfWeek], slots };
    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  },
});
