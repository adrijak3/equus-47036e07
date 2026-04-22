// Marks past active bookings as completed (using Europe/Vilnius "now") and
// decrements the user's oldest valid active subscription FIFO when the booking
// counts toward the subscription. Idempotent — safe to call repeatedly.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Returns "YYYY-MM-DD" and "HH:MM:SS" in Europe/Vilnius time. */
function vilniusNow(): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { date: todayISO, time: nowTime } = vilniusNow();

  // Expire any past-deadline makeup grants → mark booking as counts_in_subscription
  let makeupsExpired = 0;
  const { data: expiredCount } = await supabase.rpc("expire_makeup_cancellations");
  if (typeof expiredCount === "number") makeupsExpired = expiredCount;

  const { data: pastActive, error: e1 } = await supabase
    .from("bookings")
    .select("id, user_id, slot_date, slot_time, counts_in_subscription, subscription_id")
    .eq("status", "active")
    .or(`slot_date.lt.${todayISO},and(slot_date.eq.${todayISO},slot_time.lt.${nowTime})`);

  if (e1) {
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let consumed = 0;

  for (const b of pastActive ?? []) {
    const { error: upd } = await supabase
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", b.id);
    if (upd) continue;
    processed++;

    if (!b.counts_in_subscription || b.subscription_id) continue;

    const { data: subs } = await supabase
      .from("subscriptions")
      .select("id, lessons_total, lessons_used, expires_at, purchase_date")
      .eq("user_id", b.user_id)
      .order("purchase_date", { ascending: true });

    const usableSub = (subs ?? []).find(
      (s) => s.lessons_used < s.lessons_total && s.expires_at >= b.slot_date,
    );

    if (usableSub) {
      await supabase
        .from("subscriptions")
        .update({ lessons_used: usableSub.lessons_used + 1 })
        .eq("id", usableSub.id);
      await supabase
        .from("bookings")
        .update({ subscription_id: usableSub.id })
        .eq("id", b.id);
      consumed++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed, consumed, makeupsExpired, today: todayISO, now: nowTime }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
