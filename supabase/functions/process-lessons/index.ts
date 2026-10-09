// Marks past active bookings as completed and allocates counted lessons
// through the central, idempotent subscription accounting engine.
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { date: todayISO, time: nowTime } = vilniusNow();

  // This worker is intentionally a once-daily Vilnius-time operation. The
  // database cron calls it at 20:00 local time; calls from any other hour are
  // harmless no-ops and cannot advance subscription usage early.
  if (!nowTime.startsWith("20:")) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "Outside the daily 20:00 Europe/Vilnius processing window",
        today: todayISO,
        now: nowTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  }

  // Expire past-deadline makeup grants first.
  let makeupsExpired = 0;
  const { data: expiredCount } = await supabase.rpc("expire_makeup_cancellations");
  if (typeof expiredCount === "number") {
    makeupsExpired = expiredCount;
  }

  const { data: pastActive, error: e1 } = await supabase
    .from("bookings")
    .select("id, user_id, slot_date, slot_time, counts_in_subscription, subscription_id, is_paused_for_subscription")
    .eq("status", "active")
    .eq("is_paused_for_subscription", false)
    .eq("slot_date", todayISO)
    .lt("slot_time", nowTime);

  if (e1) {
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let consumed = 0;
  let alreadyAllocated = 0;
  let notAllocated = 0;

  for (const booking of pastActive ?? []) {
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", booking.id)
      .eq("status", "active");

    if (updateError) {
      continue;
    }

    processed++;

    if (!booking.counts_in_subscription) {
      continue;
    }

    const { data: allocationResult, error: allocationError } =
      await supabase.rpc("allocate_booking_to_subscription", {
        _booking_id: booking.id,
      });

    if (allocationError) {
      console.error(
        "Subscription allocation failed:",
        booking.id,
        allocationError,
      );
      notAllocated++;
      continue;
    }

    const result = (allocationResult ?? {}) as {
      allocated?: boolean;
      reason?: string;
      subscription_id?: string | null;
    };

    if (result.allocated) {
      if (result.reason === "ALREADY_ALLOCATED" || result.reason === "BOOKING_ALREADY_ATTACHED" || result.reason === "ALREADY_VALID") {
        alreadyAllocated++;
      } else {
        consumed++;
      }

      // A completed lesson may free one lesson of a package that has paused
      // recurring occurrences. Restore the next eligible recurring occurrence
      // only when the slot actually has capacity. Restoration does not attach
      // the future booking to the subscription; it remains future/unconsumed.
      if (result.subscription_id) {
        const { error: restoreError } = await supabase.rpc(
          "restore_paused_bookings_for_subscription",
          { _subscription_id: result.subscription_id },
        );
        if (restoreError) {
          console.error(
            "Failed to restore paused recurring bookings:",
            result.subscription_id,
            restoreError,
          );
        }
      }
    } else {
      notAllocated++;
    }
  }

  // Revisit every counted lesson completed today, including lessons that a
  // trainer marked completed manually before 20:00. Before the daily cutoff,
  // the canonical reconciler deliberately excludes today's lessons; this pass
  // makes the counter refresh once the cutoff has been reached.
  const { data: completedToday, error: completedTodayError } = await supabase
    .from("bookings")
    .select("id, subscription_id, counts_in_subscription, is_paused_for_subscription")
    .eq("slot_date", todayISO)
    .eq("status", "completed")
    .eq("counts_in_subscription", true)
    .eq("is_paused_for_subscription", false);

  if (completedTodayError) {
    console.error("Failed to load today's completed lessons:", completedTodayError);
  }

  const dailySubscriptionIds = new Set<string>();

  for (const booking of completedToday ?? []) {
    let subscriptionId = booking.subscription_id as string | null;

    // The daily job also catches any completed lesson that wasn't allocated by
    // the UI action that marked it completed.
    if (!subscriptionId) {
      const { data: allocationData, error: allocationError } = await supabase.rpc(
        "allocate_booking_to_subscription",
        { _booking_id: booking.id },
      );

      if (allocationError) {
        console.error("Daily lesson allocation failed:", booking.id, allocationError);
        notAllocated++;
        continue;
      }

      const allocation = (allocationData ?? {}) as {
        allocated?: boolean;
        subscription_id?: string | null;
      };

      if (!allocation.allocated || !allocation.subscription_id) {
        continue;
      }

      subscriptionId = allocation.subscription_id;

      const { error: restoreError } = await supabase.rpc(
        "restore_paused_bookings_for_subscription",
        { _subscription_id: subscriptionId },
      );
      if (restoreError) {
        console.error("Failed to restore paused recurring bookings:", subscriptionId, restoreError);
      }
    }

    dailySubscriptionIds.add(subscriptionId);
  }

  // Reconcile only subscriptions connected to completed training today, rather
  // than touching every rider/package every night.
  for (const subscriptionId of dailySubscriptionIds) {
    const { error: reconcileError } = await supabase.rpc(
      "reconcile_subscription_usage",
      { _subscription_id: subscriptionId },
    );
    if (reconcileError) {
      console.error("Daily subscription usage reconciliation failed:", subscriptionId, reconcileError);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed,
      consumed,
      alreadyAllocated,
      notAllocated,
      dailyReconciled: dailySubscriptionIds.size,
      makeupsExpired,
      today: todayISO,
      now: nowTime,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    },
  );
});
