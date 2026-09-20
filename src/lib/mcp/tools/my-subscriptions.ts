import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "my_subscriptions",
  title: "My subscriptions",
  description: "List the signed-in rider's Equus subscriptions (abonementai) with lessons used and remaining.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, lesson_type, lessons_total, lessons_used, paid, price, purchase_date, expires_at, sickness_credits")
      .eq("user_id", ctx.getUserId()!)
      .order("purchase_date", { ascending: false });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const subscriptions = (data ?? []).map((s) => ({
      id: s.id,
      lessonType: s.lesson_type,
      lessonsTotal: s.lessons_total,
      lessonsUsed: s.lessons_used,
      lessonsLeft: s.lessons_total - s.lessons_used,
      paid: s.paid,
      price: s.price,
      purchaseDate: s.purchase_date,
      expiresAt: s.expires_at,
      sicknessCredits: s.sickness_credits,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(subscriptions) }],
      structuredContent: { subscriptions },
    };
  },
});
