import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-equus-push-secret",
};

type QueueRow = {
  id: string;
  user_id: string;
  kind: string;
  title_lt: string;
  title_en: string;
  body_lt: string;
  body_en: string;
  url: string;
  attempts: number;
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
    throw new Error("Missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("EQUUS_CRON_SECRET");
    const suppliedSecret = req.headers.get("x-equus-push-secret");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let globalProcessing = false;
    let callerId: string | null = null;

    const serviceRoleHeader = req.headers.get("Authorization");
    const serviceRoleKey = serviceKey;
    const cronHeader = req.headers.get("x-equus-cron");
    if (
      (cronSecret && suppliedSecret === cronSecret) ||
      (serviceRoleHeader === `Bearer ${serviceRoleKey}`) ||
      cronHeader === "1"
    ) {
      globalProcessing = true;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
      if (claimsError || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);

      callerId = claimsData.claims.sub as string;
      const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: callerId, _role: "admin" });
      const { data: isTrainer } = await userClient.rpc("has_role", { _user_id: callerId, _role: "trainer" });
      globalProcessing = !!isAdmin || !!isTrainer;
    }

    configureVapid();

    const admin = createClient(supabaseUrl, serviceKey);

    let reminderCount = 0;
    if (globalProcessing) {
      const { data, error: reminderError } =
        await admin.rpc("queue_training_reminders");
      if (reminderError) return json({ error: reminderError.message }, 500);
      reminderCount = Number(data ?? 0);
    }

    let queueQuery = admin
      .from("notification_queue")
      .select("id,user_id,kind,title_lt,title_en,body_lt,body_en,url,attempts")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(100);

    if (!globalProcessing && callerId) {
      queueQuery = queueQuery.eq("user_id", callerId);
    }

    const { data: queue, error: queueError } = await queueQuery;

    if (queueError) return json({ error: queueError.message }, 500);

    let sent = 0;
    let failed = 0;
    let removed = 0;

    for (const item of (queue ?? []) as QueueRow[]) {
      const { data: subscriptions, error: subError } = await admin
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth,language")
        .eq("user_id", item.user_id);

      if (subError) {
        failed++;
        await admin
          .from("notification_queue")
          .update({
            attempts: item.attempts + 1,
            last_error: subError.message,
          })
          .eq("id", item.id);
        continue;
      }

      if (!subscriptions?.length) {
        await admin
          .from("notification_queue")
          .update({ sent_at: new Date().toISOString(), last_error: "NO_SUBSCRIPTIONS" })
          .eq("id", item.id);
        continue;
      }

      let anyDelivered = false;

      for (const subscription of subscriptions) {
        const language = subscription.language === "en" ? "en" : "lt";
        const payload = JSON.stringify({
          title: language === "en" ? item.title_en : item.title_lt,
          body: language === "en" ? item.body_en : item.body_lt,
          url: item.url || "/grafikas",
          kind: item.kind,
        });

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
          );
          anyDelivered = true;
          sent++;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await admin
              .from("push_subscriptions")
              .delete()
              .eq("id", subscription.id);
            removed++;
          } else {
            failed++;
          }
        }
      }

      if (anyDelivered || subscriptions.every((s) => !s.endpoint)) {
        await admin
          .from("notification_queue")
          .update({
            sent_at: new Date().toISOString(),
            attempts: item.attempts + 1,
            last_error: null,
          })
          .eq("id", item.id);
      } else {
        await admin
          .from("notification_queue")
          .update({
            attempts: item.attempts + 1,
            last_error: "PUSH_DELIVERY_FAILED",
          })
          .eq("id", item.id);
      }
    }

    return json({
      ok: true,
      reminders_queued: reminderCount ?? 0,
      processed: queue?.length ?? 0,
      sent,
      failed,
      stale_subscriptions_removed: removed,
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
