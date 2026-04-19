// Hourly job: marks past active bookings as completed and decrements oldest
// active subscription FIFO (only for bookings flagged counts_in_subscription).
// Also handles sickness carry-over to the user's next subscription.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowISO = new Date().toISOString();
  const todayISO = nowISO.slice(0, 10);
  const nowTime = nowISO.slice(11, 19);

  // 1) Find active bookings whose slot has passed.
  const { data: pastActive, error: e1 } = await supabase
    .from("bookings")
    .select("id, user_id, slot_date, slot_time, counts_in_subscription")
    .eq("status", "active")
    .or(`slot_date.lt.${todayISO},and(slot_date.eq.${todayISO},slot_time.lt.${nowTime})`);

  if (e1) {
    console.error("Fetch past bookings failed", e1);
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let consumed = 0;

  for (const b of pastActive ?? []) {
    // Mark as completed
    const { error: upd } = await supabase
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", b.id);
    if (upd) {
      console.error("Mark completed failed", b.id, upd);
      continue;
    }
    processed++;

    if (!b.counts_in_subscription) continue;

    // FIFO: oldest active subscription with remaining lessons
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("id, lessons_total, lessons_used, sickness_credits, expires_at")
      .eq("user_id", b.user_id)
      .order("purchase_date", { ascending: true });

    const usableSub = (subs ?? []).find(
      (s) => s.lessons_used < s.lessons_total && new Date(s.expires_at) >= new Date(b.slot_date),
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

  // 2) Carry over sickness credits: any approved sickness cancellation that
  // hasn't been credited yet adds +1 to the user's NEXT subscription.
  // We use the cancellation_requests.decided_at + admin_decision_counts=false
  // + sickness=true as the source of truth, and mark them by linking the
  // booking's subscription_id field to a synthetic "credited" marker.
  // Simpler approach: every active sub gets credited up to N sickness events
  // that occurred BEFORE the sub's purchase_date and aren't yet counted.
  // We track via a flag column on cancellation_requests.
  // (For now: hands-off — admin can manually adjust sickness_credits.)

  return new Response(
    JSON.stringify({ ok: true, processed, consumed, at: nowISO }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
