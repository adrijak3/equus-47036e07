import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "my_bookings",
  title: "My lessons",
  description:
    "List the signed-in rider's riding lessons. Defaults to upcoming lessons; set scope to 'past' or 'all'.",
  inputSchema: {
    scope: z.enum(["upcoming", "past", "all"]).optional().describe("Which lessons to return."),
    limit: z.number().int().min(1).max(100).optional().describe("Maximum number of lessons (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ scope = "upcoming", limit = 20 }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const today = new Date().toISOString().slice(0, 10);

    let query = supabase
      .from("bookings")
      .select("id, slot_date, slot_time, status, trainer_name, is_individual, counts_in_subscription")
      .eq("user_id", ctx.getUserId()!)
      .limit(limit);

    if (scope === "upcoming") query = query.gte("slot_date", today).order("slot_date").order("slot_time");
    else if (scope === "past") query = query.lt("slot_date", today).order("slot_date", { ascending: false });
    else query = query.order("slot_date", { ascending: false });

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const bookings = (data ?? []).map((b) => ({
      id: b.id,
      date: b.slot_date,
      time: b.slot_time,
      status: b.status,
      trainer: b.trainer_name,
      individual: b.is_individual,
      countsInSubscription: b.counts_in_subscription,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(bookings) }],
      structuredContent: { bookings },
    };
  },
});
