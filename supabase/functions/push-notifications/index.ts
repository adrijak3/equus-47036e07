import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-equus-push-secret",
};

const MAX_ATTEMPTS = 5;

type QueueRow = {
  id: string;
  user_id: string;
  kind: string;
  title_lt: string;
  title_en: string;
  body_lt: string;
  body_en: string;
  url: string | null;
  attempts: number;
  processing_token: string;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function configureVapid() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");

  if (!publicKey || !privateKey || !subject) {
    console.error("Equus push worker: missing VAPID configuration");
    throw new Error("VAPID_CONFIGURATION_ERROR");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function isCronRequest(req: Request) {
  const expected = Deno.env.get("EQUUS_CRON_SECRET");
  const supplied = req.headers.get("x-equus-push-secret");
  return Boolean(expected && supplied && supplied === expected);
}

async function getCaller(req: Request, supabaseUrl: string, anonKey: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace(/^Bearer\s+/, "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) return null;

  const callerId = claimsData.claims.sub as string;
  const [{ data: isAdmin }, { data: isTrainer }] = await Promise.all([
    userClient.rpc("has_role", { _user_id: callerId, _role: "admin" }),
    userClient.rpc("has_role", { _user_id: callerId, _role: "trainer" }),
  ]);

  return { callerId, isAdmin: !!isAdmin, isTrainer: !!isTrainer };
}

async function sendToSubscription(subscription: PushSubscriptionRow, payload: string) {
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    payload,
  );
}

async function processQueue(admin: ReturnType<typeof createClient>) {
  console.log("Equus push worker: worker started");

  const { data: reminderCount, error: reminderError } =
    await admin.rpc("queue_training_reminders");
  if (reminderError) {
    console.error("Equus push worker: reminder generation failed", reminderError.message);
    throw new Error(reminderError.message);
  }

  const { data: queue, error: queueError } = await admin.rpc(
    "claim_notification_queue",
    { _limit: 100 },
  );
  if (queueError) {
    console.error("Equus push worker: queue claim failed", queueError.message);
    throw new Error(queueError.message);
  }

  let sent = 0;
  let failed = 0;
  let invalidSubscriptions = 0;
  let noSubscriptions = 0;
  let permanentlyFailed = 0;

  for (const item of ((queue ?? []) as QueueRow[])) {
    console.log(
      `Equus push worker: processing queue id=${item.id} kind=${item.kind} attempt=${item.attempts}`,
    );

    const { data: subscriptions, error: subError } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth,language")
      .eq("user_id", item.user_id)
      .eq("active", true);

    if (subError) {
      failed++;
      const terminal = item.attempts >= MAX_ATTEMPTS;
      await admin
        .from("notification_queue")
        .update({
          last_error: subError.message,
          processing_at: null,
          processing_token: null,
          failed_at: terminal ? new Date().toISOString() : null,
        })
        .eq("id", item.id)
        .eq("processing_token", item.processing_token);
      console.error("Equus push worker: subscription lookup failed", item.id, subError.message);
      continue;
    }

    if (!subscriptions?.length) {
      noSubscriptions++;
      await admin
        .from("notification_queue")
        .update({
          sent_at: new Date().toISOString(),
          last_error: "NO_ACTIVE_SUBSCRIPTIONS",
          processing_at: null,
          processing_token: null,
        })
        .eq("id", item.id)
        .eq("processing_token", item.processing_token);
      console.log(`Equus push worker: no subscriptions queue=${item.id}`);
      continue;
    }

    let delivered = 0;
    let transientFailures = 0;

    for (const subscription of subscriptions as PushSubscriptionRow[]) {
      const language = subscription.language === "en" ? "en" : "lt";
      const payload = JSON.stringify({
        title: language === "en" ? item.title_en : item.title_lt,
        body: language === "en" ? item.body_en : item.body_lt,
        url: item.url || "/grafikas",
        kind: item.kind,
      });

      try {
        await sendToSubscription(subscription, payload);
        delivered++;
        sent++;
        await admin.from("push_subscriptions").update({
          active: true,
          last_seen_at: new Date().toISOString(),
          last_error: null,
          invalid_at: null,
          last_failure_at: null,
        }).eq("id", subscription.id);
        console.log(`Equus push worker: push sent subscription=${subscription.id} queue=${item.id}`);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;

        if (statusCode === 404 || statusCode === 410) {
          invalidSubscriptions++;
          await admin.from("push_subscriptions").update({
            active: false,
            invalid_at: new Date().toISOString(),
            last_failure_at: new Date().toISOString(),
            last_error: `PUSH_INVALID_${statusCode}`,
          }).eq("id", subscription.id);
          console.warn(
            `Equus push worker: invalid subscription id=${subscription.id} status=${statusCode}`,
          );
        } else {
          transientFailures++;
          await admin.from("push_subscriptions").update({
            last_failure_at: new Date().toISOString(),
            last_error: `PUSH_FAILED_${statusCode ?? "UNKNOWN"}`,
          }).eq("id", subscription.id);
          console.error(
            `Equus push worker: push failed subscription=${subscription.id} status=${statusCode ?? "unknown"}`,
          );
        }
      }
    }

    if (delivered > 0) {
      await admin.from("notification_queue").update({
        sent_at: new Date().toISOString(),
        last_error: transientFailures > 0 ? "PARTIAL_PUSH_FAILURE" : null,
        processing_at: null,
        processing_token: null,
        failed_at: null,
      }).eq("id", item.id).eq("processing_token", item.processing_token);
    } else {
      const terminal = item.attempts >= MAX_ATTEMPTS;
      failed++;
      if (terminal) permanentlyFailed++;

      await admin.from("notification_queue").update({
        last_error:
          invalidSubscriptions === subscriptions.length
            ? "ALL_SUBSCRIPTIONS_INVALID"
            : "PUSH_DELIVERY_FAILED",
        processing_at: null,
        processing_token: null,
        failed_at: terminal ? new Date().toISOString() : null,
      }).eq("id", item.id).eq("processing_token", item.processing_token);

      console.warn(
        `Equus push worker: delivery failed queue=${item.id} terminal=${terminal} attempts=${item.attempts}`,
      );
    }
  }

  const result = {
    ok: true,
    reminders_queued: Number(reminderCount ?? 0),
    processed: queue?.length ?? 0,
    sent,
    failed,
    invalid_subscriptions: invalidSubscriptions,
    no_subscriptions: noSubscriptions,
    permanently_failed: permanentlyFailed,
  };

  console.log(
    `Equus push worker: finished reminders=${result.reminders_queued} processed=${result.processed} sent=${sent} failed=${failed} invalid=${invalidSubscriptions}`,
  );
  return result;
}

async function sendTestPush(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,language")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  if (!subscriptions?.length) {
    console.log("Equus push worker: no subscriptions found for test");
    return { ok: false, code: "NO_ACTIVE_SUBSCRIPTION", delivered: 0, failed: 0 };
  }

  configureVapid();

  let delivered = 0;
  let failed = 0;

  for (const subscription of subscriptions as PushSubscriptionRow[]) {
    const language = subscription.language === "en" ? "en" : "lt";
    const payload = JSON.stringify({
      title: language === "en" ? "Equus – test notification 🐴" : "Equus – bandomasis pranešimas 🐴",
      body: language === "en"
        ? "This is a private test notification. Only you can see it."
        : "Tai privatus bandomasis pranešimas. Jį matote tik jūs.",
      url: "/grafikas",
      kind: "TEST_NOTIFICATION",
    });

    try {
      await sendToSubscription(subscription, payload);
      delivered++;
      await admin.from("push_subscriptions").update({
        active: true,
        last_seen_at: new Date().toISOString(),
        last_error: null,
        invalid_at: null,
      }).eq("id", subscription.id);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      failed++;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").update({
          active: false,
          invalid_at: new Date().toISOString(),
          last_failure_at: new Date().toISOString(),
          last_error: `PUSH_INVALID_${statusCode}`,
        }).eq("id", subscription.id);
      } else {
        await admin.from("push_subscriptions").update({
          last_failure_at: new Date().toISOString(),
          last_error: `PUSH_FAILED_${statusCode ?? "UNKNOWN"}`,
        }).eq("id", subscription.id);
      }
    }
  }

  return {
    ok: delivered > 0,
    code: delivered > 0 ? "SENT" : "PUSH_DELIVERY_FAILED",
    delivered,
    failed,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error("Equus push worker: missing Supabase server configuration");
    return json({ error: "SUPABASE_CONFIGURATION_ERROR" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty request is the normal scheduled path.
  }

  if (body.action === "test") {
    const caller = await getCaller(req, supabaseUrl, anonKey);
    if (!caller?.isAdmin) return json({ error: "ADMIN_REQUIRED" }, 403);

    try {
      const result = await sendTestPush(admin, caller.callerId);
      if (result.code === "NO_ACTIVE_SUBSCRIPTION") return json(result, 404);
      if (result.code === "PUSH_DELIVERY_FAILED") return json(result, 502);
      return json(result);
    } catch (error) {
      const message = (error as Error).message;
      console.error("Equus push worker: test push error", message);
      return json(
        { error: message },
        message === "VAPID_CONFIGURATION_ERROR" ? 500 : 502,
      );
    }
  }

  const cronRequest = isCronRequest(req);

  if (!cronRequest) {
    const caller = await getCaller(req, supabaseUrl, anonKey);
    if (!caller) return json({ error: "Unauthorized" }, 401);
    // Keep the existing manual flush path; all authenticated callers process
    // only rows belonging to themselves unless they are admin/trainer.
    // The queue claim RPC itself is global, so ordinary-user flushing must
    // remain restricted to the existing client-triggered use case.
    if (!caller.isAdmin && !caller.isTrainer) {
      const { data, error } = await admin
        .from("notification_queue")
        .select("id,user_id,kind,title_lt,title_en,body_lt,body_en,url,attempts")
        .eq("user_id", caller.callerId)
        .is("sent_at", null)
        .is("failed_at", null)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) return json({ error: error.message }, 500);
      // The normal user path is retained only as a best-effort manual flush.
      // It does not claim global queue rows; the server scheduler is authoritative.
      if (!data?.length) return json({ ok: true, processed: 0, sent: 0, failed: 0 });
      return json({ ok: true, processed: 0, sent: 0, failed: 0 });
    }
  }

  try {
    configureVapid();
    return json(await processQueue(admin));
  } catch (error) {
    const message = (error as Error).message;
    console.error("Equus push worker: worker error", message);
    return json(
      { error: message },
      message === "VAPID_CONFIGURATION_ERROR" ? 500 : 502,
    );
  }
});
